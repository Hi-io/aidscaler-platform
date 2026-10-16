import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { CommunityFollowup } from "../src/community-followup.mjs";
import { Organization, defaultPortal } from "../src/organization.mjs";
import { createPlatform } from "../server.mjs";

const analyst = { org: "org0", id: "a", role: "analyst" }, token = "private_report_key_12345678901234567890";
async function setup(t) {
  const store = await Store.open(); t.after(() => store.close());
  await store.organization("org0"); await store.organization("org1");
  const report = await store.put("org0", "report", "r1", { origin: "community-public", state: "pending_moderation", receivedAt: 100, text: "Private original text", location: "Private original location" }, 0);
  return { store, report, follow: new CommunityFollowup(store, { org: "org0" }) };
}
test("private report tracking stores only a hash and never discloses original details or another organization's report", async t => {
  const { store, report, follow } = await setup(t);
  assert.equal(await follow.attach(report, token), token);
  const saved = await store.get("org0", "community_tracking", report.id);
  assert.ok(saved.tokenHash); assert.ok(!JSON.stringify(saved).includes(token));
  const status = await follow.track(token);
  assert.equal(status.state, "received");
  assert.ok(!JSON.stringify(status).includes("Private original"));
  await assert.rejects(follow.track("r1"));
  await assert.rejects(follow.track(token + "wrong"));
  await assert.rejects(new CommunityFollowup(store, { org: "org1" }).track(token));
  assert.equal(await follow.attach(report, token), token);
  assert.equal(await follow.attach(report), undefined, "legacy retry does not recover a private key from a report id");
  await assert.rejects(follow.attach(report, token + "other"));
});
test("progress requires staff authority; operational stages require a current source-confirmed operation", async t => {
  const { store, report, follow } = await setup(t); await follow.attach(report, token);
  const input = { id: report.id, version: 0, note: "Our team is checking the reported water need." };
  await assert.rejects(follow.update({ ...analyst, role: "field" }, input, "no-role"), e => e.code === "FORBIDDEN");
  await assert.rejects(follow.update({ ...analyst, org: "org1" }, input, "no-owner"));
  await follow.update(analyst, input, "progress");
  let current = await follow.track(token); assert.equal(current.state, "received"); assert.equal(current.events.at(-1).state, "team_update");
  await store.put("org0", "operation", "o1", { type: "delivery", state: "en_route", quantity: 200, times: {}, confirmedBySource: false }, 0);
  await assert.rejects(follow.update(analyst, { ...input, version: 1, operation: "o1" }, "not-confirmed"));
  await store.upsert("org0", "operation", "o1", { confirmedBySource: true });
  await follow.update(analyst, { ...input, version: 1, operation: "o1" }, "link-response");
  current = await follow.track(token); assert.equal(current.state, "aid_on_way");
  await store.upsert("org0", "operation", "o1", { state: "completed", received: 0, times: {} });
  current = await follow.track(token); assert.notEqual(current.state, "supplies_received", "completion alone is not a quantity receipt");
  await store.upsert("org0", "operation", "o1", { state: "received", received: 200, times: { received: 500 } });
  current = await follow.track(token); assert.equal(current.state, "supplies_received");
  assert.ok(!JSON.stringify(current).includes("o1"));
  await store.upsert("org0", "operation", "o1", { state: "blocked", received: 0, times: {} });
  assert.equal((await follow.track(token)).state, "response_changed");
  await assert.rejects(follow.update(analyst, { ...input, version: 1 }, "stale-version"));
});
test("organization-owned public branding is versioned, role-checked, validated and has no private profile fields", async t => {
  const { store } = await setup(t), service = new Organization(store, { orgName: "Relief North" });
  const data = { name: "Relief North", response: "Regional flood response", coordinator: "Private coordinator", zones: ["Private zone"], retentionDays: 30, version: 0, portal: { ...defaultPortal("Relief North"), title: "Relief North: we respond together", accent: "#466765" } };
  await assert.rejects(service.configure(analyst, data, "no-config"));
  const saved = await service.configure({ ...analyst, role: "admin" }, data, "configure");
  const p = await service.publicProfile("org0"); assert.equal(p.portal.title, data.portal.title);
  assert.ok(!JSON.stringify(p).includes("Private coordinator")); assert.ok(!JSON.stringify(p).includes("Private zone"));
  await assert.rejects(service.configure({ ...analyst, role: "admin" }, { ...data, version: saved.version, portal: { ...data.portal, bannerDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" } }, "bad-svg"));
  await assert.rejects(service.configure({ ...analyst, role: "admin" }, { ...data, version: saved.version, portal: { ...data.portal, bannerDataUrl: "data:image/png;base64,YWJj" } }, "bad-file"));
  await assert.rejects(service.configure({ ...analyst, role: "admin" }, { ...data, version: saved.version, portal: { ...data.portal, accent: "red; display:none" } }, "bad-style"));
  const { portal, ...legacy } = data;
  await service.configure({ ...analyst, role: "admin" }, { ...legacy, version: saved.version }, "legacy-config");
  assert.equal((await service.publicProfile("org0")).portal.title, portal.title, "older profile form preserves existing branding");
});
test("anonymous reports receive a private tracking key while progress updates require authenticated CSRF scope", async t => {
  const store = await Store.open(), app = await createPlatform({ port: 0, org: "org0", store, startWorker: false, autoIngest: false, writeAccessFile: false, bootstrapPassword: "local-test-password-12345" });
  t.after(async () => { await app.close(); await store.close(); });
  const post = (route, payload, headers = {}) => fetch(app.url + route, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
  const payload = { clientId: "public-test-report", trackingToken: token, text: "We need drinking water.", location: "Maple district", observedAt: 1 };
  const response = await post("/api/community/report", payload); assert.equal(response.status, 201);
  assert.equal((await response.json()).trackingToken, token);
  assert.equal((await (await post("/api/community/track", { token })).json()).state, "received");
  assert.equal((await post("/api/report/followup", { id: payload.clientId, version: 0, note: "A team is checking." })).status, 401);
  assert.equal((await fetch(app.url + "/api/community/track?token=" + token)).status, 405);
  const publicBody = await (await fetch(app.url + "/api/public")).json();
  assert.equal(publicBody.organization.name, "Relief North"); assert.ok(publicBody.organization.portal.title);
  assert.ok(!JSON.stringify(publicBody).includes("We need drinking water"));
  assert.match((await fetch(app.url + "/community")).headers.get("permissions-policy"), /geolocation=\(self\)/);
});
