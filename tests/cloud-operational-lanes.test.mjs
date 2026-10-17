import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { operationalSlice, prioritizePhysicalWork } from '../src/cloud/operational-lanes.mjs';

test('a snapshot backlog cannot starve reviewed work, ingestion or partner consent', async t => {
  const store = await Store.open(); t.after(() => store.close());
  await store.organization('test');
  const at = Date.now() - 100;
  await store.enqueue('test', 'peer_send', {message:{kind:'resource'}}, 'old-stock', at - 10);
  await store.enqueue('test', 'peer_send', {message:{kind:'response_request'}}, 'human-consent', at);
  await store.enqueue('test', 'ingest', {}, 'new-observations', at);
  await store.enqueue('test', 'continue_proposal', {}, 'physical-receipt', at);
  await store.enqueue('test', 'investigate', {}, 'model-lane', at);
  const seen = [];
  await operationalSlice({once: async options => {
    const job = await store.lease('test', 180000, Date.now(), options);
    if (!job) return false;
    seen.push(job.id); await store.finishJob(job.id, {}, job.lease_token); return true;
  }}, Date.now() + 30000);
  assert.deepEqual(seen, ['physical-receipt', 'new-observations', 'human-consent', 'old-stock']);
  const model = await store.lease('test'); assert.equal(model.id, 'model-lane');
});

test('an expired cloud slice starts no further work', async () => {
  let calls = 0;
  await operationalSlice({once: async () => { calls++; }}, 10, () => 10);
  assert.equal(calls, 0);
});

test('a large base ingestion cannot hide another organization’s reviewed dispatch', async t => {
  const store=await Store.open();t.after(()=>store.close());
  for(const org of ['base','visitor'])await store.organization(org);
  await store.enqueue('base','ingest',{},'large-map');
  await store.enqueue('visitor','execute_proposal',{},'reviewed-delivery');
  const seen=[];
  const workers=['base','visitor'].map(org=>({once:async options=>{
    const job=await store.lease(org,180000,Date.now(),options);
    if(!job)return false;
    seen.push(job.id);await store.finishJob(job.id,{},job.lease_token);return true;
  }}));
  await prioritizePhysicalWork(workers,Date.now()+30000);
  assert.deepEqual(seen,['reviewed-delivery']);
  assert.equal((await store.lease('base')).id,'large-map');
});
