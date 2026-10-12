import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { servicePlan } from '../src/services.mjs';
import { repairContext } from '../src/repair.mjs';

async function fixture(t, { operating = false } = {}) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization('org0');
  await store.upsert('org0', 'source', 'simulator', { simulatedAt: 5000 });
  await store.upsert('org0', 'facility', 'site', { use: 'shelter', capacity: 100,
    node: 'n-site', ownerOrg: 'org0', safe: true, sourceVersion: 1, at: 1000,
    state: operating ? 'operating' : 'candidate', occupancy: operating ? 20 : 0,
    dependencies: { water: 100 }, provisioned: { water: operating ? 90 : 0 } });
  await store.upsert('org0', 'verification', 'assessment', { target: 'building', entity: 'site',
    org: 'org0', method: 'field', purpose: 'facility_safety', state: 'completed',
    confirmedBySource: true, completedAt: 1100, targetVersion: 1,
    result: { safe: true, version: 1, assessment: { method: 'field', purpose: 'facility_safety',
      competent: true, targetVersion: 1, observedAt: 1000, validUntil: 3600000,
      qualifications: ['field_assessment'], inspectorOrg: 'org0', staffResource: 'staff',
      vehicle: 'crew', operation: 'inspection-trip' } } });
  await store.upsert('org0', 'resource', 'water', { owner: 'org0', type: 'water', quantity: 1000,
    reserved: 0, floor: 0, node: 'n-depot' });
  await store.upsert('org0', 'vehicle', 'bus', { owner: 'org0', state: 'idle', capacity: 500, seats: 20 });
  await store.upsert('org0', 'need', 'shelter-need', { type: 'shelter', building: 'pickup',
    quantity: 50, served: 0, inTransit: 0, unit: 'place', sourceSnapshot: { at: 1000, served: 0 } });
  return store;
}
const dispatch = { type: 'dispatch', owner: 'org0', dependsOn: [],
  params: { resource: 'water', vehicle: 'bus', quantity: 100, building: 'site', destination: 'n-site' } };
const evacuation = quantity => ({ type: 'evacuate', owner: 'org0', dependsOn: [],
  params: { from: 'pickup', to: 'site', vehicle: 'bus', quantity } });
async function provision(store, { need = null, peer = false } = {}) {
  const source = { id: 'physical-provision', org: peer ? 'org1' : 'org0', type: 'delivery',
    state: 'completed', building: 'site', need, resourceType: 'water', received: 100,
    quantity: 100, times: { received: 2000, ...(need ? { service: 2000 } : {}) }, observedAt: 2100 };
  await store.upsert('org0', 'operation', peer ? 'peer:org1:physical-provision' : source.id, {
    ...(peer ? { sourceId: source.id, owner: 'org1', sourceSnapshot: source } : source),
    state: source.state, type: source.type, received: source.received, times: source.times,
    sourceObservedAt: 2100, confirmedBySource: true,
  });
}

test('a pending owner-reviewed service prevents duplicate provisions and activation', async t => {
  const store = await fixture(t);
  await store.upsert('org0', 'proposal', 'pending-service', { state: 'executing', actions: [dispatch,
    { type: 'activate', owner: 'org0', dependsOn: [0], params: { building: 'site', permit: true } }] });
  const plan = await servicePlan(store, 'org0', 'site');
  assert.equal(plan.readyToDraft, false);
  assert.equal(plan.waitReceipt, true);
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.pending[0].proposal, 'pending-service');
});

test('a peer physical provision requests fresh site state and then compiles only future activation and trips', async t => {
  const store = await fixture(t);
  await provision(store, { peer: true });
  const stale = await servicePlan(store, 'org0', 'site');
  assert.deepEqual(stale.refreshRequest, { target: 'facility', id: 'site', afterReceiptAt: 2000 });
  assert.equal(stale.readyToDraft, false, 'A historical delivery is not proof of current stock');
  let refreshes = 0;
  const plan = await servicePlan(store, 'org0', 'site', { refreshFacility: async () => {
    refreshes++;
    await store.upsert('org0', 'facility', 'site', { statusObservedAt: 2200, provisioned: { water: 100 } });
  } });
  assert.equal(refreshes, 1);
  assert.equal(plan.readyToDraft, true);
  assert.equal(plan.actions.some(a => a.type === 'dispatch'), false);
  assert.deepEqual(plan.actions.map(a => a.type), ['activate', 'evacuate', 'evacuate', 'evacuate']);
  assert.ok(plan.references.includes('peer:org1:physical-provision'));
});

