import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Independent OFFLINE reader: no application, simulator, provider or mutable
// evaluator imports. All observer evidence is used only AFTER a closed run.
const finite = x => typeof x === 'number' && Number.isFinite(x);
const nonnegative = x => finite(x) && x >= 0;
const number = x => finite(x) ? x : null;
const sum = xs => xs.every(finite) ? xs.reduce((a,b)=>a+b,0) : null;
const mean = xs => xs.length ? sum(xs)/xs.length : null;
const safeMean = xs => xs.length && xs.every(finite) ? mean(xs) : null;
const percentile = (xs,q) => xs.length && xs.every(finite) ? [...xs].sort((a,b)=>a-b)[Math.ceil((xs.length-1)*q)] : null;
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x==='object' ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])) : x;
export const digest = x => createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(canonical(x))??'[missing]').digest('hex');
const key = r => JSON.stringify([r.condition??r.profile,r.seed,r.arm]);
const hashValid = x => typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
const emptyTiming = reason => ({known:false,reason,preAuthorizationMs:null,pickupAndPreparationMs:null,loadedTravelMs:null,arrivalToServiceMs:null,totalMs:null});

export function sourceIntegrity(raw, expected={}) {
  const initial={candidate:raw?.candidateFingerprint,evaluator:raw?.evaluatorFingerprint,simulator:raw?.manifest?.engineBuild},
    final={candidate:raw?.finalCandidateFingerprint,evaluator:raw?.finalEvaluatorFingerprint,simulator:raw?.finalEngineBuild}, reasons=[];
  for(const k of ['candidate','evaluator','simulator']) {
    if(!hashValid(initial[k]))reasons.push('missing_or_invalid_initial_'+k);
    if(!hashValid(final[k]))reasons.push('missing_or_invalid_final_'+k);
    else if(final[k]!==initial[k])reasons.push('changed_'+k);
    if(expected[k]!=null&&expected[k]!==initial[k])reasons.push('not_declared_'+k);
    if(raw?.[k+'Changed']!==false)reasons.push('changed_or_unknown_flag_'+k);
  }
  if(expected.baseEvaluator!=null&&raw?.baseEvaluatorFingerprint!==expected.baseEvaluator)reasons.push('not_declared_base_evaluator');
  return {initial,final,stable:reasons.length===0,reasons};
}

export function providerCost(raw, {missing=false,cap=null,reported={}}={}) {
  const usage=Array.isArray(raw?.usage)?raw.usage:null, known=usage?.filter(u=>nonnegative(u.cost_usd)), unknown=usage?.filter(u=>!nonnegative(u.cost_usd));
  const countMismatch=usage!==null&&finite(raw?.modelCalls)&&raw.modelCalls!==usage.length,
    complete=!missing&&usage!==null&&raw?.usageMissing!==true&&!countMismatch&&raw?.status!=='running';
  return {usageRecords:usage?.length??null,providerCalls:usage?.length??number(raw?.modelCalls),
    reportedProviderCalls:number(raw?.modelCalls),usageCountMismatch:countMismatch,knownCostSubtotalUsd:known?sum(known.map(u=>u.cost_usd)):number(reported.knownCostUsd??reported.costUsd),
    totalProviderCostUsd:complete&&unknown.length===0?sum(known.map(u=>u.cost_usd)):null,
    totalCostKnown:complete&&unknown.length===0,unknownCostCalls:unknown?.length??null,
    unknownCostReserveUsd:unknown?sum(unknown.map(u=>nonnegative(u.reserved_usd)?u.reserved_usd:null)):null,
    chargedBudgetUsd:missing?number(reported.chargedBudgetUsd)??cap:number(raw?.chargedBudgetUsd),
    fullEpisodeCapExposureWhenMissingUsd:missing?cap:null,
    providerWallKnownSubtotalMs:usage?sum(usage.filter(u=>nonnegative(u.wall_ms)).map(u=>u.wall_ms)):null,
    providerWallTotalMs:complete&&usage.every(u=>nonnegative(u.wall_ms))?sum(usage.map(u=>u.wall_ms)):null,
    providerWallMissingCalls:usage?.filter(u=>!nonnegative(u.wall_ms)).length??null,
    failedCalls:usage?.filter(u=>u.state==='failed'||u.error).length??null,
    attempts:usage?.map(u=>({state:u.state??null,model:u.model??null,costUsd:number(u.cost_usd),reservedUsd:number(u.reserved_usd),
      wallMs:number(u.wall_ms),inputTokens:number(u.input_tokens),outputTokens:number(u.output_tokens),error:u.error??null}))??null,
    note:'Known subtotals are not total bills when usage is missing. A reserved cap is exposure, not an invented charge. SQL/CPU wall, infrastructure and human wages are separate.'};
}

