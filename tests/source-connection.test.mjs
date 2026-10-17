import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { Ingestion } from '../src/ingestion.mjs';
import { Domain } from '../src/domain.mjs';
import { Worker } from '../src/worker.mjs';
import { SimulatorConnector } from '../src/connector.mjs';
import { createPlatform } from '../server.mjs';
import { SOURCE_INSTANCE_HEADER, sourceConnection, observeSourceConnection } from '../src/source-connection.mjs';

const snapshot = () => ({ organization: { id: 'org0' }, runId: 'deterministic-same-seed', now: 600000,
  known: { resources: { water: { id: 'water', owner: 'org0', version: 1, quantity: 80, reserved: 0 } },
    vehicles: {}, needs: {}, buildings: {}, edges: {} },
  operations: [{ id: 'old-delivery', state: 'completed', received: 20, quantity: 20 }],
  inspections: [], commitments: [], queries: [], proposals: [] });
async function setup(t) {
  const store = await Store.open(); await store.organization('org0');
  t.after(() => store.close()); return store;
}
function source(state = snapshot()) {
  const fixture = { state, instance: 'response-instance-a', calls: [] };
  fixture.connector = () => new SimulatorConnector({ sourceUrl: 'http://127.0.0.1:1', sourceAgentKey: 'test-only',
    fetcher: async (url, options) => {
      fixture.calls.push({ path: new URL(url).pathname, options });
      if (options.method === 'POST' && options.headers[SOURCE_INSTANCE_HEADER] !== fixture.instance)
        return Response.json({ error: 'SOURCE_RESPONSE_CHANGED', message: 'Source instance changed' }, {
          status: 409, headers: { [SOURCE_INSTANCE_HEADER]: fixture.instance } });
      return Response.json(options.method === 'POST' ? { id: 'accepted' } : fixture.state,
        { headers: { [SOURCE_INSTANCE_HEADER]: fixture.instance } });
    } });
  return fixture;
}

test('a same-seed reset durably freezes the earlier response without mixing stock, reservations or completed receipts', async t => {
  const store = await setup(t), remote = source(), connector = remote.connector(),
    ingestion = new Ingestion(store, connector, { org: 'org0' });
  await ingestion.sync({ sources: false });
  await store.put('org0', 'commitment', 'old-hold', { state: 'reserved', syncState: 'pending', resource: 'water', quantity: 20 }, 0);
  await store.put('org0', 'proposal', 'old-proposal', { state: 'awaiting_review', title: 'Old response', actions: [] }, 0);
  const oldContext = await store.get('org0', 'context', 'operational'),
    oldStock = await store.get('org0', 'resource', 'water'),
    oldDelivery = await store.get('org0', 'operation', 'old-delivery');
  remote.instance = 'response-instance-b'; remote.state.now = 0; remote.state.operations = [];
  remote.state.known.resources.water.quantity = 100;
  await assert.rejects(ingestion.sync({ sources: false }), { code: 'SOURCE_RESPONSE_CHANGED', status: 409 });
  assert.equal((await sourceConnection(store, 'org0')).reason, 'source_instance_changed');
  assert.deepEqual(await store.get('org0', 'context', 'operational'), oldContext);
  assert.deepEqual(await store.get('org0', 'resource', 'water'), oldStock);
  assert.deepEqual(await store.get('org0', 'operation', 'old-delivery'), oldDelivery);
  assert.equal((await store.get('org0', 'commitment', 'old-hold')).state, 'reserved');
  assert.equal((await store.get('org0', 'proposal', 'old-proposal')).state, 'awaiting_review');
  const beforeRequests = remote.calls.length;
  await assert.rejects(connector.action('query', { target: 'inventory' }, 'old-write'), { code: 'SOURCE_RESPONSE_CHANGED' });
  const restarted = new Ingestion(store, remote.connector(), { org: 'org0' });
  await assert.rejects(restarted.sync({ sources: false }), { code: 'SOURCE_RESPONSE_CHANGED' });
  assert.equal(remote.calls.length, beforeRequests, 'a restart or refresh cannot unlock the previous response');
  const domain = new Domain(store, { org: 'org0' });
  await assert.rejects(domain.review({ org: 'org0', id: 'owner', role: 'commander' }, 'old-proposal',
    { decision: 'approve', version: 1 }, 'approve-old'), { code: 'SOURCE_RESPONSE_CHANGED' });
  await store.enqueue('org0', 'execute_proposal', { id: 'old-proposal' }, 'old-job');
  const worker = new Worker({ store, config: { org: 'org0' } });
  assert.equal(await worker.once(), false);
  await assert.rejects(worker.execute('old-proposal'), { code: 'SOURCE_RESPONSE_CHANGED' });
  assert.equal((await store.query("SELECT state,attempts FROM jobs WHERE id='old-job'")).rows[0].state, 'queued');
});

