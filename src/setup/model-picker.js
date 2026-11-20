/**
 * Hardware-aware LLM picker.
 *
 * QVAC downloads and runs the inference model in-process. The right model size
 * depends on the machine: a "large" model on an 8 GB laptop is not the same as
 * a "large" model on a 128 GB workstation with a big GPU. This module detects
 * the host's usable memory (unified RAM on Apple Silicon, VRAM on a discrete
 * GPU, otherwise system RAM) and returns four categories. General Purpose,
 * Image & Video, and Personal Agents each have a small and a big model.
 * Narrow AI asks for a specialty first (Medicine, Math, Coding, and the
 * rest), then suggests a small and a big model for that specialty.
 */

import os from 'os';
import { execSync } from 'child_process';

// Text + vision LLM ladder, smallest → largest. `minBudgetGB` is the usable-
// memory headroom we want before offering a model as a comfortable pick.
// Vision models (VL / multimodal) can read chat image attachments via QVAC.
// Keep minBudgetGB and approxDownloadGB strictly monotonic (tests + grading).
export const MODEL_LADDER = [
  { name: 'smollm2-360m',  label: 'SmolLM2 360M',           constant: 'SMOLLM2_360M_INST_Q8',              approxDownloadGB: 0.35, minBudgetGB: 1,  blurb: 'Ultra-tiny text model. Emergency mode on very low-RAM hosts.' },
  { name: 'qwen3-0.6b',    label: 'Qwen3 0.6B',             constant: 'QWEN3_600M_INST_Q4',                approxDownloadGB: 0.45, minBudgetGB: 1.5, blurb: 'Fastest Qwen, tiny footprint. Good on low-RAM / CPU-only hosts.' },
  { name: 'llama3.2-1b',   label: 'Llama 3.2 1B',           constant: 'LLAMA_3_2_1B_INST_Q4_0',            approxDownloadGB: 0.8,  minBudgetGB: 2,  blurb: 'Meta small instruct model. Snappy chat on modest machines.' },
  { name: 'llama-tool-1b', label: 'Llama Tool-Calling 1B',  constant: 'LLAMA_TOOL_CALLING_1B_INST_Q4_K_M', approxDownloadGB: 0.95, minBudgetGB: 2.5, blurb: 'Tuned for tool/MCP calling. Good with skills and MCP servers.' },
  { name: 'smolvlm2-500m', label: 'SmolVLM2 500M (vision)', constant: 'SMOLVLM2_500M_MULTIMODAL_Q8_0',     approxDownloadGB: 1.05, minBudgetGB: 3,  blurb: 'Tiny vision-language model — reads images in chat.' },
  { name: 'qwen3-1.7b',    label: 'Qwen3 1.7B',             constant: 'QWEN3_1_7B_INST_Q4',                approxDownloadGB: 1.2,  minBudgetGB: 3.5, blurb: 'Balanced quality and speed. Solid all-round default.' },
  { name: 'qwen3vl-2b',    label: 'Qwen3-VL 2B (vision)',   constant: 'QWEN3VL_2B_MULTIMODAL_Q4_K',        approxDownloadGB: 1.6,  minBudgetGB: 4.5, blurb: 'Vision + text. Best pick when you attach screenshots or photos.' },
  { name: 'qwen3.5-2b-mm', label: 'Qwen3.5 2B Multimodal',  constant: 'QWEN3_5_2B_MULTIMODAL_Q4_K_M',      approxDownloadGB: 1.9,  minBudgetGB: 5.5, blurb: 'Newer Qwen multimodal — image understanding + chat.' },
  { name: 'gemma4-2b-mm',  label: 'Gemma4 2B Multimodal',   constant: 'GEMMA4_2B_MULTIMODAL_Q4_K_M',       approxDownloadGB: 2.1,  minBudgetGB: 6.5, blurb: 'Google Gemma4 vision-language model.' },
  { name: 'qwen3-4b',      label: 'Qwen3 4B',               constant: 'QWEN3_4B_INST_Q4_K_M',              approxDownloadGB: 2.5,  minBudgetGB: 7.5, blurb: 'Noticeably stronger reasoning and structured output.' },
  { name: 'qwen3.5-4b-mm', label: 'Qwen3.5 4B Multimodal',  constant: 'QWEN3_5_4B_MULTIMODAL_Q4_K_M',      approxDownloadGB: 3.2,  minBudgetGB: 9,  blurb: 'Strong multimodal reasoning for docs and screenshots.' },
  { name: 'qwen3-8b',      label: 'Qwen3 8B',               constant: 'QWEN3_8B_INST_Q4_K_M',              approxDownloadGB: 5.0,  minBudgetGB: 12, blurb: 'Great quality on a capable GPU or 16 GB+ RAM.' },
  { name: 'gpt-oss-20b',   label: 'GPT-OSS 20B',            constant: 'GPT_OSS_20B_INST_Q4_K_M',           approxDownloadGB: 11.6, minBudgetGB: 18, blurb: 'Frontier-lab open model. Wants 24 GB VRAM or 32 GB RAM.' },
  { name: 'qwen3-27b',     label: 'Qwen3.6 27B',            constant: 'QWEN3_6_27B_MULTIMODAL_Q4_K_XL',    approxDownloadGB: 17.6, minBudgetGB: 26, blurb: 'Large dense model, strong reasoning. 32 GB+ machines.' },
  { name: 'qwen3-35b',     label: 'Qwen3.6 35B-A3B (MoE)',  constant: 'QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M', approxDownloadGB: 22.1, minBudgetGB: 34, blurb: 'Mixture-of-experts: 35B quality at ~3B active speed. 48 GB+ machines.' },
  { name: 'gpt-oss-120b',  label: 'GPT-OSS 120B',           constant: 'GPT_OSS_120B_INST_Q4_K_M_SHARD',    approxDownloadGB: 62.8, minBudgetGB: 80, blurb: 'Flagship-class. Workstations with 96 GB+ unified/VRAM only.' },
];

