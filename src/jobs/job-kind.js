/**
 * What kind of work a job is.
 *
 * Verdict is only the poh_network identity scan: poh_identity (builtin id
 * dai_identity) checking a wallet address or a web3 domain name.
 * Every other job is compute. A skill is a subprocess of compute, not a
 * peer job type — skillId stays on the job, type is compute.
 */

// Wallet addresses the identity checker accepts (EVM, Solana, Bitcoin, Tron, TON, Stellar).
const ADDRESS_RE = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}|T[1-9A-HJ-NP-Za-km-z]{33}|(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}|G[A-Z2-7]{55})$/;

// name.eth, assetux.bnb, foo.bar.eth. A single label is not a domain.
const DOMAIN_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/i;

// poh_identity is the name of this scan. The builtin skill id is dai_identity.
const IDENTITY_SKILL_IDS = new Set(['dai_identity', 'poh_identity']);

export function canonicalSkillId(skillId) {
  if (skillId === 'poh_identity') return 'dai_identity';
  return skillId || null;
}

export function isIdentitySkill(skillId) {
  return IDENTITY_SKILL_IDS.has(skillId);
}

/** Address or web3 domain the identity scan can actually run on. */
export function scanTarget(job) {
  const raw = job?.payload?.address ?? job?.address ?? job?.payload?.domain ?? job?.payload?.name;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s || null;
}

export function isAddressOrWeb3Domain(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s || s.length > 253) return false;
  return ADDRESS_RE.test(s) || DOMAIN_RE.test(s);
}

/**
 * True only when this job is poh_identity scanning an address or web3 domain.
 * An explicit type:'verdict' with that target is the scan API. A prompt, a
 * missing target, or any other skill is not a verdict.
 */
export function isIdentityScanJob(job) {
  if (!job || typeof job !== 'object') return false;
  if (job.type === 'cascade-task') return false;
  if (!isAddressOrWeb3Domain(scanTarget(job))) return false;
  const skillId = job.skillId || job.payload?.skillId;
  if (isIdentitySkill(skillId)) return true;
  return job.type === 'verdict';
}

/**
 * Canonical job for the board and the worker.
 * Identity scans stay type 'verdict'. Everything else that is not an internal
 * cascade task becomes type 'compute'. skillId is preserved (poh_identity
 * is stored as dai_identity).
 */
export function prepareJob(job) {
  if (!job || typeof job !== 'object') return job;
  const next = { ...job };
  const skillId = canonicalSkillId(next.skillId || next.payload?.skillId || null);
  if (skillId) next.skillId = skillId;
  if (next.type === 'cascade-task') return next;

  if (isIdentityScanJob(next)) {
    next.type = 'verdict';
    next.skillId = next.skillId || 'dai_identity';
    return next;
  }

  if (next.type !== 'compute') next.type = 'compute';
  return next;
}