function timingSummary(rows,first=false) {
  const field=first?'timeToFirstUsefulServiceMs':'timeToSufficientServiceMs', censor=first?'firstUsefulCensored':'censored',issues=[];
  if(!rows.length)issues.push('empty_denominator');
  if(rows.some(r=>!nonnegative(r[field])||typeof r[censor]!=='boolean'))issues.push('invalid_time_or_censor');
  const reached=rows.filter(r=>r[censor]===false), valid=!issues.length;
  return {eligible:rows.length,reached:rows.filter(r=>r[censor]===false).length,rightCensored:rows.filter(r=>r[censor]===true).length,
    unknownCensor:rows.filter(r=>typeof r[censor]!=='boolean').length,restrictedMeanMs:valid?safeMean(rows.map(r=>r[field])):null,
    restrictedMedianMs:valid?percentile(rows.map(r=>r[field]),.5):null,restrictedP95Ms:valid?percentile(rows.map(r=>r[field]),.95):null,
    reachedOnlyP95Ms:valid?percentile(reached.map(r=>r[field]),.95):null,issues,
    note:'Restricted mean/percentiles retain right-censored cases at their declared observation horizon. Reached-only p95 excludes censored cases and must be read with coverage.'};
}

function sourceStart(raw,n) {
  const communities=Array.isArray(raw.metrics?.perCommunity)?raw.metrics.perCommunity:[],
    exact=communities.find(r=>r.id===n.id)?.createdAt;
  if(nonnegative(exact))return {at:exact,scope:'source_need_createdAt'};
  const episodes=(Array.isArray(raw.metrics?.response?.episodes?.perEpisode)?raw.metrics.response.episodes.perEpisode:[]).filter(e=>e.need===n.id);
  if(episodes.length===1&&nonnegative(episodes[0].startedAt))return {at:episodes[0].startedAt,scope:'source_response_episode'};
  return {at:null,scope:'unknown'};
}
function uniqueOperations(rows=[]) {
  const map=new Map(),duplicates=[];
  for(const r of rows) {
    const k=JSON.stringify([r.owner??r.org,r.sourceId??r.id]);
    if(map.has(k)){duplicates.push(k);continue;} map.set(k,r);
  }
  return {rows:[...map.values()],duplicates};
}
function contributionTiming(raw,n,operation,at) {
  if(!operation)return emptyTiming('no_unique_positive_receipt_at_endpoint');
  const times=operation.times??{}, start=sourceStart(raw,n), authorized=number(times.authorized), arrived=number(times.arrived), service=number(times.service),
    loaded=(raw.observerOnly?.departures??[]).filter(d=>d.operation===(operation.sourceId??operation.id)&&d.owner===(operation.owner??operation.org)&&
      ['delivery','evacuation','transport'].includes(d.phase)&&nonnegative(d.departedAt)&&d.departedAt<=arrived).sort((a,b)=>a.departedAt-b.departedAt),
    dispatched=loaded.length?loaded[0].departedAt:number(times.dispatched);
  if(start.at===null||[authorized,dispatched,arrived,service].some(v=>v===null)||!(start.at<=authorized&&authorized<=dispatched&&dispatched<=arrived&&arrived<=service)||service!==at)
    return emptyTiming('missing_or_inconsistent_physical_clocks');
  return {known:true,reason:null,owner:operation.owner??operation.org,operation:operation.sourceId??operation.id,
    startScope:start.scope,loadedDepartureScope:loaded.length?'captured_first_loaded_departure':'source_operation_dispatched',preAuthorizationMs:authorized-start.at,pickupAndPreparationMs:dispatched-authorized,
    loadedTravelMs:arrived-dispatched,arrivalToServiceMs:service-arrived,totalMs:service-start.at,
    note:'Pre-authorization mixes reading/inference/confirmation/drafting/review/fleet waits. Pickup includes command/loading/repositioning, not only preparation.'};
}

