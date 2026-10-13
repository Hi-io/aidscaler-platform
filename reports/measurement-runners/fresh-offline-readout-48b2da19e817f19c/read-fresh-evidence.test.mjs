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
test('K09 reads separate occupied-capacity integrals and measured zero; no unmeasured labor is inferred', async () => {
  const f = await fixture(); await protocol(f);
  const e = episode('B6', 'test-01');
  e.metrics.utilization = { available: true, vehicleCommittedMs: 7200000, vehicleMovingMs: 1800000, vehicleWaitingMs: 3600000,
    vehicleBlockedMs: 0, staffCommittedPersonMs: 18000000, staffTransitPersonMs: 3600000, staffFieldWorkPersonMs: 7200000,
    vehicleCommittedHours: 2, vehicleMovingHours: .5, staffCommittedPersonHours: 5, staffTransitPersonHours: 1, staffFieldWorkPersonHours: 2,
    definition: 'Separate observer integrals; committed is not productive work.' };
  await save(resolve(f.folder, 'B6.json'), e); await save(resolve(f.folder, 'B5.json'), episode('B5', 'test-01'));
  const r = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze }), p = r.worlds.find(w => w.arm === 'B6').physical;
  assert.equal(p.vehicleHours, 2); assert.equal(p.staffHours, 5);
  assert.equal(p.utilization.vehicleWaitingHours, 1); assert.equal(p.utilization.vehicleBlockedHours, 0);
  assert.deepEqual(p.utilization.inconsistencies, []);
  assert.equal(p.utilization.staffFieldWorkPersonHours, 2); assert.equal(p.utilization.staffTransitPersonHours, 1);
  assert.equal(r.comparisons[0].diagnosticOnlyWhenIncomplete.resourceTradeoffs[0].utilization.candidate.staffCommittedPersonHours, 5);
  assert.equal(r.worlds.find(w => w.arm === 'B5').physical.staffHours, null);
  assert.match(evidenceMarkdown(r), /Staff committed person·h/); assert.match(evidenceMarkdown(r), /overlapping subscopes/);
});
test('legacy unavailable and partial utilization preserve unknown, while contradictory hour fields are disclosed', async () => {
  const f = await fixture(); await protocol(f, 2);
  const legacy = episode('B5', 'test-01'); legacy.metrics.utilization = { available: false, vehicleCommittedHours: 0, staffCommittedPersonHours: 0, reason: 'checkpoint predates integrals' };
  const partial = episode('B6', 'test-01'); partial.metrics.utilization = { available: true, vehicleCommittedHours: 3, vehicleCommittedMs: 3600000, staffCommittedPersonHours: 0 };
  await save(resolve(f.folder, 'legacy.json'), legacy); await save(resolve(f.folder, 'partial.json'), partial);
  const r = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze }), a = r.worlds.find(w => w.arm === 'B5' && w.file).physical.utilization,
    b = r.worlds.find(w => w.arm === 'B6' && w.file).physical.utilization;
  assert.equal(a.available, false); assert.equal(a.vehicleCommittedHours, null); assert.equal(a.staffCommittedPersonHours, null);
  assert.equal(b.staffCommittedPersonHours, 0); assert.equal(b.staffTransitPersonHours, null);
  assert.deepEqual(b.inconsistencies, ['vehicleCommittedHours']);
  assert.equal(r.worlds.filter(w => !w.file).length, 2, 'Every unfinished declared world remains present');
});

test('K07 legacy strategies and K14 common B6 controller retain distinct declared comparison treatments', async () => {
  for (const kind of ['repair', 'inquiry']) {
    const f = await fixture(), treatments = kind === 'repair' ? ['full_refresh', 'selective'] : ['broad_refresh', 'active'];
    await save(resolve(f.folder, 'protocol.json'), { kind, treatments, scenarios: ['synthetic-reader-validation'], seeds: 1, episodeBudgetUsd: .1 });
    for (const treatment of treatments) {
      const e = episode(kind === 'inquiry' ? 'B6' : null, 'research-ablation-01');
      if (kind === 'repair') { delete e.arm; e.strategy = treatment; }
      else e.inquiryStrategy = treatment;
      await save(resolve(f.folder, 'synthetic-reader-validation-research-ablation-01-' + treatment + '.json'), e);
    }
    const r = await readFreshEvidence({ ablations: [f.folder], freeze: f.freeze });
    assert.equal(r.worlds.length, 2); assert.deepEqual(r.worlds.map(w => w.arm).sort(), [...treatments].sort());
    assert.equal(r.comparisons.length, 1); assert.equal(r.comparisons[0].benefitClaimPermitted, true);
    assert.equal(r.comparisons[0].candidate, treatments[1]);
    assert.equal(r.worlds.every(w => w.controllerArm === (kind === 'inquiry' ? 'B6' : null)), true);
  }
});