// Models the suggestion offers that are not rungs on the size ladder above.
// BotPsy, Qwen math, and Qwen coder weights resolve to a GGUF URL in
// qvac-models.js. MedPsy, TranslatePsy, KAT-Coder, EmbeddingGemma, and LAYA
// are constants in the installed QVAC SDK.
const EXTRA_MODELS = [
  { name: 'botpsy-0.8b-q4', label: 'BotPsy 0.8B Q4', approxDownloadGB: 0.53, minBudgetGB: 1.8, blurb: 'Compact personal agent. Tool calling on a tight memory budget.' },
  { name: 'botpsy-0.8b',    label: 'BotPsy 0.8B',    approxDownloadGB: 0.81, minBudgetGB: 2.2, blurb: 'Personal agent for tools, calendar, search, and small workflows. Q8 weights.' },
  { name: 'translatepsy-0.8b', label: 'TranslatePsy 0.8B', approxDownloadGB: 0.67, minBudgetGB: 2, blurb: 'QVAC translation model. Compact, good for short text.' },
  { name: 'qwen-math-1.5b', label: 'Qwen2.5-Math 1.5B Q4', approxDownloadGB: 1.0, minBudgetGB: 2.8, blurb: 'Step-by-step math. Smallest specialist that still follows a worked solution.' },
  { name: 'qwen-coder-1.5b', label: 'Qwen2.5-Coder 1.5B Q4', approxDownloadGB: 1.0, minBudgetGB: 2.8, blurb: 'Small coding model for snippets, edits, and short programs.' },
  { name: 'embeddinggemma-300m', label: 'EmbeddingGemma 300M', approxDownloadGB: 0.3, minBudgetGB: 1, blurb: 'Turns text into vectors for search and similarity. Not a chat model.' },
  { name: 'laya-decision-322m',  label: 'LAYA 322M',           approxDownloadGB: 0.35, minBudgetGB: 1.2, blurb: 'Classification and yes/no decisions. Not a chat model.' },
  { name: 'medpsy-1.7b', label: 'MedPsy 1.7B', approxDownloadGB: 1.3, minBudgetGB: 3.5, blurb: 'QVAC medical model. Question answering and clinical reasoning, Q4 weights.' },
  { name: 'qwen-math-1.5b-q8', label: 'Qwen2.5-Math 1.5B Q8', approxDownloadGB: 1.6, minBudgetGB: 4, blurb: 'Same 1.5B math model with higher-quality Q8 weights.' },
  { name: 'qwen-coder-1.5b-q8', label: 'Qwen2.5-Coder 1.5B Q8', approxDownloadGB: 1.6, minBudgetGB: 4, blurb: 'Same 1.5B coder with higher-quality Q8 weights.' },
  { name: 'translatepsy-2b', label: 'TranslatePsy 2B', approxDownloadGB: 1.6, minBudgetGB: 4.5, blurb: 'QVAC translation model. Stronger than the 0.8B on longer text.' },
  { name: 'medpsy-4b', label: 'MedPsy 4B', approxDownloadGB: 2.7, minBudgetGB: 8, blurb: 'Larger QVAC medical model. Q4 is the size QVAC recommends.' },
  { name: 'qwen-math-7b', label: 'Qwen2.5-Math 7B', approxDownloadGB: 4.7, minBudgetGB: 10, blurb: 'Stronger math reasoning. Q4 weights, about 4.7 GB.' },
  { name: 'qwen-coder-7b', label: 'Qwen2.5-Coder 7B', approxDownloadGB: 4.7, minBudgetGB: 10, blurb: 'Everyday coding model. Q4 weights, about 4.7 GB.' },
  { name: 'medpsy-4b-q8', label: 'MedPsy 4B Q8', approxDownloadGB: 4.7, minBudgetGB: 11, blurb: 'MedPsy 4B at Q8. Near-lossless medical weights.' },
  { name: 'kat-coder-35b', label: 'KAT-Coder 35B', approxDownloadGB: 9.8, minBudgetGB: 16, blurb: 'Large coding model from the QVAC catalog. IQ2 weights, about 9.8 GB.' },
  { name: 'kat-coder-35b-q4', label: 'KAT-Coder 35B Q4', approxDownloadGB: 21.4, minBudgetGB: 32, blurb: 'KAT-Coder at Q4. Highest coding quality in the catalog, about 21 GB.' },
];

