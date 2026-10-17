import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { createPlatform } from "../server.mjs";

test("workspaces on different localhost ports retain independent sessions, CSRF, logout and restart identity", async t => {
  const stores = [], apps = [], password = "instance-cookie-test-password";
  const options = { port: 0, autoIngest: false, startWorker: false, writeAccessFile: false, bootstrapPassword: password,
    provider: { complete() { throw new Error("Model calls are disabled in cookie verification"); } } };
  t.after(async () => { for (const app of apps) await app?.close(); for (const store of stores) await store.close(); });
  for (const org of ["org0", "org1", "org0"]) {
    const store = await Store.open(); stores.push(store);
    apps.push(await createPlatform({ ...options, store, org, orgName: "Independent response" }));
  }
  const sessions = [];
  for (const [i, app] of apps.entries()) {
    const response = await fetch(app.url + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `commander@${i === 1 ? "org1" : "org0"}.aidscaler.local`, password }) });
    assert.equal(response.status, 200);
    const header = response.headers.get("set-cookie"), cookie = header.split(";")[0];
    assert.match(header, /^aidscaler_[a-f0-9]{20}=/); assert.match(header, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800/);
    sessions.push({ cookie, name: cookie.split("=")[0], ...(await response.json()) });
  }
  assert.equal(new Set(sessions.map(session => session.name)).size, 3, "even QA and live instances with the same org use distinct cookies");
  const jar = sessions.map(session => session.cookie).join("; ");
  const me = (app, cookie = jar) => fetch(app.url + "/api/me", { headers: { cookie } });
  for (const [i, app] of apps.entries()) {
    const response = await me(app); assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, sessions[i].user.id);
  }
  const wrongCsrf = await fetch(apps[0].url + "/api/logout", { method: "POST", headers: { cookie: jar, "Content-Type": "application/json", "X-CSRF-Token": sessions[1].csrf }, body: "{}" });
  assert.equal(wrongCsrf.status, 403);
  const ownLogout = await fetch(apps[0].url + "/api/logout", { method: "POST", headers: { cookie: jar, "Content-Type": "application/json", "X-CSRF-Token": sessions[0].csrf }, body: "{}" });
  assert.equal(ownLogout.status, 200);
  assert.equal(ownLogout.headers.getSetCookie().length, 1);
  assert.ok(ownLogout.headers.get("set-cookie").startsWith(sessions[0].name + "=;"));
  assert.equal((await me(apps[0])).status, 401);
  assert.equal((await me(apps[1])).status, 200); assert.equal((await me(apps[2])).status, 200);

  const legacy = await apps[0].auth.login("commander@org0.aidscaler.local", password);
  const migrated = await me(apps[0], "aidscaler=" + legacy.token);
  assert.equal(migrated.status, 200);
  assert.ok(migrated.headers.get("set-cookie").startsWith(sessions[0].name + "=" + legacy.token));
  const badScoped = await me(apps[0], sessions[0].name + "=revoked; aidscaler=" + legacy.token);
  assert.equal(badScoped.status, 401, "a scoped invalid token cannot fall back to a legacy cookie");
  const foreignLegacyLogout = await fetch(apps[1].url + "/api/logout", { method: "POST", headers: { cookie: jar + "; aidscaler=" + legacy.token, "Content-Type": "application/json", "X-CSRF-Token": sessions[1].csrf }, body: "{}" });
  assert.equal(foreignLegacyLogout.status, 200);
  assert.equal(foreignLegacyLogout.headers.getSetCookie().length, 1, "another port's legacy session is not revoked or cleared");
  assert.equal((await me(apps[0], "aidscaler=" + legacy.token)).status, 200);

  const port = Number(new URL(apps[0].url).port);
  await apps[0].close(); apps[0] = null;
  apps[0] = await createPlatform({ ...options, port, org: "org0", store: stores[0] });
  const resumed = await me(apps[0], sessions[0].name + "=" + legacy.token);
  assert.equal(resumed.status, 200, "the same persisted org/port retains its session after restart");
  const legacyLogout = await fetch(apps[0].url + "/api/logout", { method: "POST", headers: { cookie: sessions[0].name + "=" + legacy.token + "; aidscaler=" + legacy.token, "Content-Type": "application/json", "X-CSRF-Token": legacy.csrf }, body: "{}" });
  assert.equal(legacyLogout.status, 200);
  assert.equal(legacyLogout.headers.getSetCookie().length, 2);
  assert.equal((await me(apps[0], "aidscaler=" + legacy.token)).status, 401);
  assert.equal((await me(apps[2])).status, 200);
});