test('unsettled ablations keep active reserve, merged exception history and explicit unattempted zero distinct', async () => {
  const f = await fixture();
  const planned = ['full_refresh', 'selective', 'active', 'broad_refresh'].map(treatment => ({ scenario: 'synthetic-reader-validation', seed: 'test-01', treatment }));
  await save(resolve(f.folder, 'protocol.json'), { kind: 'repair', treatments: planned.map(x => x.treatment), planned, plannedRuns: 4, episodeBudgetUsd: .1 });
  await save(resolve(f.folder, 'progress.json'), { activeEpisode: { ...planned[0], state: 'inflight_not_an_outcome', reservedUsd: .1 }, chargedBudgetUsd: .2 });
  await save(resolve(f.folder, 'summary.json'), { missingOutcomes: [{ ...planned[1], status: 'missing_outcome_after_exception', reservedUsd: .1, error: { code: 'PROCESS_EXIT' } }],
    notAttempted: [planned[2]], chargedBudgetUsd: .2 });
  await save(resolve(f.folder, 'invalidation.json'), { comparable: false, reason: 'EXPLICIT_INVALIDATION' });
  const r = await readFreshEvidence({ ablations: [f.folder], freeze: f.freeze });
  const active = r.worlds.find(w => w.arm === 'full_refresh'), failed = r.worlds.find(w => w.arm === 'selective'),
    unattempted = r.worlds.find(w => w.arm === 'active'), unknown = r.worlds.find(w => w.arm === 'broad_refresh');
  assert.equal(r.worlds.length, 4); assert.equal(active.status, 'inflight_not_an_outcome');
  assert.equal(active.costs.chargedBudgetUsd, .1); assert.equal(active.costs.providerCalls, null);
  assert.equal(failed.status, 'missing_outcome_after_exception'); assert.equal(failed.costs.totalProviderCostUsd, null);
  assert.equal(unattempted.status, 'explicitly_not_attempted'); assert.equal(unattempted.costs.totalProviderCostUsd, 0);
  assert.equal(unknown.status, 'declared_not_completed'); assert.equal(unknown.costs.totalProviderCostUsd, null);
  assert.equal(r.costs.missingOutcomeCapReserveUsd, .2); assert.equal(r.costs.totalProviderCostUsd, null);
  assert.equal(r.campaigns[0].invalidation.reason, 'EXPLICIT_INVALIDATION'); assert.equal(r.campaigns[0].summary.chargedBudgetUsd, .2);
});

test('complete raw world files cannot bypass an unclosed or invalid stream index phase', async () => {
  const f = await fixture(), index = resolve(f.root, 'reports/index.json');
  for (const arm of ['B5', 'B6']) await save(resolve(f.folder, arm + '.json'), episode(arm, 'test-01'));
  for (const mode of ['open', 'invalid', 'closed']) {
    await save(index, { profiles: [{ name: 'primary', folder: 'reports/worlds', p: { seeds: 1, seedPrefix: 'test', arms: ['B5', 'B6'] } }],
      phases: [{ phase: 'free', stopped: false, invalid: false }, ...(mode === 'open' ? [] : [{ phase: 'paid', stopped: false, invalid: mode === 'invalid' }])] });
    const r = await readFreshEvidence({ primary: [index], freeze: f.freeze });
    assert.equal(r.counts.validForComparison, 2); assert.equal(r.worlds.length, 2);
    assert.equal(r.comparisons[0].benefitClaimPermitted, mode === 'closed', mode);
    if (mode !== 'closed') assert.match(r.comparisons[0].blocked[0].reasons.join(','), /index_phase_not_closed/);
  }
});

