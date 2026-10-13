import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { allocationPlan, validatePlan } from "../src/planning.mjs";
import { receivedCargoProfile, receivedCargoCapacity, assertReceivedPassengerCapacity } from "../src/received-cargo.mjs";
import { receivedVehicleWeight } from "../src/received-vehicle-weight.mjs";

const staff = { id: "crew", owner: "org0", type: "staff", quantity: 10,
  reserved: 0, floor: 0, node: "a", qualifications: ["shelter_support"] };
const truck = { id: "truck", owner: "org0", state: "idle", node: "a", capacity: 20,
  maxCargoKg: 300, volumeM3: 0.3, seats: 4, weightKg: 3000, speedMps: 10 };
const need = { id: "need", type: "staff", quantity: 10, served: 0, node: "b" };
const map = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], places: [{ id: "site", node: "b" }], roads: [
  { id: "ab", from: "a", to: "b", lengthM: 100, speedMps: 10, maxWeight: 3100, open: true },
  { id: "ac", from: "a", to: "c", lengthM: 200, speedMps: 10, maxWeight: 10000, open: true },
  { id: "cb", from: "c", to: "b", lengthM: 200, speedMps: 10, maxWeight: 10000, open: true },
] };

test("public received staff units clamp seats, mass and volume without treating people as one kilogram of stock", () => {
  assert.deepEqual(receivedCargoProfile(staff), { massKgPerUnit: 75, volumeM3PerUnit: 0.075, seatsPerUnit: 1 });
  for (const [change, quantity] of [[{}, 4], [{ seats: 2 }, 2], [{ maxCargoKg: 149 }, 1], [{ volumeM3: 0.149 }, 1], [{ seats: undefined }, 0]]) {
    const vehicle = { ...truck, ...change }, capacity = receivedCargoCapacity(vehicle, staff);
    assert.equal(capacity, quantity);
    const plan = allocationPlan({ needs: [need], resources: [staff], vehicles: [vehicle], map });
    assert.equal(plan.allocations[0]?.quantity ?? 0, quantity);
    assert.equal(plan.unserved[0].remaining, 10 - quantity);
    if (quantity > 1) assert.deepEqual(plan.allocations[0].travelEstimate.delivery.nodes, ["a", "c", "b"]);
  }
  assert.equal(receivedCargoProfile({ ...staff, transport: { massKgPerUnit: 0, volumeM3PerUnit: 0.075, seatsPerUnit: 1 } }), null);
  assert.equal(receivedCargoProfile({ ...staff, transport: { massKgPerUnit: 1, volumeM3PerUnit: 0.001, seatsPerUnit: 1 } }), null);
  assert.equal(receivedCargoCapacity(truck, { type: "unknown" }), 0);
  const custom = { ...staff, transport: { massKgPerUnit: 100, volumeM3PerUnit: 0.1, seatsPerUnit: 1 } };
  assert.equal(receivedCargoCapacity(truck, custom), 2);
  assert.equal(assertReceivedPassengerCapacity({ ...truck, seats: 20, maxCargoKg: 1, volumeM3: 0.001 }, 20).massKgPerUnit, 75);
});

test("owner review refuses overloaded or unseated staff before any proposal/source command and preserves stock", async t => {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  await store.upsert("org0", "resource", staff.id, staff);
  await store.upsert("org0", "need", need.id, need);
  await store.upsert("org0", "context", "geography", { map });
  const action = quantity => ({ owner: "org0", type: "dispatch", dependsOn: [],
    params: { resource: staff.id, vehicle: truck.id, need: need.id, quantity } });
  for (const [change, code] of [[{ seats: 1 }, "SEATS"], [{ maxCargoKg: 149 }, "CARGO_WEIGHT"], [{ volumeM3: 0.149 }, "CARGO_VOLUME"]]) {
    await store.upsert("org0", "vehicle", truck.id, { ...truck, ...change });
    await assert.rejects(validatePlan(store, "org0", { actions: [action(2)] }), { code });
    assert.equal((await store.get("org0", "resource", staff.id)).quantity, 10);
    assert.equal((await store.list("org0", "proposal")).length, 0);
  }
  await store.upsert("org0", "vehicle", truck.id, truck);
  const checks = await validatePlan(store, "org0", { actions: [action(2)] });
  assert.deepEqual(checks.find(c => c.type === "route").nodes, ["a", "c", "b"]);
});

test("loaded staff reroute keeps actual passenger mass and refuses a bridge or changed vehicle capacity without losing cargo", async t => {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  const operation = { id: "operation", vehicle: truck.id, org: "org0", owner: "org0", type: "delivery", state: "blocked",
    resource: staff.id, resourceType: "staff", quantity: 2, received: 0, destination: "b", confirmedBySource: true,
    times: { prepared: 1, dispatched: 2 } };
  const vehicle = { ...truck, state: "blocked", operation: operation.id, load: 0 };
  assert.equal(receivedVehicleWeight(vehicle, operation, staff).weightKg, 3150);
  assert.equal(receivedVehicleWeight({ ...vehicle, crewQuantity: 1 },
    { ...operation, type: "inspection" }).weightKg, 3075);
  await store.upsert("org0", "resource", staff.id, staff);
  await store.upsert("org0", "vehicle", truck.id, vehicle);
  await store.upsert("org0", "operation", operation.id, operation);
  await store.upsert("org0", "context", "geography", { map });
  for (const edge of map.roads) await store.upsert("org0", "road", edge.id, { open: true });
  const proposal = { actions: [{ owner: "org0", type: "reroute", dependsOn: [], params: { vehicle: truck.id, destination: "b" } }] };
  assert.deepEqual((await validatePlan(store, "org0", proposal))[0].nodes, ["a", "c", "b"]);
  await store.upsert("org0", "vehicle", truck.id, { seats: 1 });
  await assert.rejects(validatePlan(store, "org0", proposal), { code: "SEATS" });
  assert.equal((await store.get("org0", "operation", operation.id)).quantity, 2);
  assert.equal((await store.get("org0", "operation", operation.id)).state, "blocked");
  await store.upsert("org0", "vehicle", truck.id, vehicle);
  await store.upsert("org0", "context", "geography", { map: { ...map, roads: [map.roads[0]] } });
  await assert.rejects(validatePlan(store, "org0", proposal), { code: "NO_KNOWN_ROUTE" });
});
