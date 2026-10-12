import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import {
  allocationPlan,
  validatePlan,
  validateDispatchReservation,
} from "../src/planning.mjs";
import { receivedAllocationPlan } from "../src/received-allocation.mjs";
import { parameterSchemas } from "../src/contracts.mjs";
import { actionBrief } from "../ui/uploads.mjs";
import { createHarness } from "../evaluation/harness.mjs";

const execution = {
  reservation: { defaultTtlMs: 900000, maxTtlMs: 86400000 },
  delivery: { loadMs: 60000, unloadMs: 60000, commandNominalLatencyMs: 1000 },
};
const map = {
  roads: [
    { id: "FR", from: "F", to: "R", lengthM: 12000, speedMps: 10 },
    { id: "RN", from: "R", to: "N", lengthM: 300, speedMps: 10 },
  ],
};
const resource = {
  id: "r",
  owner: "a",
  node: "R",
  type: "water",
  quantity: 100,
  reserved: 0,
  floor: 10,
};
const vehicle = {
  id: "v",
  owner: "a",
  node: "F",
  state: "idle",
  capacity: 100,
  speedMps: 10,
  weightKg: 1000,
};
const need = { id: "n", type: "water", node: "N", quantity: 30, served: 0 };
const action = (ttlMs) => ({
  type: "dispatch",
  owner: "a",
  params: {
    resource: "r",
    vehicle: "v",
    need: "n",
    quantity: 30,
    ...(ttlMs === undefined ? {} : { ttlMs }),
  },
  dependsOn: [],
});
async function fixture(t) {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("a");
  for (const [kind, row] of [
    ["resource", resource],
    ["vehicle", vehicle],
    ["need", need],
  ])
    await s.upsert("a", kind, row.id, row);
  await s.upsert("a", "context", "geography", { map });
  await s.upsert("a", "context", "operational", {
    snapshot: {
      now: 1000,
      queries: [
        {
          id: "received-policy",
          target: "policy",
          state: "ready",
          completedAt: 1000,
          result: { execution, observedAt: 1000, version: 1 },
        },
      ],
    },
  });
  return s;
}

test("shared received allocator includes empty pickup, source loading and declared margin in reviewed TTL", async (t) => {
  const s = await fixture(t),
    plan = await receivedAllocationPlan(s, { org: "a", peers: [] });
  assert.equal(plan.allocations[0].ttlMs, 1440000);
  assert.equal(plan.actions[0].params.ttlMs, 1440000);
  assert.equal(plan.allocations[0].reservationEstimate.pickupMs, 1200000);
  assert.equal(plan.allocations[0].reservationEstimate.marginMs, 120000);
  assert.equal(
    plan.allocations[0].reservationEstimate.sourcePolicyQuery,
    "received-policy",
  );
  const checked = await validatePlan(s, "a", {
    id: "p",
    actions: plan.actions,
  });
  assert.equal(
    checked.find((c) => c.type === "dispatch_reservation").ttlMs,
    1440000,
  );
  assert.match(actionBrief(plan.actions[0]), /24-minute stock reservation/);
});

test("owner refuses an implicit or explicit short window and rechecks changed pickup before issuing", async (t) => {
  const s = await fixture(t);
  for (const ttl of [undefined, 900000])
    await assert.rejects(
      validatePlan(s, "a", { id: "p", actions: [action(ttl)] }),
      (e) => e.code === "RESERVATION_TOO_SHORT",
    );
  await s.upsert("a", "road", "FR", { open: true, lengthM: 24000 });
  await assert.rejects(
    validateDispatchReservation(s, "a", action(1440000).params),
    (e) => e.code === "RESERVATION_TOO_SHORT",
  );
  assert.equal((await s.get("a", "resource", "r")).reserved, 0);
});

test("default remains fifteen minutes for short or unavailable received timing; unknown timing is explicit", () => {
  const base = {
    needs: [need],
    resources: [resource],
    vehicles: [{ ...vehicle, node: "R" }],
    map,
  };
  const short = allocationPlan({ ...base, executionPolicy: execution });
  assert.equal(short.allocations[0].ttlMs, 900000);
  const unknown = allocationPlan(base);
  assert.equal(unknown.allocations[0].ttlMs, 900000);
  assert.equal(unknown.allocations[0].reservationEstimate.timingKnown, false);
  assert.equal(unknown.allocations[0].reservationEstimate.loadMs, null);
});