export function physicalEvidence(raw) {
  const source=Array.isArray(raw.outcomes)?raw.outcomes:[], issues=[], ops=uniqueOperations(raw.observerOnly?.operations??[]);
  if(!Array.isArray(raw.outcomes))issues.push('missing_outcomes');
  const ids=new Set(); for(const n of source){if(ids.has(n.id))issues.push('duplicate_need:'+n.id);ids.add(n.id);
    if(typeof n.id!=='string'||!finite(n.quantity)||n.quantity<=0||!nonnegative(n.served)||typeof n.type!=='string'||typeof n.unit!=='string')issues.push('invalid_native_need:'+n.id);}
  const horizon=number(raw.protocol?.horizonMs), observed=number(raw.metrics?.simulatedMs), native={};
  if(!nonnegative(horizon)||horizon===0)issues.push('missing_or_invalid_horizon');
  if(!nonnegative(observed)||observed!==horizon)issues.push('observation_not_fixed_horizon');
  const needs=source.map(n=>{
    const relevant=ops.rows.filter(o=>o.need===n.id&&['delivery','evacuation'].includes(o.type)),
      positive=relevant.filter(o=>nonnegative(o.times?.service)&&o.times.service<=observed&&finite(o.received)&&o.received>0&&finite(o.quantity)&&o.received<=o.quantity),
      choose=at=>{const matches=positive.filter(o=>o.times.service===at);return matches.length===1?matches[0]:null;},
      integralRows=(raw.metrics?.response?.episodes?.perEpisode??[]).filter(e=>e.need===n.id),
      integral=integralRows.length&&integralRows.every(e=>nonnegative(e.uncoveredUnitMs))?sum(integralRows.map(e=>e.uncoveredUnitMs)):null,
      first=n.firstUsefulCensored===false?contributionTiming(raw,n,choose(n.firstServiceAt),n.firstServiceAt):emptyTiming('first_service_censored_or_unknown'),
      sufficient=n.censored===false?contributionTiming(raw,n,choose(n.completedAt),n.completedAt):emptyTiming('sufficient_service_censored_or_unknown'),
      perNeed={...n,uncoveredUnitMs:integral,operationCount:relevant.length,positivePhysicalReceipts:positive.length,
        firstContribution:first,thresholdContribution:sufficient,
        contributions:relevant.map(o=>({id:o.sourceId??o.id,owner:o.owner??o.org,state:o.state,type:o.type,vehicle:o.vehicle,
          quantity:number(o.quantity),received:number(o.received),times:o.times??{},failure:o.failure??null}))};
    if(horizon!==null&&(!nonnegative(n.timeToFirstUsefulServiceMs)||!nonnegative(n.timeToSufficientServiceMs)||n.timeToFirstUsefulServiceMs>horizon||n.timeToSufficientServiceMs>horizon))issues.push('time_outside_horizon:'+n.id);
    const start=sourceStart(raw,n).at;
    if(start===null)issues.push('unknown_need_onset:'+n.id);
    else for(const [clock,duration,censor] of [['firstServiceAt','timeToFirstUsefulServiceMs','firstUsefulCensored'],['completedAt','timeToSufficientServiceMs','censored']]) {
      if(typeof n[censor]==='boolean'&&n[censor]!==!finite(n[clock]))issues.push('inconsistent_censor:'+n.id+':'+clock);
      const end=n[censor]===true?observed:n[clock];
      if(!nonnegative(end)||end<start||end>observed||!finite(n[duration])||Math.abs(n[duration]-(end-start))>1e-6)issues.push('inconsistent_elapsed:'+n.id+':'+clock);
    }
    const k=JSON.stringify([n.type,n.unit]), group=native[k]??={type:n.type,unit:n.unit,needs:[]};group.needs.push(perNeed);
    return perNeed;
  });
  const byResource=Object.values(native).map(g=>({type:g.type,unit:g.unit,eligible:g.needs.length,
    demand:sum(g.needs.map(n=>number(n.quantity))),usefulServed:sum(g.needs.map(n=>number(n.served))),
    outstanding:sum(g.needs.map(n=>finite(n.quantity)&&finite(n.served)?Math.max(0,n.quantity-n.served):null)),
    excessReceived:sum(g.needs.map(n=>number(n.overprovided))),uncoveredUnitMs:sum(g.needs.map(n=>n.uncoveredUnitMs)),
    firstUseful:timingSummary(g.needs,true),sufficient:timingSummary(g.needs),
    issuedOperations:sum(g.needs.map(n=>n.operationCount)),positivePhysicalReceipts:sum(g.needs.map(n=>n.positivePhysicalReceipts)),
    multipleReceiptNeeds:g.needs.filter(n=>n.positivePhysicalReceipts>1).length,
    note:'Native quantities and deficit unit-ms are never summed across resource units. Several receipts may be legitimate partial help; multiple receipts alone are not duplicate aid.'}));
  const stageSummary=endpoint=>Object.fromEntries(['preAuthorizationMs','pickupAndPreparationMs','loadedTravelMs','arrivalToServiceMs','totalMs'].map(field=>{
    const known=needs.filter(n=>n[endpoint].known).map(n=>n[endpoint][field]);return [field,{meanMs:safeMean(known),observed:known.length,eligible:needs.length}];}));
  return {horizonMs:horizon,observedSourceMs:observed,firstUseful:timingSummary(needs,true),sufficient:timingSummary(needs),byResource,needs,
    stages:{firstContribution:stageSummary('firstContribution'),thresholdContribution:stageSummary('thresholdContribution')},
    sourceOperationDuplicates:ops.duplicates,allSourceOperationCounts:{unique:ops.rows.length,delivery:ops.rows.filter(o=>o.type==='delivery').length,
      failed:ops.rows.filter(o=>o.state==='failed').length,pending:ops.rows.filter(o=>!['completed','failed','cancelled','rejected'].includes(o.state)).length},
    physicalTotals:raw.metrics?.physical??null,issues:[...issues,...timingSummary(needs,true).issues,...timingSummary(needs).issues],
    note:'Closed failed/stopped worlds retain their physical observations but are not paired as completed runs. First/threshold stages select exact unique positive source receipts, never last authorization or an acknowledgement.'};
}