const MODEL_BY_NAME = new Map([...MODEL_LADDER, ...EXTRA_MODELS].map(m => [m.name, m]));

// Narrow AI is a specialty first, then a small and a big model for that
// specialty. Each list is smallest → largest.
export const NARROW_DOMAINS = [
  { id: 'medicine',    label: 'Medicine',    models: ['medpsy-1.7b', 'medpsy-4b', 'medpsy-4b-q8'] },
  { id: 'math',        label: 'Math',        models: ['qwen-math-1.5b', 'qwen-math-1.5b-q8', 'qwen-math-7b'] },
  { id: 'coding',      label: 'Coding',      models: ['qwen-coder-1.5b', 'qwen-coder-1.5b-q8', 'qwen-coder-7b', 'kat-coder-35b', 'kat-coder-35b-q4'] },
  { id: 'translation', label: 'Translation', models: ['translatepsy-0.8b', 'translatepsy-2b'] },
  { id: 'search',      label: 'Search',      models: ['embeddinggemma-300m'] },
  { id: 'decisions',   label: 'Decisions',   models: ['laya-decision-322m'] },
];

// Each category lists models smallest → largest. The suggestion shows the
// smallest and the largest that fit the usable budget. Narrow AI uses
// `domains` instead of one pair for the whole category.
export const MODEL_CATEGORIES = [
  { id: 'general', label: 'General Purpose', models: ['qwen3-1.7b', 'qwen3-4b', 'qwen3-8b', 'gpt-oss-20b', 'gpt-oss-120b'] },
  { id: 'media',   label: 'Image & Video',   models: ['qwen3vl-2b', 'gemma4-2b-mm', 'qwen3.5-4b-mm', 'qwen3-27b', 'qwen3-35b'] },
  { id: 'agents',  label: 'Personal Agents', models: ['botpsy-0.8b-q4', 'botpsy-0.8b'] },
  { id: 'narrow',  label: 'Narrow AI', domains: NARROW_DOMAINS, models: NARROW_DOMAINS.flatMap(d => d.models) },
];

