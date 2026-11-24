#!/usr/bin/env node
/**
 * Package the Electron app for this machine only.
 *
 * @qvac/sdk 0.24 embeds native addons for the hosts named at bundle time.
 * The linux-x64 fabric package has no build for any other host, so one
 * bundle cannot target Windows, macOS, and both Linux arches. CI runs this
 * once per runner; each runner publishes the installer that matches it.
 *
 * Usage: node scripts/build-desktop.cjs <mac|win|linux|all>
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const requested = process.argv[2];
const hostPlatform = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
const archFlag = process.arch === 'arm64' ? '--arm64' : process.arch === 'x64' ? '--x64' : null;

if (!requested || !['mac', 'win', 'linux', 'all'].includes(requested)) {
  console.error('Usage: node scripts/build-desktop.cjs <mac|win|linux|all>');
  process.exit(1);
}
if (!hostPlatform || !archFlag) {
  console.error(`[build-desktop] unsupported host ${process.platform}-${process.arch}`);
  process.exit(1);
}

const target = requested === 'all' ? hostPlatform : requested;
if (target !== hostPlatform) {
  console.error(`[build-desktop] this machine is ${process.platform}-${process.arch}. Refusing to build ${requested}: the worker bundle would be the wrong architecture.`);
  process.exit(1);
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

const host = `${process.platform}-${process.arch}`;
console.log(`[build-desktop] ${target} for ${host}`);
run(['scripts/fetch-bare-runtimes.cjs', host]);
run(['scripts/patch-qvac-electron.cjs', '--strict']);
run([path.join('node_modules', '@qvac', 'cli', 'dist', 'index.js'), 'bundle', 'sdk', '--no-install']);
run(['-e', "fs.rmSync('qvac/worker.bundle.js',{force:true})"]);
run([
  path.join('node_modules', 'electron-builder', 'cli.js'),
  { mac: '--mac', win: '--win', linux: '--linux' }[target],
  archFlag,
  '--publish',
  'never',
]);
