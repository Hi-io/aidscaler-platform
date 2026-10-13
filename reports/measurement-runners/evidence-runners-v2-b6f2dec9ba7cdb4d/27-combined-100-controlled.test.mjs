import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_100, validate100Gate, cost100, outcome100 } from './combined-100-controlled.mjs';

const current={candidateFingerprint:'c'.repeat(64),evaluatorFingerprint:'e'.repeat(64),simulatorBuild:'a'.repeat(64)};
function gate(){
  const hashes={candidateFingerprint:current.candidateFingerprint,evaluatorFingerprint:current.evaluatorFingerprint,simulatorFingerprint:current.simulatorBuild};
  return {...hashes,verification:{...hashes,passed:true,candidateChanged:false,evaluatorChanged:false,simulatorChanged:false,
    candidateFinalFingerprint:current.candidateFingerprint,evaluatorFinalFingerprint:current.evaluatorFingerprint,simulatorFinalFingerprint:current.simulatorBuild,
    cases:['platform-tests','simulator-tests'].map(name=>({name,exitCode:0,signal:null,tests:{tests:10,pass:10,fail:0,cancelled:0}}))},
    ui:{...hashes,passed:true,unchanged:true,finalFingerprints:hashes,cases:[{exitCode:0,signal:null}]}};
}

test('prepared100 protocol is bounded, same physical request for both modes and the existing64 API limit',()=>{
  assert.deepEqual(PLAN_100.modes,['parser','real']);assert.equal(PLAN_100.workers,1);
  assert.equal(PLAN_100.common.count,100);assert.equal(PLAN_100.common.noise,192);assert.equal(PLAN_100.common.grid,13);
  assert.equal(PLAN_100.common.horizonMs,10800000);assert.equal(PLAN_100.common.sourceCutoffMs,300000);
  assert.equal(PLAN_100.common.maxSourceAttempts,2);assert.equal(PLAN_100.common.retryCooldownMs,60000);
  assert.equal(PLAN_100.limits.real.maxModelCalls,64);assert.equal(PLAN_100.limits.real.providerPaidCapUsd,.30);
  assert.equal(PLAN_100.limits.parser.providerPaidCapUsd,0);assert.match(PLAN_100.physicalScope,/original native stocks/);
  assert.match(PLAN_100.mandatoryGate,/ROOT_GO_100/);
});

test('gate rejects stale start/final hashes, failing suites and UI even when a freeze says approved',()=>{
  assert.equal(validate100Gate(gate(),current),true);
  for(const defect of ['hash','failed','changed','missing-full','ui-failed','ui-stale','final-stale']){
    const f=gate();
    if(defect==='hash')f.candidateFingerprint='b'.repeat(64);
    if(defect==='failed')f.verification.cases[0].tests.fail=1;
    if(defect==='changed')f.verification.simulatorChanged=true;
    if(defect==='missing-full')f.verification.cases.pop();
    if(defect==='ui-failed')f.ui.cases[0].exitCode=1;
    if(defect==='ui-stale')f.ui.simulatorFingerprint='b'.repeat(64);
    if(defect==='final-stale')f.verification.evaluatorFinalFingerprint='b'.repeat(64);
    assert.throws(()=>validate100Gate(f,current),undefined,defect);
  }
});

test('paid unknown usage and failures reserve caps without converting missing billing into zero',()=>{
  const c=cost100({usage:[{state:'completed',cost_usd:.02,wall_ms:1000,model:'configured'},
    {state:'failed',cost_usd:null,reserved_usd:.04,error:'PROVIDER_TIMEOUT',wall_ms:3000,model:'configured'}]},'real');
  assert.equal(c.paidCalls,2);assert.equal(c.knownProviderCostUsd,.02);assert.equal(c.totalProviderCostUsd,null);
  assert.equal(c.unknownCostCalls,1);assert.equal(c.knownUnknownCostReserveUsd,.04);assert.equal(c.chargedBudgetUsd,.06);
  assert.equal(c.failedProviderCalls,1);assert.equal(c.providerWallTotalMs,4000);
  const missing=cost100({status:'failed_control'},'real');assert.equal(missing.paidCalls,null);assert.equal(missing.totalProviderCostUsd,null);assert.equal(missing.chargedBudgetUsd,.30);
  const unpriced=cost100({usage:[{cost_usd:null,reserved_usd:null}]},'real');assert.equal(unpriced.chargedBudgetUsd,.30);
  assert.equal(unpriced.providerWallTotalMs,null);assert.equal(unpriced.providerWallMissingCalls,1);
});

test('explicit settled zero is distinct from absent usage and parser substitute calls are not paid calls',()=>{
  const zero=cost100({usage:[]},'real');assert.equal(zero.totalProviderCostUsd,0);assert.equal(zero.paidCalls,0);
  const parser=cost100({providerCalls:[{sources:30},{sources:30}]},'parser');
  assert.equal(parser.paidCalls,0);assert.equal(parser.parserCalls,2);assert.equal(parser.totalProviderCostUsd,0);
  assert.equal(cost100({},'real').totalProviderCostUsd,null);
});

test('physical partial, censored, supply units, rejected attention and exact outcomes remain separate from recovered status',()=>{
  const report={status:'incomplete_horizon',controllerStoppedAt:10800000,results:{eligible:400,closed:398,retainedAttention:2},
    localState:{openProposals:1,uncoveredReceivedNeeds:99},errors:[{code:'REJECTED_SOURCE'}],invariants:[],usage:[],outcomes:[
      {id:'w',type:'water',unit:'L',quantity:100,served:40,overprovided:0,firstUsefulCensored:false,sufficientCensored:true},
      {id:'f',type:'food',unit:'portions',quantity:20,served:20,overprovided:2,firstUsefulCensored:false,sufficientCensored:false},
      {id:'b',type:'blankets',unit:'unit',quantity:10,served:0,overprovided:0,firstUsefulCensored:true,sufficientCensored:true}]};
  const original=structuredClone(report),r=outcome100(report,'real');
  assert.deepEqual(report,original);assert.equal(r.physicallyEligible,3);assert.equal(r.missingExpectedOutcomes,97);assert.equal(r.status,'incomplete_horizon');
  assert.equal(r.native.find(x=>x.type==='water').received,40);assert.equal(r.native.find(x=>x.type==='water').rightCensored,1);
  assert.equal(r.native.find(x=>x.type==='food').overprovided,2);assert.equal(r.native.find(x=>x.type==='food').sufficient,1);
  assert.equal(r.unavailable.K01_integratedDeficit,null);assert.equal(r.unavailable.K09_utilization,null);assert.equal(r.unavailable.K16_linkedFunnel,null);
  assert.deepEqual(r.errors,report.errors);assert.equal(r.sealedSources.retainedAttention,2);
});

test('missing quantities do not become zero deficits or delivered demand and incomplete results remain unknown',()=>{
  const r=outcome100({status:'failed_control',outcomes:[{type:'water',unit:'L',quantity:100,served:null,sufficientCensored:true}],errors:[]},'real');
  assert.equal(r.native[0].demand,null);assert.equal(r.native[0].received,null);assert.equal(r.native[0].overprovided,null);
  assert.equal(r.costs.totalProviderCostUsd,null);assert.equal(r.native[0].rightCensored,1);
  const absent=outcome100({status:'failed_control'},'real');assert.equal(absent.physicallyEligible,null);assert.equal(absent.missingExpectedOutcomes,100);
});
