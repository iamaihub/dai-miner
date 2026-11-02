import { describe, it, expect } from 'vitest';
import { formatModelSuggestions } from '../src/datasets/hf-model-search.js';

describe('formatModelSuggestions', () => {
  const models = [
    { id: 'a/model', pipelineTag: 'text-to-video', tags: ['video'], description: 'generates video', downloads: 100 },
    { id: 'b/model', pipelineTag: 'text-to-video', tags: ['video'], description: 'also generates video', downloads: 50 },
  ];

  it('says nothing was found when there are no candidates', () => {
    const out = formatModelSuggestions('a cat on a snowboard', []);
    expect(out).toMatch(/couldn't find/i);
  });

  it('never claims generation happened, and defaults to "install it yourself" with no peer info', () => {
    const out = formatModelSuggestions('a cat on a snowboard', models);
    expect(out).toMatch(/can't generate media directly/i);
    expect(out).not.toMatch(/✓/);
    expect(out).toMatch(/install its dependencies/i);
  });

  it('flags a model a peer already has installed, singular vs plural peer count', () => {
    const out = formatModelSuggestions('a cat on a snowboard', models, { peerCounts: { 'a/model': 1, 'b/model': 3 } });
    expect(out).toMatch(/a\/model[\s\S]*✓ 1 network peer already has this installed/);
    expect(out).toMatch(/b\/model[\s\S]*✓ 3 network peers already have this installed/);
    expect(out).toMatch(/already installed on a network peer/i);
  });

  it('ignores peerCounts entries for models not in the candidate list', () => {
    const out = formatModelSuggestions('a cat on a snowboard', models, { peerCounts: { 'unrelated/model': 5 } });
    expect(out).not.toMatch(/✓/);
  });
});