test('the same source instance resumes normally and sends its binding on every source mutation; a raced reset is rejected', async t => {
  const store = await setup(t), remote = source();
  await new Ingestion(store, remote.connector(), { org: 'org0' }).sync({ sources: false });
  const nextConnector = remote.connector(), resumed = new Ingestion(store, nextConnector, { org: 'org0' });
  await resumed.sync({ sources: false });
  assert.equal((await sourceConnection(store, 'org0')).state, 'connected');
  await nextConnector.action('query', { target: 'inventory' }, 'same-response');
  assert.equal(remote.calls.at(-1).options.headers[SOURCE_INSTANCE_HEADER], 'response-instance-a');
  remote.instance = 'response-instance-b';
  await assert.rejects(nextConnector.action('query', { target: 'inventory' }, 'raced-reset'), { code: 'SOURCE_RESPONSE_CHANGED' });
  assert.equal((await sourceConnection(store, 'org0')).state, 'requires_new_response');
});

test('legacy clock rewinds and scenario changes freeze before importing their new state', async t => {
  const store = await setup(t);
  for (const change of ['clock', 'scenario']) {
    const org = change === 'clock' ? 'org0' : 'org1'; await store.organization(org);
    const state = snapshot(); state.organization.id = org;
    const ingestion = new Ingestion(store, { state: async () => structuredClone(state) }, { org });
    await ingestion.sync({ sources: false });
    const previous = await store.get(org, 'context', 'operational');
    if (change === 'clock') state.now = 0; else state.runId = 'different-scenario';
    await assert.rejects(ingestion.sync({ sources: false }), { code: 'SOURCE_RESPONSE_CHANGED' });
    assert.deepEqual(await store.get(org, 'context', 'operational'), previous);
    assert.equal((await sourceConnection(store, org)).reason, change === 'clock' ? 'simulation_clock_rewound' : 'scenario_changed');
  }
});

test('source writes inside an authorization transaction do not deadlock; a raced reset rolls back the command and durably latches outside it', { timeout: 10000 }, async t => {
  const store = await setup(t), remote = source(), connector = remote.connector();
  await new Ingestion(store, connector, { org: 'org0' }).sync({ sources: false });
  await store.transaction(async tx => {
    await tx.put('org0', 'permission', 'valid-command', { state: 'checked' }, 0);
    assert.equal((await connector.action('query', { target: 'inventory' }, 'inside-valid-transaction')).id, 'accepted');
  });
  assert.equal((await store.get('org0', 'permission', 'valid-command')).state, 'checked');
  remote.instance = 'response-instance-b';
  await assert.rejects(store.transaction(async tx => {
    await tx.put('org0', 'permission', 'must-rollback', { state: 'checked' }, 0);
    await connector.action('query', { target: 'inventory' }, 'inside-reset-transaction');
  }), { code: 'SOURCE_RESPONSE_CHANGED' });
  assert.equal(await store.get('org0', 'permission', 'must-rollback', false), null);
  assert.equal((await sourceConnection(store, 'org0')).state, 'requires_new_response');
});

test('a worker discovering a reset preserves its pending job and retry budget instead of failing the old response', async t => {
  const store = await setup(t), remote = source(), connector = remote.connector(), config = { org: 'org0' },
    ingestion = new Ingestion(store, connector, config);
  await ingestion.sync({ sources: false });
  await store.enqueue('org0', 'ingest', {}, 'reset-during-work');
  remote.instance = 'response-instance-b';
  const worker = new Worker({ store, connector, ingestion, config });
  assert.equal(await worker.once(), false);
  assert.deepEqual((await store.query("SELECT state,attempts,lease_token FROM jobs WHERE id='reset-during-work'")).rows[0],
    { state: 'queued', attempts: 0, lease_token: null });
  assert.equal((await sourceConnection(store, 'org0')).state, 'requires_new_response');
});

