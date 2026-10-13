import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GEOMETRY_SOURCE,validateGeometryPlan,validateGeometryGate,geometryFee,auditGeometryProfile} from './geometry-transfer-v2-guards.mjs';
const original=JSON.parse(await readFile(new URL('./geometry-transfer-plan.json',import.meta.url),'utf8')),
  plan=JSON.parse(await readFile(new URL('./geometry-transfer-v2-plan.json',import.meta.url),'utf8'));
const current={candidateFingerprint:GEOMETRY_SOURCE.candidate,evaluatorFingerprint:GEOMETRY_SOURCE.baseEvaluator,
  simulatorBuild:GEOMETRY_SOURCE.simulator,humanEvaluatorFingerprint:GEOMETRY_SOURCE.humanEvaluator};
function gate(){return {...current,verification:{...current,passed:true,candidateChanged:false,evaluatorChanged:false,simulatorChanged:false,
  candidateFinalFingerprint:current.candidateFingerprint,evaluatorFinalFingerprint:current.evaluatorFingerprint,simulatorFinalFingerprint:current.simulatorBuild,
  cases:[['platform-tests',486],['simulator-tests',247]].map(([name,n])=>({name,exitCode:0,signal:null,tests:{tests:n,pass:n,fail:0,cancelled:0}}))},
  ui:{...current,passed:true,unchanged:true,finalFingerprints:current,cases:[{exitCode:0,signal:null,report:{checks:Array(113).fill({passed:true})}}]}};}
const item={...plan.worlds[0],arm:'B6'};
function raw(){return {arm:'B6',seed:item.seed,status:'completed',usage:[{state:'completed',model:'recorded',cost_usd:.01,reserved_usd:.02,wall_ms:20}],
  manifest:{config:{backgroundTraffic:15,packetLoss:.05,grid:item.grid,extentKm:item.extentKm,durationMs:10800000}},
  corpus:{config:{count:12,noise:96,reposts:2,silentFraction:.25,formalDelayMs:3600000}}};}
test('explicit amendment fixes only invalid traffic, never seed/corpus/physics asymmetry or budget',()=>{
  assert.deepEqual(validateGeometryPlan(plan,original),{declaredStudyAdmissionBudgetUsd:.4,selectedNominalPaidCapsUsd:.3,worlds:6,paidWorlds:2});
  assert.equal(original.config.traffic,.15);assert.equal(plan.config.traffic,15);assert.equal(plan.amendment.originalParameterState,'INVALID_NATIVE_INTEGER_NO_WORLD_STARTED');
  for(const defect of ['seed','loss','cap','arm','traffic']){const p=structuredClone(plan);if(defect==='seed')p.worlds[0].seed='different';
    if(defect==='loss')p.config.packetLoss=0;if(defect==='cap')p.config.budgetUsd=.01;if(defect==='arm')p.arms=['B6'];if(defect==='traffic')p.config.traffic=.15;
    assert.throws(()=>validateGeometryPlan(p,original));}
});
test('exact new full486/sim247/UI113 plus current four hashes must all match',()=>{
  assert.deepEqual(validateGeometryGate(gate(),current),{platform:486,simulator:247,ui:113});
  for(const defect of ['count','ui','source','human','failed','final']){const f=gate(),c={...current};
    if(defect==='count')f.verification.cases[0].tests={tests:485,pass:485,fail:0,cancelled:0};
    if(defect==='ui')f.ui.cases[0].report.checks.pop();if(defect==='source')c.evaluatorFingerprint='4b4d289e387b49da8d79fdccb260a67919b74339432731373204d96aee6668b3';
    if(defect==='human')c.humanEvaluatorFingerprint='f'.repeat(64);if(defect==='failed')f.verification.cases[1].tests.cancelled=1;
    if(defect==='final')f.ui.finalFingerprints.simulatorBuild='f'.repeat(64);assert.throws(()=>validateGeometryGate(f,c));}
});
test('actual native15 vehicles and silent/loss/profile are checked without asserting world success',()=>{
  assert.equal(auditGeometryProfile(raw(),item,plan).matches,true);
  for(const defect of ['traffic','loss','map','silent','count','seed']){const r=raw();
    if(defect==='traffic')r.manifest.config.backgroundTraffic=.15;if(defect==='loss')r.manifest.config.packetLoss=0;
    if(defect==='map')r.manifest.config.grid=13;if(defect==='silent')r.corpus.config.silentFraction=0;
    if(defect==='count')r.corpus.config.count=24;if(defect==='seed')r.seed='different';assert.equal(auditGeometryProfile(r,item,plan).matches,false);}
});
test('unknown bill retains cap exposure; explicit zero reference differs from missing failed outcome',()=>{
  const r=raw();r.usage[0].cost_usd=null;r.usage[0].reserved_usd=null;r.costUsd=0;
  let f=geometryFee(r,'B6');assert.equal(f.totalProviderCostUsd,null);assert.equal(f.chargedBudgetUsd,.15);assert.equal(f.unknownExposure,true);
  f=geometryFee(null,'B6');assert.equal(f.providerCalls,null);assert.equal(f.chargedBudgetUsd,.15);assert.equal(f.totalProviderCostUsd,null);
  f=geometryFee({status:'completed',usage:[],modelCalls:0},'B5');assert.equal(f.totalProviderCostUsd,0);assert.equal(f.chargedBudgetUsd,0);
  f=geometryFee(null,'B5');assert.equal(f.totalProviderCostUsd,null);assert.equal(f.providerCalls,null);assert.equal(f.chargedBudgetUsd,0);
});
test('all failed/recovered attempts remain charged and no favorable selective inclusion is introduced',()=>{
  const r=raw();r.usage.unshift({state:'failed',error:'EXTRACTION_SCHEMA',cost_usd:.001,reserved_usd:.03,wall_ms:40});
  const f=geometryFee(r,'B6');assert.equal(f.totalProviderCostUsd,.011);assert.equal(f.failedCalls,1);assert.equal(f.providerCalls,2);
  assert.equal(f.providerWallTotalMs,60);assert.equal(f.attempts[0].error,'EXTRACTION_SCHEMA');
});
test('helper retains common GO/stop/NEWlock, audit precedes pairing, and old plan/helper are preserved',async()=>{
  const text=await readFile(new URL('./geometry-transfer-controlled-v2.mjs',import.meta.url),'utf8');
  assert.match(text,/\.local\/PAID_RESEARCH_STUDY\.lock/);assert.match(text,/ROOT_GO_K18/);assert.match(text,/STOP_GEOMETRY_TRANSFER_CANDIDATE|stopFile = resolve\(plan.stopFile\)/);
  assert.match(text,/auditGeometryProfile\(report,item,plan\)/);assert.match(text,/Native scenario differs from declared traffic\/corpus/);
  assert.match(text,/Exact approved v4 freeze bytes required/);assert.ok(text.includes('rows.push(report)'));
  assert.equal(plan.worlds.length*plan.arms.length,6);assert.equal(plan.stopFile,original.stopFile);
});
