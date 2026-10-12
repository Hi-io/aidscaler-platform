// Bounded K22 integration control. Controller stopping reads received sources
// and local queues only. Simulator truth appears solely in the final scorer.
import { createHarness, scriptedReview, buildFingerprint, evaluatorFingerprint } from '../evaluation/harness.mjs';
import { checkFinalBuilds, requireLoadedSimulatorBuild } from '../evaluation/simulator-build.mjs';
import { installResponseBenchmark } from '../../disaster-response-simulator/generators/response-benchmark.mjs';
import { selectOriginalSources, parseExplicitCurrentRequest, conventionalInterpret } from '../evaluation/conventional-source.mjs';
import { receivedProgressReference, routinePublicCommentary } from '../src/source-relevance.mjs';
import { configureResponsePolicy, responseQueue } from '../src/response-policy.mjs';
import { draftReceivedResponse } from '../src/discovery-response.mjs';
import { ModelBudgetPool } from '../src/budget-pool.mjs';
import { operationTrace, capturePhysicalDepartures } from '../evaluation/physical-trace.mjs';
import { hash } from '../src/store.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const versionOf = s => s.sourceVersion ?? s.version ?? 1;
const content = s => ({ id: s.id, version: versionOf(s), text: s.text ?? '', location: s.location ?? null,
  publishedAt: s.publishedAt ?? null, attachments: s.attachments ?? [], deleted: Boolean(s.deleted) });
const sourceKey = s => `${s.id}:${versionOf(s)}`;
const inactive = ['completed', 'received', 'failed', 'cancelled', 'service'];
const settledDiscovery = ['ready', 'inconclusive', 'cancelled'];

export function sealSourceCohort(sources) {
  return sources.map(source => ({ key: sourceKey(source), id: source.id, version: versionOf(source),
    contentHash: hash(content(source)), source: structuredClone(source) }))
    .sort((a, b) => (a.source.publishedAt ?? 0) - (b.source.publishedAt ?? 0) || a.key.localeCompare(b.key));
}

/** A valid interpretation receipt acknowledges reading, never truth/accuracy.
 * Failed/truncated/rejected batches and changed versions remain attention. */
export function sourceRecoveryDisposition(item, { current, receipts = [], freeDisposition, retainedVersion } = {}) {
  const base = { key: item.key, id: item.id, version: item.version, contentHash: item.contentHash,
    retainedOriginalVersion: Boolean(retainedVersion), closed: false };
  if (!retainedVersion) return { ...base, disposition: 'missing_durable_version' };
  if (!current || current.deleted || current.state === 'erased' || versionOf(current) !== item.version || hash(content(current)) !== item.contentHash)
    return { ...base, disposition: 'source_revision_pending', currentVersion: current ? versionOf(current) : null,
      note: 'The sealed original is retained; the current revision requires its own reading/withdrawal receipt.' };
  if (freeDisposition) return { ...base, ...freeDisposition, closed: true };
  const matching = receipts.filter(r => r.sources?.some(s => s.id === item.id && s.version === item.version));
  const valid = r => !r.coverage?.truncatedSources?.includes(item.id) && !r.coverage?.rejectedObservations?.length &&
    ['interpreted_unverified', 'reconciled_progress_unverified', 'routine_commentary_unverified'].includes(r.state);
  const receipt = matching.find(valid) ?? matching[0];
  if (!receipt) return { ...base, disposition: 'pending' };
  if (receipt.coverage?.truncatedSources?.includes(item.id))
    return { ...base, disposition: 'truncated_pending_review', receipt: receipt.id };
  if (receipt.coverage?.rejectedObservations?.length || receipt.state === 'partially_interpreted_unverified')
    return { ...base, disposition: 'rejected_pending_review', receipt: receipt.id,
      note: 'Batch-level rejection cannot be assigned safely to an uncited individual source.' };
  if (!['interpreted_unverified', 'reconciled_progress_unverified', 'routine_commentary_unverified'].includes(receipt.state))
    return { ...base, disposition: 'receipt_state_pending', receipt: receipt.id };
  return { ...base, disposition: 'valid_semantic_receipt_unverified', receipt: receipt.id, closed: true,
    note: 'Schema/provenance-valid interpretation, not independent accuracy or a verified need.' };
}