test('index scanning does not silently pick one favorable duplicate, and explicit invalidation blocks a folder', async () => {
  const f = await fixture(), index = resolve(f.root, 'reports/index.json'); await protocol(f);
  await save(resolve(f.folder, 'B5.json'), episode('B5', 'test-01')); await save(resolve(f.folder, 'B6.json'), episode('B6', 'test-01'));
  await save(resolve(f.folder, 'second-B6.json'), episode('B6', 'test-01'));
  await save(index, { profiles: [{ name: 'primary', folder: 'reports/worlds', p: { seeds: 1, seedPrefix: 'test', arms: ['B5', 'B6'] } }],
    phases: [{ phase: 'free', stopped: false, invalid: false }, { phase: 'paid', stopped: false, invalid: false }] });
  const indexed = await readFreshEvidence({ primary: [index], freeze: f.freeze });
  assert.equal(indexed.worlds.length, 3); assert.equal(indexed.comparisons[0].benefitClaimPermitted, false);
  assert.match(indexed.comparisons[0].blocked[0].reasons.join(','), /duplicate_world_outcomes/);
  await save(resolve(f.folder, 'invalidation.json'), { reason: 'RECEIPT_SOURCE_CHANGED', comparable: false });
  const invalidated = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze });
  assert.match(invalidated.comparisons[0].blocked[0].reasons.join(','), /campaign_explicitly_invalidated/);
});

test('unreadable declared ablation file occupies its exact planned slot with unknown cost', async () => {
  const f = await fixture(), planned = [{ scenario: 'S23', seed: 'test-01', treatment: 'selective' }];
  await save(resolve(f.folder, 'protocol.json'), { kind: 'repair', treatments: ['selective'], planned, plannedRuns: 1, episodeBudgetUsd: .1 });
  await writeFile(resolve(f.folder, 'S23-test-01-selective.json'), '{truncated');
  const r = await readFreshEvidence({ ablations: [f.folder], freeze: f.freeze });
  assert.equal(r.worlds.length, 1); assert.equal(r.worlds[0].status, 'unreadable_outcome'); assert.equal(r.worlds[0].arm, 'selective');
  assert.equal(r.worlds[0].costs.totalProviderCostUsd, null); assert.equal(r.worlds[0].costs.chargedBudgetUsd, .1);
});

function linkedFunnel() {
  const receipt = { owner: 'org1', id: 'physical-a', need: 'n1', resourceType: 'water', quantity: 100, received: 40,
    times: { received: 500, service: 500 } };
  const step = { index: 0, type: 'dispatch', owner: 'org1', issued: true, correctlyLinked: true, sourceId: 'physical-a',
    usefulPhysicalService: true, partialUsefulService: true, sourceReceipt: receipt, missing: [], receiptKey: JSON.stringify(['org1', 'physical-a']) };
  const review = { decision: 'approve', version: 1, atWallClock: 100000, note: 'Exact reviewed scope' };
  const records = [
    { org: 'org0', id: 'joint', state: 'completed', reviews: [review], steps: [step], sourceReview: { state: 'authorized', reviewedAtSourceClock: 20 } },
    { org: 'org1', id: 'delegate', originProposal: 'joint', state: 'completed', reviews: [review], steps: [step] },
    { org: 'org2', id: 'declined', state: 'rejected', reviews: [{ decision: 'clarify', version: 1 }, { decision: 'reject', version: 2, note: 'No available crew' }], steps: [] },
    { org: 'org0', id: 'purchase-only', state: 'completed', reviews: [review], steps: [{ type: 'purchase', issued: true, usefulPhysicalService: false }] },
  ];
  return { schema: 'proposal-service-funnel-v1', scope: 'observer_post_execution_only', asOfSourceClock: 1000, records,
    perOwner: [{ org: 'org0' }, { org: 'org1' }, { org: 'org2' }], duplicateProposals: [],
    denominators: { proposals: 4, reviewedProposals: 4, reviewedVersions: 5, reviewDecisions: 5, approvedProposals: 3,
      issuedProposals: 3, usefulServiceProposals: 2, partialUsefulServiceProposals: 2, rejectedProposals: 1,
      completedWithoutDirectUsefulService: 1, uniqueUsefulSourceOperations: 1, usefulPerReviewedProposal: .5,
      nativePositiveReceipts: [{ owner: 'org1', id: 'physical-a', need: 'n1', type: 'water', received: 40, serviceAtSourceClock: 500 }] },
    warnings: { unknownReviewHistory: [], missingPhysicalLinks: [] }, definitions: { duplicates: 'Separate review scopes; one physical receipt.' } };
}

