import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, scriptedReview } from '../evaluation/harness.mjs';
import { Worker } from '../src/worker.mjs';

test('an ordered or partially received purchase stays pending across worker restart; only physical supplier deltas create stock', { timeout: 90000 }, async t => {
  const h = await createHarness({ config: { grid: 5, extentKm: 2,
    supply: { purchaseTranches: [{ fraction: 0.6, delayMs: 60000 }, { fraction: 0.4, delayMs: 180000 }] } } });
  t.after(() => h.close());
  const w = h.lab.world, app = h.apps[0];
  w.advance(60000); await app.ingestion.sync();
  const initial = w.resource('r-org0-water').quantity;
  const p = await app.domain.propose({ org: 'org0', role: 'agent', id: 'purchase-test' }, {
    title: 'Buy observed water with source treasury', summary: 'Await supplier receipts',
    benefit: 'Usable stock after arrival', rationale: 'Payment and delivery are separate events',
    references: ['r-org0-water'], conditions: [],
    actions: [{ type: 'purchase', owner: 'org0', dependsOn: [],
      params: { type: 'water', quantity: 10, price: 1, leadMs: 180000 } }],
  }, 'supplier-partial-order');
  assert.equal(await scriptedReview(app, p), true);
  assert.equal((await app.worker.execute(p.id)).complete, false, 'order ACK is not delivery');
  const order = w.state.purchases.find(x => x.org === 'org0');
  assert.equal(order.receivedQuantity, 0);
  assert.equal(w.resource('r-org0-water').quantity, initial);
  w.advance(order.createdAt + 90000);
  const restarted = new Worker({ store: app.store, config: app.config, connector: app.connector, network: app.network });
  assert.equal((await restarted.execute(p.id)).complete, false, 'six of ten units do not complete the order');
  assert.equal(order.receivedQuantity, 6);
  assert.equal(order.state, 'partial');
  assert.equal(w.resource('r-org0-water').quantity, initial + 6);
  assert.equal((await app.store.get('org0', 'proposal', p.id)).state, 'executing');
  w.advance(order.createdAt + 210000);
  assert.equal((await restarted.execute(p.id)).complete, true);
  assert.equal(order.receivedQuantity, 10);
  assert.equal(order.receipts.reduce((n, r) => n + r.quantity, 0), 10);
  assert.equal(w.resource('r-org0-water').quantity, initial + 10);
  await restarted.execute(p.id);
  assert.equal(w.state.purchases.filter(x => x.org === 'org0').length, 1);
  assert.equal(order.receipts.length, 2);
  assert.deepEqual(w.invariants(), []);
  assert.equal((await app.store.query('SELECT COUNT(*) AS n FROM usage')).rows[0].n, 0);
});

test('an unfilled supplier backorder cannot complete from ETA or a financial receipt', { timeout: 90000 }, async t => {
  const h = await createHarness({ config: { grid: 5, extentKm: 2,
    supply: { purchaseTranches: [{ fraction: 0.6, delayMs: 60000 }], purchaseTerminalState: 'backordered' } } });
  t.after(() => h.close());
  const w = h.lab.world, app = h.apps[0];
  w.advance(60000); await app.ingestion.sync();
  const p = await app.domain.propose({ org: 'org0', role: 'agent', id: 'purchase-test' }, {
    title: 'Await a partially fulfilled supplier order', summary: 'Four units remain outstanding',
    benefit: 'Do not claim unavailable stock', rationale: 'A backorder is not physical delivery',
    references: ['r-org0-water'], conditions: [],
    actions: [{ type: 'purchase', owner: 'org0', dependsOn: [],
      params: { type: 'water', quantity: 10, price: 1, leadMs: 60000 } }],
  }, 'supplier-backorder');
  assert.equal(await scriptedReview(app, p), true);
  await app.worker.execute(p.id);
  const order = w.state.purchases.find(x => x.org === 'org0');
  w.advance(order.createdAt + 240000);
  assert.equal((await app.worker.execute(p.id)).complete, false);
  assert.equal(order.receivedQuantity, 6);
  assert.notEqual((await app.store.get('org0', 'proposal', p.id)).state, 'completed');
  assert.deepEqual(w.invariants(), []);
});

test('a finance snapshot captured before delivery and received later cannot hide a newer physical receipt', { timeout: 90000 }, async t => {
  const h = await createHarness({ config: { grid: 5, extentKm: 2 } });
  t.after(() => h.close());
  const w = h.lab.world, app = h.apps[0];
  w.advance(60000); await app.ingestion.sync();
  const p = await app.domain.propose({ org: 'org0', role: 'agent', id: 'purchase-test' }, {
    title: 'Keep supplier receipt versions ordered', summary: 'Network delivery can be reordered',
    benefit: 'Do not regress delivered stock', rationale: 'Source versions outrank arrival timestamps',
    references: ['r-org0-water'], conditions: [],
    actions: [{ type: 'purchase', owner: 'org0', dependsOn: [],
      params: { type: 'water', quantity: 10, price: 1, leadMs: 60000 } }],
  }, 'supplier-reordered-query');
  assert.equal(await scriptedReview(app, p), true);
  assert.equal((await app.worker.execute(p.id)).complete, false);
  const old = await app.connector.action('query', { target: 'finance' }, 'finance-before-receipt');
  const captured = structuredClone(w.financeView('org0'));
  const order = w.state.purchases.find(x => x.org === 'org0');
  w.advance(order.expectedArrivalAt + 30000);
  const fresh = await app.connector.action('query', { target: 'finance' }, 'finance-after-receipt');
  w.advance(w.now + 30000);
  assert.equal(w.state.queries.find(q => q.id === fresh.id).result.purchases.find(q => q.id === order.id).receivedQuantity, 10);
  // Deliver the old captured result through the ordinary query receipt handler,
  // after the current query. Only actor-visible query data reaches the worker.
  w.completeQuery({ id: old.id, result: captured, observedAt: old.createdAt });
  await app.ingestion.sync();
  assert.equal((await app.worker.execute(p.id)).complete, true);
  const received = await app.store.get('org0', 'source_purchase', order.id);
  assert.equal(received.purchase.receivedQuantity, 10);
  assert.equal(received.purchase.state, 'received');
  assert.equal(w.state.purchases.filter(x => x.org === 'org0').length, 1);
  assert.deepEqual(w.invariants(), []);
});
