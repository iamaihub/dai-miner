/**
 * Multi-device model pooling (QVAC SDK 0.21+ clustered inference over RPC).
 *
 * buildClusterModelConfig is the one piece of this that's pure — it just
 * shapes already-discovered peers into the modelConfig fields loadModel
 * expects, mirroring @qvac/sdk's own example. Everything else
 * (startRpcServer/discoverRpcServers/getRpcDeviceMap) needs the native addon,
 * same as loadModel/completion elsewhere in this file, so it isn't unit tested.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildClusterModelConfig } = require('../src/checker/utils/qvac-models.js');

describe('buildClusterModelConfig', () => {
  it('builds an equal-weight layer-split config for N peers', () => {
    const cfg = buildClusterModelConfig(
      ['10.0.0.2:50052', '10.0.0.3:50052'],
      ['rpc0', 'rpc1'],
    );
    expect(cfg).toEqual({
      device: 'gpu',
      'rpc-servers': '10.0.0.2:50052,10.0.0.3:50052',
      devices: 'rpc0,rpc1',
      'split-mode': 'layer',
      'tensor-split': '1,1',
    });
  });

  it('scales tensor-split to the peer count', () => {
    const cfg = buildClusterModelConfig(['a', 'b', 'c'], ['x', 'y', 'z']);
    expect(cfg['tensor-split']).toBe('1,1,1');
    expect(cfg['rpc-servers']).toBe('a,b,c');
  });

  it('returns null with no peers', () => {
    expect(buildClusterModelConfig([], [])).toBeNull();
    expect(buildClusterModelConfig(null, null)).toBeNull();
  });

  it('returns null when peers and device aliases are mismatched', () => {
    expect(buildClusterModelConfig(['a'], ['x', 'y'])).toBeNull();
    expect(buildClusterModelConfig(['a', 'b'], ['x'])).toBeNull();
  });
});
