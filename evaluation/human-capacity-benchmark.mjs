import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createHarness, scriptedReview, buildFingerprint, evaluatorFingerprint } from './harness.mjs';
import { checkFinalBuilds, requireLoadedSimulatorBuild } from './simulator-build.mjs';
import { installResponseBenchmark } from '../../disaster-response-simulator/generators/response-benchmark.mjs';
import { evaluate } from '../../disaster-response-simulator/evaluation/metrics.mjs';
import { selectOriginalSources, parseExplicitCurrentRequest, conventionalInterpret, keywordCandidates } from './conventional-source.mjs';
import { requestReceivedInquiry } from '../src/received-inquiries.mjs';
import { draftReceivedResponse } from '../src/discovery-response.mjs';
import { configureResponsePolicy, responseQueue } from '../src/response-policy.mjs';
import { receivedAllocationPlan } from '../src/received-allocation.mjs';
import { receivedProgressReference, routinePublicCommentary } from '../src/source-relevance.mjs';
import { ModelBudgetPool } from '../src/budget-pool.mjs';
import { hash } from '../src/store.mjs';
import { collectProposalServiceFunnel } from './proposal-funnel.mjs';
import { capturePhysicalDepartures, operationTrace } from './physical-trace.mjs';

export const HUMAN_CAPACITY_PROTOCOL = {
  version: 'native-human-capacity-physical-response-v4',
  identityAmendment: 'Opaque bounded internal episode IDs hash full arm/profile/condition/seed/run nonce; full readable identity remains in results. This only fixes derived command-key overflow. Command/model-scope references change, so traces are not asserted bit-identical; source seed, exogenous corpus, parameters, permissions, physics, prompts and budgets are unchanged.',
  hypothesis: 'Automation may reduce source-reading and manual coordination backlog and hence physical service time; strong automated conventional references may tie or win.',
  scope: 'Separate internal scenario family with explicit hypothetical human-capacity parameters. It does not replace prior B5/B8 comparisons or claim empirically calibrated human productivity/errors.',
  arms: {
    C_manual: 'Distributed finite human source reading, integration and real relay; finite received-need decisions and partner handoff; competent common allocator afterward.',
    C_decentralized: 'Independent manual teams with native read/decide and factual need/intent/status relays; each drafts only its own capacity. Real stale communication may or may not cause duplicate physical supply.',
    B5: 'Strong shared conventional planner: free exact parsing, native finite manual reading of other public sources, automated inquiries and common allocation.',
    B8: 'Strong free broad keyword/public-location discovery with automated inquiries and the common allocator. No artificial reading/decision/relay penalty.',
    B6: 'Bounded real-model public-source perception, automated received-data inquiries under the same approved policy and the common allocator. No extra human query gate.',
  },
  fairness: 'Identical seed, public input bytes, formal report delay, resource/fleet/field capacities, physical rules, consent and owner reviews in every arm. Human reviews share the native decision pool in ALL arms. No human task creates truth, certifies safety or authorizes aid.',
  manualRouting: 'Public source ID hash assigns each manual reader to one of four owners. After a completed read, competent common interpretation triages nonactionable material without extra decision/relay work; actionable local decisions stay local, other owners relay actual completed snapshots to owner0. Integrated operational needs are handed only to foreign owners selected by the common received-data allocation preview; owned capacity requires no partner relay. These are declared workflow assumptions, not measured universal practice.',
  profiles: {
    zero: 'No source-reading/integration/relay duration, background load or human task error; native owner review remains finite.',
    moderate: 'Source defaults: 2 readers/2 deciders/1 relayer per owner, 30s/60s/90s work, no background work or errors.',
    burst: 'Same finite pools/work; source-generated exogenous background read360/decision120/relay60 tasks per owner/hour. Hypothetical sensitivity, not disaster calibration.',
  },
  conditions: {
    zero: { profile: 'zero', errorBp: 0 },
    moderate: { profile: 'moderate', errorBp: 0 },
    burst: { profile: 'burst', errorBp: 0 },
    moderate_error_1pct: { profile: 'moderate', errorBp: 100 },
    fast_read_5s: { profile: 'moderate', errorBp: 0, readMs: 5000 },
    readers8: { profile: 'moderate', errorBp: 0, readers: 8 },
    moderate_48: { profile: 'moderate', errorBp: 0, count: 48, noise: 384, maxModelCalls: 24 },
    moderate_96: { profile: 'moderate', errorBp: 0, count: 96, noise: 768, maxModelCalls: 32, grid: 13 },
  },
  failurePolicy: 'At most two attempts per inconclusive manual stage, with all receipts and errors retained. Missing relay, rejected work, unserved demand, unknown fees and provider failures are never counted as completed service.',
  clocks: 'Publication, HTTP receipt, native human work, model availability, inquiry and physical receipt are separate source clocks. Provider measured wall time is charged at max(native model latency, measured provider duration). Host SQL/UI wall time is separately reported.',
  coalescing: 'All arms recompile only after the received response material signature or eligible integrated need IDs change. Receipt ingestion, owner review, physical execution and unknown human/inquiry queues continue at each common60s pump or earlier received native readyAt; no private completion or skipped horizon. Public feed downloads occur only in the coordinator store actually consumed by this controller; distributed reading still obtains its own native authenticated source snapshot.',
  controls: 'Keep zero profile, moderate, burst, B5/B8 upper bounds, failed and censored worlds. Human errors are source-seeded and apply to the same owner review mechanism for AidScaler; no arm-specific random error or forced duplicate score.',
  endpoint: 'First useful and sufficient physical service RMST at the fixed horizon, by native demand and resource units; background task completion or proposal approval is not aid.',
};

