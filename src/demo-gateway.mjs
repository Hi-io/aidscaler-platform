import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHmac } from 'node:crypto';
import { createPlatform } from '../server.mjs';
import { hash } from './store.mjs';
import { AppError, check } from './errors.mjs';
import { jsonBody } from './json-body.mjs';
import { DemoModelGate } from './demo-provider.mjs';
import { reviewDemoBaseRequests } from './demo-owner.mjs';
import { configuration } from './config.mjs';
import { configureResponsePolicy } from './response-policy.mjs';
import { sourceConnection } from './source-connection.mjs';

const colors = ['#5370d6', '#af678d', '#319281', '#bd854a'];
const cookieName = 'aidscaler_demo';
const inferenceJobs = ['investigate', 'discover_response', 'compile_response', 'interpret_sources', 'analyze_media'];
const token = req => req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
const blockedRead = new Set(['/api/users', '/api/export', '/api/integrations', '/api/integration/status']);
const allowedWrite = new Set(['/api/sync', '/api/query', '/api/verify', '/api/investigate', '/api/interpret-sources', '/api/discover-response', '/api/investigation/stop', '/api/propose', '/api/review', '/api/proposal/revise', '/api/condition', '/api/reserve', '/api/commitment', '/api/report', '/api/report/followup', '/api/report/moderate', '/api/media/upload', '/api/media/analyze', '/api/claim', '/api/claim/correct', '/api/evidence/group', '/api/evidence/split', '/api/evidence/group/restore', '/api/invalidate', '/api/share', '/api/publication/draft', '/api/publication/publish', '/api/publication/retract', '/api/publication/proof', '/api/task/assign', '/api/task/update', '/api/handover', '/api/handover/acknowledge', '/api/coverage/check', '/api/coverage/cancel', '/api/unloading/plan', '/api/unloading/prepare']);
for (const route of ['/api/contribute', '/api/community/report', '/api/community/track', '/api/memory', '/api/delegation', '/api/delegation/revoke']) allowedWrite.add(route);
allowedWrite.add('/api/response-policy');
allowedWrite.add('/api/inventory/receipt');
export function demoResupply(input = { enabled: true, intervalMs: 1800000, water: 300, food: 60 }) {
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => ['enabled', 'intervalMs', 'water', 'food'].includes(k)),
    'DEMO_RESUPPLY', 'Use the supported incoming-supply schedule fields.');
  const { enabled, intervalMs, water, food } = input;
  check(typeof enabled === 'boolean' && Number.isSafeInteger(intervalMs) && intervalMs >= 300000 && intervalMs <= 21600000 &&
    Number.isSafeInteger(water) && water >= 0 && water <= 600 && Number.isSafeInteger(food) && food >= 0 && food <= 120,
  'DEMO_RESUPPLY', 'Choose 5 minutes to 6 simulated hours, up to 600 L of water and 120 food portions per arrival.');
  return { enabled, intervalMs, water, food };
}
const publicResupply = value => value ? Object.fromEntries(['enabled', 'intervalMs', 'water', 'food', 'nextAt', 'waterCap', 'foodCap', 'receiptsCount', 'lastReceivedAt'].filter(k => value[k] !== undefined).map(k => [k, value[k]])) : null;
const bridge = `const base='/demo/workspace';const originalFetch=window.fetch.bind(window);window.fetch=(input,init)=>{if(typeof input==='string'&&input.startsWith('/api/'))input=base+input;else if(input instanceof URL&&input.origin===location.origin&&input.pathname.startsWith('/api/'))input=new URL(base+input.pathname+input.search,location.origin);return originalFetch(input,init)};const rebase=root=>{for(const el of [root,...(root.querySelectorAll?.('[src],[href]')??[])])for(const attr of ['src','href']){const value=el.getAttribute?.(attr);if(value?.startsWith('/')&&!value.startsWith('//')&&!value.startsWith('/demo/'))el.setAttribute(attr,base+value)}};new MutationObserver(changes=>{for(const c of changes){if(c.type==='attributes')rebase(c.target);else for(const node of c.addedNodes)if(node.nodeType===1)rebase(node)}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href','src']});document.addEventListener('click',event=>{const a=event.target.closest('a[href]');if(a){rebase(a);if(a.target==='_blank')a.removeAttribute('target')}} ,true);`;

export function limitDemoSourceWindow(store, app, org, maxSignalsPerTeam) {
  app.demoSources = { count: 0, limited: false };
  const filter = async result => {
    const count = Number((await store.query("SELECT COUNT(*) AS count FROM entities WHERE org=$1 AND kind='signal'", [org])).rows[0].count);
    let remaining = Math.max(0, maxSignalsPerTeam - count);
    const known = await store.getMany(org, 'signal', result.posts.map(p => p.id));
    const posts = result.posts.filter(p => known.has(p.id) || remaining-- > 0);
    app.demoSources = { count, limited: count >= maxSignalsPerTeam };
    return { ...result, posts };
  };
  const feed = app.connector.feed.bind(app.connector), inbox = app.connector.inbox.bind(app.connector);
  app.connector.feed = async (cursor = 0, limit = 100) => cursor === 0 ? filter(await feed(0, limit)) : { posts: [], nextCursor: cursor };
  app.connector.inbox = async () => filter(await inbox());
}

