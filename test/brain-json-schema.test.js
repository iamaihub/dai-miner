/**
 * Real structured output (Phase 0): jsonSchemaForKeys builds the grammar
 * qvacModels.chat passes to QVAC's responseFormat, replacing the old
 * "ask nicely for JSON" system-prompt trick. extractJSON stays as a defensive
 * fallback for a generation that gets cut off mid-object — covered separately
 * here since it's the other half of evaluatorChatJSON/learnerChatJSON's
 * resilience.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { jsonSchemaForKeys, extractJSON } = require('../src/checker/utils/brain.js');

describe('jsonSchemaForKeys', () => {
  it('defaults a flat array of keys to string-typed required properties', () => {
    const { schema } = jsonSchemaForKeys(['insight']);
    expect(schema).toEqual({
      type: 'object',
      properties: { insight: { type: 'string' } },
      required: ['insight'],
      additionalProperties: true,
    });
  });

  it('uses the caller-supplied type for each key in map form', () => {
    const { schema } = jsonSchemaForKeys({
      verdict: { type: 'string', enum: ['HUMAN', 'AI', 'UNCERTAIN'] },
      confidence: { type: 'number' },
    });
    expect(schema.properties.verdict).toEqual({ type: 'string', enum: ['HUMAN', 'AI', 'UNCERTAIN'] });
    expect(schema.properties.confidence).toEqual({ type: 'number' });
    expect(schema.required).toEqual(['verdict', 'confidence']);
  });

  it('supports a nullable field (routeMessage.skillId can legitimately be null)', () => {
    const { schema } = jsonSchemaForKeys({ skillId: { type: ['string', 'null'] } });
    expect(schema.properties.skillId).toEqual({ type: ['string', 'null'] });
  });

  it('always carries a name for the responseFormat.json_schema envelope', () => {
    const { name } = jsonSchemaForKeys(['x']);
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });
});

describe('extractJSON (defensive fallback, unchanged by Phase 0)', () => {
  it('parses a complete object', () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('recovers a truncated object by walking back to the last closing brace', () => {
    expect(extractJSON('{"a":1}{"b":2')).toEqual({ a: 1 });
  });

  it('returns null with no object in sight', () => {
    expect(extractJSON('not json at all')).toBeNull();
    expect(extractJSON('')).toBeNull();
  });
});