test('ordinary need delivery is consumed aid and cannot satisfy service provisioning', async t => {
  const store = await fixture(t);
  await provision(store, { need: 'water-need' });
  const plan = await servicePlan(store, 'org0', 'site');
  assert.equal(plan.refreshRequest, undefined);
  assert.equal(plan.actions.find(a => a.type === 'dispatch').params.quantity, 100);
});

test('a newer source snapshot supersedes past receipt totals after stock was consumed', async t => {
  const store = await fixture(t);
  await provision(store);
  await store.upsert('org0', 'facility', 'site', { statusObservedAt: 3000, provisioned: { water: 0 } });
  const plan = await servicePlan(store, 'org0', 'site');
  assert.equal(plan.refreshRequest, undefined);
  assert.equal(plan.actions.find(a => a.type === 'dispatch').params.quantity, 100);
});

test('fresh provision quantities cannot override an invalidated safety assessment', async t => {
  const store = await fixture(t);
  await provision(store);
  await store.upsert('org0', 'facility', 'site', { sourceVersion: 2, statusObservedAt: 3000,
    provisioned: { water: 100 } });
  const plan = await servicePlan(store, 'org0', 'site');
  assert.equal(plan.readyToDraft, false);
  assert.ok(plan.missing.some(m => m.type === 'current_safety_assessment'));
  assert.equal(plan.actions.some(a => a.type === 'activate'), false);
});

test('an operating site does not duplicate served or already-approved passenger trips', async t => {
  const store = await fixture(t, { operating: true });
  await store.upsert('org0', 'operation', 'evac-complete', { type: 'evacuation', owner: 'org0',
    need: 'shelter-need', state: 'completed', received: 20, quantity: 20,
    times: { received: 2000, service: 2000 }, observedAt: 2100, confirmedBySource: true });
  await store.upsert('org0', 'proposal', 'evac-pending', { state: 'authorized', actions: [evacuation(30)] });
  const waiting = await servicePlan(store, 'org0', 'site');
  assert.deepEqual(waiting.actions, []);
  assert.equal(waiting.waitReceipt, true);
  assert.equal(waiting.readyToDraft, false);
  await store.upsert('org0', 'vehicle', 'other-bus', { owner: 'org0', state: 'idle', capacity: 500, seats: 20 });
  await store.upsert('org0', 'need', 'new-shelter-need', { type: 'shelter', building: 'other-pickup',
    quantity: 10, served: 0, unit: 'place', sourceSnapshot: { at: 4000, served: 0 } });
  const useful = await servicePlan(store, 'org0', 'site');
  assert.equal(useful.readyToDraft, true);
  assert.deepEqual(useful.actions.map(a => [a.type, a.params.from, a.params.vehicle, a.params.quantity]),
    [['evacuate', 'other-pickup', 'other-bus', 10]]);
  assert.deepEqual(useful.affectedNeeds, ['new-shelter-need']);
});

test('replacement service preserves completed physical work instead of replaying it', async t => {
  const store = await fixture(t);
  await provision(store);
  await store.upsert('org0', 'facility', 'site', { statusObservedAt: 3000, provisioned: { water: 100 } });
  await store.upsert('org0', 'proposal', 'failed-activation', { state: 'requires_review', actions: [dispatch],
    executionResults: [{ index: 0, result: { operation: 'physical-provision' } }] });
  const future = await servicePlan(store, 'org0', 'site', { excludeProposal: 'failed-activation' });
  assert.equal(future.actions.some(a => a.type === 'dispatch'), false);
  const history = await repairContext(store, 'org0', 'failed-activation', future.actions);
  assert.equal(history.inheritedWork.length, 1);
  assert.equal(history.inheritedWork[0].operationId, 'physical-provision');
  assert.equal(history.inheritedWork[0].state, 'completed');
});
