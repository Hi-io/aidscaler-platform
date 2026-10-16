import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.mjs";
import { Coverage } from "../src/coverage.mjs";
import { Auth } from "../src/auth.mjs";
import { AppError } from "../src/errors.mjs";

async function fixture(t, { dataDir } = {}) {
  const store = await Store.open({ dataDir });
  t.after(() => store.db.closed ? undefined : store.close());
  await store.organization("org0");
  const actor = await new Auth(store).create(null, { org: "org0", role: "commander", name: "Coverage owner",
    email: "coverage@org0.test", password: "local-test-password" });
  let snapshot = { runId: "source-run", now: 1000, known: { lastContact: {}, needs: {}, buildings: {
    a: { id: "a", version: 1, at: 1000 }, b: { id: "b", version: 1, at: 1000 } } }, inspections: [] },
    dto = { version: 1, observedAt: 1000, contacts: [], buildingContacts: [], scope: "received" };
  const calls = [], emitted = new Map(), connector = { action: async (type, params, key, options) => {
    calls.push({ type, params, key, options });
    if (type === "coverage") return structuredClone(dto);
    if (!emitted.has(key)) emitted.set(key, { id: "inspection-" + (emitted.size + 1), org: "org0",
      target: "building", entity: params.id, method: params.method, purpose: params.purpose, state: "clarification_pending" });
    return structuredClone(emitted.get(key));
  } };
  await store.upsert("org0", "context", "geography", { map: { places: [
    { id: "a", node: "n0", sector: "s0" }, { id: "b", node: "n1", sector: "s0" }, { id: "c", node: "n2", sector: "s1" } ] } });
  const receive = async update => { snapshot = { ...snapshot, ...update }; await store.upsert("org0", "context", "operational", { snapshot }); };
  await receive({});
  const coverage = new Coverage(store, connector, { org: "org0" });
  const policy = await coverage.configure(actor, { version: 0, placeIds: ["a", "b", "c"],
    staleAfterMs: 60000, maxActive: 1, maxPerBatch: 5, maxWaitMs: 300000, cooldownMs: 60000,
    allowedMethods: ["clarification"], reason: "Check received directory for missing contact" }, "initial-policy");
  let requestSequence = 0;
  const request = async (buildings, extra = {}) => coverage.request(actor, {
    policyVersion: policy.version, coverageVersion: (await coverage.summary()).version,
    checks: buildings.map(building => ({ building, method: "clarification" })), ...extra,
  }, "request-" + (++requestSequence));
  const completed = (inspection, { observedAt = 2000, version = 1, result = true } = {}) => ({ ...inspection,
    state: result ? "completed" : "inconclusive", confirmedBySource: true, observedAt,
    result: result ? { id: inspection.entity, version } : null });
  return { store, actor, coverage, connector, calls, emitted, receive, request, completed, policy,
    snapshot: () => snapshot, setDto: v => { dto = v; } };
}

test("sector contact and static building metadata cannot hide a different uncontacted building", async t => {
  const f = await fixture(t);
  f.setDto({ version: 2, observedAt: 1000, contacts: [{ sector: "s0", lastContactAt: 900 }],
    buildingContacts: [{ building: "a", sector: "s0", lastContactAt: 800, receivedAt: 900 }], scope: "received" });
  await f.coverage.sync();
  let d = await f.coverage.summary();
  assert.equal(d.rows.find(r => r.id === "a").state, "contact_confirmed");
  assert.equal(d.rows.find(r => r.id === "b").state, "unknown");
  assert.equal(d.rows.find(r => r.id === "b").sectorLastContactAt, 900);
  assert.equal(d.rows.find(r => r.id === "c").state, "unknown");
  await f.receive({ now: 70000 }); d = await f.coverage.summary();
  assert.equal(d.rows.find(r => r.id === "a").state, "stale");
  assert.equal((await f.store.list("org0", "need")).length, 0, "Contact coverage must never manufacture demand");
});

