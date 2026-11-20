#!/usr/bin/env node
/**
 * patch-qvac-electron.cjs — patch node_modules so QVAC's bare worker can start
 * inside a packaged Electron app instead of crashing the main process.
 *
 * Two upstream defects. As of @qvac/sdk 0.24 the worker is spawned by
 * `bare-sidecar` (bare-runtime is gone):
 *
 * 1. `bare-sidecar/lib/bare.js` resolves the bare binary via require.asset.
 *    In a packaged app that is the VIRTUAL `app.asar` path. Electron's fs
 *    shim redirects *reads* to the `app.asar.unpacked` copy (which
 *    asarUnpack ships), so the pre-flight `fs.accessSync` passes — but
 *    `child_process.spawn` is not asar-aware, so the spawn fails with an
 *    async ENOENT:
 *      "Error: spawn …\app.asar\node_modules\…\bare.exe ENOENT"
 *    Fix: rewrite `app.asar` → `app.asar.unpacked` in the binary path
 *    before spawning.
 *
 * 2. `bare-sidecar` never attaches an "error" listener to the spawned
 *    process. `spawn` reports ENOENT asynchronously via that event; with no
 *    listener Node re-throws it as an uncaught exception, which in Electron
 *    is the fatal "A JavaScript error occurred in the main process" dialog.
 *    Fix: emit "error" on the sidecar. bare-stow-host already listens and
 *    rejects the worker ready promise.
 *
 * Idempotent. Run with --strict (the build:electron:* scripts do) to fail the
 * build when an anchor can't be found — e.g. after an SDK upgrade changed the
 * file — so we never ship an installer that crashes on start. Without
 * --strict (postinstall) missing anchors only warn.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NM = path.join(__dirname, '..', 'node_modules');
const strict = process.argv.includes('--strict');

let failed = false;

function fail(msg) {
  failed = true;
  const tag = strict ? 'ERROR' : 'warning';
  console[strict ? 'error' : 'warn'](`[patch-qvac-electron] ${tag}: ${msg}`);
}

function patchFile(relPath, { applied, anchor, replacement }) {
  const file = path.join(NM, relPath);
  if (!fs.existsSync(file)) {
    fail(`${relPath} not found — is the package installed?`);
    return;
  }
  const src = fs.readFileSync(file, 'utf8');
  if (applied(src)) {
    console.log(`[patch-qvac-electron] ${relPath} already patched`);
    return;
  }
  if (!src.includes(anchor)) {
    fail(`anchor not found in ${relPath} — upstream changed, re-check the patch`);
    return;
  }
  fs.writeFileSync(file, src.replace(anchor, replacement));
  console.log(`[patch-qvac-electron] patched ${relPath}`);
}

// bare-sidecar: spawn the unpacked binary, and surface spawn errors on the
// sidecar so the SDK's ready promise rejects instead of killing Electron.
patchFile('bare-sidecar/index.js', {
  applied: (src) => src.includes('app.asar.unpacked') && src.includes('DAI patch: spawn error'),
  anchor:
    '    this._process = spawn(bare, [entry, ...args], {\n' +
    '      detached: opts.detached,\n' +
    "      stdio: [...stdio, 'overlapped']\n" +
    '    })\n' +
    '\n' +
    "    this._process.on('exit', this._onexit.bind(this)).on('close', this._onclose.bind(this))\n",
  replacement:
    '    // DAI patch: Electron cannot spawn a binary at an app.asar virtual path\n' +
    '    // (only execFile is asar-aware); asarUnpack ships the real file under\n' +
    '    // app.asar.unpacked, so point the spawn there.\n' +
    "    const bareBin = String(bare).replace(/\\bapp\\.asar(?=[\\\\/])/, 'app.asar.unpacked')\n" +
    '    this._process = spawn(bareBin, [entry, ...args], {\n' +
    '      detached: opts.detached,\n' +
    "      stdio: [...stdio, 'overlapped']\n" +
    '    })\n' +
    '\n' +
    '    // DAI patch: spawn error — ENOENT is async; without a listener it\n' +
    '    // kills the Electron main process. bare-stow-host rejects on this.\n' +
    "    this._process.on('error', (error) => {\n" +
    "      this.emit('error', error)\n" +
    '    }).on(\'exit\', this._onexit.bind(this)).on(\'close\', this._onclose.bind(this))\n',
});

if (failed && strict) {
  console.error('[patch-qvac-electron] aborting build: shipping unpatched would crash packaged apps on QVAC start');
  process.exit(1);
}