export function humanEvidence(raw) {
  const received=new Map(),conflicts=[];
  for(const r of raw.humanReceived?.work??[]) {
    const k=JSON.stringify([r.org,r.id]),old=received.get(k);
    if(!old||finite(r.version)&&r.version>old.version)received.set(k,r);
    else if(r.version===old.version&&r.state!==old.state)conflicts.push(k);
  }
  const project=r=>({id:r.id,org:r.org,stage:r.stage,version:r.version,state:r.state,createdAt:number(r.createdAt),startedAt:number(r.startedAt),
    readyAt:number(r.readyAt),completedAt:number(r.completedAt),receivedAt:number(r.receivedAt),workMs:number(r.workMs),queueMs:number(r.queueMs),
    reference:r.reference?{kind:r.reference.kind,id:r.reference.id,version:r.reference.version??null}:null});
  const finalTasks=(raw.observerOnly?.humanWork??[]).map(project), receivedTasks=[...received.values()].map(project), groups={};
  for(const r of receivedTasks){const k=JSON.stringify([r.org,r.stage]);const g=groups[k]??={org:r.org,stage:r.stage,tasks:[]};g.tasks.push(r);}
  return {nativeSummary:raw.metrics?.humanCapacity??null,finalSourceTaskMetadata:finalTasks,
    latestReceivedTasks:receivedTasks,receivedVersionConflicts:conflicts,
    receivedByOwnerStage:Object.values(groups).map(g=>({org:g.org,stage:g.stage,total:g.tasks.length,
      completed:g.tasks.filter(t=>t.state==='completed').length,inconclusive:g.tasks.filter(t=>t.state==='inconclusive').length,
      failed:g.tasks.filter(t=>t.state==='failed').length,pending:g.tasks.filter(t=>!['completed','inconclusive','failed','cancelled'].includes(t.state)).length,
      observedStartedQueueMs:sum(g.tasks.filter(t=>finite(t.startedAt)&&finite(t.createdAt)).map(t=>t.startedAt-t.createdAt))})),
    note:'Native stage/backlog/person-ms includes source background work. Received tasks use latest versions, not every historical snapshot. Pending work remains censored; no task/relay/review is physical aid. Raw payload/text/private snapshots are not copied.'};
}