const finite = x => typeof x === 'number' && Number.isFinite(x);
export function nativeHumanEpisodeIdentity({ arm, profile, condition = profile, seed }, nonce) {
  const fields = { arm, profile, condition, seed, nonce };
  return { ...fields, id: 'human-capacity-' + hash(fields),
    readableLabel: `human-capacity-${condition}-${arm}-${seed}-${nonce}` };
}
const sealedHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const sourceVersionKey = s => `${s.id}:${s.sourceVersion ?? s.version ?? 1}`;

export function manualSourceOwner(sourceId, owners = 4) {
  if (!Number.isSafeInteger(owners) || owners < 1 || typeof sourceId !== 'string') throw Error('Invalid manual routing');
  return createHash('sha256').update(sourceId).digest().readUInt32BE(0) % owners;
}

/** Authentication/scoping comes from the actor HTTP response; this additional
 * guard rejects shallow queued acknowledgements and inconsistent clocks. */
export function completedHumanReceipt(row, { org, stage, reference } = {}) {
  if (!row || row.org !== org || row.stage !== stage || row.state !== 'completed' ||
      !finite(row.createdAt) || row.createdAt < 0 || !finite(row.startedAt) || row.startedAt < row.createdAt ||
      !finite(row.completedAt) || row.completedAt < row.startedAt || !row.result?.source || !row.result.snapshot) return null;
  const source = row.result.source;
  if (reference?.kind !== 'work' && (source.kind !== reference?.kind || source.id !== reference?.id ||
      reference.version != null && source.version !== reference.version)) return null;
  return row.result;
}

export function sourceFromHumanResult(result, expected) {
  const s = result?.snapshot;
  if (result?.source?.kind !== 'post' || result.source.id !== expected?.id || !s || s.id !== expected.id ||
      result.source.version !== (expected.sourceVersion ?? expected.version ?? 1)) return null;
  // Only the engine's completed received public snapshot, never the original
  // unprocessed store row, is supplied to the manual interpretation helper.
  return { ...s, sourceVersion: result.source.version };
}

export function materialDemandKey(need) {
  return hash([need?.id, need?.building, need?.type, need?.unit, need?.quantity,
    need?.deadline, need?.priority, need?.state === 'erased' ? 'erased' : 'active']);
}
export function planningMaterialSignature(scope, needIds) {
  return hash([scope.signature, needIds === undefined ? 'all_received' : [...needIds].sort()]);
}
export function receivedHumanWakeAt(now, horizon, pumpMs, readyTimes = []) {
  const earliest = readyTimes.filter(t=>finite(t)&&t>=now).reduce((a,b)=>Math.min(a,b),now+pumpMs);
  return Math.min(horizon,Math.max(now+1,Math.min(now+pumpMs,earliest)));
}
export function nativeHumanWorkParams(stage, reference, dependsOn = [], recipient, ttlMs) {
  if (!['read','decide','relay'].includes(stage)) throw Error('Invalid human work stage');
  return { stage, reference, dependsOn, ...(stage === 'relay' ? {recipient, channel:'internet',ttlMs} : {}) };
}
/** Retry only an own, exact received terminal task, never a pending ACK. */
export function manualStageRetryState(receipt, attempts, {org,stage,id} = {}) {
  if (!receipt || receipt.id !== id || receipt.org !== org || receipt.stage !== stage ||
      !['inconclusive','failed'].includes(receipt.state)) return null;
  if (!Number.isSafeInteger(attempts) || attempts < 1) return null;
  return attempts < 2 ? 'retry' : 'exhausted';
}
export function manualHandoffDelivered(inbox, {workId,from,to,need} = {}) {
  return !!inbox && inbox.id === workId && inbox.from === from && inbox.to === to &&
    inbox.source?.kind === 'need' && inbox.source.id === need?.id &&
    finite(inbox.receivedAt) && inbox.receivedAt >= 0 && finite(inbox.sourceObservedAt) &&
    inbox.sourceObservedAt >= 0 && inbox.sourceObservedAt <= inbox.receivedAt &&
    !!inbox.snapshot && materialDemandKey(inbox.snapshot) === materialDemandKey(need);
}
export function actionableManualLead(observations) {
  return (observations ?? []).some(o=>o.kind==='need'&&typeof o.location==='string'&&o.timeStatus!=='historical');
}
export function relevantManualHandoffs(actions, org, needId) {
  return [...new Set((actions??[]).filter(a=>a.params?.need===needId&&typeof a.owner==='string'&&a.owner!==org).map(a=>a.owner))].sort();
}
export function finalizeEpisodeIntegrity({status,errors}, final) {
  return {...final,status:final.invalidStatus??status,errors:[...errors,...final.errors]};
}

/** A native actor inbox is factual source provenance, not authority over the
 * sender's stock. Only source-owned operation status is projected, with exact
 * identity/version and clocks; intents remain separate, informative records. */
export function receivedManualPeerOperation(inbox, org) {
  const s = inbox?.snapshot, source = inbox?.source;
  if (inbox?.to !== org || typeof inbox.from !== 'string' || inbox.from === org || source?.kind !== 'operation' ||
      !s || s.id !== source.id || s.org !== inbox.from || s.version !== source.version ||
      !['delivery','evacuation'].includes(s.type) || !finite(s.quantity) || s.quantity <= 0 ||
      !finite(inbox.receivedAt) || inbox.receivedAt < 0 || !finite(inbox.sourceObservedAt) ||
      inbox.sourceObservedAt < 0 || inbox.sourceObservedAt > inbox.receivedAt || typeof s.state !== 'string') return null;
  return { ...s, id:`manual-peer:${inbox.from}:${s.id}`, sourceId:s.id, owner:inbox.from,
    peerOwner:inbox.from, confirmedBySource:true, sourceObservedAt:inbox.sourceObservedAt,
    sourceVersion:source.version, manualRelay:inbox.id, receivedAtSourceClock:inbox.receivedAt };
}

