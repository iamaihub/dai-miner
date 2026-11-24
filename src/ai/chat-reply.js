/**
 * User-facing chat text. Tool and model payloads stay inside the cascade.
 * A reply is prose unless the user asked for a format (JSON, CSV, YAML, XML,
 * HTML, or a table).
 */

const FORMAT_WORD = '(json|csv|tsv|yaml|yml|xml|html|table)';
const REQUEST_RE = new RegExp(
  String.raw`\b(?:as|in|into|output|return|give(?:\s+me)?|respond(?:\s+with)?|reply(?:\s+with)?|format(?:\s+as)?|export(?:\s+(?:as|to))?|show(?:\s+me)?(?:\s+the)?)\s+(?:a\s+|the\s+|raw\s+|valid\s+|pretty\s+|only\s+|markdown\s+)?${FORMAT_WORD}\b`,
  'i',
);
const ONLY_RE = new RegExp(String.raw`\b${FORMAT_WORD}\s+only\b`, 'i');
const FENCE_RE = /```(json|csv|yaml|yml|xml|html)\b/i;

const SKIP_KEYS = new Set([
  'generationtime_ms', 'utc_offset_seconds', 'timezone_abbreviation', 'elevation',
]);

const WMO = {
  0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'foggy', 48: 'foggy',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow',
  80: 'rain showers', 81: 'rain showers', 82: 'heavy rain showers',
  95: 'a thunderstorm', 96: 'a thunderstorm', 99: 'a thunderstorm',
};

/** 'json' | 'csv' | 'tsv' | 'yaml' | 'xml' | 'html' | 'table' | null (prose). */
export function requestedReplyFormat(message) {
  const text = String(message || '');
  const hit = text.match(REQUEST_RE) || text.match(ONLY_RE) || text.match(FENCE_RE);
  if (!hit) return null;
  const word = hit[1].toLowerCase();
  return word === 'yml' ? 'yaml' : word;
}

function parseJsonish(text) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object') return value;
  } catch { /* not json */ }
  return null;
}

/**
 * The whole reply is a JSON value, one fenced JSON block, or the cascade
 * fallback of `**id**` plus a json fence (several of those joined by ---).
 * Mixed prose returns null so a real answer that quotes JSON is left alone.
 */
export function unwrapBareData(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const direct = parseJsonish(raw);
  if (direct) return direct;
  const fence = raw.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i);
  if (fence) {
    const inner = parseJsonish(fence[1].trim());
    if (inner) return inner;
  }
  const parts = raw.split(/\n\n---\n\n/);
  if (parts.length > 1 || /^\*\*[^*]+\*\*\s*\n```/.test(raw)) {
    const blocks = [];
    for (const part of parts) {
      const failed = part.match(/^\*\*([^*]+)\*\* failed: ([\s\S]+)$/);
      if (failed) {
        blocks.push({ error: failed[2].trim() });
        continue;
      }
      const fenced = part.match(/^\*\*([^*]+)\*\*\s*\n```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
      if (!fenced) return null;
      const parsed = parseJsonish(fenced[2].trim());
      if (!parsed) return null;
      blocks.push({ value: parsed });
    }
    return blocks.length ? { __blocks: blocks } : null;
  }
  return null;
}

function label(key) {
  return String(key).replace(/_/g, ' ');
}

function weatherNow(data) {
  const cw = data.current_weather;
  if (cw && cw.temperature != null) {
    return { temp: cw.temperature, code: cw.weathercode, wind: cw.windspeed };
  }
  const current = data.current;
  if (current && (current.temperature_2m != null || current.temperature != null)) {
    return {
      temp: current.temperature_2m ?? current.temperature,
      code: current.weather_code ?? current.weathercode,
      wind: current.wind_speed_10m ?? current.windspeed,
    };
  }
  return null;
}

function weatherProse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const now = weatherNow(data);
  const daily = data.daily;
  if (!now && !daily?.time?.length) return null;
  const place = data.place ? String(data.place) : '';
  const lines = [];
  if (now) {
    const cond = WMO[now.code] ? ` and ${WMO[now.code]}` : '';
    const wind = now.wind != null ? `, wind ${now.wind} km/h` : '';
    const where = place ? `In ${place}` : 'Right now';
    lines.push(`${where}, it is ${now.temp}°C${cond}${wind}.`);
  } else if (place) {
    lines.push(place);
  }
  if (daily?.time?.length) {
    const n = Math.min(daily.time.length, 5);
    lines.push(now ? 'Coming days:' : 'Forecast:');
    for (let i = 0; i < n; i++) {
      const hi = daily.temperature_2m_max?.[i];
      const lo = daily.temperature_2m_min?.[i];
      const rain = daily.precipitation_sum?.[i];
      const cond = WMO[daily.weathercode?.[i]] || '';
      const bits = [daily.time[i]];
      if (hi != null || lo != null) bits.push(`${lo ?? '–'}–${hi ?? '–'}°C`);
      if (cond) bits.push(cond);
      if (rain != null) bits.push(`${rain} mm rain`);
      lines.push(`- ${bits.join(', ')}`);
    }
  }
  return lines.join('\n');
}

export function proseFromValue(value, depth = 0) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value.__blocks) {
    return value.__blocks.map(block => (
      block.error ? block.error : proseFromValue(block.value, 0)
    )).filter(Boolean).join('\n\n');
  }
  if (depth === 0) {
    const weather = weatherProse(value);
    if (weather) return weather;
  }
  if (Array.isArray(value)) {
    if (!value.length) return 'None.';
    return value.slice(0, 12).map(item => {
      const line = proseFromValue(item, depth + 1);
      return `- ${line.replace(/\n/g, '\n  ')}`;
    }).join('\n');
  }
  const entries = Object.entries(value).filter(([key, item]) => (
    item != null && item !== '' && !SKIP_KEYS.has(key)
  ));
  if (!entries.length) return 'No details came back.';
  const lines = [];
  const scalars = [];
  const nested = [];
  for (const [key, item] of entries) {
    if (item && typeof item === 'object') nested.push([key, item]);
    else scalars.push(`**${label(key)}:** ${item}`);
  }
  if (scalars.length) lines.push(scalars.map(line => `- ${line}`).join('\n'));
  for (const [key, item] of nested.slice(0, 6)) {
    lines.push(`**${label(key)}**\n${proseFromValue(item, depth + 1)}`);
  }
  return lines.join('\n\n');
}

function cell(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function rowsOf(value) {
  if (Array.isArray(value)) {
    if (value.every(row => row && typeof row === 'object' && !Array.isArray(row))) return value;
    return null;
  }
  if (value && typeof value === 'object' && !value.__blocks) return [value];
  return null;
}

function toDelimited(value, sep) {
  const rows = rowsOf(value);
  if (!rows) return proseFromValue(value);
  const keys = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !SKIP_KEYS.has(key))))];
  const esc = (item) => {
    const text = cell(item);
    return /[",\n\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [keys.join(sep), ...rows.map(row => keys.map(key => esc(row[key])).join(sep))].join('\n');
}

function toTable(value) {
  const rows = rowsOf(value);
  if (!rows) return proseFromValue(value);
  const keys = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !SKIP_KEYS.has(key) && (row[key] == null || typeof row[key] !== 'object'))))];
  if (!keys.length) return proseFromValue(value);
  const head = `| ${keys.join(' | ')} |`;
  const rule = `| ${keys.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${keys.map(key => cell(row[key]).replace(/\|/g, '\\|')).join(' | ')} |`);
  return [head, rule, ...body].join('\n');
}

function toYaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value.map(item => {
      if (item && typeof item === 'object') return `${pad}-\n${toYaml(item, indent + 1)}`;
      return `${pad}- ${toYaml(item)}`;
    }).join('\n');
  }
  return Object.entries(value).map(([key, item]) => {
    if (item && typeof item === 'object') return `${pad}${key}:\n${toYaml(item, indent + 1)}`;
    return `${pad}${key}: ${toYaml(item)}`;
  }).join('\n');
}

function toXml(value, tag = 'reply') {
  const name = String(tag).replace(/[^A-Za-z0-9_-]/g, '') || 'item';
  if (value == null || typeof value !== 'object') {
    return `<${name}>${String(value ?? '').replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))}</${name}>`;
  }
  if (Array.isArray(value)) return value.map(item => toXml(item, 'item')).join('\n');
  const inner = Object.entries(value).map(([key, item]) => toXml(item, key)).join('');
  return `<${name}>${inner}</${name}>`;
}

function toHtml(value) {
  const text = proseFromValue(value);
  return text.split('\n').map(line => `<p>${line.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))}</p>`).join('\n');
}

/**
 * Final chat string. Bare JSON becomes prose, or the format the user named.
 * A reply that is already prose is returned unchanged.
 */
export function presentChatReply(userMessage, reply) {
  if (reply == null) return reply;
  const text = String(reply).trim();
  if (!text) return text;
  const data = unwrapBareData(text);
  if (!data) return text;
  const format = requestedReplyFormat(userMessage);
  if (format === 'json') return text;
  if (format === 'csv') return toDelimited(data, ',');
  if (format === 'tsv') return toDelimited(data, '\t');
  if (format === 'yaml') return toYaml(data);
  if (format === 'xml') return toXml(data);
  if (format === 'html') return toHtml(data);
  if (format === 'table') return toTable(data);
  return proseFromValue(data);
}

/** Rewrite computeOutput / nlResponse on a job profile before the UI reads it. */
export function presentProfile(prompt, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const next = { ...profile };
  let changed = false;
  if (typeof next.computeOutput === 'string') {
    const shown = presentChatReply(prompt, next.computeOutput);
    if (shown !== next.computeOutput) { next.computeOutput = shown; changed = true; }
  }
  if (typeof next.nlResponse === 'string') {
    const shown = presentChatReply(prompt, next.nlResponse);
    if (shown !== next.nlResponse) { next.nlResponse = shown; changed = true; }
  }
  return changed ? next : profile;
}

export function jobPrompt(job) {
  const payload = job?.payload || {};
  return payload.prompt || payload.question || payload.message || job?.prompt || '';
}