export function normalizeWorld(raw, declaration, {source={},entry={},plan={}}={}) {
  const reasons=[], integrity=sourceIntegrity(raw,source), physical=physicalEvidence(raw), reported=entry.reported??{};
  if(raw.status!=='completed')reasons.push('not_completed:'+raw.status);
  if(!Array.isArray(raw.invariants))reasons.push('missing_invariant_evidence');else if(raw.invariants.length)reasons.push('invariant_failure');
  if(raw.invalidStatus)reasons.push(raw.invalidStatus);
  if(!Array.isArray(raw.errors))reasons.push('missing_error_audit');
  if(!raw.protocol||typeof raw.protocol.version!=='string')reasons.push('missing_protocol');
  if(!hashValid(raw.corpus?.manifest?.corpusHash)||!hashValid(raw.corpus?.manifest?.mapHash)||raw.corpus?.manifest?.seed!==raw.seed)reasons.push('missing_or_inconsistent_corpus_manifest');
  if(key(raw)!==key(declaration)||raw.profile!==declaration.profile)reasons.push('not_declared_world');
  if((plan.version??plan.protocol?.version)!=null&&raw.protocol?.version!==(plan.version??plan.protocol?.version))reasons.push('not_declared_protocol_version');
  for(const [field,value] of Object.entries({...plan.config,...declaration}).filter(([field])=>!['arm','seed','profile','condition'].includes(field))) {
    if(raw.protocol?.[field]!==undefined&&digest(raw.protocol[field])!==digest(value))reasons.push('not_declared_config:'+field);
    else if(raw.protocol?.[field]===undefined&&Object.hasOwn(plan.config??{},field))reasons.push('missing_declared_config:'+field);
  }
  const expectedCount=declaration.count??plan.config?.count??raw.protocol?.count;
  if(!Number.isSafeInteger(expectedCount)||raw.outcomes?.length!==expectedCount)reasons.push('wrong_or_unknown_denominator');
  for(const [reported,calculated] of [[raw.timeToFirstUsefulService,physical.firstUseful],[raw.timeToSufficientService,physical.sufficient]])
    if(!reported||reported.eligible!==calculated.eligible||reported.reached!==calculated.reached||reported.rightCensored!==calculated.rightCensored||!finite(reported.restrictedMeanMs)||
      !finite(calculated.restrictedMeanMs)||Math.abs(reported.restrictedMeanMs-calculated.restrictedMeanMs)>1e-6)reasons.push('reported_physical_summary_mismatch');
  return {arm:raw.arm,profile:raw.profile,condition:raw.condition??raw.profile,seed:raw.seed,status:raw.status,
    declared:true,file:entry.file??null,sha256:entry.sha256??null,source:integrity,protocolHash:digest(raw.protocol),corpusHash:digest(raw.corpus),
    cohortHash:digest((Array.isArray(raw.outcomes)?raw.outcomes:[]).map(n=>({id:n.id,building:n.building,type:n.type,unit:n.unit,quantity:n.quantity,createdAt:sourceStart(raw,n).at})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))),
    validForComparison:reasons.length===0&&integrity.stable&&physical.issues.length===0,
    invalidReasons:[...reasons,...integrity.reasons,...physical.issues],errors:raw.errors??null,invariants:raw.invariants??null,
    recoveredErrorCount:Array.isArray(raw.errors)?raw.errors.length:null,cost:providerCost(raw,{reported,cap:plan.episodeBudgetUsd??raw.protocol?.budgetUsd??null}),physical,human:humanEvidence(raw),
    sourceCoverage:raw.sourceCoverage??null,proposalFunnel:raw.proposalFunnel??null,
    modelAvailability:(raw.activities??[]).filter(a=>a.stage==='model-controller-availability'),
    hostWallMs:number(raw.wallMs),profiler:raw.profiler??null,
    note:'Completed recovered-error worlds remain eligible if sources, physical evidence and protocol match. Errors/costs are retained; no success-only source selection.'};
}

function differenceStages(a,b) {
  const matches=[];for(const n of b.physical.needs){const r=a.physical.needs.find(x=>x.id===n.id);if(r)matches.push([r,n]);}
  return Object.fromEntries(['firstContribution','thresholdContribution'].map(endpoint=>[endpoint,
    Object.fromEntries(['preAuthorizationMs','pickupAndPreparationMs','loadedTravelMs','arrivalToServiceMs','totalMs'].map(field=>{
      const values=matches.filter(([r,n])=>r[endpoint].known&&n[endpoint].known).map(([r,n])=>n[endpoint][field]-r[endpoint][field]);
      return [field,{candidateMinusReferenceMeanMs:safeMean(values),pairedObserved:values.length,eligible:matches.length}];}))]));
}