/** Detect RAM, platform, and any GPU (Apple unified memory, or NVIDIA VRAM). */
export function detectHardware() {
  const totalRamGB = Math.max(1, Math.round(os.totalmem() / 1e9));
  const platform = process.platform;
  const arch = process.arch;
  let gpu = { type: 'none', vramGB: 0, label: 'CPU only (no dedicated GPU detected)' };

  if (platform === 'darwin' && arch === 'arm64') {
    // Apple Silicon: GPU shares unified memory with the CPU.
    gpu = { type: 'apple', vramGB: totalRamGB, label: 'Apple Silicon (unified memory)' };
  } else {
    // NVIDIA discrete GPU (Linux/Windows). A present nvidia-smi with no driver
    // (Intel-only machines) throws; that is not a discrete GPU.
    try {
      const out = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
      const line = out.split('\n').filter(Boolean)[0];
      if (line) {
        const [name, memMiB] = line.split(',');
        gpu = { type: 'nvidia', vramGB: Math.max(1, Math.round(parseInt(memMiB, 10) / 1024)), label: name.trim() };
      }
    } catch { /* no nvidia-smi / no NVIDIA GPU */ }

    // Linux integrated graphics (Intel Iris, AMD APU). They share system RAM,
    // so this only names the chip. The memory budget stays the RAM path below.
    if (gpu.type === 'none' && platform === 'linux') {
      try {
        const out = execSync('lspci', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString();
        const line = out.split('\n').find(l => /VGA compatible|3D controller|Display controller/i.test(l));
        const name = line ? line.replace(/^.*?: /, '').trim() : '';
        if (name) gpu = { type: 'igpu', vramGB: 0, label: `${name} (integrated)` };
      } catch { /* lspci missing — stay unlabeled */ }
    }

    // Windows fallback: AMD/Intel discrete GPUs have no nvidia-smi — query WMI.
    // (QVAC runs llama.cpp with Vulkan on Windows, so any Vulkan-capable GPU counts.)
    if (gpu.type === 'none' && platform === 'win32') {
      try {
        const out = execSync(
          'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json"',
          { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
        const info = JSON.parse(out);
        const name = (info.Name || '').trim();
        // AdapterRAM is uint32 — caps at 4 GB and lies for shared memory; treat it
        // as a floor and only trust it for discrete AMD/NVIDIA names.
        const vram = Math.max(0, Math.round((info.AdapterRAM || 0) / 1e9));
        const discrete = /radeon rx|radeon pro|arc a|geforce|quadro/i.test(name);
        if (name && discrete) {
          gpu = { type: 'gpu', vramGB: Math.max(vram, 4), label: name };
        } else if (name) {
          gpu = { type: 'igpu', vramGB: 0, label: `${name} (integrated)` };
        }
      } catch { /* PowerShell/WMI unavailable — stay CPU-only */ }
    }
  }

  // Usable memory budget for the model.
  let usableGB;
  if (gpu.type === 'apple')       usableGB = Math.round(totalRamGB * 0.6);   // unified memory, leave headroom
  else if (gpu.type === 'nvidia' || gpu.type === 'gpu') usableGB = Math.max(gpu.vramGB, Math.round(totalRamGB * 0.5));
  else                            usableGB = Math.round(totalRamGB * 0.5);   // CPU only / iGPU

  return { totalRamGB, platform, arch, gpu, usableGB };
}

/**
 * Small and big ends of one category that fit `usableGB`.
 * When nothing fits, both ends are the category's smallest model.
 * When only one fits, both ends are that model.
 */
function categoryEnds(names, usableGB) {
  const models = names.map(n => MODEL_BY_NAME.get(n)).filter(Boolean);
  const fitting = models.filter(m => usableGB >= m.minBudgetGB);
  const pool = fitting.length ? fitting : models.slice(0, 1);
  return { small: pool[0], big: pool[pool.length - 1] };
}

/**
 * Four categories. General Purpose, Image & Video, and Personal Agents each
 * have a small and a big model. Narrow AI is a specialty picker (Medicine,
 * Math, Coding, and the rest): each specialty then suggests its own small
 * and big model that fits this machine.
 * `options` is the flat card list (duplicate ends collapsed). The recommended
 * pick is General Purpose's small model when it fits, otherwise its big one.
 */
export function getModelOptions(hw = detectHardware()) {
  const decorate = (model, size, cat, domain) => ({
    ...model,
    tier: size,
    size,
    category: cat.id,
    categoryLabel: domain ? `${cat.label} · ${domain.label}` : cat.label,
    domain: domain ? domain.id : null,
    domainLabel: domain ? domain.label : null,
  });

  const categories = MODEL_CATEGORIES.map(cat => {
    if (cat.domains) {
      const domains = cat.domains.map(domain => {
        const ends = categoryEnds(domain.models, hw.usableGB);
        return {
          id: domain.id,
          label: domain.label,
          small: decorate(ends.small, 'small', cat, domain),
          big: decorate(ends.big, 'big', cat, domain),
        };
      });
      return {
        id: cat.id,
        label: cat.label,
        domains,
        // First specialty's ends, so callers that only read small/big still work.
        small: domains[0].small,
        big: domains[0].big,
      };
    }
    const ends = categoryEnds(cat.models, hw.usableGB);
    return {
      id: cat.id,
      label: cat.label,
      small: decorate(ends.small, 'small', cat, null),
      big: decorate(ends.big, 'big', cat, null),
    };
  });

  const options = [];
  const seen = new Set();
  for (const cat of categories) {
    const models = cat.domains
      ? cat.domains.flatMap(d => [d.small, d.big])
      : [cat.small, cat.big];
    for (const model of models) {
      if (seen.has(model.name)) continue;
      seen.add(model.name);
      options.push(model);
    }
  }

  const general = categories.find(c => c.id === 'general');
  const recommended = (hw.usableGB >= general.small.minBudgetGB ? general.small : general.big).name;
  return { hardware: hw, categories, options, recommended };
}

/** One-line human summary of detected hardware. */
export function describeHardware(hw = detectHardware()) {
  const gpu = hw.gpu.type === 'none' ? 'no dedicated GPU' : hw.gpu.label + (hw.gpu.vramGB ? ` (~${hw.gpu.vramGB} GB)` : '');
  return `${hw.totalRamGB} GB RAM · ${gpu} · ~${hw.usableGB} GB usable for the model`;
}
