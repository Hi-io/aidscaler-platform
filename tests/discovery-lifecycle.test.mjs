import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { SemanticIngestion } from "../src/semantic-ingestion.mjs";
import { DiscoveryResponse } from "../src/discovery-response.mjs";
import { Retention } from "../src/retention.mjs";

const org = "org0", owner = { org, id: "coordinator", role: "commander" };
async function fixture(t, { locations = ["b"], interpretedLocations = locations } = {}) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization(org);
  const config = { org, peers: [], modelId: "lifecycle-contract" };
  await store.put(org, "signal", "request", { text: "Current water requests at " + locations.join(", "), sourceVersion: 1 }, 0);
  await store.put(org, "resource", "water", { owner: org, type: "water", quantity: 100, floor: 0, reserved: 0, node: "a" }, 0);
  await store.put(org, "vehicle", "truck", { owner: org, state: "idle", capacity: 100, node: "a" }, 0);
  await store.put(org, "context", "geography", { map: { places: locations.map(id => ({ id, name: id })), nodes: ["a", ...locations].map(id => ({ id })), roads: locations.map(id => ({ id: "a-" + id, from: "a", to: id, open: true, lengthM: 100 })) } }, 0);
  await store.put(org, "activity", "episode", { state: "queued", kind: "source_response", steps: [] }, 0);
  let calls = 0, queries = 0;
  const inspections = new Map(), known = { needs: {} };
  const f = { store, config, onAction: null, onSync: null };
  const connector = {
    state: async () => ({ known, inspections: [...inspections.values()], operations: [] }),
    action: async (kind, params, key) => {
      assert.equal(kind, "verify");
      if (inspections.has(key)) return inspections.get(key);
      queries++;
      const result = { id: key, state: "pending", location: params.id, target: params.target, entity: params.id, method: params.method };
      inspections.set(key, result);
      if (f.onAction) await f.onAction(result);
      return result;
    },
  };
  const semantic = new SemanticIngestion({ store, config, provider: { complete: async () => {
    calls++;
    return { usage: { providerCost: 0 }, message: { content: JSON.stringify({ observations: interpretedLocations.map(location => ({ text: "Current water request", kind: "need", sourceIds: ["S1"], location, resourceType: "water", quantity: 9999, unit: "L", timeStatus: "current" })) }) } };
  } } });
  const ingestion = { sync: async () => { if (f.onSync) await f.onSync(); } };
  const options = { store, config, semantic, connector, ingestion, domain: new Domain(store, config) };
  f.discovery = new DiscoveryResponse(options);
  f.restart = () => new DiscoveryResponse(options);
  f.calls = () => calls;
  f.queries = () => queries;
  f.confirm = async (location = locations[0]) => {
    const n = await store.upsert(org, "need", "need-" + location, { building: location, node: location, type: "water", unit: "L", quantity: 40, served: 0 });
    known.needs[n.id] = n;
    for (const result of inspections.values()) if (result.location === location) result.state = "completed";
  };
  return f;
}

test("independent source batches reuse the owner's existing pending inquiry for the same place and channel", async t => {
  const f = await fixture(t);
  const first = await f.discovery.run({ ids: ["request"] }, "first-batch");
  assert.equal(first.state, "waiting_evidence");
  await f.store.put(org, "signal", "independent-witness", { text: "Current water request at b", sourceVersion: 1 }, 0);
  const second = await f.discovery.run({ ids: ["independent-witness"] }, "second-batch");
  assert.equal(second.state, "waiting_evidence");
  assert.equal(f.queries(), 1);
  assert.equal(second.verifications[0].id, first.verifications[0].id);
  assert.equal(second.verifications[0].reused, true);
  // An independent observation still receives its own sourced interpretation;
  // sharing a check must not merge independent witnesses into one source.
  assert.equal(f.calls(), 2);
});

for (const state of ["failed", "cancelled", "timeout", "inconclusive"]) {
  test(`terminal ${state} confirmation exits waiting state and preserves an explicit review path`, async t => {
    const f = await fixture(t);
    f.onAction = result => { result.state = state; };
    const result = await f.discovery.run({ ids: ["request"] }, "terminal-" + state);
    assert.equal(result.state, "inconclusive");
    assert.deepEqual(result.pendingLocations, []);
    assert.equal(result.unresolvedLocations[0].state, state);
    assert.match(result.reason, /explicitly retry/);
    assert.equal((await f.store.list(org, "proposal")).length, 0);
    assert.equal(f.calls(), 1);
    const resumed = await f.restart().run({}, "terminal-" + state);
    assert.equal(resumed.state, "inconclusive");
    assert.equal(f.calls(), 1);
    assert.equal(f.queries(), 1);
  });
}

