import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildFingerprint, evaluatorFingerprint } from '../evaluation/harness.mjs';
import { requireLoadedSimulatorBuild } from '../evaluation/simulator-build.mjs';
const root = process.cwd(), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const recorded = 'reports/ui-verifications/1791857016813.json';
const snapshotBytes = await readFile(recorded), snapshot = JSON.parse(snapshotBytes);
const builds = { candidateFingerprint: await buildFingerprint(), evaluatorFingerprint: await evaluatorFingerprint(),
  simulatorFingerprint: await requireLoadedSimulatorBuild() };
if (!snapshot.passed || !snapshot.unchanged || snapshot.cases.length !== 7 ||
  Object.entries(builds).some(([key, value]) => snapshot[key] !== value || snapshot.finalFingerprints[key] !== value))
  throw Error('UI snapshot is incomplete or not from current unchanged source.');
const folder = path.join(root, 'reports/federation-structural', 'seal-' + Date.now());
await mkdir(path.join(folder, 'source-reports'), { recursive: true });
const checks = [], checkSources = [], sourceReports = [], errors = [];
for (const row of snapshot.cases) {
  if (row.exitCode !== 0 || !Array.isArray(row.report?.checks) || row.report.errors?.length)
    throw Error('A recorded UI journey did not pass: ' + row.script);
  const sourcePath = path.resolve(root, row.reportPath);
  if (!sourcePath.startsWith(root + path.sep) || !sourcePath.endsWith('.json')) throw Error('Invalid UI evidence path.');
  const bytes = await readFile(sourcePath), current = JSON.parse(bytes);
  if (JSON.stringify(current) !== JSON.stringify(row.report)) throw Error('Raw UI evidence changed since global snapshot: ' + row.script);
  const retained = path.join(folder, 'source-reports', row.script.replace(/\.mjs$/, '.json'));
  await writeFile(retained, bytes);
  sourceReports.push({ script: row.script, originalPath: row.reportPath, retainedPath: retained,
    byteHash: sha(bytes), snapshotEmbeddedHash: sha(JSON.stringify(row.report)),
    sourceMatchesSnapshot: true, exitCode: row.exitCode, recordedAt: row.report.at,
    assertions: row.report.checks.length, scope: row.report.scope ?? row.report.note ?? null });
  for (const [index, check] of row.report.checks.entries()) {
    checkSources.push({ aggregateIndex: checks.length, script: row.script, sourceCheckIndex: index });
    checks.push(check);
  }
  errors.push(...(row.report.errors ?? []));
}
if (checks.length !== 113) throw Error('Unexpected aggregate check count; do not invent missing assertions.');
const aggregatePath = path.join(folder, 'ui-aggregate.json');
await writeFile(aggregatePath, JSON.stringify({ at: new Date().toISOString(), ...builds, passed: true,
  unchanged: true, checks, checkSources, errors, sourceReports,
  globalSnapshot: { path: recorded, byteHash: sha(snapshotBytes), passed: snapshot.passed,
    unchanged: snapshot.unchanged, cases: snapshot.cases.length },
  scope: 'Exact flattening of seven already executed UI reports. No new assertions, browser run, model call or human-comprehension claim.' }, null, 2));
const verification = path.resolve(root, 'reports/verifications/1791855737145.json'),
  benchmark = path.resolve(root, '../disaster-response-simulator/runs/benchmarks/candidate-1791857111452.json');
const sealPath = path.join(folder, 'seal.json');
await writeFile(sealPath, JSON.stringify({ at: new Date().toISOString(), ...builds,
  authorization: 'PENDING_ROOT_GO_FEDERATION', executionApproved: false,
  verification, verificationByteHash: sha(await readFile(verification)),
  ui: { path: aggregatePath, byteHash: sha(await readFile(aggregatePath)), ...builds, passed: true },
  engineBenchmark: benchmark, engineBenchmarkByteHash: sha(await readFile(benchmark)),
  note: 'Evidence is ready; no structural episode is authorized or started until parent ROOT_GO_FEDERATION. Benchmark is referenced by exact timestamp, never silently copied from latest.' }, null, 2));
await copyFile(new URL(import.meta.url), path.join(folder, 'prepare-seal.mjs'));
console.log(JSON.stringify({ sealPath, aggregatePath, checks: checks.length, sourceReports: sourceReports.length,
  executionApproved: false, builds }, null, 2));
