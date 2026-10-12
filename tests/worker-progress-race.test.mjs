import test from "node:test";
import assert from "node:assert/strict";
import { Store, hash } from "../src/store.mjs";
import { Worker } from "../src/worker.mjs";

async function fixture(t, actions) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.put("org0", "proposal", "response", {
    state: "authorized", actions, references: [], conditions: [], simId: "source-plan",
    authorization: { by: "owner", expiresAt: Date.now() + 3600000, planHash: hash(actions) },
  }, 0);
  const source = { now: 1000, organization: { id: "org0" },
    proposals: [{ id: "source-plan", state: "authorized" }],
    operations: [], inspections: [], queries: [], known: { buildings: {} } };
  return { store, source };
}
const shipment = [{ type: "dispatch", owner: "org0", dependsOn: [],
  params: { vehicle: "truck", resource: "water", need: "request", quantity: 50 } }];

async function decision(store, state) {
  const row = await store.get("org0", "proposal", "response");
  await store.put("org0", "proposal", row.id, { ...row, state,
    previousAuthorization: row.authorization, authorization: null,
    changedReason: "A human changed the response during source I/O" }, row.version);
}

for (const state of ["requires_review", "cancelled"])
  test(`a ${state} decision during dispatch I/O survives the issued source acknowledgment`, async (t) => {
    const f = await fixture(t, shipment);
    let commands = 0;
    const worker = new Worker({ store: f.store, config: { org: "org0" }, connector: {
      state: async () => f.source,
      action: async () => {
        commands++;
        f.source.operations.push({ id: "cargo", type: "delivery", state: "loading", quantity: 50 });
        await decision(f.store, state);
        return { id: "cargo", state: "loading" };
      },
    } });
    const result = await worker.execute("response"), row = await f.store.get("org0", "proposal", "response");
    assert.equal(result.authorityChanged, true);
    assert.equal(row.state, state);
    assert.equal(row.authorization, null);
    assert.equal(row.executionResults[0].result.id, "cargo");
    assert.equal((await f.store.get("org0", "operation", "cargo")).proposalId, row.id);
    assert.equal((await worker.execute("response")).skipped, true);
    assert.equal(commands, 1);
    assert.equal(f.source.operations[0].quantity, 50);
    assert.equal((await f.store.query("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued','running','retry')")).rows[0].n, 0);
  });

for (const state of ["requires_review", "cancelled"])
  test(`a ${state} decision at the last state read is not overwritten by completed progress`, async (t) => {
    const f = await fixture(t, shipment);
    let reads = 0, commands = 0;
    const worker = new Worker({ store: f.store, config: { org: "org0" }, connector: {
      state: async () => {
        if (++reads === 3) {
          f.source.operations[0].state = "received";
          f.source.operations[0].received = 50;
          await decision(f.store, state);
        }
        return f.source;
      },
      action: async () => {
        commands++;
        f.source.operations.push({ id: "cargo", type: "delivery", state: "loading", quantity: 50 });
        return { id: "cargo", state: "loading" };
      },
    } });
    const result = await worker.execute("response"), row = await f.store.get("org0", "proposal", "response");
    assert.equal(result.authorityChanged, true);
    assert.equal(row.state, state);
    assert.equal(row.authorization, null);
    assert.equal(row.executionResults[0].result.id, "cargo");
    assert.equal(commands, 1);
    assert.equal(f.source.operations[0].received, 50);
    assert.equal((await f.store.query("SELECT COUNT(*) AS n FROM audit WHERE action='proposal.completed'")).rows[0].n, 0);
  });

test("a concurrently renewed authorization is preserved without an old worker continuing its scope", async (t) => {
  const f = await fixture(t, shipment), issued = await f.store.get("org0", "proposal", "response");
  let renewed;
  const worker = new Worker({ store: f.store, config: { org: "org0" }, connector: {
    state: async () => f.source,
    action: async () => {
      const row = await f.store.get("org0", "proposal", "response");
      renewed = { ...row.authorization, by: "new-owner", at: 123 };
      await f.store.put("org0", "proposal", row.id, { ...row, authorization: renewed }, row.version);
      f.source.operations.push({ id: "cargo", state: "loading", quantity: 50 });
      return { id: "cargo", state: "loading" };
    },
  } });
  assert.equal((await worker.execute("response")).authorityChanged, true);
  const row = await f.store.get("org0", "proposal", "response");
  assert.equal(row.state, "authorized");
  assert.deepEqual(row.authorization, renewed);
  assert.notDeepEqual(row.authorization, issued.authorization);
  assert.equal(row.executionResults[0].result.id, "cargo");
});

test("activation waits for readiness and queries each received facility transition once across worker restarts", async (t) => {
  const actions = [{ type: "activate", owner: "org0", params: { building: "site", permit: true }, dependsOn: [] }];
  const f = await fixture(t, actions);
  await f.store.upsert("org0", "proposal", "response", { state: "executing",
    executionResults: [{ index: 0, result: { building: "site", state: "provisioning", readyAt: 2000 } }] });
  f.source.known.buildings.site = { id: "site", state: "assessed", version: 1 };
  f.source.queries.push({ id: "unrelated", target: "facility", state: "pending" });
  let queries = 0;
  const connector = { state: async () => f.source, action: async (type, params) => {
    assert.equal(type, "query");
    assert.deepEqual(params, { target: "facility", id: "site" });
    const query = { id: "query-" + ++queries, target: "facility", state: "pending" };
    f.source.queries.push(query);
    return query;
  } };
  const worker = () => new Worker({ store: f.store, config: { org: "org0" }, connector });
  assert.equal((await worker().execute("response")).complete, false);
  assert.equal(queries, 0, "Do not query before the source's declared setup completes");
  f.source.now = 3000;
  assert.equal((await worker().execute("response")).complete, false);
  assert.equal(queries, 1, "An unrelated site's pending query does not hide this site");
  for (let i = 0; i < 20; i++) {
    f.source.now += 1000;
    assert.equal((await worker().execute("response")).complete, false);
  }
  assert.equal(queries, 1, "Passing time cannot invent an evidence transition");
  f.source.known.buildings.site.version = 2;
  await worker().execute("response");
  assert.equal(queries, 1, "Preserve the already pending source read even if new evidence arrives");
  f.source.queries.find(q => q.id === "query-1").state = "ready";
  await worker().execute("response");
  assert.equal(queries, 2);
  f.source.queries.find(q => q.id === "query-2").state = "ready";
  for (let i = 0; i < 5; i++) await worker().execute("response");
  assert.equal(queries, 2);
  f.source.known.buildings.site.state = "operating";
  assert.equal((await worker().execute("response")).complete, true);
  assert.equal(queries, 2);
  assert.equal((await f.store.get("org0", "proposal", "response")).state, "completed");
});