for (const mode of ["receipt", "review", "capacity"]) {
  test(`a checked need waiting for ${mode} is not mislabelled or dispatched twice`, async t => {
    const f = await fixture(t);
    await f.confirm();
    await f.store.upsert(org, "resource", "water", { quantity: 0 });
    if (mode === "receipt") await f.store.upsert(org, "need", "need-b", { inTransit: 40 });
    if (mode === "review") await f.store.put(org, "proposal", "held", {
      state: "awaiting_review", actions: [{ type: "dispatch", owner: org,
        params: { need: "need-b", resource: "water", vehicle: "truck", quantity: 40 }, dependsOn: [] }],
    }, 0);
    const result = await f.discovery.run({ ids: ["request"] }, "wait-" + mode);
    assert.equal(result.state, "waiting_" + mode);
    assert.equal(result.proposalId, undefined);
    const resumed = await f.restart().run({}, "wait-" + mode);
    assert.equal(resumed.state, "waiting_" + mode);
    assert.equal(f.calls(), 1);
    assert.equal(f.queries(), 0);
    assert.equal((await f.store.list(org, "proposal")).length, mode === "review" ? 1 : 0);
  });
}

test("a source continuation preserves global approved priority instead of allocating only its own batch", async t => {
  const f = await fixture(t, { locations: ["b", "c"], interpretedLocations: ["b"] });
  // The current batch will discover b; c is already known and more urgent.
  await f.confirm("c");
  await f.store.upsert(org, "need", "need-c", { priority: 10, deadline: 100 });
  await f.store.upsert(org, "resource", "water", { quantity: 40 });
  f.onSync = async () => {
    await f.confirm("b");
    await f.store.upsert(org, "need", "need-b", { priority: 1, deadline: 200 });
  };
  const result = await f.discovery.run({ ids: ["request"] }, "new-less-urgent-batch");
  assert.ok(result.proposalId);
  const proposal = await f.store.get(org, "proposal", result.proposalId);
  assert.equal(proposal.actions[0].params.need, "need-c");
  assert.equal(proposal.actions.length, 1);
  assert.equal((await f.store.get(org, "need", "need-b")).served, 0);
});

test("cancelled structured compilation cannot create a new draft or overwrite the cancellation", async t => {
  const f = await fixture(t);
  await f.confirm();
  await f.store.upsert(org, "activity", "episode", { cancelRequested: true, state: "cancelled" });
  const result = await f.discovery.compile("episode");
  assert.equal(result.state, "cancelled");
  assert.equal((await f.store.list(org, "proposal")).length, 0);
  assert.equal((await f.store.get(org, "activity", "episode")).state, "cancelled");
  assert.equal(f.calls(), 0);
});

test("cancellation before public discovery avoids both inference and source actions", async t => {
  const f = await fixture(t);
  await f.store.upsert(org, "activity", "episode", { cancelRequested: true });
  assert.equal((await f.discovery.run({ ids: ["request"] }, "episode")).state, "cancelled");
  assert.equal(f.calls(), 0);
  assert.equal(f.queries(), 0);
  assert.equal((await f.store.list(org, "proposal")).length, 0);
});

test("a stop arriving during the first field action prevents subsequent inquiries and drafting", async t => {
  const f = await fixture(t, { locations: ["b", "c"] });
  f.onAction = async () => {
    await f.confirm("b");
    await f.store.upsert(org, "activity", "episode", { cancelRequested: true });
  };
  const result = await f.discovery.run({ ids: ["request"] }, "episode");
  assert.equal(result.state, "cancelled");
  assert.equal(f.calls(), 1);
  assert.equal(f.queries(), 1);
  assert.equal((await f.store.list(org, "proposal")).length, 0);
  assert.equal((await f.store.get(org, "discovery_run", "episode")).state, "cancelled");
});

test("a stop arriving after observations synchronize prevents a draft", async t => {
  const f = await fixture(t);
  f.onSync = async () => {
    await f.confirm();
    await f.store.upsert(org, "activity", "episode", { cancelRequested: true });
  };
  assert.equal((await f.discovery.run({ ids: ["request"] }, "episode")).state, "cancelled");
  assert.equal(f.queries(), 1);
  assert.equal((await f.store.list(org, "proposal")).length, 0);
});

