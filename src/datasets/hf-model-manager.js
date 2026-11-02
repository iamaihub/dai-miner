/**
 * HfModelManager — track generation models (text-to-image/video/audio) this
 * node can actually run.
 *
 * Unlike hf-dataset-manager.js, this never downloads model weights: running a
 * diffusion/generation model needs an inference pipeline this codebase doesn't
 * ship (no diffusers/ComfyUI runtime here), so "installed" means the node
 * operator has that pipeline set up alongside and is declaring it, the same
 * way `capabilityModels` already declares installed QVAC engines. Declaring a
 * model here is what makes it show up in /status.installedHfModels, which is
 * what lets a peer (via _peersWithStatus / the "dai" MCP pack's
 * peer_capabilities tool) find a node that already has a given model ready
 * instead of only getting a generic HF catalog search result.
 *
 * Layout: <brainDataDir>/hf-models/<safeId>/manifest.json
 *   { id, pipelineTag, installedAt }
 */

import fs from 'fs';
import path from 'path';

const HF_MODELS_API = 'https://huggingface.co/api/models';

function safeDirName(modelId) {
  return modelId.replace(/[^a-zA-Z0-9._-]/g, '__');
}

function modelDir(brainDataDir, modelId) {
  return path.join(brainDataDir, 'hf-models', safeDirName(modelId));
}

function writeManifest(brainDataDir, modelId, manifest) {
  const dir = modelDir(brainDataDir, modelId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

export function isInstalled(brainDataDir, modelId) {
  return fs.existsSync(path.join(modelDir(brainDataDir, modelId), 'manifest.json'));
}

export function getManifest(brainDataDir, modelId) {
  try {
    const p = path.join(modelDir(brainDataDir, modelId), 'manifest.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function listInstalled(brainDataDir) {
  const root = path.join(brainDataDir, 'hf-models');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root)) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(root, entry, 'manifest.json'), 'utf8')));
    } catch { /* skip malformed/partial entry */ }
  }
  return out;
}

export function deleteModel(brainDataDir, modelId) {
  const dir = modelDir(brainDataDir, modelId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Declare that this node can run `modelId`. Verifies the model exists on
 * Hugging Face and records its pipeline tag unless the caller already
 * supplies one (so this stays usable offline / in tests, and for private or
 * since-removed models the operator knows are fine).
 */
export async function registerInstalled(brainDataDir, modelId, { pipelineTag } = {}) {
  let tag = pipelineTag || null;
  if (!tag) {
    const res = await fetch(`${HF_MODELS_API}/${modelId}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Model "${modelId}" not found on Hugging Face`);
    const meta = await res.json();
    tag = meta.pipeline_tag || null;
  }
  const manifest = { id: modelId, pipelineTag: tag, installedAt: Date.now() };
  writeManifest(brainDataDir, modelId, manifest);
  return manifest;
}
