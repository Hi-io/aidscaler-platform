// Private, no-paid control of the combined pipeline. Not a candidate or evaluator source.
import { createHarness, scriptedReview, buildFingerprint, evaluatorFingerprint } from '../evaluation/harness.mjs';
import { installResponseBenchmark } from '../../disaster-response-simulator/generators/response-benchmark.mjs';
import { ENGINE_BUILD } from '../../disaster-response-simulator/contracts/config.mjs';
import { evaluate } from '../../disaster-response-simulator/evaluation/metrics.mjs';
import { conventionalInterpret, selectOriginalSources } from '../evaluation/conventional-source.mjs';
import { configureResponsePolicy, responseQueue } from '../src/response-policy.mjs';
import { draftReceivedResponse } from '../src/discovery-response.mjs';
import { percentile } from '../src/evaluation.mjs';
import { capturePhysicalDepartures, operationTrace } from '../evaluation/physical-trace.mjs';
import { hash } from '../src/store.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const originalFetch = globalThis.fetch;
let httpCalls = 0, blockedExternalCalls = 0;
globalThis.fetch = async (input, options) => {
  const u = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
    blockedExternalCalls++;
    throw Error('No-paid probe refuses every external HTTP destination');
  }
  httpCalls++;
  return originalFetch(input, options);
};

const id = 'local-combined-load-' + Date.now();
const count = Number(process.argv[2] ?? 24), noise = Number(process.argv[3] ?? 96);
const horizonMs = 10800000, wallLimitMs = 420000, batchSize = 10;
const config = { seed: 'local-combined-load-seed-01', count, noise, reposts: 2, formalDelayMs: 3600000, organizations: 4,
  clarificationWorkers: 2, modeledPerceptionLatencyMs: 15000, reviewMs: 30000,
  horizonMs, batchSize, wallLimitMs, extentKm: 6, grid: 9, packetLoss: 0, traffic: 0 };
const fingerprints = { candidate: await buildFingerprint(), evaluator: await evaluatorFingerprint(), simulator: ENGINE_BUILD };
const probeFingerprint = hash(await readFile(new URL(import.meta.url), 'utf8'));
const providerCalls = [];
// Only the actual public request payload reaches this substitute. No world,
// hidden need IDs, gold, author metadata or evaluator labels are available here.
const provider = { complete: async (request) => {
  if (request.task !== 'perception' || request.tools.length) throw Error('Unsupported model task in no-paid probe');
  const started = performance.now();
  const input = JSON.parse(request.messages.find(m => m.role === 'user').content);
  const observations = input.sources.flatMap(s => conventionalInterpret({ ...s, id: s.id ?? s.reference }, input.knownLocations))
    .map(o => ({ text: o.text, kind: o.kind, sourceIds: o.sourceIds, location: o.location,
      resourceType: o.resourceType, quantity: o.quantity, unit: o.unit, timeStatus: o.timeStatus }));
  if (observations.length > 50) throw Error('Controlled source contract exceeds finite observation limit');
  providerCalls.push({ episode: request.episode, task: request.task, presentedSources: input.sources.length,
    sourceIds: input.sources.map(s => s.id ?? s.reference), sourceHash: hash(input.sources), observations: observations.length,
    wallMs: performance.now() - started, providerCostUsd: 0 });
  return { model: 'deterministic-public-source-contract-substitute', finishReason: 'stop',
    message: { content: JSON.stringify({ observations }) }, usage: { providerCost: 0, wallMs: performance.now() - started } };
}};
await mkdir('reports/combined', { recursive: true });
const reportFile = 'reports/combined/' + id + '.json';
await writeFile(reportFile, JSON.stringify({ id, status: 'started', config, fingerprints, probeFingerprint,
  scope: 'No-paid combined mechanism control. Deterministic public parser substitutes perception; this is not a model quality benchmark.' }, null, 2));
