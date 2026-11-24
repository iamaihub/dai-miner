#!/usr/bin/env node
'use strict';

/**
 * electron-builder afterPack hook.
 *
 * 1) Copy the QVAC 0.24 worker bundle (qvac/worker/) into
 *    app.asar.unpacked/qvac/worker/ on every platform. The SDK looks there
 *    for index.js + index.bundle. qvac/ stays out of the asar file list:
 *    packing it both into the asar and asarUnpack double-hardlinks the same
 *    files and fails CI on Linux/mac with EEXIST. Bare needs the worker on a
 *    real filesystem path next to unpacked node_modules so deps resolve.
 *
 * 2) On macOS: ad-hoc codesign the .app (--deep) so arm64 Gatekeeper does not
 *    hard-block with the non-bypassable "malware" dialog.
 *
 * Configured in package.json: build.afterPack = "scripts/afterPack.cjs"
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

function copyQvacWorker(context) {
  const resourcesDir =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');

  const destDir = path.join(resourcesDir, 'app.asar.unpacked', 'qvac', 'worker');
  const workerSrc = path.join(ROOT, 'qvac', 'worker');
  for (const name of ['index.js', 'index.bundle']) {
    if (!fs.existsSync(path.join(workerSrc, name))) {
      throw new Error(`[afterPack] qvac/worker/${name} is missing. Bundle with \`qvac bundle sdk\` on this machine before packaging.`);
    }
  }
  fs.cpSync(workerSrc, destDir, { recursive: true });
  console.log(`[afterPack] qvac worker → ${path.relative(context.appOutDir, destDir)}`);
}

function adHocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.platform !== 'darwin') {
    console.warn('[afterPack] Cannot ad-hoc sign: codesign unavailable (not on macOS). The resulting .app will be unsigned.');
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn('[afterPack] .app bundle not found, skipping ad-hoc signing');
    return;
  }

  console.log('[afterPack] Ad-hoc signing .app bundle (--deep):', appPath);
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    console.log('[afterPack] ✓ Ad-hoc signed bundle (--deep)');
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    console.error(`[afterPack] ERROR signing .app bundle: ${stderr}`);
    throw new Error(`Ad-hoc signing failed: ${stderr}`);
  }

  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    console.log('[afterPack] ✓ Signature verified');
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    console.warn(`[afterPack] Verification warning: ${stderr}`);
  }
}

module.exports = async function afterPack(context) {
  copyQvacWorker(context);
  adHocSignMac(context);
};
