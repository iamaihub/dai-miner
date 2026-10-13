/**
 * Settlement is metered: fee = actual cost (capped at the bid), the rest refunds.
 * A harder job (more tokens, e.g. a cascade that ran several tools) costs more;
 * a trivial reply on a generous budget refunds the difference.
 */
import { describe, it, expect } from 'vitest';
import { settleFee, timeoutFee, splitContributions } from '../src/jobs/gas-estimator.js';

describe('settleFee', () => {
  it('charges exactly the token cost when under budget, refunding the rest', () => {
    const { fee, refund, cost, underfunded } = settleFee(1000, 1, 10_000);
    expect(cost).toBe(1000);
    expect(fee).toBe(1000);
    expect(refund).toBe(9000);
    expect(underfunded).toBe(false);
  });

  it('a harder job (more tokens) costs more than an easier one under the same budget', () => {
    const easy = settleFee(500, 1, 10_000);
    const hard = settleFee(5000, 1, 10_000);
    expect(hard.fee).toBeGreaterThan(easy.fee);
    expect(hard.refund).toBeLessThan(easy.refund);
  });

  it('caps the fee at maxBudget and flags underfunded when cost exceeds the bid', () => {
    const { fee, refund, underfunded } = settleFee(100_000, 1, 10_000);
    expect(fee).toBe(10_000);
    expect(refund).toBe(0);
    expect(underfunded).toBe(true);
  });

  it('zero tokens used refunds the entire bid', () => {
    expect(settleFee(0, 1, 10_000)).toMatchObject({ fee: 0, refund: 10_000 });
  });
});

describe('timeoutFee', () => {
  it('reserves a small percentage of the bid, refunding the rest', () => {
    const { reservation, refund } = timeoutFee(10_000);
    expect(reservation).toBeCloseTo(500); // 5% default
    expect(refund).toBeCloseTo(9500);
    expect(reservation + refund).toBeCloseTo(10_000);
  });

  it('honors a custom reservation percentage', () => {
    const { reservation, refund } = timeoutFee(10_000, 0.1);
    expect(reservation).toBeCloseTo(1000);
    expect(refund).toBeCloseTo(9000);
  });
});

// Phase 2 cascade fan-out payout split (dormant unless CASCADE_FANOUT_FORK_HEIGHT
// activates in miner-node.js — see that constant). Pure money-math, tested in
// isolation since it can't be exercised end-to-end without a multi-node network.
describe('splitContributions', () => {
  const coordinator = 'daiCOORD';
  const peerA = 'daiPEERA';
  const peerB = 'daiPEERB';

  it('keeps the whole fee when the coordinator did all the work alone', () => {
    const { minerFee, payouts } = splitContributions(1000, [{ address: coordinator, tokensUsed: 500 }], coordinator);
    expect(minerFee).toBe(1000);
    expect(payouts).toEqual([]);
  });

  it('splits proportionally to tokens used across contributors', () => {
    const contributions = [
      { address: coordinator, tokensUsed: 100 }, // coordinator ran 1 task locally
      { address: peerA, tokensUsed: 300 },        // peer ran a harder task
    ];
    const { minerFee, payouts } = splitContributions(400, contributions, coordinator);
    expect(payouts).toEqual([{ address: peerA, amount: 300 }]); // 300/400 * 400
    expect(minerFee).toBe(100); // the rest
  });

  it('splits across multiple non-coordinator peers, dropping the coordinator from payouts', () => {
    const contributions = [
      { address: coordinator, tokensUsed: 100 },
      { address: peerA, tokensUsed: 100 },
      { address: peerB, tokensUsed: 200 },
    ];
    const { minerFee, payouts } = splitContributions(400, contributions, coordinator);
    expect(payouts).toEqual([
      { address: peerA, amount: 100 }, // 100/400 * 400
      { address: peerB, amount: 200 }, // 200/400 * 400
    ]);
    expect(minerFee).toBe(100);
  });

  it('rounds down per contributor and gives any remainder to the coordinator, never losing or double-paying', () => {
    // 3-way even split of 100 (not divisible by 3): each non-coordinator share
    // floors to 33, leaving 34 for the coordinator — 33+33+34 = 100, exactly.
    const contributions = [
      { address: coordinator, tokensUsed: 1 },
      { address: peerA, tokensUsed: 1 },
      { address: peerB, tokensUsed: 1 },
    ];
    const { minerFee, payouts } = splitContributions(100, contributions, coordinator);
    expect(payouts).toEqual([{ address: peerA, amount: 33 }, { address: peerB, amount: 33 }]);
    expect(minerFee).toBe(34);
    expect(minerFee + payouts.reduce((s, c) => s + c.amount, 0)).toBe(100); // conservation
  });

  it('never emits a zero-amount payout', () => {
    const contributions = [
      { address: coordinator, tokensUsed: 999 },
      { address: peerA, tokensUsed: 1 }, // rounds down to 0 of a tiny fee
    ];
    const { payouts } = splitContributions(10, contributions, coordinator);
    expect(payouts.every(c => c.amount > 0)).toBe(true);
  });

  it('is a no-op with fewer than two contributors', () => {
    expect(splitContributions(1000, [], coordinator)).toEqual({ minerFee: 1000, payouts: [] });
    expect(splitContributions(1000, [{ address: coordinator, tokensUsed: 50 }], coordinator)).toEqual({ minerFee: 1000, payouts: [] });
  });

  it('is a no-op with zero fee or zero total tokens', () => {
    const contributions = [{ address: coordinator, tokensUsed: 10 }, { address: peerA, tokensUsed: 10 }];
    expect(splitContributions(0, contributions, coordinator)).toEqual({ minerFee: 0, payouts: [] });
    expect(splitContributions(1000, [{ address: coordinator, tokensUsed: 0 }, { address: peerA, tokensUsed: 0 }], coordinator))
      .toEqual({ minerFee: 1000, payouts: [] });
  });
});
