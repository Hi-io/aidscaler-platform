// Post-outcome descriptive integration only. Frozen-reader/companion outputs
// define all metrics; no model, harness, world, source calls or new eligibility.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
const hash=b=>createHash('sha256').update(b).digest('hex');
const mean=v=>v.length&&v.every(Number.isFinite)?v.reduce((a,b)=>a+b,0)/v.length:null;
const sum=v=>v.every(Number.isFinite)?v.reduce((a,b)=>a+b,0):null;
const percent=(a,b)=>Number.isFinite(a)&&a>0&&Number.isFinite(b)?(a-b)/a:null;
const fields=['preAuthorizationMs','pickupAndPreparationMs','loadedTravelMs','arrivalToServiceMs','totalMs'];
const file=resolve('reports/analysis/native-human-primary-all12-20261013-closed.json');
const readerBytes=await readFile(file),r=JSON.parse(readerBytes),companions=[];
for(const name of (await readdir('reports/kpi-companion/native-primary-all12-20261013-closed')).filter(n=>/^world-\d+\.json$/.test(n)).sort()){
  const p=resolve('reports/kpi-companion/native-primary-all12-20261013-closed',name),bytes=await readFile(p),c=JSON.parse(bytes);
  companions.push({file:p,sha256:hash(bytes),inputSha256:c.inputSha256,sealSha256:c.sealSha256,episode:c.episodes[0]});
}
assert.equal(r.reader.sha256,'f3256a5fd685b8411491d41d1c03cf257e0a058ec31a16582eea24a7d7ddd3e9');
assert.equal(r.declaredRuns,12);assert.equal(r.observedRawRuns,12);assert.equal(r.validRuns,12);
assert.equal(r.missingRuns.length+r.duplicateAttempts.length+r.unplannedRuns.length+r.unreadableFiles.length,0);
assert.equal(companions.length,12);
const worlds=[],rawRefs=[];
for(const w of r.rows){
  const bytes=await readFile(w.file);assert.equal(hash(bytes),w.sha256);const raw=JSON.parse(bytes),c=companions.find(c=>c.inputSha256===w.sha256);
  assert(c);assert.equal(c.episode.identity.sourceUnchanged,true);
  const activities=raw.activities??[],confirm=activities.filter(a=>a.stage==='source-directed-confirmation');
  const inquiryProvenance=Object.fromEntries([...new Set(confirm.map(a=>a.provenance??'unknown'))].map(p=>[p,confirm.filter(a=>(a.provenance??'unknown')===p).length]));
  const model=activities.filter(a=>a.stage==='model-controller-availability');
  const availability=model.map(a=>({request:a.request,nativeDeclaredAvailableAt:a.nativeDeclaredAvailableAt,
    measuredProviderWallMs:a.measuredProviderWallMs,controllerObservedAt:a.controllerObservedAt}));
  rawRefs.push({arm:w.arm,seed:w.seed,file:w.file,sha256:w.sha256});
  worlds.push({arm:w.arm,seed:w.seed,condition:w.condition,status:w.status,errors:w.errors,invariants:w.invariants,
    source:w.source,eligible:w.physical.sufficient.eligible,reached:w.physical.sufficient.reached,censored:w.physical.sufficient.rightCensored,
    firstUseful:w.physical.firstUseful,sufficient:w.physical.sufficient,resources:w.physical.byResource,
    stages:w.physical.stages,operations:w.physical.allSourceOperationCounts,physicalTotals:w.physical.physicalTotals,
    sourceCoverage:w.sourceCoverage,cost:w.cost,hostWallMs:w.hostWallMs,K20:c.episode.K20,
    K22:{maximumBacklog:c.episode.K22.maximumBacklog,scope:c.episode.K22.maximumBacklogScope,
      stages:c.episode.K22.stages,perOrg:c.episode.K22.perOrg,taskIdentityIssues:c.episode.K22.taskIdentityIssues},
    K24:c.episode.K24,K09:c.episode.K09,inquiry:{requests:confirm.length,
      reused:confirm.filter(a=>a.reused===true).length,uniqueInspectionIds:new Set(confirm.map(a=>a.inspection).filter(Boolean)).size,
      provenance:inquiryProvenance,note:'Activities record requests/reuse, not completed verification receipts.'},
    modelAvailability:availability,physicalCases:w.physical.needs});
}
const arms=['C_manual','B5','B8','B6'];
const aggregate=arms.map(arm=>{
  const ws=worlds.filter(w=>w.arm===arm);assert.equal(ws.length,3);
  const keys=[...new Set(ws.flatMap(w=>w.resources.map(x=>JSON.stringify([x.type,x.unit]))))];
  return {arm,worlds:ws.length,eligible:sum(ws.map(w=>w.eligible)),reached:sum(ws.map(w=>w.reached)),censored:sum(ws.map(w=>w.censored)),
    meanFirstRmstMs:mean(ws.map(w=>w.firstUseful.restrictedMeanMs)),meanSufficientRmstMs:mean(ws.map(w=>w.sufficient.restrictedMeanMs)),
    meanStages:Object.fromEntries(fields.map(f=>[f,{meanMs:mean(ws.map(w=>w.stages.thresholdContribution[f].meanMs)),
      observed:sum(ws.map(w=>w.stages.thresholdContribution[f].observed)),eligible:sum(ws.map(w=>w.eligible))}])),
    resources:keys.map(k=>{const [type,unit]=JSON.parse(k),gs=ws.map(w=>w.resources.find(x=>x.type===type&&x.unit===unit));
      return {type,unit,eligible:sum(gs.map(x=>x.eligible)),demand:sum(gs.map(x=>x.demand)),usefulServed:sum(gs.map(x=>x.usefulServed)),
        outstanding:sum(gs.map(x=>x.outstanding)),excessReceived:sum(gs.map(x=>x.excessReceived)),deficitUnitMs:sum(gs.map(x=>x.uncoveredUnitMs)),
        deficitUnitMinutes:sum(gs.map(x=>x.uncoveredUnitMs))/60000,meanSufficientRmstMs:mean(gs.map(x=>x.sufficient.restrictedMeanMs)),
        issuedOperations:sum(gs.map(x=>x.issuedOperations)),positivePhysicalReceipts:sum(gs.map(x=>x.positivePhysicalReceipts))};}),
    providerCalls:sum(ws.map(w=>w.cost.providerCalls)),providerCostUsd:sum(ws.map(w=>w.cost.totalProviderCostUsd)),
    providerWallMs:sum(ws.map(w=>w.cost.providerWallTotalMs)),hostWallMs:sum(ws.map(w=>w.hostWallMs)),
    attentionWorkPersonMs:sum(ws.map(w=>w.K20.elapsedAttentionWorkPersonMs)),
    attentionWorkPersonMinutes:sum(ws.map(w=>w.K20.elapsedAttentionWorkPersonMinutes)),
    workReconciliation:ws.map(w=>({seed:w.seed,matches:w.K20.workReconciliationMatches})),
    sourceCounts:Object.fromEntries(['receivedOriginals','progressSources','routineSources','modelBatches','manualSources','manualProcessed','manualFailed','manualPending','inquiries','compilations','unchangedCompilationSkips'].map(k=>[k,sum(ws.map(w=>w.sourceCoverage[k]))])),
    inquiryProvenance:Object.fromEntries([...new Set(ws.flatMap(w=>Object.keys(w.inquiry.provenance)))].map(p=>[p,sum(ws.map(w=>w.inquiry.provenance[p]??0))])),
    inquiryReused:sum(ws.map(w=>w.inquiry.reused)),uniqueInspectionsPerWorld:ws.map(w=>w.inquiry.uniqueInspectionIds),
    nativeStages:Object.fromEntries(['read','decide','relay'].map(stage=>[stage,{taskCounts:ws.map(w=>({seed:w.seed,
      completed:w.K22.stages[stage]?.completed??null,pending:w.K22.stages[stage]?.pendingCensored??null})),
      completedTurnaround:ws.map(w=>({seed:w.seed,value:w.K22.stages[stage]?.completedTurnaroundMs??null})),
      nativeWorkPersonMs:sum(ws.map(w=>w.K22.stages[stage]?.elapsedWorkPersonMs)),
      nativeWaitingPersonMs:sum(ws.map(w=>w.K22.stages[stage]?.elapsedQueuePersonMs))}]))};
});
const b=aggregate.find(x=>x.arm==='B6');
const comparisons=r.aggregates.map(a=>{
  const ref=aggregate.find(x=>x.arm===a.reference),pairs=r.comparisons.filter(c=>c.reference===a.reference);
  assert(Math.abs(percent(ref.meanSufficientRmstMs,b.meanSufficientRmstMs)-a.sufficient.reductionFraction)<1e-12);
  return {...a,stageCandidateMinusReferenceMs:Object.fromEntries(fields.map(f=>[f,{meanMs:mean(pairs.map(p=>p.stages.thresholdContribution[f].candidateMinusReferenceMeanMs)),
      pairedObserved:sum(pairs.map(p=>p.stages.thresholdContribution[f].pairedObserved)),eligible:sum(pairs.map(p=>p.stages.thresholdContribution[f].eligible))}])),
    attentionWorkReductionFraction:percent(ref.attentionWorkPersonMs,b.attentionWorkPersonMs),
    resources:b.resources.map(x=>{const z=ref.resources.find(v=>v.type===x.type&&v.unit===x.unit);return {type:x.type,unit:x.unit,
      referenceDeficitUnitMs:z.deficitUnitMs,candidateDeficitUnitMs:x.deficitUnitMs,deficitReductionFraction:percent(z.deficitUnitMs,x.deficitUnitMs),
      referenceRmstMs:z.meanSufficientRmstMs,candidateRmstMs:x.meanSufficientRmstMs,timeReductionFraction:percent(z.meanSufficientRmstMs,x.meanSufficientRmstMs)};})};
});
const caseComparisons=[];
for(const p of r.comparisons){const ref=worlds.find(w=>w.arm===p.reference&&w.seed===p.seed),candidate=worlds.find(w=>w.arm==='B6'&&w.seed===p.seed);
  for(const n of candidate.physicalCases){const z=ref.physicalCases.find(v=>v.id===n.id);caseComparisons.push({reference:p.reference,seed:p.seed,id:n.id,building:n.building,type:n.type,unit:n.unit,
    candidateTimeMs:n.timeToSufficientServiceMs,referenceTimeMs:z.timeToSufficientServiceMs,candidateMinusReferenceMs:n.timeToSufficientServiceMs-z.timeToSufficientServiceMs,
    stageDeltaMs:Object.fromEntries(fields.map(f=>[f,n.thresholdContribution.known&&z.thresholdContribution.known?n.thresholdContribution[f]-z.thresholdContribution[f]:null])),
    candidateOperations:n.contributions,referenceOperations:z.contributions});}}
