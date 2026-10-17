import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { createDemoGateway, limitDemoSourceWindow } from '../src/demo-gateway.mjs';
import { createDemoSource } from '../src/demo-source.mjs';
import { createLabServers } from '../../disaster-response-simulator/sources/server.mjs';
import { DemoModelGate } from '../src/demo-provider.mjs';
import { baseDemoRequestAllowed, reviewDemoBaseRequests } from '../src/demo-owner.mjs';

test('connected demo: scoped onboarding, real proposal authorization/receipt, recovery and isolation', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-demo-test-'));
  const lab = await createLabServers({ isolated: true, observerPort: 0, sourcePort: 0, persistCredentials: false,
    storageDir: path.join(dir, 'transport'), config: { topology: 'grid', grid: 5, extentKm: 2, scenario: 'S23', seed: 'demo-gateway-real-physical',
      organizations: 4, mode: 'interactive', continuousDemo: true, clockLatency: 'wall', hazard: 'none', policy: 'none',
      backgroundTraffic: 0, postsPerHour: 0, packetLoss: 0, observationRate: 1, networkLatencyMs: 1000, queryLatencyMs: 1000, reviewMs: 1000, loadMs: 1000, unloadMs: 1000 } });
  const store = await Store.open(); let gateway;
  t.after(async () => { await gateway?.close(); await store.close(); await lab.close(); await rm(dir, { recursive: true, force: true }); });
  const source = createDemoSource({ observerUrl: `http://127.0.0.1:${lab.observerPort}`, sourceUrl: `http://127.0.0.1:${lab.sourcePort}`, observerKey: lab.observerKey });
  source.baseOrganizations = [{ id: 'org0', name: 'Relief North' }];
  const realRequest = source.request; let loseAllocationAck = true;
  source.request = async (route, body) => {
    const result = await realRequest(route, body);
    if (route === '/api/demo/organizations' && body.name === 'Harbor Support' && loseAllocationAck) {
      loseAllocationAck = false; throw Object.assign(Error('Simulated lost allocation acknowledgement.'), { status: 504, code: 'DEMO_TEST_ACK' });
    }
    return result;
  };
  await lab.runtime.request('demoConfigureDirector', { enabled: true, intervalMs: 300000, maxOpen: 8, maxActive: 4 });
  await lab.advance(60000);
  let providerCalls = 0;
  const providerFactory = (_store, config) => ({ complete: async () => {
    providerCalls++;
    assert.equal(config.apiKey, 'non-secret-provider-fixture'); assert.equal(config.modelId, 'google/gemma-4-31b-it');
    const need = (await store.list(config.org, 'need', 100)).find(n => n.id.startsWith('demo-need-') && n.type === 'water');
    assert.ok(need, 'ordinary delayed observations reached the visitor, without spectator input: ' + JSON.stringify({ org: config.org,
      needs: (await store.list(config.org, 'need', 100)).map(n => ({ id: n.id, type: n.type })),
      received: (await gateway.apps.get(config.org).connector.state()).known?.needs,
      world: (await source.request('/api/demo/frame')).needs.filter(n => n.id.startsWith('demo-need-')) }));
    const tool = (name, arguments_) => ({ model: 'deterministic-test-fixture', message: { role: 'assistant', content: null,
      tool_calls: [{ id: 'fixture-tool-' + providerCalls, type: 'function', function: { name, arguments: JSON.stringify(arguments_) } }] } });
    if (providerCalls === 1) return tool('read_context', { kind: 'resource', ids: [`r-${config.org}-water`], detail: true });
    if (providerCalls === 2) return tool('read_action_contract', { types: ['dispatch'] });
    return tool('draft_response', {
      title: 'Water for the reported shelter', summary: 'Deliver 100 litres using the new team’s own supplies.', benefit: '100 L of the observed need received.',
      rationale: 'Current scoped need observation, owned inventory and vehicle. Partial contribution; receipt remains unconfirmed.', references: [need.id, `r-${config.org}-water`, `v-${config.org}-0`],
      conditions: [], actions: [{ type: 'dispatch', owner: config.org, params: { need: need.id, resource: `r-${config.org}-water`, vehicle: `v-${config.org}-0`, quantity: 100 }, dependsOn: [] }],
    });
  } });
  const options = { store, source, secret: 'test-private-demo-secret-'.repeat(3), dataDir: dir, origin: 'http://demo.test', port: 0, startBase: true,
    providerFactory, testConfig: { apiKey: 'non-secret-provider-fixture', autoIngest: false, autoInvestigate: true, autoDiscover: false, startWorker: false } };
  gateway = await createDemoGateway(options);
  const missingAsset = await fetch(gateway.url + '/demo/viewer/vendor/build/three.core.module.js');
  assert.equal(missingAsset.status, 404);
  assert.equal((await fetch(gateway.url + '/demo/api/health')).status, 200, 'a missing async asset never terminates the gateway');
  const threeCore = await fetch(gateway.url + '/demo/viewer/vendor/build/three.core.js');
  assert.equal(threeCore.status, 200); assert.match(threeCore.headers.get('content-type'), /javascript/);
  const api = async (cookie, route, data, csrf, key = 'test-demo-command') => {
    const r = await fetch(gateway.url + route, { method: data ? 'POST' : 'GET', headers: { ...(cookie ? { cookie } : {}), ...(data ? { Origin: 'http://demo.test', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': key } : {}) }, body: data ? JSON.stringify(data) : undefined });
    const result = await r.json(); return { response: r, data: result };
  };
  const a = await api(null, '/demo/api/session'); const aCookie = a.response.headers.get('set-cookie').split(';')[0];
  assert.match(a.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/demo\//);
  assert.equal((await api(aCookie, '/demo/api/join', { name: 'Harbor Support' }, 'wrong')).response.status, 403);
  const lost = await api(aCookie, '/demo/api/join', { name: 'Harbor Support', kit: 'response' }, a.data.csrf, 'join-visitor-alpha');
  assert.equal(lost.response.status, 504);
  assert.equal((await store.query('SELECT COUNT(*) AS count FROM demo_join_intents')).rows[0].count, 1);
  const b = await api(null, '/demo/api/session'), bCookie = b.response.headers.get('set-cookie').split(';')[0];
  const bj = await api(bCookie, '/demo/api/join', { name: 'Cedar Response', kit: 'response' }, b.data.csrf, 'join-visitor-bravo');
  assert.equal(bj.response.status, 201);
  await gateway.close(); gateway = await createDemoGateway(options);
  const joined = await api(aCookie, '/demo/api/join', { name: 'Harbor Support', kit: 'response' }, a.data.csrf, 'join-visitor-alpha');
  assert.equal(joined.response.status, 201, JSON.stringify(joined.data));
  const org = joined.data.organization.id;
  assert.equal(joined.data.organization.kit.vehicles, 3);
  assert.equal((await api(aCookie, '/demo/api/session/renew', {}, a.data.csrf)).response.status, 409, 'an active organization cannot reset its cookie to obtain another kit');
  const retry = await api(aCookie, '/demo/api/join', { name: 'Harbor Support', kit: 'response' }, a.data.csrf, 'join-visitor-alpha');
  assert.equal(retry.data.organization.id, org);
  await lab.runtime.refresh();
  assert.equal((await source.request('/api/demo/frame')).organizations.filter(o => o.demoVisitor).length, 2);
  assert.notEqual(bj.data.organization.id, org); assert.notEqual(bj.data.organization.color, joined.data.organization.color);
  assert.equal((await store.query('SELECT COUNT(*) AS count FROM demo_join_intents')).rows[0].count, 0);
  const me = await api(aCookie, '/demo/workspace/api/me'); assert.equal(me.data.user.org, org); assert.equal(me.data.user.role, 'commander');
  assert.equal((await api(aCookie, '/demo/workspace/api/users')).response.status, 403);
  assert.equal((await api(aCookie, '/demo/workspace/api/organization', { name: 'Bad configuration' }, me.data.user.csrf)).response.status, 403);
  assert.equal((await api(aCookie, '/demo/api/control', { play: false }, a.data.csrf)).response.status, 405);
  const shell = await fetch(gateway.url + '/demo/workspace/', { headers: { cookie: aCookie } }); const html = await shell.text();
  assert.match(shell.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.match(html, /demo\/workspace\/demo-bridge.mjs/); assert.doesNotMatch(html, /src="\/app.mjs"/);
  const css = await fetch(gateway.url + '/demo/workspace/styles.css', { headers: { cookie: aCookie } });
  assert.match(await css.text(), /@import url\("\/demo\/workspace\/decision.css"\)/);
  const app = gateway.apps.get(org);
  const communityUpload = await api(aCookie, '/demo/workspace/api/community/report', {
    clientId: 'gateway-large-attachment', text: 'A community attachment for private review.', location: 'Shelter entrance', observedAt: 60000,
    attachment: { mime: 'image/png', contentBase64: Buffer.alloc(1100000, 5).toString('base64') },
  }, me.data.user.csrf, 'gateway-large-attachment');
  assert.equal(communityUpload.response.status, 201, JSON.stringify(communityUpload.data));
  const report = await store.get(org, 'report', communityUpload.data.id);
  assert.equal((await store.get(org, 'media', report.references[0])).size, 1100000);
  await lab.advance(125000);
  for (let i = 0; i < 100; i++) {
    if ((await app.connector.state()).now >= 125000) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await app.ingestion.sync();
  const policy = await store.get(org, 'response_policy', 'active');
  assert.equal(policy.approved, true); assert.equal(policy.order, 'priority_then_deadline');
  const queuedResearch = (await store.query("SELECT id,payload FROM jobs WHERE org=$1 AND kind='investigate' AND state='queued' ORDER BY created_at LIMIT 1", [org])).rows[0];
  assert.ok(queuedResearch, 'ordinary source ingestion queues a focused AI investigation automatically');
  assert.equal(queuedResearch.payload.needId, 'demo-need-1');
  await lab.runtime.request('control', { play: true, rate: 1000 });
  await app.worker.once({ includeKinds: ['investigate'] });
  const researched = await store.get(org, 'activity', queuedResearch.id);
  await lab.runtime.request('control', { play: false });
  assert.equal(providerCalls, 3); assert.ok(researched.proposalId, JSON.stringify(researched));
  const proposal = await store.get(org, 'proposal', researched.proposalId);
  assert.equal(proposal.authorization, null, 'planning defaults never authorize a physical action');
  const foreign = await api(bCookie, '/demo/workspace/api/records?kind=proposal&id=' + proposal.id);
  assert.ok(foreign.response.status === 404 || foreign.data.length === 0, JSON.stringify(foreign.data));
  const approval = await api(aCookie, '/demo/workspace/api/review', { id: proposal.id, version: proposal.version, decision: 'approve' }, me.data.user.csrf, 'approve-demo-water');
  assert.equal(approval.response.status, 200, JSON.stringify(approval.data));
  const baseNow = (await lab.checkpoint()).now;
  for (let i = 0; i < 80; i++) {
    await app.worker.execute(proposal.id); const target = baseNow + (i + 1) * 15000; await lab.advance(target);
    for (let j = 0; j < 100; j++) { if ((await app.connector.state()).now >= target) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    await app.ingestion.sync({ sources: false });
    if ((await source.request('/api/demo/frame')).operations.some(o => o.org === org && o.received === 100)) break;
  }
  const final = await source.request('/api/demo/frame'), received = final.operations.find(o => o.org === org && o.received === 100);
  assert.ok(received, 'the same observer world contains the physically received 100 L contribution');
  assert.equal(final.organizations.find(o => o.id === org).name, 'Harbor Support');
  const base = gateway.apps.get('org0');
  await base.ingestion.sync({ sources: false });
  const baseActor = (await store.query("SELECT id,org,name,role FROM users WHERE org='org0' AND role='commander'")).rows[0];
  const deliverPeer = async from => { for (let i = 0; i < 50; i++) if (!(await from.worker.once({ includeKinds: ['peer_send'] }))) break; };
  async function shareBaseStock() {
    for (const [kind, id] of [['resource', 'r-org0-water'], ['vehicle', 'v-org0-0'], ['vehicle', 'v-org0-1']]) {
      const record = await store.get('org0', kind, id);
      await base.network.share(baseActor, { kind, id, to: org, version: record.version }, 'base-offer-' + kind + id + '-' + record.version);
    }
    await deliverPeer(base);
  }
  await shareBaseStock();
  const offers = await store.list(org, 'peer_offer', 100);
  assert.equal(offers.find(o => o.entityId === 'r-org0-water').projection.available, 100, 'the automated owner advertises its actual per-request limit');
  const partner = await app.domain.propose({ id: 'visitor-planner', org, role: 'agent' }, {
    title: 'A complementary base-team water contribution', summary: 'Ask the connected base owner for 50 L.', benefit: 'Another 50 L physically received.',
    rationale: 'Current signed capability offers and the remaining observed need. The base owner must independently review its step.',
    references: ['demo-need-1', ...offers.filter(o => ['r-org0-water', 'v-org0-0'].includes(o.entityId)).map(o => o.id)], conditions: [],
    actions: [{ type: 'dispatch', owner: 'org0', params: { need: 'demo-need-1', resource: 'r-org0-water', vehicle: 'v-org0-0', quantity: 50 }, dependsOn: [] }],
  }, 'visitor-partner-draft');
  const partnerApproval = await api(aCookie, '/demo/workspace/api/review', { id: partner.id, version: partner.version, decision: 'approve' }, me.data.user.csrf, 'visitor-partner-approve');
  assert.equal(partnerApproval.response.status, 200, JSON.stringify(partnerApproval.data));
  let targetClock = (await lab.checkpoint()).now, partnerReceipt;
  for (let i = 0; i < 80; i++) {
    await app.worker.execute(partner.id); await deliverPeer(app); await gateway.reviewBases();
    for (const p of (await store.list('org0', 'proposal', 100)).filter(p => ['authorized', 'executing', 'awaiting_partner'].includes(p.state))) await base.worker.execute(p.id);
    await deliverPeer(base); targetClock += 15000; await lab.advance(targetClock);
    for (let j = 0; j < 100; j++) { if ((await base.connector.state()).now >= targetClock) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    await base.ingestion.sync({ sources: false }); await app.ingestion.sync({ sources: false });
    partnerReceipt = (await source.request('/api/demo/frame')).operations.find(o => o.org === 'org0' && o.received === 50);
    if (partnerReceipt) break;
  }
  assert.ok(partnerReceipt, 'a signed visitor request is independently owner-reviewed and physically received from the base team');
  const mirror = (await store.list('org0', 'proposal', 100)).find(p => p.originProposal === partner.id);
  assert.match(mirror.authorization.name, /automated demo owner/);
  // A policy-exceeding request is rejected and its signed reply is queued,
  // rather than being left indefinitely awaiting an unavailable base operator.
  const rejectedId = 'partner_policy_fixture';
  await store.put('org0', 'proposal', rejectedId, { ...mirror, id: undefined, originProposal: 'policy-fixture-origin', state: 'awaiting_review', authorization: null,
    actions: [{ type: 'dispatch', owner: 'org0', params: { need: 'demo-need-1', resource: 'r-org0-water', vehicle: 'v-org0-1', quantity: 150 }, dependsOn: [] }], executionResults: [], simId: null }, 0);
  const policyResult = await reviewDemoBaseRequests(base, id => id === org);
  assert.ok(policyResult.some(r => r.id === rejectedId && r.state === 'rejected'));
  assert.equal((await store.get('org0', 'proposal', rejectedId)).authorization, null);
  assert.equal(baseDemoRequestAllowed(app, { ...mirror, actions: [{ type: 'dispatch', owner: org, params: { quantity: 1 } }] }), false, 'visitors never receive automated owner approval');
  await gateway.close(); gateway = await createDemoGateway(options);
  const recovered = await api(aCookie, '/demo/api/session'); assert.equal(recovered.data.organization.id, org);
  const restoredMe = await api(aCookie, '/demo/workspace/api/me'); assert.equal(restoredMe.data.user.org, org);
  assert.ok((await source.request('/api/demo/frame')).operations.some(o => o.id === received.id && o.received === 100));
  const serialized = JSON.stringify((await api(aCookie, '/demo/api/state')).data);
  assert.ok(!serialized.includes(lab.observerKey)); assert.ok(!serialized.includes('sourceAgentKey')); assert.ok(!serialized.includes('password'));
  // Lifecycle renewal happens only after the prior team is marked finished.
  // It creates a browser identity, never additional resources or organizations.
  await store.query("UPDATE demo_teams SET state='draining' WHERE org=$1", [org]);
  assert.equal((await api(aCookie, '/demo/api/session/renew', {}, a.data.csrf)).response.status, 409);
  await store.query("UPDATE demo_teams SET state='finished' WHERE org=$1", [org]);
  const organizationsBefore = (await source.request('/api/demo/frame')).organizations.length;
  assert.equal((await api(aCookie, '/demo/api/session/renew', {}, 'bad-csrf')).response.status, 403);
  const renewed = await api(aCookie, '/demo/api/session/renew', {}, a.data.csrf);
  assert.equal(renewed.response.status, 200); assert.equal(renewed.data.organization, null); assert.notEqual(renewed.data.csrf, a.data.csrf);
  assert.match(renewed.response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await source.request('/api/demo/frame')).organizations.length, organizationsBefore);
  assert.ok(await store.get(org, 'proposal', proposal.id), 'renewal preserves the old organization and contribution history');
});

test('global demo inference concurrency and durable cost allowance are bounded', async () => {
  const store = await Store.open();
  try {
    const gate = new DemoModelGate(store, { concurrency: 1, maxQueue: 2, hourlyUsd: 0.1, totalUsd: 0.2 });
    await gate.refresh(); const leave = await gate.enter(); let entered = false;
    const waiting = gate.enter().then(release => { entered = true; return release; });
    await Promise.resolve(); assert.equal(entered, false); assert.equal(gate.running, 1); leave(); const leave2 = await waiting; assert.equal(gate.running, 1); leave2(); assert.equal(gate.running, 0);
    const reservation = gate.reserve(0.08); assert.throws(() => gate.reserve(0.04), /allowance/); gate.settle(reservation, null);
    assert.throws(() => gate.reserve(0.03), /allowance/);
    assert.equal(gate.reserved.size, 0);
  } finally { await store.close(); }
});

test('demo source quota skips historic backfill and preserves held revisions without admitting more new sources', async () => {
  const store = await Store.open();
  try {
    await store.organization('visitor', 'Visitor'); let requests = 0;
    let posts = [{ id: 'post1', version: 1 }, { id: 'post2', version: 1 }, { id: 'post3', version: 1 }];
    const app = { connector: { feed: async () => { requests++; return { posts }; }, inbox: async () => ({ posts }) } };
    limitDemoSourceWindow(store, app, 'visitor', 2);
    assert.deepEqual((await app.connector.feed(100)).posts, []); assert.equal(requests, 0);
    const first = await app.connector.feed(); assert.deepEqual(first.posts.map(p => p.id), ['post1', 'post2']);
    for (const p of first.posts) await store.put('visitor', 'signal', p.id, p, 0);
    posts = [{ id: 'post1', version: 2, deleted: true }, { id: 'post3', version: 1 }];
    assert.deepEqual((await app.connector.feed()).posts, [posts[0]], 'a withdrawal is received even after the new-source allowance is exhausted');
    assert.deepEqual((await app.connector.inbox()).posts, [posts[0]]);
    assert.equal(app.demoSources.count, 2); assert.equal(app.demoSources.limited, true);
    assert.ok(await store.get('visitor', 'signal', 'post1'), 'retention never deletes an accepted citation');
  } finally { await store.close(); }
});

test('scoped source credentials renew before the seven-day TTL instead of expiring during a long demo', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 }); let calls = 0;
  const source = createDemoSource({ observerUrl: 'http://internal.test', sourceUrl: 'http://source.test', observerKey: 'private-observer',
    fetcher: async (url, init) => { assert.equal(new URL(url).pathname, '/api/actors/provision'); assert.equal(JSON.parse(init.body).ttlMs, 604800000); calls++;
      return new Response(JSON.stringify({ key: 'scoped-key-' + calls }), { headers: { 'Content-Type': 'application/json' } }); } });
  const first = await source.credentials('team-a'); assert.equal(calls, 2);
  assert.deepEqual(await source.credentials('team-a'), first); assert.equal(calls, 2);
  t.mock.timers.tick(7 * 86400000 - 11 * 3600000);
  const rotated = await source.credentials('team-a'); assert.equal(calls, 4); assert.notEqual(rotated.agent, first.agent);
  t.mock.timers.reset();
});
