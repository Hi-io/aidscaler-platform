import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFreshEvidence, evidenceMarkdown } from './read-fresh-evidence.mjs';

// Offline companion only. No controller, harness, source, provider or model imports.
const finite = x => typeof x === 'number' && Number.isFinite(x);
const value = x => finite(x) ? x : null;
const delta = (later, earlier) => finite(later) && finite(earlier) && later >= earlier ? later - earlier : null;
const mean = xs => xs.length && xs.every(finite) ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const fileHash = bytes => createHash('sha256').update(bytes).digest('hex');

function contribution(operation, createdAt, departures) {
  if (!operation) return null;
  const times = operation.times ?? {};
  const components = {
    onsetToThisAuthorizationMs: delta(times.authorized, createdAt),
    authorizationToLoadedDepartureMs: delta(times.dispatched, times.authorized),
    loadedDepartureToArrivalMs: delta(times.arrived, times.dispatched),
    arrivalToUsefulServiceMs: delta(times.service, times.arrived),
  };
  const complete = Object.values(components).every(finite);
  const total = complete ? Object.values(components).reduce((a, b) => a + b, 0) : null;
  return {
    id: operation.id, owner: operation.owner ?? operation.org,
    vehicle: operation.vehicle ?? null, resource: operation.resource ?? null,
    quantity: value(operation.quantity), received: value(operation.received),
    createdAtSourceClock: value(operation.createdAt), times: { ...times },
    components, componentTotalMs: total,
    componentSumMatchesThisService: total == null ? null : total === delta(times.service, createdAt),
    commandReceiptDelayMs: delta(times.orderReceived, times.authorized),
    preparationIncludingPickupMs: delta(times.dispatched, times.orderReceived),
    pickupDriveMs: delta(times.pickupArrived, times.pickupDispatched),
    departures: departures.filter(d => d.operation === operation.id && d.owner === (operation.owner ?? operation.org)),
    note: 'This authorization belongs to this physical contribution. Before it may include evidence, field queue, fleet wait, draft and owner review; it is not all perception time. Missing pickup clocks remain null.'
  };
}

function needsWithComponents(report) {
  const physical = report.operationalDiagnostics?.scorerOnlyPhysical ?? report.scorerOnlyPhysical ?? {};
  const operations = physical.operations ?? [], departures = physical.departures ?? [];
  const communities = report.metrics?.perCommunity ?? [];
  const horizon = report.protocol?.horizonMs ?? report.metrics?.simulatedMs;
  return (report.outcomes ?? []).map(outcome => {
    const community = communities.find(c => c.id === outcome.id),
      createdAt = value(community?.createdAt),
      related = operations.filter(o => o.need === outcome.id),
      useful = related.filter(o => finite(o.received) && o.received > 0 &&
        finite(o.createdAt) && o.createdAt >= 0 && finite(o.times?.service) &&
        o.times.service >= o.createdAt && finite(horizon) && o.times.service <= horizon)
        .sort((a, b) => a.times.service - b.times.service || String(a.id).localeCompare(String(b.id)));
    const issues = [];
    let cumulative = 0, critical = null;
    const receipts = useful.map(o => {
      cumulative += o.received;
      if (!critical && finite(outcome.quantity) && cumulative >= outcome.quantity) critical = o;
      return { owner: o.owner ?? o.org, operation: o.id, quantity: o.received,
        serviceAtSourceClock: o.times.service, cumulativeReceived: cumulative };
    });
    if (outcome.firstServiceAt != null && useful[0]?.times.service !== outcome.firstServiceAt)
      issues.push('first_service_not_reconciled_to_positive_operation');
    if (!outcome.censored && critical?.times.service !== outcome.completedAt)
      issues.push('sufficient_service_not_reconciled_to_positive_operations');
    if (outcome.censored && critical) issues.push('censored_but_quantity_threshold_reached_in_receipts');
    const first = contribution(useful[0], createdAt, departures),
      sufficient = outcome.censored ? null : contribution(critical, createdAt, departures);
    const directInquiries = (report.activities ?? [])
      .filter(a => a.stage === 'source-directed-confirmation' && a.location === outcome.building)
      .map(a => ({ inspection: a.inspection ?? null, references: a.references ?? [],
        requestedAtSourceClock: value(a.requestedAt), requestAcknowledgedAtSourceClock: value(a.observedAt),
        completedReceiptAtSourceClock: null,
        note: 'observedAt here is the return of submitting the inquiry, not the completed source confirmation.' }));
    const modelBatches = (report.activities ?? [])
      .filter(a => ['model-discovery', 'general-agent-discovery'].includes(a.stage) &&
        (a.verifications ?? []).some(v => v.location === outcome.building))
      .map(a => ({ stage: a.stage, batchStartedAtSourceClock: value(a.requestedAt),
        batchFinishedUpperBoundSourceClock: value(a.availableAt),
        inquiry: a.verifications.filter(v => v.location === outcome.building),
        requestedAtSourceClock: null, completedReceiptAtSourceClock: null,
        note: 'Batch clocks are not exact per-location request or completed-receipt times.' }));
    const proposalLinks = (report.proposalFunnel?.records ?? []).flatMap(p =>
      (p.steps ?? []).filter(s => s.sourceReceipt?.need === outcome.id).map(s => ({
        org: p.org, proposal: p.id, step: s.index, type: s.type, state: p.state,
        owner: s.owner, sourceId: s.sourceId, correctlyLinked: s.correctlyLinked,
        usefulPhysicalService: s.usefulPhysicalService, partialUsefulService: s.partialUsefulService,
        receivedByPlatform: s.receivedByPlatform, missing: s.missing,
        sourceReview: p.sourceReview, reviewsWallClock: p.reviews,
      })));
    return {
      ...outcome, createdAtSourceClock: createdAt,
      firstPublishedSignalAtSourceClock: value(community?.firstSignalAt),
      confirmedNeedReceivedAtSourceClock: null,
      directInquiries, modelBatches, contributionReceipts: receipts,
      firstUsefulContribution: first, sufficientThresholdContribution: sufficient,
      proposalLinks, relatedOperations: related, issues,
      nativeOutstanding: finite(outcome.quantity) && finite(outcome.served) ? Math.max(0, outcome.quantity - outcome.served) : null,
      note: 'Every declared physical cohort outcome is retained. Censored paths have no fabricated sufficient contribution. Native quantities and contributing receipts are not compared across resource units.'
    };
  });
}