test("an exact finite approved batch uses one active source queue slot and never credits an acknowledgement", async t => {
  const f = await fixture(t), row = await f.request(["a", "b"]);
  assert.equal(f.calls.length, 0, "Approval is durable before any source command");
  await f.coverage.sync();
  let r = await f.store.get("org0", "coverage_request", row.id);
  assert.deepEqual(r.checks.map(k => k.state), ["checking", "queued"]);
  assert.equal((await f.coverage.summary()).rows.find(r => r.id === "a").lastContactAt, null);
  for (let i = 0; i < 20; i++) await f.coverage.sync();
  assert.equal(f.calls.filter(c => c.type === "verify").length, 1);
  const a = [...f.emitted.values()][0];
  await f.receive({ now: 2000, inspections: [f.completed(a)] }); await f.coverage.sync();
  r = await f.store.get("org0", "coverage_request", row.id);
  assert.deepEqual(r.checks.map(k => k.state), ["contact_confirmed", "checking"]);
  assert.equal(f.calls.filter(c => c.type === "verify").length, 2);
  assert.equal((await f.store.list("org0", "need")).length, 0, "A contact without a need cannot become an aid request");
});

test("unknown, unpermitted, changed-version and duplicate checks are refused before source emission", async t => {
  const f = await fixture(t);
  await assert.rejects(f.request(["not-in-directory"]), e => e.code === "COVERAGE_SCOPE");
  await assert.rejects(f.request(["a"], { checks: [{ building: "a", method: "radio" }] }), e => e.code === "COVERAGE_CHANNEL");
  await assert.rejects(f.request(["a"], { coverageVersion: "stale" }), e => e.code === "COVERAGE_CHANGED");
  await assert.rejects(f.request(["a", "a"]), e => e.code === "COVERAGE_DUPLICATE");
  await assert.rejects(f.coverage.request({ ...f.actor, role: "agent" }, {
    policyVersion: 1, coverageVersion: (await f.coverage.summary()).version, checks: [{ building: "a", method: "clarification" }] }, "agent"), e => e.status === 403);
  await f.request(["a"]);
  await assert.rejects(f.request(["a"]), e => e.code === "COVERAGE_PENDING");
  assert.equal(f.calls.filter(c => c.type === "verify").length, 0);
});

test("revoked human authorization and changed directory block queued emission while preserving issued receipts", async t => {
  const f = await fixture(t), row = await f.request(["a", "b"]);
  await f.coverage.sync();
  await f.store.query("UPDATE users SET active=false WHERE id=$1", [f.actor.id]);
  const a = [...f.emitted.values()][0];
  await f.receive({ now: 2000, inspections: [f.completed(a)] }); await f.coverage.sync();
  const r = await f.store.get("org0", "coverage_request", row.id);
  assert.deepEqual(r.checks.map(k => k.state), ["contact_confirmed", "requires_review"]);
  assert.equal(f.calls.filter(c => c.type === "verify").length, 1);
  const fresh = await fixture(t), waiting = await fresh.request(["a"]);
  await fresh.store.upsert("org0", "context", "geography", { map: { places: [{ id: "a", node: "moved", sector: "s0" }] } });
  await fresh.coverage.sync();
  assert.equal((await fresh.store.get("org0", "coverage_request", waiting.id)).state, "requires_review");
  assert.equal(fresh.calls.filter(c => c.type === "verify").length, 0);
});

test("an old or wrong target contact receipt stays unresolved and cannot establish safety", async t => {
  for (const bad of ["old", "wrong", "ack"]) {
    const f = await fixture(t), row = await f.request(["a"]); await f.coverage.sync();
    const receipt = f.completed([...f.emitted.values()][0], { observedAt: bad === "old" ? 900 : 2000 });
    if (bad === "wrong") receipt.entity = "b";
    if (bad === "ack") receipt.confirmedBySource = false;
    await f.receive({ now: 3000, inspections: [receipt] }); await f.coverage.sync();
    assert.equal((await f.store.get("org0", "coverage_request", row.id)).state, "requires_review");
    assert.equal((await f.coverage.summary()).rows.find(r => r.id === "a").state, "unknown");
    assert.equal((await f.store.list("org0", "need")).length, 0);
    assert.equal((await f.store.list("org0", "facility")).length, 0);
  }
});

