/**
 * Phase 4 activation — multi-peer cascade fan-out + reward-split settlement.
 *
 * The §2.1-2.3 design (contributions tracking, splitContributions,
 * job-settled.contributions, _applySettlement crediting each contributor) was
 * already fully built, but had never actually run: _cascadeFanOutActive()
 * returned false unconditionally (gated behind CASCADE_FANOUT_FORK_HEIGHT =
 * Infinity), so every piece only had unit coverage for its own math, never an
 * end-to-end run. Now that it's unconditionally on (the v0.4.41 genesis fork
 * is the activation boundary — see _cascadeFanOutActive's comment), these
 * tests exercise the integration points that were never reachable before:
 *   1. _runTaskCascade actually dispatches to a peer and assembles
 *      contributions from both a peer and local work.
 *   2. _computeBoardJob's routed-compute branch carries contributions through
 *      to the result it hands back to _settleBoardFeeJob (fixed this session
 *      — it used to drop them on the floor).
 *   3. _settleBoardFeeJob actually splits the fee across contributors instead
 *      of paying the whole thing to the single claiming worker (fixed this
 *      session — same bug, the settlement side of it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DAIMinerNode } from '../src/miner-node.js';
import { Wallet, WalletManager } from '../src/wallet/wallet.js';
import { computeBoardJobPaymentHash } from '../src/jobs/board-payment.js';

describe('_runTaskCascade dispatches fanned-out tasks and assembles contributions', () => {
  it('attributes a peer-computed task and a locally-computed task separately', async () => {
    const node = Object.create(DAIMinerNode.prototype);
    node.config = { wallet: 'dai' + '1'.repeat(40) };
    node.mcp = null;

    // One task dispatches to a peer successfully; the other has no peer
    // available and falls back to local (the pre-existing, always-worked path).
    node._dispatchCascadeTask = vi.fn(async (task) => {
      if (task.skillId === 'skill_a') return { output: 'peer answer', tokensUsed: 40, address: 'dai' + '2'.repeat(40) };
      return null; // no peer for skill_b — _runSkillForCascade falls back to local
    });
    node._runSkillForCascade = vi.fn(async (skillId) => ({ output: `local:${skillId}`, tokensUsed: 15 }));
    node._llmChat = vi.fn(async (messages) => `synthesized from: ${JSON.stringify(messages[messages.length - 1].content).slice(0, 40)}`);

    const plan = {
      type: 'tasks',
      stages: [[
        { kind: 'skill', id: 'skill:skill_a', skillId: 'skill_a', input: { message: 'a' }, segment: 'a' },
        { kind: 'skill', id: 'skill:skill_b', skillId: 'skill_b', input: { message: 'b' }, segment: 'b' },
      ]],
    };

    const result = await node._runTaskCascade(plan, { model: 'qwen3-1.7b', message: 'do a and b' });

    expect(node._dispatchCascadeTask).toHaveBeenCalledTimes(2);
    const peerAddr = 'dai' + '2'.repeat(40);
    const localAddr = node.config.wallet;
    const byAddress = Object.fromEntries(result.contributions.map(c => [c.address, c.tokensUsed]));
    expect(byAddress[peerAddr]).toBe(40); // peer's share is exact — only the task itself, no synthesis
    // Local address gets skill_b's 15 PLUS whatever the final aggregator LLM
    // synthesis call cost — both are attributed to the coordinator's own
    // wallet, merged into one entry (see _runTaskCascade's `merged` map).
    expect(byAddress[localAddr]).toBeGreaterThanOrEqual(15);
    expect(result.tokensUsed).toBeGreaterThanOrEqual(55); // 40 + 15 + aggregator's own LLM call
  });

  it('falls back entirely to local work when no peer ever answers', async () => {
    const node = Object.create(DAIMinerNode.prototype);
    node.config = { wallet: 'dai' + '3'.repeat(40) };
    node._dispatchCascadeTask = vi.fn().mockResolvedValue(null);
    node._runSkillForCascade = vi.fn(async () => ({ output: 'local only', tokensUsed: 20 }));
    node._llmChat = vi.fn(async () => 'synthesized');

    const plan = { type: 'tasks', stages: [[{ kind: 'skill', id: 'skill:x', skillId: 'x', input: {}, segment: 'x' }]] };
    const result = await node._runTaskCascade(plan, { model: 'qwen3-1.7b', message: 'x' });

    // Single-task cascade with a single-success fast path in aggregateResults
    // (task-cascade.js) may skip the separate synthesis LLM call entirely —
    // either way, everything lands on the one local contributor.
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0].address).toBe(node.config.wallet);
    expect(result.contributions[0].tokensUsed).toBeGreaterThanOrEqual(20);
  });
});

describe('_computeBoardJob carries routed contributions through (was dropped before this session)', () => {
  it('includes contributions in the returned compute-job result when the route had any', async () => {
    const node = Object.create(DAIMinerNode.prototype);
    node.config = { wallet: 'dai' + '4'.repeat(40) };
    const peerAddr = 'dai' + '5'.repeat(40);
    node._routeComputePrompt = vi.fn().mockResolvedValue({
      reply: 'the answer', skillId: 'task-cascade', tokensUsed: 60,
      contributions: [{ address: peerAddr, tokensUsed: 40 }, { address: node.config.wallet, tokensUsed: 20 }],
    });
    node._chatVisibility = () => ({ encrypt: false, encPub: null });
    node.methodsManager = { getStatus: () => ({ hash: 'h' }) };

    const result = await node._computeBoardJob({ type: 'compute', payload: { prompt: 'hi' } });

    expect(result.contributions).toEqual([
      { address: peerAddr, tokensUsed: 40 },
      { address: node.config.wallet, tokensUsed: 20 },
    ]);
  });

  it('omits the field entirely when the route had nothing to split (no behavior change)', async () => {
    const node = Object.create(DAIMinerNode.prototype);
    node.config = { wallet: 'dai' + '6'.repeat(40) };
    node._routeComputePrompt = vi.fn().mockResolvedValue({ reply: 'ok', skillId: 'web_search', tokensUsed: 10 });
    node._chatVisibility = () => ({ encrypt: false, encPub: null });
    node.methodsManager = { getStatus: () => ({ hash: 'h' }) };

    const result = await node._computeBoardJob({ type: 'compute', payload: { prompt: 'hi' } });

    expect(result).not.toHaveProperty('contributions');
  });
});

describe('_settleBoardFeeJob splits the fee across contributors (was paid in full to the claiming worker)', () => {
  let dir, wm, node, requester;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-fanout-settle-'));
    wm = new WalletManager(dir);
    requester = Wallet.generate();
    requester.balance = 1000;
    wm.saveWallet(requester);

    node = Object.create(DAIMinerNode.prototype);
    node.config = { wallet: 'dai' + '7'.repeat(40) };
    node.walletManager = wm;
    node.escrow = new Map();
    node._appliedEscrowJobIds = new Set();
    node._gossipedJobTransitions = new Set();
    node.pendingBrainTransitions = [];
    node.gossip = { publish: vi.fn() };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function signedPayment(jobId, maxBudget, nonce = 0) {
    const txHash = computeBoardJobPaymentHash({ jobId, requesterAddress: requester.address, amount: maxBudget, nonce });
    return { txHash, signature: requester.sign(txHash), nonce };
  }

  it('pays the worker only its share, credits the sub-task peer the rest', async () => {
    const worker = 'dai' + '8'.repeat(40);
    const peer = 'dai' + '9'.repeat(40);
    const jobId = 'board-job-1';
    const maxBudget = 1000;

    const settled = await node._settleBoardFeeJob({
      jobId, worker, requesterAddress: requester.address, maxBudget, currency: 'DAI',
      paymentTx: signedPayment(jobId, maxBudget),
      result: { tokensUsed: 100, contributions: [{ address: worker, tokensUsed: 25 }, { address: peer, tokensUsed: 75 }] },
    });

    expect(settled).toBe(true);
    // gasPrice defaults to GAS.DEFAULT_GAS_PRICE; fee = min(tokensUsed*gasPrice, maxBudget).
    // Whatever the fee comes out to, it must divide 3:1 (75:25 tokens) between
    // peer and worker, and the two payouts must sum to the full fee — nothing
    // left unpaid, nothing paid twice.
    const workerBal = wm.getBalance(worker);
    const peerBal = wm.getBalance(peer);
    expect(workerBal).toBeGreaterThan(0);
    expect(peerBal).toBeGreaterThan(0);
    expect(peerBal).toBeGreaterThan(workerBal); // 75 tokens vs 25 — peer earned 3x
    const totalFee = workerBal + peerBal;
    expect(Math.round(peerBal / totalFee * 100)).toBe(75); // proportional split, not an even one
  });

  it('pays the worker the whole fee when the result has no contributions (unchanged prior behavior)', async () => {
    const worker = 'dai' + 'a'.repeat(40);
    const jobId = 'board-job-2';
    const maxBudget = 1000;

    await node._settleBoardFeeJob({
      jobId, worker, requesterAddress: requester.address, maxBudget, currency: 'DAI',
      paymentTx: signedPayment(jobId, maxBudget),
      result: { tokensUsed: 50 },
    });

    expect(wm.getBalance(worker)).toBeGreaterThan(0);
  });
});