export function compareWorlds(reference,candidate) {
  const reasons=[];
  if(!reference||!candidate)reasons.push('missing_pair');
  else {
    if(!reference.validForComparison||!candidate.validForComparison)reasons.push('invalid_or_incomplete_world');
    for(const field of ['seed','condition','profile','protocolHash','corpusHash','cohortHash'])if(reference[field]!==candidate[field])reasons.push('different_'+field);
    if(digest(reference.source.initial)!==digest(candidate.source.initial))reasons.push('different_source_builds');
  }
  const comparable=!reasons.length, result={seed:candidate?.seed??reference?.seed,condition:candidate?.condition??reference?.condition,
    profile:candidate?.profile??reference?.profile,reference:reference?.arm??null,candidate:candidate?.arm??'B6',comparable,reasons};
  for(const endpoint of ['firstUseful','sufficient']){
    const a=reference?.physical?.[endpoint]?.restrictedMeanMs??null,b=candidate?.physical?.[endpoint]?.restrictedMeanMs??null;
    result[endpoint]={referenceRmstMs:a,candidateRmstMs:b,reductionFraction:comparable&&finite(a)&&a>0&&finite(b)?(a-b)/a:null,
      referenceCoverage:reference?.physical?.[endpoint]??null,candidateCoverage:candidate?.physical?.[endpoint]??null};
  }
  result.stages=comparable?differenceStages(reference,candidate):null;
  return result;
}

export function readEvidenceData(plan,entries=[],summary=null) {
  const declarations=Array.isArray(plan.worlds)?plan.worlds:[], grouped=new Map(),rows=[],missing=[],unplanned=[];
  const declarationCounts=new Map();for(const d of declarations)declarationCounts.set(key(d),(declarationCounts.get(key(d))??0)+1);
  const duplicateDeclarations=[...declarationCounts.entries()].filter(([,count])=>count>1).map(([world,count])=>({world:JSON.parse(world),count}));
  for(const e of entries){if(e.raw?.arm&&e.raw?.seed){const k=key(e.raw);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(e);}}
  const source=plan.source??{}, duplicates=[],processed=new Set();
  for(const d of declarations){if(processed.has(key(d)))continue;processed.add(key(d));
    const found=grouped.get(key(d))??[],reported=summary?.allOutcomes?.find(r=>key(r)===key(d))??{};
    if(!found.length){const cap=d.arm==='B6'?plan.episodeBudgetUsd??plan.config?.budgetUsd:null;missing.push({...d,reason:'missing_closed_raw',reportedSummary:reported,
      cost:providerCost(null,{missing:true,cap,reported})});continue;}
    if(found.length>1)duplicates.push({world:d,files:found.map(e=>e.file)});
    for(const e of found){const r=normalizeWorld(e.raw,d,{source,entry:{...e,reported},plan});
      if(found.length>1){r.validForComparison=false;r.invalidReasons.push('duplicate_world_attempt');}
      if(declarationCounts.get(key(d))>1){r.validForComparison=false;r.invalidReasons.push('duplicate_declared_world');}rows.push(r);}
    grouped.delete(key(d));
  }
  for(const es of grouped.values())for(const e of es)unplanned.push({file:e.file,sha256:e.sha256,world:{arm:e.raw.arm,seed:e.raw.seed,condition:e.raw.condition??e.raw.profile},status:e.raw.status,
    errors:e.raw.errors??null,cost:providerCost(e.raw),reason:'not_predeclared'});
  const comparisons=[];
  for(const d of declarations.filter(w=>w.arm==='B6'))for(const arm of ['C_manual','B5','B8','C_decentralized']) {
    const rd=declarations.find(w=>w.arm===arm&&w.seed===d.seed&&(w.condition??w.profile)===(d.condition??d.profile));
    if(!rd)continue;
    const a=rows.filter(r=>key(r)===key(rd)),b=rows.filter(r=>key(r)===key(d));
    const p=compareWorlds(a.length===1?a[0]:null,b.length===1?b[0]:null);
    p.reference=arm;p.candidate='B6';p.seed=d.seed;p.condition=d.condition??d.profile;p.profile=d.profile;comparisons.push(p);
  }
  const aggregates=[];
  for(const condition of [...new Set(comparisons.map(c=>c.condition))])for(const reference of ['C_manual','B5','B8','C_decentralized']){
    const declared=comparisons.filter(c=>c.condition===condition&&c.reference===reference);if(!declared.length)continue;
    const complete=declared.every(c=>c.comparable),aggregate={condition,reference,candidate:'B6',declaredPairs:declared.length,
      validPairs:declared.filter(c=>c.comparable).length,allDeclaredPairsComparable:complete,estimand:'ratio_of_mean_paired_restricted_means; all declared seeds required'};
    for(const endpoint of ['firstUseful','sufficient']){
      const a=declared.map(c=>c[endpoint].referenceRmstMs),b=declared.map(c=>c[endpoint].candidateRmstMs),paired=declared.map(c=>c[endpoint].reductionFraction);
      aggregate[endpoint]={referenceMeanRmstMs:complete?safeMean(a):null,candidateMeanRmstMs:complete?safeMean(b):null,
        reductionFraction:complete&&safeMean(a)>0?(safeMean(a)-safeMean(b))/safeMean(a):null,
        meanPairedReductionFraction:complete?safeMean(paired):null,
        perSeedRange:complete&&paired.every(finite)?{min:Math.min(...paired),max:Math.max(...paired)}:null};
    }
    aggregate.note='Descriptive small-seed result, not a confidence interval, significance claim or external human calibration. No aggregation over a favorable subset of incomplete pairs.';
    aggregates.push(aggregate);
  }
  const costs=[...rows,...missing,...unplanned].map(r=>r.cost);
  return {schema:'offline-native-human-capacity-evidence-v1',declaredRuns:declarations.length,observedRawRuns:rows.length,
    completedRuns:rows.filter(r=>r.status==='completed').length,validRuns:rows.filter(r=>r.validForComparison).length,
    missingRuns:missing,duplicateDeclarations,duplicateAttempts:duplicates,unplannedRuns:unplanned,rows,comparisons,aggregates,
    costSummary:{knownSubtotalUsd:sum(costs.filter(c=>finite(c.knownCostSubtotalUsd)).map(c=>c.knownCostSubtotalUsd)),
      allAttemptCostsKnown:!missing.length&&!duplicates.length&&costs.every(c=>c.totalCostKnown),
      totalProviderCostUsd:!missing.length&&!duplicates.length&&costs.every(c=>c.totalCostKnown)?sum(costs.map(c=>c.totalProviderCostUsd)):null,
      chargedBudgetUsd:sum(costs.map(c=>c.chargedBudgetUsd)),rowsWithUnknownCost:costs.filter(c=>!c.totalCostKnown).length,
      missingPaidCapExposureUsd:sum(missing.filter(r=>r.arm==='B6').map(r=>r.cost.fullEpisodeCapExposureWhenMissingUsd)),
      possibleRepeatedLedgerArtifacts:duplicates.length,
      note:'Includes invalid, duplicate and unplanned artifacts; charges are not discarded with ineligible comparisons. Duplicate world files may repeat a ledger, so subtotals remain artifact-scoped and no confirmed total bill is asserted until reconciled.'},
    reportedSummary:summary,reportedSummaryScope:'Preserved as reported; independently recomputed physical denominators and matching gates above are authoritative for this readout.',
    note:'Every planned/missing/failed/censored/recovered-error world is retained. Manual gains do not imply GenAI beats B5/B8. Secondary decentralized conditions are not pooled with the primary moderate family.'};
}

