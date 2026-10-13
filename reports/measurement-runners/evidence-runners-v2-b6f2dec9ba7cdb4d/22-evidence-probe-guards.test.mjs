import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProbeGate, exactPhysicalClock } from './evidence-probe-guards.mjs';

export function fixtureGate() {
  const current={candidateFingerprint:'a'.repeat(64),evaluatorFingerprint:'b'.repeat(64),simulatorBuild:'c'.repeat(64)};
  const verification={...current,simulatorFingerprint:current.simulatorBuild,passed:true,candidateChanged:false,evaluatorChanged:false,simulatorChanged:false,
    candidateFinalFingerprint:current.candidateFingerprint,evaluatorFinalFingerprint:current.evaluatorFingerprint,simulatorFinalFingerprint:current.simulatorBuild,
    cases:['platform-tests','simulator-tests'].map(name=>({name,exitCode:0,signal:null,tests:{tests:10,pass:10,fail:0,cancelled:0}}))};
  const ui={...current,passed:true,unchanged:true,finalFingerprints:current,cases:[{name:'UI',exitCode:0,signal:null}]};
  return {current,freeze:{...current,verification,ui}};
}
test('probe gate requires all three exact source identities, including full/UI final seals',()=>{
  const {current,freeze}=fixtureGate();assert.equal(validateProbeGate(freeze,current),true);
  for(const key of Object.keys(current)) {
    assert.throws(()=>validateProbeGate(freeze,{...current,[key]:'d'.repeat(64)}),/mismatch/);
    const wrong=structuredClone(freeze);wrong.ui.finalFingerprints[key]='d'.repeat(64);
    assert.throws(()=>validateProbeGate(wrong,current),/another build/);
  }
});
test('failed/cancelled suites and partial UI logs do not unlock worlds',()=>{
  const {current,freeze}=fixtureGate();
  for(const change of [x=>x.verification.cases[0].tests.cancelled=1,x=>x.verification.cases[1].exitCode=1,
    x=>x.verification.simulatorChanged=true,x=>x.ui.unchanged=false,x=>x.ui.cases=[]]) {
    const bad=structuredClone(freeze);change(bad);assert.throws(()=>validateProbeGate(bad,current));
  }
});
test('physical source clocks must be finite nonnegative and within the declared horizon',()=>{
  assert.equal(exactPhysicalClock({createdAt:0,times:{service:30}},40),true);
  for(const op of [{times:{service:30}},{createdAt:null,times:{service:30}},{createdAt:-1,times:{service:30}},
    {createdAt:35,times:{service:30}},{createdAt:0,times:{service:41}},{createdAt:NaN,times:{service:30}}])
    assert.equal(exactPhysicalClock(op,40),false);
});
