import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {manualStageRetryState as retry,manualHandoffDelivered as delivered,summarizeHumanCapacity} from '../evaluation/human-capacity-benchmark.mjs';
import {failedHumanCapacityWorld as failure,withHumanResearchLock as lock} from '../scripts/human-capacity-campaign.mjs';

test('native manual retry uses only exact own terminal work and stops after two attempts',()=>{
  const receipt={id:'native-relay',org:'org0',stage:'relay',state:'inconclusive'},scope={id:'native-relay',org:'org0',stage:'relay'};
  assert.equal(retry(receipt,1,scope),'retry');
  assert.equal(retry(receipt,2,scope),'exhausted');
  assert.equal(retry({...receipt,state:'failed'},1,scope),'retry');
  for(const state of ['queued','working','awaiting_delivery','completed'])assert.equal(retry({...receipt,state},1,scope),null);
  for(const bad of [{...scope,org:'org1'},{...scope,id:'other-work'},{...scope,stage:'read'}])assert.equal(retry(receipt,1,bad),null);
  assert.equal(retry(receipt,0,scope),null);
});

test('handoff readiness requires actual exact relay and same substantive need, never approval',()=>{
  const need={id:'native-need',building:'site',type:'water',unit:'L',quantity:100,deadline:200000,priority:3,state:'active',version:2};
  const scope={workId:'retry-relay',from:'org0',to:'org1',need};
  const inbox={id:'retry-relay',from:'org0',to:'org1',source:{kind:'need',id:need.id,version:2},snapshot:need,sourceObservedAt:200,receivedAt:2000};
  assert.equal(delivered(inbox,scope),true);
  for(const bad of [{...inbox,id:'prior-relay'},{...inbox,to:'org2'},{...inbox,from:'org2'},
    {...inbox,source:{...inbox.source,kind:'proposal'}},{...inbox,snapshot:{...need,quantity:80}},
    {...inbox,sourceObservedAt:2100},{...inbox,receivedAt:null}])assert.equal(delivered(bad,scope),false);
});

test('initialization/finalization exception preserves unknown fees/calls and full paid reservation',()=>{
  const source={candidate:'c'.repeat(64),baseEvaluator:'e'.repeat(64),evaluator:'b'.repeat(64),simulator:'s'.repeat(64)};
  const world={arm:'B6',profile:'moderate',condition:'moderate',seed:'unchanged'},config={count:24};
  const row=failure({world,config,source,cap:.15,error:Object.assign(Error('usage DB unavailable'),{code:'ENOSPC'}),wallMs:123});
  assert.equal(row.status,'failed');assert.equal(row.costUsd,null);assert.equal(row.modelCalls,null);
  assert.equal(row.chargedBudgetUsd,.15);assert.equal(row.invariants,null);assert.equal(row.usageMissing,true);
  assert.equal(row.timeToSufficientService.eligible,24);assert.equal(row.timeToSufficientService.reached,null);
  assert.equal(row.finalCandidateFingerprint,null);assert.equal(row.errors[0].code,'ENOSPC');
  const report=summarizeHumanCapacity([row],[world,{...world,arm:'B5'}]);
  assert.equal(report.failedOrStoppedRuns,1);assert.equal(report.missingRuns.length,1);
  assert.ok(report.comparisons.every(c=>!c.comparable&&c.physicalTimeGainFraction==null));
});

test('reference initialization failure records unknown ledger while no-paid contract holds',()=>{
  const row=failure({world:{arm:'B8',condition:'zero'},config:{count:24},source:{},cap:.15,error:Error('cannot initialize'),wallMs:1});
  assert.equal(row.costUsd,null);assert.equal(row.modelCalls,null);assert.equal(row.chargedBudgetUsd,0);
  assert.equal(row.failedBeforeFinalReport,true);
});

const fixtureRoot=resolve('.local/human-hardening-lock-fixtures');await mkdir(fixtureRoot,{recursive:true});
test('archive/write callback failure releases the exact real nonce lock',async()=>{
  const folder=await mkdtemp(resolve(fixtureRoot,'fault-'));assert.ok(folder.startsWith(fixtureRoot));
  const path=resolve(folder,'study.lock');
  await assert.rejects(lock(path,{nonce:'owned',study:'bounded-no-provider'},async()=>{
    assert.equal(JSON.parse(await readFile(path,'utf8')).nonce,'owned');
    throw Object.assign(Error('simulated archive write outage'),{code:'ENOSPC'});
  }),e=>e.code==='ENOSPC');
  await assert.rejects(readFile(path),e=>e.code==='ENOENT');
});

test('lock owned by another nonce cannot be deleted even after callback failure',async()=>{
  const folder=await mkdtemp(resolve(fixtureRoot,'identity-'));assert.ok(folder.startsWith(fixtureRoot));
  const path=resolve(folder,'study.lock');
  await assert.rejects(lock(path,{nonce:'owned'},async()=>{
    await writeFile(path,JSON.stringify({nonce:'replacement'}));throw Error('archive fault');
  }),/identity changed/);
  assert.equal(JSON.parse(await readFile(path,'utf8')).nonce,'replacement');
});

test('existing research lock refuses callback and remains byte-identical',async()=>{
  const folder=await mkdtemp(resolve(fixtureRoot,'existing-'));assert.ok(folder.startsWith(fixtureRoot));
  const path=resolve(folder,'study.lock'),bytes='{"nonce":"prior-study"}';await writeFile(path,bytes);
  let called=false;await assert.rejects(lock(path,{nonce:'new'},async()=>{called=true;}),e=>e.code==='EEXIST');
  assert.equal(called,false);assert.equal(await readFile(path,'utf8'),bytes);
});
