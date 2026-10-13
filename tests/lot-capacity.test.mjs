import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { Domain } from '../src/domain.mjs';
import { allocationPlan, validatePlan } from '../src/planning.mjs';
import { receivedUsableQuantity, lotStatus } from '../src/lot-capacity.mjs';
import { servicePlan } from '../src/services.mjs';
import { responseQueue } from '../src/response-policy.mjs';
import { Network } from '../src/network.mjs';

test('received homogeneous lots keep native quantities and expired, invalid-clock or damaged batches are never eligible', () => {
  const r = { quantity: 100, reserved: 20, floor: 10, lotId: 'A', useByAt: 10000 };
  assert.equal(receivedUsableQuantity(r, 5000), 70);
  assert.equal(receivedUsableQuantity(r, 10000), 0);
  assert.equal(receivedUsableQuantity(r, undefined), 0);
  assert.equal(receivedUsableQuantity({ ...r, condition: 'damaged' }, 1000), 0);
  assert.equal(receivedUsableQuantity({ ...r, usableQuantity: 15 }, 1000), 15);
  assert.equal(receivedUsableQuantity({ available: 40, lotId: 'P', useByAt: 20000 }, 5000), 40);
  assert.equal(lotStatus(r, 0, 10000).usable, false);
  assert.equal(receivedUsableQuantity({ quantity: 100, reserved: 20, floor: 10 }, undefined), 70);
});

test('the common allocator excludes already expired and nominally late lots before choosing an eligible shipment', () => {
  const map = { roads: [{ id: 'a', from: 'base', to: 'site', lengthM: 100, speedMps: 10 }],
    places: [{ id: 'building', node: 'site' }] },
    need = { id: 'need', building: 'building', type: 'water', quantity: 100, unit: 'L', served: 0 },
    vehicle = { id: 'truck', owner: 'org0', node: 'base', state: 'idle', capacity: 100, speedMps: 10 },
    stock = { owner: 'org0', node: 'base', type: 'water', quantity: 100, reserved: 0, floor: 0 },
    args = { needs: [need], vehicles: [vehicle], now: 5000, map,
      executionPolicy: { delivery: { loadMs: 1000, unloadMs: 1000, commandNominalLatencyMs: 1000 } } };
  const plan = allocationPlan({ ...args, resources: [
    { ...stock, id: 'expired', lotId: 'A', useByAt: 5000 },
    { ...stock, id: 'too-late', lotId: 'B', useByAt: 15000 },
    { ...stock, id: 'fresh', lotId: 'C', useByAt: 100000 },
  ] });
  assert.equal(plan.allocations.length, 1); assert.equal(plan.allocations[0].resource, 'fresh');
  assert.equal(plan.allocations[0].quantity, 100);
});

async function storeFixture(t) { const s = await Store.open(); t.after(() => s.close());
  await s.organization('org0'); await s.upsert('org0', 'source', 'simulator', { simulatedAt: 5000 }); return s; }
test('owner reservations and exact action approval reject dated stale stock even before delayed physical telemetry arrives', async t => {
  const s = await storeFixture(t), d = new Domain(s, { org: 'org0' }), actor = { id: 'owner', org: 'org0', role: 'commander' };
  const r = await s.upsert('org0', 'resource', 'food', { owner: 'org0', type: 'food', quantity: 20,
    reserved: 0, floor: 0, lotId: 'dinner', useByAt: 5000 });
  await s.upsert('org0', 'vehicle', 'truck', { owner: 'org0', state: 'idle', capacity: 100 });
  await s.upsert('org0', 'need', 'need', { type: 'food', quantity: 10, served: 0 });
  await assert.rejects(() => d.reserve(actor, { resource: r.id, version: r.version, quantity: 10 }, 'expired-reservation'), { code: 'SUPPLY_EXPIRED' });
  await assert.rejects(() => validatePlan(s, 'org0', { actions: [{ type: 'dispatch', owner: 'org0', dependsOn: [],
    params: { resource: 'food', vehicle: 'truck', need: 'need', quantity: 10 } }] }), { code: 'SUPPLY_EXPIRED' });
  assert.equal((await s.get('org0', 'resource', 'food')).reserved, 0);
  assert.equal((await s.list('org0', 'commitment', 10)).length, 0);
});

test('consented projections preserve lot dates, while expiry changes invalidate future work without exposing private resource fields', async t => {
  const s = await storeFixture(t), network = new Network(s, { org: 'org0', peerKey: 'local-test', peers: [{ org: 'org1' }] });
  const r = await s.upsert('org0', 'resource', 'food', { owner: 'org0', type: 'food', quantity: 20,
    reserved: 0, floor: 0, node: 'base', lotId: 'lunch', useByAt: 20000, privateSupplierAccount: 'not-shareable' });
  await network.share({ id: 'owner', org: 'org0', role: 'commander' }, { kind: 'resource', id: r.id, to: 'org1', version: r.version }, 'share-lot');
  const jobs = (await s.query("SELECT payload FROM jobs WHERE kind='peer_send' ORDER BY created_at")).rows;
  const projection = jobs[0].payload.message.projection;
  assert.equal(projection.lotId, 'lunch'); assert.equal(projection.useByAt, 20000);
  assert.equal(projection.available, 20); assert.equal(projection.privateSupplierAccount, undefined);
  await s.upsert('org0', 'source', 'simulator', { simulatedAt: 20000 });
  await s.upsert('org0', 'resource', 'food', { condition: 'expired' }); await network.refresh();
  const all = (await s.query("SELECT payload FROM jobs WHERE kind='peer_send' ORDER BY created_at")).rows;
  assert.equal(all.at(-1).payload.message.projection.available, 0);
  assert.equal(all.at(-1).payload.message.projection.condition, 'expired');
});

test('historical provisioned quantity cannot activate with an expired received lot and unrelated shelter holds do not cause a receipt wait', async t => {
  const s = await storeFixture(t);
  await s.upsert('org0', 'facility', 'site-B', { use: 'shelter', ownerOrg: 'org0', capacity: 100, node: 'B',
    state: 'candidate', sourceVersion: 1, safe: false, dependencies: { water: 60 }, provisioned: { water: 60 }, at: 4000 });
  await s.upsert('org0', 'resource', 'old', { type: 'water', owner: 'org0', node: 'B', quantity: 60,
    reserved: 0, floor: 0, lotId: 'old', useByAt: 5000 });
  await s.upsert('org0', 'need', 'waiting-A', { type: 'shelter', building: 'pickup-A', quantity: 20, served: 0 });
  await s.upsert('org0', 'proposal', 'only-A', { state: 'authorized', actions: [{ type: 'evacuate', owner: 'org0',
    dependsOn: [], params: { from: 'pickup-A', to: 'site-A', quantity: 20, vehicle: 'bus-A' } }] });
  const holds = (await responseQueue(s, 'org0')).planningHolds;
  assert.equal(holds[0].building, 'site-A');
  const b = await servicePlan(s, 'org0', 'site-B');
  assert.equal(b.readyToDraft, false); assert.equal(b.waitReceipt, false); assert.deepEqual(b.pending, []);
  assert.ok(b.missing.some(x => x.type === 'water' && x.quantity === 60 && x.diagnostics[0].reason === 'expiry'));
});
