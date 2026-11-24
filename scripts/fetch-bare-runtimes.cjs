#!/usr/bin/env node
/**
 * fetch-bare-runtimes.cjs — make sure the bare binaries a desktop build will
 * ship are present and executable.
 *
 * @qvac/sdk 0.24 spawns its worker through `bare-sidecar`, which vendors every
 * platform binary under node_modules/bare-sidecar/prebuilds/<platform-arch>/.
 * The old per-platform `bare-runtime-*` packages are gone. npm unpacks those
 * prebuilds as 0644 (they are not package `bin` entries). A packaged AppImage
 * is read-only, so the bit has to be set before electron-builder copies them.
 *
 * Usage: node scripts/fetch-bare-runtimes.cjs win32-x64 linux-arm64 …
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NM = path.join(__dirname, '..', 'node_modules');
const sidecarDir = path.join(NM, 'bare-sidecar');

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/fetch-bare-runtimes.cjs <platform-arch> [...]  e.g. win32-x64 linux-arm64 darwin-arm64');
  process.exit(1);
}

const metaPath = path.join(sidecarDir, 'package.json');
if (!fs.existsSync(metaPath)) {
  console.error('[bare-runtimes] node_modules/bare-sidecar is not installed');
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(metaPath, 'utf8')).version;

for (const target of targets) {
  if (!/^(darwin|linux|win32)-(x64|arm64)$/.test(target)) {
    console.error(`[bare-runtimes] Unknown target "${target}"`);
    process.exit(1);
  }
  const name = target.startsWith('win32-') ? 'bare.exe' : 'bare';
  const rel = path.join('bare-sidecar', 'prebuilds', target, name);
  const file = path.join(NM, rel);
  if (!fs.existsSync(file)) {
    console.error(`[bare-runtimes] missing ${rel} (bare-sidecar@${version})`);
    process.exit(1);
  }
  const mode = fs.statSync(file).mode;
  if ((mode & 0o111) === 0) {
    fs.chmodSync(file, 0o755);
    console.log(`[bare-runtimes] chmod 755 ${rel}`);
  } else {
    console.log(`[bare-runtimes] bare-sidecar@${version} ${rel} ready`);
  }
}
