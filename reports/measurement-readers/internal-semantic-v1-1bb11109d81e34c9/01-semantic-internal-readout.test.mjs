import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAN,presentInternalSemantic,markdown} from './semantic-internal-readout.mjs';
function fixture(){const observations=Array.from({length:8},(_,i)=>({kind:'need',sourceIds:['public-'+i],location:'b'+i,resourceType:PLAN.types[i%5],quantity:80+i,unit:PLAN.unitCycle[i%5],timeStatus:'current'}));
  const raw={status:'completed',protocol:{seed:PLAN.seed,count:8,organizations:1,copies:2,budgetUsd:.12},candidateFingerprint:PLAN.source.candidate,evaluatorFingerprint:PLAN.source.evaluator,candidateChanged:false,
    invariants:[],error:null,costUsd:0,chargedBudgetUsd:0,usage:[{state:'completed',model:'recorded',cost_usd:.001,reserved_usd:.02,wall_ms:25}],
    measurements:[{org:'org0',nativeNeeds:8,sourceRecordsReceived:40,evaluatedSources:24,detected:8,recall:1,preciseNeedObservations:8,currentNeedObservations:8,precision:1,conservativeReturnedNeedPrecision:1,
      rejectedNeedObservations:0,rejectedObservations:[],failedBatches:[],omissions:[],falseMergeCandidates:0,inferenceWritesAuthoritativeNeed:false}],
    findings:[{org:'org0',observations,rejected:[],failedBatches:[]}]};
  const wrapper={eligibleForInternalScoring:true,reasons:[],initial:PLAN.source,child:{sha256:'rawsha'},final:{
    finalCandidateFingerprint:PLAN.source.candidate,finalEvaluatorFingerprint:PLAN.source.evaluator,finalEngineBuild:PLAN.source.simulator,
    candidateChanged:false,evaluatorChanged:false,simulatorChanged:false}};
  return {raw,wrapper};}
test('all24 originals/eight authored requests are fixed, outputs remain unverified and no new scorer is used',()=>{
  const {raw,wrapper}=fixture(),r=presentInternalSemantic(raw,wrapper,{rawSha256:'rawsha'});
  assert.equal(r.eligibleForReportingExistingInternalScore,true);assert.equal(r.organizations[0].childReported.recall,1);
  assert.equal(r.newScorerUsed,false);assert.equal(r.sourceTruthPrecision,null);assert.equal(r.confidenceCalibration,null);
  assert.equal(r.provenanceAudit.completeOriginalRoster,false);assert.equal(r.provenanceAudit.exactVersions,null);
  assert.ok(r.organizations[0].observations.every(o=>o.confidence===null&&o.sourceConfirmedTruth===null&&o.sourceVersions===null));
  assert.equal(r.costs.totalProviderCostUsd,.001);assert.equal(r.costs.chargedBudgetUsd,.001);
  assert.match(markdown(r),/does not create a new scorer/);
});
test('omissions, rejection and unknown time remain visible rather than favorable filtering or declared falsehood',()=>{
  const {raw,wrapper}=fixture(),m=raw.measurements[0];raw.findings[0].observations.pop();raw.findings[0].observations[0].timeStatus='unknown';
  raw.findings[0].rejected=[{kind:'need',code:'EXTRACTION_REFERENCE',sourceIds:[],unknownReferenceCount:1}];
  Object.assign(m,{detected:6,recall:.75,preciseNeedObservations:6,currentNeedObservations:7,precision:6/7,rejectedNeedObservations:1,conservativeReturnedNeedPrecision:.75,omissions:[{source:'a'},{source:'b'}]});
  const r=presentInternalSemantic(raw,wrapper);assert.equal(r.eligibleForReportingExistingInternalScore,true);
  assert.equal(r.organizations[0].needTimeKinds.unknown,1);assert.equal(r.organizations[0].omissions.length,2);
  assert.equal(r.organizations[0].rejectedObservations[0].code,'EXTRACTION_REFERENCE');assert.equal(r.sourceTruthPrecision,null);
});
test('failed batches and invariant failure remain reportable raw failures, not perfect or dropped trials',()=>{
  const {raw,wrapper}=fixture();raw.status='failed';raw.error={code:'EXTRACTION_AUTHORITY'};raw.findings[0].failedBatches=[{offset:0,sourceCount:24,code:'EXTRACTION_AUTHORITY'}];
  raw.invariants=[{code:'SOURCE_INVARIANT'}];wrapper.eligibleForInternalScoring=false;wrapper.reasons=['child_failed_or_wall_limit'];
  const r=presentInternalSemantic(raw,wrapper);assert.equal(r.eligibleForReportingExistingInternalScore,false);
  assert.equal(r.allFailedBatches.length,1);assert.equal(r.childError.code,'EXTRACTION_AUTHORITY');assert.equal(r.organizations.length,1);
});
test('recovered schema attempt stays in exact reported score and every usage/error attempt',()=>{
  const {raw,wrapper}=fixture();raw.usage.unshift({state:'failed',model:'recorded',cost_usd:.0005,reserved_usd:.02,wall_ms:20,error:'EXTRACTION_SCHEMA'});
  const r=presentInternalSemantic(raw,wrapper);assert.equal(r.eligibleForReportingExistingInternalScore,true);
  assert.equal(r.costs.failedCalls,1);assert.equal(r.costs.providerCalls,2);assert.equal(r.costs.totalProviderCostUsd,.0015);
  assert.equal(r.costs.attempts[0].error,'EXTRACTION_SCHEMA');
});
test('missing and unknown charges preserve full exposure despite legacy zero accounting',()=>{
  const {raw,wrapper}=fixture();raw.usage[0].cost_usd=null;raw.usage[0].reserved_usd=null;
  let r=presentInternalSemantic(raw,wrapper);assert.equal(r.costs.totalProviderCostUsd,null);assert.equal(r.costs.chargedBudgetUsd,.12);assert.equal(r.legacyCostUsd,0);
  r=presentInternalSemantic(null,null);assert.equal(r.costs.totalProviderCostUsd,null);assert.equal(r.costs.chargedBudgetUsd,.12);assert.equal(r.eligibleForReportingExistingInternalScore,false);
});
test('subset24, altered seed, mismatched raw bytes and changed simulator cannot be promoted to valid scoring',()=>{
  for(const defect of ['subset','seed','bytes','simulator','extraorg','count']){
    const {raw,wrapper}=fixture();if(defect==='subset')raw.measurements[0].evaluatedSources=20;
    if(defect==='seed')raw.protocol.seed='different';if(defect==='bytes')wrapper.child.sha256='different';
    if(defect==='simulator')wrapper.final.finalEngineBuild='f'.repeat(64);
    if(defect==='extraorg')raw.measurements.push({...raw.measurements[0],org:'extra'});
    if(defect==='count')raw.measurements[0].precision=.9;
    assert.equal(presentInternalSemantic(raw,wrapper,{rawSha256:'rawsha'}).eligibleForReportingExistingInternalScore,false,defect);
  }
});
