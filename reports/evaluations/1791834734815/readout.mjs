import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const folder = fileURLToPath(new URL('.', import.meta.url));
const protocol = JSON.parse(await readFile(folder + 'protocol.json', 'utf8'));
let invalidation = null;
try { invalidation = JSON.parse(await readFile(folder + 'invalidation.json', 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const rows = [], missing = [];
for (const variant of protocol.compositionVariants) {
  const seed = `${protocol.seedPrefix}${variant}-01`;
  for (const arm of protocol.arms) {
    const file = `S19-${seed}-${arm}.json`;
    let r;
    try { r = JSON.parse(await readFile(folder + file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') { missing.push(file); continue; } throw e; }
    const communities = r.metrics.perCommunity.filter(n => n.type === 'shelter');
    const ownerOperations = r.platformEvidence.flatMap(e => e.operations
      .filter(o => !o.peerOwner && !o.sourceId && (o.org ?? o.owner) === e.org)
      .map(o => ({ owner: e.org, id: o.id, type: o.type, state: o.state,
        inspection: o.inspection ?? null, building: o.building ?? null,
        resource: o.resource ?? null, vehicle: o.vehicle ?? null,
        need: o.need ?? null, quantity: o.quantity ?? null, received: o.received ?? null,
        times: o.times ?? {}, destination: o.destination ?? null })));
    // Keep the original received copies in raw reports. A source inspection
    // received through direct radio and peer ledger still represents one visit.
    const receivedAssessments = r.platformEvidence.flatMap(e => e.assessments.map(v => ({
      receivedBy: e.org, sourceOwner: v.sourceOwner ?? v.result?.assessment?.inspectorOrg ?? v.org,
      sourceId: v.sourceId ?? v.id, id: v.id, method: v.method, purpose: v.purpose,
      state: v.state, confirmedBySource: v.confirmedBySource, entity: v.entity,
      startedAt: v.startedAt ?? null, arrivedAt: v.arrivedAt ?? null,
      observedAt: v.observedAt ?? null, completedAt: v.completedAt ?? null,
      safe: v.result?.safe ?? null, resultVersion: v.result?.version ?? null,
      assessment: v.result?.assessment ?? null,
    })));
    const visits = [...new Map(receivedAssessments.filter(v =>
      v.state === 'completed' && v.confirmedBySource === true && v.method === 'field'
      && v.assessment?.method === 'field' && v.assessment?.competent === true
      && Number.isFinite(v.startedAt) && Number.isFinite(v.arrivedAt)
      && Number.isFinite(v.observedAt) && v.arrivedAt >= v.startedAt
      && v.observedAt > v.arrivedAt,
    ).map(v => [
      `${v.sourceOwner}:${v.sourceId}`, v,
    ])).values()];
    rows.push({ file, arm, variant, seed, status: r.status, rounds: r.roundsExecuted,
      candidateFingerprint: r.candidateFingerprint, evaluatorFingerprint: r.evaluatorFingerprint,
      simulatedMs: r.metrics.simulatedMs, wallSec: r.wallMs / 1000,
      services: r.metrics.services,
      shelterDeficitPlaceHours: r.metrics.services.shelter.uncoveredUnitMs / 3600000,
      shelterPlaceHours: r.metrics.collective.shelterPlaceHours,
      operatingHours: r.metrics.collective.operatingHours,
      shelterCommunities: communities.map(n => ({ id: n.id, quantity: n.quantity, served: n.served,
        firstUsefulMin: n.firstServiceAt == null ? null : (n.firstServiceAt - n.createdAt) / 60000,
        sufficientMin: n.sufficientServiceAt == null ? null : (n.sufficientServiceAt - n.createdAt) / 60000,
        firstUsefulCensored: n.firstServiceAt == null, sufficientCensored: n.sufficientServiceAt == null })),
      response: r.metrics.response, physical: r.metrics.physical,
      operatorReviewMs: r.metrics.operatorReviewMs, queries: r.metrics.queries,
      modelCalls: r.usage.length, costUsd: r.costUsd, chargedBudgetUsd: r.chargedBudgetUsd,
      unknownCostCalls: r.unknownCostCalls, errors: r.errors, invariants: r.invariants,
      ownerOperations, physicalVisits: visits, receivedAssessments,
      facilities: r.platformEvidence.flatMap(e => e.facilities.map(f => ({ receivedBy: e.org,
        id: f.id, state: f.state, safe: f.safe, occupancy: f.occupancy ?? null,
        sourceVersion: f.sourceVersion, provisioned: f.provisioned, dependencies: f.dependencies }))),
    });
  }
}
const comparisons = [];
for (const variant of protocol.compositionVariants) {
  const baseline = rows.find(r => r.variant === variant && r.arm === 'B5');
  if (!baseline) continue;
  for (const candidate of rows.filter(r => r.variant === variant && r.arm !== 'B5')) {
    const validPair = !invalidation?.comparisonInvalid
      && candidate.candidateFingerprint === baseline.candidateFingerprint
      && candidate.evaluatorFingerprint === baseline.evaluatorFingerprint
      && candidate.simulatedMs === baseline.simulatedMs;
    comparisons.push({ variant, baseline: 'B5', candidate: candidate.arm, validPair,
      shelterDeficitReduction: validPair && baseline.shelterDeficitPlaceHours > 0
        ? 1 - candidate.shelterDeficitPlaceHours / baseline.shelterDeficitPlaceHours : null,
      shelterPlaceHoursDifference: validPair ? candidate.shelterPlaceHours - baseline.shelterPlaceHours : null,
      sufficientServiceMinDifference: validPair && candidate.shelterCommunities[0]?.sufficientMin != null
        && baseline.shelterCommunities[0]?.sufficientMin != null
        ? candidate.shelterCommunities[0].sufficientMin - baseline.shelterCommunities[0].sufficientMin : null,
      costUsdDifference: candidate.costUsd - baseline.costUsd,
    });
  }
}
const output = { at: new Date().toISOString(), protocol: 'protocol.json', complete: missing.length === 0,
  invalidation,
  missing, primary: 'shelter deficit native place-hours; physical occupancy; occupied place-hours',
  attribution: 'Functional service and receipts are not a claim of GenAI benefit; two internal worlds are not a robust statistical estimate.',
  rows, comparisons };
await writeFile(folder + 'physical-readout.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ complete: output.complete, missing, rows: rows.map(r => ({
  arm: r.arm, variant: r.variant, status: r.status, served: r.services.shelter.served,
  deficitPlaceHours: r.shelterDeficitPlaceHours, placeHours: r.shelterPlaceHours,
  sufficientMin: r.shelterCommunities[0]?.sufficientMin, calls: r.modelCalls,
  costUsd: r.costUsd, unknownCostCalls: r.unknownCostCalls, errors: r.errors.length,
  physicalVisits: r.physicalVisits.length, ownerTrips: r.ownerOperations.length,
  invariants: r.invariants.length,
})), comparisons }, null, 2));
