import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { allocationPlan, validatePlan } from "../src/planning.mjs";
import { receivedAllocationPlan } from "../src/received-allocation.mjs";
import { receivedVehicleCalendar } from "../src/received-vehicle-calendar.mjs";

const executionPolicy = {
  reservation: { defaultTtlMs: 900000, maxTtlMs: 86400000 },
  delivery: { loadMs: 10000, unloadMs: 10000, commandNominalLatencyMs: 1000 },
};
const roads = [
  ["a", "s"],
  ["s", "a"],
  ["b", "s"],
  ["s", "b"],
].map(([from, to]) => ({
  id: from + to,
  from,
  to,
  lengthM: 1000,
  speedMps: 10,
  maxWeight: 10000,
  open: true,
}));
const calendar = {
  version: 1,
  observedAt: 600000,
  availableAfter: 600000,
  availableUntil: 1100000,
  nextCommitment: { id: "next-shift", startsAt: 1000000, node: "b" },
};
const v = {
  id: "returning-truck",
  owner: "org1",
  node: "b",
  state: "arrived",
  capacity: 300,
  weightKg: 2000,
  speedMps: 10,
  maxCargoKg: 300,
  fuel: 1000,
  fuelMlPerKm: 100,
  calendar,
};
const input = {
  now: 700000,
  pickup: { seconds: 0, distanceM: 0 },
  delivery: { seconds: 100, distanceM: 1000 },
  returnRoute: { seconds: 100, distanceM: 1000 },
  executionPolicy,
};

test("received owner windows include loading, delivery, unloading and return to the next commitment", () => {
  const result = receivedVehicleCalendar(v, input);
  assert.equal(result.usable, true);
  assert.equal(result.serviceAt, 821000);
  assert.equal(result.nextReturnAt, 921000);
  assert.equal(result.nextCommitment.id, "next-shift");
  for (const [patch, reason] of [
    [{ availableAfter: 800000 }, "calendar_not_available"],
    [{ availableUntil: 921000 }, "calendar_window"],
    [
      { nextCommitment: { ...calendar.nextCommitment, startsAt: 920999 } },
      "calendar_next_commitment",
    ],
    [{ observedAt: 700001 }, "calendar_evidence"],
    [{ nextCommitment: { startsAt: 1000000 } }, "calendar_evidence"],
  ])
    assert.equal(
      receivedVehicleCalendar(
        { ...v, calendar: { ...calendar, ...patch } },
        input,
      ).reason,
      reason,
    );
  assert.equal(
    receivedVehicleCalendar(v, { ...input, returnRoute: null }).reason,
    "calendar_return_route",
  );
  assert.equal(
    receivedVehicleCalendar(v, { ...input, executionPolicy: null }).reason,
    "calendar_timing_unknown",
  );
  assert.equal(
    receivedVehicleCalendar(v, { ...input, now: undefined }).reason,
    "calendar_evidence",
  );
  assert.equal(
    receivedVehicleCalendar({ ...v, calendar: null }).declared,
    false,
  );
});

function fixture() {
  return {
    now: 700000,
    needs: [
      { id: "water", type: "water", quantity: 600, served: 0, node: "s" },
    ],
    resources: ["org0", "org1"].map((owner, i) => ({
      id: "water-" + owner,
      owner,
      type: "water",
      quantity: 300,
      node: i ? "b" : "a",
      reserved: 0,
      floor: 0,
    })),
    vehicles: [
      { ...v, id: "first", owner: "org0", node: "a", calendar: undefined },
      v,
    ],
    map: { roads, places: [] },
    executionPolicy,
  };
}

test("the common allocator exposes future calendars but never allocates a busy truck; short windows and return fuel preserve a visible partial deficit", () => {
  const f = fixture();
  const good = allocationPlan(f);
  assert.equal(good.allocations.length, 2);
  assert.equal(
    good.allocations.reduce((s, a) => s + a.quantity, 0),
    600,
  );
  const second = good.allocations.find((a) => a.owner === "org1");
  assert.equal(second.travelEstimate.calendar.nextReturnAt, 921000);
  assert.equal(second.travelEstimate.fuelMl, 200);
  for (const patch of [
    { state: "working" },
    { calendar: { ...calendar, availableAfter: 800000 } },
    { calendar: { ...calendar, availableUntil: 900000 } },
    {
      calendar: {
        ...calendar,
        nextCommitment: { ...calendar.nextCommitment, startsAt: 900000 },
      },
    },
    { fuel: 150 },
  ]) {
    const result = allocationPlan({
      ...f,
      vehicles: [f.vehicles[0], { ...v, ...patch }],
    });
    assert.equal(
      result.allocations.reduce((s, a) => s + a.quantity, 0),
      300,
    );
    assert.equal(result.unserved[0].remaining, 300);
    if (patch.calendar)
      assert.equal(
        result.unserved[0].blockingReasons[0].code,
        "VEHICLE_CALENDAR",
      );
  }
  assert.equal(
    allocationPlan({ ...f, map: undefined }).allocations.some(
      (a) => a.owner === "org1",
    ),
    false,
  );
});

