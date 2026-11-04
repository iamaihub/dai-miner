import { describe, it, expect } from 'vitest';
import { searchCards } from '../src/ai/mcp-catalog.js';

/**
 * Regression for the avalanche/ai-portal false-positive: "say OK" (which
 * isConversational() doesn't short-circuit, since it only matches messages
 * that START with a greeting) was scoring avalanche's rpc_lookup_method tool
 * and ai-portal's search_glossary tool as candidates, purely because "ok" is
 * a substring of "lookup" in their tool name / summary — zero semantic
 * relation to the query. searchCards previously matched blob terms with raw
 * `blob.includes(t)`; it now requires a whole-word match.
 */
describe('searchCards', () => {
  const avalancheLookup = {
    id: 'avalanche/rpc_lookup_method', mcpId: 'avalanche', tool: 'rpc_lookup_method',
    summary: 'Look up an Avalanche RPC method', tags: ['crypto', 'avalanche', 'docs'],
    triggers: ['avalanche rpc', 'c-chain method', 'rpc_lookup_method', 'avalanche'],
  };
  const aiPortalGlossary = {
    id: 'ai-portal/search_glossary', mcpId: 'ai-portal', tool: 'search_glossary',
    summary: 'GenAI glossary lookup', tags: ['ai', 'news', 'regulation'],
    triggers: ['genai term', 'ai glossary', 'search_glossary', 'ai-portal'],
  };
  const cards = [avalancheLookup, aiPortalGlossary];

  it('does not match "ok" against "lookup" as a substring', () => {
    expect(searchCards(cards, 'say OK')).toEqual([]);
    expect(searchCards(cards, 'ok')).toEqual([]);
  });

  it('still matches a real whole-word term overlap', () => {
    const hits = searchCards(cards, 'tell me about avalanche');
    expect(hits.map(h => h.id)).toContain('avalanche/rpc_lookup_method');
  });

  it('still matches via curated triggers regardless of the blob fix', () => {
    const hits = searchCards(cards, 'avalanche rpc method lookup');
    expect(hits.map(h => h.id)).toContain('avalanche/rpc_lookup_method');
  });
});
