import test from 'node:test';
import assert from 'node:assert/strict';
import { PINNED, PLANS, NEW_LOCK, validateCurrent, admittedCap, feeEvidence, failedWorld, projectWorld, studySummary, isolatedRecoveryCall, runStudy } from './current-service-recovery.mjs';
const end={candidateChanged:false,evaluatorChanged:false,simulatorChanged:false,finalCandidateFingerprint:PINNED.candidateFingerprint,
  finalEvaluatorFingerprint:PINNED.evaluatorFingerprint,finalEngineBuild:PINNED.simulatorBuild};
function freeze(){const tests={tests:1,pass:1,fail:0,cancelled:0};return {...PINNED,verification:{...PINNED,passed:true,...end,
  candidateFinalFingerprint:PINNED.candidateFingerprint,evaluatorFinalFingerprint:PINNED.evaluatorFingerprint,simulatorFinalFingerprint:PINNED.simulatorBuild,
  cases:[{name:'platform-tests',exitCode:0,tests},{name:'simulator-tests',exitCode:0,tests}]},ui:{...PINNED,passed:true,unchanged:true,cases:[{exitCode:0}],finalFingerprints:{...PINNED}}};}
function raw(world){return {...world,...PINNED,...end,status:'completed',manifest:{engineBuild:PINNED.simulatorBuild,config:{compositionVariant:world.variant,durationMs:14400000}},
  initialMapHash:'same',planningRounds:12,policyIntervalMs:300000,responseOrder:'deadline_then_priority',episodeBudgetUsd:.15,modelConfig:{modelId:'same',totalEpisodeCalls:96},
  errors:[],invariants:[],usage:[{cost_usd:.01,reserved_usd:.02,wall_ms:20,state:'completed'}],metrics:{services:{water:{unit:'L',uncoveredUnitMs:100},shelter:{unit:'place',uncoveredUnitMs:200}},
  collective:{shelterPlaceHours:0,operatingHours:1}}};}

test('preparation imports no runtime and cannot launch either named study without GO',async()=>{
  assert.equal((await runStudy({study:'S19'})).providerCalls,0);assert.equal((await runStudy({study:'K22',run:'wrong'})).state,'prepared_not_launched');
  assert.equal(PLANS.S19.worlds.length,6);assert.deepEqual(PLANS.K22.worlds.map(w=>w.mode),['parser','real','parser','real']);
  assert.ok(!NEW_LOCK.includes('.candidate-development'));assert.match(NEW_LOCK,/\.human-capacity-development.*PAID_RESEARCH_STUDY/);
});
test('both current source and full/UI triple proof must match, not a copied old gate',()=>{
  assert.equal(validateCurrent(freeze(),PINNED),true);assert.throws(()=>validateCurrent(freeze(),{...PINNED,simulatorBuild:'f'.repeat(64)}),/source mismatch/);
  const f=freeze();delete f.ui.unchanged;assert.throws(()=>validateCurrent(f,PINNED),/UI seal/);
});
test('full fixed caps cannot shrink and missing/unknown bills are exposure rather than zero',()=>{
  assert.equal(admittedCap(.1,.2,.45),.30000000000000004);assert.throws(()=>admittedCap(.3,.2,.45),/cap unavailable/);
  const r={status:'completed',usage:[{cost_usd:null,reserved_usd:.07}],paidCostUsd:0};
  assert.equal(feeEvidence(r,.15).totalProviderCostUsd,null);assert.equal(feeEvidence(r,.15).chargedBudgetUsd,.07);
  r.usage[0].reserved_usd=null;assert.equal(feeEvidence(r,.15).chargedBudgetUsd,.15);
  assert.equal(failedWorld(PLANS.S19.worlds[0],.15,{code:'DB_FULL'}).physical,null);
  assert.equal(failedWorld(PLANS.S19.worlds[0],.15,{code:'DB_FULL'}).fee.totalProviderCostUsd,null);
});
test('zero occupancy and recovered errors remain in S19 comparison, opening alone is not physical benefit',()=>{
  const rows=PLANS.S19.worlds.map(world=>({world,raw:raw(world)}));rows.find(r=>r.world.arm==='B6').raw.errors=[{code:'EXTRACTION_SCHEMA'}];
  const s=studySummary('S19',PLANS.S19,rows);assert.equal(s.observedRuns,6);assert.equal(s.pairs.length,4);assert.ok(s.pairs.every(p=>p.comparable));
  assert.equal(s.worlds[1].physical.collective.shelterPlaceHours,0);assert.equal(s.worlds[1].physical.collective.operatingHours,1);
  assert.equal(s.worlds[1].errors.length,1);assert.equal(s.pairs[0].native.find(x=>x.type==='shelter').deficitReductionFraction,0);
});
test('partial/failure/missing worlds and profile changes prevent a favorable pair without erasing observations',()=>{
  const rows=PLANS.S19.worlds.map(world=>({world,raw:raw(world)}));rows[1].raw.status='failed';rows[1].raw.metrics.collective.shelterPlaceHours=.5;
  rows.pop();const s=studySummary('S19',PLANS.S19,rows);assert.equal(s.missing.length,1);assert.equal(s.worlds[1].physical.collective.shelterPlaceHours,.5);
  assert.equal(s.pairs[0].comparable,false);assert.equal(s.pairs[0].native[0].deficitReductionFraction,null);
  rows[1].raw.status='completed';rows[1].raw.manifest.config.durationMs=1;assert.equal(studySummary('S19',PLANS.S19,rows).pairs[0].comparable,false);
});
test('K22 source dispositions, physical sufficiency and operational waiting_context retain separate closure/censor',()=>{
  const w=PLANS.K22.worlds[1],r={status:'incomplete_horizon',protocol:{fingerprints:{candidate:PINNED.candidateFingerprint,evaluator:PINNED.evaluatorFingerprint,simulator:PINNED.simulatorBuild},sourceCutoffMs:w.sourceCutoffMs},
    finalBuilds:end,errors:[],invariants:[],usage:[],results:{eligible:120,closed:120,retainedAttention:0,physicalEligible:24,physicalSufficient:24},
    recoveryCensored:true,recoveredAt:null,recoveryDurationMs:10500000,cohortHash:'fixed',localState:{unresolvedDiscoveries:[{state:'waiting_context'}]},
    maxPendingSourceReviews:4,timeline:[{pendingSourceReviews:4}],outcomes:[]};
  const p=projectWorld('K22',w,r);assert.equal(p.eligible,false);assert.equal(p.sourceRecovery.closed,120);assert.equal(p.sourceRecovery.recoveryCensored,true);
  assert.equal(p.physical.counts.sufficient,24);assert.equal(p.sourceRecovery.localState.unresolvedDiscoveries[0].state,'waiting_context');
});
test('parser substitution is explicitly no-paid and cannot be described as real-model semantic accuracy',()=>{
  const p=feeEvidence({usage:[{model:'parser',cost_usd:0,wall_ms:5}]},.15,{parser:true});assert.equal(p.providerCalls,0);assert.equal(p.modeledUsageRecords,1);
  assert.match(PLANS.K22.scope,/not precision\/recall/);assert.equal(PLANS.K22.config.maxSourceAttempts,2);
});
test('parser HTTP interception is restored even if the inner harness cleanup throws',async()=>{
  const previous=globalThis.fetch,replacement=()=>{throw Error('recorded');};
  await assert.rejects(isolatedRecoveryCall(async()=>{globalThis.fetch=replacement;throw Error('cleanup failed');}),/cleanup failed/);
  assert.equal(globalThis.fetch,previous);
});
