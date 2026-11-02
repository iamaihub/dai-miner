import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as hfModelManager from '../src/datasets/hf-model-manager.js';

/**
 * Phase 1 (peer discovery for HF generation models): a declared-capability
 * registry, not a weight download — see hf-model-manager.js's module doc for
 * why. These tests cover the registry itself; the peer-discovery wiring
 * (/status.installedHfModels, runners.findPeersWithModel) is covered by
 * mcp-dai-node.test.js (peer_capabilities) and task-cascade.test.js (hf-model).
 */
describe('hf-model-manager', () => {
  let dir, realFetch;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dai-hf-model-'));
    realFetch = global.fetch;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('is not installed until registered', () => {
    expect(hfModelManager.isInstalled(dir, 'stabilityai/stable-video-diffusion')).toBe(false);
    expect(hfModelManager.listInstalled(dir)).toEqual([]);
  });

  it('registers using an explicitly supplied pipelineTag without calling fetch', async () => {
    global.fetch = vi.fn();
    const manifest = await hfModelManager.registerInstalled(dir, 'stabilityai/stable-video-diffusion', { pipelineTag: 'image-to-video' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(manifest.id).toBe('stabilityai/stable-video-diffusion');
    expect(manifest.pipelineTag).toBe('image-to-video');
    expect(hfModelManager.isInstalled(dir, 'stabilityai/stable-video-diffusion')).toBe(true);
  });

  it('looks up the pipeline tag from Hugging Face when none is supplied', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pipeline_tag: 'text-to-image' }) }));
    const manifest = await hfModelManager.registerInstalled(dir, 'stabilityai/sdxl-turbo');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://huggingface.co/api/models/stabilityai/sdxl-turbo',
      expect.anything(),
    );
    expect(manifest.pipelineTag).toBe('text-to-image');
  });

  it('throws when Hugging Face has no such model and no pipelineTag was given', async () => {
    global.fetch = vi.fn(async () => ({ ok: false }));
    await expect(hfModelManager.registerInstalled(dir, 'nonexistent/model')).rejects.toThrow('not found');
  });

  it('listInstalled returns every registered model, deleteModel removes one', async () => {
    await hfModelManager.registerInstalled(dir, 'model/a', { pipelineTag: 'text-to-image' });
    await hfModelManager.registerInstalled(dir, 'model/b', { pipelineTag: 'text-to-video' });
    expect(hfModelManager.listInstalled(dir).map(m => m.id).sort()).toEqual(['model/a', 'model/b']);

    hfModelManager.deleteModel(dir, 'model/a');
    expect(hfModelManager.listInstalled(dir).map(m => m.id)).toEqual(['model/b']);
    expect(hfModelManager.isInstalled(dir, 'model/a')).toBe(false);
  });
});