export function reconcileUsage(rows, cap) {
  if (!Array.isArray(rows)) return { modelCalls: null, costUsd: null, knownCostUsd: 0, unknownCostRows: null, chargedBudgetUsd: cap, usageMissing: true };
  let known = 0, charged = 0, unknown = 0;
  for (const row of rows) {
    const cost = row.cost_usd == null ? NaN : Number(row.cost_usd);
    if (Number.isFinite(cost) && cost >= 0) { known += cost; charged += cost; }
    else { unknown++; const reserve = Number(row.reserved_usd); charged += Number.isFinite(reserve) && reserve >= 0 ? reserve : cap; }
  }
  return { modelCalls: rows.length, costUsd: unknown ? null : known, knownCostUsd: known,
    unknownCostRows: unknown, chargedBudgetUsd: charged, usageMissing: false };
}

export function nativeServiceSummary(outcomes, prefix = 'sufficient') {
  const key = prefix === 'firstUseful' ? 'timeToFirstUsefulServiceMs' : 'timeToSufficientServiceMs';
  const censorKey = prefix === 'firstUseful' ? 'firstUsefulCensored' : 'censored';
  if (!Array.isArray(outcomes) || !outcomes.length || outcomes.some(n => !finite(n[key]) || n[key] < 0))
    return { eligible: outcomes?.length ?? null, reached: null, rightCensored: null, restrictedMeanMs: null };
  return { eligible: outcomes.length, reached: outcomes.filter(n => !n[censorKey]).length,
    rightCensored: outcomes.filter(n => n[censorKey]).length,
    restrictedMeanMs: outcomes.reduce((s,n) => s+n[key],0)/outcomes.length };
}

export async function humanCapacityEvaluatorFingerprint() {
  return hash([await evaluatorFingerprint(), ...await Promise.all([
    'evaluation/human-capacity-benchmark.mjs', 'scripts/human-capacity-campaign.mjs',
  ].map(async f => [f, await readFile(new URL('../'+f, import.meta.url), 'utf8')]))]);
}

/** New controllers read ONLY their app's scoped HTTP/store data. World/corpus
 * references below belong to outer orchestration and final scoring. */
