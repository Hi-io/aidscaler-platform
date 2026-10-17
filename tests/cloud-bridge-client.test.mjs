import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { BridgeClient } from '../src/cloud/bridge-client.mjs';
import { encodeWire, decodeWire, WIRE_VERSION } from '../../disaster-response-simulator/sources/cloud-wire.mjs';
import { cloudRunCap } from '../deploy/gcp/spend-cap.mjs';
test('Pub/Sub RPC correlates durable replies and preserves rejection and source identity', async t => {
  const store = await Store.open(); t.after(() => store.close());
  let bridge;
  const topic = { publishMessage: async ({ data }) => {
    const command = decodeWire(data);
    await bridge.accept({ data: encodeWire({ version: WIRE_VERSION, id: command.id, status: 409,
      headers: { 'x-aidscaler-source-instance': 'new-episode' }, body: '{"error":"SOURCE_RESPONSE_CHANGED"}' }).toString('base64') });
  } };
  bridge = new BridgeClient({ store, topic }); await bridge.initialize();
  const result = await bridge.request('actor', '/api/actor/state');
  assert.equal(result.status, 409); assert.equal(result.headers.get('x-aidscaler-source-instance'), 'new-episode');
  assert.equal((await result.json()).error, 'SOURCE_RESPONSE_CHANGED');
  assert.equal((await store.query('SELECT COUNT(*) AS n FROM cloud_bridge_replies')).rows[0].n, 0);
});
test('a missing simulator fails visibly instead of acknowledging a fabricated receipt', async t => {
  const store = await Store.open(); t.after(() => store.close());
  const bridge = new BridgeClient({ store, topic: { publishMessage: async () => {} }, timeoutMs: 10 });
  await bridge.initialize();
  await assert.rejects(bridge.request('observer', '/api/demo/frame'), error => error.code === 'SIMULATOR_RECONNECTING');
});
test('Cloud Run native cap is monthly and excludes Gemini', () => {
  const cap = cloudRunCap('439219992256');
  assert.deepEqual(cap.budgetFilter.services, ['services/152E-C115-5142']);
  assert.equal(cap.amount.specifiedAmount.units, '10');
  assert.equal(cap.spendCap.inputState, 'CONFIGURED');
  assert.deepEqual(cap.thresholdRules.map(r => r.thresholdPercent), [0.5, 0.8, 1]);
});