test('the read-only latch survives a disk database close and reopen without a new source read', async t => {
  const root = path.resolve('.local'); await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'source-boundary-restart-'));
  let store = await Store.open({ dataDir }); await store.organization('org0');
  await observeSourceConnection(store, 'org0', { sourceInstance: 'old-instance', runId: 'same-run', now: 10000 });
  await assert.rejects(observeSourceConnection(store, 'org0', { sourceInstance: 'new-instance', runId: 'same-run', now: 0 }),
    { code: 'SOURCE_RESPONSE_CHANGED' });
  await store.close(); store = await Store.open({ dataDir }); t.after(() => store.close());
  let reads = 0;
  const ingestion = new Ingestion(store, { state() { reads++; throw Error('No source read is permitted'); } }, { org: 'org0' });
  await assert.rejects(ingestion.sync({ sources: false }), { code: 'SOURCE_RESPONSE_CHANGED' });
  assert.equal(reads, 0);
  assert.equal((await sourceConnection(store, 'org0')).reason, 'source_instance_changed');
});

test('paused response API preserves readable history, blocks mutations and exposes only safe status across application restart', async t => {
  const store = await setup(t), remote = source(), password = 'source-boundary-test-password';
  const options = { store, org: 'org0', port: 0, startWorker: false, autoIngest: false, writeAccessFile: false,
    bootstrapPassword: password, provider: { complete() { throw Error('No model call is allowed'); } } };
  let app = await createPlatform({ ...options, connector: remote.connector() });
  await app.ingestion.sync({ sources: false });
  remote.instance = 'new-instance';
  await assert.rejects(app.ingestion.sync({ sources: false }), { code: 'SOURCE_RESPONSE_CHANGED' });
  await app.close();
  app = await createPlatform({ ...options, connector: remote.connector() });
  t.after(() => app.close());
  const login = await fetch(app.url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'commander@org0.aidscaler.local', password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0], { csrf } = await login.json(),
    headers = { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };
  for (const endpoint of ['/api/status', '/api/me', '/api/public']) {
    const response = await fetch(app.url + endpoint, { headers }); assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.sourceConnection.state, 'requires_new_response');
    assert.deepEqual(Object.keys(data.sourceConnection).sort(), ['message', 'reason', 'state']);
    assert(!JSON.stringify(data.sourceConnection).includes(remote.instance));
  }
  const history = await fetch(app.url + '/api/records?kind=operation', { headers });
  assert.equal(history.status, 200); assert.match(await history.text(), /old-delivery/);
  for (const endpoint of ['/api/query', '/api/review', '/api/contribute', '/api/community/report', '/api/network/inbox', '/api/finance/webhook']) {
    const response = await fetch(app.url + endpoint, { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'SOURCE_RESPONSE_CHANGED');
  }
  assert.equal((await fetch(app.url + '/api/logout', { method: 'POST', headers, body: '{}' })).status, 200);
});

const sourceModule = new URL('../../disaster-response-simulator/sources/server.mjs', import.meta.url);
test('actual source rejects an old bound command after same-seed reset before it changes the new world', {
  skip: !existsSync(sourceModule) && 'Optional simulator checkout is unavailable',
}, async t => {
  const { createLabServers } = await import(sourceModule.href), config = {
    seed: 'actual-source-boundary', grid: 3, extentKm: 2, topology: 'regional', hazard: 'none',
    policy: 'none', postsPerHour: 0, backgroundTraffic: 0, packetLoss: 0,
  }, lab = await createLabServers({ observerPort: 0, sourcePort: 0, persistCredentials: false, config });
  t.after(() => lab.close());
  const store = await setup(t), sourceUrl = `http://127.0.0.1:${lab.sourcePort}`,
    sourceAgentKey = Object.keys(lab.actorKeys).find(key => lab.actorKeys[key].org === 'org0'),
    connector = new SimulatorConnector({ sourceUrl, sourceAgentKey }), ingestion = new Ingestion(store, connector, { org: 'org0', sourceUrl });
  await ingestion.sync();
  const first = await sourceConnection(store, 'org0'), runId = lab.world.runId;
  assert(first.sourceInstance);
  const reset = await fetch(`http://127.0.0.1:${lab.observerPort}/api/config`, { method: 'POST',
    headers: { Authorization: `Bearer ${lab.observerKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
  assert.equal(reset.status, 200); assert.equal(lab.world.runId, runId);
  await assert.rejects(connector.action('query', { target: 'inventory' }, 'stale-instance-write'), { code: 'SOURCE_RESPONSE_CHANGED' });
  assert.equal((lab.world.state.queries ?? []).length, 0);
  assert.equal((await sourceConnection(store, 'org0')).state, 'requires_new_response');
});
