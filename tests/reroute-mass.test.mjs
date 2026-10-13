import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { validatePlan } from "../src/planning.mjs";
import { receivedVehicleWeight } from "../src/received-vehicle-weight.mjs";
import { checkedRepairPlan } from "../src/response-repair.mjs";
import { route as physicalRoute } from "../../disaster-response-simulator/generators/map.mjs";

const vehicle = {
  id: "truck",
  owner: "org0",
  operation: "cargo",
  node: "a",
  state: "blocked",
  weightKg: 3000,
  maxCargoKg: 1000,
  capacity: 1000,
  volumeM3: 10,
  seats: 50,
  speedMps: 10,
  maxWaterDepth: 0.3,
};
const operation = {
  id: "cargo",
  org: "org0",
  vehicle: "truck",
  type: "delivery",
  state: "blocked",
  resourceType: "water",
  quantity: 300,
  received: 0,
  destination: "b",
  confirmedBySource: true,
  times: { prepared: 10, dispatched: 10 },
};
const action = {
  type: "reroute",
  owner: "org0",
  params: { vehicle: "truck", destination: "b" },
  dependsOn: [],
};
const roads = [
  {
    id: "light-bridge",
    from: "a",
    to: "b",
    lengthM: 100,
    speedMps: 10,
    maxWeight: 3100,
  },
  {
    id: "heavy-out",
    from: "a",
    to: "c",
    lengthM: 250,
    speedMps: 10,
    maxWeight: 10000,
  },
  {
    id: "heavy-back",
    from: "c",
    to: "b",
    lengthM: 250,
    speedMps: 10,
    maxWeight: 10000,
  },
];
async function setup(t, edges = roads, op = operation, v = vehicle) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.put(
    "org0",
    "context",
    "geography",
    {
      map: {
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        roads: edges,
        places: [],
      },
    },
    0,
  );
  await store.put("org0", "vehicle", "truck", v, 0);
  await store.put("org0", "operation", "cargo", op, 0);
  for (const e of edges)
    await store.put("org0", "road", e.id, { open: true, waterDepth: 0 }, 0);
  return store;
}

test("loaded reroute excludes the short light bridge and agrees with the physical route kernel using the same received restrictions", async (t) => {
  const store = await setup(t);
  const checks = await validatePlan(store, "org0", { actions: [action] });
  assert.deepEqual(checks[0].nodes, ["a", "c", "b"]);
  assert.equal(checks[0].grossMass.weightKg, 3300);
  assert.equal(checks[0].grossMass.cargoKg, 300);
  const physicallyFeasible = physicalRoute(
    { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: roads },
    "a",
    "b",
    { ...vehicle, load: 300, resourceType: "water" },
    Object.fromEntries(roads.map((e) => [e.id, { open: true, waterDepth: 0 }])),
  );
  assert.deepEqual(physicallyFeasible.edges, ["heavy-out", "heavy-back"]);
  assert.equal(physicallyFeasible.distanceM, checks[0].distanceM);
  assert.equal(checks[0].distanceM, 500);
});

test("a loaded truck with only an empty-weight-feasible route is rejected before owner review or source emission", async (t) => {
  const store = await setup(t, [roads[0]]);
  await assert.rejects(validatePlan(store, "org0", { actions: [action] }), {
    code: "NO_KNOWN_ROUTE",
  });
  assert.equal((await store.list("org0", "proposal")).length, 0);
  assert.equal((await store.get("org0", "operation", "cargo")).quantity, 300);
  assert.equal(
    (await store.get("org0", "operation", "cargo")).state,
    "blocked",
  );
});

test("empty pickup, unloaded receipts and completed return do not retain phantom cargo; recovery returning still carries the same load", () => {
  assert.equal(
    receivedVehicleWeight(vehicle, { ...operation, phase: "pickup", times: {} })
      .weightKg,
    3000,
  );
  assert.equal(
    receivedVehicleWeight(vehicle, {
      ...operation,
      state: "loading",
      phase: "pickup",
      times: {},
    }).weightKg,
    3300,
    "Loading without a completed load receipt remains conservatively cargo constrained",
  );
  assert.equal(
    receivedVehicleWeight(
      { ...vehicle, load: 300 },
      { ...operation, state: "returning", received: 300 },
    ).weightKg,
    3000,
  );
  assert.equal(
    receivedVehicleWeight(
      { ...vehicle, load: 300 },
      { ...operation, state: "returning", times: { returned: 100 } },
    ).weightKg,
    3000,
  );
  assert.equal(
    receivedVehicleWeight(vehicle, {
      ...operation,
      type: "recovery",
      state: "returning",
    }).weightKg,
    3300,
  );
  assert.equal(
    receivedVehicleWeight(vehicle, { ...operation, received: 100 }).weightKg,
    3200,
  );
});

test("generator mass and occupied evacuation are constrained by actual cargo units; old GPS load zero cannot erase the received load", () => {
  assert.equal(
    receivedVehicleWeight({ ...vehicle, load: 0 }, operation).weightKg,
    3300,
  );
  assert.equal(
    receivedVehicleWeight(vehicle, {
      ...operation,
      resourceType: "energy",
      quantity: 2,
    }).weightKg,
    3300,
  );
  assert.equal(
    receivedVehicleWeight(vehicle, {
      ...operation,
      type: "evacuation",
      quantity: 10,
      phase: "shelter",
    }).weightKg,
    3750,
  );
  assert.equal(
    receivedVehicleWeight(vehicle, {
      ...operation,
      type: "evacuation",
      quantity: 10,
      phase: "pickup",
      times: {},
    }).weightKg,
    3000,
  );
});

