import { createHash } from 'node:crypto';
import { access, mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Offline orchestration only. Importing this file never imports a simulator,
// starts a server, executes a world or contacts a model provider.
export const finite = x => typeof x === 'number' && Number.isFinite(x);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const hashKeys = ['candidateFingerprint', 'evaluatorFingerprint', 'simulatorBuild'];
const valueOf = (row, key) => key === 'simulatorBuild'
  ? row?.simulatorBuild ?? row?.simulatorFingerprint ?? row?.engineBuild : row?.[key];

export function validateProbeGate(freeze, current) {
  for (const key of hashKeys) {
    if (!/^[a-f0-9]{64}$/.test(valueOf(freeze, key) ?? '') || valueOf(freeze, key) !== current[key])
      throw Error('Freeze mismatch: ' + key);
  }
  const v = freeze.verification, u = freeze.ui;
  if (v?.passed !== true || [v.candidateChanged, v.evaluatorChanged, v.simulatorChanged].some(x => x !== false) ||
    !Array.isArray(v.cases) || !v.cases.length || v.cases.some(c => c.exitCode !== 0 || c.signal != null))
    throw Error('Successful unchanged full verification required.');
  for (const name of ['platform-tests', 'simulator-tests']) {
    const result = v.cases.find(c => c.name === name)?.tests;
    if (!result || !(result.tests > 0) || result.pass !== result.tests || result.fail !== 0 || result.cancelled !== 0)
      throw Error('Missing or failed full suite: ' + name);
  }
  if (u?.passed !== true || u.unchanged !== true || !Array.isArray(u.cases) || !u.cases.length ||
    u.cases.some(c => c.exitCode !== 0 || c.signal != null)) throw Error('Successful unchanged UI seal required.');
  const finalV = { candidateFingerprint: v.candidateFinalFingerprint, evaluatorFingerprint: v.evaluatorFinalFingerprint,
    simulatorBuild: v.simulatorFinalFingerprint };
  for (const row of [v, finalV, u, u.finalFingerprints]) for (const key of hashKeys)
    if (valueOf(row, key) !== current[key]) throw Error('Gate proof belongs to another build: ' + key);
  return true;
}

export function exactPhysicalClock(operation, horizonMs) {
  return finite(operation?.createdAt) && operation.createdAt >= 0 && finite(operation?.times?.service) &&
    operation.times.service >= operation.createdAt && finite(horizonMs) && operation.times.service <= horizonMs;
}

export async function archiveProbe({ names, tag, plan, root = '.' }) {
  const rows = await Promise.all(names.map(async name => {
    const bytes = await readFile(resolve(root, '.local', name));
    return { name, bytes, sha256: sha256(bytes) };
  }));
  const runnerSha256 = rows[0].sha256, folder = resolve(root, 'reports/measurement-runners', tag + '-' + runnerSha256.slice(0,16));
  await mkdir(folder, { recursive: true });
  const writeExact = async (name, bytes) => {
    const file = resolve(folder, name); let old = null;
    try { old = await readFile(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (old && sha256(old) !== sha256(bytes)) throw Error('Immutable archive differs; never overwrite: ' + name);
    if (!old) await writeFile(file, bytes, { flag: 'wx' });
  };
  for (const row of rows) await writeExact(row.name, row.bytes);
  const planBytes = Buffer.from(JSON.stringify(plan, null, 2) + '\n');
  await writeExact('plan.json', planBytes);
  await writeExact('manifest.json', Buffer.from(JSON.stringify({ state: 'prepared_not_launched',
    runnerSha256, planSha256: sha256(planBytes), providerCallsMadeDuringPreparation: 0,
    files: rows.map(({ name, sha256, bytes }) => ({ name, sha256, bytes: bytes.length })),
    note: 'Archive records prepared code and declared protocol only. No scenario, throughput, accuracy or latency result is implied.' }, null, 2) + '\n'));
  return { folder, runnerSha256, planSha256: sha256(planBytes) };
}

export async function exists(file) { try { await access(file); return true; } catch (e) { if (e.code !== 'ENOENT') throw e; return false; } }
export async function acquireProbeLock(file, info) {
  await mkdir(dirname(resolve(file)), { recursive: true });
  const handle = await open(file, 'wx'); await handle.writeFile(JSON.stringify(info)); await handle.close();
  return async () => {
    const content = JSON.parse(await readFile(file, 'utf8'));
    if (content.nonce !== info.nonce) throw Error('Study lock identity changed; preserve it.');
    await unlink(file);
  };
}