test('K16 preserves all owners, historical versions, partial help, rejection and intermediate-only completion without duplicating physical service', async () => {
  const f = await fixture(); await protocol(f);
  const linked = linkedFunnel(); await save(resolve(f.folder, 'B6.json'), episode('B6', 'test-01', { proposalFunnel: linked }));
  await save(resolve(f.folder, 'B5.json'), episode('B5', 'test-01'));
  const r = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze }), candidate = r.worlds.find(w => w.arm === 'B6').funnel;
  assert.equal(candidate.linkedEvidenceAvailable, true); assert.equal(candidate.reviewedToUsefulRate, .5);
  assert.deepEqual(candidate.linkedEvidence, linked, 'No review version, owner, failure or clock evidence is dropped');
  assert.equal(candidate.denominators.uniqueUsefulSourceOperations, 1); assert.equal(candidate.denominators.usefulServiceProposals, 2);
  assert.equal(candidate.denominators.completedWithoutDirectUsefulService, 1); assert.equal(candidate.denominators.rejectedProposals, 1);
  const legacy = r.worlds.find(w => w.arm === 'B5').funnel;
  assert.equal(legacy.linkedEvidenceAvailable, false); assert.equal(legacy.denominators, null); assert.equal(legacy.reviewedToUsefulRate, null);
  assert.match(evidenceMarkdown(r), /Historically reviewed/); assert.match(evidenceMarkdown(r), /unique operation/);
});

test('K16 missing historical review coverage leaves reviewed-to-useful rate unknown while retaining the exact export', async () => {
  const f = await fixture(); await protocol(f, 1, ['B6']);
  const linked = linkedFunnel(); linked.warnings.unknownReviewHistory.push({ org: 'org0', id: 'joint' });
  await save(resolve(f.folder, 'B6.json'), episode('B6', 'test-01', { proposalFunnel: linked }));
  const r = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze }), funnel = r.worlds[0].funnel;
  assert.equal(funnel.linkedEvidenceAvailable, true); assert.equal(funnel.historicalReviewCoverageComplete, false);
  assert.equal(funnel.reviewedToUsefulRate, null); assert.deepEqual(funnel.linkedEvidence.warnings, linked.warnings);
});

test('K16 inconsistent counters or completion-only fake credit are disclosed rather than rendered as measured conversion', async () => {
  for (const defect of ['counter', 'missing-source', 'duplicate-positive', 'future-service']) {
    const f = await fixture(); await protocol(f, 1, ['B6']); const linked = linkedFunnel();
    if (defect === 'counter') linked.denominators.reviewedProposals = 2;
    if (defect === 'missing-source') linked.records[0].steps[0].sourceReceipt = null;
    if (defect === 'duplicate-positive') linked.denominators.nativePositiveReceipts.push(linked.denominators.nativePositiveReceipts[0]);
    if (defect === 'future-service') linked.records[0].steps[0].sourceReceipt.times.service = 2000;
    await save(resolve(f.folder, 'B6.json'), episode('B6', 'test-01', { proposalFunnel: linked }));
    const r = await readFreshEvidence({ s19: [f.folder], freeze: f.freeze }), funnel = r.worlds[0].funnel;
    assert.equal(funnel.linkedEvidenceAvailable, false, defect); assert.equal(funnel.reviewedToUsefulRate, null, defect);
    assert.equal(funnel.denominators, null, defect); assert.ok(funnel.issues.length, defect);
    assert.deepEqual(funnel.linkedEvidence, linked, 'Malformed evidence is retained for diagnosis');
  }
});
