import { describe, it, expect } from 'vitest';
import { shapeArgValue, argsMayBeEmpty } from '../src/ai/mcp-arg-value.js';
import { resolveTaskArgs } from '../src/ai/task-cascade.js';

/**
 * "what is my balance?" used to send the ENTIRE question as the `address`
 * argument to get_wallet_balance (shapeArgValue had no case for 'address',
 * so it fell through to `default: return clean`), and a message that did
 * contain a real dai… address never had it isolated either — both landed
 * the lookup on a garbage key and always came back empty/zero.
 */
describe('shapeArgValue("address", …)', () => {
  it('extracts a dai + 40-hex-char address embedded in a sentence', () => {
    const addr = 'dai' + '5ad01caf3cff882dcf0fab40c767d776b2699c51';
    expect(shapeArgValue('address', `what is the ${addr} balance`)).toBe(addr);
  });

  it('lowercases an address typed in mixed case', () => {
    const addr = 'dai5AD01CAF3cff882dcf0fab40c767d776b2699c51';
    expect(shapeArgValue('address', `check ${addr}`)).toBe(addr.toLowerCase());
  });

  it('returns null — not the whole sentence — when no address is present', () => {
    expect(shapeArgValue('address', 'what is my balance?')).toBeNull();
  });

  it('is listed as a key a tool may run without, like ip', () => {
    expect(argsMayBeEmpty(['address'])).toBe(true);
  });
});

describe('resolveTaskArgs for an address-only tool', () => {
  const task = {
    segment: 'what is my balance?',
    argKeys: ['address'],
    inputSchema: { type: 'object', properties: { address: { type: 'string' } } },
  };

  it('resolves to {} instead of being skipped, so the node answers for its own wallet', () => {
    expect(resolveTaskArgs(task, {}, 'what is my balance?')).toEqual({});
  });

  it('still fills address when the message names one explicitly', () => {
    const addr = 'dai' + 'a'.repeat(40);
    const withAddr = { ...task, segment: `balance of ${addr}` };
    expect(resolveTaskArgs(withAddr, {}, withAddr.segment)).toEqual({ address: addr });
  });
});
