#!/usr/bin/env node
/**
 * Submit a PAID (signed) + ENCRYPTED compute job directly to a miner's /job
 * endpoint — no bootnode job board involved. The miner gossips it to the
 * network as 'new-job'; peers race it bounded to RACE_REPLICAS concurrent
 * workers via 'job-claim-intent' (see miner-node.js _startJob), and whichever
 * one finishes first gossips 'job-result' back. Settlement still happens on
 * THIS miner (it escrowed the fee), once it learns the winning result.
 *
 * Unlike the board, the payment proof here is bound to a SPECIFIC miner's
 * address (computeJobPaymentHash includes minerAddress) — you are escrowing
 * through this one node, even though any of up to RACE_REPLICAS peers may be
 * the one that actually computes it.
 *
 * Usage:
 *   node scripts/submit-direct-job.js
 *   MINER=http://localhost:3456 WALLET=dai4bc7... BUDGET=1000000 PROMPT='hi' \
 *     node scripts/submit-direct-job.js
 *   node scripts/submit-direct-job.js --dry     # sign + verify, do NOT post
 *   node scripts/submit-direct-job.js --plain   # unencrypted (cleartext reply)
 */

import crypto from 'crypto';
import { WalletManager, Wallet } from '../src/wallet/wallet.js';
import { seal, open, isEnvelope } from '../src/security/chat-crypto.js';

const MINER   = process.env.MINER || process.env.BOARD || 'http://localhost:3456';
const BUDGET  = parseInt(process.env.BUDGET || '1000000', 10);   // μDAI (maxBudget)
const PROMPT  = process.env.PROMPT;
const DRY     = process.argv.includes('--dry');
const PLAIN   = process.argv.includes('--plain');
const POLL_MS = parseInt(process.env.POLL_MS || '2000', 10);
const POLL_MAX = parseInt(process.env.POLL_MAX || '60', 10);      // ~2 min at 2s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirrors miner-node.js's computeJobPaymentHash exactly (not exported — this is
// the same "KEEP IN SYNC with every SDK signer" contract the mobile wallet
// follows in dev/wallet/src/services/signing.js buildJobPaymentTx).
function computeJobPaymentHash({ jobId, requesterAddress, minerAddress, amount, nonce, currency }) {
  const payload = (currency && currency !== 'DAI')
    ? { jobId, requesterAddress, minerAddress, amount, nonce, currency }
    : { jobId, requesterAddress, minerAddress, amount, nonce };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// 1. Load a local wallet (unseals the on-disk key). Pick WALLET=... or the first one.
const wm = new WalletManager();
const addr = process.env.WALLET || wm.listWallets()[0];
if (!addr) { console.error('No wallet found in ~/.dai-miner/wallets'); process.exit(1); }
const wallet = wm.loadWallet(addr);
if (!wallet?.signingPrivateKey) {
  console.error(wallet && wm.hasSealedKey(addr)
    ? `Wallet ${addr} is encrypted with a key this machine does not have (set DAI_WALLET_KEY to the backup key) — can't sign.`
    : `Wallet ${addr} has no signing private key (externally registered?) — can't sign.`);
  process.exit(1);
}

// 1b. Derive this wallet's X25519 encryption keypair.
wallet.ensureEncryptionKeys();
const encPub  = wallet.encryptionPublicKey;
const encPriv = wallet.getEncryptionPrivateKey();

const base = MINER.replace(/\/$/, '');

// 2. Who are we paying? The payment proof is bound to this specific miner's
//    address — ask it who it is rather than hardcoding.
const info = await fetch(`${base}/api/miner/info`).then((r) => r.json()).catch(() => null);
if (!info?.minerAddress) {
  console.error(`Could not reach ${base}/api/miner/info — is a miner node running there? (not the bootnode's board port)`);
  process.exit(1);
}
const minerAddress = info.minerAddress;

// 3. Build the job + its signed payment proof.
const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const nonce = wallet.nonce || 0;
const amount = BUDGET;

const txHash    = computeJobPaymentHash({ jobId, requesterAddress: wallet.address, minerAddress, amount, nonce });
const signature = wallet.sign(txHash);

const job = {
  id: jobId,
  type: 'compute',
  model: 'qwen3-0.6b',
  payload: {
    prompt: PROMPT,
    ...(PLAIN ? {} : { requesterEncryptionPublicKey: encPub }),
  },
  requesterAddress: wallet.address,
  maxBudget: amount,
  paymentTx: { txHash, signature, nonce },
  createdAt: Date.now(),
};

// 4. Self-check before sending.
const ok = Wallet.verifySignature(wallet.signingPublicKey, txHash, signature);
console.log(`Miner         : ${base} (${minerAddress})`);
console.log(`Wallet        : ${wallet.address}`);
console.log(`Job           : ${jobId} (type=${job.type}, budget=${amount} μDAI, nonce=${nonce})`);
console.log(`Encryption    : ${PLAIN ? 'OFF (--plain)' : 'ON'}${PLAIN ? '' : `  encPubKey=${encPub}`}`);
console.log(`Prompt        : ${PROMPT}`);
console.log(`Payment proof : ${ok ? 'verifies ✓' : 'FAILED ✗'}`);
if (!ok) process.exit(1);

if (!PLAIN) {
  const demo = seal(encPub, PROMPT);
  console.log(`\nSealed form (what lands on-chain), e.g. for the prompt:`);
  console.log(`  ${JSON.stringify({ v: demo.v, alg: demo.alg, epk: demo.epk.slice(0, 16) + '…', iv: demo.iv, ct: demo.ct.slice(0, 24) + '…' })}`);
  console.log(`  local unseal check → "${open(demo, encPriv)}"`);
}

if (DRY) { console.log('\n--dry: signed job (not posted):\n' + JSON.stringify(job, null, 2)); process.exit(0); }

// 5. Submit directly to the miner's /job endpoint (not /jobboard/submit).
const res  = await fetch(`${base}/job`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(job),
});
const body = await res.json().catch(() => ({}));
console.log(`\nPOST ${base}/job → ${res.status}`);
console.log(JSON.stringify(body, null, 2));
if (!body.accepted) process.exit(res.ok ? 0 : 1);

