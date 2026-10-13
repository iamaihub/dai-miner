/**
 * Settlement is metered: fee = actual cost (capped at the bid), the rest refunds.
 * A harder job (more tokens, e.g. a cascade that ran several tools) costs more;
 * a trivial reply on a generous budget refunds the difference.
 */
import { describe, it, expect } from 'vitest';
import { settleFee, timeoutFee } from '../src/jobs/gas-estimator.js';

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
