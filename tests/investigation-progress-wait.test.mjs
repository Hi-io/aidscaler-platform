import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, hash } from '../src/store.mjs';
import { Domain } from '../src/domain.mjs';
import { Investigator } from '../src/investigation.mjs';
import { ReplayProvider } from '../src/provider.mjs';

const version = ['request', 1, 'observed'];
async function fixture(t) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization('org0');
  await store.upsert('org0', 'response_policy', 'active', { approved: true,
    order: 'deadline_then_priority', protectedTypes: [], maxOpenReviews: 8 });
  await store.upsert('org0', 'need', 'need', { type: 'shelter', building: 'pickup',
    quantity: 50, served: 0, unit: 'place' });
  await store.upsert('org0', 'proposal', 'approved-trip', { state: 'authorized',
    actions: [20, 20, 10].map((quantity, index) => ({ type: 'evacuate', owner: 'org0',
      params: { from: 'pickup', to: 'site', vehicle: 'bus', quantity },
      dependsOn: index ? [index - 1] : [] })) });
  await store.upsert('org0', 'signal', 'request', { text: 'Families need shelter.',
    sourceVersion: 1, state: 'observed', location: 'pickup', publishedAt: 0 });
  await store.upsert('org0', 'context', 'last_investigated_sources', {
    signature: hash([[version], []]), sourceVersions: [version], reportSignature: hash([]),
  });
  const finish = { role: 'assistant', tool_calls: [{ id: 'finish', type: 'function',
    function: { name: 'finish_without_proposal', arguments: JSON.stringify({
      reason: 'Preserve the new report for verification; do not invent another physical trip.',
    }) } }] };
  const replay = new ReplayProvider([finish, finish]);
  let calls = 0, physical = 0;
  const provider = { complete: async input => { calls++; return replay.complete(input); } },
    config = { org: 'org0', peers: [], modelId: 'recorded-contract-fixture', maxCalls: 2 },
    connector = { startModel: async () => ({ id: 'model-clock' }), finishModel: async () => {},
      state: async () => ({}), ack: async () => {}, action: async () => { physical++; throw Error('No physical command authorized'); } };
  const investigator = new Investigator({ store, config, connector, provider, domain: new Domain(store, config) });
  return { store, investigator, calls: () => calls, physical: () => physical };
}
async function progress(f, text = 'The receiving team confirms 20 L of water.') {
  await f.store.upsert('org0', 'operation', 'received', { type: 'delivery', owner: 'org0', state: 'completed',
    building: 'site', resourceType: 'water', received: 20, quantity: 20,
    times: { received: 2000 }, observedAt: 2100, confirmedBySource: true });
  await f.store.upsert('org0', 'signal', 'public-update', { text, location: 'site',
    publishedAt: 2200, sourceVersion: 1, state: 'observed', source: 'Public social source' });
}

test('automatic research waits for assigned trips without another inference on authentic correlated progress', async t => {
  const f = await fixture(t);
  await progress(f);
  const a = await f.investigator.run({}, 'auto-correlated-progress');
  assert.equal(a.state, 'waiting_receipt');
  assert.equal(a.calls, 0);
  assert.equal(f.calls(), 0);
  assert.equal(f.physical(), 0);
  assert.equal((await f.store.get('org0', 'signal', 'public-update')).state, 'observed',
    'A public statement remains unverified and is not erased');
});

test('a progress-looking post with an additional urgent request still reaches the model', async t => {
  const f = await fixture(t);
  await progress(f, 'The receiving team confirms 20 L of water. People are trapped on another floor.');
  const a = await f.investigator.run({}, 'auto-new-hazard');
  assert.equal(f.calls(), 1);
  assert.equal(a.state, 'inconclusive');
  assert.equal(f.physical(), 0);
});

test('pure support commentary does not reopen assigned work, but a revised request does', async t => {
  const f=await fixture(t);
  await f.store.upsert('org0','signal','commentary',{text:'Thinking of the families at b7. Please keep sharing original updates, not private contact details.',sourceVersion:1,state:'unverified'});
  const waiting=await f.investigator.run({},'auto-routine-commentary');
  assert.equal(waiting.calls,0); assert.equal(f.calls(),0);
  assert.equal((await f.store.get('org0','signal','commentary')).state,'unverified');
  await f.store.upsert('org0','signal','commentary',{sourceVersion:2,text:'Thinking of the families at b7. They need water.'});
  await f.investigator.run({},'auto-changed-commentary'); assert.equal(f.calls(),1); assert.equal(f.physical(),0);
});

test('a public progress statement without an independently received receipt is not suppressed', async t => {
  const f = await fixture(t);
  await f.store.upsert('org0', 'signal', 'public-update', { text: 'The receiving team confirms 20 L of water.',
    location: 'site', publishedAt: 2200, sourceVersion: 1, state: 'observed' });
  await f.investigator.run({}, 'auto-unconfirmed-progress');
  assert.equal(f.calls(), 1);
});

test('manual focus and a repair stay available while the current need is already assigned', async t => {
  const f = await fixture(t);
  const manual = await f.investigator.run({ needId: 'need' }, 'manual-assigned');
  assert.equal(manual.calls, 1);
  await f.store.upsert('org0', 'proposal', 'repair-needed', { state: 'requires_review', actions: [] });
  const repair = await f.investigator.run({ repairOf: 'repair-needed' }, 'repair-assigned');
  assert.equal(repair.calls, 1);
  assert.equal(f.calls(), 2);
});

test('a new uncovered need breaks the waiting gate even without a new public source', async t => {
  const f = await fixture(t);
  await f.store.upsert('org0', 'need', 'new-need', { type: 'water', building: 'new-location',
    quantity: 100, served: 0, unit: 'L' });
  const a = await f.investigator.run({}, 'auto-new-demand');
  assert.equal(f.calls(), 1);
  assert.equal(a.inputSnapshot.focusNeed, 'new-need');
});

test('a corrected source version is not mistaken for unchanged progress', async t => {
  const f = await fixture(t);
  await f.store.upsert('org0', 'signal', 'request', { sourceVersion: 2, text: 'The shelter is now unsafe.' });
  await f.investigator.run({}, 'auto-corrected-source');
  assert.equal(f.calls(), 1);
});
