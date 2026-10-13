import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = 'native-human-kpi-companion-v1';
export const PROVENANCE = {
  blindness: 'Post-baseline companion: author previously read C_manual/B5 seed01 summaries during an authorized denominator audit; no B6 or further primary outcomes were read to define this companion.',
  definitions: 'Fixed from documented KPI semantics and source implementation; no outcome-fitted threshold, selected seed, controller change or new success criterion.',
  scope: 'Offline descriptive companion only. It does not replace the sealed primary reader or certify semantic correctness, real human performance, or comparative benefit.',
};
const STAGES = ['read', 'decide', 'relay'];
const TERMINAL = new Set(['completed', 'inconclusive', 'failed']);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const clock = x => finite(x) && x >= 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quantile = (xs, p) => xs.length ? [...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)] : null;
const summary = xs => ({ samples: xs.length, p50: quantile(xs,.5), p95: quantile(xs,.95), maximum: xs.length ? Math.max(...xs) : null });

/** Interval union is elapsed wall/source time. A sum of overlapping intervals is
 * scoped occupancy, never a serial end-to-end latency. */
export function intervalUnionMs(intervals) {
  const rows = intervals.filter(([a,b])=>clock(a)&&clock(b)&&b>=a).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let total=0,start=null,end=null;
  for (const [a,b] of rows) {
    if(start===null){start=a;end=b;} else if(a<=end)end=Math.max(end,b); else {total+=end-start;start=a;end=b;}
  }
  return total+(start===null?0:end-start);
}

export function latestTasks(rows) {
  const latest=new Map(),issues=[];
  for(const row of rows??[]) {
    if(typeof row?.id!=='string'||typeof row.org!=='string'||!STAGES.includes(row.stage)){issues.push('invalid_task_identity');continue;}
    const key=row.org+':'+row.id,prior=latest.get(key),v=Number.isSafeInteger(row.version)?row.version:0;
    if(!prior||v>(Number.isSafeInteger(prior.version)?prior.version:0))latest.set(key,row);
    else if(v===(Number.isSafeInteger(prior.version)?prior.version:0)&&hash(JSON.stringify(prior))!==hash(JSON.stringify(row)))issues.push('conflicting_equal_task_version');
  }
  return {rows:[...latest.values()],issues};
}

function taskStats(rows, cutoff) {
  const valid=rows.filter(t=>clock(t.createdAt)&&t.createdAt<=cutoff),finished=[],completed=[],started=[],pending=[];
  let work=0,queue=0,workKnown=true;
  for(const t of valid) {
    const end=TERMINAL.has(t.state)&&clock(t.completedAt)&&t.completedAt<=cutoff?t.completedAt:null;
    const begin=clock(t.startedAt)&&t.startedAt>=t.createdAt&&t.startedAt<=cutoff?t.startedAt:null;
    if(begin!==null) {
      started.push(begin-t.createdAt);
      // readyAt bounds actual cognitive work. Relay delivery waiting does not
      // become labor; review work is already a decide-stage task.
      if(clock(t.readyAt)&&t.readyAt>=begin)work+=Math.max(0,Math.min(cutoff,t.readyAt)-begin);
      else workKnown=false;
    }
    queue+=Math.max(0,(begin??end??cutoff)-t.createdAt);
    if(end!==null) {
      finished.push(end-t.createdAt);
      if(t.state==='completed')completed.push(end-t.createdAt);
    } else pending.push({state:t.state,ageMs:cutoff-t.createdAt,started:begin!==null});
  }
  return {received:valid.length,completed:completed.length,finishedTerminal:finished.length,
    inconclusive:valid.filter(t=>t.state==='inconclusive'&&clock(t.completedAt)&&t.completedAt<=cutoff).length,
    failed:valid.filter(t=>t.state==='failed'&&clock(t.completedAt)&&t.completedAt<=cutoff).length,
    elapsedWorkPersonMs:workKnown?work:null,elapsedQueuePersonMs:queue,
    startedQueueMs:summary(started),completedTurnaroundMs:summary(completed),finishedTerminalTurnaroundMs:summary(finished),
    pendingCensored:pending.length,pendingCensoredAt:cutoff,pendingAgeMs:summary(pending.map(t=>t.ageMs)),
    pendingByState:Object.fromEntries([...new Set(pending.map(t=>t.state))].sort().map(s=>[s,pending.filter(t=>t.state===s).length])),
    invalidCreatedClock:rows.length-valid.length,
    deadlineOverdue:null,deadlineNote:'read/decide have no universal native deadline. A relay failure is not automatically a read/decision expiry. No deadline is invented here.'};
}

