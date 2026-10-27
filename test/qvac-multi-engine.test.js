/**
 * Multi-engine resident pool (Phase 1: llamacpp-embedding / llamacpp-decision
 * alongside llamacpp-completion).
 *
 * typeForConstant/residentCapFor are the pure pieces of the new per-type LRU
 * scoping — they decide which pool a model belongs to and how many of that
 * type may stay resident at once. evictIfNeeded/getModelId themselves need
 * the native addon (same reason buildClusterModelConfig is the only piece of
 * the RPC-cluster code unit tested here), so they aren't covered directly.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { typeForConstant, residentCapFor } = require('../src/checker/utils/qvac-models.js');

describe('typeForConstant', () => {
  it('maps the pilot embedding/decision constants to their SDK modelType', () => {
    expect(typeForConstant('EMBEDDINGGEMMA_300M_Q8_0')).toBe('llamacpp-embedding');
    expect(typeForConstant('LAYA_MULTILINGUAL_322M_Q8_0')).toBe('llamacpp-decision');
  });

  it('defaults every completion model (and anything unknown) to llm', () => {
    expect(typeForConstant('QWEN3_1_7B_INST_Q4')).toBe('llm');
    expect(typeForConstant('GPT_OSS_120B_INST_Q4_K_M_SHARD')).toBe('llm');
    // Raw custom paths resolveModel() can return aren't in the registry at all.
    expect(typeForConstant('/home/me/custom-model.gguf')).toBe('llm');
    expect(typeForConstant(undefined)).toBe('llm');
  });
});

describe('residentCapFor', () => {
  it('gives embedding/decision their own small pools, independent of QVAC_MAX_RESIDENT', () => {
    expect(residentCapFor('llamacpp-embedding')).toBeGreaterThanOrEqual(1);
    expect(residentCapFor('llamacpp-decision')).toBeGreaterThanOrEqual(1);
  });

  it('falls back to 1 for an unrecognized type rather than throwing', () => {
    expect(residentCapFor('some-future-engine')).toBe(1);
  });
});