const start = performance.now();
const h = await createHarness({ scenario: 'S23', seed: config.seed, organizations: 4, provider,
  awaitVerifications: false, config: { grid: 9, extentKm: 6, durationMs: horizonMs, healthReports: false,
    recurringNeeds: false, postsPerHour: 0, observationRate: 1, sourceIndexMs: 0, clarificationWorkers: 2,
    backgroundTraffic: 0, packetLoss: 0, toolQuota: 20000, sourceRequestLimit: 1000000,
    modelLatencyMs: config.modeledPerceptionLatencyMs, reviewMs: config.reviewMs },
  budgetUsd: 0.01, maxCalls: 1, platformConfig: { modelId: 'deterministic-public-source-contract-substitute',
    apiKey: undefined, hourlyBudgetUsd: 0.01, hourlyCallLimit: 500, autoInvestigate: false } });
const w = h.lab.world, app = h.apps[0];
const corpus = installResponseBenchmark(w, { count, noise, reposts: 2, formalDelayMs: config.formalDelayMs });
const departures = capturePhysicalDepartures(w), errors = [], timeline = [], ingestionRows = [], discoveryRows = [], reviews = [];
let status = 'completed', turns = 0, processed = 0, lastReceive = -Infinity;
const seen = new Set(), pending = [];
const finish = app.connector.finishModel.bind(app.connector);
app.connector.finishModel = async (model, usage) => {
  const result = await finish(model, usage);
  w.advance(Math.min(horizonMs, Math.max(w.now, result.requestedAt + Math.ceil(Math.max(w.config.modelLatencyMs, usage?.wallMs ?? 0)))), { maxEvents: 1000000 });
  return result;
};
async function review(owner, p) {
  const at = w.now;
  const accepted = await scriptedReview(owner, p);
  reviews.push({ org: owner.config.org, proposal: p.id, requestedAt: at, returnedAt: w.now,
    modeledWaitIncludingReviewMs: w.now - at, accepted, actions: p.actions.length });
  return accepted;
}
async function act(result) {
  if (!result.proposalId) return;
  const p = await app.store.get('org0', 'proposal', result.proposalId);
  if (p.state === 'awaiting_review' && await review(app, p)) await app.worker.execute(p.id);
}
async function propagate() {
  for (const owner of h.apps) {
    await owner.ingestion.sync({ sources: false });
    for (const row of await owner.store.list(owner.config.org, 'proposal', 2000)) {
      if ((row.originPartner || owner === app) && row.state === 'awaiting_review') await review(owner, row);
      const current = await owner.store.get(owner.config.org, 'proposal', row.id);
      if (['authorized', 'executing', 'awaiting_partner'].includes(current.state))
        try { await owner.worker.execute(current.id); }
        catch (e) { errors.push({ stage: 'execute', org: owner.config.org, at: w.now, code: e.code ?? e.name }); }
    }
    await owner.network.refresh();
    await owner.worker.drain(32);
  }
}
async function receive() {
  for (const owner of h.apps) {
    const began = performance.now();
    await owner.ingestion.sync();
    ingestionRows.push({ org: owner.config.org, receivedAt: w.now, syncWallMs: performance.now() - began,
      durableSources: (await owner.store.list(owner.config.org, 'signal', 10000)).length });
  }
  for (const source of selectOriginalSources(await app.store.list('org0', 'signal', 10000))
    .sort((a,b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id))) {
    const key = source.id + ':' + (source.sourceVersion ?? source.version ?? 1);
    if (!seen.has(key)) { seen.add(key); pending.push(source); }
  }
  lastReceive = w.now;
}
async function sample(label) {
  const queue = await responseQueue(app.store, 'org0');
  const proposals = await Promise.all(h.apps.map(owner => owner.store.list(owner.config.org, 'proposal', 2000)));
  const inspectionStates = Object.fromEntries(Object.entries(Object.groupBy(w.state.inspections, i => i.state)).map(([k,v]) => [k,v.length]));
  timeline.push({ label, at: w.now, actualWallMs: performance.now() - start,
    pendingInterpretationSources: pending.length - processed, outstandingNeedRows: queue.total,
    openOwnerReviews: proposals.flat().filter(p => ['awaiting_review', 'needs_clarification', 'conditionally_authorized'].includes(p.state)).length,
    inspectionStates, firstUseful: corpus.gold.filter(g => w.need(g.needId).firstServiceAt != null).length,
    sufficient: corpus.gold.filter(g => w.need(g.needId).completedAt != null).length,
    activeOperations: w.state.operations.filter(o => !['completed', 'received', 'failed', 'cancelled', 'service'].includes(o.state)).length });
}
try {
  w.advance(60000);
  for (const owner of h.apps) {
    for (const target of ['map', 'inventory', 'vehicles']) await owner.connector.action('query', { target }, id + '-' + owner.config.org + '-' + target);
    await owner.ingestion.sync();
    const actor = (await owner.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'", [owner.config.org])).rows[0];
    await configureResponsePolicy(owner.store, actor, { version: 0, order: 'deadline_then_priority', maxOpenReviews: 8,
      investigationCooldownMs: 60000, reason: 'Frozen no-paid combined mechanism probe with finite owner review' }, id + '-policy-' + owner.config.org);
    if (owner !== app) {
      for (const kind of ['resource', 'vehicle']) for (const item of (await owner.store.list(owner.config.org, kind, 2000)).filter(r => r.owner === owner.config.org))
        await owner.network.share(actor, { kind, id: item.id, version: item.version, to: 'org0' }, id + '-share-' + item.id);
      await owner.worker.drain();
    }
  }
  await receive();
  await sample('initial-burst-received');
  while (w.now < horizonMs) {
    if (performance.now() - start > wallLimitMs) { status = 'aborted_wall_limit'; break; }
    if (w.now - lastReceive >= 60000) await receive();
    await propagate();
    await act(await draftReceivedResponse(app, id + '-turn-' + turns++));
    if (processed < pending.length) {
      const batch = pending.slice(processed, processed + batchSize), at = w.now, began = performance.now();
      const result = await app.discovery.run({ ids: batch.map(s => s.id) }, id + '-batch-' + discoveryRows.length);
      processed += batch.length;
      discoveryRows.push({ at, availableAt: w.now, wallMs: performance.now() - began, sourceCount: batch.length, ...result });
      await sample('after-discovery-before-review');
      await act(result);
    } else {
      const complete = corpus.gold.every(g => w.need(g.needId).served >= w.need(g.needId).quantity);
      const active = w.state.operations.some(o => !['completed','received','failed','cancelled','service'].includes(o.state));
      if (complete && !active) break;
      w.advance(Math.min(horizonMs, w.now + 60000), { maxEvents: 1000000 });
    }
    await sample('loop');
    if (turns % 10 === 0) console.log(JSON.stringify({ id, turns, worldMinutes: w.now / 60000,
      processed, pending: pending.length - processed, served: corpus.gold.filter(g => w.need(g.needId).completedAt != null).length,
      wallSeconds: (performance.now() - start)/1000 }));
  }
} catch (e) { status = 'failed'; errors.push({ stage: 'probe', code: e.code ?? e.name, message: String(e.message).slice(0,250), at: w.now }); }
// Final source visibility/ingestion and scorer are separate from controller input.
const stoppingAt = w.now;
w.advance(horizonMs, { maxEvents: 1000000 });
await receive();
await sample('fixed-horizon');
const outcomes = corpus.gold.map(g => {
  const n = w.need(g.needId);
  return { id: n.id, type: n.type, unit: n.unit, quantity: n.quantity, served: Math.min(n.served,n.quantity),
    overprovided: Math.max(0,n.served-n.quantity), createdAt: n.createdAt, firstServiceAt: n.firstServiceAt,
    sufficientAt: n.completedAt, firstUsefulCensored: n.firstServiceAt == null, sufficientCensored: n.completedAt == null,
    timeToFirstUsefulMs: (n.firstServiceAt ?? horizonMs)-n.createdAt, timeToSufficientMs: (n.completedAt ?? horizonMs)-n.createdAt };
});
const durable = await Promise.all(h.apps.map(async owner => ({ org: owner.config.org,
  sources: (await owner.store.list(owner.config.org,'signal',10000)).length,
  claims: (await owner.store.list(owner.config.org,'claim',10000)).length,
  receipts: (await owner.store.list(owner.config.org,'semantic_receipt',10000)).length,
  proposals: (await owner.store.list(owner.config.org,'proposal',2000)).map(p => ({ id:p.id,state:p.state,actions:p.actions.length })),
  operations: (await owner.store.list(owner.config.org,'operation',10000)).map(operationTrace) })));
const physicallyReviewCompleted = w.log.filter(e => e.type === 'review_completed');
const metrics = evaluate(w), invariants = w.invariants();
await h.close();
const finalFingerprints = { candidate: await buildFingerprint(), evaluator: await evaluatorFingerprint(),
  simulator: execFileSync(process.execPath, ['--input-type=module','-e', "import { ENGINE_BUILD } from './contracts/config.mjs'; process.stdout.write(ENGINE_BUILD)"],
    { cwd: '../disaster-response-simulator', encoding: 'utf8', windowsHide: true }) };
const report = { at: new Date().toISOString(), id, status, scope: 'Combined local mechanism/load control with deterministic perception substitute; not live LLM semantic quality or baseline superiority.',
  config, fingerprints, finalFingerprints, candidateChanged: hash(fingerprints) !== hash(finalFingerprints), probeFingerprint,
  hardware: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node:process.version,
    priority:'BelowNormal attempted', contention:'Other frozen campaigns active; wall performance is not an isolated machine benchmark.' },
  physicalManifest:w.manifest, corpusManifest:corpus.manifest, controllerStoppedAt:stoppingAt,
  actualWallMs: performance.now()-start, httpCalls, blockedExternalCalls, paidCalls:0, paidCostUsd:0,
  providerSubstitute: { identity:'deterministic-public-source-contract-substitute', inputScope:'Only actual received SemanticIngestion user payload; public sources and public directory.',
    interpretation: 'Conventional public parser, not gold labels or prerecorded correct answers.', calls:providerCalls },
  results:{ needs:outcomes.length, firstUseful:outcomes.filter(n=>!n.firstUsefulCensored).length,
    sufficient:outcomes.filter(n=>!n.sufficientCensored).length, censored:outcomes.filter(n=>n.sufficientCensored).length,
    processedSources:processed, receivedOriginals:pending.length, remainingSources:pending.length-processed,
    publications:w.state.posts.length, durableSourcesByOrg:durable.map(d=>({org:d.org,sources:d.sources})),
    maximumPendingSources:Math.max(...timeline.map(t=>t.pendingInterpretationSources)),
    finalPendingSources:timeline.at(-1).pendingInterpretationSources,
    maximumOpenOwnerReviews:Math.max(...timeline.map(t=>t.openOwnerReviews)),
    reviewsCompleted:physicallyReviewCompleted.length,
    modeledReviewWorkMs:w.state.statistics.reviewMs,
    modeledWaitIncludingReviewP50Ms:percentile(reviews.map(r=>r.modeledWaitIncludingReviewMs),.5),
    modeledWaitIncludingReviewP95Ms:percentile(reviews.map(r=>r.modeledWaitIncludingReviewMs),.95),
    syncWallP95Ms:percentile(ingestionRows.map(r=>r.syncWallMs),.95),
    firstUsefulCensoredRmMs:outcomes.reduce((a,n)=>a+n.timeToFirstUsefulMs,0)/outcomes.length,
    sufficientCensoredRmMs:outcomes.reduce((a,n)=>a+n.timeToSufficientMs,0)/outcomes.length },
  metrics,outcomes,timeline,ingestionRows,discoveryRows,reviews,durable,
  scorerOnlyPhysical:{scope:'Never provided to candidate/substitute.', operations:w.state.operations.map(operationTrace),departures},
  errors,invariants,limitations:[
    'No real model or paid calls; this verifies integration, finite queues and service causality, not semantic accuracy/cost/throughput of Gemma or Gemini.',
    'Four independent in-memory databases in one OS process, not four durable processes.',
    'Review uses the same competent scripted owner and finite source slots/duration as the harness; no human comprehension claim.',
    'Pending interpretations reported explicitly. If wall limit interrupts, later physical completion is retained but no new controller decisions occur.',
    'No comparative gain claimed and no clinical/mortality model. Fixed internally authored informational cohort; hardware contention declared.' ] };
await writeFile(reportFile, JSON.stringify(report,null,2));
console.log(JSON.stringify({ reportFile,status,results:report.results,changed:report.candidateChanged,errors:errors.length,invariants:invariants.length,paidCalls:0 }));
if(status!=='completed'||report.candidateChanged||invariants.length||blockedExternalCalls)process.exitCode=1;
