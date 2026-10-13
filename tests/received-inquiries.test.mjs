import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { requestReceivedInquiry } from "../src/received-inquiries.mjs";
import { processSourceOpportunities, opportunityAdmission } from "../src/source-opportunities.mjs";

async function fixture(t) {
  const store = await Store.open(); t.after(() => store.close());
  await store.organization("org0");
  const places = Array.from({ length: 32 }, (_, i) => ({ id: "b" + i, name: "Site " + i }));
  await store.put("org0", "context", "geography", { map: { places, roads: [] } }, 0);
  await store.put("org0", "signal", "post", { text: places.map(p => p.id).join(" "), sourceVersion: 1 }, 0);
  const inspections = []; let calls = 0, failAfterEmission = false;
  const app = { store, config: { org: "org0" }, ingestion: { sync: async () => {} },
    connector: { state: async () => ({ runId: "run", now: 1000, inspections, known: {} }),
      action: async (type, params, key) => {
        assert.equal(type, "verify"); calls++;
        let row = inspections.find(r => r.id === key);
        if (!row) { row = { id: key, org: "org0", target: params.target, entity: params.id,
          method: params.method, purpose: params.purpose ?? "observation", state: "pending" }; inspections.push(row); }
        if (failAfterEmission) { failAfterEmission = false; const e = new Error("Socket closed after source emission"); e.code = "ECONNRESET"; throw e; }
        return row;
      } } };
  return { app, inspections, calls: () => calls, fail: () => { failAfterEmission = true; } };
}
const request = id => ({ target: "building", id, method: "clarification" });
const vague = i => ({ kind: "uncertainty", text: "Unverified report at b" + i, sourceIds: ["post"],
  location: "b" + i, entity: { kind: "building", id: "b" + i }, resourceType: null, quantity: null, timeStatus: "unknown" });

test("two lanes and restart share one exact owner inquiry; 20 repost polls do not create physical work", async t => {
  const f = await fixture(t);
  const results = await Promise.all([requestReceivedInquiry(f.app, request("b0")), requestReceivedInquiry(f.app, request("b0"))]);
  assert.equal(f.calls(), 1); assert.equal(results[0].id, results[1].id);
  const restarted = { ...f.app };
  for (let i = 0; i < 20; i++) assert.equal((await requestReceivedInquiry(restarted, request("b0"))).id, results[0].id);
  assert.equal(f.calls(), 1); assert.equal((await f.app.store.list("org0", "received_inquiry")).length, 1);
  await requestReceivedInquiry(f.app, { ...request("b0"), purpose: "facility_safety" });
  assert.equal(f.calls(), 2, "Safety and ordinary observation purposes must not be falsely deduplicated");
  f.inspections.push({ ...results[0], id: "other-owner", org: "org1", entity: "b1" });
  assert.notEqual((await requestReceivedInquiry(f.app, request("b1"))).id, "other-owner");
  await assert.rejects(requestReceivedInquiry(f.app, request("unknown")), { code: "INQUIRY_GROUNDING" });
});

test("ambiguous emission preserves durable failure; a received pending source request recovers without another command", async t => {
  const f = await fixture(t); f.fail();
  await assert.rejects(requestReceivedInquiry(f.app, request("b0")), { code: "ECONNRESET" });
  const ledger = (await f.app.store.list("org0", "received_inquiry"))[0];
  assert.equal(ledger.state, "requires_review"); assert.equal(ledger.lastError, "ECONNRESET");
  const actual = await requestReceivedInquiry({ ...f.app }, request("b0"));
  assert.equal(actual.id, f.inspections[0].id); assert.equal(actual.reused, true); assert.equal(f.calls(), 1);
  f.inspections.length = 0;
  const unknown = await requestReceivedInquiry(f.app, request("b0"));
  assert.equal(unknown.state, "requires_review"); assert.equal(f.calls(), 1);
});

