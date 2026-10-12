import test from "node:test";
import assert from "node:assert/strict";
import { allocationPlan } from "../src/planning.mjs";
import {
  receivedAllocationPlan,
  validateAllocationOffers,
} from "../src/received-allocation.mjs";
import { Store } from "../src/store.mjs";

const road = (id, from, to, lengthM, extra = {}) => ({
  id,
  from,
  to,
  lengthM,
  speedMps: 10,
  ...extra,
});
const stock = (owner, node, extra = {}) => ({
  id: "water",
  owner,
  node,
  type: "water",
  quantity: 100,
  reserved: 0,
  floor: 10,
  ...extra,
});
const truck = (owner, node, extra = {}) => ({
  id: "truck",
  owner,
  node,
  state: "idle",
  capacity: 100,
  weightKg: 3000,
  speedMps: 10,
  ...extra,
});
const request = (extra = {}) => ({
  id: "need",
  node: "N",
  type: "water",
  quantity: 30,
  served: 0,
  priority: 10,
  ...extra,
});

function fixture() {
  return {
    needs: [request()],
    resources: [stock("a", "A"), stock("b", "B")],
    vehicles: [truck("a", "F"), truck("b", "B")],
    map: {
      roads: [
        road("FA", "F", "A", 1000),
        road("AN", "A", "N", 10),
        road("BN", "B", "N", 100),
      ],
    },
  };
}

test("a truck beside the destination is slower if it must first return to distant stock", () => {
  const plan = allocationPlan(fixture());
  assert.equal(plan.allocations[0].owner, "b");
  assert.equal(plan.allocations[0].quantity, 30);
  assert.equal(plan.allocations[0].travelEstimate.seconds, 10);
  assert.deepEqual(plan.allocations[0].travelEstimate.pickup.nodes, ["B"]);
  assert.equal(plan.doesNotDispatch, true);
  assert.equal(plan.allocations[0].needsRouteCheck, true);
});

test("received closure changes the selected owner while unknown roads remain explicit uncertainty", () => {
  const f = fixture();
  const plan = allocationPlan({ ...f, observedRoads: { BN: { open: false } } });
  assert.equal(plan.allocations[0].owner, "a");
  assert.equal(plan.allocations[0].travelEstimate.seconds, 101);
  assert.deepEqual(plan.allocations[0].travelEstimate.unknownEdges, [
    "FA",
    "AN",
  ]);
  assert.equal(
    allocationPlan({
      ...f,
      observedRoads: { BN: { open: false }, FA: { open: false } },
    }).allocations.length,
    0,
  );
});

test("fuel and remaining shift include pickup rather than checking delivery alone", () => {
  const f = fixture();
  for (const limitation of [
    { fuel: 100, fuelMlPerKm: 1000 },
    { shiftEnd: 101000 },
  ]) {
    const plan = allocationPlan({
      ...f,
      now: 1000,
      vehicles: [truck("a", "F", limitation), truck("b", "B")],
    });
    assert.equal(plan.allocations[0].owner, "b");
  }
  const ownOnly = allocationPlan({
    ...f,
    resources: [f.resources[0]],
    vehicles: [truck("a", "F", { fuel: 100, fuelMlPerKm: 1000 })],
  });
  assert.equal(ownOnly.unserved[0].remaining, 30);
});

test("loaded gross weight can make a short bridge infeasible even when the empty pickup is feasible", () => {
  const f = fixture();
  f.map.roads.find((r) => r.id === "BN").maxWeight = 3020;
  assert.equal(allocationPlan(f).allocations[0].owner, "a");
  assert.equal(
    allocationPlan({ ...f, needs: [request({ quantity: 10 })] }).allocations[0]
      .owner,
    "b",
  );
});

test("travel choice preserves approved demand priority and native protected quantities", () => {
  const f = fixture();
  f.needs = [
    request({ id: "near", node: "A", priority: 1, quantity: 10 }),
    request({ id: "urgent", priority: 20, quantity: 95 }),
  ];
  f.resources = [stock("a", "A", { quantity: 100, reserved: 15, floor: 25 })];
  f.vehicles = [truck("a", "A")];
  const plan = allocationPlan({
    ...f,
    policy: { order: "priority_then_deadline" },
  });
  assert.equal(plan.allocations[0].need, "urgent");
  assert.equal(plan.allocations[0].quantity, 60);
  assert.equal(plan.unserved.find((n) => n.need === "urgent").remaining, 35);
  assert.equal(plan.unserved.find((n) => n.need === "near").remaining, 10);
});

test("arrived cargo awaiting receipt holds its exact owner's vehicle without blocking another owner's same ID", () => {
  const f = fixture();
  f.vehicles[0].node = "A";
  f.vehicles[0].state = "arrived";
  const operations = [
    { id: "pending", org: "a", vehicle: "truck", state: "arrived" },
  ];
  assert.equal(allocationPlan({ ...f, operations }).allocations[0].owner, "b");
  assert.equal(
    allocationPlan({
      ...f,
      operations: [{ ...operations[0], state: "completed" }],
    }).allocations[0].owner,
    "a",
  );
});

test("cargo volume and mass constrain native energy units without consuming reserves", () => {
  const plan = allocationPlan({
    needs: [request({ type: "energy", quantity: 4, unit: "unit" })],
    resources: [
      stock("a", "A", { type: "energy", quantity: 10, reserved: 3, floor: 1 }),
    ],
    vehicles: [
      truck("a", "A", { capacity: 10, maxCargoKg: 300, volumeM3: 0.5 }),
    ],
    map: { roads: [road("AN", "A", "N", 50)] },
  });
  assert.equal(plan.allocations[0].quantity, 2);
  assert.equal(plan.unserved[0].remaining, 2);
  assert.equal(plan.unserved[0].unit, "unit");
});

test("received compiler uses consented peer locations, received clock and roads, then rechecks offer authority", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("a");
  await s.organization("b");
  const f = fixture();
  await s.upsert("a", "need", "need", request());
  await s.upsert("a", "resource", "water", stock("a", "A"));
  await s.upsert(
    "a",
    "vehicle",
    "truck",
    truck("a", "F", { shiftEnd: 101000 }),
  );
  await s.upsert("a", "source", "simulator", { simulatedAt: 1000 });
  await s.upsert("a", "context", "geography", { map: f.map });
  for (const [kind, projection] of [
    ["resource", { ...stock("b", "B"), available: 90 }],
    ["vehicle", truck("b", "B")],
  ])
    await s.upsert("a", "peer_offer", "b-" + kind, {
      from: "b",
      kind,
      active: true,
      expiresAt: Date.now() + 100000,
      permissionVersion: 1,
      projection,
    });
  await s.upsert(
    "b",
    "resource",
    "private",
    stock("b", "N", { quantity: 90000 }),
  );
  const config = { org: "a", peers: [{ org: "b" }] },
    plan = await receivedAllocationPlan(s, config);
  assert.equal(plan.allocations[0].owner, "b");
  assert.equal(plan.allocations[0].travelEstimate.at, 1000);
  assert.ok(plan.allocations[0].evidenceIds.includes("b-resource"));
  assert.equal(
    plan.allocations.some((a) => a.resource === "private"),
    false,
  );
  await validateAllocationOffers(s, config, plan.allocations);
  await s.upsert("a", "road", "BN", { open: false });
  assert.equal((await receivedAllocationPlan(s, config)).allocations.length, 0);
  await s.upsert("a", "peer_offer", "b-resource", { active: false });
  await assert.rejects(
    validateAllocationOffers(s, config, plan.allocations),
    (e) => e.code === "SHARED_CAPACITY_CHANGED",
  );
});