async function storeFixture(t, org = "org1") {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization(org);
  await store.put(org, "source", "simulator", { simulatedAt: 700000 }, 0);
  await store.put(
    org,
    "context",
    "operational",
    {
      snapshot: {
        now: 700000,
        queries: [
          {
            id: "timing",
            target: "policy",
            state: "ready",
            completedAt: 700000,
            result: {
              version: 1,
              observedAt: 700000,
              execution: executionPolicy,
            },
          },
        ],
      },
    },
    0,
  );
  await store.put(
    org,
    "context",
    "geography",
    {
      map: { nodes: ["a", "b", "s"].map((id) => ({ id })), roads, places: [] },
    },
    0,
  );
  await store.put(org, "need", "water", fixture().needs[0], 0);
  await store.put(org, "resource", "water-org1", fixture().resources[1], 0);
  await store.put(org, "vehicle", v.id, v, 0);
  return store;
}
const action = {
  type: "dispatch",
  owner: "org1",
  dependsOn: [],
  params: {
    vehicle: v.id,
    resource: "water-org1",
    need: "water",
    destination: "s",
    quantity: 300,
  },
};

test("owner review rechecks a changed received window before emission and retains the exact return evidence", async (t) => {
  const store = await storeFixture(t);
  const valid = await validatePlan(store, "org1", { actions: [action] });
  const route = valid.find((c) => c.type === "route");
  assert.equal(route.calendar.nextReturnAt, 921000);
  assert.deepEqual(route.returnRoute.nodes, ["s", "b"]);
  await store.upsert("org1", "vehicle", v.id, {
    calendar: {
      ...calendar,
      version: 2,
      nextCommitment: { ...calendar.nextCommitment, startsAt: 900000 },
    },
  });
  await assert.rejects(validatePlan(store, "org1", { actions: [action] }), {
    code: "VEHICLE_CALENDAR",
  });
  assert.equal((await store.list("org1", "proposal")).length, 0);
  assert.equal((await store.get("org1", "resource", "water-org1")).reserved, 0);
});

test("received road congestion consumes the same nominal window and produces an observable refusal", async (t) => {
  const store = await storeFixture(t);
  await store.put(
    "org1",
    "road",
    "bs",
    { open: true, congestionMs: 180000 },
    0,
  );
  await assert.rejects(validatePlan(store, "org1", { actions: [action] }), {
    code: "VEHICLE_CALENDAR",
  });
  const f = fixture(),
    plan = allocationPlan({
      ...f,
      observedRoads: { bs: { open: true, congestionMs: 180000 } },
    });
  assert.equal(plan.unserved[0].remaining, 300);
  assert.equal(
    plan.unserved[0].blockingReasons[0].reason,
    "calendar_next_commitment",
  );
});

test("a constrained reroute checks the remaining original aid trip and return, loading only when the received phase is pickup", async (t) => {
  const store = await storeFixture(t);
  const op = await store.put(
    "org1",
    "operation",
    "existing-cargo",
    {
      org: "org1",
      vehicle: v.id,
      type: "delivery",
      state: "blocked",
      resource: "water-org1",
      resourceType: "water",
      quantity: 300,
      received: 0,
      destination: "s",
      confirmedBySource: true,
      times: { prepared: 600000 },
    },
    0,
  );
  await store.upsert("org1", "vehicle", v.id, {
    operation: op.id,
    state: "blocked",
    destination: "s",
  });
  const reroute = {
    type: "reroute",
    owner: "org1",
    dependsOn: [],
    params: { vehicle: v.id, destination: "s" },
  };
  const loaded = (await validatePlan(store, "org1", { actions: [reroute] }))[0];
  assert.equal(
    loaded.calendar.serviceAt,
    811000,
    "A loaded truck is not loaded a second time.",
  );
  assert.equal(loaded.calendar.nextReturnAt, 911000);
  await store.upsert("org1", "operation", op.id, {
    phase: "pickup",
    times: {},
  });
  await store.upsert("org1", "vehicle", v.id, { destination: "b" });
  const pickupAction = {
    ...reroute,
    params: { ...reroute.params, destination: "b" },
  };
  const pickup = (
    await validatePlan(store, "org1", { actions: [pickupAction] })
  )[0];
  assert.equal(pickup.calendar.serviceAt, 821000);
  assert.equal(pickup.calendar.nextReturnAt, 921000);
  assert.equal((await store.get("org1", "operation", op.id)).destination, "s");
  await store.upsert("org1", "vehicle", v.id, {
    calendar: {
      ...calendar,
      nextCommitment: { ...calendar.nextCommitment, startsAt: 920999 },
    },
  });
  await assert.rejects(
    validatePlan(store, "org1", { actions: [pickupAction] }),
    { code: "VEHICLE_CALENDAR" },
  );
});

test("the received compiler honors a consented peer calendar without reading another organization's private calendar", async (t) => {
  const store = await storeFixture(t, "org0");
  await store.organization("org1");
  await store.put(
    "org1",
    "vehicle",
    v.id,
    { ...v, calendar: { ...calendar, availableUntil: 9000000 } },
    0,
  );
  await store.put("org0", "resource", "water-org0", fixture().resources[0], 0);
  await store.put("org0", "vehicle", "first", fixture().vehicles[0], 0);
  for (const [kind, projection] of [
    ["resource", { ...fixture().resources[1], available: 300 }],
    ["vehicle", { ...v, calendar: { ...calendar, availableUntil: 900000 } }],
  ]) {
    await store.put(
      "org0",
      "peer_offer",
      "shared-" + kind,
      {
        from: "org1",
        kind,
        active: true,
        permissionVersion: 1,
        expiresAt: Date.now() + 60000,
        projection,
      },
      0,
    );
  }
  const plan = await receivedAllocationPlan(store, {
    org: "org0",
    peers: [{ org: "org1" }],
  });
  assert.equal(
    plan.allocations.reduce((sum, a) => sum + a.quantity, 0),
    300,
  );
  assert.equal(plan.unserved[0].remaining, 300);
  assert.equal(
    plan.actions.some((a) => a.owner === "org1"),
    false,
  );
});
