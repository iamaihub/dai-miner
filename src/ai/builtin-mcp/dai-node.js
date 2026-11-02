/**
 * Builtin "dai" pack — this node's own self-knowledge.
 *
 * Chain explorer (blocks/tx/address lookup), wallet, skills catalog and p2p
 * all already exist as plain HTTP routes on this same process (and on the
 * configured bootnode for peer listing) — this pack just wraps them as MCP
 * tools so chat/MCP callers can query them directly instead of only seeing
 * them through the Electron GUI. Every call here is either a loopback call
 * to this node's own API or a call to the configured bootnode; never a
 * free-form URL from the model.
 */

import { fetchJson, compact, str, num } from './fetch.js';

function apiBase(getConfig) {
  const port = getConfig?.()?.walletApiPort || 3456;
  return `http://127.0.0.1:${port}`;
}

function firstBootnode(getConfig) {
  const bootnodes = getConfig?.()?.bootnodes || [];
  const b = bootnodes[0];
  if (!b) return null;
  return b.endsWith('/') ? b.slice(0, -1) : b;
}

export function buildDaiNodePack(getConfig = () => ({})) {
  const base = () => apiBase(getConfig);

  const tools = [
    {
      name: 'get_status',
      description: "This node's own status: wallet address, chain height, model, peer count, reputation, enabled MCP servers.",
      inputSchema: { type: 'object', properties: {} },
      cardId: 'dai/get_status',
      async run() {
        return compact(await fetchJson(`${base()}/status`));
      },
    },
    {
      name: 'get_chain_tip',
      description: "Latest block on this node's chain: height, hash, timestamp, chain work.",
      inputSchema: { type: 'object', properties: {} },
      cardId: 'dai/get_chain_tip',
      async run() {
        return compact(await fetchJson(`${base()}/chain/tip`));
      },
    },
    {
      name: 'list_blocks',
      description: 'Recent blocks (explorer). Each entry: height, hash, timestamp, miner, tx/job counts, reward.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'number', description: '0-based page number. Defaults to 0 (most recent).' },
          limit: { type: 'number', description: 'Blocks per page, max 50. Defaults to 20.' },
        },
      },
      cardId: 'dai/list_blocks',
      async run(args) {
        const page = num(args.page, 0);
        const limit = num(args.limit, 20);
        return compact(await fetchJson(`${base()}/api/explorer/blocks?page=${page}&limit=${limit}`));
      },
    },
    {
      name: 'get_block',
      description: 'One block by height, full detail (transactions, job results, miner).',
      inputSchema: {
        type: 'object',
        properties: { height: { type: 'number', description: 'Block height' } },
        required: ['height'],
      },
      cardId: 'dai/get_block',
      async run(args) {
        const height = num(args.height);
        if (height == null) throw new Error('height required');
        return compact(await fetchJson(`${base()}/api/explorer/block/${height}`));
      },
    },
    {
      name: 'explorer_search',
      description: 'Look up a block height, a block/transaction hash, or a wallet address. For an address: returns balance, held assets, recent ledger entries and recent jobs.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Block height, tx/block hash, or wallet address' } },
        required: ['query'],
      },
      cardId: 'dai/explorer_search',
      async run(args) {
        const q = str(args.query || args.q);
        if (!q) throw new Error('query required');
        return compact(await fetchJson(`${base()}/api/explorer/search?q=${encodeURIComponent(q)}`));
      },
    },
    {
      name: 'get_wallet_balance',
      description: "DAI + stablecoin balance for one address. Call get_status first if you need this node's own wallet address.",
      inputSchema: {
        type: 'object',
        properties: { address: { type: 'string' } },
        required: ['address'],
      },
      cardId: 'dai/get_wallet_balance',
      async run(args) {
        const address = str(args.address);
        if (!address) throw new Error('address required');
        return compact(await fetchJson(`${base()}/api/wallet/balance?address=${encodeURIComponent(address)}`));
      },
    },
    {
      name: 'get_wallet_history',
      description: "Recent balance-changing ledger entries (sends, receives, mining rewards) for an address. Omit address for this node's own wallet.",
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string' },
          limit: { type: 'number', description: 'Max entries, defaults to 30' },
        },
      },
      cardId: 'dai/get_wallet_history',
      async run(args) {
        const params = new URLSearchParams();
        if (str(args.address)) params.set('address', str(args.address));
        if (args.limit != null) params.set('limit', String(num(args.limit, 30)));
        const qs = params.toString();
        return compact(await fetchJson(`${base()}/api/wallet/history${qs ? '?' + qs : ''}`));
      },
    },
    {
      name: 'list_skills',
      description: 'Skills this node can run: id, description, whether enabled, stake totals.',
      inputSchema: { type: 'object', properties: {} },
      cardId: 'dai/list_skills',
      async run() {
        return compact(await fetchJson(`${base()}/api/skills`));
      },
    },
    {
      name: 'list_peers',
      description: 'Peer miners known to this network, from the configured bootnode.',
      inputSchema: { type: 'object', properties: {} },
      cardId: 'dai/list_peers',
      async run() {
        const bn = firstBootnode(getConfig);
        if (!bn) throw new Error('no bootnode configured');
        return compact(await fetchJson(`${bn}/peers`));
      },
    },
    {
      name: 'get_network_history',
      description: 'Recent network-wide activity (blocks/jobs) as tracked by the bootnode.',
      inputSchema: { type: 'object', properties: {} },
      cardId: 'dai/get_network_history',
      async run() {
        const bn = firstBootnode(getConfig);
        if (!bn) throw new Error('no bootnode configured');
        return compact(await fetchJson(`${bn}/network/history`));
      },
    },
    {
      name: 'peer_capabilities',
      description: "What each known peer actually has installed right now: chat model, installed HF datasets, extra engines (e.g. embeddings). Check this before assuming a peer can serve a model or dataset — a peer being online does not mean it has the specific thing you need.",
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max peers to query, default 25' } },
      },
      cardId: 'dai/peer_capabilities',
      async run(args) {
        const bn = firstBootnode(getConfig);
        if (!bn) throw new Error('no bootnode configured');
        const { peers } = await fetchJson(`${bn}/peers`);
        const list = (peers || [])
          .filter(p => p.host && p.walletApiPort)
          .slice(0, num(args.limit, 25));
        const settled = await Promise.allSettled(list.map(async p => {
          const peerBase = `http://${p.host}:${p.walletApiPort}`;
          const s = await fetchJson(`${peerBase}/status`, { timeoutMs: 4000 });
          return {
            host: p.host, wallet: p.wallet,
            model: s.model, chainHeight: s.chainHeight, region: s.region,
            installedHfDatasets: s.installedHfDatasets || [],
            capabilities: s.capabilities || [],
            capabilityModels: s.capabilityModels || [],
          };
        }));
        const ok = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
        return compact({ queried: list.length, responded: ok.length, peers: ok });
      },
    },
  ];

  const TRIGGERS = {
    get_status: ['node status', 'miner status', 'my status'],
    get_chain_tip: ['chain tip', 'latest block', 'block height'],
    list_blocks: ['recent blocks', 'list blocks', 'block explorer'],
    get_block: ['get block', 'block details', 'block number'],
    explorer_search: ['block explorer', 'search blockchain', 'look up address', 'look up transaction', 'tx hash'],
    get_wallet_balance: ['wallet balance', 'dai balance', 'my balance'],
    get_wallet_history: ['wallet history', 'transaction history'],
    list_skills: ['list skills', 'available skills', 'what skills'],
    list_peers: ['list peers', 'network peers', 'who is mining'],
    get_network_history: ['network history', 'network activity'],
    peer_capabilities: ['peer capabilities', 'who has this model', 'who has this dataset', 'peer models'],
  };

  const cards = tools.map(t => ({
    id: t.cardId,
    mcpId: 'dai',
    tool: t.name,
    auth: 'none',
    summary: t.description,
    tags: ['dai', 'explorer', 'wallet', 'p2p', 'skills', 'blockchain'],
    triggers: TRIGGERS[t.name] || [],
    argKeys: Object.keys(t.inputSchema?.properties || {}),
  }));

  return {
    id: 'dai',
    name: 'DAI Node',
    summary: "This node's own self-knowledge: chain explorer, wallet, peers, skills.",
    tools,
    cards,
  };
}
