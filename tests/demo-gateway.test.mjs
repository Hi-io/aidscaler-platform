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
  const originalQuery = store.query.bind(store); let databaseOffline = true;
  store.query = async (sql, values) => { if (databaseOffline && sql === 'SELECT 1 AS ready') throw Object.assign(Error('private connection details must not be returned'), { code: 'ECONNRESET' }); return originalQuery(sql, values); };
  const dbReadiness = await fetch(gateway.url + '/demo/api/health');
  assert.equal(dbReadiness.status, 503); assert.equal((await dbReadiness.json()).error, 'DEMO_DATABASE');
  assert.equal((await fetch(gateway.url + '/healthz')).status, 200, 'storage outages do not declare the simulation process dead');
  databaseOffline = false; assert.equal((await fetch(gateway.url + '/demo/api/health')).status, 200);
  store.query = originalQuery;
  const api = async (cookie, route, data, csrf, key = 'test-demo-command') => {
    const r = await fetch(gateway.url + route, { method: data ? 'POST' : 'GET', headers: { ...(cookie ? { cookie } : {}), ...(data ? { Origin: 'http://demo.test', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': key } : {}) }, body: data ? JSON.stringify(data) : undefined });
    const result = await r.json(); return { response: r, data: result };
  };
  const a = await api(null, '/demo/api/session'); const aCookie = a.response.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(a.data.summary, { pendingDecisions: 0, needsRecheck: 0, activeOperations: 0, completedOperations: 0, blockedOperations: 0, canReview: false });
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
  const bMe = await api(bCookie, '/demo/workspace/api/me');
  assert.equal((await api(aCookie, '/demo/workspace/api/users')).response.status, 403);
  assert.equal((await api(aCookie, '/demo/workspace/api/organization', { name: 'Bad configuration' }, me.data.user.csrf)).response.status, 403);
  for (const route of ['/api/automation', '/api/resource', '/api/integration/configure'])
    assert.equal((await api(aCookie, '/demo/workspace' + route, { enabled: true }, me.data.user.csrf, 'blocked-admin-' + route)).response.status, 403, route);
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
  const priorities = { version: policy.version, order: 'deadline_then_priority', protectedTypes: ['water'], maxOpenReviews: 4,
    investigationCooldownMs: 60000, reason: 'Prioritize useful arrival windows in this response.' };
  assert.equal((await api(aCookie, '/demo/workspace/api/response-policy', priorities, 'wrong', 'priorities-bad-csrf')).response.status, 403);
  assert.equal((await api(aCookie, '/demo/workspace/api/response-policy', { ...priorities, maxOpenReviews: 100 }, me.data.user.csrf, 'priorities-unbounded')).response.status, 400);
  const chosenPolicy = await api(aCookie, '/demo/workspace/api/response-policy', priorities, me.data.user.csrf, 'priorities-own-version');
  assert.equal(chosenPolicy.response.status, 200, JSON.stringify(chosenPolicy.data));
  assert.equal((await store.get(bj.data.organization.id, 'response_policy', 'active')).order, 'priority_then_deadline', 'one team cannot change a partner’s planning mandate');
  const queuedResearch = (await store.query("SELECT id,payload FROM jobs WHERE org=$1 AND kind='investigate' AND state='queued' ORDER BY created_at LIMIT 1", [org])).rows[0];
  assert.ok(queuedResearch, 'ordinary source ingestion queues a focused AI investigation automatically');
  assert.equal(queuedResearch.payload.needId, 'demo-need-1');
  await lab.runtime.request('control', { play: true, rate: 1000 });
  await app.worker.once({ includeKinds: ['investigate'] });
  const researched = await store.get(org, 'activity', queuedResearch.id);
  await lab.runtime.request('control', { play: false });
  assert.equal(providerCalls, 3); assert.ok(researched.proposalId, JSON.stringify(researched));
  let proposal = await store.get(org, 'proposal', researched.proposalId);
  assert.equal(proposal.authorization, null, 'planning defaults never authorize a physical action');
  const foreign = await api(bCookie, '/demo/workspace/api/records?kind=proposal&id=' + proposal.id);
  assert.ok(foreign.response.status === 404 || foreign.data.length === 0, JSON.stringify(foreign.data));
  const summary = (await api(aCookie, '/demo/api/session')).data.summary;
  assert.equal(summary.pendingDecisions, 1); assert.equal(summary.canReview, true);
  assert.equal((await api(bCookie, '/demo/api/session')).data.summary.pendingDecisions, 0, 'private pending counts are tenant scoped');
  const review = (cookie, csrf, input, key) => api(cookie, '/demo/workspace/api/review', { id: proposal.id, version: proposal.version, ...input }, csrf, key);
  assert.equal((await review(aCookie, 'wrong', { decision: 'approve' }, 'approval-wrong-csrf')).response.status, 403);
  assert.equal((await review(bCookie, bMe.data.user.csrf, { decision: 'approve' }, 'approval-wrong-owner')).response.status, 404);
  assert.equal((await review(aCookie, me.data.user.csrf, { decision: 'approve', version: proposal.version - 1 }, 'approval-stale-version')).response.status, 409);
  const clarification = await review(aCookie, me.data.user.csrf, { decision: 'clarify', note: 'Check the current vehicle availability before dispatch.' }, 'clarify-own-proposal');
  assert.equal(clarification.response.status, 200); proposal = clarification.data;
  const draft = Object.fromEntries(['title', 'summary', 'benefit', 'references', 'conditions', 'alternatives', 'actions', 'priority', 'rationale'].map(k => [k, proposal[k]]));
  const revise = async (conditions, key) => {
    const result = await api(aCookie, '/demo/workspace/api/proposal/revise', { id: proposal.id, ...draft, conditions,
      version: proposal.version, note: 'Revised after owner review; preserve the exact reported water quantity.' }, me.data.user.csrf, key);
    assert.equal(result.response.status, 200, JSON.stringify(result.data)); proposal = result.data;
  };
  await revise([{ type: 'evidence', id: 'not-yet-received-confirmation', description: 'Current confirmation is still required.', satisfied: true }], 'revise-with-unconfirmed-condition');
  const pending = await review(aCookie, me.data.user.csrf, { decision: 'approve' }, 'approval-unmet-condition');
  assert.equal(pending.response.status, 400); assert.equal(pending.data.error, 'PENDING_CONDITIONS', 'a visitor cannot self-certify evidence by sending satisfied:true');
  const conditional = await review(aCookie, me.data.user.csrf, { decision: 'approve', allowConditional: true }, 'approval-conditional-only');
  assert.equal(conditional.response.status, 200); proposal = conditional.data;
  assert.equal(proposal.state, 'conditionally_authorized');
  assert.equal((await source.request('/api/demo/frame')).operations.filter(o => o.org === org).length, 0, 'conditional review alone never issues a delivery');
  await revise([], 'revise-before-physical-issue');
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
  const completedSummary = (await api(aCookie, '/demo/api/session')).data.summary;
  assert.equal(completedSummary.pendingDecisions, 0); assert.equal(completedSummary.completedOperations, 1);
  // The visitor is a real scoped operational owner, not a read-only tour.
  const fieldReport = await api(aCookie, '/demo/workspace/api/report', { clientId: 'own-field-observation', kind: 'receipt',
    text: 'The team observed supplies at the receiving site; this report is not a source receipt.', location: 'Receiving shelter',
    observedAt: Math.floor(baseNow), references: [received.id], quantity: 100, unit: 'L' }, me.data.user.csrf, 'own-field-observation');
  assert.equal(fieldReport.response.status, 201, JSON.stringify(fieldReport.data));
  const assignment = await api(aCookie, '/demo/workspace/api/task/assign', { operation: received.id, assignee: me.data.user.id,
    instructions: 'Check the receiving team’s recorded handover.', contact: 'Response team' }, me.data.user.csrf, 'assign-owned-physical-operation');
  assert.equal(assignment.response.status, 201, JSON.stringify(assignment.data));
  const acknowledged = await api(aCookie, '/demo/workspace/api/task/update', { id: assignment.data.id, version: assignment.data.version,
    stage: 'acknowledged', note: 'The assigned team has read the instructions.' }, me.data.user.csrf, 'ack-own-assignment');
  assert.equal(acknowledged.response.status, 200, JSON.stringify(acknowledged.data));
  const stockToShare = await store.get(org, 'resource', `r-${org}-water`);
  const shared = await api(aCookie, '/demo/workspace/api/share', { kind: 'resource', id: stockToShare.id, version: stockToShare.version,
    to: bj.data.organization.id }, me.data.user.csrf, 'share-real-owned-capability');
  assert.equal(shared.response.status, 202, JSON.stringify(shared.data));
  const publicDraft = await api(aCookie, '/demo/workspace/api/publication/draft', { title: 'Drinking water received',
    text: 'The receiving site has a confirmed delivery of 100 litres of drinking water.', area: 'Response area',
    status: 'received', operationIds: [received.id] }, me.data.user.csrf, 'draft-confirmed-demo-update');
  assert.equal(publicDraft.response.status, 201, JSON.stringify(publicDraft.data));
  const published = await api(aCookie, '/demo/workspace/api/publication/publish', { id: publicDraft.data.id, version: publicDraft.data.version },
    me.data.user.csrf, 'publish-confirmed-demo-update');
  assert.equal(published.response.status, 200, JSON.stringify(published.data));
  const rejectedDraft = await api(aCookie, '/demo/workspace/api/propose', { ...draft, title: 'An optional additional water contribution', conditions: [],
    actions: [{ ...draft.actions[0], params: { ...draft.actions[0].params, quantity: 10 } }] }, me.data.user.csrf, 'optional-own-draft');
  assert.equal(rejectedDraft.response.status, 201, JSON.stringify(rejectedDraft.data));
  const declined = await api(aCookie, '/demo/workspace/api/review', { id: rejectedDraft.data.id, version: rejectedDraft.data.version,
    decision: 'reject', note: 'Keep this capacity available for the next need.' }, me.data.user.csrf, 'reject-own-draft');
  assert.equal(declined.response.status, 200); assert.equal(declined.data.state, 'rejected');
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
  const retiredBase = gateway.apps.get('org0'); let staleShares = 0;
  const originalShare = retiredBase.network.share.bind(retiredBase.network);
  retiredBase.network.share = (...args) => { staleShares++; return originalShare(...args); };
  const baseConnection = await store.get('org0', 'source_connection', 'simulator');
  await store.upsert('org0', 'source_connection', 'simulator', { ...baseConnection, state: 'requires_new_response', reason: 'source_instance_changed' });
  await gateway.maintenance();
  assert.equal(staleShares, 0, 'a fenced base never republishes obsolete capability records to live participants');
  const connection = await store.get(org, 'source_connection', 'simulator');
  await store.upsert(org, 'source_connection', 'simulator', { ...connection, state: 'requires_new_response', reason: 'source_instance_changed' });
  assert.equal((await api(aCookie, '/demo/api/session')).data.summary.canReview, false, 'a retained historic workspace cannot advertise new approvals');
  assert.equal((await api(aCookie, '/demo/workspace/api/propose', draft, restoredMe.data.user.csrf, 'blocked-source-boundary')).response.status, 409);
  // End is an explicit scoped user action. Source-fenced historical plans are
  // not unlocked; physical retirement still passes the simulator's checks.
  assert.equal((await api(aCookie, '/demo/api/session/end', {}, 'bad-csrf')).response.status, 403);
  const ended = await api(aCookie, '/demo/api/session/end', { org: bj.data.organization.id }, a.data.csrf);
  assert.equal(ended.response.status, 200); assert.equal(ended.data.organization.state, 'draining');
  assert.equal((await store.query('SELECT state FROM demo_teams WHERE org=$1', [bj.data.organization.id])).rows[0].state, 'active', 'a supplied partner ID cannot select another session');
  for (let i = 0; i < 100; i++) { await gateway.maintenance(); if ((await api(aCookie, '/demo/api/session')).data.organization.state === 'finished') break; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal((await api(aCookie, '/demo/api/session/end', {}, a.data.csrf)).data.organization.state, 'finished', 'ending an already finished session is idempotent');
  assert.ok(await store.get(org, 'proposal', proposal.id));
  // A second team ends during a real physical trip. Its old source-boundary
  // authorization remains in history and must not hold a retired slot forever.
  const bOrg = bj.data.organization.id, bApp = gateway.apps.get(bOrg);
  await bApp.ingestion.sync({ sources: false });
  const bNeed = (await store.list(bOrg, 'need', 100)).find(n => n.id === 'demo-need-1');
  assert.ok(bNeed);
  const bDraft = await api(bCookie, '/demo/workspace/api/propose', { ...draft, title: 'A separate team water contribution', conditions: [],
    references: [bNeed.id, `r-${bOrg}-water`, `v-${bOrg}-0`], actions: [{ type: 'dispatch', owner: bOrg,
      params: { need: bNeed.id, resource: `r-${bOrg}-water`, vehicle: `v-${bOrg}-0`, quantity: 50 }, dependsOn: [] }] }, bMe.data.user.csrf, 'b-before-session-end');
  assert.equal(bDraft.response.status, 201, JSON.stringify(bDraft.data));
  const bApproved = await api(bCookie, '/demo/workspace/api/review', { id: bDraft.data.id, version: bDraft.data.version, decision: 'approve' }, bMe.data.user.csrf, 'b-owner-before-session-end');
  assert.equal(bApproved.response.status, 200, JSON.stringify(bApproved.data));
  let endClock = (await lab.checkpoint()).now, endingTrip;
  for (let i = 0; i < 50; i++) {
    await bApp.worker.execute(bDraft.data.id); endClock += 1000; await lab.advance(endClock);
    await new Promise(resolve => setTimeout(resolve, 20));
    endingTrip = (await source.request('/api/demo/frame')).operations.find(o => o.org === bOrg);
    if (endingTrip) break;
  }
  assert.ok(endingTrip); assert.ok(!['completed', 'received', 'service'].includes(endingTrip.state), 'the team ends before the physical trip is received');
  const proposalAtEnd = await store.get(bOrg, 'proposal', bDraft.data.id);
  await store.upsert(bOrg, 'source_connection', 'simulator', { state: 'requires_new_response', reason: 'source_instance_changed' });
  const endingB = await api(bCookie, '/demo/api/session/end', {}, b.data.csrf);
  assert.equal(endingB.response.status, 200); assert.equal(endingB.data.organization.state, 'draining');
  await gateway.maintenance();
  assert.equal((await api(bCookie, '/demo/api/session')).data.organization.state, 'draining', 'retirement cannot discard an active physical trip');
  assert.equal((await api(bCookie, '/demo/api/session/renew', {}, b.data.csrf)).response.status, 409);
  assert.equal((await api(bCookie, '/demo/workspace/api/me')).response.status, 401);
  for (let i = 0; i < 100; i++) {
    endClock += 15000; await lab.advance(endClock); await gateway.maintenance();
    if ((await api(bCookie, '/demo/api/session')).data.organization.state === 'finished') break;
  }
  assert.equal((await api(bCookie, '/demo/api/session')).data.organization.state, 'finished');
  const endedTrip = (await lab.checkpoint()).state.operations.find(o => o.id === endingTrip.id);
  assert.equal(endedTrip.received, 50, 'the same trip completes after its participant leaves: ' + JSON.stringify(endedTrip));
  assert.deepEqual(await store.get(bOrg, 'proposal', bDraft.data.id), proposalAtEnd, 'a historic authorization and its issued-work receipts were neither executed again nor erased to retire the slot');
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
