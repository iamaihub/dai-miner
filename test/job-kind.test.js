import { describe, it, expect } from 'vitest';
import { prepareJob, isIdentityScanJob } from '../src/jobs/job-kind.js';

const ADDR = '0x0000000000000000000000000000000000000001';

describe('job kind', () => {
  it('keeps an address scan as verdict and names the identity skill', () => {
    const job = prepareJob({ type: 'verdict', payload: { address: ADDR } });
    expect(job.type).toBe('verdict');
    expect(job.skillId).toBe('dai_identity');
    expect(isIdentityScanJob(job)).toBe(true);
  });

  it('keeps a web3 domain scan as verdict', () => {
    const job = prepareJob({ type: 'verdict', payload: { address: 'vitalik.eth' } });
    expect(job.type).toBe('verdict');
    expect(isIdentityScanJob(job)).toBe(true);
  });

  it('treats poh_identity with an address as the identity scan', () => {
    const job = prepareJob({ skillId: 'poh_identity', payload: { address: 'assetux.bnb' } });
    expect(job.type).toBe('verdict');
    expect(job.skillId).toBe('dai_identity');
  });

  it('does not run verdict for a handle, a prompt, or a missing target', () => {
    expect(prepareJob({ type: 'verdict', payload: { address: 'KsaRedFx' } }).type).toBe('compute');
    expect(prepareJob({ type: 'verdict', payload: { prompt: 'hello' } }).type).toBe('compute');
    expect(prepareJob({ type: 'verdict' }).type).toBe('compute');
    expect(prepareJob({ payload: { address: ADDR } }).type).toBe('compute');
  });

  it('runs any other skill as compute and keeps the skill id', () => {
    const job = prepareJob({ type: 'skill', skillId: 'web_search', payload: { query: 'x' } });
    expect(job.type).toBe('compute');
    expect(job.skillId).toBe('web_search');
    expect(isIdentityScanJob(job)).toBe(false);
  });
});
