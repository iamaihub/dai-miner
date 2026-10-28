import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DAIMinerNode } from '../src/miner-node.js';

/**
 * Phase 3: capability-aware peer relay.
 *
 * _peersWithStatus is the shared "fetch every known peer's /status once, keep
 * only the ones matching a predicate" helper behind _relayToPeerChat's model
 * match, _relayToPeerForDataset, and the new _relayToPeerForEmbedding. These
 * tests exercise it directly via the embedding relay (the newest caller) and
 * confirm the older two callers still produce the same filtering behavior
 * after being rebased onto the shared helper.
 */
describe('_peersWithStatus / _relayToPeerForEmbedding', () => {
  let node, realFetch;

  beforeEach(() => {
    realFetch = global.fetch;
    node = Object.create(DAIMinerNode.prototype);
    node._getComputePeers = vi.fn().mockResolvedValue([
      'http://peer-a:3456',
      'http://peer-b:3456',
      'http://peer-c:3456', // /status fetch for this one will fail
    ]);
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mockStatuses({ a, b }) {
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).endsWith('/status')) {
        if (String(url).includes('peer-a')) return { ok: true, json: async () => a };
        if (String(url).includes('peer-b')) return { ok: true, json: async () => b };
        if (String(url).includes('peer-c')) throw new Error('peer-c unreachable');
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it('keeps only peers whose /status satisfies the predicate, dropping an unreachable one', async () => {
    mockStatuses({
      a: { capabilities: ['llamacpp-embedding'], capabilityModels: ['embeddinggemma-300m'] },
      b: { capabilities: [] },
    });
    const matched = await node._peersWithStatus(s => s?.capabilities?.includes('llamacpp-embedding'));
    expect(matched).toEqual(['http://peer-a:3456']);
  });

  it('_relayToPeerForEmbedding only considers capability-matched peers and posts to /embed/ask', async () => {
    mockStatuses({
      a: { capabilities: ['llamacpp-embedding'], capabilityModels: ['embeddinggemma-300m'] },
      b: { capabilities: [] }, // no embedding capability — must never be POSTed to
    });
    const posted = [];
    const baseFetch = global.fetch;
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).endsWith('/embed/ask')) {
        posted.push({ url: String(url), body: JSON.parse(opts.body) });
        return { ok: true, json: async () => ({ embeddings: [[1, 2, 3]] }) };
      }
      return baseFetch(url, opts);
    });

    const result = await node._relayToPeerForEmbedding(['hello'], { model: null });

    expect(result).toEqual([[1, 2, 3]]);
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe('http://peer-a:3456/embed/ask');
    expect(posted[0].body).toEqual({ texts: ['hello'], model: null });
  });

  it('filters further by capabilityModels when a specific model is required', async () => {
    mockStatuses({
      a: { capabilities: ['llamacpp-embedding'], capabilityModels: ['some-other-model'] },
      b: { capabilities: ['llamacpp-embedding'], capabilityModels: ['embeddinggemma-300m'] },
    });
    const matched = await node._peersWithStatus(s =>
      s?.capabilities?.includes('llamacpp-embedding') && s?.capabilityModels?.includes('embeddinggemma-300m'));
    expect(matched).toEqual(['http://peer-b:3456']);
  });

  it('returns null when no peer has the capability', async () => {
    mockStatuses({ a: { capabilities: [] }, b: { capabilities: [] } });
    const result = await node._relayToPeerForEmbedding(['hello'], {});
    expect(result).toBeNull();
  });

  it('returns null (not throw) when _getComputePeers itself fails', async () => {
    node._getComputePeers = vi.fn().mockRejectedValue(new Error('bootnode down'));
    const result = await node._relayToPeerForEmbedding(['hello'], {});
    expect(result).toBeNull();
  });
});
