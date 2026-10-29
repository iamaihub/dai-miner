import { describe, it, expect } from 'vitest';
import { buildMcpArgs, resolveTaskArgs } from '../src/ai/task-cascade.js';

/**
 * Blind MCP calls used to spray the whole user message into { query, message, q }
 * whatever the tool declared, so a tool with none of those keys was called and
 * rejected — the work was wasted twice, once on a peer and again on the local
 * fallback.
 */
describe('buildMcpArgs', () => {
  const schema = (props) => ({ inputSchema: { properties: props } });

  it('fills only the declared text field, not three synonyms', () => {
    expect(buildMcpArgs(schema({ query: {}, limit: {} }), 'astana weather'))
      .toEqual({ query: 'astana weather' });
  });

  it('refuses a tool with no text-shaped input', () => {
    // onion-search__fetch_pages takes only `indexes`; calling it blind produced
    // "indexes required" every time.
    expect(buildMcpArgs(schema({ indexes: {} }), 'anything')).toBeNull();
  });

  it('picks the first matching key by preference order', () => {
    // `query` outranks `message` so a tool offering both gets the canonical one.
    expect(buildMcpArgs(schema({ message: {}, query: {} }), 'hi')).toEqual({ query: 'hi' });
    expect(buildMcpArgs(schema({ keyword: {} }), 'hi')).toEqual({ keyword: 'hi' });
  });

  it('falls back to the generic shape when no schema is published', () => {
    // Better to try than to refuse a tool that never declared its inputs.
    expect(buildMcpArgs({}, 'hi')).toEqual({ query: 'hi', message: 'hi', q: 'hi' });
    expect(buildMcpArgs(schema({}), 'hi')).toEqual({ query: 'hi', message: 'hi', q: 'hi' });
    expect(buildMcpArgs(null, 'hi')).toEqual({ query: 'hi', message: 'hi', q: 'hi' });
  });

  it('does not treat a non-text field as fillable', () => {
    expect(buildMcpArgs(schema({ latitude: {}, longitude: {} }), 'astana')).toBeNull();
  });

  it('ignores inherited object keys rather than matching Object.prototype', () => {
    expect(buildMcpArgs(schema({ constructor: {} }), 'hi')).toBeNull();
  });

  it('fills catalog argKeys when the card has no JSON schema', () => {
    expect(buildMcpArgs({ argKeys: ['question'] }, 'how do I transfer SOL?'))
      .toEqual({ question: 'how do I transfer SOL?' });
    expect(buildMcpArgs({ argKeys: ['resource_type'] }, 'AWS::Lambda::Function'))
      .toEqual({ resource_type: 'AWS::Lambda::Function' });
    expect(buildMcpArgs({ argKeys: ['query', 'libraryName'] }, 'react hooks'))
      .toEqual({ query: 'react hooks', libraryName: 'react hooks' });
  });

  it('does not call a catalog tool whose only arg is structured', () => {
    expect(buildMcpArgs({ argKeys: ['indexes'] }, 'search the onion')).toBeNull();
  });

  it('refuses therm_pay blind — a signed Solana tx can never come from chat text', () => {
    // therm_pay forwards an already-signed transaction; stuffing the user's
    // sentence into it would just produce a doomed-to-fail remote call.
    expect(buildMcpArgs({ argKeys: ['prompt', 'transaction'] }, 'pay for my quote now')).toBeNull();
  });

  it('extracts an inline Solana signature for therm_result but refuses without one', () => {
    const sig = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CEzuwojAFaRejJrGqQmM4CxNr1QLCeqQqNJKDT4fK2fVSVVFrqnE2TN5n9';
    expect(buildMcpArgs({ argKeys: ['signature'] }, `what's the result for signature ${sig}`))
      .toEqual({ signature: sig });
    expect(buildMcpArgs({ argKeys: ['signature'] }, 'what happened to my last payment?')).toBeNull();
  });

  it('strips the instruction tail and extracts the value the field wants', () => {
    expect(buildMcpArgs({ argKeys: ['search_phrase'] }, 'aws docs. Answer briefly with a fact from the tool, not a guess.'))
      .toEqual({ search_phrase: 'aws docs' });
    expect(buildMcpArgs({ argKeys: ['city'] }, 'weather in Paris. Answer briefly with real data.'))
      .toEqual({ city: 'Paris' });
    expect(buildMcpArgs({ argKeys: ['word'] }, 'define serendipity')).toEqual({ word: 'serendipity' });
    expect(buildMcpArgs({ argKeys: ['word'] }, 'dictionary. Answer briefly with real data.')).toBeNull();
    expect(buildMcpArgs({ argKeys: ['repoName', 'question'] }, 'tell me about iamai.kg')).toBeNull();
    expect(buildMcpArgs({ argKeys: ['repoName', 'question'] }, 'ask about repo torvalds/linux what is the license'))
      .toEqual({
        repoName: 'torvalds/linux',
        question: 'ask about repo torvalds/linux what is the license',
      });
    expect(buildMcpArgs({ argKeys: ['name'] }, 'npm package express')).toEqual({ name: 'express' });
    expect(buildMcpArgs({ argKeys: ['name'] }, 'dns example.com')).toEqual({ name: 'example.com' });
    expect(buildMcpArgs({ argKeys: ['keywords'] }, 'running shoes')).toEqual({ keywords: ['running', 'shoes'] });
    expect(buildMcpArgs({ argKeys: ['product', 'url'] }, 'draft https://iamai.kg for shoes')).toMatchObject({ url: 'https://iamai.kg' });
    expect(buildMcpArgs({ argKeys: ['product', 'url'] }, 'draft a campaign for shoes')).toBeNull();
    expect(buildMcpArgs({ argKeys: ['from', 'to'] }, 'usd to eur')).toEqual({ from: 'USD', to: 'EUR' });
    expect(buildMcpArgs({ argKeys: [] }, 'hacker news')).toEqual({});
  });

  it('extracts owner/repo from a full github.com URL instead of "github.com/<owner>"', () => {
    // Regression: "can you read this repo? https://github.com/SICIndex/contracts"
    // used to shape repo as "github.com/SICIndex" (treating the host as the
    // owner), so the GitHub API call 404'd on a repo that actually exists.
    expect(buildMcpArgs({ argKeys: ['repo'] }, 'can you read this repo? https://github.com/SICIndex/contracts'))
      .toEqual({ repo: 'SICIndex/contracts' });
    expect(buildMcpArgs({ argKeys: ['owner'] }, 'https://github.com/facebook/react'))
      .toEqual({ owner: 'facebook' });
    expect(buildMcpArgs({ argKeys: ['repo'] }, 'http://github.com/torvalds/linux.git'))
      .toEqual({ repo: 'torvalds/linux' });
    expect(buildMcpArgs({ argKeys: ['repo'] }, 'github.com/SICIndex/contracts/tree/main/src'))
      .toEqual({ repo: 'SICIndex/contracts' });
    // Regression: the REST API form (api.github.com/repos/owner/repo) used to
    // shape repo as "repos/SICIndex", not "SICIndex/contracts".
    expect(buildMcpArgs({ argKeys: ['repo'] }, 'what can those smart contracts do api.github.com/repos/SICIndex/contracts'))
      .toEqual({ repo: 'SICIndex/contracts' });
  });

  it('does not keep a sentence the model put on repoName', () => {
    expect(resolveTaskArgs({
      arguments: { query: 'tell me about iamai.kg' },
      argKeys: ['repoName', 'question'],
      segment: 'tell me about iamai.kg',
    }, {}, 'tell me about iamai.kg')).toBeNull();
  });
});