test("a missing response, source refusal and source-run replacement remain explicit unknown states", async t => {
  const f = await fixture(t), row = await f.request(["a"]); await f.coverage.sync();
  await f.receive({ now: 302000 }); await f.coverage.sync();
  assert.equal((await f.store.get("org0", "coverage_request", row.id)).state, "requires_review");
  assert.equal((await f.coverage.summary()).rows.find(r => r.id === "a").state, "unknown");
  const other = await fixture(t), waiting = await other.request(["a"]);
  const original = other.connector.action; other.connector.action = async (...args) => {
    if (args[0] === "verify") throw new AppError("SOURCE_PERMISSION", "Contact channel disallowed", 403);
    return original(...args);
  };
  await other.coverage.sync(); assert.equal((await other.store.get("org0", "coverage_request", waiting.id)).state, "requires_review");
  const changed = await fixture(t), old = await changed.request(["a"]);
  await changed.receive({ runId: "another-run", now: 2000 }); await changed.coverage.sync();
  assert.equal((await changed.store.get("org0", "coverage_request", old.id)).state, "requires_review");
  assert.equal(changed.calls.filter(c => c.type === "verify").length, 0);
});

test("contact retries are bounded by received clock, survive poll storms and stop after three ambiguous failures", async t => {
  const f = await fixture(t), row = await f.request(["a"]); let attempts = 0;
  const original = f.connector.action; f.connector.action = async (...args) => {
    if (args[0] === "verify") { attempts++; throw Object.assign(new Error("Lost acknowledgement"), { code: "ETIMEDOUT" }); }
    return original(...args);
  };
  await f.coverage.sync(); for (let i = 0; i < 20; i++) await f.coverage.sync();
  assert.equal(attempts, 1);
  await f.receive({ now: 61000 }); await f.coverage.sync(); assert.equal(attempts, 2);
  await f.receive({ now: 121000 }); await f.coverage.sync(); assert.equal(attempts, 3);
  await f.receive({ now: 181000 }); await f.coverage.sync(); assert.equal(attempts, 3);
  const r = await f.store.get("org0", "coverage_request", row.id);
  assert.equal(r.state, "requires_review"); assert.equal(r.checks[0].attempts, 3);
});

test("durable restart reuses an ambiguously issued source inquiry and later receives only its exact original contact", async t => {
  const dir = await mkdtemp(join(tmpdir(), "aidscaler-coverage-")); let currentStore;
  t.after(async () => { if (currentStore && !currentStore.db.closed) await currentStore.close(); await rm(dir, { recursive: true, force: true }); });
  const f = await fixture(t, { dataDir: dir }), row = await f.request(["a"]), original = f.connector.action;
  currentStore = f.store;
  let fail = true;
  f.connector.action = async (...args) => {
    const result = await original(...args);
    if (args[0] === "verify" && fail) { fail = false; throw Object.assign(new Error("Lost accepted inquiry acknowledgement"), { code: "ETIMEDOUT" }); }
    return result;
  };
  await f.coverage.sync(); assert.equal(f.emitted.size, 1);
  await f.store.close(); const reopened = await Store.open({ dataDir: dir }); currentStore = reopened;
  const coverage = new Coverage(reopened, f.connector, { org: "org0" }), issued = [...f.emitted.values()][0];
  await reopened.upsert("org0", "context", "operational", { snapshot: { ...f.snapshot(), now: 61000, inspections: [issued] } });
  await coverage.sync(); assert.equal(f.emitted.size, 1);
  assert.equal((await reopened.get("org0", "coverage_request", row.id)).checks[0].reused, true);
  await reopened.upsert("org0", "context", "operational", { snapshot: { ...f.snapshot(), now: 62000, inspections: [f.completed(issued, { observedAt: 61500 })] } });
  await coverage.sync(); assert.equal((await reopened.get("org0", "coverage_request", row.id)).state, "completed");
  assert.equal(f.calls.filter(c => c.type === "verify").length, 1);
});

