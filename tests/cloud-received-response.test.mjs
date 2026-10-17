import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {configureResponsePolicy} from '../src/response-policy.mjs';
import {queueReceivedResponse} from '../src/cloud/received-response-lane.mjs';
import {operationalSlice} from '../src/cloud/operational-lanes.mjs';

async function fixture(t,approved=true){
 const store=await Store.open();t.after(()=>store.close());const org='visitor';await store.organization(org);
 if(approved)await configureResponsePolicy(store,{org,id:'owner',role:'commander'},
   {version:0,order:'priority_then_deadline',maxOpenReviews:2,investigationCooldownMs:1000,reason:'Check useful received responses while source inquiries continue.'},'initial');
 await store.put(org,'need','known-water',{type:'water',quantity:300,served:0,unit:'L',deadline:3600000},0);
 return {store,config:{org},demoVisitor:true};
}

test('received facts get a separate zero-model compiler while an unrelated AI inquiry remains active',async t=>{
 const app=await fixture(t),{store,config:{org}}=app;
 await store.enqueue(org,'investigate',{},'long-source-inquiry');
 assert.equal(await queueReceivedResponse(app),true);
 assert.equal(await queueReceivedResponse(app),false);
 const rows=(await store.query('SELECT id,kind,state FROM jobs WHERE org=$1',[org])).rows;
 const compile=rows.find(j=>j.kind==='compile_response');assert(compile);
 const activity=await store.get(org,'activity',compile.id);
 assert.equal(activity.kind,'structured_response');assert.equal(activity.calls,0);assert.equal(activity.model,null);
 const seen=[];
 await operationalSlice({once:async options=>{
   const job=await store.lease(org,180000,Date.now(),options);if(!job)return false;
   seen.push(job.kind);await store.finishJob(job.id,{},job.lease_token);return true;
 }},Date.now()+30000);
 assert.deepEqual(seen,['compile_response']);
 assert.equal((await store.query('SELECT state FROM jobs WHERE id=$1',['long-source-inquiry'])).rows[0].state,'queued');
 assert.equal(await queueReceivedResponse(app),false);
 assert.equal((await store.list(org,'proposal')).length,0); // scheduling is never authorization
});

test('compiler admission honors policy, visitor lifecycle and the source boundary',async t=>{
 const app=await fixture(t,false);assert.equal(await queueReceivedResponse(app),false);
 app.demoVisitor=false;assert.equal(await queueReceivedResponse(app),false);app.demoVisitor=true;
 app.demoEnding=true;assert.equal(await queueReceivedResponse(app),false);app.demoEnding=false;
 await app.store.put('visitor','source_connection','simulator',{state:'requires_new_response'},0);
 assert.equal(await queueReceivedResponse(app),false);
 assert.equal(Number((await app.store.query('SELECT COUNT(*) AS n FROM jobs')).rows[0].n),0);
});