const out={schema:'post-outcome-native-human-primary-descriptive-integration-v1',provenance:'Prepared after sealed-reader outcomes were known; no threshold, eligibility, estimator or production metric changed.',
  generatedAt:new Date().toISOString(),reader:{file,sha256:hash(readerBytes),helperSha256:r.reader.sha256,protocol:r.protocol,summarySha256:r.summarySha256},
  rawRefs,companions:companions.map(({episode,...rest})=>rest),declared:r.declaredRuns,observed:r.observedRawRuns,valid:r.validRuns,
  errors:worlds.flatMap(w=>w.errors),invariants:worlds.flatMap(w=>w.invariants),costSummary:r.costSummary,
  runnerExit:{reported:1,scope:'harness_summary_undeclared_reference',declaredArms:arms,
    missingUnplannedReferences:r.reportedSummary.comparisons.filter(c=>c.comparable===false),
    note:'summarizeHumanCapacity emits C_decentralized missing_pair even when not declared; script sets exit1. All12 planned raw outcomes remain completed/valid, no product failure or re-run.'},
  aggregate,comparisons,worlds,caseComparisons,
  limits:['Native moderate work durations/readers/deciders/relayers are experimental assumptions, not measured human rates.',
    'All288 physical case results retained; each comparison has72 paired cases but only3 independent seeded worlds.',
    'Manual improvement may result from free parser/common queries/compiler automation; not exclusive GenAI attribution.',
    'No lives saved/Gemini/real disaster claim. Strong B5 loss and mixed B8 effects retained.',
    'K22 attention task completion is not full source version recovery. K24 offsets are not stage durations. Positive receipts are not marginal benefit.']};
const target=resolve('reports/analysis/native-human-primary-all12-20261013-diagnosis.json');
await mkdir(dirname(target),{recursive:true});await writeFile(target,JSON.stringify(out,null,2),{flag:'wx'});
console.log(JSON.stringify({file:target,declared:out.declared,observed:out.observed,valid:out.valid,aggregate:aggregate.map(a=>({arm:a.arm,rmstMin:a.meanSufficientRmstMs/60000,
  stagesMin:Object.fromEntries(fields.map(f=>[f,a.meanStages[f].meanMs/60000])),resources:a.resources,
  attentionMinutes:a.attentionWorkPersonMinutes,calls:a.providerCalls,cost:a.providerCostUsd,httpMs:a.providerWallMs,
  sourceCounts:a.sourceCounts,inquiryProvenance:a.inquiryProvenance,inquiryReused:a.inquiryReused})),comparisons:comparisons.map(c=>({reference:c.reference,
  physicalGain:c.sufficient.reductionFraction,workGain:c.attentionWorkReductionFraction,stageDeltaMin:Object.fromEntries(fields.map(f=>[f,c.stageCandidateMinusReferenceMs[f].meanMs/60000])),resources:c.resources}))}));