test("wrong coverage schema, future timestamps and older versions retain explicit source attention without replacing known contact", async t => {
  const f = await fixture(t);
  f.setDto({ version: 2, observedAt: 1000, contacts: [], buildingContacts: [
    { building: "a", sector: "s0", lastContactAt: 900, receivedAt: 1000 } ], scope: "received" });
  await f.coverage.sync();
  for (const [index, dto] of [
    { version: 3, observedAt: 5000, contacts: [], scope: "received" },
    { version: 1, observedAt: 900, contacts: [], scope: "received" },
    { version: 4, observedAt: 1000, contacts: null, scope: "received" },
  ].entries()) {
    f.setDto(dto); await f.receive({ known: { ...f.snapshot().known, sectorContacts: { ["new-" + index]: 1000 } } });
    await f.coverage.sync(); const d = await f.coverage.summary();
    assert.equal(d.sourceError, "COVERAGE_SCHEMA");
    assert.equal(d.rows.find(r => r.id === "a").lastContactAt, 900);
    assert.equal(d.rows.find(r => r.id === "b").lastContactAt, null);
  }
});

test("a live coverage read may advance beyond its earlier operational snapshot, bounded by a later scoped clock receipt", async t => {
  const f = await fixture(t), order = [], original = f.connector.action;
  f.setDto({ version: 2, observedAt: 1500, contacts: [{ sector: "s0", lastContactAt: 1400 }],
    buildingContacts: [{ building: "a", sector: "s0", lastContactAt: 1400, receivedAt: 1500 }], scope: "received" });
  f.connector.action = async (...args) => { order.push(args[0]); return original(...args); };
  f.connector.state = async () => { order.push("scoped-clock"); return { ...f.snapshot(), organization: { id: "org0" }, now: 1600 }; };
  await f.coverage.sync();
  const received = await f.store.get("org0", "coverage_snapshot", "received");
  assert.equal(received.sourceObservedAt, 1500);
  assert.equal(received.sourceClockAtReceipt, 1600);
  assert.equal((await f.coverage.summary()).sourceError, null);
  assert.deepEqual(order, ["coverage", "scoped-clock"], "An independent scoped clock must be received after the coverage response");
  assert.equal((await f.coverage.summary()).rows.find(r => r.id === "a").state, "unknown", "A later contact does not advance the separately received operational world by itself");
  await f.receive({ now: 1600 });
  assert.equal((await f.coverage.summary()).rows.find(r => r.id === "a").lastContactAt, 1400);
  assert.equal((await f.coverage.summary()).rows.find(r => r.id === "b").state, "unknown");
  assert.equal((await f.store.list("org0", "need")).length, 0);
});

test("fresh clock validation still rejects truly future contact, a backwards clock, and a changed owner or run", async t => {
  for (const invalid of ["future", "clock_backwards", "owner", "run"]) {
    const f = await fixture(t);
    f.setDto({ version: 1, observedAt: 1000, contacts: [],
      buildingContacts: [{ building: "a", sector: "s0", lastContactAt: 900, receivedAt: 1000 }], scope: "received" });
    await f.coverage.sync();
    f.setDto({ version: 2, observedAt: invalid === "future" ? 1700 : 1500, contacts: [],
      buildingContacts: [{ building: "a", sector: "s0", lastContactAt: 1400, receivedAt: 1500 }], scope: "received" });
    await f.receive({ known: { ...f.snapshot().known, sectorContacts: { new: 1000 } } });
    f.connector.state = async () => ({ ...f.snapshot(), now: invalid === "clock_backwards" ? 900 : 1600,
      organization: { id: invalid === "owner" ? "org-other" : "org0" },
      runId: invalid === "run" ? "another-run" : "source-run" });
    await f.coverage.sync();
    const received = await f.store.get("org0", "coverage_snapshot", "received");
    assert.equal(received.sourceVersion, 1, invalid);
    assert.equal(received.buildingContacts[0].lastContactAt, 900, invalid);
    assert.equal((await f.coverage.summary()).sourceError, "COVERAGE_SCHEMA", invalid);
  }
});

