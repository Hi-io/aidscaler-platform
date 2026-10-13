import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEpisode, operationDurations, intervalUnionMs, latestTasks, PROVENANCE } from './human-kpi-companion.mjs';

const task=(id,stage,createdAt,startedAt,readyAt,completedAt,state='completed',org='org0')=>
  ({id,org,stage,createdAt,startedAt,readyAt,completedAt,state,version:1});
function fixture() {
  return {arm:'fixture_only',status:'completed',candidateChanged:false,evaluatorChanged:false,simulatorChanged:false,
    metrics:{simulatedMs:1000,operatorReviewMs:100,
      humanCapacity:{stages:{read:{elapsedWorkPersonMs:300},decide:{elapsedWorkPersonMs:100},relay:{elapsedWorkPersonMs:50}},
        maximumBacklog:3,perOrg:{org0:{maximumBacklog:3}}},
      physical:{distanceM:10000,fuelMl:1800}},
    outcomes:[{quantity:10,served:10,completedAt:600},{quantity:20,served:5,completedAt:null},{quantity:0,served:0,completedAt:0}],
    observerOnly:{humanWork:[
      task('r1','read',0,100,300,300),task('r2','read',800,900,1200,null,'working'),
      task('owner-review','decide',200,300,400,400),
      task('rel','relay',100,200,250,700),
      task('pending','decide',500,null,null,null,'queued'),
    ],operations:[]}};
}
test('K20 counts actual work once, includes partial work, and never adds review/waiting',()=>{
  const r=summarizeEpisode(fixture());
  assert.equal(r.K20.elapsedAttentionWorkPersonMs,450);
  assert.equal(r.K20.independentlyRecomputedWorkPersonMs,450);
  assert.equal(r.K20.workReconciliationMatches,true);
  assert.equal(r.K20.operatorReviewMsExcludedFromAdditionalSum,true);
  assert.equal(r.K20.sufficientPositiveCohortCases,1);
  assert.equal(r.K20.positiveCohortCases,2);
  assert.equal(r.K20.attentionMinutesPerPhysicallySufficientCohortCase,450/60000);
  assert.equal(r.K20.minutesPerIndependentlyCorrectResolution,null);
  assert.equal(r.K22.stages.decide.elapsedQueuePersonMs,600);
  assert.equal(r.K22.stages.relay.elapsedWorkPersonMs,50,'network delivery wait is not labor');
});
test('K22 reports completed and terminal failures separately, pending cutoff and no invented deadline',()=>{
  const f=fixture();f.observerOnly.humanWork.push(task('failed','read',0,50,100,100,'failed'));
  const r=summarizeEpisode(f),s=r.K22.stages.read;
  assert.equal(s.completed,1);assert.equal(s.finishedTerminal,2);assert.equal(s.failed,1);
  assert.equal(s.completedTurnaroundMs.p95,300);assert.equal(s.finishedTerminalTurnaroundMs.samples,2);
  assert.equal(s.pendingCensored,1);assert.equal(s.pendingCensoredAt,1000);assert.equal(s.pendingAgeMs.maximum,200);
  assert.equal(s.deadlineOverdue,null);assert.equal(r.K22.sourceRecovery,null);
  assert.equal(r.K22.maximumBacklog,3);assert.match(r.K22.maximumBacklogScope,/not simultaneous/);
  assert.equal(r.K22.perOrg.org0.stages.decide.pendingCensored,1);
});
test('source task histories are deduplicated by owner/id and material version',()=>{
  const f=fixture(),prior={...f.observerOnly.humanWork[0],version:0,state:'queued',startedAt:null};
  f.observerOnly.humanWork.push(prior);
  const r=summarizeEpisode(f);assert.equal(r.K22.stages.read.received,2);
  const conflicting={...f.observerOnly.humanWork[0],completedAt:400};
  assert.deepEqual(latestTasks([f.observerOnly.humanWork[0],conflicting]).issues,['conflicting_equal_task_version']);
  assert.equal(latestTasks([{...prior,org:'org1'},prior]).rows.length,2);
});
test('future completion is censored at observed source time and missing raw clocks stay unknown',()=>{
  const f=fixture();f.observerOnly.humanWork=[task('future','read',0,900,1200,1200)];
  delete f.metrics.humanCapacity;
  const r=summarizeEpisode(f);assert.equal(r.K22.stages.read.completed,0);assert.equal(r.K22.stages.read.pendingCensored,1);
  assert.equal(r.K20.elapsedAttentionWorkPersonMs,100);
  f.observerOnly.humanWork[0].readyAt=null;
  assert.equal(summarizeEpisode(f).K20.elapsedAttentionWorkPersonMs,null);
  assert.throws(()=>summarizeEpisode({metrics:{}}),/MISSING_NATIVE_OBSERVATION_CUTOFF/);
});
test('K24 subtracts actual matching timestamps and separates overlapping scoped sum from elapsed union',()=>{
  const operations=[
    {id:'a',owner:'org0',type:'delivery',createdAt:100,times:{authorized:100,reserved:100,pickupArrived:200,prepared:250,arrived:450,received:500,service:500}},
    {id:'b',owner:'org1',type:'delivery',createdAt:300,times:{authorized:300,prepared:350,arrived:500,received:600,service:700}},
    {id:'pending',createdAt:800,times:{authorized:800}},
  ];
  const s=operationDurations(operations,1000);
  assert.equal(s.stageDifferences.preparedToDestinationArrival.p50,150);
  assert.equal(s.stageDifferences.destinationArrivalToPhysicalReceipt.p95,100);
  assert.equal(s.rows[0].deltas.pickupArrivalToPrepared,50);
  assert.equal(s.rows[1].deltas.reservationToPickupArrival,null);
  assert.equal(s.rows[2].rightCensored,true);
  assert.equal(s.scopedOperationElapsedSumMs,1000);assert.equal(s.operationScopeUnionMs,800);
  assert.equal(intervalUnionMs([[0,20],[10,30],[30,40],[50,60]]),50);
  assert.deepEqual(s.issues,[]);
});
test('negative timestamp order is a reported invalid difference, not clamped into success',()=>{
  const s=operationDurations([{id:'bad',createdAt:10,times:{prepared:30,arrived:20}}],100);
  assert.equal(s.rows[0].deltas.preparedToDestinationArrival,null);
  assert.ok(s.issues.includes('operation_timestamp_regression:preparedToDestinationArrival'));
});
test('K09 keeps all-vehicle/BG scope and does not derive owner cost without complete ledger',()=>{
  const f=fixture(),r=summarizeEpisode(f);
  assert.equal(r.K09.allVehicles.distanceM,10000);assert.equal(r.K09.ownedVehicles,null);
  const v=[{id:'own',owner:'org0',background:false,distanceM:7000,fuelUsed:1200},
    {id:'bg',owner:'org0',background:true,distanceM:3000,fuelUsed:600}];
  assert.equal(summarizeEpisode(f,{vehicleLedger:v}).K09.ownedVehicles.distanceM,7000);
  assert.equal(summarizeEpisode(f,{vehicleLedger:v.map(({background,...rest})=>rest)}).K09.ownedVehicles,null);
  assert.equal(r.K09.costPerUsefulUnit,null);
});
test('companion preserves failure identities, absent quality and explicit post-baseline provenance',()=>{
  const f=fixture();f.status='wall_limit';f.candidateChanged=true;
  const r=summarizeEpisode(f);assert.equal(r.identity.status,'wall_limit');assert.equal(r.identity.sourceUnchanged,false);
  assert.match(PROVENANCE.blindness,/Post-baseline/);assert.match(PROVENANCE.blindness,/no B6/);
  assert.equal(r.K20.minutesPerIndependentlyCorrectResolution,null);
});