export async function sealReader(folder) {
  const bytes=await readFile(fileURLToPath(import.meta.url)),sha256=digest(bytes),dir=resolve(folder,sha256);await mkdir(dir,{recursive:true});
  const file=resolve(dir,'read-human-capacity-evidence.mjs'),manifest=resolve(dir,'manifest.json');
  try{await writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||digest(await readFile(file))!==sha256)throw e;}
  try{await writeFile(manifest,JSON.stringify({schema:'offline-reader-byte-seal-v1',sealedAt:new Date().toISOString(),sha256,file,
    source:fileURLToPath(import.meta.url),note:'Reader bytes archived before campaign result loading. No mutable harness/provider imports or calls.'},null,2),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const m=JSON.parse(await readFile(manifest,'utf8'));if(m.sha256!==sha256)throw Error('Reader archive manifest mismatch');}
  return {file,manifest,sha256};
}

export async function readCampaign(folder,{archiveDir=resolve('.local/human-capacity-reader-archive')}={}) {
  const reader=await sealReader(archiveDir); // This happens BEFORE any result load.
  folder=resolve(folder);const planFile=resolve(folder,'protocol.json'),planBytes=await readFile(planFile),plan=JSON.parse(planBytes),entries=[],unreadable=[],ignored=[];
  if(!Array.isArray(plan.worlds)||!plan.worlds.length)throw Error('Explicit declared worlds required; smoke is not silently promoted to an impact campaign.');
  const names=(await readdir(folder)).filter(n=>n.endsWith('.json')&&!['protocol.json','summary.json'].includes(n)).sort();
  for(const name of names){const file=resolve(folder,name);try{const before=await stat(file),bytes=await readFile(file),after=await stat(file);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('FILE_CHANGED_DURING_READ');
    const raw=JSON.parse(bytes),entry={file,sha256:digest(bytes),raw};
    if(raw.arm&&raw.seed&&typeof raw.status==='string')entries.push(entry);else ignored.push({file,sha256:entry.sha256,reason:'not_closed_world_shape'});
  }catch(e){unreadable.push({file,reason:e.code??e.message});}}
  let summary=null,summarySha256=null;try{const bytes=await readFile(resolve(folder,'summary.json'));summarySha256=digest(bytes);summary=JSON.parse(bytes);}catch(e){if(e.code!=='ENOENT')unreadable.push({file:resolve(folder,'summary.json'),reason:e.code??e.message});}
  const evidence=readEvidenceData(plan,entries,summary);
  if(unreadable.length){evidence.costSummary.allAttemptCostsKnown=false;evidence.costSummary.totalProviderCostUsd=null;}
  evidence.costSummary.unreadableFilesWithUnknownScope=unreadable.length;
  return {...evidence,reader,protocol:{file:planFile,sha256:digest(planBytes),family:plan.family??null,source:plan.source??null},
    summarySha256,folder,unreadableFiles:unreadable,ignoredFiles:ignored,generatedAt:new Date().toISOString()};
}