test("unknown cargo uses an explicit received mass bound or asks for evidence, never assumes it is empty or one kilogram per generator", () => {
  const bound = receivedVehicleWeight(vehicle, {
    ...operation,
    resourceType: undefined,
  });
  assert.equal(bound.weightKg, 4000);
  assert.equal(bound.basis, "received_cargo_mass_bound");
  assert.throws(
    () =>
      receivedVehicleWeight(
        { ...vehicle, maxCargoKg: undefined },
        { ...operation, resourceType: undefined },
      ),
    { code: "VEHICLE_LOAD_UNKNOWN" },
  );
  assert.throws(
    () => receivedVehicleWeight({ ...vehicle, weightKg: undefined }, operation),
    { code: "VEHICLE_WEIGHT_UNKNOWN" },
  );
  assert.throws(
    () =>
      receivedVehicleWeight(
        { ...vehicle, operation: "other-current-trip" },
        operation,
      ),
    { code: "VEHICLE_LOAD_SCOPE" },
  );
  assert.throws(
    () =>
      receivedVehicleWeight(vehicle, {
        ...operation,
        confirmedBySource: false,
      }),
    { code: "VEHICLE_LOAD_SCOPE" },
  );
});

test("reroute validator incorporates occupied seats and permits the empty pickup through the lighter corridor", async (t) => {
  const store = await setup(t, roads, {
    ...operation,
    type: "evacuation",
    phase: "pickup",
    times: {},
    quantity: 10,
  });
  const empty = await validatePlan(store, "org0", { actions: [action] });
  assert.deepEqual(empty[0].nodes, ["a", "b"]);
  const old = await store.get("org0", "operation", "cargo");
  await store.put(
    "org0",
    "operation",
    "cargo",
    { ...old, phase: "shelter" },
    old.version,
  );
  await store.put(
    "org0",
    "facility",
    "shelter",
    {
      node: "b",
      state: "operating",
      safe: true,
      capacity: 100,
      occupancy: 0,
      reservedPlaces: 10,
    },
    0,
  );
  const occupied = await validatePlan(store, "org0", {
    actions: [{ ...action, params: { ...action.params, building: "shelter" } }],
  });
  assert.deepEqual(occupied[0].nodes, ["a", "c", "b"]);
  assert.equal(occupied[0].grossMass.passengerKg, 750);
});

test("empty cargo pickup repair stays at the exact received stock location and preserves the later aid destination", async (t) => {
  const store = await setup(
    t,
    roads,
    { ...operation, resource: "owned-stock", phase: "pickup", times: {} },
    { ...vehicle, destination: "c" },
  );
  await store.put(
    "org0",
    "resource",
    "owned-stock",
    { owner: "org0", type: "water", node: "c", quantity: 300 },
    0,
  );
  const original = await store.put(
    "org0",
    "proposal",
    "original",
    {
      state: "requires_review",
      actions: [
        {
          type: "dispatch",
          owner: "org0",
          params: {
            vehicle: "truck",
            resource: "owned-stock",
            destination: "b",
            quantity: 300,
          },
          dependsOn: [],
        },
      ],
      references: ["cargo", "truck", "owned-stock"],
      executionResults: [{ index: 0, result: { operation: "cargo" } }],
    },
    0,
  );
  await assert.rejects(validatePlan(store, "org0", { actions: [action] }), {
    code: "DESTINATION",
  });
  const repaired = await checkedRepairPlan(
    store,
    { org: "org0" },
    { proposalId: original.id },
  );
  assert.equal(repaired.readyToDraft, true);
  assert.equal(repaired.actions[0].params.destination, "c");
  assert.equal(repaired.actions[0].params.need, undefined);
  assert.equal(repaired.actions[0].params.building, undefined);
  assert.ok(repaired.references.includes("owned-stock"));
  assert.equal(repaired.versions[0].checks[0].grossMass.cargoKg, 0);
  assert.equal(
    (await store.get("org0", "operation", "cargo")).destination,
    "b",
  );
  assert.equal(
    (await store.get("org0", "proposal", "original")).state,
    "requires_review",
  );
  await store.upsert("org0", "resource", "owned-stock", { node: null });
  const unresolved = await checkedRepairPlan(
    store,
    { org: "org0" },
    { proposalId: original.id },
  );
  assert.equal(unresolved.readyToDraft, false);
  assert.equal(unresolved.pending[0].code, "PICKUP_OBSERVATION");
  assert.equal(unresolved.actions.length, 0);
});

test("a field crew reroute cannot turn an approved assessment or repair into work at another facility", async (t) => {
  for (const type of ["inspection", "repair"]) {
    const store = await setup(t, roads, { ...operation, type, times: {} });
    await store.put(
      "org0",
      "facility",
      "other-site",
      { node: "c", safe: true, state: "operating" },
      0,
    );
    await assert.rejects(
      validatePlan(store, "org0", {
        actions: [
          {
            ...action,
            params: {
              ...action.params,
              destination: "c",
              building: "other-site",
            },
          },
        ],
      }),
      { code: "DESTINATION" },
    );
    assert.equal(
      (await validatePlan(store, "org0", { actions: [action] }))[0].grossMass
        .cargoKg,
      0,
    );
    assert.equal(
      (await store.get("org0", "operation", "cargo")).destination,
      "b",
    );
  }
});