const DELTAS = {
  operationCreationToAuthorization:['createdAt','authorized'],
  authorizationToReservation:['authorized','reserved'],
  reservationToPickupArrival:['reserved','pickupArrived'],
  pickupArrivalToPrepared:['pickupArrived','prepared'],
  preparedToDestinationArrival:['prepared','arrived'],
  destinationArrivalToPhysicalReceipt:['arrived','received'],
  physicalReceiptToUsefulService:['received','service'],
  operationCreationToUsefulService:['createdAt','service'],
  operationCreationToPhysicalReceipt:['createdAt','received'],
};

export function operationDurations(operations,cutoff) {
  const valid=[],issues=[],scopeIntervals=[],seen=new Set(),exact=Object.fromEntries(Object.keys(DELTAS).map(k=>[k,[]]));
  for(const op of operations??[]) {
    if(typeof op?.id!=='string'||!clock(op.createdAt)||op.createdAt>cutoff){issues.push('invalid_operation_identity_or_created_clock');continue;}
    const key=(op.owner??op.org??'unknown')+':'+op.id;
    if(seen.has(key)){issues.push('duplicate_operation_scope');continue;}seen.add(key);
    const at={createdAt:op.createdAt,...op.times},deltas={};
    for(const [name,[from,to]]of Object.entries(DELTAS)) {
      const a=at[from],b=at[to];
      if(!clock(a)||!clock(b)||a>cutoff||b>cutoff){deltas[name]=null;continue;}
      if(b<a){issues.push('operation_timestamp_regression:'+name);deltas[name]=null;continue;}
      deltas[name]=b-a;exact[name].push(b-a);
    }
    const finalAt=clock(at.service)&&at.service<=cutoff?at.service:
      clock(at.received)&&at.received<=cutoff?at.received:
      clock(at.failed)&&at.failed<=cutoff?at.failed:cutoff;
    if(finalAt<op.createdAt){issues.push('operation_terminal_regression');continue;}
    scopeIntervals.push([op.createdAt,finalAt]);
    valid.push({id:op.id,owner:op.owner??op.org??null,type:op.type??null,state:op.state??null,
      received:finite(op.received)?op.received:null,createdAt:op.createdAt,terminalOrCutoffAt:finalAt,
      rightCensored:!((clock(at.service)&&at.service<=cutoff)||(clock(at.received)&&at.received<=cutoff)||(clock(at.failed)&&at.failed<=cutoff)),
      deltas});
  }
  return {sampleOperations:valid.length,definitions:DELTAS,stageDifferences:Object.fromEntries(Object.entries(exact).map(([k,v])=>[k,summary(v)])),
    scopedOperationElapsedSumMs:scopeIntervals.reduce((n,[a,b])=>n+b-a,0),operationScopeUnionMs:intervalUnionMs(scopeIntervals),
    scopesOverlap:true,rows:valid,issues,
    unknownStages:['publication-to-controller HTTP availability','controller source waiting','model availability unless separate native receipt exists','inquiry receipt','human/source review-to-order link'],
    note:'Uses actual timestamps of each individual operation; metrics.latency cumulative offsets are never subtracted or summed. These intervals contain communication, preparation and physical waits where relevant, not pure driving. Overlapping operation sums are not end-to-end elapsed time.'};
}

