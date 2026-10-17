import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { CloudTasksClient } from '@google-cloud/tasks';
import { Store } from '../src/store.mjs';
import { createDemoGateway, recoveredDemoIdentityAbsent } from '../src/demo-gateway.mjs';
import { sourceConnection, observeSourceConnection } from '../src/source-connection.mjs';
import { createDemoSource } from '../src/demo-source.mjs';
import { DemoModelGate } from '../src/demo-provider.mjs';
import { VertexProvider } from '../src/vertex-provider.mjs';
import { OpenRouterProvider } from '../src/provider.mjs';
import { BridgeClient, bridgePubSub } from '../src/cloud/bridge-client.mjs';
import { infrastructureBudgetEvent } from '../src/cloud/cost-guard.mjs';
import { ModelTasks } from '../src/cloud/model-tasks.mjs';
import { operationalSlice, prioritizePhysicalWork } from '../src/cloud/operational-lanes.mjs';
import { queueReceivedResponse } from '../src/cloud/received-response-lane.mjs';

const INFERENCE = ['investigate', 'discover_response', 'interpret_sources', 'analyze_media'];
const env = process.env, project = env.GOOGLE_CLOUD_PROJECT;
for (const key of ['GOOGLE_CLOUD_PROJECT', 'DATABASE_URL', 'DEMO_SESSION_SECRET', 'BRIDGE_COMMAND_TOPIC', 'CLOUD_RUN_URL',
  'CLOUD_TASKS_QUEUE', 'TASK_SERVICE_ACCOUNT', 'PUSH_SERVICE_ACCOUNT']) if (!env[key]) throw Error('Missing server setting: ' + key);
const store = await Store.open({ databaseUrl: env.DATABASE_URL, poolMax: 8 });
await store.exec('CREATE TABLE IF NOT EXISTS cloud_demo_presence(client text PRIMARY KEY,at bigint NOT NULL);' +
  'CREATE TABLE IF NOT EXISTS cloud_demo_cost_state(month text PRIMARY KEY,paused boolean NOT NULL DEFAULT false);' +
  'CREATE TABLE IF NOT EXISTS cloud_demo_control(id text PRIMARY KEY,worker_until bigint NOT NULL DEFAULT 0);' +
  "INSERT INTO cloud_demo_control(id) VALUES('tick') ON CONFLICT DO NOTHING");