export async function createDemoGateway({ store, source, secret, dataDir, origin = 'http://127.0.0.1:8080', host = '127.0.0.1', port = 8080,
  maxActive = 4, maxTeamsTotal = 100, maxSignalsPerTeam = 5000, idleMs = 30 * 60000, platformFactory = createPlatform, providerFactory, startBase = true, testConfig = {}, model = {}, managed = null } = {}) {
  check(typeof secret === 'string' && secret.length >= 32, 'DEMO_SECRET', 'A persistent private demo session secret is required.', 500);
  await store.exec(`CREATE TABLE IF NOT EXISTS demo_clients(hash text PRIMARY KEY,csrf text NOT NULL,created_at bigint NOT NULL,last_seen bigint NOT NULL,expires_at bigint NOT NULL);
    CREATE TABLE IF NOT EXISTS demo_teams(org text PRIMARY KEY,client_hash text UNIQUE NOT NULL,name text NOT NULL,color text NOT NULL,state text NOT NULL,join_key text NOT NULL,created_at bigint NOT NULL,last_seen bigint NOT NULL,details jsonb NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS demo_upload_quota(org text PRIMARY KEY,bytes bigint NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS demo_join_intents(client_hash text PRIMARY KEY,join_key text NOT NULL,name text NOT NULL,color text NOT NULL,created_at bigint NOT NULL);`);
  await store.exec('ALTER TABLE demo_join_intents ADD COLUMN IF NOT EXISTS resupply jsonb');
  const apps = new Map(), starting = new Map(), limiters = new Map();
  const gate = new DemoModelGate(store, model);
  await gate.refresh();
  const bootstrap = await source.request('/api/demo/bootstrap');
  const episode = { id: bootstrap.frame.episodeId, scenario: 'Continuous disaster response', region: bootstrap.map?.geography?.name ?? 'Takamatsu' };
  const password = org => createHmac('sha256', secret).update('demo-account:' + org).digest('base64url');
  const peerKey = (a, b) => createHmac('sha256', secret).update('demo-peer:' + [a, b].sort().join(':')).digest('hex');
  const secure = new URL(origin).protocol === 'https:';
  let joinTail = Promise.resolve(), closing = false;
  const sourceCall = (route, body) => source.request(route, body);
  const teamRow = async clientHash => (await store.query('SELECT * FROM demo_teams WHERE client_hash=$1', [clientHash])).rows[0];
  function rate(req, kind, cap, period = 60000, weight = 1) {
    // The trusted reverse proxy overwrites X-Forwarded-For; do not trust arbitrary forwarded headers here.
    const scope = ['read', 'action', 'workspace'].includes(kind) && req.demoClientHash ? req.demoClientHash : req.socket.remoteAddress;
    const id = `${scope}:${kind}`, now = Date.now(), previous = limiters.get(id);
    const bucket = previous && now - previous.at < period ? previous : { at: now, count: 0 };
    if (!previous && limiters.size >= 4096) {
      for (const [key, value] of limiters) if (now - value.at > 3600000) limiters.delete(key);
      check(limiters.size < 4096, 'DEMO_RATE', 'The demo is busy. Please retry shortly.', 429);
    }
    bucket.count += weight;
    check(bucket.count <= cap, 'DEMO_RATE', 'Please wait a moment before trying again.', 429); limiters.set(id, bucket);
  }
  async function client(req, res, create = false, renew = false) {
    const raw = token(req), h = raw && hash(raw);
    let row = h && (await store.query('SELECT * FROM demo_clients WHERE hash=$1 AND expires_at>$2', [h, Date.now()])).rows[0];
    if (renew) row = null;
    if (!row && create) {
      rate(req, 'session', 20);
      const rawToken = randomBytes(32).toString('base64url'), now = Date.now();
      row = { hash: hash(rawToken), csrf: randomBytes(24).toString('base64url'), created_at: now, last_seen: now, expires_at: now + 7 * 86400000 };
      await store.query('INSERT INTO demo_clients(hash,csrf,created_at,last_seen,expires_at) VALUES($1,$2,$3,$4,$5)', Object.values(row));
      res.setHeader('Set-Cookie', `${cookieName}=${rawToken}; HttpOnly; SameSite=Strict; Path=/demo/; Max-Age=604800${secure ? '; Secure' : ''}`);
    }
    if (row) {
      req.demoClientHash = row.hash;
      if (!managed) {
        await store.query('UPDATE demo_clients SET last_seen=$2 WHERE hash=$1', [row.hash, Date.now()]);
        await store.query("UPDATE demo_teams SET last_seen=$2 WHERE client_hash=$1 AND state='active'", [row.hash, Date.now()]);
      }
    }
    return row;
  }
  function assertOrigin(req) {
    check(req.headers.origin === origin, 'DEMO_ORIGIN', 'Use the demo page to make this change.', 403);
    check(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 'DEMO_ORIGIN', 'Cross-site requests are not accepted.', 403);
  }
  async function capacity() {
    const rows = (await store.query("SELECT state,COUNT(*) AS count FROM demo_teams GROUP BY state")).rows;
    const pending = Number((await store.query('SELECT COUNT(*) AS count FROM demo_join_intents')).rows[0].count);
    return { active: pending + rows.filter(r => ['active', 'creating', 'draining'].includes(r.state)).reduce((n, r) => n + Number(r.count), 0), max: maxActive, total: pending + rows.reduce((n, r) => n + Number(r.count), 0), totalMax: maxTeamsTotal };
  }
  async function sessionView(c, frame = null) {
    const team = c && await teamRow(c.hash);
    const summary = { pendingDecisions: 0, needsRecheck: 0, activeOperations: 0, completedOperations: 0, blockedOperations: 0, canReview: false };
    if (team?.state === 'active') {
      summary.canReview = (await sourceConnection(store, team.org))?.state === 'connected';
      // Counts belong only to this authenticated organization. No draft text,
      // resource, private citation or another participant's queue enters the map.
      const counts = (await store.query(`SELECT kind,data->>'state' AS state,
        CASE WHEN data->'reviewBlocked' IS NOT NULL AND data->'reviewBlocked'<>'null'::jsonb THEN true ELSE false END AS blocked,
        COUNT(*) AS count FROM entities WHERE org=$1 AND
        (kind='proposal' OR (kind='operation' AND data->>'confirmedBySource'='true'
          AND COALESCE(data->>'org',data->>'owner',$1)=$1))
        GROUP BY kind,data->>'state',blocked`, [team.org])).rows;
      for (const row of counts) {
        const n = Number(row.count);
        if (row.kind === 'proposal' && ['awaiting_review', 'requires_review', 'needs_clarification'].includes(row.state))
          summary[row.state === 'requires_review' || row.blocked ? 'needsRecheck' : 'pendingDecisions'] += n;
        if (row.kind === 'operation') {
          if (['completed', 'received', 'service'].includes(row.state)) summary.completedOperations += n;
          else if (['blocked', 'failed', 'cancelled'].includes(row.state)) summary.blockedOperations += n;
          else summary.activeOperations += n;
        }
      }
    }
    if (team?.state === 'active' && !frame) frame = await sourceCall('/api/demo/frame');
    const liveTeam = summary.canReview ? frame?.organizations?.find(o => o.id === team.org) : null;
    return { csrf: c?.csrf ?? null, organization: team ? { id: team.org, name: team.name, color: team.color, state: team.state, kit: team.details.kit,
      resupply: publicResupply(liveTeam?.resupply ?? team.details.resupply) } : null,
      expiresAt: c ? Number(c.expires_at) : null, capacity: await capacity(), workspaceUrl: team?.state === 'active' ? '/demo/workspace/#overview' : null,
      summary,
      limits: { signalsPerTeam: maxSignalsPerTeam, signalsCollected: team ? apps.get(team.org)?.demoSources?.count ?? 0 : 0,
        sourceWindowLimited: !!(team && apps.get(team.org)?.demoSources?.limited) },
      provider: { model: testConfig.modelId ?? process.env.MODEL_ID ?? 'google/gemma-4-31b-it',
        name: testConfig.provider === 'vertex' ? 'Gemini' : 'Gemma 4', provider: testConfig.provider === 'vertex' ? 'Vertex AI' : 'OpenRouter', ...gate.status(), ...managed?.modelStatus?.() } };
  }
  async function credentials(org) {
    return source.credentials(org);
  }
  function drainApp(app) {
    if (!app) return;
    app.demoEnding = true; app.demoActivity.ended = true;
    app.config.autoIngest = false; app.config.autoInvestigate = false; app.config.autoDiscover = false;
  }
  async function endSession(c) {
    check(c, 'DEMO_SESSION', 'Refresh the demo page before finishing your session.', 401);
    const team = await teamRow(c.hash);
    check(team && ['active', 'draining', 'finished'].includes(team.state), 'DEMO_JOIN_REQUIRED', 'No joined demo team is available to finish.', 409);
    if (team.state === 'active') {
      await store.query("UPDATE demo_teams SET state='draining' WHERE client_hash=$1 AND state='active'", [c.hash]);
      await store.audit(team.org, 'demo-participant', 'demo.session_end_requested', team.org,
        { issuedWorkPreserved: true, historyPreserved: true });
    }
    drainApp(apps.get(team.org));
    return sessionView(c);
  }
  function reconnectPeers() {
    for (const app of apps.values()) app.config.peers = [...apps.values()].filter(other => other !== app)
      .map(other => ({ org: other.config.org, url: other.url, key: peerKey(app.config.org, other.config.org) }));
  }
  async function ensureApp(org, name, visitor = true) {
    if (apps.has(org)) return apps.get(org);
    if (starting.has(org)) return starting.get(org);
    const work = (async () => {
      const keys = await credentials(org), now = Date.now();
      const config = await configuration({ store, port: 0, host: '127.0.0.1', org, orgName: name, sourceUrl: source.sourceUrl, sourceAgentKey: keys.agent, sourceHumanKey: keys.commander,
        evidenceDir: path.join(dataDir, 'evidence', org), secret: createHmac('sha256', secret).update('platform:' + org).digest('hex'), writeAccessFile: false,
        bootstrapPassword: password(org), autoIngest: visitor, autoInvestigate: visitor, autoDiscover: false, pollMs: 10000,
        ...(!visitor ? { shareResourceLimits: { water: 100, food: 40 } } : {}),
        hourlyCallLimit: 36, hourlyBudgetUsd: 0.5, budgetUsd: 0.35, maxCalls: 12, autoBatchWaitMs: 20000, autoBatchMinSignals: 12,
        modelMaxOutputTokens: 8192, startWorker: true, ...testConfig });
      // The gate accepts a synchronous liveness callback; this cache is updated by normal browser heartbeat.
      const activity = { at: now, ended: false };
      const provider = providerFactory ? providerFactory(store, config) : gate.provider(store, config, () => visitor && !activity.ended && activity.at > Date.now() - 5 * 60000);
      const app = await platformFactory({ ...config, provider, startWorker: false });
      // This preconfigured demo kit includes a planning order, not permission
      // to dispatch. Keep every existing coordinator policy and every exact
      // resource-owner review intact. Initialize before the worker is admitted.
      if (visitor && !(await store.get(org, 'response_policy', 'active', false))) {
        const account = (await store.query("SELECT id,org,name,role FROM users WHERE org=$1 AND role='commander'", [org])).rows[0];
        await configureResponsePolicy(store, account, { version: 0, order: 'priority_then_deadline', protectedTypes: [], maxOpenReviews: 4,
          investigationCooldownMs: 60000, reason: 'Preconfigured demo planning order: reported priority, then deadline. Every physical action still requires its resource owner’s separate review and authorization.' }, 'demo-initial-planning-policy-v1');
      }
      app.demoActivity = activity; app.demoVisitor = visitor; apps.set(org, app); reconnectPeers();
      const once = app.worker.once.bind(app.worker);
      app.worker.once = (options = {}) => once(app.demoEnding ? { ...options, excludeKinds: [...new Set([...(options.excludeKinds ?? []), ...inferenceJobs])] } : options);
      if ((await store.query('SELECT state FROM demo_teams WHERE org=$1', [org])).rows[0]?.state === 'draining') drainApp(app);
      if (config.startWorker !== false) app.worker.start();
      app.demoSources = { count: 0, limited: false };
      if (visitor) {
        // A new team joins the current response, not a multi-week historical
        // backfill. Preserve every accepted citation; cap NEW synthetic sources
        // while still accepting revisions/withdrawals of already held sources.
        limitDemoSourceWindow(store, app, org, maxSignalsPerTeam);
      }
      // Query only the ordinary organization-scoped connector; spectator state is never fed into the agent.
      for (const target of ['inventory', 'vehicles', 'map', 'policy'])
        await app.connector.action('query', { target }, `demo-bootstrap-${org}-${hash(bootstrap.frame.episodeId).slice(0, 16)}-${target}`).catch(() => {});
      return app;
    })().finally(() => starting.delete(org));
    starting.set(org, work); return work;
  }
  async function innerSession(app, row) {
    let details = row.details ?? {};
    if (!details.login || !(await app.auth.session(details.login.token))) {
      details = { ...details, login: await app.auth.login(`commander@${row.org}.aidscaler.local`, password(row.org), `demo-${row.org}`) };
      await store.query('UPDATE demo_teams SET details=$2 WHERE org=$1', [row.org, JSON.stringify(details)]);
    }
    if (!managed) app.demoActivity.at = Date.now(); return details.login;
  }
  async function join(c, b, key) {
    check(c, 'DEMO_SESSION', 'Refresh the demo page and try again.', 401);
    check(typeof key === 'string' && key.length >= 8 && key.length <= 160, 'DEMO_IDEMPOTENCY', 'A join request identifier is required. Please retry from the page.');
    const previous = await teamRow(c.hash);
    if (previous) {
      check(previous.join_key === key || previous.state === 'active', 'DEMO_JOIN_PENDING', 'Your team is still being connected. Please retry.', 409);
      if (previous.state === 'active') { await ensureApp(previous.org, previous.name); return sessionView(c); }
      check(previous.state === 'creating', 'DEMO_SESSION_ENDED', 'This team has finished its demo session. Its completed contributions remain in the shared world.', 409);
    }
    const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
    check(name.length >= 2 && name.length <= 48 && !/[<>\x00-\x1f\x7f]/.test(name), 'DEMO_NAME', 'Use a team name between 2 and 48 characters, without markup.');
    if (previous) check(previous.name === name, 'DEMO_JOIN_PENDING', 'Retry the original team name to finish connecting it.', 409);
    check(b.kit == null || b.kit === 'response', 'DEMO_KIT', 'Choose the available response kit.');
    let intent = (await store.query('SELECT * FROM demo_join_intents WHERE client_hash=$1', [c.hash])).rows[0];
    if (intent) check(intent.join_key === key && intent.name === name, 'DEMO_JOIN_PENDING', 'A team named ' + intent.name + ' is already being connected. Retry that original request to recover it.', 409);
    const counts = await capacity();
    check(previous || intent || counts.active < maxActive, 'DEMO_CAPACITY', 'All participant places are currently in use. You can keep observing while a place becomes available.', 409);
    check(previous || intent || counts.total < maxTeamsTotal, 'DEMO_TEAM_QUOTA', 'The demo has reached its team allowance. You can continue observing the response.', 429);
    const usedColors = new Set((await store.query("SELECT color FROM demo_teams WHERE state IN ('active','creating','draining') UNION SELECT color FROM demo_join_intents")).rows.map(row => row.color));
    if (!intent && previous) intent = { color: previous.color };
    if (!intent) {
      intent = { color: colors.find(value => !usedColors.has(value)) ?? colors[counts.total % colors.length], resupply: demoResupply(b.resupply) };
      await store.query('INSERT INTO demo_join_intents(client_hash,join_key,name,color,created_at,resupply) VALUES($1,$2,$3,$4,$5,$6)', [c.hash, key, name, intent.color, Date.now(), JSON.stringify(intent.resupply)]);
    }
    const color = intent.color;
    // Source command idempotency survives a lost HTTP response and gateway restart.
    const allocated = await sourceCall('/api/demo/organizations', { idempotencyKey: 'gateway-' + hash([c.hash, key]), name, color,
      ...(intent.resupply ? { resupply: intent.resupply } : {}) });
    const allocatedOrg = allocated.organization ?? allocated.org, org = allocatedOrg.id;
    await store.transaction(async tx => {
      if (!previous) await tx.query("INSERT INTO demo_teams(org,client_hash,name,color,state,join_key,created_at,last_seen,details) VALUES($1,$2,$3,$4,'creating',$5,$6,$6,$7)", [org, c.hash, allocatedOrg.name, allocatedOrg.color, key, Date.now(), JSON.stringify({ kit: allocated.kit, runId: allocated.runId, resupply: allocatedOrg.resupply })]);
      await tx.query('DELETE FROM demo_join_intents WHERE client_hash=$1', [c.hash]);
    });
    await ensureApp(org, allocatedOrg.name);
    await store.query("UPDATE demo_teams SET state='active',last_seen=$2 WHERE org=$1", [org, Date.now()]);
    return sessionView(c);
  }
  const proxyHeaders = response => Object.fromEntries([...response.headers].filter(([key]) => !['set-cookie', 'content-encoding', 'content-length', 'connection', 'transfer-encoding', 'content-security-policy'].includes(key)));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin), p = url.pathname;
      check(!closing, 'DEMO_RESTARTING', 'The demo is reconnecting. Please try again shortly.', 503);
      if (!['/healthz', '/readyz', '/demo/api/health'].includes(p)) rate(req, 'edge', 3000, 60000, p === '/demo/api/bootstrap' ? 20 : 1);
      if (p === '/healthz' || p === '/readyz' || p === '/demo/api/health') {
        if (managed && p === '/healthz') return send(res, 200, { status: 'ok' });
        await source.healthCheck?.();
        if (p !== '/healthz') {
          try { await store.query('SELECT 1 AS ready'); }
          catch { throw new AppError('DEMO_DATABASE', 'Workspace storage is reconnecting. Existing simulation state is retained.', 503); }
        }
        const health = await sourceCall('/api/demo/frame');
        return send(res, 200, { status: 'ok', sourceInstanceId: health.sourceInstanceId, teams: apps.size, model: gate.status() });
      }
      if (p.startsWith('/demo/api/')) {
        const c = await client(req, res, p === '/demo/api/session');
        rate(req, 'read', 600);
        if (p === '/demo/api/presence' && req.method === 'POST') {
          assertOrigin(req); check(c && req.headers['x-csrf-token'] === c.csrf, 'DEMO_CSRF', 'Refresh the demo session.', 403);
          const body = await jsonBody(req, 1024);
          check(body.visible === true, 'DEMO_PRESENCE', 'Presence requires a visible demo tab.');
          if (managed) {
            await store.query('UPDATE demo_clients SET last_seen=$2 WHERE hash=$1', [c.hash, Date.now()]);
            await store.query("UPDATE demo_teams SET last_seen=$2 WHERE client_hash=$1 AND state='active'", [c.hash, Date.now()]);
          }
          const team = await teamRow(c.hash), app = team && apps.get(team.org);
          if (app) app.demoActivity.at = Date.now();
          return send(res, 200, managed ? await managed.touch(c.hash) : { sleeping: false });
        }
        if (p === '/demo/api/session' && req.method === 'GET') return send(res, 200, await sessionView(c));
        if (p === '/demo/api/session/resupply' && req.method === 'POST') {
          assertOrigin(req); check(c && req.headers['x-csrf-token'] === c.csrf, 'DEMO_CSRF', 'Refresh the demo session before changing incoming supplies.', 403);
          rate(req, 'action', 100);
          const team = await teamRow(c.hash);
          check(team?.state === 'active' && (await sourceConnection(store, team.org))?.state === 'connected',
            'DEMO_TEAM_ACTIVE', 'Only an active, connected team can change its incoming-supply schedule.', 409);
          const resupply = demoResupply(await jsonBody(req, 4096)), key = req.headers['idempotency-key'];
          check(typeof key === 'string' && key.length >= 8 && key.length <= 160, 'DEMO_IDEMPOTENCY', 'An update identifier is required. Retry from the demo page.');
          const updated = await sourceCall('/api/demo/organizations/resupply', { org: team.org, idempotencyKey: 'resupply-' + hash([c.hash, key]), resupply });
          await store.query('UPDATE demo_teams SET details=details||$2::jsonb WHERE org=$1', [team.org, JSON.stringify({ resupply: updated.resupply })]);
          const view = await sessionView(c);
          // The spectator projection can trail the admitted source command.
          // Return its exact acknowledgement instead of reverting the editor.
          view.organization.resupply = publicResupply(updated.resupply);
          return send(res, 200, view);
        }
        if (p === '/demo/api/session/end' && req.method === 'POST') {
          assertOrigin(req); check(c && req.headers['x-csrf-token'] === c.csrf, 'DEMO_CSRF', 'Refresh the demo session before finishing your team.', 403);
          rate(req, 'action', 100);
          const result = await endSession(c);
          setImmediate(() => maintenance().catch(() => {}));
          return send(res, 200, result);
        }
        if (p === '/demo/api/session/renew' && req.method === 'POST') {
          assertOrigin(req); check(c && req.headers['x-csrf-token'] === c.csrf, 'DEMO_CSRF', 'Refresh the demo session before starting another team.', 403);
          const previous = await teamRow(c.hash);
          check(previous?.state === 'finished', 'DEMO_TEAM_ACTIVE', 'Finish the current response before starting another demo team. Existing operations must drain first.', 409);
          const next = await client(req, res, true, true);
          await store.query('UPDATE demo_clients SET expires_at=$2 WHERE hash=$1', [c.hash, Date.now()]);
          return send(res, 200, await sessionView(next));
        }
        if (p === '/demo/api/join' && req.method === 'POST') {
          assertOrigin(req); check(c && req.headers['x-csrf-token'] === c.csrf, 'DEMO_CSRF', 'Refresh the demo session before joining.', 403); rate(req, 'join', 8, 3600000);
          const b = await jsonBody(req, 4096); const task = joinTail.then(() => join(c, b, req.headers['idempotency-key'])); joinTail = task.catch(() => {});
          return send(res, 201, await task);
        }
        check(req.method === 'GET', 'METHOD', 'This demo view is read-only.', 405);
        if (['/demo/api/bootstrap', '/demo/api/frame'].includes(p)) return send(res, 200, await sourceCall('/api/demo/' + p.split('/').at(-1)));
        if (p === '/demo/api/state') {
          const frame = await sourceCall('/api/demo/frame');
          const session = await sessionView(c, frame);
          return send(res, 200, { ...frame, sourceInstanceId: frame.episodeId, episode: { ...episode, id: frame.episodeId }, session, provider: session.provider });
        }
        throw new AppError('NOT_FOUND', 'This demo endpoint does not exist.', 404);
      }
      if (p.startsWith('/demo/workspace/')) {
        const c = await client(req, res), row = c && await teamRow(c.hash);
        rate(req, 'workspace', 900);
        check(row?.state === 'active', 'DEMO_JOIN_REQUIRED', 'Join the response from the demo map to open your workspace.', 401);
        const app = await ensureApp(row.org, row.name);
        app.demoRequests = (app.demoRequests ?? 0) + 1;
        let completedRequest = false;
        const releaseRequest = () => { if (!completedRequest) { completedRequest = true; app.demoRequests--; } };
        res.once('finish', releaseRequest); res.once('close', releaseRequest);
        check((await teamRow(c.hash))?.state === 'active' && !app.demoEnding, 'DEMO_SESSION_ENDING', 'This team is finishing its current response. Follow its deliveries from the demo map.', 409);
        const login = await innerSession(app, row);
        const target = p.slice('/demo/workspace'.length) || '/';
        check(!target.includes('..') && !target.includes('\\'), 'DEMO_PATH', 'Invalid workspace path.', 403);
        if (target === '/demo-bridge.mjs') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(bridge + (managed ? '\n' + await readFile(new URL('./cloud/presence-browser.mjs', import.meta.url), 'utf8') : '')); }
        if (target.startsWith('/api/')) {
          check(!blockedRead.has(target) && !['/api/login', '/api/logout', '/api/network/inbox', '/api/finance/webhook'].includes(target), 'DEMO_SCOPE', 'This setting is managed by the demonstration host.', 403);
          if (req.method !== 'GET') {
            assertOrigin(req); check(req.headers['x-csrf-token'] === login.csrf, 'DEMO_CSRF', 'Refresh your workspace before making this change.', 403);
            check(allowedWrite.has(target), 'DEMO_SCOPE', 'This configuration is managed by the demonstration host.', 403); rate(req, 'action', 100);
          }
        } else check(req.method === 'GET' && !['/sw.js', '/manifest.webmanifest'].includes(target), 'DEMO_SCOPE', 'This workspace resource is unavailable in the shared demo.', 403);
        const headers = { Cookie: `aidscaler_${hash([row.org, app.server.address().port]).slice(0, 20)}=${login.token}`, 'X-CSRF-Token': login.csrf,
          ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}), ...(req.headers['idempotency-key'] ? { 'Idempotency-Key': req.headers['idempotency-key'] } : {}) };
        let body;
        if (req.method !== 'GET') {
          const input = await jsonBody(req, target === '/api/media/upload' ? 14000000 : target === '/api/community/report' ? 3000000 : 1000000);
          if (target === '/api/response-policy') {
            // Visitors may choose operational priorities, never expand model
            // budgets or turn the shared server into an unbounded work queue.
            check(Number.isInteger(input.maxOpenReviews) && input.maxOpenReviews >= 1 && input.maxOpenReviews <= 8 &&
              Number.isInteger(input.investigationCooldownMs) && input.investigationCooldownMs >= 30000,
            'DEMO_PLANNING_LIMIT', 'The shared demo supports 1–8 open reviews and at least 30 seconds between changed-case inquiries. Model limits remain managed by the host.', 400);
          }
          const encoded = target === '/api/media/upload' ? input.contentBase64 : target === '/api/community/report' ? input.attachment?.contentBase64 : null;
          if (typeof encoded === 'string') {
            const bytes = Buffer.from(encoded, 'base64').length;
            await store.command(row.org, 'demo-upload-' + hash(req.headers['idempotency-key'] ?? encoded), { route: target, digest: hash(encoded), bytes }, async tx => {
              const previous = Number((await tx.query('SELECT bytes FROM demo_upload_quota WHERE org=$1', [row.org])).rows[0]?.bytes ?? 0);
              check(previous + bytes <= 20000000, 'DEMO_UPLOAD_QUOTA', 'This team has reached its 20 MB attachment allowance. Text reports and existing evidence remain available.', 429);
              await tx.query('INSERT INTO demo_upload_quota(org,bytes) VALUES($1,$2) ON CONFLICT(org) DO UPDATE SET bytes=EXCLUDED.bytes', [row.org, previous + bytes]);
              return { acceptedBytes: bytes };
            });
          }
          body = JSON.stringify(input);
        }
        check(!app.demoEnding, 'DEMO_SESSION_ENDING', 'This team is finishing its current response. Existing work remains recorded.', 409);
        const response = await fetch(app.url + target + url.search, { method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(120000) });
        const outputHeaders = proxyHeaders(response);
        outputHeaders['cache-control'] = 'no-store';
        outputHeaders['content-security-policy'] = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
        let bytes = Buffer.from(await response.arrayBuffer());
        if (outputHeaders['content-type']?.includes('text/html')) bytes = Buffer.from(bytes.toString('utf8').replace(/<link\s+rel="manifest"[^>]*>/g, '').replace(/(src|href)="\/(?!\/)/g, '$1="/demo/workspace/').replace('<script type="module" src="/demo/workspace/app.mjs">', '<script type="module" src="/demo/workspace/demo-bridge.mjs"></script><script type="module" src="/demo/workspace/app.mjs">'));
        if (outputHeaders['content-type']?.includes('text/css')) bytes = Buffer.from(bytes.toString('utf8').replace(/url\((['"]?)\/(?!\/)/g, 'url($1/demo/workspace/'));
        res.writeHead(response.status, outputHeaders); return res.end(bytes);
      }
      if (p.startsWith('/demo/viewer/')) {
        check(req.method === 'GET', 'METHOD', 'The observer is read-only.', 405);
        return await source.serveViewer(req, res, p.slice('/demo/viewer/'.length));
      }
      throw new AppError('NOT_FOUND', 'This route is not part of the demo gateway.', 404);
    } catch (error) { if (!res.headersSent) send(res, error.status ?? 500, { error: error.code ?? 'DEMO_UNAVAILABLE', message: error.status ? error.message : 'The demo is reconnecting. Your approved contributions remain saved.' }); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  if (startBase) for (const org of source.baseOrganizations ?? []) await ensureApp(org.id, org.name, false);
  if (!managed) for (const row of (await store.query("SELECT * FROM demo_teams WHERE state IN ('active','creating','draining')")).rows) await ensureApp(row.org, row.name);
  let maintenanceBusy = false, maintenanceSettled = Promise.resolve(), reviewSettled = Promise.resolve();
  async function maintenance() {
    if (maintenanceBusy || closing) return; maintenanceBusy = true;
    let finished; maintenanceSettled = new Promise(resolve => { finished = resolve; });
    try {
      await gate.refresh();
      // Recover an acknowledged/lost physical allocation using the original
      // durable material, never a new kit or newly selected color.
      for (const intent of (await store.query('SELECT * FROM demo_join_intents ORDER BY created_at')).rows) {
        const owner = (await store.query('SELECT * FROM demo_clients WHERE hash=$1', [intent.client_hash])).rows[0];
        if (!owner) continue;
        const recover = joinTail.then(() => join(owner, { name: intent.name, kit: 'response', ...(intent.resupply ? { resupply: intent.resupply } : {}) }, intent.join_key));
        joinTail = recover.catch(() => {});
        try { await recover; await store.query('UPDATE demo_teams SET last_seen=$2 WHERE client_hash=$1', [owner.hash, Number(intent.created_at)]); } catch {}
      }
      for (const row of (await store.query("SELECT * FROM demo_teams WHERE state IN ('active','draining')")).rows) {
        if (row.state === 'active' && Number(row.last_seen) > Date.now() - idleMs) { const app = apps.get(row.org); if (app) app.demoActivity.at = Number(row.last_seen); continue; }
        const app = apps.get(row.org);
        if (row.state === 'active') await store.query("UPDATE demo_teams SET state='draining' WHERE org=$1", [row.org]);
        drainApp(app);
        if (app?.demoRequests > 0) continue;
        const fenced = (await sourceConnection(store, row.org))?.state === 'requires_new_response';
        // Old, read-only authorizations cannot issue new work. They stay in
        // history, while the source still refuses retirement until its actual
        // trips, loaded cargo, reservations and commitments have drained.
        if (!fenced && app && (await store.list(row.org, 'proposal', 1000)).some(p => ['authorized', 'executing', 'awaiting_partner'].includes(p.state))) continue;
        // Stop issuing source work before requesting release. The simulator refuses release while any physical operation is still active.
        if (app) await app.worker.stop();
        try {
          await sourceCall('/api/demo/organizations/release', { org: row.org, idempotencyKey: 'gateway-release-' + row.org });
          if (app) { await app.close(); apps.delete(row.org); reconnectPeers(); }
          await store.query("UPDATE demo_teams SET state='finished' WHERE org=$1", [row.org]);
        } catch (error) { if (app && !managed) app.worker.start(); if (![409, 400].includes(error.status)) throw error; }
      }
      // Publish only explicitly shareable capability projections through the existing signed peer protocol.
      for (const app of apps.values()) {
        if (!app.demoVisitor) await app.ingestion.sync({ sources: false }).catch(() => {});
        if (app.demoEnding || (await sourceConnection(store, app.config.org))?.state === 'requires_new_response') continue;
        const keys = await credentials(app.config.org);
        app.connector.agentKey = keys.agent; app.connector.humanKey = keys.commander;
        if (!app.config.peers.length) continue;
        const actor = (await store.query("SELECT id,org,name,role FROM users WHERE org=$1 AND role='commander'", [app.config.org])).rows[0];
        for (const kind of ['resource', 'vehicle']) for (const record of (await store.list(app.config.org, kind, 100)).filter(r => r.owner === app.config.org && !r.background && (app.demoVisitor || kind === 'vehicle' || ['water', 'food'].includes(r.type))))
          for (const peer of app.config.peers) await app.network.share(actor, { kind, id: record.id, to: peer.org, version: record.version }, `demo-capability-${peer.org}-${kind}-${record.id}-${record.version}-${Math.floor(Date.now() / 3600000)}`).catch(() => {});
      }
    } finally { maintenanceBusy = false; finished(); }
  }
  const timer = managed ? null : setInterval(() => maintenance().catch(() => {}), 60000); timer?.unref();
  let reviewing = false;
  async function reviewBases() {
    if (reviewing || closing) return; reviewing = true;
    let finished; reviewSettled = new Promise(resolve => { finished = resolve; });
    try { for (const app of apps.values()) if (app.demoVisitor === false) await reviewDemoBaseRequests(app, org => apps.get(org)?.demoVisitor === true); }
    finally { reviewing = false; finished(); }
  }
  const ownerTimer = managed ? null : setInterval(() => { if (testConfig.startWorker !== false) reviewBases().catch(() => {}); }, 5000); ownerTimer?.unref();
  let stopped;
  return { server, store, apps, gate, maintenance, reviewBases, ensureApp, url: `http://${host}:${server.address().port}`, async close() {
    if (stopped) return stopped;
    closing = true; clearInterval(timer); clearInterval(ownerTimer);
    stopped = (async () => {
      // Stop admission, finish current HTTP commands and background owners,
      // then snapshot the complete instance set. No late-created writer can
      // survive the gateway's coordinated shutdown.
      await new Promise(resolve => server.close(resolve));
      await Promise.allSettled([joinTail, maintenanceSettled, reviewSettled]);
      await Promise.allSettled([...starting.values()]);
      await Promise.allSettled([...apps.values()].map(app => app.close()));
    })();
    return stopped;
  } };
}
