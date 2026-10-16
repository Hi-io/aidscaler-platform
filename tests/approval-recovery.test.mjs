import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { Domain, recordBlockedReview } from '../src/domain.mjs';

const actor={id:'commander',name:'Alex Morgan',role:'commander',org:'org0'};
const action={type:'dispatch',owner:'org0',params:{need:'need-water',resource:'stock',vehicle:'truck',quantity:100},dependsOn:[]};
async function fixture(t) {
  const store=await Store.open(); t.after(()=>store.close());
  await store.organization('org0');
  await store.put('org0','need','need-water',{type:'water',unit:'L',quantity:600,served:0},0);
  await store.put('org0','resource','stock',{type:'water',unit:'L',quantity:500,reserved:0,floor:0,owner:'org0'},0);
  await store.put('org0','vehicle','truck',{owner:'org0',capacity:300,state:'travelling'},0);
  const domain=new Domain(store,{peers:[]});
  const proposal=await domain.propose(actor,{title:'Water for shelter',summary:'Send 100 L with owner review',benefit:'Meet a reported drinking water need',references:['need-water'],conditions:[],alternatives:[],priority:'high',rationale:'Use received scoped inventory and a response vehicle.',actions:[action]},'draft');
  return {store,domain,proposal};
}

test('a busy-vehicle approval failure schedules a prospective recheck without authorizing or sending any work', async t => {
  const {store,domain,proposal:p}=await fixture(t);
  await assert.rejects(()=>domain.review(actor,p.id,{version:p.version,decision:'approve'},'approve'),e=>e.code==='VEHICLE_BUSY');
  const row=await store.get('org0','proposal',p.id);
  assert.equal(row.state,'requires_review');
  assert.equal(row.reviewBlocked.code,'VEHICLE_BUSY');
  assert.equal(row.reviewBlocked.attemptedVersion,p.version);
  assert.equal(row.authorization,null);
  assert.equal(row.simId,null);
  assert.equal((await store.query("SELECT COUNT(*) AS n FROM jobs WHERE kind IN ('execute_proposal','peer_send')")).rows[0].n,0);
  assert.deepEqual(row.actions,p.actions);
  // When current availability recovers, a person must still review the new
  // version. The failed first attempt is not silently converted to approval.
  await store.upsert('org0','vehicle','truck',{state:'idle'});
  await assert.rejects(()=>domain.review(actor,p.id,{version:p.version,decision:'approve'},'old-version'),e=>e.code==='VERSION_CONFLICT');
  const approved=await domain.review(actor,p.id,{version:row.version,decision:'approve'},'approve-new-version');
  assert.equal(approved.state,'authorized');
  assert.equal(approved.reviewBlocked,null);
  assert.equal((await store.query("SELECT COUNT(*) AS n FROM jobs WHERE kind='execute_proposal'")).rows[0].n,1);
  assert.equal((await store.query("SELECT COUNT(*) AS n FROM jobs WHERE kind='peer_send'")).rows[0].n,0,'partner requests belong to worker execution, not local validation');
});

test('a later blocked retry preserves already issued work and the actual physical failure explanation', async t => {
  const {store,domain,proposal:p}=await fixture(t);
  const results=[{index:0,result:{id:'trip-existing',operation:'trip-existing',state:'blocked'}}];
  const changed=await store.upsert('org0','proposal',p.id,{state:'requires_review',changedReason:'The existing loaded trip is blocked by a damaged road.',executionResults:results,previousAuthorization:{by:actor.id},sourceReview:{state:'authorized',sourceProposal:'old-source-plan'}});
  await assert.rejects(()=>domain.review(actor,p.id,{version:changed.version,decision:'approve'},'retry-issued'),e=>e.code==='VEHICLE_BUSY');
  const row=await store.get('org0','proposal',p.id);
  assert.deepEqual(row.executionResults,results);
  assert.deepEqual(row.sourceReview,changed.sourceReview);
  assert.deepEqual(row.previousAuthorization,changed.previousAuthorization);
  assert.equal(row.changedReason,changed.changedReason);
  assert.equal(row.authorization,null);
  assert.equal((await store.query('SELECT COUNT(*) AS n FROM jobs')).rows[0].n,0);
});

test('recording a failed check cannot overwrite a newer human rejection or an unrelated permissions error', async t => {
  const {store,domain,proposal:p}=await fixture(t);
  const rejected=await domain.review(actor,p.id,{version:p.version,decision:'reject',note:'Use a different response'},'human-reject');
  const result=await recordBlockedReview(store,actor,p.id,p.version,{code:'VEHICLE_BUSY',message:'Busy'},'older-failed-approve');
  assert.equal(result.superseded,true);
  assert.deepEqual(await store.get('org0','proposal',p.id),rejected);
  assert.equal(await recordBlockedReview(store,actor,p.id,rejected.version,{code:'FORBIDDEN',message:'Not an owner'},'no-scope'),null);
  assert.equal((await store.get('org0','proposal',p.id)).state,'rejected');
});
