import { readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, isAbsolute, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Offline readout only. Do not import harnesses, providers or mutable controllers.
const finite = x => typeof x === 'number' && Number.isFinite(x);
const number = x => finite(x) ? x : null;
const sum = xs => xs.every(finite) ? xs.reduce((a, b) => a + b, 0) : null;
const mean = xs => xs.length && xs.every(finite) ? sum(xs) / xs.length : null;
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])]));
  return x;
}
const hash = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
async function exists(p) { try { await access(p); return true; } catch (e) { if (e.code !== 'ENOENT') throw e; return false; } }
async function json(p) { return JSON.parse(await readFile(p, 'utf8')); }
function projectRoot(p) {
  const parts = resolve(p).split(sep), i = parts.lastIndexOf('reports');
  return i > 0 ? parts.slice(0, i).join(sep) : dirname(resolve(p));
}
async function reference(p, context) {
  if (isAbsolute(p)) return p;
  const candidates = [resolve(projectRoot(context), p), resolve(p), resolve(dirname(context), p)];
  for (const c of candidates) if (await exists(c)) return c;
  return candidates[0];
}
function fingerprints(r) {
  const p = r.protocol ?? {}, f = p.fingerprints ?? r.fingerprints ?? {}, final = r.finalBuilds ?? r;
  return {
    candidate: r.candidateFingerprint ?? p.candidateFingerprint ?? f.candidateFingerprint ?? f.candidate ?? null,
    evaluator: r.evaluatorFingerprint ?? p.evaluatorFingerprint ?? f.evaluatorFingerprint ?? f.evaluator ?? null,
    simulator: r.manifest?.engineBuild ?? r.engineBuild ?? p.simulatorBuild ?? p.simulatorFingerprint ?? f.simulatorFingerprint ?? f.simulator ?? r.scorerOnlyPhysical?.manifest?.engineBuild ?? null,
    finalCandidate: final.finalCandidateFingerprint ?? null,
    finalEvaluator: final.finalEvaluatorFingerprint ?? null,
    finalSimulator: final.finalEngineBuild ?? null,
    changed: Boolean(r.candidateChanged || r.evaluatorChanged || r.simulatorChanged || final.candidateChanged || final.evaluatorChanged || final.simulatorChanged),
  };
}
function stability(r, expected) {
  const f = fingerprints(r), reasons = [];
  for (const key of ['candidate', 'evaluator', 'simulator']) {
    if (!f[key]) reasons.push('missing_' + key + '_hash');
    if (expected?.[key] && f[key] !== expected[key]) reasons.push('not_requested_freeze_' + key);
    const end = f['final' + key[0].toUpperCase() + key.slice(1)];
    if (!end) reasons.push('missing_final_' + key + '_hash');
    else if (end !== f[key]) reasons.push('changed_' + key);
  }
  if (f.changed) reasons.push('source_changed_flag');
  return { ...f, stable: reasons.length === 0, reasons };
}
function costs(r, missing = false, cap = null) {
  const u = Array.isArray(r?.usage) ? r.usage : null;
  const known = u ? u.filter(x => finite(x.cost_usd)) : null;
  const unknown = u ? u.filter(x => !finite(x.cost_usd)) : null;
  const reportedKnown = number(r?.costUsd ?? r?.paidCostUsd);
  const reportedCharged = number(r?.chargedBudgetUsd ?? r?.reservedUsd);
  const knownCostSubtotalUsd = known ? sum(known.map(x => x.cost_usd)) : reportedKnown;
  const unknownCostCalls = unknown ? unknown.length : number(r?.unknownCostCalls);
  const unknownCostReserveUsd = unknown ? sum(unknown.map(x => number(x.reserved_usd))) : number(r?.unknownCostReserveUsd);
  const totalCostKnown = !missing && (u ? unknown.length === 0 : false);
  return {
    usageRecords: u ? u.length : null,
    providerCalls: number(r?.paidCalls) ?? (u ? u.length : null),
    knownCostSubtotalUsd, totalProviderCostUsd: totalCostKnown ? knownCostSubtotalUsd : null,
    totalCostKnown, unknownCostCalls, unknownCostReserveUsd,
    chargedBudgetUsd: missing ? reportedCharged ?? cap : reportedCharged ?? (u ? sum(u.map(x => number(x.cost_usd) ?? number(x.reserved_usd))) : null),
    fullEpisodeCapReservedWhenOutcomeMissingUsd: missing ? cap : null,
    providerWallKnownSubtotalMs: u ? sum(u.filter(x => finite(x.wall_ms)).map(x => x.wall_ms)) : null,
    providerWallMissingCalls: u ? u.filter(x => !finite(x.wall_ms)).length : null,
    providerWallTotalMs: u && u.every(x => finite(x.wall_ms)) ? sum(u.map(x => x.wall_ms)) : null,
    failedProviderCalls: u ? u.filter(x => x.state === 'failed' || x.error).length : null,
    inputTokensKnownSubtotal: u ? sum(u.filter(x => finite(x.input_tokens)).map(x => x.input_tokens)) : null,
    outputTokensKnownSubtotal: u ? sum(u.filter(x => finite(x.output_tokens)).map(x => x.output_tokens)) : null,
    models: u ? [...new Set(u.map(x => x.model).filter(Boolean))] : [],
    actualEpisodeWallMs: number(r?.wallMs ?? r?.actualWallMs),
    note: 'Known subtotals are not a known total when a usage record or outcome is missing. Reserved dollars are budget exposure, not an invented bill. Infrastructure, human wages and unpriced tools remain unmeasured.',
  };
}
const percentile = (xs, q) => xs.length && xs.every(finite) ? [...xs].sort((a, b) => a - b)[Math.ceil((xs.length - 1) * q)] : null;
function physicalClocks(r) {
  const horizon = number(r.metrics?.simulatedMs ?? r.protocol?.horizonMs ?? r.manifest?.config?.durationMs);
  const source = Array.isArray(r.outcomes) ? r.outcomes : r.metrics?.perCommunity;
  if (!Array.isArray(source)) return { horizonMs: horizon, firstUseful: null, sufficient: null, cohorts: null };
  const directory = new Map((r.metrics?.perCommunity ?? []).map(n => [n.id, n]));
  const cohorts = source.map(n => {
    const base = { ...directory.get(n.id), ...n }, created = number(base.createdAt ?? (finite(base.timeToFirstUsefulServiceMs) || finite(base.timeToSufficientServiceMs) ? 0 : undefined));
    const firstAt = number(base.firstServiceAt), sufficientAt = number(base.sufficientServiceAt ?? base.sufficientAt ?? base.completedAt);
    const firstCensored = base.firstUsefulCensored ?? (firstAt == null), sufficientCensored = base.censored ?? base.sufficientCensored ?? (sufficientAt == null);
    return {
      id: base.id, responseEpisode: base.responseEpisode ?? null, building: base.building ?? null, type: base.type ?? null,
      unit: base.unit ?? r.metrics?.services?.[base.type]?.unit ?? null, quantity: number(base.quantity), served: number(base.served),
      createdAt: created, deadline: number(base.deadline), silent: typeof base.silent === 'boolean' ? base.silent : null,
      remote: typeof base.remote === 'boolean' ? base.remote : null,
      firstServiceAt: firstAt, sufficientAt, firstCensored, sufficientCensored,
      firstObservedMs: number(base.timeToFirstUsefulServiceMs) ?? (created != null && horizon != null ? Math.max(0, (firstCensored ? horizon : firstAt) - created) : null),
      sufficientObservedMs: number(base.timeToSufficientServiceMs) ?? (created != null && horizon != null ? Math.max(0, (sufficientCensored ? horizon : sufficientAt) - created) : null),
    };
  });
  function clock(kind, supplied) {
    const field = kind === 'firstUseful' ? 'firstObservedMs' : 'sufficientObservedMs', censored = kind === 'firstUseful' ? 'firstCensored' : 'sufficientCensored';
    return {
      eligible: number(supplied?.eligible) ?? cohorts.length,
      reached: number(supplied?.reached ?? supplied?.completed) ?? cohorts.filter(c => !c[censored]).length,
      rightCensored: number(supplied?.rightCensored) ?? cohorts.filter(c => c[censored]).length,
      restrictedMeanMs: number(supplied?.restrictedMeanMs) ?? mean(cohorts.map(c => c[field])),
      medianObservedMs: number(supplied?.medianMs) ?? percentile(cohorts.map(c => c[field]), .5),
      p95ObservedMs: number(supplied?.p95Ms) ?? percentile(cohorts.map(c => c[field]), .95),
      definition: 'Mean/quantiles of observed times clipped at the declared scorer horizon, including unresolved cohorts. These are restricted outcomes, not an estimate of the unknown completion time after censoring.',
    };
  }
  return { horizonMs: horizon, firstUseful: clock('firstUseful', r.timeToFirstUsefulService), sufficient: clock('sufficient', r.timeToSufficientService), cohorts };
}
function deadlines(cohorts, horizon) {
  if (!cohorts || horizon == null) return null;
  const eligible = cohorts.filter(c => c.deadline != null && c.deadline <= horizon && c.createdAt != null && c.createdAt <= c.deadline);
  const met = eligible.filter(c => !c.sufficientCensored && c.sufficientAt != null && c.sufficientAt <= c.deadline).length;
  return { met, eligible: eligible.length, fraction: eligible.length ? met / eligible.length : null,
    futureWindow: cohorts.filter(c => c.deadline != null && c.deadline > horizon).length,
    missingWindowOrStart: cohorts.filter(c => c.deadline == null || c.createdAt == null).length,
    note: 'Full useful service by a window whose end is observable; a future deadline is neither success nor failure.' };
}
function resourceMetrics(r) {
  return Object.fromEntries(Object.entries(r.metrics?.services ?? {}).map(([type, s]) => [type, {
    unit: s.unit ?? null, demand: number(s.demand), served: number(s.served), pending: number(s.pending),
    overprovided: number(s.overprovided), uncoveredUnitMs: number(s.uncoveredUnitMs),
    uncoveredUnitHours: finite(s.uncoveredUnitMs) ? s.uncoveredUnitMs / 3600000 : null,
    onTimeReported: number(s.onTime),
  }]));
}
function utilizationReadout(r) {
  const u = r.metrics?.utilization, available = u?.available === true;
  const measured = (hours, millis) => !available ? null : number(u[hours]) ?? (finite(u[millis]) ? u[millis] / 3600000 : null);
  const fields = {
    vehicleCommittedHours: ['vehicleCommittedHours', 'vehicleCommittedMs'], vehicleMovingHours: ['vehicleMovingHours', 'vehicleMovingMs'],
    vehicleWaitingHours: ['vehicleWaitingHours', 'vehicleWaitingMs'], vehicleBlockedHours: ['vehicleBlockedHours', 'vehicleBlockedMs'],
    staffCommittedPersonHours: ['staffCommittedPersonHours', 'staffCommittedPersonMs'], staffTransitPersonHours: ['staffTransitPersonHours', 'staffTransitPersonMs'],
    staffFieldWorkPersonHours: ['staffFieldWorkPersonHours', 'staffFieldWorkPersonMs'],
  };
  const values = Object.fromEntries(Object.entries(fields).map(([name, keys]) => [name, measured(...keys)]));
  const inconsistencies = !available ? [] : Object.entries(fields).filter(([, [h, ms]]) => finite(u[h]) && finite(u[ms]) &&
    Math.abs(u[h] - u[ms] / 3600000) > 1e-9).map(([field]) => field);
  return { available, reason: available ? null : u?.reason ?? 'Utilization instrumentation absent; unknown is not zero.', ...values,
    rawIntegrals: Object.fromEntries(Object.values(fields).map(([, ms]) => [ms, available ? number(u[ms]) : null])),
    missingMeasuredFields: Object.entries(values).filter(([, x]) => x == null).map(([name]) => name), inconsistencies,
    definition: u?.definition ?? null,
    note: 'Separate source-clock scopes. Committed capacity includes nonproductive waits; transit and field work overlap with commitment and must not be summed as independent labor. This is not all responder work, wages or clinical productivity.' };
}
function funnel(r) {
  const proposals = r.operationalDiagnostics?.proposals;
  const operations = r.operationalDiagnostics?.operations;
  const linked = r.proposalFunnel ?? null, issues = [];
  const contract = linked?.schema === 'proposal-service-funnel-v1' && linked.scope === 'observer_post_execution_only' &&
    Array.isArray(linked.records) && linked.records.every(p => p && Array.isArray(p.reviews) && Array.isArray(p.steps)) &&
    Array.isArray(linked.perOwner) && linked.denominators && linked.warnings;
  if (linked && !contract) issues.push('unsupported_or_incomplete_linked_funnel_contract');
  if (contract) {
    const d = linked.denominators, rows = linked.records;
    const countChecks = { proposals: rows.length, reviewedProposals: rows.filter(p => p.reviews?.length).length,
      approvedProposals: rows.filter(p => p.reviews?.some(x => x.decision === 'approve')).length,
      issuedProposals: rows.filter(p => p.steps?.some(x => x.issued)).length,
      usefulServiceProposals: rows.filter(p => p.steps?.some(x => x.usefulPhysicalService)).length };
    for (const [field, expected] of Object.entries(countChecks)) if (d[field] !== expected) issues.push('inconsistent_' + field);
    const native = Array.isArray(d.nativePositiveReceipts) ? d.nativePositiveReceipts : [];
    const ids = new Set(native.map(x => JSON.stringify([x.owner, x.id])));
    if (!Array.isArray(d.nativePositiveReceipts) || d.uniqueUsefulSourceOperations !== ids.size || d.nativePositiveReceipts.length !== ids.size ||
      native.some(x => !finite(x.received) || x.received <= 0)) issues.push('inconsistent_native_positive_receipts');
    const linkedReceipts = new Set();
    for (const p of rows) for (const step of p.steps ?? []) if (step.usefulPhysicalService) {
      const receipt = step.sourceReceipt;
      if (!step.issued || !step.correctlyLinked || !['dispatch', 'evacuate'].includes(step.type) || !receipt?.need ||
        receipt.owner !== step.owner || receipt.id !== step.sourceId || !finite(receipt.received) || receipt.received <= 0 ||
        !finite(receipt.quantity) || receipt.received > receipt.quantity || !finite(receipt.times?.service) ||
        !finite(receipt.createdAtSourceClock) || receipt.createdAtSourceClock < 0 || receipt.times.service < receipt.createdAtSourceClock ||
        !finite(linked.asOfSourceClock) || receipt.times.service > linked.asOfSourceClock) issues.push('inconsistent_useful_service_link');
      else linkedReceipts.add(JSON.stringify([receipt.owner, receipt.id]));
    }
    if (ids.size !== linkedReceipts.size || [...ids].some(id => !linkedReceipts.has(id))) issues.push('inconsistent_unique_service_links');
    const reviewedUseful = rows.filter(p => p.reviews?.length && p.steps?.some(x => x.usefulPhysicalService)).length;
    const expectedRate = d.reviewedProposals ? reviewedUseful / d.reviewedProposals : null;
    if (d.usefulPerReviewedProposal !== expectedRate) issues.push('inconsistent_reviewed_to_useful_rate');
  }
  const available = Boolean(contract) && issues.length === 0;
  const historyComplete = available && Array.isArray(linked.warnings.unknownReviewHistory) &&
    linked.warnings.unknownReviewHistory.length === 0 && Array.isArray(linked.duplicateProposals) && linked.duplicateProposals.length === 0;
  return {
    proposalsObserved: Array.isArray(proposals) ? proposals.length : null,
    proposalStates: Array.isArray(proposals) ? counts(proposals, x => x.state ?? 'unknown') : null,
    operationStates: Array.isArray(operations) ? counts(operations, x => x.state ?? 'unknown') : null,
    sourceConfirmations: number(r.sourceCoverage?.completedHumanReviews),
    repairFunnel: r.funnel ?? null,
    linkedEvidence: linked,
    linkedEvidenceAvailable: available, historicalReviewCoverageComplete: historyComplete, issues,
    reviewedToUsefulRate: historyComplete ? linked.denominators.usefulPerReviewedProposal : null,
    denominators: available ? linked.denominators : null,
    note: available ? 'K16 retains every owner-scoped proposal and historical review/version, exact issued action and independently linked physical receipt. Delegated review scopes are distinct; unique owner+source operation receipts are not counted twice. Partial useful service, intermediate-only completions, rejections, missing links and missing review history remain visible. Scripted review conversion is not human comprehension or externally validated effectiveness.' :
      'Snapshot states do not measure all historically reviewed, rejected or authorized proposals. K16 reviewed-to-useful conversion stays unmeasured without a valid full linked export; a completed proposal is not automatically a delivered service.',
  };
}
function counts(xs, key) { const m = {}; for (const x of xs) { const k = key(x); m[k] = (m[k] ?? 0) + 1; } return m; }
function readoutWorld(r, descriptor, expected) {
  const integrity = stability(r, expected), clocks = physicalClocks(r), metrics = r.metrics ?? {}, errors = [...(r.errors ?? []), ...(r.error ? [r.error] : [])];
  const invariants = Array.isArray(r.invariants) ? r.invariants : null;
  // A retained operational error is part of the treatment's outcome, not a
  // reason to select only its successful episodes. A closed physical world
  // with unchanged source/evaluator bytes and intact invariants is comparable
  // even when an extraction failed and the product had to use its fallback.
  // Missing/interrupted worlds, changed builds and broken invariants remain
  // blocked; their outcomes and costs are still retained by the reader.
  const accepted = ['completed', 'recovered'].includes(r.status) && invariants?.length === 0 && integrity.stable;
  const cohorts = clocks.cohorts;
  const subgroup = Object.fromEntries(['silent', 'remote'].map(group => [group, {
    reportedNative: metrics.subgroups?.[group] ?? null,
    cohorts: Object.fromEntries(['true', 'false'].map(value => {
      const selected = cohorts?.filter(c => c[group] === (value === 'true')) ?? null;
      return [value, selected ? { count: selected.length, sufficient: selected.filter(c => !c.sufficientCensored).length,
        rightCensored: selected.filter(c => c.sufficientCensored).length, sufficientRmstMs: mean(selected.map(c => c.sufficientObservedMs)),
        byDeadline: deadlines(selected, clocks.horizonMs) } : null];
    })), missingMembership: cohorts ? cohorts.filter(c => c[group] == null).length : null,
  }]));
  const f = metrics.physical ?? {}, utilization = utilizationReadout(r);
  return {
    ...descriptor, arm: descriptor.comparisonTreatment ?? r.arm ?? descriptor.arm ?? r.treatment ?? null,
    controllerArm: r.arm ?? null, treatment: descriptor.comparisonTreatment ?? r.strategy ?? r.inquiryStrategy ?? r.treatment ?? null,
    seed: r.seed ?? descriptor.seed ?? r.protocol?.seed ?? null,
    scenario: r.scenario ?? descriptor.scenario ?? r.manifest?.config?.scenario ?? null,
    variant: descriptor.variant ?? r.manifest?.config?.compositionVariant ?? null,
    status: r.status ?? 'unknown', errors, operationalErrorCount: errors.length,
    invariants, integrity, validForComparison: accepted,
    costs: costs(r), physical: { clocks, deadlineCoverage: deadlines(cohorts, clocks.horizonMs), services: resourceMetrics(r),
      subgroups: subgroup, vehicleKm: finite(f.distanceM) ? f.distanceM / 1000 : null, fuelLitres: finite(f.fuelMl) ? f.fuelMl / 1000 : null,
      fuelMillilitres: number(f.fuelMl), failedTrips: number(metrics.failedTrips), invalidActions: number(metrics.invalidActions),
      stockLedgerValid: typeof metrics.ledgerValid === 'boolean' ? metrics.ledgerValid : null,
      arrivedNotReceived: number(f.arrivedNotReceived), collective: metrics.collective ?? null,
      utilization, staffHours: utilization.staffCommittedPersonHours, vehicleHours: utilization.vehicleCommittedHours,
      note: 'Native litres, portions, places, person-hours, vehicle-hours, km and fuel remain separate. Staff/vehicle hour aliases refer only to committed capacity; the utilization record retains distinct scopes. No fatalities or lives-saved claim is derived from these measurements.' },
    sources: r.sourceCoverage ?? metrics.information ?? null,
    latency: { stages: metrics.latency ?? null, sourceDownload: metrics.information?.downloadLatencyMs ?? null,
      modelWallKnownSubtotalMs: costs(r).providerWallKnownSubtotalMs, episodeWallMs: number(r.wallMs ?? r.actualWallMs),
      note: 'Stage distributions usually contain only completed receipts. Missing/censored waits are retained separately; concurrent stage quantiles must not be summed.' },
    funnel: funnel(r), repairTiming: r.timing ?? null,
    recovery: r.results ? { durationMs: number(r.recoveryDurationMs), censored: r.recoveryCensored ?? null, controllerStoppedAt: number(r.controllerStoppedAt),
      cohortHash: r.cohortHash ?? null, ...r.results, maxPendingSourceReviews: number(r.maxPendingSourceReviews),
      sourceReviewWaits: (r.sourceReviewReceipts ?? []).map(x => ({ org: x.org, id: x.id, observedQueueWaitMs: number(x.observedQueueWaitMs), censored: x.censored ?? null })),
      finalLocalState: r.localState ?? null, timeline: r.timeline ?? null,
      note: 'Closing a versioned source disposition or recovering a queue does not establish correct semantic interpretation, public comprehension, productivity of actual human teams or clinical benefit.' } : null,
    comparisonMaterial: {
      world: r.manifest ? hash({ config: r.manifest.config, initialMapHash: r.initialMapHash ?? null, contentVersion: r.manifest.contentVersion }) : null,
      protocol: r.protocol ? hash(r.protocol) : null, corpus: r.corpus ? hash(r.corpus) : null,
      model: r.modelConfig ? hash(r.modelConfig) : null,
      clocks: { measurementMode: r.measurementMode ?? null, clockPolicy: r.clockPolicy ?? null, planningRounds: r.planningRounds ?? null,
        policyIntervalMs: r.policyIntervalMs ?? null, responseOrder: r.responseOrder ?? null, episodeBudgetUsd: r.episodeBudgetUsd ?? null },
    },
  };
}
async function inspectFile(file, descriptor, expected) {
  try {
    const bytes = await readFile(file), raw = JSON.parse(bytes.toString('utf8'));
    return readoutWorld(raw, { ...descriptor, file, fileSha256: createHash('sha256').update(bytes).digest('hex') }, expected);
  } catch (e) {
    return { ...descriptor, file, status: e.code === 'ENOENT' ? descriptor.status ?? 'missing_outcome' : 'unreadable_outcome',
      error: e.code ?? e.name, costs: costs(descriptor, true, number(descriptor.episodeBudgetUsd)), validForComparison: false, integrity: null };
  }
}
function declarations(p) {
  if (Array.isArray(p.planned)) return p.planned.map(x => ({ ...x, arm: x.arm ?? x.treatment }));
  const arms = p.arms ?? (['repair', 'inquiry'].includes(p.kind) ? p.treatments : null);
  if (!finite(p.seeds) || !Array.isArray(arms)) return [];
  const scenarios = p.scenarios ?? [null], variants = p.compositionVariants ?? [null], result = [];
  for (const scenario of scenarios) for (const variant of variants) for (let i = 1; i <= p.seeds; i++) for (const arm of arms) {
    const seed = (p.seedPrefix ?? (['repair', 'inquiry'].includes(p.kind) ? 'research-ablation-' : '')) + (variants.length > 1 ? variant + '-' : '') + String(i).padStart(2, '0');
    result.push({ scenario, variant, seed, arm });
  }
  return result;
}
function declaredTreatment(value, file, protocol, planned) {
  if (!['repair', 'inquiry'].includes(protocol.kind) || !Array.isArray(protocol.treatments)) return null;
  const treatment = protocol.kind === 'repair' ? value?.strategy ?? value?.repairStrategy ?? value?.treatment : value?.inquiryStrategy ?? value?.treatment;
  if (!protocol.treatments.includes(treatment)) return null;
  const matches = planned.filter(d => d.arm === treatment && d.seed === value?.seed &&
    (value?.scenario == null || d.scenario == null || d.scenario === value.scenario));
  const exact = matches.find(d => file === `${d.scenario}-${d.seed}-${d.arm}.json`);
  const match = exact ?? (matches.length === 1 ? matches[0] : null);
  return match ? { ...match, comparisonTreatment: treatment } : null;
}
async function folderWorlds(folder, label, expected, inherited = null) {
  const protocolPath = resolve(folder, 'protocol.json'), protocol = inherited ?? (await exists(protocolPath) ? await json(protocolPath) : {});
  const planned = declarations(protocol);
  const files = (await readdir(folder)).filter(f => f.endsWith('.json') && !/^(protocol|summary|progress|index|invalidation|.*readout|.*diagnosis)\.json$/i.test(f));
  const parsed = [];
  for (const f of files) {
    const full = resolve(folder, f), value = await json(full).catch(() => null);
    if (value == null) {
      const declared = planned.find(d => f === `${d.scenario}-${d.seed}-${d.arm}.json`);
      parsed.push({ ...(await inspectFile(full, { ...declared, scope: label, episodeBudgetUsd: protocol.episodeBudgetUsd }, expected)), undeclared: !declared });
      continue;
    }
    if (value && (value.metrics || value.usage || value.timing || value.results) && (value.status || value.arm)) {
      parsed.push(await inspectFile(full, { ...declaredTreatment(value, f, protocol, planned), scope: label,
        episodeBudgetUsd: protocol.episodeBudgetUsd ?? protocol.config?.budgetUsd ?? protocol.budgetUsd }, expected));
    }
  }
  const progress = await exists(resolve(folder, 'progress.json')) ? await json(resolve(folder, 'progress.json')) : {},
    summary = await exists(resolve(folder, 'summary.json')) ? await json(resolve(folder, 'summary.json')) : null,
    invalidation = await exists(resolve(folder, 'invalidation.json')) ? await json(resolve(folder, 'invalidation.json')) : null;
  const missingRecords = [...(progress.missingOutcomes ?? []), ...(summary?.missingOutcomes ?? [])];
  const sameSlot = (x, d) => x.seed === d.seed && (x.arm ?? x.treatment) === d.arm && (d.scenario == null || x.scenario === d.scenario);
  for (const d of planned) if (!parsed.some(r => r.seed === d.seed && r.arm === d.arm && (d.scenario == null || r.scenario === d.scenario))) {
    const missing = missingRecords.find(x => sameSlot(x, d)), active = progress.activeEpisode && sameSlot(progress.activeEpisode, d) ? progress.activeEpisode : null,
      notAttempted = summary?.notAttempted?.some(x => sameSlot(x, d)), unsettled = missing ?? active;
    parsed.push({ ...d, scope: label, status: missing?.status ?? (active ? 'inflight_not_an_outcome' : notAttempted ? 'explicitly_not_attempted' : 'declared_not_completed'),
      file: null, error: missing?.error ?? null,
      costs: notAttempted && !unsettled ? costs({ usage: [], chargedBudgetUsd: 0 }) : costs(unsettled, Boolean(unsettled), number(protocol.episodeBudgetUsd ?? protocol.config?.budgetUsd)),
      validForComparison: false, integrity: null });
  }
  const campaignInvalidated = Boolean(invalidation);
  return { source: folder, protocolPath: await exists(protocolPath) ? protocolPath : null, protocolSha256: await exists(protocolPath) ? hash(protocol) : null,
    declaredRuns: protocol.plannedRuns ?? (planned.length || null), declared: planned, progress, summary, invalidation,
    worlds: parsed.map(w => ({ ...w, campaignInvalidated })) };
}
async function indexWorlds(file, label, expected) {
  const index = await json(file), worlds = [], declarations = [];
  const allArms = (index.profiles ?? []).flatMap(p => (p.p ?? p).arms ?? []),
    requiredPhases = [...new Set(allArms.map(a => ['B6', 'B9'].includes(a) ? 'paid' : 'free'))],
    campaignClosed = requiredPhases.every(phase => (index.phases ?? []).some(p => p.phase === phase && p.stopped === false && p.invalid === false));
  for (const profile of index.profiles ?? []) {
    const p = profile.p ?? profile, folder = await reference(profile.folder, file), scope = label + '/' + profile.name;
    const ds = Array.from({ length: p.seeds }, (_, i) => (p.arms ?? []).map(arm => ({ scope, seed: p.seedPrefix + '-' + String(i + 1).padStart(2, '0'), arm,
      episodeBudgetUsd: p.episodeBudgetUsd }))).flat();
    declarations.push(...ds);
    const scanned = await folderWorlds(folder, scope, expected, { ...p, planned: ds });
    for (const d of ds) {
      const run = (index.runs ?? []).find(x => x.seed === d.seed && x.arm === d.arm && x.folder === profile.folder),
        found = scanned.worlds.filter(x => x.seed === d.seed && x.arm === d.arm && x.file);
      if (found.length) worlds.push(...found);
      else if (run?.file) worlds.push(await inspectFile(await reference(run.file, file), { ...d, ...run, scope }, expected));
      else {
        const notLaunched = run?.status?.startsWith('not_launched');
        worlds.push({ ...d, file: null, status: run?.status ?? 'declared_not_completed', error: run?.error ?? null,
          costs: notLaunched ? { ...costs({ usage: [], chargedBudgetUsd: 0 }), fullEpisodeCapReservedWhenOutcomeMissingUsd: null } : costs(run, Boolean(run), number(d.episodeBudgetUsd)),
          validForComparison: false, integrity: null });
      }
    }
    for (const found of scanned.worlds.filter(x => x.file && !ds.some(d => d.seed === x.seed && d.arm === x.arm))) worlds.push({ ...found, undeclared: true });
  }
  return { source: file, declaredRuns: declarations.length, declared: declarations, indexSha256: hash(index), phases: index.phases ?? [],
    requiredPhases, campaignClosed, worlds: worlds.map(w => ({ ...w, indexClosureRequired: true, campaignClosed })) };
}
function effect(pairs, getter, unit) {
  const values = pairs.map(([a, b]) => ({ seed: a.seed, baseline: number(getter(a)), candidate: number(getter(b)) }));
  if (values.some(v => v.baseline == null || v.candidate == null)) return { unit, pairs: values, baselineMean: null, candidateMean: null, reduction: null, ci95: null, reason: 'missing_metric_not_imputed' };
  const a = mean(values.map(v => v.baseline)), b = mean(values.map(v => v.candidate));
  let ci95 = null;
  if (values.length >= 2 && a > 0) {
    let state = 0x19ab8d4f; const rand = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }, draws = [];
    for (let i = 0; i < 4000; i++) { const chosen = Array.from({ length: values.length }, () => values[Math.floor(rand() * values.length)]), x = mean(chosen.map(v => v.baseline)); if (x > 0) draws.push(1 - mean(chosen.map(v => v.candidate)) / x); }
    ci95 = [percentile(draws, .025), percentile(draws, .975)];
  }
  return { unit, pairs: values, baselineMean: a, candidateMean: b, reduction: a > 0 ? 1 - b / a : null, ci95,
    independentSeedWorlds: values.length, inference: 'Descriptive internally generated fixed seed worlds. Bootstrap resamples worlds, never tweets/people; small samples and scripted attention do not establish generalizability.' };
}
function compareScope(worlds) {
  const arms = [...new Set(worlds.map(w => w.arm).filter(Boolean))], candidate = arms.includes('B6') ? 'B6' : arms.includes('selective') ? 'selective' : arms.includes('active') ? 'active' : null;
  if (!candidate) return [];
  return arms.filter(a => a !== candidate).map(baseline => {
    const seeds = [...new Set(worlds.filter(w => [candidate, baseline].includes(w.arm)).map(w => w.seed))], pairs = [], blocked = [];
    for (const seed of seeds) {
      const references = worlds.filter(w => w.arm === baseline && w.seed === seed), candidates = worlds.filter(w => w.arm === candidate && w.seed === seed),
        a = references[0], b = candidates[0];
      const reasons = [];
      if (references.length > 1 || candidates.length > 1) reasons.push('duplicate_world_outcomes_no_selection_permitted');
      if (!a || !b) reasons.push('missing_declared_pair');
      else {
        if ((a.indexClosureRequired && !a.campaignClosed) || (b.indexClosureRequired && !b.campaignClosed)) reasons.push('index_phase_not_closed');
        if (a.campaignInvalidated || b.campaignInvalidated) reasons.push('campaign_explicitly_invalidated');
        if (!a.validForComparison || !b.validForComparison) reasons.push('failure_missing_integrity_or_unfrozen_world');
        for (const k of ['candidate', 'evaluator', 'simulator']) if (!a.integrity?.[k] || a.integrity[k] !== b.integrity?.[k]) reasons.push('mismatched_' + k);
        for (const k of ['world', 'protocol', 'corpus', 'model', 'clocks']) if (hash(a.comparisonMaterial?.[k] ?? null) !== hash(b.comparisonMaterial?.[k] ?? null)) reasons.push('mismatched_material_' + k);
        if (a.physical?.clocks.horizonMs !== b.physical?.clocks.horizonMs) reasons.push('mismatched_scoring_horizon');
        const cohortSignature = w => hash((w.physical?.clocks.cohorts ?? []).map(n => [n.id, n.responseEpisode, n.type, n.unit, n.quantity, n.createdAt, n.deadline]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))));
        if (cohortSignature(a) !== cohortSignature(b)) reasons.push('mismatched_scored_cohorts');
        for (const t of new Set([...Object.keys(a.physical?.services ?? {}), ...Object.keys(b.physical?.services ?? {})])) {
          if (!a.physical?.services[t] || !b.physical?.services[t] || a.physical.services[t].unit !== b.physical.services[t].unit) reasons.push('mismatched_native_unit_' + t);
        }
      }
      if (reasons.length) blocked.push({ seed, baselineStatus: a?.status ?? null, candidateStatus: b?.status ?? null, reasons });
      else pairs.push([a, b]);
    }
    const resourceTypes = [...new Set(pairs.flatMap(([a, b]) => [...Object.keys(a.physical.services), ...Object.keys(b.physical.services)]))];
    const descriptive = {
      sufficientRmst: effect(pairs, w => w.physical.clocks.sufficient?.restrictedMeanMs, 'ms'),
      firstUsefulRmst: effect(pairs, w => w.physical.clocks.firstUseful?.restrictedMeanMs, 'ms'),
      nativeDeficits: Object.fromEntries(resourceTypes.map(t => [t, effect(pairs, w => w.physical.services[t]?.uncoveredUnitHours, (pairs[0]?.[0].physical.services[t]?.unit ?? 'unknown') + '·h')])),
      deadlineCoverage: pairs.map(([a, b]) => ({ seed: a.seed, baseline: a.physical.deadlineCoverage, candidate: b.physical.deadlineCoverage,
        differencePoints: finite(a.physical.deadlineCoverage?.fraction) && finite(b.physical.deadlineCoverage?.fraction) ? 100 * (b.physical.deadlineCoverage.fraction - a.physical.deadlineCoverage.fraction) : null })),
      resourceTradeoffs: pairs.map(([a, b]) => ({ seed: a.seed, baselineKm: a.physical.vehicleKm, candidateKm: b.physical.vehicleKm,
        baselineFuelMl: a.physical.fuelMillilitres, candidateFuelMl: b.physical.fuelMillilitres,
        utilization: { baseline: a.physical.utilization, candidate: b.physical.utilization },
        nativeOverprovided: { baseline: Object.fromEntries(Object.entries(a.physical.services).map(([t, v]) => [t, v.overprovided])), candidate: Object.fromEntries(Object.entries(b.physical.services).map(([t, v]) => [t, v.overprovided])) } })),
      repairTiming: pairs.map(([a, b]) => ({ seed: a.seed, baseline: a.repairTiming, candidate: b.repairTiming })),
    };
    return { scope: worlds[0]?.scope, scenario: worlds[0]?.scenario, baseline, candidate, declaredPairs: seeds.length, comparablePairs: pairs.length, blocked,
      completeComparableCohort: blocked.length === 0 && seeds.length > 0,
      benefitClaimPermitted: blocked.length === 0 && seeds.length > 0,
      warning: blocked.length ? 'No cohort benefit may be inferred: failed/missing/changed worlds were retained. The valid-pair subset is diagnostic only, not a replacement cohort.' : 'All signs, native resources, tails and controls must be read together; observed gains in one measure are not automatic success for all KPIs.',
      diagnosticOnlyWhenIncomplete: descriptive };
  });
}
function aggregateCosts(worlds) {
  const xs = worlds.map(w => w.costs);
  return { worlds: worlds.length, knownCostSubtotalUsd: sum(xs.filter(x => finite(x?.knownCostSubtotalUsd)).map(x => x.knownCostSubtotalUsd)),
    worldsWithoutKnownCostSubtotal: xs.filter(x => !finite(x?.knownCostSubtotalUsd)).length,
    totalProviderCostUsd: xs.every(x => x?.totalCostKnown) ? sum(xs.map(x => x.totalProviderCostUsd)) : null,
    unknownCostCallsKnownCount: sum(xs.filter(x => finite(x?.unknownCostCalls)).map(x => x.unknownCostCalls)),
    worldsWithUnknownCallCount: xs.filter(x => !finite(x?.providerCalls)).length,
    chargedBudgetKnownSubtotalUsd: sum(xs.filter(x => finite(x?.chargedBudgetUsd)).map(x => x.chargedBudgetUsd)),
    worldsWithoutChargedBudget: xs.filter(x => !finite(x?.chargedBudgetUsd)).length,
    unknownReserveKnownSubtotalUsd: sum(xs.filter(x => finite(x?.unknownCostReserveUsd)).map(x => x.unknownCostReserveUsd)),
    missingOutcomeCapReserveUsd: sum(xs.filter(x => finite(x?.fullEpisodeCapReservedWhenOutcomeMissingUsd)).map(x => x.fullEpisodeCapReservedWhenOutcomeMissingUsd)),
    providerWallKnownSubtotalMs: sum(xs.filter(x => finite(x?.providerWallKnownSubtotalMs)).map(x => x.providerWallKnownSubtotalMs)),
    note: 'All loaded worlds contribute, including errors and uncoupled outcomes. Unknown totals are null, not zero. Budget-cap skips are zero only when their explicit record states they never launched.' };
}
export async function readFreshEvidence(options) {
  const expectedRaw = options.freeze ? await json(resolve(options.freeze)) : null,
    expected = expectedRaw ? { candidate: expectedRaw.candidateFingerprint ?? expectedRaw.candidate, evaluator: expectedRaw.evaluatorFingerprint ?? expectedRaw.evaluator,
      simulator: expectedRaw.simulatorBuild ?? expectedRaw.simulatorFingerprint ?? expectedRaw.engineBuild ?? expectedRaw.simulator } : null;
  if (expected && Object.values(expected).some(x => !x)) throw Error('Freeze must declare all three source fingerprints.');
  const campaigns = [];
  for (const role of ['primary', 'controls', 'info']) for (const p of options[role] ?? []) campaigns.push(await indexWorlds(resolve(p), role, expected));
  for (const role of ['s19', 'ablations', 'recovery', 'extra']) for (const p of options[role] ?? []) {
    const file = resolve(p), loaded = file.endsWith('.json') ? await json(file) : null;
    if (loaded?.profiles) campaigns.push(await indexWorlds(file, role, expected));
    else if (loaded && (loaded.metrics || loaded.results || loaded.timing)) campaigns.push({ source: file, declaredRuns: 1, worlds: [await inspectFile(file, { scope: role, episodeBudgetUsd: loaded.protocol?.budgetUsd }, expected)] });
    else campaigns.push(await folderWorlds(loaded ? dirname(file) : file, role, expected));
  }
  const seenFiles = new Map(), duplicateInputs = [], worlds = [];
  for (const w of campaigns.flatMap(c => c.worlds)) {
    if (w.file && seenFiles.has(w.file)) { duplicateInputs.push({ file: w.file, retainedScope: seenFiles.get(w.file).scope, repeatedScope: w.scope }); continue; }
    if (w.file) seenFiles.set(w.file, w);
    worlds.push(w);
  }
  const groups = new Map();
  for (const w of worlds) { const key = [w.scope, w.scenario ?? '', w.variant ?? ''].join('|'); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(w); }
  return {
    readerSchema: 'fresh-local-evidence-v3-k16-utilization',
    generatedAt: new Date().toISOString(), offlineReaderSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    requestedFreeze: expected, selectionPolicy: 'All declared worlds from every supplied index/protocol are retained. No beneficial seed, resource, subgroup, provider outcome or controller is selected after seeing results.',
    duplicateInputs,
    campaigns: campaigns.map(({ worlds, ...c }) => ({ ...c, outcomesLoaded: worlds.filter(w => w.file).length, states: counts(worlds, w => w.status) })),
    counts: { declared: campaigns.reduce((s, c) => s + (c.declaredRuns ?? c.worlds.length), 0), worlds: worlds.length,
      states: counts(worlds, w => w.status), validForComparison: worlds.filter(w => w.validForComparison).length,
      undeclared: worlds.filter(w => w.undeclared).length },
    costs: aggregateCosts(worlds), worlds, comparisons: [...groups.values()].flatMap(compareScope),
    kpiEvidence: {
      K01: 'Native unmet-demand integrals, separately per resource and world; no cross-unit composite.',
      K02: 'First useful and sufficient physical-service restricted means, median/p95 observed values, censoring and cohort denominators.',
      K03: 'Sufficient service by an eligible observable deadline. Future/missing windows remain separate.',
      K08: 'Silent/remote native metrics, demand, serviced cohorts, deadline windows, censoring and group membership missingness; no non-inferiority conclusion from small underpowered groups.',
      K09: 'Distance, fuel, native overprovided and failed trips; separately measured vehicle committed/moving/waiting/blocked hours and staff committed/transit/field-work person-hours. Missing/legacy utilization stays null, never zero; overlapping scopes are not summed. Total economic costs remain unknown without pricing.',
      K15: 'Complete same-hash, same-seed/protocol contrasts with B5/B8/B9; missing or failed worlds block cohort benefit claims. A deterministic allocator is not labeled GenAI reasoning.',
      K16: 'The scorer-only proposalFunnel export retains all owners and historical reviews/versions, authorization, exact actions/operations and independent positive physical receipts. Partial, rejected, missing and intermediate-only outcomes stay visible; delegated scopes never double the unique physical receipt count. Legacy absent or inconsistent exports and missing review history leave conversion unknown.',
      K22: 'Recovery cohort, retained attention, backlog timeline, source-review waits and censoring. Closure of a semantic receipt is not independently scored semantic quality.',
      K23: 'Human public comprehension unmeasured. Automated finance/UI tests demonstrate controls, not the requested ≥90% real-person comprehension.',
      K24: 'Source download, completed-stage distributions, provider wall/failures, recovery waits and total episode wall; concurrent stages are not summed.',
      K25: 'All known charges, missing/failed usage and reserve exposure. Infrastructure/human wages/tool tariffs not present are not assumed free.',
    },
    limitations: ['Internal procedural scenarios, scripted human delays and fixed seeds are not external calibration or measured responder productivity.',
      'Native service counts are not lives saved. The configured provider is reported literally; Gemma results do not prove Gemini results.',
      'A descriptive positive point estimate does not establish the proposed magnitude, favorable confidence interval or top-1 status.',
      'Scorer physical fields are read offline only after execution; this reader never passes world truth to a planner or runs a model.',
      'A supplied path omitted from this invocation cannot be silently inferred as successful or zero cost.'] };
}
const display = x => x == null ? 'unknown' : typeof x === 'number' ? x.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : String(x);
export function evidenceMarkdown(r) {
  const lines = ['# Fresh local evidence — complete readout', '', 'Offline analysis of every declared world in the supplied evidence. Unknown is not zero. No native unit is translated into lives.', '',
    `Requested freeze: candidate ${r.requestedFreeze?.candidate ?? 'unspecified'}, evaluator ${r.requestedFreeze?.evaluator ?? 'unspecified'}, simulator ${r.requestedFreeze?.simulator ?? 'unspecified'}.`, '',
    `Declared worlds: ${r.counts.declared}; loaded/retained world slots: ${r.counts.worlds}; valid for comparison: ${r.counts.validForComparison}. States: ${JSON.stringify(r.counts.states)}.`, '',
    `Known provider-cost subtotal: $${display(r.costs.knownCostSubtotalUsd)}. Fully known total: $${display(r.costs.totalProviderCostUsd)}. Known charged exposure: $${display(r.costs.chargedBudgetKnownSubtotalUsd)}. Missing outcome caps reserved: $${display(r.costs.missingOutcomeCapReserveUsd)}. Worlds without a call count: ${r.costs.worldsWithUnknownCallCount}.`, '',
    '| Scope | Scenario / seed | Arm | Status | First useful RMST min | Sufficient RMST min | Sufficient / eligible (censored) | On time / observable | Cost known subtotal USD | Unknown-cost calls | Charged USD |',
    '|---|---|---|---|---:|---:|---|---|---:|---:|---:|'];
  for (const w of r.worlds) {
    const c = w.physical?.clocks, d = w.physical?.deadlineCoverage;
    lines.push(`| ${w.scope} | ${w.scenario ?? ''} / ${w.seed ?? ''} | ${w.arm ?? 'n/a'} | ${w.status} | ${display(c?.firstUseful?.restrictedMeanMs == null ? null : c.firstUseful.restrictedMeanMs / 60000)} | ${display(c?.sufficient?.restrictedMeanMs == null ? null : c.sufficient.restrictedMeanMs / 60000)} | ${c?.sufficient ? `${c.sufficient.reached}/${c.sufficient.eligible} (${c.sufficient.rightCensored})` : 'unknown'} | ${d ? `${d.met}/${d.eligible}` : 'unknown'} | ${display(w.costs?.knownCostSubtotalUsd)} | ${display(w.costs?.unknownCostCalls)} | ${display(w.costs?.chargedBudgetUsd)} |`);
  }
  lines.push('', '## K09 — occupied capacity, separate scopes', '', 'Vehicle time and person-time use different units. Transit, field work and waiting are overlapping subscopes of committed capacity; they are not summed into productive labor or money.', '',
    '| Scope / seed | Arm | Vehicle committed h | Vehicle moving h | Staff committed person·h | Staff transit person·h | Staff field work person·h |',
    '|---|---|---:|---:|---:|---:|---:|');
  for (const w of r.worlds) {
    const u = w.physical?.utilization;
    lines.push(`| ${w.scope} / ${w.seed ?? ''} | ${w.arm ?? 'n/a'} | ${display(u?.vehicleCommittedHours)} | ${display(u?.vehicleMovingHours)} | ${display(u?.staffCommittedPersonHours)} | ${display(u?.staffTransitPersonHours)} | ${display(u?.staffFieldWorkPersonHours)} |`);
  }
  lines.push('', '## K16 — review to independent physical service', '', 'All owner-scoped plans are retained, including rejected and intermediate-only completions. A coordinator and delegated copy can share one physical receipt; the unique operation column prevents double counting. Local review wall clocks and source service clocks are not subtracted.', '',
    '| Scope / seed | Arm | Proposals | Historically reviewed | Approved | Issued | Useful physical service | Partial useful | Rejected | Completed without direct service | Unique positive operations | Reviewed→useful rate |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const w of r.worlds) {
    const f = w.funnel, d = f?.denominators;
    lines.push(`| ${w.scope} / ${w.seed ?? ''} | ${w.arm ?? 'n/a'} | ${display(d?.proposals)} | ${display(d?.reviewedProposals)} | ${display(d?.approvedProposals)} | ${display(d?.issuedProposals)} | ${display(d?.usefulServiceProposals)} | ${display(d?.partialUsefulServiceProposals)} | ${display(d?.rejectedProposals)} | ${display(d?.completedWithoutDirectUsefulService)} | ${display(d?.uniqueUsefulSourceOperations)} | ${display(f?.reviewedToUsefulRate)} |`);
  }
  lines.push('', '## Complete paired comparisons', '', 'Negative reductions indicate a worse candidate. Invalid/incomplete cohorts retain diagnostic pairs but cannot support a benefit claim.', '');
  for (const c of r.comparisons) {
    const d = c.diagnosticOnlyWhenIncomplete;
    lines.push(`- ${c.scope} ${c.scenario ?? ''}: ${c.candidate} versus ${c.baseline}, ${c.comparablePairs}/${c.declaredPairs} comparable seed pairs. Benefit claim ${c.benefitClaimPermitted ? 'eligible for cautious assessment' : 'blocked'}. Sufficient RMST reduction ${display(d.sufficientRmst.reduction == null ? null : d.sufficientRmst.reduction * 100)}%; first useful ${display(d.firstUsefulRmst.reduction == null ? null : d.firstUsefulRmst.reduction * 100)}%.`);
    for (const [type, e] of Object.entries(d.nativeDeficits)) lines.push(`  - ${type}: baseline ${display(e.baselineMean)}, candidate ${display(e.candidateMean)} ${e.unit}; reduction ${display(e.reduction == null ? null : e.reduction * 100)}%; CI95 ${e.ci95 ? e.ci95.map(v => display(100 * v)).join(' to ') + '%' : 'unavailable'}.`);
    if (c.blocked.length) lines.push(`  - Retained blocked pairs: ${c.blocked.map(x => `${x.seed} (${x.reasons.join(', ')})`).join('; ')}.`);
  }
  lines.push('', '## Guardrails and evidence still missing', '');
  for (const [k, v] of Object.entries(r.kpiEvidence)) lines.push(`- ${k}: ${v}`);
  lines.push('', 'Native deficits, excess, km/fuel, subgroup outcomes, full error lists, hash validation, proposal states, stage distributions, reserve exposure and recovery timelines are in the companion JSON. The table does not replace them.', '', '## Limits', '');
  for (const s of r.limitations) lines.push('- ' + s);
  return lines.join('\n') + '\n';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (const arg of process.argv.slice(2)) {
    const i = arg.indexOf('='), key = arg.slice(2, i), value = arg.slice(i + 1);
    if (i < 0 || !arg.startsWith('--')) throw Error('Use --primary=INDEX --controls=INDEX --info=INDEX --freeze=FREEZE [--s19=FOLDER --ablations=FOLDER --recovery=REPORT] --out=PREFIX; repeated inputs accepted.');
    if (['freeze', 'out'].includes(key)) options[key] = value;
    else if (['primary', 'controls', 'info', 's19', 'ablations', 'recovery', 'extra'].includes(key)) (options[key] ??= []).push(value);
    else throw Error('Unsupported readout input: ' + key);
  }
  if (!['primary', 'controls', 'info', 's19', 'ablations', 'recovery', 'extra'].some(k => options[k]?.length)) throw Error('At least one evidence path is required; this reader never discovers a favorable report automatically.');
  const report = await readFreshEvidence(options), out = resolve(options.out ?? '.local/fresh-evidence-readout');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out + '.json', JSON.stringify(report, null, 2));
  await writeFile(out + '.md', evidenceMarkdown(report));
  console.log(JSON.stringify({ json: out + '.json', markdown: out + '.md', counts: report.counts, costs: report.costs,
    blockedComparisons: report.comparisons.filter(c => !c.benefitClaimPermitted).length, modelCallsMadeByReader: 0 }));
}