test("source correction during confirmation cannot become a draft citing the superseded inference", async t => {
  const f = await fixture(t);
  f.onSync = async () => {
    await f.confirm();
    await f.store.upsert(org, "signal", "request", { text: "Corrected current request requires a fresh interpretation", sourceVersion: 2 });
  };
  await assert.rejects(f.discovery.run({ ids: ["request"] }, "episode"), { code: "SEMANTIC_VERSION" });
  assert.equal((await f.store.list(org, "proposal")).length, 0);
});

test("restart and lease reclaim reuse the persisted interpretation and idempotent pending inquiry", async t => {
  const f = await fixture(t);
  await f.store.enqueue(org, "discover_response", { ids: ["request"] }, "episode");
  const oldLease = await f.store.lease(org);
  const pending = await f.discovery.run(oldLease.payload, oldLease.id);
  assert.equal(pending.state, "waiting_evidence");
  assert.equal(f.calls(), 1);
  assert.equal(f.queries(), 1);
  await f.store.query("UPDATE jobs SET leased_until=0 WHERE id=$1", [oldLease.id]);
  const reclaimed = await f.store.lease(org);
  assert.notEqual(reclaimed.lease_token, oldLease.lease_token);
  await f.confirm();
  const result = await f.restart().run(reclaimed.payload, reclaimed.id);
  assert.equal(result.state, "ready");
  assert.equal(f.calls(), 1);
  assert.equal(f.queries(), 1);
  assert.equal((await f.store.list(org, "proposal")).length, 1);
  await assert.rejects(f.store.finishJob(oldLease.id, { stale: true }, oldLease.lease_token), { code: "JOB_LEASE_LOST" });
  await f.store.finishJob(reclaimed.id, result, reclaimed.lease_token);
  assert.equal((await f.restart().run({}, "episode")).proposalId, result.proposalId);
  assert.equal(f.calls(), 1);
});

test("cancelled and erased discovery continuations do not get scheduled again", async t => {
  const f = await fixture(t);
  await f.discovery.run({ ids: ["request"] }, "episode");
  await f.store.put(org, "context", "operational", { snapshot: { known: {}, inspections: [], operations: [] } }, 0);
  await f.store.upsert(org, "activity", "episode", { cancelRequested: true });
  await f.discovery.resumePending();
  assert.equal((await f.store.query("SELECT id FROM jobs WHERE kind='discover_response'")).rows.length, 0);
  await f.store.upsert(org, "activity", "episode", { cancelRequested: false, erasure: "approved-erasure" });
  await f.discovery.resumePending();
  assert.equal((await f.store.query("SELECT id FROM jobs WHERE kind='discover_response'")).rows.length, 0);
});

test("source erasure tombstones discovery state and fences all new inference/compilation jobs", async t => {
  const f = await fixture(t);
  await f.discovery.run({ ids: ["request"] }, "episode");
  for (const [i, kind] of ["discover_response", "compile_response", "interpret_sources"].entries()) {
    const id = "pending-" + kind;
    await f.store.enqueue(org, kind, { ids: ["request"] }, id);
    await f.store.put(org, "activity", id, { state: "queued", kind }, 0);
    if (i === 0) await f.store.query("UPDATE jobs SET state='running',lease_token='in-flight',leased_until=$2 WHERE id=$1", [id, Date.now() + 10000]);
  }
  const retention = new Retention(f.store, f.discovery.domain, f.config), plan = await retention.preview(owner, { kind: "signal", id: "request" });
  assert.ok(plan.records.some(r => r.kind === "discovery_run" && r.id === "episode"));
  await retention.erase(owner, { kind: "signal", id: "request", version: plan.version, planHash: plan.planHash, reason: "Approved withdrawal of exercise source" }, "withdraw-source");
  const tombstone = await f.store.get(org, "discovery_run", "episode");
  assert.equal(tombstone.state, "erased");
  assert.equal(tombstone.candidates, undefined);
  assert.equal(tombstone.candidateLocations, undefined);
  assert.equal(tombstone.sourceIds, undefined);
  const jobs = (await f.store.query("SELECT kind,state,payload,lease_token FROM jobs WHERE kind IN ('discover_response','compile_response','interpret_sources')")).rows;
  assert.equal(jobs.length, 3);
  for (const job of jobs) {
    assert.equal(job.state, "cancelled");
    assert.equal(job.lease_token, null);
    assert.deepEqual(job.payload, { erased: true });
  }
  await f.confirm();
  assert.equal((await f.discovery.compile("pending-compile_response")).state, "cancelled");
  assert.equal((await f.store.list(org, "proposal")).length, 0);
});
