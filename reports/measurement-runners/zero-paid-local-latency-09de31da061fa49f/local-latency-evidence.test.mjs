import test from 'node:test';
import assert from 'node:assert/strict';
import {LATENCY_PLAN,latencyStats,latencyReadout} from './local-latency-evidence.mjs';

test('latency denominator retains missing clocks and never invents zeros or passes',()=>{
  const result=latencyStats([{ms:100},{ms:null},{ms:-10},{ms:500}], 'ms',200);
  assert.equal(result.observed,2);assert.equal(result.missing,2);assert.equal(result.p95Ms,500);assert.equal(result.withinTarget,null);
  assert.equal(latencyStats([],'ms',200).withinTarget,null);
  assert.equal(latencyStats([{ms:100}],'ms',null).withinTarget,null);
});
test('nearest-rank p95 exposes a tail even if the median fits the target',()=>{
  const r=latencyStats(Array.from({length:20},(_,i)=>({ms:i<18?50:250})),'ms',200);
  assert.equal(r.p50Ms,50);assert.equal(r.p95Ms,250);assert.equal(r.withinTarget,false);
  assert.equal(latencyStats([{ms:200}],'ms',200).withinTarget,false);
});
test('zero-paid latency plan has four owner stores100 native demands but makes no semantic/real-time throughput claim',()=>{
  assert.equal(LATENCY_PLAN.organizations,4);assert.equal(LATENCY_PLAN.nativeNeeds,100);
  const r=latencyReadout({status:'completed',protocol:{...LATENCY_PLAN,browserSamples:1,durableSamplesPerOwner:1,organizations:1,browserFieldSamples:1},usage:[],measurements:{navigation:[{renderMs:40}],commands:[{ackMs:30,readbackMs:60}],
    visibleAcknowledgedState:[{visibleMs:100}],ingestion:[{durableMs:70,pollDelayMs:60000}]}});
  assert.equal(r.navigation.withinTarget,true);assert.equal(r.providerCalls,0);assert.equal(r.semanticPrecisionRecall,null);
  assert.equal(r.throughputRealTimeClaim,false);assert.equal(r.GenAIAttribution,false);
  assert.equal(r.sourceClockPollDelays[0].pollDelayMs,60000);assert.equal(r.receivedFeedToDurableLocal.p95Ms,70);
  assert.equal(r.visibleAcknowledgedState.p95Ms,100);assert.equal(r.acknowledgedAPIReadback.p95Ms,60);
});
test('partial/missing paid usage and uncommitted feed versions stay unknown and failed states remain',()=>{
  const r=latencyReadout({status:'failed',errors:[{code:'DB'}],measurements:{ingestion:[{org:'org0',id:'a',version:1,durableMs:null}]}});
  assert.equal(r.providerCalls,null);assert.equal(r.status,'failed');assert.equal(r.errors[0].code,'DB');
  assert.equal(r.receivedFeedToDurableLocal.withinTarget,null);assert.equal(r.unreadOrUncommittedVersions.length,1);
  assert.equal(r.navigation.samples,24);assert.equal(r.navigation.missing,24);
  assert.equal(r.durableCommand.samples,60);assert.equal(r.visibleAcknowledgedState.samples,15);
});
