/** Authorized offline all-world read only. This summarizer cannot start a
 * world, import application code or call a provider. No companion definitions
 * or sealed primary reader bytes are changed. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const sha=x=>createHash('sha256').update(x).digest('hex');
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const mean=x=>x.length&&x.every(finite)?x.reduce((a,b)=>a+b,0)/x.length:null;
const q=(x,p)=>x.length?[...x].sort((a,b)=>a-b)[Math.ceil(x.length*p)-1]:null;
const dist=x=>({samples:x.length,p50:q(x,.5),p95:q(x,.95),minimum:x.length?Math.min(...x):null,maximum:x.length?Math.max(...x):null});
const base=resolve('reports/human-capacity/native-primary-20261013');
const dir=resolve('reports/kpi-companion/native-primary-all12-20261013-closed');
const sealPath=resolve('reports/kpi-companion/definitions-v1/seal.json');
const sealBytes=await readFile(sealPath),seal=JSON.parse(sealBytes),protocolBytes=await readFile(join(base,'protocol.json'));
assert.equal(seal.helper.sha256,'5f4c5e07ce21d52b2acaca0065f252409c43db80a317cffacecb7b41e85a5e2b');
assert.equal(sha(await readFile(resolve('reports/kpi-companion/definitions-v1',seal.helper.file))),seal.helper.sha256);
const protocol=JSON.parse(protocolBytes),rows=[];
assert.equal(protocol.worlds.length,12,'Every declared raw must be represented');
for(let index=0;index<protocol.worlds.length;index++) {
  const d=protocol.worlds[index],file=join(base,`${d.condition??d.profile}-${d.seed}-${d.arm}.json`),bytes=await readFile(file),raw=JSON.parse(bytes);
  const cf=join(dir,`world-${String(index+1).padStart(2,'0')}.json`),cb=await readFile(cf),comp=JSON.parse(cb);
  assert.equal(comp.sealSha256,sha(sealBytes));assert.equal(comp.inputSha256,sha(bytes));assert.equal(comp.episodes.length,1);
  const e=comp.episodes[0];
  assert.equal(raw.arm,d.arm);assert.equal(raw.seed,d.seed);assert.equal(e.identity.arm,d.arm);assert.equal(e.identity.seed,d.seed);
  assert.equal(e.cutoff,raw.metrics.simulatedMs);
  rows.push({descriptor:d,input:{file,sha256:sha(bytes)},companion:{file:cf,sha256:sha(cb)},episode:e,
    rawEvidence:{status:raw.status,errors:raw.errors??null,invariants:raw.invariants??null,services:raw.metrics.services,
      traffic:raw.manifest?.config?.backgroundTraffic??null,utilization:raw.metrics.utilization??null},
    eligibility:e.identity.sourceUnchanged&&raw.status==='completed'&&Array.isArray(raw.invariants)&&raw.invariants.length===0,
    sufficientRmstMs:raw.timeToSufficientService?.restrictedMeanMs??null,firstUsefulRmstMs:raw.timeToFirstUsefulService?.restrictedMeanMs??null});
}
const arms=protocol.arms,aggregate=Object.fromEntries(arms.map(arm=>{
  const own=rows.filter(r=>r.descriptor.arm===arm),es=own.map(r=>r.episode);
  const stage=Object.fromEntries(['read','decide','relay'].map(s=>[s,{
    completedTotal:es.reduce((n,e)=>n+(e.K22.stages[s]?.completed??0),0),
    terminalFailedTotal:es.reduce((n,e)=>n+(e.K22.stages[s]?.failed??0)+(e.K22.stages[s]?.inconclusive??0),0),
    pendingCensoredTotal:es.reduce((n,e)=>n+(e.K22.stages[s]?.pendingCensored??0),0),
    meanStartedQueueP95Ms:mean(es.map(e=>e.K22.stages[s]?.startedQueueMs?.p95)),
    meanCompletedTurnaroundP95Ms:mean(es.map(e=>e.K22.stages[s]?.completedTurnaroundMs?.p95)),
    meanElapsedQueueTaskMinutes:mean(es.map(e=>e.K22.stages[s]?.elapsedQueuePersonMs/60000)),
    meanActualAttentionWorkMinutes:mean(es.map(e=>e.K22.stages[s]?.elapsedWorkPersonMs/60000)),
  }]));
  const names=Object.keys(es[0].K24.stageDifferences),stages=Object.fromEntries(names.map(name=>[name,dist(es.flatMap(e=>e.K24.rows.map(o=>o.deltas[name]).filter(finite)))]));
  return [arm,{worlds:own.length,eligible:own.filter(r=>r.eligibility).length,
    K20:{meanAttentionWorkMinutes:mean(es.map(e=>e.K20.elapsedAttentionWorkPersonMinutes)),
      meanAttentionMinutesPerPhysicallySufficientCase:mean(es.map(e=>e.K20.attentionMinutesPerPhysicallySufficientCohortCase)),
      sufficientCases:es.reduce((n,e)=>n+e.K20.sufficientPositiveCohortCases,0),positiveCases:es.reduce((n,e)=>n+e.K20.positiveCohortCases,0),
      allWorkRecomputedMatches:es.every(e=>e.K20.workReconciliationMatches===true),independentSemanticCorrectnessUnknown:true},
    K22:{byStage:stage,meanHistoricalIndividualOrgPeakBacklog:mean(es.map(e=>e.K22.maximumBacklog)),
      observedMaximumIndividualOrgPeakBacklog:Math.max(...es.map(e=>e.K22.maximumBacklog)),
      meanTaskQueueWaitingMinutes:mean(es.map(e=>Object.values(e.K22.stages).reduce((n,s)=>n+s.elapsedQueuePersonMs,0)/60000)),
      pendingCensoredTotal:es.reduce((n,e)=>n+Object.values(e.K22.stages).reduce((m,s)=>m+s.pendingCensored,0),0),
      cutoffMs:10800000,nativeUniversalDecisionDeadline:null},
    K24:{operationStageDifferences:stages,meanOperationScopedElapsedSumMs:mean(es.map(e=>e.K24.scopedOperationElapsedSumMs)),
      meanOperationScopeUnionMs:mean(es.map(e=>e.K24.operationScopeUnionMs)),issues:es.flatMap(e=>e.K24.issues)},
    K09:{meanAllVehicleDistanceKm:mean(es.map(e=>e.K09.allVehicles.distanceM/1000)),meanAllVehicleFuelL:mean(es.map(e=>e.K09.allVehicles.fuelMl/1000)),
      allDeclaredBackgroundTrafficZero:own.every(r=>r.rawEvidence.traffic===0),ownedSplitUnknown:es.every(e=>e.K09.ownedVehicles===null),
      meanVehicleCommittedHours:mean(es.map(e=>e.K09.utilization.vehicleCommittedHours)),
      meanStaffCommittedPersonHours:mean(es.map(e=>e.K09.utilization.staffCommittedPersonHours)),
      meanStaffFieldWorkPersonHours:mean(es.map(e=>e.K09.utilization.staffFieldWorkPersonHours)),
      services:own.map(r=>({seed:r.descriptor.seed,native:r.rawEvidence.services}))}}];
}));
const candidate=aggregate.B6,comparisons=['C_manual','B5','B8'].map(reference=>{
  const a=aggregate[reference],b=candidate,paired=protocol.worlds.filter(w=>w.arm==='B6').map(w=>{
    const x=rows.find(r=>r.descriptor.arm===reference&&r.descriptor.seed===w.seed),y=rows.find(r=>r.descriptor.arm==='B6'&&r.descriptor.seed===w.seed);
    const okay=x?.eligibility&&y?.eligibility;
    return {seed:w.seed,eligible:!!okay,attentionWorkReductionFraction:okay&&x.episode.K20.elapsedAttentionWorkPersonMs>0?
      1-y.episode.K20.elapsedAttentionWorkPersonMs/x.episode.K20.elapsedAttentionWorkPersonMs:null};
  });
  return {reference,candidate:'B6',allThreePairsEligible:paired.length===3&&paired.every(p=>p.eligible),paired,
    ratioOfMeanAttentionWorkReductionFraction:1-b.K20.meanAttentionWorkMinutes/a.K20.meanAttentionWorkMinutes,
    ratioOfMeanAllVehicleDistanceReductionFraction:1-b.K09.meanAllVehicleDistanceKm/a.K09.meanAllVehicleDistanceKm,
    ratioOfMeanAllVehicleFuelReductionFraction:1-b.K09.meanAllVehicleFuelL/a.K09.meanAllVehicleFuelL,
    note:'Descriptive declared-profile workload/transport contrast, not empirical human rates, semantic correctness or proof of incremental LLM benefit.'};
});
const result={schema:'native-human-kpi-companion-all12-descriptive-summary-v1',authorization:'ROOT_GO_READ_KPI_COMPANION',
  companionHelperSha256:seal.helper.sha256,companionSealSha256:sha(sealBytes),protocol:{file:join(base,'protocol.json'),sha256:sha(protocolBytes)},
  provenance:seal.provenance,all12RawInputsVerified:true,all12CompanionInputShaVerified:true,worlds:rows,
  aggregate,comparisons,note:'Every raw/companion identity and hash retained. Quantiles pooled over operations are descriptive and are not independent world replicates; world-average p95s are explicitly labeled. Queued-task wait is never added to attention work. Native positive sufficiency is not independent semantic correctness. K09 scopes overlap and are not summed into productivity.'};
const out=resolve(`reports/kpi-companion/native-primary-all12-summary-${Date.now()}`);await mkdir(out);
await writeFile(join(out,'summary.json'),JSON.stringify(result,null,2),{flag:'wx'});
await writeFile(join(out,'summarizer.mjs'),await readFile(fileURLToPath(import.meta.url)),{flag:'wx'});
console.log(JSON.stringify({folder:out,worlds:rows.length,allEligible:rows.every(r=>r.eligibility),aggregate:Object.fromEntries(Object.entries(aggregate).map(([arm,r])=>[arm,
  {workMinutes:r.K20.meanAttentionWorkMinutes,workPerSufficientCaseMinutes:r.K20.meanAttentionMinutesPerPhysicallySufficientCase,
    queueTaskWaitMinutes:r.K22.meanTaskQueueWaitingMinutes,pending:r.K22.pendingCensoredTotal,maxOrgBacklog:r.K22.observedMaximumIndividualOrgPeakBacklog,
    readWaitP95AverageMinutes:r.K22.byStage.read.meanStartedQueueP95Ms===null?null:r.K22.byStage.read.meanStartedQueueP95Ms/60000,
    decideWaitP95AverageMinutes:r.K22.byStage.decide.meanStartedQueueP95Ms===null?null:r.K22.byStage.decide.meanStartedQueueP95Ms/60000,
    relayWaitP95AverageMinutes:r.K22.byStage.relay.meanStartedQueueP95Ms===null?null:r.K22.byStage.relay.meanStartedQueueP95Ms/60000,
    distanceKm:r.K09.meanAllVehicleDistanceKm,fuelL:r.K09.meanAllVehicleFuelL,vehicleHours:r.K09.meanVehicleCommittedHours,
    staffHours:r.K09.meanStaffCommittedPersonHours,fieldHours:r.K09.meanStaffFieldWorkPersonHours,
    physicalPreparedArrivalP50Ms:r.K24.operationStageDifferences.preparedToDestinationArrival.p50,
    physicalArrivalReceiptP50Ms:r.K24.operationStageDifferences.destinationArrivalToPhysicalReceipt.p50,
    physicalStageIssues:r.K24.issues.length}])),comparisons},null,2));
