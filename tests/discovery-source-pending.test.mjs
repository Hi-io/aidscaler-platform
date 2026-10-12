import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../evaluation/harness.mjs';

test('independent discovery batches reuse one actual source-world pending clarification without revealing a hidden need', async t => {
  let target, calls = 0;
  const h = await createHarness({
    scenario: 'S23', awaitVerifications: false,
    config: {
      observationRate: 1, postsPerHour: 0, healthReports: false, recurringNeeds: false,
      authorshipMs: 0, sourceIndexMs: 0, inspectionMs: 600000,
    },
    provider: { complete: async request => {
      assert.equal(request.task, 'perception');
      calls++;
      return { model: 'offline-contract-test', usage: {}, message: {
        content: JSON.stringify({ observations: [{ text: 'Current water request', kind: 'need',
          sourceIds: ['S1'], location: target, resourceType: 'water', quantity: 9999,
          unit: 'L', timeStatus: 'current' }] }),
      } };
    } },
  });
  t.after(() => h.close());
  const app = h.apps[0], w = h.lab.world;
  target = w.state.map.buildings.find(b => b.use === 'residential').id;
  const need = w.addNeed({ id: 'unreported-source-pending', building: target,
    type: 'water', unit: 'L', quantity: 40, population: 10, deadline: 3600000 });
  const originals = ['first', 'second'].map(label => w.generateSignal('P01', {
    building: target, causeEvent: 'independent-' + label, compositionMs: 0,
    text: `${target}: ${label} independent resident reports a current water shortfall.`,
  }));
  w.advance(60000);
  await app.connector.action('query', { target: 'map' }, 'map-for-pending-discovery');
  await app.ingestion.sync();
  const first = await app.discovery.run({ ids: [originals[0].public.id] }, 'first-source-batch');
  const second = await app.discovery.run({ ids: [originals[1].public.id] }, 'second-source-batch');
  assert.equal(first.state, 'waiting_evidence');
  assert.equal(second.state, 'waiting_evidence');
  assert.equal(second.verifications[0].id, first.verifications[0].id);
  assert.equal(second.verifications[0].reused, true);
  const matching = w.state.inspections.filter(i => i.org === 'org0' && i.target === 'building' &&
    i.entity === target && i.method === 'clarification');
  assert.equal(matching.length, 1, 'there is one physical queue task, not just one mock request');
  assert.equal((await app.connector.state()).known.needs[need.id], undefined);
  assert.equal((await app.store.list('org0', 'need')).some(n => n.id === need.id), false);
  assert.equal((await app.store.list('org0', 'proposal')).length, 0);
  assert.equal(calls, 2, 'independent source provenance is not discarded or merged');
  assert.deepEqual(w.invariants(), []);
});