const pubsub = bridgePubSub(project, env.BRIDGE_COMMAND_TOPIC);
const bridge = new BridgeClient({ store, topic: pubsub.topic }); await bridge.initialize();
const tasks = new CloudTasksClient(), verifier = new OAuth2Client();
const queue = tasks.queuePath(project, env.GOOGLE_CLOUD_LOCATION ?? 'us-central1', env.CLOUD_TASKS_QUEUE);
const modelQueue = tasks.queuePath(project, env.GOOGLE_CLOUD_LOCATION ?? 'us-central1', 'aidscaler-model');
const origin = env.DEMO_ORIGIN ?? 'https://aidscaler.com';
let gateway, ready, tickBusy = false, operationsCursor = 0;
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function body(req, limit = 12 * 1024 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw Error('BODY_LIMIT'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
async function authenticated(req, email) {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!token) throw Error('INTERNAL_AUTH');
  let ticket;
  try { ticket = await verifier.verifyIdToken({ idToken: token, audience: env.CLOUD_RUN_URL }); }
  catch { throw Error('INTERNAL_AUTH'); }
  const payload = ticket.getPayload();
  if (payload.email !== email || payload.email_verified !== true) throw Error('INTERNAL_AUTH');
}
async function active() {
  if (await costPaused()) return false;
  return Number((await store.query('SELECT COUNT(*) AS n FROM cloud_demo_presence WHERE at>$1', [Date.now() - 600000])).rows[0].n) > 0;
}
async function costPaused() {
  return (await store.query('SELECT paused FROM cloud_demo_cost_state WHERE month=$1', [new Date().toISOString().slice(0, 7)])).rows[0]?.paused === true;
}
async function schedule(delaySeconds = 0) {
  if (!await active()) return;
  // The active turn schedules its own successor. Browser heartbeats should
  // not build a second backlog of equivalent clock wake-ups while it runs.
  if (!delaySeconds && Number((await store.query("SELECT worker_until FROM cloud_demo_control WHERE id='tick'")).rows[0]?.worker_until) > Date.now()) return;
  const seconds = Math.floor(Date.now() / 1000) + delaySeconds;
  const name = queue + '/tasks/demo-tick-' + Math.floor(seconds / 10);
  try { await tasks.createTask({ parent: queue, task: { name, scheduleTime: { seconds }, dispatchDeadline: { seconds: 540 },
    httpRequest: { httpMethod: 'POST', url: env.CLOUD_RUN_URL + '/internal/tick',
      oidcToken: { serviceAccountEmail: env.TASK_SERVICE_ACCOUNT, audience: env.CLOUD_RUN_URL },
      headers: { 'Content-Type': 'application/json' }, body: Buffer.from('{}') } } }); }
  catch (error) { if (error.code !== 6) throw error; }
}
const managed = {
  async touch(client) {
    if (await costPaused()) return { sleeping: true, budgetPaused: true };
    await store.query('INSERT INTO cloud_demo_presence VALUES($1,$2) ON CONFLICT(client) DO UPDATE SET at=$2', [client, Date.now()]);
    const response = await bridge.request('presence', '/', { method: 'POST', body: { client, visible: true } });
    if (!response.ok) throw Error('SIMULATOR_RECONNECTING');
    await schedule(); return response.json();
  },
};
const modelTasks = new ModelTasks({ store, enqueue: async ({ org, token }) => {
  await tasks.createTask({ parent: modelQueue, task: { name: modelQueue + '/tasks/model-' + token,
    dispatchDeadline: { seconds: 540 }, httpRequest: { httpMethod: 'POST',
      url: env.CLOUD_RUN_URL + '/internal/model', oidcToken: {
        serviceAccountEmail: env.TASK_SERVICE_ACCOUNT, audience: env.CLOUD_RUN_URL },
      headers: { 'Content-Type': 'application/json' }, body: Buffer.from(JSON.stringify({ org, token })) } } });
}, run: async org => {
  if (!await active()) return false;
  await ensureReady();
  const row = (await store.query("SELECT * FROM demo_teams WHERE org=$1 AND state='active' AND last_seen>$2", [org, Date.now() - 300000])).rows[0];
  if (!row) return false;
  const app = await gateway.ensureApp(row.org, row.name);
  app.demoActivity.at = Number(row.last_seen);
  return app.worker.once({ includeKinds: INFERENCE });
} });
await modelTasks.initialize();
async function tick() {
  if (tickBusy || !await active()) return;
  tickBusy = true;
  let admitted = false;
  try {
    admitted = await store.transaction(async tx => {
      const row = (await tx.query("SELECT worker_until FROM cloud_demo_control WHERE id='tick' FOR UPDATE")).rows[0];
      if (Number(row.worker_until) > Date.now()) return false;
      await tx.query("UPDATE cloud_demo_control SET worker_until=$1 WHERE id='tick'", [Date.now() + 600000]); return true;
    });
    if (!admitted) return;
    await ensureReady();
    const base = gateway.sourceBases ?? [];
    for (const org of base) await gateway.ensureApp(org.id, org.name, false);
    const visitors = (await store.query("SELECT * FROM demo_teams WHERE state IN ('active','draining')")).rows;
    for (const row of visitors) {
      try {
        const app = await gateway.ensureApp(row.org, row.name); app.demoActivity.at = Number(row.last_seen);
      } catch (error) {
        if (error.code !== 'ACTOR') throw error;
        const connection = await sourceConnection(store, row.org), frame = await gateway.sourceFrame();
        if (!recoveredDemoIdentityAbsent(row.org, connection, frame)) throw error;
        try { await observeSourceConnection(store, row.org, { sourceInstance: frame.episodeId, runId: frame.runId, now: frame.now }); }
        catch (boundary) { if (boundary.code !== 'SOURCE_RESPONSE_CHANGED') throw boundary; }
        await store.query("UPDATE demo_teams SET state='draining' WHERE org=$1", [row.org]);
      }
    }
    const apps = [...gateway.apps.values()];
    // Ingestion, receipts and physical monitoring keep their own lane.
    const stopAt = Date.now() + 30000;
    const ordered = apps.slice(operationsCursor).concat(apps.slice(0, operationsCursor));
    await prioritizePhysicalWork(ordered.map(app => app.worker), stopAt);
    for (const app of ordered) {
      if (Date.now() >= stopAt) break;
      await queueReceivedResponse(app);
      const pending = (await store.query("SELECT id FROM jobs WHERE org=$1 AND kind='ingest' AND state IN ('queued','running','retry') LIMIT 1", [app.config.org])).rows.length;
      // Base teams refresh their scoped inventory in maintenance below; they
      // do not need a second public-feed ingestion pass or paid analysis.
      if (!pending && !app.demoEnding && app.demoVisitor) await store.enqueue(app.config.org, 'ingest', {});
      await operationalSlice(app.worker, stopAt);
      operationsCursor = (apps.indexOf(app) + 1) % apps.length;
    }
    await gateway.reviewBases();
    const modelApps = apps.filter(app => app.demoVisitor && !app.demoEnding && app.demoActivity.at > Date.now() - 300000);
    // Separate queue: long model calls never hold up receipts or physical work.
    for (const app of modelApps) {
      const pending = (await store.query("SELECT id FROM jobs WHERE org=$1 AND kind IN ('investigate','discover_response','interpret_sources','analyze_media') AND state IN ('queued','retry') AND due_at<=$2 LIMIT 1",
        [app.config.org, Date.now()])).rows.length;
      if (pending) await modelTasks.schedule(app.config.org);
    }
    await gateway.maintenance();
    await store.query('DELETE FROM cloud_bridge_replies WHERE at<$1', [Date.now() - 600000]);
    await store.query('DELETE FROM cloud_demo_presence WHERE at<$1', [Date.now() - 86400000]);
  } finally {
    if (admitted) {
      await store.query("UPDATE cloud_demo_control SET worker_until=0 WHERE id='tick'");
      await schedule(10);
    }
    tickBusy = false;
  }
}
const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, origin).pathname;
    if (p === '/healthz') return json(res, 200, { ready: !!gateway });
    if (p === '/internal/bridge-reply') {
      await authenticated(req, env.PUSH_SERVICE_ACCOUNT);
      await bridge.accept((await body(req)).message); return json(res, 200, { accepted: true });
    }
    if (p === '/internal/tick') {
      await authenticated(req, env.TASK_SERVICE_ACCOUNT); await tick(); return json(res, 200, { completed: true });
    }
    if (p === '/internal/model') {
      await authenticated(req, env.TASK_SERVICE_ACCOUNT);
      await modelTasks.execute(await body(req, 4096)); return json(res, 200, { completed: true });
    }
    if (p === '/internal/budget') {
      await authenticated(req, env.PUSH_SERVICE_ACCOUNT);
      const event = infrastructureBudgetEvent(JSON.parse(Buffer.from((await body(req)).message.data, 'base64').toString()), Date.now(), {
        currency: env.BUDGET_CURRENCY ?? 'USD', units: Number(env.BUDGET_UNITS ?? 100), pause: Number(env.BUDGET_PAUSE_UNITS ?? 70) });
      if (!event.stale && event.pause) await store.query('INSERT INTO cloud_demo_cost_state VALUES($1,true) ON CONFLICT(month) DO UPDATE SET paused=true', [event.month]);
      return json(res, 200, { accepted: true });
    }
    if (p.startsWith('/internal/')) return json(res, 404, { error: 'NOT_FOUND' });
    await ensureReady();
    if (req.method === 'POST' && p !== '/demo/api/presence' && await costPaused())
      return json(res, 503, { error: 'DEMO_BUDGET', message: 'Interactive work is paused while the demo budget is reviewed. Saved work is retained.' });
    const target = http.request(gateway.url + req.url, { method: req.method, headers: req.headers }, upstream => {
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    target.on('error', () => { if (!res.headersSent) json(res, 503, { error: 'RECONNECTING' }); else res.destroy(); });
    req.pipe(target);
  } catch (error) {
    if (!res.headersSent) json(res, error.message === 'INTERNAL_AUTH' ? 403 : 503,
      { error: 'UNAVAILABLE', message: 'The demo is reconnecting. Your saved work is retained.' });
  }
});
await new Promise(resolve => server.listen(Number(env.PORT ?? 8080), '0.0.0.0', resolve));
async function initialize() {
  const sourceUrl = await bridge.loopback();
  const source = createDemoSource({ sourceUrl, observerUrl: 'http://observer.internal', observerKey: 'bridge-owned',
    fetcher: async (url, init) => bridge.request('observer', new URL(url).pathname, { method: init.method, body: init.body }) });
  const bootstrap = await source.request('/api/demo/bootstrap');
  source.baseOrganizations = bootstrap.frame.organizations.filter(o => !o.demoVisitor);
  // Viewer geometry is a static, public asset bundled in the image and CDN.
  source.serveViewer = async (_req, res, filename) => {
    if (!/^(spectator-(map|activity)\.mjs|motion\.js|geometry\.js|vendor\/(build\/three(\.core)?(\.module)?\.js|examples\/jsm\/(controls\/OrbitControls|utils\/BufferGeometryUtils)\.js))$/.test(filename))
      throw Error('VIEWER_ASSET');
    const bytes = await readFile(path.join('/app/viewer', filename));
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public,max-age=86400' }); res.end(bytes);
  };
  const modelGate = new DemoModelGate(store, { concurrency: 2,
    hourlyUsd: Number(env.DEMO_MODEL_HOURLY_USD ?? 1), totalUsd: Number(env.DEMO_MODEL_TOTAL_USD ?? 15) }); await modelGate.refresh();
  managed.modelStatus = () => modelGate.status();
  gateway = await createDemoGateway({ store, source, secret: env.DEMO_SESSION_SECRET, dataDir: '/tmp/aidscaler',
    // Firebase Hosting forwards only this reserved cookie to dynamic rewrites.
    cookieName: '__session',
    evidenceRoot: env.EVIDENCE_DIR ?? '/app/evidence', host: '127.0.0.1',
    port: 0, origin, maxActive: 5, maxTeamsTotal: 100, startBase: false, managed,
    testConfig: { autoIngest: false, startWorker: false, provider: env.MODEL_PROVIDER ?? 'openrouter',
      sourceTimeoutMs: 35000,
      modelId: env.MODEL_ID ?? 'google/gemma-4-31b-it',
      vertexProject: project, vertexLocation: 'global', modelMaxOutputTokens: 8192 },
    providerFactory: (_store, config) => {
      const budgeted = { ...config, modelBudgetPool: modelGate };
      const provider = env.MODEL_PROVIDER === 'vertex' ? new VertexProvider(store, budgeted) : new OpenRouterProvider(store, budgeted);
      return { catalogue: () => provider.catalogue(), complete: async request => {
        const leave = await modelGate.enter(request.signal);
        try { await modelGate.refresh(); return await provider.complete(request); } finally { leave(); }
      } };
    } });
  gateway.sourceBases = source.baseOrganizations;
}
async function ensureReady() {
  if (!ready) ready = initialize().catch(error => {
    ready = null;
    console.error('[AidScaler] Cloud demo initialization failed (' + (error.code ?? 'STARTUP') + ').');
    throw error;
  });
  return ready;
}
async function close() {
  await new Promise(resolve => server.close(resolve)); await gateway?.close(); await bridge.close();
  await pubsub.client.close(); await tasks.close(); await store.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().then(() => process.exit(0)));