function k09(record,vehicleLedger) {
  const p=record.metrics?.physical??{},u=record.metrics?.utilization??{};
  const rows=Array.isArray(vehicleLedger)?vehicleLedger:null;
  let owned=null;
  if(rows&&rows.every(v=>typeof v.id==='string'&&typeof v.background==='boolean'&&typeof v.owner==='string'&&finite(v.distanceM)&&v.distanceM>=0&&finite(v.fuelUsed)&&v.fuelUsed>=0)) {
    const native=rows.filter(v=>!v.background);
    owned={distanceM:native.reduce((n,v)=>n+v.distanceM,0),fuelMl:native.reduce((n,v)=>n+v.fuelUsed,0),vehicles:native.length,scope:'Explicit offline final vehicle ledger, non-background vehicles from all owners.'};
  }
  return {allVehicles:{distanceM:finite(p.distanceM)?p.distanceM:null,fuelMl:finite(p.fuelMl)?p.fuelMl:null,
    scope:'Native aggregate includes background traffic. A zero-traffic profile does not change that definition.'},ownedVehicles:owned,
    ownedUnknownReason:owned?null:'No complete offline vehicle ledger with explicit background classification; no ownership split inferred from aggregate metrics.',
    utilization:{available:u.available??false,vehicleCommittedHours:finite(u.vehicleCommittedHours)?u.vehicleCommittedHours:null,
      staffCommittedPersonHours:finite(u.staffCommittedPersonHours)?u.staffCommittedPersonHours:null,
      staffFieldWorkPersonHours:finite(u.staffFieldWorkPersonHours)?u.staffFieldWorkPersonHours:null,
      definition:u.definition??null},costPerUsefulUnit:null,
    note:'No fuel price, wages, per-resource allocation of shared transport cost or semantic correctness is invented.'};
}

export function summarizeEpisode(record,{vehicleLedger=null}={}) {
  const cutoff=record.metrics?.simulatedMs;
  if(!clock(cutoff))throw Error('MISSING_NATIVE_OBSERVATION_CUTOFF');
  const native=record.metrics?.humanCapacity;
  const dedup=latestTasks(record.observerOnly?.humanWork??[]),haveRaw=Array.isArray(record.observerOnly?.humanWork);
  const stages=Object.fromEntries(STAGES.map(stage=>[stage,haveRaw?taskStats(dedup.rows.filter(t=>t.stage===stage),cutoff):null]));
  const values=STAGES.map(stage=>native?.stages?.[stage]?.elapsedWorkPersonMs),nativeWorkKnown=values.every(x=>finite(x)&&x>=0);
  const work=nativeWorkKnown?values.reduce((a,b)=>a+b,0):haveRaw&&Object.values(stages).every(r=>finite(r.elapsedWorkPersonMs))?Object.values(stages).reduce((n,r)=>n+r.elapsedWorkPersonMs,0):null;
  const rawWork=haveRaw&&Object.values(stages).every(r=>finite(r.elapsedWorkPersonMs))?Object.values(stages).reduce((n,r)=>n+r.elapsedWorkPersonMs,0):null;
  const positive=(record.outcomes??[]).filter(n=>finite(n.quantity)&&n.quantity>0),sufficient=positive.filter(n=>clock(n.completedAt)&&n.completedAt<=cutoff&&finite(n.served)&&n.served>=n.quantity);
  const perOrg=Object.fromEntries([...new Set([...Object.keys(native?.perOrg??{}),...dedup.rows.map(t=>t.org)])].sort().map(org=>[org,
    {stages:Object.fromEntries(STAGES.map(s=>[s,haveRaw?taskStats(dedup.rows.filter(t=>t.org===org&&t.stage===s),cutoff):null])),
      maximumBacklog:finite(native?.perOrg?.[org]?.maximumBacklog)?native.perOrg[org].maximumBacklog:null,
      maximumBacklogScope:'Historical native maximum queued tasks in this organization across stages; end-state task counts cannot reconstruct a missing source maximum.'}]));
  const sealed=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),sourceUnchanged=
    record.candidateChanged===false&&record.evaluatorChanged===false&&record.simulatorChanged===false&&
    sealed(record.candidateFingerprint)&&sealed(record.evaluatorFingerprint)&&sealed(record.manifest?.engineBuild)&&
    record.finalCandidateFingerprint===record.candidateFingerprint&&record.finalEvaluatorFingerprint===record.evaluatorFingerprint&&record.finalEngineBuild===record.manifest.engineBuild;
  return {version:VERSION,provenance:PROVENANCE,identity:{arm:record.arm??null,profile:record.profile??null,condition:record.condition??null,seed:record.seed??null,status:record.status??null,
    candidateFingerprint:record.candidateFingerprint??null,evaluatorFingerprint:record.evaluatorFingerprint??null,engineBuild:record.manifest?.engineBuild??null,
    sourceUnchanged},cutoff,
    K20:{elapsedAttentionWorkPersonMs:work,elapsedAttentionWorkPersonMinutes:work===null?null:work/60000,
      source:nativeWorkKnown?'Sum of native stage elapsedWorkPersonMs':'Reconstruction from native task timestamps',
      independentlyRecomputedWorkPersonMs:rawWork,workReconciliationMatches:work!==null&&rawWork!==null?work===rawWork:null,
      operatorReviewMsExcludedFromAdditionalSum:true,operatorReviewMsReported:finite(record.metrics?.operatorReviewMs)?record.metrics.operatorReviewMs:null,
      sufficientPositiveCohortCases:sufficient.length,positiveCohortCases:positive.length,
      attentionMinutesPerPhysicallySufficientCohortCase:work!==null&&sufficient.length?work/60000/sufficient.length:null,
      minutesPerIndependentlyCorrectResolution:null,
      note:'All native attention work, including source review and routine tasks, once. Queue waiting is separate; native owner reviews already occupy decide. Physical sufficiency is not independent semantic correctness. No missing quality annotation is replaced by approval.'},
    K22:{stages,perOrg,maximumBacklog:finite(native?.maximumBacklog)?native.maximumBacklog:null,
      maximumBacklogScope:'Maximum of individual organizational total queued backlog; not simultaneous global summed peak.',
      nativeSummaryAvailable:!!native,rawTaskDetailsAvailable:haveRaw,taskIdentityIssues:dedup.issues,
      nativeQueueAndFinishedSummaries:haveRaw?null:native?.stages??null,
      sourceRecovery:null,recoveryNote:'No universal deadline or full source-version recovery gate is inferred from completed task counts. Use the separate fixed-cohort recovery report.'},
    K24:operationDurations(record.observerOnly?.operations??[],cutoff),K09:k09(record,vehicleLedger)};
}

