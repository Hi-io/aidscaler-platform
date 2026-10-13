import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIES, SHARED_LOCK, admitStudy, reserveEpisode, conservativeExposure, missingOutcome, k15Readout, semanticPilotReadout, runPrepared } from './minimal-semantic-studies.mjs';
import { validateProbeGate } from './evidence-probe-guards.mjs';
const source={candidate:'a'.repeat(64),evaluator:'b'.repeat(64),simulator:'c'.repeat(64)};
const current={candidateFingerprint:source.candidate,evaluatorFingerprint:source.evaluator,simulatorBuild:source.simulator};
const final={candidateChanged:false,evaluatorChanged:false,simulatorChanged:false};
const world=(arm='B6',time=400)=>({arm,seed:STUDIES.K15.seed,status:'completed',...current,evaluatorFingerprint:source.evaluator,
  finalCandidateFingerprint:source.candidate,finalEvaluatorFingerprint:source.evaluator,finalEngineBuild:source.simulator,
  candidateChanged:false,evaluatorChanged:false,simulatorChanged:false,manifest:{engineBuild:source.simulator,config:{humanCapacity:{profile:'legacy'}}},
  protocol:{...STUDIES.K15.config},corpus:{config:{...STUDIES.K15.config},manifest:{seed:STUDIES.K15.seed}},errors:[],invariants:[],
  outcomes:Array.from({length:24},(_,i)=>({id:'need'+i,quantity:100,served:100,censored:false,firstUsefulCensored:false})),
  timeToSufficientService:{restrictedMeanMs:time,completed:24,eligible:24,rightCensored:0},timeToFirstUsefulService:{restrictedMeanMs:time,reached:24,eligible:24,rightCensored:0},
  usage:[{state:'completed',model:'recorded-same-model',cost_usd:.01,reserved_usd:.02,wall_ms:25}],chargedBudgetUsd:.01});
function freeze(){const tests={tests:2,pass:2,fail:0,cancelled:0};return {...current,verification:{...current,passed:true,...final,
  candidateFinalFingerprint:source.candidate,evaluatorFinalFingerprint:source.evaluator,simulatorFinalFingerprint:source.simulator,
  cases:[{name:'platform-tests',exitCode:0,tests},{name:'simulator-tests',exitCode:0,tests}]},ui:{...current,passed:true,unchanged:true,cases:[{exitCode:0}],finalFingerprints:{...current}}};}