test("explicit work takes finite clarification slots before 30 retained unknowns; later material reactivates at most two background checks", async t => {
  const f = await fixture(t); await requestReceivedInquiry(f.app, request("b0"));
  const first = await processSourceOpportunities(f.app, "unknowns", { observations: Array.from({ length: 30 }, (_, i) => vague(i + 1)) });
  assert.equal(f.calls(), 1); assert.equal(first.state, "waiting_context"); assert.equal(first.deferred.length, 30);
  assert.ok(first.opportunities.every(o => o.state === "deferred" && o.received === false));
  assert.equal((await f.app.store.list("org0", "need")).length, 0);
  f.inspections[0].state = "completed";
  const second = await processSourceOpportunities(f.app, "unknowns");
  assert.equal(f.calls(), 3); assert.equal(second.pending.length, 2); assert.equal(second.deferred.length, 28);
  assert.equal(second.attentionRequired, true);
  for (let i = 0; i < 5; i++) await processSourceOpportunities(f.app, "unknowns");
  assert.equal(f.calls(), 3);
  // A concrete later current need can make received capacity operational;
  // it changes admission, never writes stock or permission into the world.
  const capacity = { ...vague(31), kind: "capacity", quantity: 20, resourceType: "water", target: "building", entity: "b31" };
  assert.equal(opportunityAdmission(capacity).requestClass, "background");
  assert.equal(opportunityAdmission(capacity, { needs: [{ id: "n", type: "water", quantity: 20, served: 0 }] }).requestClass, "foreground");
  assert.equal(opportunityAdmission({ ...capacity, quantity: null }, { needs: [{ type: "water", quantity: 20 }] }).requestClass, "background");
  assert.equal(opportunityAdmission(capacity, { needs: [{ type: "water", quantity: 20, planningOutstanding: 0 }] }).requestClass, "background");
  const contextual = { ...vague(31), kind: "capacity", quantity: 20, resourceType: "water" };
  const held = await processSourceOpportunities(f.app, "later-capacity", { observations: [contextual] });
  assert.equal(held.deferred.length, 1); assert.equal(f.calls(), 3);
  await f.app.store.put("org0", "need", "new-current-need", { building: "b0", node: "b0", type: "water", quantity: 40, served: 0 }, 0);
  const relevant = await processSourceOpportunities(f.app, "later-capacity");
  assert.equal(relevant.opportunities[0].requestClass, "foreground"); assert.equal(f.calls(), 4);
  assert.equal((await f.app.store.get("org0", "need", "new-current-need")).served, 0);
  assert.equal((await f.app.store.list("org0", "proposal")).length, 0);
});

test("concurrent background admissions count durable issuing intents before remote acknowledgments", async t => {
  const f = await fixture(t), original = f.app.connector.action;
  let release; const barrier = new Promise(resolve => { release = resolve; });
  f.app.connector.action = async (...args) => { await barrier; return original(...args); };
  const a = requestReceivedInquiry(f.app, request("b1"), { requestClass: "background" }),
    b = requestReceivedInquiry(f.app, request("b2"), { requestClass: "background" }),
    c = requestReceivedInquiry(f.app, request("b3"), { requestClass: "background" });
  const deferred = await c;
  assert.equal(deferred.admission, "deferred"); assert.equal(f.calls(), 0);
  assert.equal((await f.app.store.list("org0", "received_inquiry")).length, 2);
  release(); await Promise.all([a, b]); assert.equal(f.calls(), 2);
});

test("conflicting observations of one received entity remain distinct while their physical inquiry is shared", async t => {
  const f = await fixture(t);
  await f.app.store.put("org0", "signal", "correction", { text: "Current correction about b1", sourceVersion: 1 }, 0);
  const observations = [vague(1), { ...vague(1), kind: "correction", text: "The earlier claim at b1 is contradicted", sourceIds: ["correction"] }];
  const result = await processSourceOpportunities(f.app, "conflict", { observations });
  assert.equal(result.opportunities.length, 2);
  assert.deepEqual(result.opportunities.map(o => [o.kind, o.text, o.sourceIds]), observations.map(o => [o.kind, o.text, o.sourceIds]));
  assert.equal(result.opportunities[0].id, result.opportunities[1].id);
  assert.equal(f.calls(), 1);
  assert.equal((await f.app.store.list("org0", "need")).length, 0);
  assert.equal((await f.app.store.get("org0", "source_opportunity", "conflict")).opportunities.length, 2);
});
