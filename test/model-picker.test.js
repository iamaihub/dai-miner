/**
 * Hardware-aware model ladder, plus the four startup suggestion categories.
 * Bigger machines must be offered a bigger "big" model inside a category.
 * A category never offers a model above the usable budget when a smaller one fits.
 */
import { describe, it, expect } from 'vitest';
import { MODEL_LADDER, MODEL_CATEGORIES, NARROW_DOMAINS, getModelOptions } from '../src/setup/model-picker.js';

const hw = (usableGB, gpuType = 'none', vramGB = 0) =>
  ({ totalRamGB: usableGB * 2, platform: 'linux', arch: 'x64', gpu: { type: gpuType, vramGB, label: 't' }, usableGB });

describe('model ladder', () => {
  it('is sorted smallest → largest with monotonic budgets', () => {
    for (let i = 1; i < MODEL_LADDER.length; i++) {
      expect(MODEL_LADDER[i].minBudgetGB).toBeGreaterThan(MODEL_LADDER[i - 1].minBudgetGB);
      expect(MODEL_LADDER[i].approxDownloadGB).toBeGreaterThan(MODEL_LADDER[i - 1].approxDownloadGB);
    }
    // Spans ultra-tiny → flagship
    expect(MODEL_LADDER[0].name).toBe('smollm2-360m');
    expect(MODEL_LADDER[MODEL_LADDER.length - 1].name).toBe('gpt-oss-120b');
    expect(MODEL_LADDER.some(m => /vision|multimodal|vl/i.test(m.label + m.name))).toBe(true);
  });

  it('offers the four categories, each with a small and a big end', () => {
    expect(MODEL_CATEGORIES.map(c => c.label)).toEqual([
      'General Purpose', 'Image & Video', 'Personal Agents', 'Narrow AI',
    ]);
    const { categories, options } = getModelOptions(hw(8));
    expect(categories.map(c => c.id)).toEqual(['general', 'media', 'agents', 'narrow']);
    for (const cat of categories) {
      expect(cat.small.minBudgetGB).toBeLessThanOrEqual(cat.big.minBudgetGB);
      expect(cat.small.minBudgetGB).toBeLessThanOrEqual(8);
      expect(cat.big.minBudgetGB).toBeLessThanOrEqual(8);
    }
    expect(options.map(o => o.name)).toEqual([
      'qwen3-1.7b', 'qwen3-4b',
      'qwen3vl-2b', 'gemma4-2b-mm',
      'botpsy-0.8b-q4', 'botpsy-0.8b',
      'medpsy-1.7b', 'medpsy-4b',
      'qwen-math-1.5b', 'qwen-math-1.5b-q8',
      'qwen-coder-1.5b', 'qwen-coder-1.5b-q8',
      'translatepsy-0.8b', 'translatepsy-2b',
      'embeddinggemma-300m',
      'laya-decision-322m',
    ]);
    expect(categories.find(c => c.id === 'agents').big.name).toBe('botpsy-0.8b');
  });

  it('narrow AI picks a specialty, then suggests a small and a big model', () => {
    expect(NARROW_DOMAINS.map(d => d.label)).toEqual([
      'Medicine', 'Math', 'Coding', 'Translation', 'Search', 'Decisions',
    ]);
    const narrow = getModelOptions(hw(8)).categories.find(c => c.id === 'narrow');
    const byId = Object.fromEntries(narrow.domains.map(d => [d.id, d]));
    expect(byId.medicine.small.name).toBe('medpsy-1.7b');
    expect(byId.medicine.big.name).toBe('medpsy-4b');
    expect(byId.math.small.name).toBe('qwen-math-1.5b');
    expect(byId.math.big.name).toBe('qwen-math-1.5b-q8');
    expect(byId.coding.small.name).toBe('qwen-coder-1.5b');
    expect(byId.coding.big.name).toBe('qwen-coder-1.5b-q8');
    expect(byId.medicine.small.categoryLabel).toBe('Narrow AI · Medicine');

    const roomy = getModelOptions(hw(32)).categories.find(c => c.id === 'narrow');
    const roomyById = Object.fromEntries(roomy.domains.map(d => [d.id, d]));
    expect(roomyById.math.big.name).toBe('qwen-math-7b');
    expect(roomyById.coding.big.name).toBe('kat-coder-35b-q4');
    expect(roomyById.medicine.big.name).toBe('medpsy-4b-q8');
  });

  it('grows the general-purpose big model as usable memory grows', () => {
    const order = ['qwen3-1.7b', 'qwen3-4b', 'qwen3-8b', 'gpt-oss-20b', 'gpt-oss-120b'];
    let prev = -1;
    for (const gb of [4, 8, 16, 24, 96]) {
      const general = getModelOptions(hw(gb)).categories.find(c => c.id === 'general');
      const idx = order.indexOf(general.big.name);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
    expect(getModelOptions(hw(96, 'nvidia', 48)).categories.find(c => c.id === 'general').big.name).toBe('gpt-oss-120b');
    expect(getModelOptions(hw(4)).categories.find(c => c.id === 'general').big.name).toBe('qwen3-1.7b');
  });

  it('never offers a fitting-category model above the usable budget', () => {
    for (const gb of [1, 3, 7, 12, 18, 26, 34, 80]) {
      for (const cat of getModelOptions(hw(gb)).categories) {
        const ends = cat.domains ? cat.domains : [cat];
        for (const end of ends) {
          // The smallest model is kept even when it is over budget, so a specialty is never empty.
          const over = end.big.minBudgetGB > gb;
          if (over) expect(end.big.name).toBe(end.small.name);
          else expect(end.big.minBudgetGB).toBeLessThanOrEqual(gb);
        }
      }
    }
  });

  it('discrete AMD/Intel GPUs (type "gpu") grade like NVIDIA', () => {
    const amd = getModelOptions(hw(32, 'gpu', 20));
    const nv  = getModelOptions(hw(32, 'nvidia', 20));
    expect(amd.categories.find(c => c.id === 'general').big.name)
      .toBe(nv.categories.find(c => c.id === 'general').big.name);
  });
});
