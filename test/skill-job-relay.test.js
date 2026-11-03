import { describe, it, expect, vi, afterEach } from 'vitest';
import { DAIMinerNode } from '../src/miner-node.js';

/**
 * Phase 2: a job submitted via API/MCP for a skill THIS node doesn't have
 * enabled relays to a peer that does, instead of just dropping the job.
 * _relayToPeerForSkill is _relayToPeerForDataset's sibling, filtered by
 * /status's enabledSkillIds; computeAndSubmitJob's skill-job gate calls it
 * before giving up.
 */
describe('_relayToPeerForSkill', () => {
  let realFetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function node(overrides = {}) {
    const n = Object.create(DAIMinerNode.prototype);
    Object.assign(n, overrides);
    return n;
  }

  it('only POSTs to a peer that self-reports the skill enabled, then polls its result', async () => {
    realFetch = global.fetch;
    const n = node({
      _getComputePeers: vi.fn().mockResolvedValue(['http://peer-a:3456', 'http://peer-b:3456']),
      identityWallet: { signingPublicKey: 'sender-pub', sign: (s) => `sig(${s})` },
    });
    const posted = [];
    let polls = 0;
    global.fetch = vi.fn(async (url, opts) => {
      const u = String(url);
      if (u.endsWith('/status')) {
        if (u.includes('peer-a')) return { ok: true, json: async () => ({ enabledSkillIds: ['read_farcaster'] }) };
        if (u.includes('peer-b')) return { ok: true, json: async () => ({ enabledSkillIds: [] }) };
      }
      if (u === 'http://peer-a:3456/job') {
        posted.push(JSON.parse(opts.body));
        return { ok: true };
      }
      if (u === 'http://peer-a:3456/job/job-1/result') {
        polls++;
        if (polls < 2) return { status: 202, json: async () => ({}) };
        return { status: 200, json: async () => ({ verdict: 'SKILL_RESULT', profile: { skillOutput: { ok: true } } }) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const result = await n._relayToPeerForSkill({ id: 'job-1', type: 'skill', skillId: 'read_farcaster', maxBudget: 500, requesterAddress: 'dai_req' });

    expect(posted).toHaveLength(1);
    expect(posted[0]._relayed).toBe(true);
    expect(posted[0].skillId).toBe('read_farcaster');
    expect(result.verdict).toBe('SKILL_RESULT');

    // 'skill' is a FEE_REQUIRED_JOB_TYPES type: without a signed relay proof the
    // receiving peer's /job handler treats this as untrusted and demands a fresh
    // paymentTx for ITS OWN wallet, which the original requester never signed —
    // every relay would 402/403. The proof is what lets the peer trust that the
    // fee was already verified/escrowed upstream (see _relayJobToPeers for the
    // same shape used by the pre-existing geo/competition relay).
    expect(posted[0]._relayPayload).toEqual({ jobId: 'job-1', maxBudget: 500, requesterAddress: 'dai_req', type: 'skill' });
    expect(posted[0]._relayProof).toBe(`sig(${JSON.stringify(posted[0]._relayPayload)})`);
    expect(posted[0]._relaySigner).toBe('sender-pub');
  }, 10_000);

  it('still relays (with a null proof) when this node has no identityWallet, rather than throwing', async () => {
    realFetch = global.fetch;
    const n = node({ _getComputePeers: vi.fn().mockResolvedValue(['http://peer-a:3456']) });
    const posted = [];
    global.fetch = vi.fn(async (url, opts) => {
      const u = String(url);
      if (u.endsWith('/status')) return { ok: true, json: async () => ({ enabledSkillIds: ['read_farcaster'] }) };
      if (u === 'http://peer-a:3456/job') { posted.push(JSON.parse(opts.body)); return { ok: true }; }
      if (u === 'http://peer-a:3456/job/job-1/result') return { status: 200, json: async () => ({ verdict: 'SKILL_RESULT' }) };
      throw new Error(`unexpected fetch: ${u}`);
    });
    await n._relayToPeerForSkill({ id: 'job-1', type: 'skill', skillId: 'read_farcaster' });
    expect(posted[0]._relayProof).toBeNull();
  });

  it('returns null when no peer has the skill enabled', async () => {
    realFetch = global.fetch;
    const n = node({ _getComputePeers: vi.fn().mockResolvedValue(['http://peer-a:3456']) });
    global.fetch = vi.fn(async (url) => {
      if (String(url).endsWith('/status')) return { ok: true, json: async () => ({ enabledSkillIds: [] }) };
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await n._relayToPeerForSkill({ id: 'job-1', type: 'skill', skillId: 'read_farcaster' });
    expect(result).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1); // only the /status check, never a /job POST
  });
});

describe('computeAndSubmitJob skill-job gate', () => {
  function node(overrides = {}) {
    const n = Object.create(DAIMinerNode.prototype);
    Object.assign(n, {
      jobResults: new Map([['job-1', { id: 'job-1', status: 'computing' }]]),
      jobQueue: { completed: new Set(), markCompleted: vi.fn(function (id) { this.completed.add(id); }) },
      ...overrides,
    });
    return n;
  }

  it('relays to a peer and marks the job done when this node lacks the skill', async () => {
    const n = node({
      isSkillEnabled: () => false,
      _relayToPeerForSkill: vi.fn().mockResolvedValue({ verdict: 'SKILL_RESULT', profile: { skillOutput: { ok: true } } }),
    });
    await n.computeAndSubmitJob({ id: 'job-1', type: 'skill', skillId: 'read_farcaster' });
    const rec = n.jobResults.get('job-1');
    expect(rec.status).toBe('done');
    expect(rec._fromPeer).toBe(true);
    expect(rec.result.verdict).toBe('SKILL_RESULT');
    expect(n.jobQueue.markCompleted).toHaveBeenCalledWith('job-1');
  });

  it('falls back to ignored when no peer has the skill either', async () => {
    const n = node({
      isSkillEnabled: () => false,
      _relayToPeerForSkill: vi.fn().mockResolvedValue(null),
    });
    await n.computeAndSubmitJob({ id: 'job-1', type: 'skill', skillId: 'read_farcaster' });
    const rec = n.jobResults.get('job-1');
    expect(rec.status).toBe('ignored');
    expect(rec.error).toBe('skill disabled by miner');
  });

  it('never relays a job that was already relayed here, to avoid bouncing', async () => {
    const relay = vi.fn();
    const n = node({
      isSkillEnabled: () => false,
      _relayToPeerForSkill: relay,
    });
    await n.computeAndSubmitJob({ id: 'job-1', type: 'skill', skillId: 'read_farcaster', _relayed: true });
    expect(relay).not.toHaveBeenCalled();
    expect(n.jobResults.get('job-1').status).toBe('ignored');
  });
});
