import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildDaiNodePack } from '../src/ai/builtin-mcp/dai-node.js';

/**
 * The "dai" builtin pack — this node's own explorer/wallet/p2p/skills tools.
 * Every tool loopback-calls this node's own HTTP API (port from config) or
 * the configured bootnode; nothing here takes a free-form URL from the model.
 */
describe('dai-node builtin pack', () => {
  let realFetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function tool(pack, name) {
    const t = pack.tools.find(t => t.name === name);
    if (!t) throw new Error(`no such tool: ${name}`);
    return t;
  }

  it('ships 11 tools, each with a matching dai/ card', () => {
    const pack = buildDaiNodePack(() => ({}));
    expect(pack.id).toBe('dai');
    expect(pack.tools).toHaveLength(11);
    expect(pack.cards).toHaveLength(11);
    for (const t of pack.tools) {
      expect(pack.cards.some(c => c.tool === t.name && c.mcpId === 'dai')).toBe(true);
    }
  });

  it('get_status loopback-calls this node\'s own configured port', async () => {
    realFetch = global.fetch;
    const pack = buildDaiNodePack(() => ({ walletApiPort: 9999 }));
    const seen = [];
    global.fetch = vi.fn(async (url) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ wallet: 'dai_abc', chainHeight: 42 }) };
    });
    const out = JSON.parse(await tool(pack, 'get_status').run({}));
    expect(seen).toEqual(['http://127.0.0.1:9999/status']);
    expect(out.chainHeight).toBe(42);
  });

  it('defaults to port 3456 when walletApiPort is unset', async () => {
    realFetch = global.fetch;
    const pack = buildDaiNodePack(() => ({}));
    const seen = [];
    global.fetch = vi.fn(async (url) => { seen.push(String(url)); return { ok: true, json: async () => ({}) }; });
    await tool(pack, 'get_chain_tip').run({});
    expect(seen).toEqual(['http://127.0.0.1:3456/chain/tip']);
  });

  it('rejects missing required arguments before ever calling fetch', async () => {
    realFetch = global.fetch;
    const pack = buildDaiNodePack(() => ({}));
    global.fetch = vi.fn();
    await expect(tool(pack, 'get_block').run({})).rejects.toThrow('height required');
    await expect(tool(pack, 'explorer_search').run({})).rejects.toThrow('query required');
    await expect(tool(pack, 'get_wallet_balance').run({})).rejects.toThrow('address required');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('list_peers and get_network_history fail clearly with no bootnode configured', async () => {
    const pack = buildDaiNodePack(() => ({ bootnodes: [] }));
    await expect(tool(pack, 'list_peers').run({})).rejects.toThrow('no bootnode configured');
    await expect(tool(pack, 'get_network_history').run({})).rejects.toThrow('no bootnode configured');
  });

  it('peer_capabilities queries the bootnode for peers, then each peer\'s own /status, dropping unreachable ones', async () => {
    realFetch = global.fetch;
    const pack = buildDaiNodePack(() => ({ bootnodes: ['https://boot.example'] }));
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u === 'https://boot.example/peers') {
        return {
          ok: true,
          json: async () => ({
            peers: [
              { host: 'peer-a', walletApiPort: 3456, wallet: 'dai_a' },
              { host: 'peer-b', walletApiPort: 3456, wallet: 'dai_b' },
            ],
          }),
        };
      }
      if (u === 'http://peer-a:3456/status') {
        return { ok: true, json: async () => ({ model: 'qwen3-1.7b', installedHfDatasets: ['ds1'], capabilities: [] }) };
      }
      if (u === 'http://peer-b:3456/status') {
        throw new Error('peer-b unreachable');
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    const out = JSON.parse(await tool(pack, 'peer_capabilities').run({}));
    expect(out.queried).toBe(2);
    expect(out.responded).toBe(1);
    expect(out.peers).toEqual([
      { host: 'peer-a', wallet: 'dai_a', model: 'qwen3-1.7b', chainHeight: undefined, region: undefined, installedHfDatasets: ['ds1'], capabilities: [], capabilityModels: [] },
    ]);
  });
});