test("a reordered slow coverage response cannot overwrite a newer received contact version", async t => {
  const f = await fixture(t);
  let releaseOld, signalStarted, coverageCalls = 0;
  const oldGate = new Promise(resolve => { releaseOld = resolve; }), started = new Promise(resolve => { signalStarted = resolve; });
  f.connector.action = async type => {
    assert.equal(type, "coverage");
    const first = ++coverageCalls === 1;
    if (first) { signalStarted(); await oldGate; }
    return { version: first ? 2 : 3, observedAt: first ? 1200 : 1300, contacts: [],
      buildingContacts: [{ building: "a", sector: "s0", lastContactAt: first ? 1100 : 1250, receivedAt: first ? 1200 : 1300 }], scope: "received" };
  };
  f.connector.state = async () => ({ ...f.snapshot(), organization: { id: "org0" }, now: 1400 });
  const slow = f.coverage.sync();
  await started;
  await f.coverage.sync();
  releaseOld();
  await slow;
  const received = await f.store.get("org0", "coverage_snapshot", "received");
  assert.equal(received.sourceVersion, 3);
  assert.equal(received.sourceObservedAt, 1300);
  assert.equal(received.buildingContacts[0].lastContactAt, 1250);
  assert.equal((await f.coverage.summary()).sourceError, "COVERAGE_SCHEMA");
  await f.receive({ now: 1400 });
  assert.equal((await f.coverage.summary()).rows.find(r => r.id === "a").lastContactAt, 1250);
});

test("a fresh coverage clock cannot move behind a previously received coverage clock even before operational ingest catches up", async t => {
  const f = await fixture(t);
  let clock = 1600;
  f.connector.state = async () => ({ ...f.snapshot(), organization: { id: "org0" }, now: clock });
  f.setDto({ version: 2, observedAt: 1400, contacts: [], buildingContacts: [], scope: "received" });
  await f.coverage.sync();
  clock = 1550;
  f.setDto({ version: 3, observedAt: 1500, contacts: [], buildingContacts: [], scope: "received" });
  await f.receive({ now: 1100, known: { ...f.snapshot().known, sectorContacts: { changed: 1100 } } });
  await f.coverage.sync();
  const received = await f.store.get("org0", "coverage_snapshot", "received");
  assert.equal(received.sourceVersion, 2);
  assert.equal(received.sourceClockAtReceipt, 1600);
  assert.equal((await f.coverage.summary()).sourceError, "COVERAGE_SCHEMA");
});

test("local cancellation and human role downgrade stop only prospective checks and keep previously issued physical work", async t => {
  const f = await fixture(t), row = await f.request(["a", "b"]);
  await f.coverage.sync(); const current = await f.store.get("org0", "coverage_request", row.id);
  await f.coverage.cancel(f.actor, row.id, current.version, "stop-local");
  await f.receive({ now: 2000, inspections: [f.completed([...f.emitted.values()][0])] }); await f.coverage.sync();
  assert.equal((await f.store.get("org0", "coverage_request", row.id)).state, "cancelled");
  assert.equal(f.emitted.size, 1, "An already-issued inquiry remains external history; a queued second check must not be issued");
  const other = await fixture(t), waiting = await other.request(["a"]);
  await other.store.query("UPDATE users SET role='finance' WHERE id=$1", [other.actor.id]);
  await other.coverage.sync(); assert.equal((await other.store.get("org0", "coverage_request", waiting.id)).state, "requires_review");
  assert.equal(other.emitted.size, 0);
});