export async function sealCompanion(folder) {
  const own=fileURLToPath(import.meta.url),test=own.replace(/\.mjs$/,'.test.mjs');
  const [bytes,testBytes]=await Promise.all([readFile(own),readFile(test)]);
  await mkdir(folder,{recursive:true});
  await writeFile(resolve(folder,basename(own)),bytes);await writeFile(resolve(folder,basename(test)),testBytes);
  const seal={version:VERSION,createdAt:new Date().toISOString(),provenance:PROVENANCE,
    helper:{file:basename(own),sha256:hash(bytes)},test:{file:basename(test),sha256:hash(testBytes)},
    noRawPrimaryInputsLoaded:true,noNewWorlds:true,noPaidCalls:true};
  await writeFile(resolve(folder,'seal.json'),JSON.stringify(seal,null,2));return seal;
}

async function cli() {
  const args=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf('=');return [s.slice(2,i<0?undefined:i),i<0?true:s.slice(i+1)];}));
  if(args['seal-only']) {const folder=resolve(args.output??`reports/kpi-companion/${Date.now()}`);const s=await sealCompanion(folder);console.log(JSON.stringify({sealed:true,folder,helperSha256:s.helper.sha256,testSha256:s.test.sha256}));return;}
  if(!args.input||!args.seal||!args.output)throw Error('OFFLINE_INPUT_SEAL_OUTPUT_REQUIRED');
  const seal=JSON.parse(await readFile(resolve(args.seal),'utf8'));
  const own=await readFile(fileURLToPath(import.meta.url));
  if(seal.version!==VERSION||seal.helper?.sha256!==hash(own))throw Error('COMPANION_SEAL_MISMATCH');
  const bytes=await readFile(resolve(args.input));if(bytes.length>128*1024*1024)throw Error('INPUT_TOO_LARGE');
  const record=JSON.parse(bytes.toString('utf8')),rows=Array.isArray(record)?record:record.rows??[record];
  const result={version:VERSION,sealSha256:hash(await readFile(resolve(args.seal))),inputSha256:hash(bytes),
    provenance:PROVENANCE,episodes:rows.map(r=>summarizeEpisode(r)),
    note:'Descriptive only; all input episodes retained. No paired causal claim or threshold is added.'};
  await mkdir(dirname(resolve(args.output)),{recursive:true});await writeFile(resolve(args.output),JSON.stringify(result,null,2));
  console.log(JSON.stringify({written:true,episodes:rows.length,output:resolve(args.output),inputSha256:result.inputSha256}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(e=>{console.error(e.message);process.exitCode=1;});