test("no allocator silently reserves over a day or changes an existing bilateral expiry", async (t) => {
  const s = await fixture(t);
  const excessive = allocationPlan({
    needs: [need],
    resources: [resource],
    vehicles: [vehicle],
    executionPolicy: execution,
    map: { roads: [{ ...map.roads[0], lengthM: 900000 }, map.roads[1]] },
  });
  assert.equal(excessive.allocations.length, 0);
  const params = { ...action(1440000).params, commitment: "already-approved" };
  await assert.rejects(
    validateDispatchReservation(s, "a", params),
    (e) => e.code === "RESERVATION_SCOPE",
  );
  const context = await s.get("a", "context", "operational");
  await s.upsert("a", "context", "operational", {
    snapshot: {
      ...context.snapshot,
      commitments: [
        { id: "already-approved", state: "confirmed", expiresAt: 901000 },
      ],
    },
  });
  delete params.ttlMs;
  await assert.rejects(
    validateDispatchReservation(s, "a", params),
    (e) => e.code === "RESERVATION_TOO_SHORT",
  );
  assert.equal(
    (await s.get("a", "context", "operational")).snapshot.commitments[0]
      .expiresAt,
    901000,
  );
});

test("typed dispatch rejects malformed or unbounded durations before authorization", () => {
  for (const ttlMs of [0, -1, 1.5, NaN, 86400001])
    assert.equal(
      parameterSchemas.dispatch.safeParse({ ...action().params, ttlMs })
        .success,
      false,
    );
  assert.equal(
    parameterSchemas.dispatch.parse({ ...action().params, ttlMs: 86400000 })
      .ttlMs,
    86400000,
  );
});

test(
  "owner-approved received TTL carries a real long pickup through HTTP to loading and physical service",
  { timeout: 60000 },
  async (t) => {
    const h = await createHarness({
      scenario: "S01",
      seed: "reviewed-long-pickup",
      config: {
        grid: 5,
        extentKm: 12,
        hazard: "none",
        postsPerHour: 0,
        backgroundTraffic: 0,
        loadMs: 60000,
        unloadMs: 60000,
        durationMs: 14400000,
      },
    });
    t.after(() => h.close());
    const app = h.apps[0],
      w = h.lab.world;
    const owned = w.state.vehicles.filter((v) => v.owner === "org0");
    owned[0].node = w.state.map.nodes.at(-1).id;
    for (const v of owned.slice(1)) v.state = "disabled";
    for (const v of owned) w.reportVehicle(v);
    w.advance(60000);
    for (const target of ["inventory", "vehicles", "map", "policy"])
      await app.connector.action(
        "query",
        { target },
        "ttl-regression-" + target,
      );
    await app.ingestion.sync();
    const plan = await receivedAllocationPlan(app.store, app.config);
    assert.ok(plan.actions.length > 0);
    assert.ok(plan.actions[0].params.ttlMs > 900000);
    const proposal = await app.domain.propose(
      { org: "org0", id: "test-agent", role: "agent" },
      {
        title: "Long observed pickup with an explicit stock window",
        summary: "A received travel estimate defines the bounded hold.",
        benefit: "Proportionate water service",
        rationale:
          "The owner reviews a concrete duration, not an unlimited hold.",
        references: plan.evidenceIds,
        actions: plan.actions,
        conditions: [],
        alternatives: [],
      },
      "long-pickup-draft",
    );
    await app.domain.review(
      { org: "org0", id: "responsible-owner", role: "commander" },
      proposal.id,
      {
        version: proposal.version,
        decision: "approve",
        note: "Reviewed pickup and loading window.",
      },
      "long-pickup-approval",
    );
    await app.worker.execute(proposal.id);
    const operation = w.state.operations.find(
      (o) => o.type === "delivery" && o.org === "org0",
    );
    assert.ok(operation);
    const commitment = w.state.commitments.find(
      (c) => c.id === operation.commitment,
    );
    assert.equal(
      commitment.expiresAt - commitment.createdAt,
      plan.actions[0].params.ttlMs,
    );
    w.advance(w.now + plan.actions[0].params.ttlMs + 3600000);
    await app.ingestion.sync();
    await app.worker.execute(proposal.id);
    assert.equal(operation.state, "completed");
    assert.ok(
      operation.times.pickupArrived - operation.times.authorized > 900000,
    );
    assert.equal(
      (await app.store.get("org0", "proposal", proposal.id)).state,
      "completed",
    );
    assert.equal(operation.received, plan.actions[0].params.quantity);
    assert.equal(
      (await app.store.query("SELECT COUNT(*) AS n FROM usage")).rows[0].n,
      0,
    );
  },
);