export async function runHumanCapacityEpisode({
  arm = 'B6', profile = 'moderate', condition = profile, seed = 'human-capacity-01', count = 24, noise = 192,
  reposts = 2, formalDelayMs = 1800000, horizonMs = 10800000, grid = 9, extentKm = 6,
  pumpMs = 60000, clarificationWorkers = 2, budgetUsd = .15, maxModelCalls = 16,
  wallLimitMs = 900000, provider, humanCapacityOverrides = {},
  candidateFingerprint, evaluatorBuild, onProgress = () => {}, shouldStop = () => false,
} = {}) {
  if (!Object.hasOwn(HUMAN_CAPACITY_PROTOCOL.arms, arm) || !Object.hasOwn(HUMAN_CAPACITY_PROTOCOL.profiles, profile) ||
      !Number.isSafeInteger(count) || count < 1 || count > 100 || !Number.isSafeInteger(noise) || noise < 0 || noise > 2000 ||
      !Number.isSafeInteger(pumpMs) || pumpMs < 1000 || pumpMs > 60000 || !finite(horizonMs) || horizonMs <= 0 ||
      !finite(budgetUsd) || budgetUsd <= 0 || !Number.isSafeInteger(maxModelCalls) || maxModelCalls < 1 || maxModelCalls > 64)
    throw Error('Invalid declared human capacity episode');
  candidateFingerprint ??= await buildFingerprint();
  evaluatorBuild ??= await humanCapacityEvaluatorFingerprint();
  await requireLoadedSimulatorBuild();
  const episodeIdentity = nativeHumanEpisodeIdentity({ arm, profile, condition, seed }, Date.now());
  const episode = episodeIdentity.id;
  const started = performance.now();
  const h = await createHarness({ scenario: 'S23', seed, organizations: 4,
    config: { grid, extentKm, durationMs: horizonMs, healthReports: false, recurringNeeds: false,
      postsPerHour: 0, observationRate: 1, sourceIndexMs: 0, clarificationWorkers,
      toolQuota: 10000, sourceRequestLimit: 1000000,
      humanCapacity: { readers: 2, deciders: 2, relayers: 1, ...humanCapacityOverrides, profile } },
    provider: arm === 'B6' ? provider : { complete: async () => { throw Error('MODEL_FORBIDDEN_REFERENCE_ARM'); } },
    budgetUsd, maxCalls: 4,
    platformConfig: { modelScopePrefix: episode, modelScopeCalls: maxModelCalls,
      hourlyCallLimit: maxModelCalls, hourlyBudgetUsd: budgetUsd,
      modelBudgetPool: new ModelBudgetPool({ budgetUsd, calls: maxModelCalls }) },
    awaitVerifications: false, awaitReviews: false });
  let finalizedResult;
  try {
  const w = h.lab.world, app = h.apps[0];
  const profiler={phases:{},http:{},sql:{},note:'Host instrumentation only; no measured SQL/HTTP duration is used to advance physical time. Store-query counts exclude internal transaction-client calls. All owners use the same instrumentation.'};
  const recordPerf=(group,key,ms)=>{const r=profiler[group][key]??={calls:0,totalMs:0,maxMs:0};r.calls++;r.totalMs+=ms;r.maxMs=Math.max(r.maxMs,ms);};
  async function measured(name,fn){const start=performance.now();try{return await fn();}finally{recordPerf('phases',name,performance.now()-start);}}
  for(const owner of h.apps){
    const request=owner.connector.request.bind(owner.connector),query=owner.store.query.bind(owner.store);
    owner.connector.request=async(path,options={})=>{const start=performance.now();try{return await request(path,options);}finally{recordPerf('http',`${owner.config.org}:${options.method??'GET'}:${path.split('?')[0]}`,performance.now()-start);}};
    owner.store.query=async(...args)=>{const start=performance.now();try{return await query(...args);}finally{recordPerf('sql',owner.config.org,performance.now()-start);}};
  }
  const departures = capturePhysicalDepartures(w);
  const corpus = installResponseBenchmark(w, { count, noise, reposts, formalDelayMs, silentFraction: 0 });
  const activities = [], errors = [], seen = new Set(), manual = new Map(), decisionNeeds = new Map(), statusRelays = new Set(), lastDraftSignatures = new Map();
  const pendingModelSources = [], candidateInquiries = new Map(), manualPreviewCache = new Map();
  const humanReceiptHistory = new Map(), humanInboxHistory = new Map(), recordedIntents = new Set(), receivedWakeups = [];
  let status = 'completed', turns = 0, batches = 0, sourcePollAt = -Infinity;
  let progressSources = 0, routineSources = 0, compilations = 0, unchangedCompilationSkips = 0;
  // Model output is not available in an optimistic simulated15 seconds when
  // real provider completion took longer. No SQL time acceleration is added.
  const finishModel = app.connector.finishModel.bind(app.connector);
  app.connector.finishModel = async (id, usage) => {
    const r = await finishModel(id, usage);
    const available = Math.ceil(r.requestedAt + Math.max(w.config.modelLatencyMs, finite(usage?.wallMs) ? usage.wallMs : 0));
    w.advance(Math.min(horizonMs, Math.max(w.now, available)), { maxEvents: 1000000 });
    activities.push({stage:'model-controller-availability',request:r.id,nativeDeclaredAvailableAt:r.availableAt,
      measuredProviderWallMs:finite(usage?.wallMs)?usage.wallMs:null,controllerObservedAt:w.now,
      note:'Controller availability uses max(native latency, measured provider duration) from original requestedAt; native receipt timestamp remains unchanged and is not presented as exact HTTP availability.'});
    return r;
  };

  async function recordReceived(owner, state) {
    const now = state.now ?? state.simulatedAt;
    for (const r of state.humanWork ?? []) {
      const key = `${owner.config.org}:${r.id}:${r.version}`;
      if (!humanReceiptHistory.has(key)) humanReceiptHistory.set(key, { ...r, receivedAt: now });
    }
    for (const r of state.humanInbox ?? []) {
      const key = `${owner.config.org}:${r.id}:${r.version}`;
      if (!humanInboxHistory.has(key)) humanInboxHistory.set(key, { ...r, receivedBy: owner.config.org });
    }
  }
  async function humanAction(owner, stage, reference, id, dependsOn = [], recipient) {
    const result = await owner.connector.action('human_work', nativeHumanWorkParams(stage,reference,dependsOn,recipient,horizonMs), `human-work-${hash([episode,id])}`, { human: true });
    activities.push({ stage: 'native-human-work-submitted', owner: owner.config.org, work: result.id,
      workStage: stage, reference, dependsOn, recipient: recipient ?? null });
    if(finite(result.readyAt))receivedWakeups.push(result.readyAt);
    return result.id;
  }
  function enqueueCandidates(observations, provenance, owner = 0) {
    for (const o of observations ?? []) {
      if (o.kind !== 'need' || !o.location || o.timeStatus === 'historical') continue;
      const key = `${owner}:${o.location}:${(o.sourceIds ?? []).slice().sort().join(',')}`;
      if (!candidateInquiries.has(key)) candidateInquiries.set(key, { o, provenance, owner, attempts: 0, requested: false });
    }
  }
  async function inquiries() {
    for (const [key, row] of candidateInquiries) {
      if (row.requested) continue;
      const q = await requestReceivedInquiry(h.apps[row.owner], { target: 'building', id: row.o.location,
        method: 'clarification', purpose: 'observation' }, { requestClass: 'foreground', backgroundMaxActive: 2 });
      if (q.admission === 'deferred') continue;
      row.requested = true;
      activities.push({ stage: 'source-directed-confirmation', key, references: row.o.sourceIds,
        location: row.o.location, inspection: q.id, reused: q.reused, provenance: row.provenance });
    }
  }
  async function pollSources() {
    // Only this source store is consumed by source discovery. Other owners
    // authenticate/read their own public snapshot via native human_work; their
    // operational actor-state ingestion continues in propagate every turn.
    await app.ingestion.sync();
    const places = (await app.store.get('org0', 'context', 'geography', false))?.map?.places ?? [];
    const originals = selectOriginalSources(await app.store.list('org0', 'signal', 10000))
      .sort((a,b) => a.publishedAt-b.publishedAt || a.id.localeCompare(b.id));
    const operations = await app.store.list('org0', 'operation', 10000);
    for (const s of originals) {
      const key = sourceVersionKey(s); if (seen.has(key)) continue; seen.add(key);
      if (receivedProgressReference(s, operations)) { progressSources++; continue; }
      if (routinePublicCommentary(s)) { routineSources++; continue; }
      const explicit = parseExplicitCurrentRequest(s, places);
      if (explicit && !['C_manual','C_decentralized'].includes(arm)) { enqueueCandidates([explicit], 'common-free-explicit-parser'); continue; }
      if (/^ARCHIVE\b/i.test(s.text)) continue;
      if (arm === 'B8') enqueueCandidates(keywordCandidates(s, places), 'common-free-broad-keyword');
      else if (arm === 'B6') pendingModelSources.push(s);
      else {
        const index = arm.startsWith('C_') ? manualSourceOwner(s.id, h.apps.length) : 0;
        const owner = h.apps[index];
        const work = await humanAction(owner, 'read', { kind: 'post', id: s.id,
          version: s.sourceVersion ?? s.version ?? 1 }, `read-${key}-attempt1`);
        manual.set(key, { source: { id: s.id, sourceVersion: s.sourceVersion ?? s.version ?? 1 }, owner: index,
          stage: 'read', work, attempts: 1, done: false });
      }
    }
    sourcePollAt = w.now;
  }
  async function consumeManual(states) {
    const places = (await app.store.get('org0', 'context', 'geography', false))?.map?.places ?? [];
    const inbox = states[0].humanInbox ?? [];
    for (const [key, job] of manual) {
      if (job.done) continue;
      const owner = h.apps[job.owner];
      const receipt = (states[job.owner].humanWork ?? []).find(r => r.id === job.work);
      if (!receipt) continue;
      const retry = manualStageRetryState(receipt,job.attempts,{org:owner.config.org,stage:job.stage,id:job.work});
      if (retry === 'retry') {
        job.attempts++;
        job.work = await humanAction(owner, job.stage, job.reference ?? { kind: 'post', id: job.source.id,
          version: job.source.sourceVersion }, `${job.stage}-${key}-attempt${job.attempts}`, job.dependsOn ?? [], job.recipient);
        continue;
      }
      if (retry === 'exhausted') { job.done = true; job.failed = true; continue; }
      if (job.stage === 'relay') {
        const delivered = inbox.find(r => r.id === job.work && r.from === owner.config.org && r.to === 'org0');
        const source = delivered ? sourceFromHumanResult({ source: delivered.source, snapshot: delivered.snapshot }, job.source) : null;
        if (!source) continue;
        enqueueCandidates(conventionalInterpret(source, places), 'native-manual-read-decide-delivered-relay');
        job.done = true; continue;
      }
      const result = completedHumanReceipt(receipt, { org: owner.config.org, stage: job.stage,
        reference: job.reference ?? { kind: 'post', id: job.source.id, version: job.source.sourceVersion } });
      if (!result) continue;
      if (arm === 'B5') {
        const source = sourceFromHumanResult(result, job.source);
        if (source) enqueueCandidates(conventionalInterpret(source, places), 'native-human-read-receipt');
        job.done = true; continue;
      }
      if (job.stage === 'read') {
        const source = sourceFromHumanResult(result, job.source);
        if (!source || !actionableManualLead(conventionalInterpret(source,places))) {
          job.done=true;job.triaged=true;
          activities.push({stage:'native-manual-read-triage',sourceId:job.source.id,owner:owner.config.org,disposition:'no-actionable-need-lead-retained'});
          continue;
        }
        const previous = job.work;
        job.stage = 'decide'; job.reference = { kind: 'work', id: previous }; job.dependsOn = [previous]; job.attempts = 1;
        job.work = await humanAction(owner, job.stage, job.reference, `decide-${key}-attempt1`, job.dependsOn);
      } else if (job.stage === 'decide' && arm === 'C_decentralized') {
        const source = sourceFromHumanResult(result, job.source);
        if (source) enqueueCandidates(conventionalInterpret(source, places), 'native-local-read-decide', job.owner);
        job.done = true;
      } else if (job.stage === 'decide' && job.owner !== 0) {
        const previous = job.work;
        job.stage = 'relay'; job.reference = { kind: 'work', id: previous }; job.dependsOn = [previous]; job.recipient = 'org0'; job.attempts = 1;
        job.work = await humanAction(owner, job.stage, job.reference, `relay-${key}-attempt1`, job.dependsOn, 'org0');
      } else {
        const source = sourceFromHumanResult(result, job.source);
        if (source) enqueueCandidates(conventionalInterpret(source, places), 'native-manual-read-decide-local');
        job.done = true;
      }
    }
  }
  async function manuallyIntegratedNeeds(states, ownerIndex = 0) {
    const owner = h.apps[ownerIndex], org = owner.config.org;
    const scope = await responseQueue(owner.store, org, { limit: 2000 });
    const integrated = [];
    for (const need of scope.rows) {
      const demandKey = materialDemandKey(need), key = `${org}:${demandKey}`;
      let task = decisionNeeds.get(key);
      if (!task) {
        const id = await humanAction(owner, 'decide', { kind: 'need', id: need.id }, `need-decision-${key}-1`);
        task = { needId: need.id, key, work: id, attempts: 1, relays: [] }; decisionNeeds.set(key, task);
      }
      const receipt = (states[ownerIndex].humanWork ?? []).find(r => r.id === task.work);
      if (receipt?.state === 'inconclusive' && task.attempts < 2) {
        task.work = await humanAction(owner, 'decide', { kind: 'need', id: need.id }, `need-decision-${key}-${++task.attempts}`); continue;
      }
      const result = completedHumanReceipt(receipt, { org, stage: 'decide', reference: { kind: 'need', id: need.id } });
      if (!result || materialDemandKey(result.snapshot) !== demandKey) continue;
      integrated.push({need,task});
    }
    // Preview the exact competent received-data allocator, without draft or
    // physical command. Human coordination is charged only when its selected
    // response actually requires another owner's capacity.
    let preview=null;
    if(arm==='C_manual'&&integrated.length){
      const signature=planningMaterialSignature(scope,integrated.map(x=>x.need.id));
      const cached=manualPreviewCache.get(org);
      if(cached?.signature===signature)preview=cached.plan;
      else{preview=await receivedAllocationPlan(owner.store,owner.config,{needIds:integrated.map(x=>x.need.id)});manualPreviewCache.set(org,{signature,plan:preview});}
    }
    const selected=[];
    for(const {need,task} of integrated){
      const recipients=arm==='C_decentralized'?h.apps.filter(p=>p!==owner).map(p=>p.config.org):relevantManualHandoffs(preview?.actions,org,need.id);
      for(const to of recipients){
        let relay=task.relays.find(r=>r.to===to);
        if(!relay){
          const id=await humanAction(owner,'relay',{kind:'work',id:task.work},`need-relay-${task.key}-${to}-attempt1`,[task.work],to);
          relay={to,id,attempts:1,attemptIds:[id],failed:false};task.relays.push(relay);
        }
        const receipt=(states[ownerIndex].humanWork??[]).find(r=>r.id===relay.id);
        const retry=manualStageRetryState(receipt,relay.attempts,{org,stage:'relay',id:relay.id});
        if(retry==='retry'){
          const id=await humanAction(owner,'relay',{kind:'work',id:task.work},`need-relay-${task.key}-${to}-attempt${++relay.attempts}`,[task.work],to);
          relay.id=id;relay.attemptIds.push(id);
          activities.push({stage:'native-manual-handoff-retry',owner:org,to,need:need.id,attemptIds:[...relay.attemptIds]});
        }else if(retry==='exhausted'&&!relay.failed){
          relay.failed=true;activities.push({stage:'native-manual-handoff-exhausted',owner:org,to,need:need.id,attemptIds:[...relay.attemptIds]});
        }
      }
      if(arm==='C_decentralized'||recipients.every(to=>task.relays.some(r=>r.to===to&&!r.failed&&states.find(s=>(s.org??s.actor?.org)===to)?.humanInbox?.some(x=>
        manualHandoffDelivered(x,{workId:r.id,from:org,to,need})))))selected.push(need.id);
    }
    return selected;
  }
  async function manualCoordination(states) {
    for (let i=0;i<h.apps.length;i++) {
      const owner=h.apps[i],state=states[i];
      for (const inbox of state.humanInbox ?? []) {
        const op=receivedManualPeerOperation(inbox,owner.config.org);
        if(op) {
          const old=await owner.store.get(owner.config.org,'operation',op.id,false);
          if(!old||op.sourceVersion>old.sourceVersion||op.sourceVersion===old.sourceVersion&&op.sourceObservedAt>old.sourceObservedAt)
            await owner.store.upsert(owner.config.org,'operation',op.id,{...op,receivedSourceRunId:state.runId});
        }
        // No reserved cargo/vehicle or authorization is inferred from intent.
        const intentKey=`${owner.config.org}:${inbox.id}:${inbox.version}`;
        if(inbox.source?.kind==='proposal'&&!recordedIntents.has(intentKey)){
          activities.push({stage:'received-manual-intent',owner:owner.config.org,
            relay:inbox.id,from:inbox.from,receivedAt:inbox.receivedAt,intent:inbox.snapshot});recordedIntents.add(intentKey);
        }
      }
      for(const [kind,records] of [['operation',Object.values(state.known?.operations??{})],['proposal',state.proposals??[]]])for(const r of records){
        if((r.org??owner.config.org)!==owner.config.org || kind==='operation'&&!['delivery','evacuation'].includes(r.type))continue;
        const material=hash([r.id,r.state,r.quantity,r.received,r.times?.service,r.failure,
          kind==='proposal'?r.plan:null]);
        for(const peer of h.apps.filter(p=>p!==owner)){
          const key=`${owner.config.org}:${kind}:${material}:${peer.config.org}`;if(statusRelays.has(key))continue;
          try {
            await humanAction(owner,'relay',{kind,id:r.id,...(r.version!=null?{version:r.version}:{})},`status-${key}`,[],peer.config.org);
            statusRelays.add(key);
          }catch(e){
            if(![403,409,429].includes(e.status))throw e;
            activities.push({stage:'manual-status-relay-not-confirmed',owner:owner.config.org,reference:{kind,id:r.id},to:peer.config.org,code:e.code});
          }
        }
      }
    }
  }
  async function propagate() {
    for (const owner of h.apps) {
      await owner.ingestion.sync({ sources: false });
      for (const p of await owner.store.list(owner.config.org, 'proposal', 2000)) {
        if(!['awaiting_review','authorized','executing','awaiting_partner'].includes(p.state))continue;
        if ((p.originPartner || owner === app || arm==='C_decentralized') && p.state === 'awaiting_review') await scriptedReview(owner, p);
        const current = await owner.store.get(owner.config.org, 'proposal', p.id);
        if (['authorized', 'executing', 'awaiting_partner'].includes(current.state)) {
          try { await owner.worker.execute(current.id); }
          catch(e) { errors.push({ phase: 'execute', owner: owner.config.org, code: e.code ?? e.name }); }
        }
      }
      await owner.network.refresh();
      await owner.worker.drain(32);
    }
  }
  try {
    w.advance(60000);
    for (const owner of h.apps) {
      for (const target of ['map','inventory','vehicles','policy']) await owner.connector.action('query', { target }, `${episode}-${owner.config.org}-${target}`);
      await owner.ingestion.sync();
      const actor = (await owner.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'", [owner.config.org])).rows[0];
      await configureResponsePolicy(owner.store, actor, { version: 0, order: 'deadline_then_priority', maxOpenReviews: 8,
        investigationCooldownMs: 60000, reason: 'Identical owner-approved automated inquiry/response policy in this declared human-capacity family' }, `${episode}-policy-${owner.config.org}`);
      if (owner !== app) {
        for (const kind of ['resource','vehicle']) for (const r of (await owner.store.list(owner.config.org, kind, 2000)).filter(r => r.owner === owner.config.org))
          await owner.network.share(actor, { kind, id: r.id, version: r.version, to: 'org0' }, `${episode}-share-${r.id}`);
        await owner.worker.drain(32);
      }
    }
    await measured('source-poll',pollSources);
    while (w.now < horizonMs) {
      if (await shouldStop()) { status = 'aborted'; errors.push({ phase: 'episode', code: 'CAMPAIGN_INTERRUPTED' }); break; }
      if (performance.now()-started > wallLimitMs) { status = 'wall_limit'; errors.push({ phase: 'episode', code: 'WALL_LIMIT' }); break; }
      if (w.now-sourcePollAt >= 60000) await measured('source-poll',pollSources);
      await measured('owner-receipts-review-execution',propagate);
      const states = await measured('scoped-actor-snapshots',()=>Promise.all(h.apps.map(a => a.connector.state())));
      for (let i=0;i<states.length;i++) { states[i].org = h.apps[i].config.org; await recordReceived(h.apps[i], states[i]); }
      if (arm === 'C_manual' || arm === 'C_decentralized' || arm === 'B5') await measured('consume-native-manual',()=>consumeManual(states));
      if (arm==='C_decentralized')await measured('decentralized-real-coordination',()=>manualCoordination(states));
      if (arm === 'B6' && pendingModelSources.length) {
        const batch = pendingModelSources.splice(0, 30); batches++;
        try {
          const receipt = await measured('actual-model-perception',()=>app.semantic.process({ ids: batch.map(s=>s.id), org: 'org0' }, `${episode}-perception-${batches}`));
          enqueueCandidates(receipt.observations, 'actual-model-perception-receipt');
          activities.push({ stage: 'model-perception', sourceIds: batch.map(s=>s.id), receipt: receipt.id,
            observations: receipt.observations, coverage: receipt.coverage, modelClockAccounting: receipt.modelClockAccounting });
        } catch(e) { errors.push({ phase: 'model-perception', code: e.code ?? e.name, sourceCount: batch.length }); }
      }
      await measured('received-source-inquiry',inquiries);
      await measured('coordinator-receipt-refresh',()=>app.ingestion.sync({ sources: false }));
      for(const index of arm==='C_decentralized'?[0,1,2,3]:[0]){
        const owner=h.apps[index],needIds = arm.startsWith('C_') ? await measured('native-demand-integration',()=>manuallyIntegratedNeeds(states,index)) : undefined;
        // The decentralized control can use only owned capacity. Existing
        // authentic peer status may reduce demand, but grants no stock rights.
        const planningApp=arm==='C_decentralized'?{...owner,config:{...owner.config,peers:[]}}:owner;
        if (needIds === undefined || needIds.length) {
        const material=planningMaterialSignature(await responseQueue(owner.store,owner.config.org,{limit:2000}),needIds);
        if(lastDraftSignatures.get(owner.config.org)===material){unchangedCompilationSkips++;continue;}
        lastDraftSignatures.set(owner.config.org,material);compilations++;
        const draft = await measured('received-response-compile',()=>draftReceivedResponse(planningApp, `${episode}-${owner.config.org}-turn-${turns}`, { needIds }));
        if (draft.proposalId) {
          const p = await owner.store.get(owner.config.org, 'proposal', draft.proposalId);
          if (p.state === 'awaiting_review' && await scriptedReview(owner, p)) await owner.worker.execute(p.id);
        }
        }
      }
      if (turns++%20 === 0) onProgress({ arm, profile, condition, seed, turns, sourceMinutes: w.now/60000,
        receivedOriginals: seen.size, manualPending: [...manual.values()].filter(j=>!j.done).length, batches });
      // Fixed source horizon and received-controller progress only. Private
      // outstanding need totals never decide whether a controller can stop.
      const target = receivedHumanWakeAt(w.now,horizonMs,pumpMs,[...receivedWakeups,
        ...states.flatMap(s=>[...(s.humanWork??[]).filter(r=>r.state==='working').map(r=>r.readyAt),
          ...(s.queries??[]).filter(r=>r.state==='pending').map(r=>r.readyAt)])]);
      receivedWakeups.splice(0,receivedWakeups.length);
      const progress = w.advance(target, { maxEvents: 1000000 });
      if (progress.blocked && w.now < target) throw Object.assign(Error('Unsettled source computation barrier'), { code: 'MODEL_CLOCK_PENDING' });
    }
  } catch(e) { status = 'failed'; errors.push({ phase: 'episode', code: e.code ?? e.name, message: String(e.message).slice(0,250) }); }
  // Continue already-issued native work to the same fixed observation horizon;
  // do not fabricate work after a controller/provider/stop failure.
  w.advance(horizonMs, { maxEvents: 1000000 });
  const metrics = evaluate(w);
  const outcomes = corpus.gold.map(g => w.need(g.needId)).map(n => ({ id: n.id, building: n.building,
    type: n.type, unit: n.unit, quantity: n.quantity, served: Math.min(n.quantity,n.served),
    overprovided: Math.max(0,n.served-n.quantity), completedAt: n.completedAt,
    firstServiceAt: n.firstServiceAt ?? null, censored: n.completedAt == null,
    firstUsefulCensored: n.firstServiceAt == null,
    timeToSufficientServiceMs: (n.completedAt ?? horizonMs)-n.createdAt,
    timeToFirstUsefulServiceMs: (n.firstServiceAt ?? horizonMs)-n.createdAt }));
  const usage = (await Promise.all(h.apps.map(a=>a.store.query('SELECT model,state,cost_usd,reserved_usd,wall_ms,input_tokens,output_tokens,error FROM usage')))).flatMap(r=>r.rows);
  // Post-execution source audit only. The private authoring key separates the
  // immutable exogenous corpus from legitimate arm-dependent progress posts;
  // neither this selector nor its hashes are exposed to any controller.
  const publicInputs=Array.from(w.state.posts).filter(p=>/^response-benchmark-(?:request|noise)-/.test(p.private?.causeEvent??''))
    .map(p=>p.public).sort((a,b)=>a.id.localeCompare(b.id));
  const final = await checkFinalBuilds({ candidate: candidateFingerprint, evaluator: evaluatorBuild, simulator: w.manifest.engineBuild },
    { candidate: buildFingerprint, evaluator: humanCapacityEvaluatorFingerprint });
  if (final.invalidStatus) status = final.invalidStatus;
  const result = finalizedResult = { arm, profile, condition, seed, episodeIdentity, candidateFingerprint, evaluatorFingerprint: evaluatorBuild,
    baseEvaluatorFingerprint: await evaluatorFingerprint(), ...finalizeEpisodeIntegrity({status,errors},final),
    protocol: { ...HUMAN_CAPACITY_PROTOCOL, count, noise, reposts, formalDelayMs, horizonMs, grid, extentKm,
      pumpMs, clarificationWorkers, humanCapacityOverrides, condition, budgetUsd, maxModelCalls, wallLimitMs },
    manifest: w.manifest, corpus: { manifest: corpus.manifest, config: corpus.config,rawPublicInputHash:hash(publicInputs),rawPublicInputCount:publicInputs.length }, outcomes, metrics,
    timeToSufficientService: nativeServiceSummary(outcomes), timeToFirstUsefulService: nativeServiceSummary(outcomes, 'firstUseful'),
    sourceCoverage: { receivedOriginals: seen.size, progressSources, routineSources, modelBatches: batches,
      manualSources: manual.size, manualProcessed: [...manual.values()].filter(x=>x.done&&!x.failed).length,
      manualFailed: [...manual.values()].filter(x=>x.failed).length,
      manualPending: [...manual.values()].filter(x=>!x.done).length,
      inquiries: [...candidateInquiries.values()].filter(x=>x.requested).length,
      deferredInquiries: [...candidateInquiries.values()].filter(x=>!x.requested).length,
      compilations, unchangedCompilationSkips },
    humanReceived: { work: [...humanReceiptHistory.values()], inbox: [...humanInboxHistory.values()] },
    activities,
    observerOnly: { scope: 'Final causal audit only; never sent to controllers or model context.',
      operations: w.state.operations.map(operationTrace), departures,
      publicInputs,
      humanWork: w.state.humanWork ?? null, events: Array.from(w.log).filter(e=>/human|review|dispatch|receive/.test(e.type ?? e.kind ?? '')) },
    proposalFunnel: await collectProposalServiceFunnel(h.apps,w), usage, ...reconcileUsage(usage,budgetUsd),profiler,
    invariants: w.invariants(), wallMs: performance.now()-started };
  return result;
  } finally {
    try { await h.close(); }
    catch(e) {
      if (!finalizedResult) throw e;
      finalizedResult.status='failed';finalizedResult.cleanupFailed=true;
      finalizedResult.errors.push({phase:'harness-close',code:e.code??e.name,message:String(e.message).slice(0,250)});
    }
  }
}

export function summarizeHumanCapacity(rows = [], planned = []) {
  const comparisons = [];
  for (const candidate of rows.filter(r=>r.arm==='B6')) for (const referenceArm of ['C_manual','C_decentralized','B5','B8']) {
    const condition = candidate.condition ?? candidate.profile;
    const a = rows.find(r=>r.arm===referenceArm&&(r.condition??r.profile)===condition&&r.seed===candidate.seed);
    const key = { seed: candidate.seed, profile: candidate.profile, condition, reference: referenceArm, candidate: 'B6' };
    if (!a) { comparisons.push({ ...key, comparable: false, reason: 'missing_pair' }); continue; }
    const unchanged=r=>r.candidateChanged===false&&r.evaluatorChanged===false&&r.simulatorChanged===false&&
      sealedHash(r.candidateFingerprint)&&sealedHash(r.evaluatorFingerprint)&&sealedHash(r.manifest?.engineBuild)&&
      r.finalCandidateFingerprint===r.candidateFingerprint&&r.finalEvaluatorFingerprint===r.evaluatorFingerprint&&r.finalEngineBuild===r.manifest.engineBuild;
    const comparable = a.status==='completed'&&candidate.status==='completed'&&
      a.invariants?.length===0&&candidate.invariants?.length===0&&unchanged(a)&&unchanged(candidate)&&
      sealedHash(a.corpus?.rawPublicInputHash)&&sealedHash(candidate.corpus?.rawPublicInputHash)&&
      a.corpus?.rawPublicInputCount>0&&candidate.corpus?.rawPublicInputCount>0&&
      a.candidateFingerprint===candidate.candidateFingerprint&&a.evaluatorFingerprint===candidate.evaluatorFingerprint&&
      a.manifest?.engineBuild===candidate.manifest?.engineBuild&&hash(a.protocol)===hash(candidate.protocol)&&hash(a.corpus)===hash(candidate.corpus);
    const baseline = a.timeToSufficientService?.restrictedMeanMs, model = candidate.timeToSufficientService?.restrictedMeanMs;
    comparisons.push({ ...key, comparable, reason: comparable ? null : 'incomplete_error_or_different_inputs_builds',
      sufficientRmstBaselineMs: baseline ?? null, sufficientRmstModelMs: model ?? null,
      referenceErrorCount: a.errors?.length ?? null, candidateErrorCount: candidate.errors?.length ?? null,
      physicalTimeGainFraction: comparable&&finite(baseline)&&baseline>0&&finite(model) ? (baseline-model)/baseline : null,
      note: 'All recovered errors and fallback outcomes are retained in completed comparable worlds. Positive gain is specific to this declared profile. B5/B8 negative effects and zero-work control are retained; not measured real-world life savings.' });
  }
  return { declaredRuns: planned.length || rows.length, observedRuns: rows.length,
    missingRuns: planned.filter(p=>!rows.some(r=>r.arm===p.arm&&(r.condition??r.profile)===(p.condition??p.profile)&&r.seed===p.seed)),
    completedRuns: rows.filter(r=>r.status==='completed').length, failedOrStoppedRuns: rows.filter(r=>r.status!=='completed').length,
    allOutcomes: rows.map(r=>({ arm:r.arm,profile:r.profile,condition:r.condition??r.profile,seed:r.seed,status:r.status,
      sufficient:r.timeToSufficientService,firstUseful:r.timeToFirstUsefulService,costUsd:r.costUsd,
      knownCostUsd:r.knownCostUsd,chargedBudgetUsd:r.chargedBudgetUsd,unknownCostRows:r.unknownCostRows,
      errors:r.errors, invariants:r.invariants })), comparisons,
    chargedBudgetUsd: rows.reduce((s,r)=>s+(finite(r.chargedBudgetUsd)?r.chargedBudgetUsd:0),0),
    unknownBudgetRows: rows.filter(r=>!finite(r.chargedBudgetUsd)).length };
}
