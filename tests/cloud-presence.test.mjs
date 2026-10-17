import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, hash } from '../src/store.mjs';
import { createDemoGateway } from '../src/demo-gateway.mjs';
test('managed demo polling and probes do not renew presence; validated visible heartbeats do', async t => {
  const store = await Store.open(); let gateway, touches = 0;
  t.after(async () => { await gateway?.close(); await store.close(); });
  const frame = { episodeId: 'presence-fixture', organizations: [], needs: [], clock: { time: 0 } };
  const source = { request: async () => ({ ...frame, frame }), baseOrganizations: [] };
  gateway = await createDemoGateway({ store, source, secret: 'fixture-private-'.repeat(4), dataDir: '.local/tests-presence',
    port: 0, origin: 'http://demo.test', startBase: false, managed: { touch: async () => { touches++; return { sleeping: false }; } } });
  const sessionResponse = await fetch(gateway.url + '/demo/api/session');
  const session = await sessionResponse.json(), cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
  const clientHash = hash(cookie.split('=')[1]);
  await store.query("INSERT INTO demo_teams VALUES('test-org',$1,'Harbor Team','purple','active','join-fixture',1,1,'{}')", [clientHash]);
  await fetch(gateway.url + '/demo/api/session', { headers: { cookie } });
  await fetch(gateway.url + '/healthz');
  assert.equal(Number((await store.query("SELECT last_seen FROM demo_teams WHERE org='test-org'")).rows[0].last_seen), 1);
  const options = { method: 'POST', headers: { cookie, Origin: 'http://demo.test', 'Content-Type': 'application/json',
    'X-CSRF-Token': session.csrf }, body: '{"visible":false}' };
  assert.equal((await fetch(gateway.url + '/demo/api/presence', options)).status, 400);
  assert.equal(touches, 0);
  options.body = '{"visible":true}';
  assert.equal((await fetch(gateway.url + '/demo/api/presence', options)).status, 200);
  assert.equal(touches, 1);
  assert.ok(Number((await store.query("SELECT last_seen FROM demo_teams WHERE org='test-org'")).rows[0].last_seen) > 1);
});
