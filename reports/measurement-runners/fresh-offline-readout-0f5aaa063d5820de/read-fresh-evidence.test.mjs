import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readFreshEvidence, evidenceMarkdown } from './read-fresh-evidence.mjs';

const hashes = { candidateFingerprint: 'c'.repeat(64), evaluatorFingerprint: 'e'.repeat(64), simulatorBuild: 'a'.repeat(64) };
async function fixture() {
  await mkdir('.local/readout-fixtures', { recursive: true });
  const root = await mkdtemp(resolve('.local/readout-fixtures/evidence-')), folder = resolve(root, 'reports/worlds');
  await mkdir(folder, { recursive: true });
  const freeze = resolve(root, 'freeze.json'); await save(freeze, hashes);
  return { root, folder, freeze };
}
const save = (file, x) => writeFile(file, JSON.stringify(x));
function episode(arm, seed, extra = {}) {
  return { arm, seed, scenario: 'synthetic-reader-validation', status: 'completed', errors: [], invariants: [],
    ...hashes, manifest: { engineBuild: hashes.simulatorBuild, contentVersion: 'readout-test', config: { seed, durationMs: 1000, fleet: 2 } },
    finalCandidateFingerprint: hashes.candidateFingerprint, finalEvaluatorFingerprint: hashes.evaluatorFingerprint, finalEngineBuild: hashes.simulatorBuild,
    protocol: { horizonMs: 1000, readMs: 30 }, corpus: { manifest: { seed, publicBytesHash: 'same' } },
    usage: [], costUsd: 0, chargedBudgetUsd: 0,
    metrics: { simulatedMs: 1000, services: { water: { unit: 'L', demand: 20, served: 10, pending: 10, overprovided: 0, uncoveredUnitMs: arm === 'B6' ? 500 : 1000 } },
      physical: { distanceM: 1000, fuelMl: 180 }, perCommunity: [
        { id: 'n1', type: 'water', quantity: 10, served: 10, createdAt: 0, firstServiceAt: arm === 'B6' ? 100 : 200, sufficientServiceAt: arm === 'B6' ? 400 : 600, deadline: 700, silent: true, remote: false },
        { id: 'n2', type: 'water', quantity: 10, served: 0, createdAt: 0, firstServiceAt: null, completedAt: null, deadline: 900, silent: false, remote: true },
        { id: 'n3', type: 'water', quantity: 10, served: 0, createdAt: 0, firstServiceAt: null, completedAt: null, deadline: 1200, silent: false, remote: false },
      ] }, ...extra };
}
async function protocol(f, seeds = 1, arms = ['B5', 'B6']) {
  await save(resolve(f.folder, 'protocol.json'), { seedPrefix: 'test-', seeds, arms, scenarios: ['synthetic-reader-validation'], episodeBudgetUsd: .15 });
}
test('first useful and sufficient clocks retain unresolved needs and exclude future deadline windows', async () => {
  const f = await fixture(); await protocol(f);
  await save(resolve(f.folder, 'B5.json'), episode('B5', 'test-01'));
  await save(resolve(f.folder, 'B6.json'), episode('B6', 'test-01'));
  const r = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze });
  assert.equal(r.worlds.length, 2);
  const w = r.worlds.find(w => w.arm === 'B6');
  assert.equal(w.physical.clocks.firstUseful.restrictedMeanMs, 700);
  assert.equal(w.physical.clocks.sufficient.restrictedMeanMs, 800);
  assert.equal(w.physical.clocks.sufficient.rightCensored, 2);
  assert.deepEqual([w.physical.deadlineCoverage.met, w.physical.deadlineCoverage.eligible, w.physical.deadlineCoverage.futureWindow], [1, 2, 1]);
  assert.equal(w.physical.subgroups.remote.cohorts.true.rightCensored, 1);
  assert.equal(w.physical.vehicleKm, 1); assert.equal(w.physical.fuelLitres, .18);
  assert.equal(r.comparisons[0].benefitClaimPermitted, true);
  assert.equal(r.comparisons[0].diagnosticOnlyWhenIncomplete.nativeDeficits.water.reduction, .5);
  assert.equal(r.comparisons[0].diagnosticOnlyWhenIncomplete.sufficientRmst.ci95, null);
});
test('all declared seeds retained; missing paid exception reserves cap, never drops adverse cohort', async () => {
  const f = await fixture(); await protocol(f, 2);
  await save(resolve(f.folder, 'B5-01.json'), episode('B5', 'test-01'));
  await save(resolve(f.folder, 'B6-01.json'), episode('B6', 'test-01'));
  await save(resolve(f.folder, 'B5-02.json'), episode('B5', 'test-02'));
  await save(resolve(f.folder, 'progress.json'), { missingOutcomes: [{ seed: 'test-02', arm: 'B6', scenario: 'synthetic-reader-validation', status: 'missing_after_exception', error: 'TIMEOUT', chargedBudgetUsd: .15 }] });
  const r = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze });
  assert.equal(r.counts.declared, 4); assert.equal(r.worlds.length, 4);
  const missing = r.worlds.find(w => w.status === 'missing_after_exception');
  assert.equal(missing.costs.providerCalls, null); assert.equal(missing.costs.totalProviderCostUsd, null);
  assert.equal(missing.costs.chargedBudgetUsd, .15); assert.equal(r.costs.missingOutcomeCapReserveUsd, .15);
  assert.equal(r.costs.totalProviderCostUsd, null); assert.equal(r.comparisons[0].benefitClaimPermitted, false);
  assert.equal(r.comparisons[0].comparablePairs, 1); assert.equal(r.comparisons[0].declaredPairs, 2);
});
test('provider failure/unknown cost survives physical completion and is not labeled a known zero', async () => {
  const f = await fixture(); await protocol(f);
  await save(resolve(f.folder, 'B5.json'), episode('B5', 'test-01'));
  await save(resolve(f.folder, 'B6.json'), episode('B6', 'test-01', { status: 'failed', errors: [{ code: 'PROVIDER_TIMEOUT' }],
    usage: [{ state: 'failed', error: 'TIMEOUT', model: 'actual-model', cost_usd: null, reserved_usd: .04, wall_ms: 3000 }], costUsd: 0, chargedBudgetUsd: .04 }));
  const r = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze });
  const failed = r.worlds.find(w => w.status === 'failed');
  assert.equal(failed.costs.knownCostSubtotalUsd, 0); assert.equal(failed.costs.totalProviderCostUsd, null);
  assert.equal(failed.costs.unknownCostCalls, 1); assert.equal(failed.costs.unknownCostReserveUsd, .04);
  assert.equal(failed.costs.providerWallTotalMs, 3000); assert.equal(r.comparisons[0].benefitClaimPermitted, false);
  assert.equal(r.worlds.find(w => w.arm === 'B5').costs.totalProviderCostUsd, 0);
  assert.match(evidenceMarkdown(r), /unknown/); assert.match(evidenceMarkdown(r), /blocked/);
});
test('same status but another engine, changed final hash or different unit is not a benefit comparison', async () => {
  for (const defect of ['engine', 'changed', 'unit']) {
    const f = await fixture(); await protocol(f);
    await save(resolve(f.folder, 'B5.json'), episode('B5', 'test-01'));
    const candidate = episode('B6', 'test-01');
    if (defect === 'engine') candidate.manifest.engineBuild = 'b'.repeat(64);
    if (defect === 'changed') candidate.finalCandidateFingerprint = 'd'.repeat(64);
    if (defect === 'unit') candidate.metrics.services.water.unit = 'gallons';
    await save(resolve(f.folder, 'B6.json'), candidate);
    const r = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze });
    assert.equal(r.comparisons[0].benefitClaimPermitted, false, defect);
    assert.equal(r.comparisons[0].comparablePairs, 0, defect);
  }
});
test('reader finds settled file before index checkpoint, declares unfinished paid world and honors explicit cap skip zero', async () => {
  const f = await fixture(), index = resolve(f.root, 'reports/index.json'), folder = 'reports/worlds';
  await save(resolve(f.folder, 'settled.json'), episode('B5', 'test-01'));
  await save(index, { profiles: [{ name: 'primary', folder, p: { seeds: 1, seedPrefix: 'test', arms: ['B5', 'B6', 'B9'], episodeBudgetUsd: .15 } }],
    runs: [{ folder, seed: 'test-01', arm: 'B9', status: 'not_launched_budget_cap', chargedBudgetUsd: 0 }] });
  const r = await readFreshEvidence({ primary: [index], freeze: f.freeze });
  assert.equal(r.worlds.length, 3); assert.equal(r.worlds.find(w => w.arm === 'B5').status, 'completed');
  assert.equal(r.worlds.find(w => w.arm === 'B6').costs.providerCalls, null);
  assert.equal(r.worlds.find(w => w.arm === 'B6').costs.chargedBudgetUsd, null);
  assert.equal(r.worlds.find(w => w.arm === 'B9').costs.totalProviderCostUsd, 0);
  assert.equal(r.worlds.find(w => w.arm === 'B9').costs.chargedBudgetUsd, 0);
  assert.equal(r.comparisons.every(c => !c.benefitClaimPermitted), true);
});
test('recovery cohort is reported separately from model semantic quality and actual human comprehension', async () => {
  const f = await fixture(), file = resolve(f.folder, 'report.json');
  const base = episode(null, 'test-01'); delete base.metrics;
  await save(file, { ...base, status: 'recovered', recoveryDurationMs: 300, recoveryCensored: false,
    results: { eligible: 20, closed: 18, retainedAttention: 2, dispositions: { semantic_receipt_unverified: 18 } },
    maxPendingSourceReviews: 6, sourceReviewReceipts: [{ id: 'p1', observedQueueWaitMs: null, censored: true }],
    localState: { pendingQueries: 0 }, cohortHash: 'received-cohort', timeline: [{ at: 100, pending: 20 }] });
  const r = await readFreshEvidence({ recovery: [file], freeze: f.freeze });
  assert.equal(r.worlds[0].recovery.retainedAttention, 2);
  assert.equal(r.worlds[0].recovery.sourceReviewWaits[0].observedQueueWaitMs, null);
  assert.equal(r.worlds[0].physical.clocks.firstUseful, null);
  assert.match(r.kpiEvidence.K23, /unmeasured/); assert.match(r.worlds[0].recovery.note, /does not establish/);
});
test('complete two seed comparison bootstraps worlds and keeps negative time improvement visible', async () => {
  const f = await fixture(); await protocol(f, 2);
  for (const seed of ['test-01', 'test-02']) for (const arm of ['B5', 'B6']) {
    const e = episode(arm, seed);
    if (arm === 'B6') e.metrics.perCommunity[0].sufficientServiceAt = 650;
    await save(resolve(f.folder, seed + '-' + arm + '.json'), e);
  }
  const r = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze }), c = r.comparisons[0].diagnosticOnlyWhenIncomplete.sufficientRmst;
  assert.equal(c.independentSeedWorlds, 2); assert.equal(c.reduction < 0, true); assert.equal(c.ci95.every(x => x < 0), true);
  assert.equal(r.comparisons[0].benefitClaimPermitted, true);
});
test('multiple outcomes for same declared seed cannot select a favorable one; repeated input never double-bills', async () => {
  const f = await fixture(); await protocol(f);
  const a = resolve(f.folder, 'B5.json'), b = resolve(f.folder, 'B6.json');
  await save(a, episode('B5', 'test-01')); await save(b, episode('B6', 'test-01'));
  await save(resolve(f.folder, 'second-B6.json'), episode('B6', 'test-01'));
  const r = await readFreshEvidence({ s19: [f.folder], extra: [a], freeze: f.freeze });
  assert.equal(r.worlds.length, 3); assert.equal(r.duplicateInputs.length, 1);
  assert.equal(r.comparisons[0].benefitClaimPermitted, false);
  assert.match(r.comparisons[0].blocked[0].reasons.join(','), /duplicate_world_outcomes/);
});