export function decomposeClosedReport(report) {
  const closed = typeof report.status === 'string' && !['running', 'pending', 'inflight'].includes(report.status);
  if (!closed) throw Error('Only a persisted closed outcome can be decomposed.');
  const needs = needsWithComponents(report);
  const byResource = Object.fromEntries([...new Set(needs.map(n => n.type))].map(type => {
    const group = needs.filter(n => n.type === type);
    const components = label => Object.fromEntries([
      'onsetToThisAuthorizationMs', 'authorizationToLoadedDepartureMs',
      'loadedDepartureToArrivalMs', 'arrivalToUsefulServiceMs'
    ].map(stage => [stage, { meanMs: mean(group.map(n => n[label]?.components?.[stage])),
      observed: group.filter(n => finite(n[label]?.components?.[stage])).length, eligible: group.length }]));
    return [type, { unit: group[0].unit, eligible: group.length,
      firstUsefulReached: group.filter(n => !n.firstUsefulCensored).length,
      sufficientlyServed: group.filter(n => !n.censored).length,
      rightCensored: group.filter(n => n.censored).length,
      firstUsefulRmstMs: mean(group.map(n => n.timeToFirstUsefulServiceMs)),
      sufficientRmstMs: mean(group.map(n => n.timeToSufficientServiceMs)),
      nativeMetrics: report.metrics?.services?.[type] ?? null,
      firstContributionComponents: components('firstUsefulContribution'),
      thresholdContributionComponents: components('sufficientThresholdContribution') }];
  }));
  return {
    arm: report.arm, seed: report.seed, status: report.status,
    eligible: needs.length, first: report.timeToFirstUsefulService,
    sufficient: report.timeToSufficientService, byResource,
    errors: report.errors, invariants: report.invariants, sourceCoverage: report.sourceCoverage,
    proposalFunnel: report.proposalFunnel ?? null,
    stageCompletenessIssues: needs.flatMap(n => n.issues.map(issue => ({ need: n.id, issue }))),
    needs,
    limitations: [
      'Offline scorer evidence only; no world truth is exposed to a controller.',
      'Confirmation receipt clocks are not exported per discovery location here; they remain unknown. Submission ACKs and model batch completion are not confirmation completion.',
      'The semantic receipt nominal interpretation clock is not used in this decomposition.',
      'First useful contribution and last quantity-threshold contribution are distinct. A partial path is not presented as a sufficient path.',
      'Mean physical-stage components are descriptive contribution anchors, not a causal effect of model perception. Missing timestamps are not imputed.',
      'Local owner-review timestamps stay wall clocks and are never subtracted from source physical clocks.'
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(index|freeze|out)=(.+)$/.exec(arg);
    if (!match) throw Error('Use --index=INDEX [--freeze=FREEZE --out=PREFIX].');
    return [match[1], match[2]];
  }));
  if (!args.index) throw Error('An explicit declared campaign index is required.');
  const readout = await readFreshEvidence({ primary: [args.index],
    freeze: args.freeze ?? 'reports/measurement-freeze-current.json' });
  const details = [];
  for (const world of readout.worlds) {
    if (!world.file) continue;
    const bytes = await readFile(world.file), report = JSON.parse(bytes.toString('utf8'));
    if (!report.status || ['running', 'pending', 'inflight'].includes(report.status)) continue;
    details.push({ file: world.file, sha256: fileHash(bytes), validForComparison: world.validForComparison,
      integrity: world.integrity, costs: world.costs, ...decomposeClosedReport(report) });
  }
  const output = { schema: 'offline-physical-components-v1', generatedAt: new Date().toISOString(),
    companionSha256: fileHash(await readFile(fileURLToPath(import.meta.url))),
    index: resolve(args.index), readout, details,
    modelCallsMadeByCompanion: 0,
    note: 'All declared and missing slots remain in readout. Comparisons remain blocked until the original declared campaign is complete/stable; no favorable subset claim is emitted.' };
  const prefix = resolve(args.out ?? '.local/readouts/physical-components');
  await mkdir(dirname(prefix), { recursive: true });
  await writeFile(prefix + '.json', JSON.stringify(output, null, 2));
  await writeFile(prefix + '.md', evidenceMarkdown(readout));
  console.log(JSON.stringify({ json: prefix + '.json', markdown: prefix + '.md',
    counts: readout.counts, closedDetails: details.map(d => ({ arm: d.arm, seed: d.seed, eligible: d.eligible,
      status: d.status, first: d.first, sufficient: d.sufficient, issues: d.stageCompletenessIssues.length })),
    modelCallsMade: 0, comparisonClaimsBlocked: readout.comparisons.filter(c => !c.benefitClaimPermitted).length }));
}