export function renderMarkdown(r) {
  const lines=['# Native human-capacity physical evidence','',`Reader SHA256: ${r.reader?.sha256??'pure fixture'}; declared ${r.declaredRuns}, raw ${r.observedRawRuns}, valid ${r.validRuns}, missing ${r.missingRuns.length}.`,
    '', '| Condition | Seed | Arm | Status | Sufficient/eligible | Censored | First RMST min | Sufficient RMST min | Known USD subtotal | Cost total known |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---|'];
  const show=x=>finite(x)?x.toFixed(4):'unknown';
  const minutes=x=>finite(x)?show(x/60000):'unknown';
  for(const w of r.rows)lines.push(`| ${w.condition} | ${w.seed} | ${w.arm} | ${w.status} | ${w.physical.sufficient.reached}/${w.physical.sufficient.eligible} | ${w.physical.sufficient.rightCensored} | ${minutes(w.physical.firstUseful.restrictedMeanMs)} | ${minutes(w.physical.sufficient.restrictedMeanMs)} | ${show(w.cost.knownCostSubtotalUsd)} | ${w.cost.totalCostKnown} |`);
  lines.push('','## All declared paired seeds','', '| Condition | Reference | Valid/declared pairs | Sufficient time reduction | First useful time reduction |','|---|---|---:|---:|---:|');
  for(const a of r.aggregates)lines.push(`| ${a.condition} | ${a.reference} | ${a.validPairs}/${a.declaredPairs} | ${finite(a.sufficient.reductionFraction)?show(100*a.sufficient.reductionFraction)+'%':'unknown'} | ${finite(a.firstUseful.reductionFraction)?show(100*a.firstUseful.reductionFraction)+'%':'unknown'} |`);
  lines.push('','Negative reduction means slower. A completed recovered-error world remains included. Small-seed descriptive results do not establish significance, empirical human rates, lives saved or Gemini performance.',
    '', 'The JSON retains every need, native-unit deficit/excess, source hashes, errors, provider attempts/reservations, latest received human tasks and physical stage coverage. Missing or duplicate worlds never form an aggregate over the favorable remainder.',
    '', 'Manual coordination gains and incremental GenAI gains are separate comparisons; strong B5/B8 references remain visible.');
  return lines.join('\n')+'\n';
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const opts=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf('=');return i>=0?[s.slice(0,i).replace(/^--/,''),s.slice(i+1)]:[s.replace(/^--/,''),true];}));
  if(opts.seal&&!opts.folder)console.log(JSON.stringify(await sealReader(resolve(opts.seal))));
  else {
    if(!opts.folder)throw Error('Use --folder=<closed campaign directory>, optionally --out=<new JSON path>, or --seal=<archive directory>.');
    const r=await readCampaign(opts.folder,{archiveDir:opts.archive?resolve(opts.archive):undefined});
    if(opts.out){const out=resolve(opts.out);await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(r,null,2),{flag:'wx'});
      await writeFile(out.replace(/\.json$/i,'')+'.md',renderMarkdown(r),{flag:'wx'});}
    console.log(JSON.stringify({reader:r.reader,folder:r.folder,declared:r.declaredRuns,observed:r.observedRawRuns,valid:r.validRuns,missing:r.missingRuns.length,
      duplicates:r.duplicateAttempts.length,unreadable:r.unreadableFiles.length,aggregates:r.aggregates}));
  }
}