export async function runSourceRecovery(options = {}) {
  const cfg = { mode: 'parser', seed: 'source-recovery-01', count: 24, noise: 96, reposts: 2,
    grid: 9, extentKm: 6, sourceCutoffMs: 300000, horizonMs: 10800000,
    wallLimitMs: 600000, batchSize: 30, maxModelCalls: 32, budgetUsd: 0.15,
    clarificationWorkers: 2, reviewMs: 30000, formalDelayMs: 3600000, writeReport: true, ...options };
  if (!['parser', 'real'].includes(cfg.mode) || !Number.isSafeInteger(cfg.sourceCutoffMs) || cfg.sourceCutoffMs < 0 ||
    !Number.isSafeInteger(cfg.horizonMs) || cfg.horizonMs <= cfg.sourceCutoffMs ||
    !Number.isSafeInteger(cfg.batchSize) || cfg.batchSize < 1 || cfg.batchSize > 35 ||
    !Number.isSafeInteger(cfg.wallLimitMs) || cfg.wallLimitMs < 1000 ||
    !Number.isSafeInteger(cfg.maxModelCalls) || cfg.maxModelCalls < 1 || cfg.maxModelCalls > 64 ||
    !(cfg.budgetUsd > 0 && cfg.budgetUsd <= 1)) throw Error('Invalid bounded source recovery protocol');
  const id = `source-recovery-${cfg.mode}-${Date.now()}`, started = performance.now(),
    fingerprints = { candidate: await buildFingerprint(), evaluator: await evaluatorFingerprint(), simulator: await requireLoadedSimulatorBuild() },
    scriptFingerprint = hash(await readFile(new URL(import.meta.url), 'utf8')),
    protocol = { id, at: new Date().toISOString(), ...cfg, fingerprints, scriptFingerprint,
      scope: 'Fixed HTTP-received source-version cohort recovery with finite field checks, owner review and physical execution; not semantic accuracy, comparative gain or human productivity.',
      stopping: 'Only sealed source dispositions and received local jobs/proposals/queries/inspections/operations/needs; never simulator truth.',
      revisionPolicy: 'Changed/deleted/unversioned changed sealed content remains retained attention; never credited by a stale receipt.',
      subsequentSources: 'Later records are retained and counted separately, outside the fixed recovery denominator.' },
    folder = `reports/source-recovery/${id}`;
  if (cfg.writeReport) {
    await mkdir(folder, { recursive: true });
    await writeFile(`${folder}/protocol.json`, JSON.stringify(protocol, null, 2));
  }
  const providerCalls = [], errors = [], timeline = [], batches = [], sourceReviews = [], http = { calls: 0, blockedExternal: 0 };
  const originalFetch = globalThis.fetch;
  if (cfg.mode === 'parser') globalThis.fetch = async (input, params) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      http.blockedExternal++; throw Error('No-paid source recovery refuses external HTTP');
    }
    http.calls++; return originalFetch(input, params);
  };
  const provider = cfg.mode === 'parser' ? { complete: async request => {
    if (request.task !== 'perception' || request.tools.length) throw Error('Parser control only accepts perception without tools');
    const input = JSON.parse(request.messages.find(m => m.role === 'user').content), at = performance.now();
    const observations = input.sources.flatMap(s => conventionalInterpret({ ...s, id: s.id ?? s.reference }, input.knownLocations))
      .map(o => ({ text: o.text, kind: o.kind, sourceIds: o.sourceIds, location: o.location,
        resourceType: o.resourceType, quantity: o.quantity, unit: o.unit, timeStatus: o.timeStatus }));
    if (observations.length > 50) throw Error('Parser output exceeds the ordinary finite observation contract');
    providerCalls.push({ sources: input.sources.length, sourceHash: hash(input.sources), observations: observations.length, costUsd: 0 });
    return { model: 'public-parser-source-recovery-control', finishReason: 'stop',
      message: { content: JSON.stringify({ observations }) }, usage: { providerCost: 0, wallMs: performance.now() - at } };
  } } : undefined;
  let h, report;
  try {
    h = await createHarness({ scenario: 'S23', seed: cfg.seed, organizations: 4, provider,
      awaitVerifications: false, config: { grid: cfg.grid, extentKm: cfg.extentKm, durationMs: cfg.horizonMs,
        healthReports: false, recurringNeeds: false, postsPerHour: 0, observationRate: 1, sourceIndexMs: 0,
        clarificationWorkers: cfg.clarificationWorkers, backgroundTraffic: 0, packetLoss: 0,
        reviewMs: cfg.reviewMs, toolQuota: 20000, sourceRequestLimit: 1000000 },
      budgetUsd: cfg.budgetUsd, maxCalls: 1, platformConfig: {
        ...(cfg.mode === 'parser' ? { apiKey: undefined, modelId: 'public-parser-source-recovery-control' } : {}),
        autoInvestigate: false, modelScopePrefix: id, modelScopeCalls: cfg.maxModelCalls,
        hourlyCallLimit: cfg.maxModelCalls, hourlyBudgetUsd: cfg.budgetUsd,
        modelBudgetPool: new ModelBudgetPool({ budgetUsd: cfg.budgetUsd, calls: cfg.maxModelCalls }) } });
    const w = h.lab.world, app = h.apps[0], departures = capturePhysicalDepartures(w),
      corpus = installResponseBenchmark(w, { count: cfg.count, noise: cfg.noise, reposts: cfg.reposts, formalDelayMs: cfg.formalDelayMs });
    const finish = app.connector.finishModel.bind(app.connector);
    app.connector.finishModel = async (model, usage) => {
      const result = await finish(model, usage);
      w.advance(Math.min(cfg.horizonMs, Math.max(w.now, result.requestedAt + Math.ceil(Math.max(w.config.modelLatencyMs, usage?.wallMs ?? 0)))), { maxEvents: 1000000 });
      return result;
    };
    for (const owner of h.apps) {
      const action = owner.connector.action.bind(owner.connector);
      owner.connector.action = async (type, params, key, extra) => {
        const requestedAt = w.now, result = await action(type, params, key, extra);
        if (type === 'review') sourceReviews.push({ org: owner.config.org, id: params.id, requestedAt,
          decision: params.decision, returnedAt: w.now });
        return result;
      };
    }
    async function review(owner, proposal) {
      if (proposal?.state === 'awaiting_review' && await scriptedReview(owner, proposal)) await owner.worker.execute(proposal.id);
    }
    async function actDraft(result) {
      if (result?.proposalId) await review(app, await app.store.get('org0', 'proposal', result.proposalId));
    }
    async function propagate() {
      for (const owner of h.apps) {
        await owner.ingestion.sync();
        for (const p of await owner.store.list(owner.config.org, 'proposal', 2000)) {
          if (p.originPartner || owner === app) await review(owner, p);
          const current = await owner.store.get(owner.config.org, 'proposal', p.id);
          if (['authorized', 'executing', 'awaiting_partner'].includes(current.state)) {
            try { await owner.worker.execute(current.id); }
            catch (e) { errors.push({ phase: 'execute', at: w.now, org: owner.config.org, code: e.code ?? e.name }); }
          }
        }
        await owner.network.refresh(); await owner.worker.drain(32);
      }
    }
    w.advance(60000);
    for (const owner of h.apps) {
      for (const target of ['map', 'inventory', 'vehicles', 'policy'])
        await owner.connector.action('query', { target }, `${id}-${owner.config.org}-${target}`);
      await owner.ingestion.sync();
      const actor = (await owner.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'", [owner.config.org])).rows[0];
      await configureResponsePolicy(owner.store, actor, { version: 0, order: 'deadline_then_priority', maxOpenReviews: 8,
        investigationCooldownMs: 60000, reason: 'Predeclared source-recovery control with finite ordinary owner review' }, `${id}-policy-${owner.config.org}`);
      if (owner !== app) {
        for (const kind of ['resource', 'vehicle']) for (const item of (await owner.store.list(owner.config.org, kind, 2000)).filter(r => r.owner === owner.config.org))
          await owner.network.share(actor, { kind, id: item.id, version: item.version, to: 'org0' }, `${id}-share-${item.id}`);
        await owner.worker.drain();
      }
    }
    if (w.now > cfg.sourceCutoffMs) throw Error('Startup crossed the predeclared source intake cutoff');
    w.advance(cfg.sourceCutoffMs, { maxEvents: 1000000 });
    for (const owner of h.apps) await owner.ingestion.sync();
    const cohort = sealSourceCohort(await app.store.list('org0', 'signal', 10000)),
      places = (await app.store.get('org0', 'context', 'geography')).map.places,
      originals = selectOriginalSources(cohort.map(c => c.source)), representativeIds = new Set(originals.map(s => s.id)),
      freeDispositions = new Map(), pending = [], checked = new Set();
    for (const item of cohort) {
      if (!representativeIds.has(item.id)) freeDispositions.set(item.key, { disposition: 'explicit_repost_link_retained',
        note: 'Grouped by the same explicit public lineage/content/location rule; original records remain durable.' });
      else pending.push(item);
    }
    const confirmations = [];
    async function confirm(leads, references) {
      for (const lead of leads) if (lead.kind === 'need' && lead.location && lead.timeStatus !== 'historical' && !checked.has(lead.location)) {
        checked.add(lead.location); const requestedAt = w.now;
        const q = await app.connector.action('verify', { target: 'building', id: lead.location, method: 'clarification' }, `${id}-explicit-${lead.location}`);
        confirmations.push({ location: lead.location, id: q.id, references, requestedAt });
      }
    }
    let cursor = 0, turns = 0, status = 'incomplete_horizon', dispositions = [], localState = {}, recoveredAt = null;
    async function snapshot() {
      const signals = new Map((await app.store.list('org0', 'signal', 10000)).map(s => [s.id, s]));
      const receipts = await app.store.list('org0', 'semantic_receipt', 10000);
      dispositions = await Promise.all(cohort.map(async item => sourceRecoveryDisposition(item, {
        current: signals.get(item.id), receipts, freeDisposition: freeDispositions.get(item.key),
        retainedVersion: await app.store.get('org0', 'source_version', `${item.id}_${item.version}`, false) })));
      const states = await Promise.all(h.apps.map(owner => owner.connector.state()));
      const jobs = (await Promise.all(h.apps.map(owner => owner.store.query("SELECT kind,state,count(*)::int AS count FROM jobs WHERE org=$1 GROUP BY kind,state", [owner.config.org])))).flatMap(r => r.rows);
      const proposals = (await Promise.all(h.apps.map(owner => owner.store.list(owner.config.org, 'proposal', 2000)))).flat();
      const discoveries = await app.store.list('org0', 'discovery_run', 10000), queue = await responseQueue(app.store, 'org0');
      localState = { openJobs: jobs.filter(j => ['queued', 'retry', 'running'].includes(j.state)).reduce((n, j) => n + j.count, 0), jobs,
        openProposals: proposals.filter(p => ['awaiting_review', 'authorized', 'executing', 'awaiting_partner', 'conditionally_authorized', 'needs_clarification'].includes(p.state)).length,
        pendingQueries: states.flatMap(s => s.queries ?? []).filter(q => q.state === 'pending').length,
        pendingInspections: states.flatMap(s => s.inspections ?? []).filter(i => !['completed', 'inconclusive', 'timeout', 'failed', 'cancelled'].includes(i.state)).length,
        activeReceivedOperations: states.flatMap(s => s.operations ?? []).filter(o => !inactive.includes(o.state)).length,
        unresolvedDiscoveries: discoveries.filter(d => !settledDiscovery.includes(d.state)).map(d => ({ id: d.id, state: d.state })),
        uncoveredReceivedNeeds: queue.total };
      const closed = dispositions.filter(d => d.closed).length;
      timeline.push({ at: w.now, wallMs: performance.now() - started, eligible: cohort.length, closed, pending: cohort.length - closed, ...localState });
      return closed === cohort.length && !localState.openJobs && !localState.openProposals && !localState.pendingQueries &&
        !localState.pendingInspections && !localState.activeReceivedOperations && !localState.unresolvedDiscoveries.length && !localState.uncoveredReceivedNeeds;
    }
    while (w.now < cfg.horizonMs) {
      if (performance.now() - started >= cfg.wallLimitMs) { status = 'incomplete_wall_limit'; break; }
      await propagate();
      await actDraft(await draftReceivedResponse(app, `${id}-turn-${turns++}`));
      const operations = await app.store.list('org0', 'operation', 10000), selected = [];
      while (cursor < pending.length && selected.length < cfg.batchSize) {
        const item = pending[cursor++], source = await app.store.get('org0', 'signal', item.id, false);
        if (!source || versionOf(source) !== item.version || hash(content(source)) !== item.contentHash) continue;
        const progress = receivedProgressReference(source, operations), routine = routinePublicCommentary(source), explicit = parseExplicitCurrentRequest(source, places);
        if (progress) freeDispositions.set(item.key, { disposition: 'received_progress_retained', ...progress });
        else if (routine) freeDispositions.set(item.key, { disposition: 'routine_commentary_retained', ...routine });
        else if (explicit) {
          freeDispositions.set(item.key, { disposition: 'explicit_free_unverified', note: 'Explicit public request directs the same finite confirmation; text is not verified demand.' });
          await confirm([explicit], [item.id]);
        } else if (/^ARCHIVE\b/i.test(source.text ?? '')) freeDispositions.set(item.key, { disposition: 'explicit_archive_label_retained',
          note: 'The public historical label is retained, not independently validated by this control.' });
        else selected.push(item);
      }
      if (selected.length) {
        const episode = `${id}-batch-${batches.length}`, requestedAt = w.now;
        try {
          const result = await app.discovery.run({ ids: selected.map(s => s.id) }, episode);
          batches.push({ episode, requestedAt, availableAt: w.now, sourceKeys: selected.map(s => s.key), state: result.state, semanticReceipt: result.semanticReceipt });
          await actDraft(result);
        } catch (e) {
          batches.push({ episode, requestedAt, availableAt: w.now, sourceKeys: selected.map(s => s.key), state: 'failed', code: e.code ?? e.name });
          errors.push({ phase: 'perception', at: w.now, code: e.code ?? e.name, sourceKeys: selected.map(s => s.key) });
        }
      }
      if (await snapshot()) { status = 'recovered'; recoveredAt = w.now; break; }
      if (!selected.length) w.advance(Math.min(cfg.horizonMs, w.now + 60000), { maxEvents: 1000000 });
    }
    const stoppedAt = w.now;
    await snapshot();
    const sourceReviewReceipts = sourceReviews.map(r => {
      const p = w.state.proposals.find(p => p.id === r.id);
      return { ...r, createdAt: p?.createdAt ?? null, reviewedAt: p?.reviewedAt ?? null,
        censored: p?.reviewedAt == null, state: p?.state ?? 'unknown' };
    });
    // Scoring is isolated from the above controller. Preserve horizon outcomes
    // while declaring that no fresh decisions are made after the stopping point.
    w.advance(cfg.horizonMs, { maxEvents: 1000000 });
    for (const owner of h.apps) await owner.ingestion.sync();
    const outcomes = corpus.gold.map(g => {
      const n = w.need(g.needId); return { id: n.id, type: n.type, unit: n.unit, quantity: n.quantity,
        served: Math.min(n.quantity, n.served), overprovided: Math.max(0, n.served - n.quantity),
        firstServiceAt: n.firstServiceAt, sufficientAt: n.completedAt,
        firstUsefulCensored: n.firstServiceAt == null, sufficientCensored: n.completedAt == null };
    });
    const durable = await Promise.all(h.apps.map(async owner => ({ org: owner.config.org,
      cohortVersionRows: (await Promise.all(cohort.map(c => owner.store.get(owner.config.org, 'source_version', `${c.id}_${c.version}`, false)))).filter(Boolean).length,
      signals: (await owner.store.list(owner.config.org, 'signal', 10000)).length,
      subsequentSourceVersions: (await owner.store.list(owner.config.org, 'source_version', 10000)).filter(r =>
        !cohort.some(c => r.id === `${c.id}_${c.version}`)).length,
      operations: (await owner.store.list(owner.config.org, 'operation', 10000)).map(operationTrace) })));
    const usage = (await Promise.all(h.apps.map(owner => owner.store.query('SELECT model,state,cost_usd,reserved_usd,wall_ms,input_tokens,output_tokens,error FROM usage')))).flatMap(r => r.rows);
    const finalBuilds = await checkFinalBuilds(fingerprints, { candidate: buildFingerprint, evaluator: evaluatorFingerprint });
    if (finalBuilds.invalidStatus) status = finalBuilds.invalidStatus;
    errors.push(...finalBuilds.errors);
    report = { protocol, status, controllerStoppedAt: stoppedAt, recoveredAt,
      recoveryDurationMs: recoveredAt == null ? cfg.horizonMs - cfg.sourceCutoffMs : recoveredAt - cfg.sourceCutoffMs,
      recoveryCensored: recoveredAt == null, actualWallMs: performance.now() - started,
      cohort: cohort.map(({ source, ...item }) => item), cohortHash: hash(cohort.map(c => [c.key, c.contentHash])),
      dispositions, results: { eligible: cohort.length, closed: dispositions.filter(d => d.closed).length,
        retainedAttention: dispositions.filter(d => !d.closed).length,
        dispositions: Object.fromEntries(Object.entries(Object.groupBy(dispositions, d => d.disposition)).map(([k, rows]) => [k, rows.length])),
        durable, physicalSufficient: outcomes.filter(n => !n.sufficientCensored).length, physicalEligible: outcomes.length },
      localState, timeline, batches, confirmations, sourceReviewReceipts, outcomes, usage, http, providerCalls,
      paidCalls: cfg.mode === 'parser' ? 0 : usage.filter(r => r.model !== 'public-parser-source-recovery-control').length,
      paidCostUsd: cfg.mode === 'parser' ? 0 : usage.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0),
      unknownCostReserveUsd: usage.filter(r => r.cost_usd == null).reduce((n, r) => n + Number(r.reserved_usd ?? 0), 0),
      scorerOnlyPhysical: { manifest: w.manifest, corpusManifest: corpus.manifest,
        operations: w.state.operations.map(operationTrace), departures },
      invariants: w.invariants(), errors, finalBuilds,
      limitations: ['Internally authored public text cohort and finite scripted review, not a measured human workforce.',
        'Four independent in-memory databases in one process, not a production deployment.',
        'A valid semantic receipt is acknowledgement/provenance, not precision or fake-news accuracy.',
        'Subsequent records outside the sealed source-version cohort are retained but not credited as recovered.',
        'Pending, rejected, truncated and revised sources remain explicit; no controller stopping uses physical gold.',
        cfg.mode === 'parser' ? 'Recorded public parser substitutes perception: zero paid calls, no GenAI-quality claim.' : 'Real configured model identity/cost retained; no attribution to Gemini if a different model runs.'] };
    if (report.invariants.length || http.blockedExternal) report.status = 'failed_integrity';
  } catch (e) {
    errors.push({ phase: 'control', code: e.code ?? e.name, at: h?.lab.world.now ?? null });
    report = { protocol, status: 'failed_control', actualWallMs: performance.now() - started, errors,
      results: { eligible: null, closed: 0, retainedAttention: null }, timeline, batches, providerCalls, http,
      paidCalls: cfg.mode === 'parser' ? 0 : null, paidCostUsd: cfg.mode === 'parser' ? 0 : null,
      recoveryCensored: true, invariants: h?.lab.world.invariants() ?? [],
      note: 'Control failure is retained, never counted as backlog recovery.' };
  } finally {
    if (h) await h.close();
    globalThis.fetch = originalFetch;
  }
  if (cfg.writeReport) await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  return { ...report, reportFile: cfg.writeReport ? `${folder}/report.json` : null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(x => x.replace(/^--/, '').split('=')));
  const report = await runSourceRecovery({ ...(args.mode ? { mode: args.mode } : {}),
    ...(args.seed ? { seed: args.seed } : {}),
    ...Object.fromEntries([['needs', 'count'], ['noise', 'noise'], ['wall-ms', 'wallLimitMs'], ['cutoff-ms', 'sourceCutoffMs'],
      ['horizon-ms', 'horizonMs'], ['calls', 'maxModelCalls'], ['budget', 'budgetUsd']]
      .filter(([arg]) => args[arg] !== undefined).map(([arg, key]) => [key, Number(args[arg])])) });
  console.log(JSON.stringify({ reportFile: report.reportFile, status: report.status, results: report.results,
    paidCalls: report.paidCalls, errors: report.errors.length, invariants: report.invariants.length }));
  if (report.status !== 'recovered' || report.errors.length || report.invariants.length) process.exitCode = 1;
}
