import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../evaluation/harness.mjs';
import { receivedAllocationPlan } from '../src/received-allocation.mjs';
import { receivedUsableQuantity } from '../src/lot-capacity.mjs';

test('HTTP lot observations, consented peer dates and a disconnected expiry are checked by the same received allocator and owner guard', async t => {
  const h = await createHarness({ scenario: 'S23', organizations: 2, seed: 'lot-http-pipeline',
    config: { loadMs: 1000, unloadMs: 1000 }, maxCalls: 0 });
  t.after(() => h.close());
  const a = h.apps[0], peer = h.apps[1], world = h.lab.world, now = world.now,
    own = world.resource('r-org0-water'), other = world.resource('r-org1-water');
  world.inject('lab_intervention', { kind: 'resource_condition', id: own.id,
    lotId: 'near-expiry-owner-lot', useByAt: now + 20000 });
  world.inject('lab_intervention', { kind: 'resource_condition', id: other.id,
    lotId: 'peer-usable-lot', useByAt: now + 3600000 });
  for (const app of h.apps) {
    await app.connector.action('query', { target: 'inventory' }, `dated-inventory-${app.config.org}`);
    await app.ingestion.sync({ sources: false });
  }
  const row = await peer.store.get('org1', 'resource', other.id),
    owner = (await peer.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'", ['org1'])).rows[0];
  assert.equal(row.lotId, 'peer-usable-lot'); assert.equal(row.useByAt, now + 3600000);
  for (const kind of ['resource', 'vehicle']) {
    const records = kind === 'resource' ? [row] : await peer.store.list('org1', 'vehicle', 100);
    for (const r of records) await peer.network.share(owner, { kind, id: r.id, to: 'org0', version: r.version }, `share-dated-${r.id}`);
  }
  await peer.worker.drain(); await a.worker.drain();
  const received = await a.store.get('org0', 'resource', own.id);
  assert.equal(received.useByAt, now + 20000);
  const sector = world.sectorForNode(own.node);
  world.inject('intervention', { type: 'cut', sector, duration: 120000 });
  world.advance(now + 25000);
  await a.ingestion.sync({ sources: false });
  const stale = await a.store.get('org0', 'resource', own.id), sourceNow = (await a.store.get('org0', 'source', 'simulator')).simulatedAt;
  assert.equal(stale.condition, undefined, 'The source expiry update remains queued across the outage');
  assert.equal(receivedUsableQuantity(stale, sourceNow), 0, 'An already-received date suffices; hidden expiry truth is not consulted');
  const plan = await receivedAllocationPlan(a.store, a.config);
  assert.ok(plan.allocations.length > 0);
  assert.ok(plan.allocations.every(x => x.owner === 'org1' && x.resource === other.id));
  const offers = await a.store.list('org0', 'peer_offer', 100),
    consent = offers.find(o => o.from === 'org1' && o.kind === 'resource' && o.projection.id === other.id);
  assert.ok(consent?.active);
  assert.equal(consent.projection.lotId, 'peer-usable-lot');
  assert.equal(consent.projection.useByAt, now + 3600000);
  assert.deepEqual(consent.projection.lotOrigin, { owner: 'org1', resource: other.id });
  assert.ok(plan.evidenceIds.includes(consent.id));
  const localOwner = (await a.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'", ['org0'])).rows[0];
  await assert.rejects(() => a.domain.reserve(localOwner, { resource: own.id, quantity: 10, version: stale.version }, 'stale-expiry-reserve'), { code: 'SUPPLY_EXPIRED' });
  assert.equal(world.need('need-water-main').served, 0, 'A computed plan is not physical help');
  assert.equal((await a.store.list('org0', 'commitment', 100)).length, 0);
  assert.deepEqual(world.invariants(), []);
});
