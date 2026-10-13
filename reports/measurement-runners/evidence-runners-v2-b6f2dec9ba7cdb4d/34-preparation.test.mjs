import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {STUDIES as originalSemantic} from '../minimal-semantic-studies.mjs';
import {STUDIES as reboundSemantic} from '../minimal-semantic-studies-v2.mjs';
import {PLANS as originalService} from '../current-service-recovery.mjs';
import {PLANS as reboundService, sealCurrentStudies} from '../current-service-recovery-v2.mjs';
import {PLAN_100 as original100} from '../combined-100-controlled.mjs';
import {PLAN_100 as rebound100} from '../combined-100-controlled-v2.mjs';
import {PHYSICAL_PLAN as originalPhysical} from '../physical-scenario-evidence.mjs';
import {PHYSICAL_PLAN as reboundPhysical} from '../physical-scenario-evidence-v2.mjs';
import {validateProbeGate,V2_SOURCE} from '../evidence-probe-guards-v2.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(new URL('./manifest.json',import.meta.url),'utf8'));
const current={candidateFingerprint:V2_SOURCE.candidate,evaluatorFingerprint:V2_SOURCE.baseEvaluator,simulatorBuild:V2_SOURCE.simulator};
function fixture(){const hashes={...current};return {...hashes,humanEvaluatorFingerprint:V2_SOURCE.humanEvaluator,
  verification:{...hashes,passed:true,candidateChanged:false,evaluatorChanged:false,simulatorChanged:false,
    candidateFinalFingerprint:hashes.candidateFingerprint,evaluatorFinalFingerprint:hashes.evaluatorFingerprint,simulatorFinalFingerprint:hashes.simulatorBuild,
    cases:[['platform-tests',485],['simulator-tests',247]].map(([name,n])=>({name,exitCode:0,signal:null,tests:{tests:n,pass:n,fail:0,cancelled:0}}))},
  ui:{...hashes,passed:true,unchanged:true,finalFingerprints:hashes,cases:[{exitCode:0,signal:null,report:{checks:Array(113).fill({passed:true})}}]}};}
test('eight named probes preserve the exact argument, cap, stop and output discovery contract',()=>{
  assert.equal(manifest.entries.length,8);assert.deepEqual(manifest.source,V2_SOURCE);
  assert.deepEqual(manifest.entries.map(e=>e.id),['K11_K13','K15','K07','K14','coupled100','physical_chain','S19','K22']);
  assert.deepEqual(manifest.entries.map(e=>e.maxReserveUsd),[.12,.30,.40,.60,.30,0,.60,.35]);
  for(const e of manifest.entries){assert.match(e.entry,/\.local\/[^/]+-v2\.mjs$/);assert.ok(e.fixedArgs.some(a=>a.startsWith('--run=ROOT_GO')));assert.ok(e.stopFile);}
  assert.equal(manifest.lock,'.local/PAID_RESEARCH_STUDY.lock');assert.equal(manifest.worldsStarted,0);assert.equal(manifest.modelCalls,0);
  assert.equal(manifest.freeze.status,'pending_new_successful_full_UI');
});
test('all seeds, common physics, native permissions, provider limits and definitions remain unchanged',()=>{
  assert.deepEqual(reboundSemantic,originalSemantic);assert.deepEqual(rebound100,original100);assert.deepEqual(reboundPhysical,originalPhysical);
  const noSource=plans=>Object.fromEntries(Object.entries(plans).map(([k,{source,...p}])=>[k,p]));
  assert.deepEqual(noSource(reboundService),noSource(originalService));
  for(const p of Object.values(reboundService))assert.equal(p.source.evaluatorFingerprint,V2_SOURCE.baseEvaluator);
});
test('research K07/K14 definition and all runEpisode/blockedRepairEpisode arguments have identical bytes',async()=>{
  const a=await readFile('.local/research-studies-controlled.mjs','utf8'),b=await readFile('.local/research-studies-controlled-v2.mjs','utf8');
  const defs=t=>t.slice(t.indexOf('const definitions = {'),t.indexOf('const args ='));
  assert.equal(defs(a),defs(b));
  const tail=t=>t.slice(t.indexOf('const rows = []'));
  assert.equal(tail(a),tail(b));
});
test('exact predecessor files and sealed reader remain untouched, copied runners match manifest SHA',async()=>{
  for(const f of manifest.files){assert.equal(sha(await readFile(f.path)),f.sha256);assert.equal(sha(await readFile(f.original.path)),f.original.sha256);}
  for(const f of manifest.dependencies)assert.equal(sha(await readFile(f.path)),f.sha256);
  for(const e of manifest.entries)assert.equal(sha(await readFile(resolve(e.entry))),e.entrySha256);
});
test('fresh source-bound all-pass full/UI is required and v1 base or wrong human proof cannot launch',()=>{
  assert.equal(validateProbeGate(fixture(),current),true);
  const old={...current,evaluatorFingerprint:'4b4d289e387b49da8d79fdccb260a67919b74339432731373204d96aee6668b3'};
  assert.throws(()=>validateProbeGate(fixture(),old),/v4 source mismatch/);
  const wrong=fixture();wrong.humanEvaluatorFingerprint='f'.repeat(64);assert.throws(()=>validateProbeGate(wrong,current),/human evaluator mismatch/);
  const fail=fixture();fail.verification.cases[0].tests.pass--;fail.verification.cases[0].tests.fail++;assert.throws(()=>validateProbeGate(fail,current),/failed full suite/);
  const ui=fixture();ui.ui.finalFingerprints.simulatorBuild='f'.repeat(64);assert.throws(()=>validateProbeGate(ui,current),/another build/);
});
test('S19/K22 archivist requires explicit proof path rather than silently sealing the predecessor file',async()=>{
  await assert.rejects(()=>sealCurrentStudies(),/Explicit current freeze path/);
});