// 6. Poll for the result (this miner, or whichever peer racer finished first and
//    whose 'job-result' it adopted), then decrypt it.
console.log(`\nPolling ${base}/job/${jobId}/result (every ${POLL_MS}ms)…`);
let result = null;
for (let i = 0; i < POLL_MAX; i++) {
  await sleep(POLL_MS);
  const sres = await fetch(`${base}/job/${jobId}/result`).catch(() => null);
  const sbody = sres ? await sres.json().catch(() => ({})) : {};
  if (sres?.status === 200 && sbody && (sbody.verdict !== undefined || sbody.profile !== undefined)) {
    result = sbody;
    break;
  }
  process.stdout.write(`\r  [${i + 1}/${POLL_MAX}] status=${sbody.status || 'pending'}   `);
}
console.log('');

if (!result) { console.log('No result within the poll window — try increasing POLL_MAX.'); process.exit(0); }

// 7. Show what's there — decrypt the sealed reply (or print cleartext).
const profile = result.profile || {};
console.log(`\n─────────── RESULT (model=${profile.model || result.modelUsed || '?'}) ───────────`);
if (isEnvelope(profile.replyCipher)) {
  console.log(`Reply was ENCRYPTED (profile.replyCipher). Decrypting with wallet X25519 key…\n`);
  try {
    console.log(open(profile.replyCipher, encPriv));
  } catch (e) {
    console.error(`Decryption failed: ${e.message}`);
    console.error(`(raw envelope: ${JSON.stringify(profile.replyCipher)})`);
  }
} else if (profile.computeOutput != null) {
  console.log(`Reply was CLEARTEXT (profile.computeOutput):\n`);
  console.log(profile.computeOutput);
} else {
  console.log('No compute output in result:\n' + JSON.stringify(result, null, 2));
}
console.log(`──────────────────────────────────────────────────────────────`);
