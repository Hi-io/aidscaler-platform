import test from 'node:test';
import assert from 'node:assert/strict';
import { takamatsuStudyPlan, studyReadout } from '../scripts/takamatsu-comparison.mjs';
import { responseStages } from '../evaluation/response-stages.mjs';
import { campaignPlan } from '../scripts/human-capacity-campaign.mjs';

test('Takamatsu declares the same historical cohort and only the two requested response methods',()=>{
  const plan=takamatsuStudyPlan();
  assert.equal(plan.worlds.length,6);assert(Math.abs(plan.maximumPaidExposureUsd-.45)<1e-12);
  assert.deepEqual([...new Set(plan.worlds.map(w=>w.arm))],['C_manual','B6']);
  assert.equal(plan.config.topology,'takamatsu');assert.equal(plan.config.count,24);assert.equal(plan.config.noise,192);
  assert.equal(plan.config.horizonMs,10800000);assert.equal(plan.config.humanCapacityOverrides.readErrorBp,0);
  for(const seed of new Set(plan.worlds.map(w=>w.seed)))assert.equal(plan.worlds.filter(w=>w.seed===seed).length,2);
  const free=takamatsuStudyPlan({preflight:true});assert.equal(free.maximumPaidExposureUsd,0);assert(free.worlds.every(w=>w.arm==='C_manual'));
  assert.equal(free.hostPreflight.warmControllerTurns,20);
  assert.equal(campaignPlan({topology:'takamatsu'}).config.topology,'takamatsu');
  assert.throws(()=>campaignPlan({topology:'unavailable-map'}));
  const first=takamatsuStudyPlan({seeds:1});assert.equal(first.worlds.length,2);assert.equal(first.maximumPaidExposureUsd,.15);
  const later=takamatsuStudyPlan({seeds:2,seedStart:2});assert.equal(later.worlds.length,4);assert(later.worlds.every(w=>!w.seed.endsWith('-01')));
  assert.throws(()=>takamatsuStudyPlan({seeds:3,seedStart:2}));
});
const fixture=()=>({protocol:{horizonMs:100000},outcomes:[{id:'n',type:'water',unit:'L',quantity:40,served:40,completedAt:70000,censored:false}],
  metrics:{perCommunity:[{id:'n',createdAt:1000}]},observerOnly:{operations:[{id:'op',need:'n',received:40,times:{authorized:10000,pickupDispatched:11000,pickupArrived:16000,dispatched:20000,arrived:60000,service:70000}}],
  humanWork:[{id:'task',org:'org0',version:1,startedAt:0,readyAt:30000},{id:'task',org:'org0',version:2,startedAt:0,readyAt:30000}]}});
test('Recorded phases remove pickup and loaded travel without double counting human work versions',()=>{
  const r=responseStages(fixture());assert.equal(r.complete,true);assert.equal(r.means.totalMs,69000);
  assert.equal(r.means.preAuthorizationMs,9000);assert.equal(r.means.withoutShipmentTravelMs,24000);
  assert.equal(r.attentionWorkPersonMinutes,.5);
});
test('Censored and incomplete receipts cannot silently become all-needs coordination metrics',()=>{
  const record=fixture();record.outcomes.push({id:'unserved',type:'food',quantity:10,served:0,censored:true});
  const r=responseStages(record);assert.equal(r.complete,false);assert.equal(r.eligible,2);assert.equal(r.observed,1);assert.equal(r.censored,1);
  const broken=fixture();broken.observerOnly.operations[0].times.pickupArrived=null;
  assert.equal(responseStages(broken).complete,false);
  const partial=fixture();partial.observerOnly.operations[0].received=20;
  assert(responseStages(partial).rows[0].issues.includes('sufficient_receipt_mismatch'));
});
test('missing failed-world evidence stays unknown rather than becoming zero minutes, fuel or labor',()=>{
  const row={arm:'C_manual',seed:'seed',status:'failed',protocol:{horizonMs:10800000},outcomes:[],errors:[{code:'fixture-failed'}],
    timeToSufficientService:{eligible:24,reached:null,rightCensored:null,restrictedMeanMs:null},metrics:null};
  const result=studyReadout([row],takamatsuStudyPlan({seeds:1}),{stable:true}).aggregate.conventional;
  for(const key of ['reached','censored','sufficientMinutes','preAuthorizationMinutes','attentionWorkPersonMinutes','distanceKm','fuelLitres','providerCalls','costUsd'])assert.equal(result[key],null,key);
});