test('prepare without named GO imports no runtime, creates no world and invokes no provider',async()=>{
  assert.equal((await runPrepared({kind:'K15'})).providerCalls,0);
  assert.equal((await runPrepared({kind:'K11_K13',run:'not-authorized'})).state,'prepared_not_launched');
  assert.throws(()=>admitStudy('K15','ROOT_GO_SEMANTIC_PILOT'),/Named ROOT_GO/);assert.throws(()=>admitStudy('other','ROOT_GO_K15_CURRENT'));
});
test('primary semantic references keep exact same family, fixed caps and the shared native-human lock',()=>{
  assert.deepEqual(STUDIES.K15.worlds,['B6','B9']);assert.equal(STUDIES.K15.config.count,24);assert.equal(STUDIES.K15.config.noise,192);
  assert.equal(STUDIES.K15.maxModelCalls,32);assert.equal(STUDIES.K15.episodeBudgetUsd,.15);assert.equal(STUDIES.K15.totalBudgetUsd,.4);
  assert.match(SHARED_LOCK,/\.candidate-development.*PAID_RESEARCH_STUDY\.lock/);
  assert.match(STUDIES.K15.scope,/Not a reuse of human-capacity/);
});
test('fixed admission reserves full cap; unknown fees and missing records cannot be zero',()=>{
  assert.equal(reserveEpisode(.15,.15,.4),.3);assert.throws(()=>reserveEpisode(.26,.15,.4),/cannot be admitted/);
  const r=world();r.usage=[{cost_usd:null,reserved_usd:.05}];assert.equal(conservativeExposure(r,.15),.05);
  r.usage[0].reserved_usd=null;r.chargedBudgetUsd=0;assert.equal(conservativeExposure(r,.15),.15);
  r.usage=null;assert.equal(conservativeExposure(r,.15),.15);
  r.usage=[];r.modelCalls=1;assert.equal(conservativeExposure(r,.15),.15);
});
test('fresh full/UI proof requires all three source hashes and cannot accept an old simulator',()=>{
  assert.equal(validateProbeGate(freeze(),current),true);const f=freeze();f.ui.finalFingerprints.simulatorBuild='d'.repeat(64);
  assert.throws(()=>validateProbeGate(f,current),/another build/);const g=freeze();delete g.verification.simulatorChanged;
  assert.throws(()=>validateProbeGate(g,current),/unchanged full verification/);
});
test('completed recovered extraction failures are eligible and their failed attempt cost is retained',()=>{
  const b6=world('B6',400),b9=world('B9',500);b6.errors=[{code:'EXTRACTION_SCHEMA'}];b6.usage.unshift({state:'failed',model:'recorded-same-model',cost_usd:.02,reserved_usd:.03,wall_ms:10,error:'schema'});
  const r=k15Readout([b6,b9],source);assert.equal(r.comparable,true);assert.equal(r.sufficient.reductionFraction,.2);
  assert.equal(r.worlds[0].errors.length,1);assert.equal(r.worlds[0].cost.totalProviderCostUsd,.03);assert.equal(r.worlds[0].cost.failedCalls,1);
  assert.equal(r.modelEvidence.sameActuallyObserved,true);
});
test('model differences, physical inputs, native review profiles and final build changes invalidate K15 pairing',()=>{
  for(const mutate of [r=>r.usage[0].model='different-model',r=>r.manifest.config.humanCapacity.profile='moderate',
    r=>r.corpus.config.noise=768,r=>r.protocol.maxModelCalls=64,r=>r.finalEngineBuild='d'.repeat(64)]){
    const a=world('B9'),b=world('B6');mutate(b);const r=k15Readout([b,a],source);assert.equal(r.comparable,false);assert.equal(r.sufficient.reductionFraction,null);
  }
});
test('zero model activity is labelled as no observed same-model proof, not magically GenAI contribution',()=>{
  const a=world('B9'),b=world('B6');b.usage=[];const r=k15Readout([b,a],source);assert.equal(r.comparable,true);assert.equal(r.modelEvidence.sameActuallyObserved,false);
});
test('missing/failed worlds preserve unknown service, cost exposure and no paired gain',()=>{
  const missing=missingOutcome('B9',STUDIES.K15.seed,.15,Object.assign(Error('private message omitted'),{code:'DB_LOST'}));
  assert.equal(missing.cost.totalProviderCostUsd,null);assert.equal(missing.physicalService,null);assert.equal(missing.chargedBudgetUsd,.15);
  assert.equal(missing.errors[0].code,'DB_LOST');assert.ok(!JSON.stringify(missing).includes('private message'));
  const r=k15Readout([world(),missing],source);assert.equal(r.comparable,false);assert.equal(r.firstUseful.reductionFraction,null);assert.equal(r.worlds.length,2);
});
test('compact semantic pilot languages, tuples, public entity scope and source loop are declared before outcomes',()=>{
  const p=STUDIES.K11_K13;assert.deepEqual(p.languages,['en','es','fr','ja']);assert.equal(p.needs,8);assert.equal(p.organizations,1);assert.equal(p.copies,2);
  assert.equal(p.needs*3<=30,true);assert.equal(p.maximumProviderAttemptsByCurrentLoop,2);assert.match(p.entities,/ordinary scoped query/);
  assert.match(p.scope,/K12 independent attribution/);assert.equal(p.episodeBudgetUsd,.12);
});
test('legacy semantic cost null-to-zero is not used and rejected/omitted/failed batches remain visible',()=>{
  const raw={...current,status:'failed',candidateChanged:false,invariants:[],costUsd:0,measurements:[{recall:.5,omissions:[{source:'source2'}],failedBatches:[{code:'HTTP_DOWN'}],rejectedObservations:[{reason:'UNKNOWN_REF'}]}],
    findings:[{observations:[]}],error:{code:'HTTP_DOWN'},usage:[{cost_usd:null,reserved_usd:.03,wall_ms:45,state:'failed'}]};
  const r=semanticPilotReadout(raw,source,final);assert.equal(r.eligibleForInternalScoring,false);assert.equal(r.cost.totalProviderCostUsd,null);
  assert.equal(r.cost.unknownCostCalls,1);assert.equal(r.cost.chargedBudgetUsd,.03);assert.equal(r.measurements[0].omissions.length,1);assert.equal(r.independentK12,'pending_external');
});
test('semantic pilot missing outcome/final build or exceeded loop bound remains incomplete, not perfect accuracy',()=>{
  assert.equal(semanticPilotReadout(null,source,final).cost.fullEpisodeCapExposureWhenMissingUsd,.12);
  const raw={...current,status:'completed',candidateChanged:false,invariants:[],usage:[{cost_usd:.01},{cost_usd:.01},{cost_usd:.01}],measurements:[{recall:1}]};
  const r=semanticPilotReadout(raw,source,final);assert.equal(r.eligibleForInternalScoring,false);assert.ok(r.reasons.includes('predeclared_call_bound_exceeded'));
  assert.equal(semanticPilotReadout({...raw,usage:[]},source,null).eligibleForInternalScoring,false);
});
