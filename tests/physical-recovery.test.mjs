import test from "node:test";
import assert from "node:assert/strict";
import { Store, hash } from "../src/store.mjs";
import { Worker } from "../src/worker.mjs";
import { validatePlan } from "../src/planning.mjs";
import { Finance } from "../src/finance.mjs";
import { Network } from "../src/network.mjs";
import { Domain } from "../src/domain.mjs";
const org = "org0",
  actor = { org, id: "owner", role: "commander" };
async function setup(t) {
  const store = await Store.open();
  await store.organization(org);
  t.after(() => store.close());
  return store;
}
test("a failed issued operation invalidates only its plan, retaining completed steps and real receipts", async (t) => {
  const store = await setup(t),
    actions = [
      { type: "dispatch", owner: org, params: { vehicle: "v1" } },
      { type: "dispatch", owner: org, params: { vehicle: "v2" } },
    ];
  const p = await store.put(
    org,
    "proposal",
    "p",
    {
      state: "executing",
      actions,
      conditions: [],
      references: [],
      authorization: { by: "owner", planHash: hash(actions) },
      simId: "sim",
      executionResults: [
        { index: 0, result: { id: "delivered" } },
        { index: 1, result: { id: "failed" } },
      ],
    },
    0,
  );
  const worker = new Worker({
    store,
    config: { org },
    connector: {
      state: async () => ({
        organization: { id: org },
        proposals: [{ id: "sim", state: "authorized" }],
        operations: [
          { id: "delivered", state: "completed" },
          { id: "failed", state: "failed", times: { dispatched: 1000 } },
        ],
      }),
    },
  });
  const r = await worker.execute(p.id);
  assert.deepEqual(r.affectedSteps, [1]);
  assert.deepEqual(r.preservedSteps, [0]);
  const after = await store.get(org, "proposal", p.id);
  assert.equal(after.authorization, null);
  assert.equal(after.executionResults.length, 2);
  assert.equal(after.previousAuthorization.by, "owner");
});
test("an expired authorization or changed action hash cannot issue an operational command", async (t) => {
  const store = await setup(t);
  let writes = 0;
  const actions = [{ type: "coverage", owner: org, params: {}, dependsOn: [] }],
    worker = new Worker({
      store,
      config: { org },
      connector: {
        action: async () => {
          writes++;
        },
      },
    });
  for (const [id, auth] of [
    [
      "expired",
      { by: "owner", expiresAt: Date.now() - 1, planHash: hash(actions) },
    ],
    ["scope", { by: "owner", planHash: hash([]) }],
  ]) {
    await store.put(
      org,
      "proposal",
      id,
      { state: "authorized", actions, conditions: [], authorization: auth },
      0,
    );
    assert.equal((await worker.execute(id)).requiresReview, true);
  }
  assert.equal(writes, 0);
});
test("evacuation review prevents allocating people, seats and shelter places twice", async (t) => {
  const store = await setup(t);
  await store.put(
    org,
    "vehicle",
    "v",
    { owner: org, state: "idle", seats: 20 },
    0,
  );
  await store.put(
    org,
    "facility",
    "s",
    {
      use: "shelter",
      safe: true,
      state: "operating",
      capacity: 30,
      occupancy: 0,
      reservedPlaces: 0,
    },
    0,
  );
  await store.put(
    org,
    "need",
    "n",
    { building: "b", type: "shelter", quantity: 50, served: 0 },
    0,
  );
  const action = (q) => ({
    type: "evacuate",
    owner: org,
    params: { from: "b", to: "s", vehicle: "v", quantity: q },
    dependsOn: [],
  });
  assert.equal(
    (await validatePlan(store, org, { id: "p", actions: [action(20)] }))[0]
      .type,
    "passenger_capacity",
  );
  await assert.rejects(
    () => validatePlan(store, org, { id: "p", actions: [action(21)] }),
    (e) => e.code === "SEATS",
  );
  await assert.rejects(
    () =>
      validatePlan(store, org, {
        id: "p",
        actions: [action(20), { ...action(20), dependsOn: [0] }],
      }),
    (e) => e.code === "SHELTER_CAPACITY",
  );
  await store.put(
    org,
    "proposal",
    "other",
    { state: "authorized", actions: [action(20)] },
    0,
  );
  await assert.rejects(
    () => validatePlan(store, org, { id: "p", actions: [action(20)] }),
    (e) => e.code === "SHELTER_CAPACITY" || e.code === "VEHICLE_CONFLICT",
  );
});
test("fund releases are append-only, scoped and idempotent before an allocated refund can settle", async (t) => {
  const store = await setup(t),
    f = new Finance(store, { secret: "local-test-finance" }),
    d = await f.checkout(org, { amountCents: 1000 }),
    settle = { org, id: d.id, eventId: "settle", state: "settled" };
  await f.webhook(settle, f.signature(settle));
  const a = await f.allocate(
    actor,
    { amountCents: 800, reason: "Water" },
    "allocate",
  );
  const refund = { org, id: d.id, eventId: "refund", state: "refunded" };
  await assert.rejects(
    () => f.webhook(refund, f.signature(refund)),
    (e) => e.code === "REFUND_FUNDS",
  );
  const r = await f.release(
    actor,
    { allocationId: a.id, amountCents: 800, reason: "Cancelled purchase" },
    "release",
  );
  assert.equal(
    (
      await f.release(
        actor,
        { allocationId: a.id, amountCents: 800, reason: "Cancelled purchase" },
        "release",
      )
    ).id,
    r.id,
  );
  await assert.rejects(
    () =>
      f.release(
        actor,
        { allocationId: a.id, amountCents: 1, reason: "Too much" },
        "again",
      ),
    (e) => e.code === "RELEASE_AMOUNT",
  );
  await f.webhook(refund, f.signature(refund));
  assert.equal((await f.summary(org)).availableCents, 0);
});
test("vehicle sharing and subsequent refresh preserve technical limits without leaking private data", async (t) => {
  const store = await setup(t),
    n = new Network(store, {
      org,
      peers: [{ org: "org1", key: "local-test", url: "http://localhost" }],
    });
  const v = await store.put(
    org,
    "vehicle",
    "v",
    {
      node: "n0",
      state: "idle",
      capacity: 300,
      seats: 20,
      maxCargoKg: 800,
      volumeM3: 2,
      fuelMlPerKm: 200,
      maxWaterDepth: 0.2,
      privateNotes: "Never share",
    },
    0,
  );
  await n.share(
    actor,
    { kind: "vehicle", id: v.id, version: v.version, to: "org1" },
    "share",
  );
  await store.upsert(org, "vehicle", "v", { state: "preparing" });
  await n.refresh();
  const jobs = (
    await store.query(
      "SELECT payload FROM jobs WHERE kind='peer_send' ORDER BY created_at",
    )
  ).rows;
  assert.equal(jobs.length, 2);
  for (const { payload } of jobs) {
    assert.equal(payload.message.projection.seats, 20);
    assert.equal(payload.message.projection.volumeM3, 2);
    assert.equal(payload.message.projection.privateNotes, undefined);
  }
});
test("a worker pass is bounded and never follows newly enqueued continuations indefinitely", async (t) => {
  const store = await setup(t);
  let runs = 0;
  const worker = new Worker({
    store,
    config: { org },
    ingestion: {
      sync: async () => {
        runs++;
        await store.enqueue(
          org,
          "ingest",
          {},
          "generated-" + runs,
          Date.now() + 1,
        );
      },
    },
  });
  await store.enqueue(org, "ingest", {}, "initial");
  const result = await worker.drain();
  assert.equal(result.processed, 1);
  assert.equal(runs, 1);
  assert.equal(
    (await store.query("SELECT COUNT(*) FROM jobs WHERE state='queued'"))
      .rows[0].count,
    1,
  );
});
test("a new repair decision preserves completed physical work and refuses to dispatch it again", async (t) => {
  const store = await setup(t),
    d = new Domain(store, { peers: [] }),
    delivered = {
      owner: org,
      type: "dispatch",
      params: { vehicle: "v1", resource: "r1", need: "n", quantity: 5 },
      dependsOn: [],
    };
  await store.put(
    org,
    "operation",
    "received",
    {
      state: "received",
      confirmedBySource: true,
      quantity: 5,
      times: { received: 20000 },
    },
    0,
  );
  await store.put(
    org,
    "proposal",
    "old",
    {
      state: "requires_review",
      actions: [delivered],
      executionResults: [{ index: 0, result: { id: "received" } }],
      changedReason: "Another dependency changed",
      previousAuthorization: { by: "old-owner" },
      conditions: [],
      references: [],
      dependencies: [],
    },
    0,
  );
  const draft = {
    title: "Repair only remaining work",
    summary: "Completed help stays completed",
    benefit: "Keep useful work",
    references: ["received"],
    conditions: [],
    actions: [delivered],
    rationale: "Only future changes need authority.",
  };
  await assert.rejects(
    () => d.propose(actor, draft, "repeat", { repairOf: "old" }),
    (e) => e.code === "REPAIR_DUPLICATES_COMPLETED",
  );
  const p = await d.propose(
    actor,
    {
      ...draft,
      actions: [{ type: "coverage", owner: org, params: {}, dependsOn: [] }],
    },
    "new-repair",
    { repairOf: "old" },
  );
  assert.equal(p.authorization, null);
  assert.equal(p.repairOf, "old");
  assert.equal(p.inheritedWork[0].operationId, "received");
  assert.equal(p.inheritedWork[0].receipt.times.received, 20000);
  assert.equal(
    (await store.get(org, "proposal", "old")).state,
    "requires_review",
  );
  const authorized = await d.review(
    actor,
    p.id,
    { version: p.version, decision: "approve" },
    "review-repair",
  );
  assert.equal(authorized.authorization.by, actor.id);
  assert.equal(authorized.inheritedWork.length, 1);
  assert.equal(
    authorized.executionResults,
    undefined,
    "Inherited history is not a new executable action",
  );
});
