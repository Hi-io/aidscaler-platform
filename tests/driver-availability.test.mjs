import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import {
  allocationPlan,
  validatePlan,
  validateConditions,
} from "../src/planning.mjs";
import { driverAvailabilityBadge } from "../ui/fleet.mjs";
import { Network, sign } from "../src/network.mjs";

const roads = [
  {
    id: "ab",
    from: "a",
    to: "b",
    lengthM: 100,
    speedMps: 10,
    maxWeight: 10000,
    open: true,
  },
];
const vehicle = {
  id: "truck",
  owner: "org0",
  node: "a",
  state: "idle",
  capacity: 300,
  maxCargoKg: 300,
  weightKg: 2000,
  speedMps: 10,
  driverAvailable: false,
};
const resource = {
  id: "water",
  owner: "org0",
  node: "a",
  type: "water",
  quantity: 300,
  reserved: 0,
  floor: 0,
};
const need = { id: "need", type: "water", quantity: 300, served: 0, node: "b" };
const action = {
  type: "dispatch",
  owner: "org0",
  dependsOn: [],
  params: { vehicle: "truck", resource: "water", need: "need", quantity: 300 },
};
const map = { nodes: [{ id: "a" }, { id: "b" }], roads, places: [] };

test("the common allocator keeps no-driver capacity as a visible deficit, including without a received map", () => {
  for (const topology of [map, undefined]) {
    const result = allocationPlan({
      needs: [need],
      resources: [resource],
      vehicles: [vehicle],
      map: topology,
    });
    assert.equal(result.allocations.length, 0);
    assert.equal(result.unserved[0].remaining, 300);
    assert.equal(result.unserved[0].blockingReasons[0].code, "VEHICLE_DRIVER");
    assert.equal(result.unserved[0].blockingReasons[0].owner, "org0");
  }
  for (const flag of [true, undefined]) {
    const result = allocationPlan({
      needs: [need],
      resources: [resource],
      vehicles: [{ ...vehicle, driverAvailable: flag }],
      map,
    });
    assert.equal(result.allocations.length, 1);
  }
});

test("owner validation blocks dispatch and loaded reroute after received driver absence, preserving the same cargo and stock", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.put("org0", "context", "geography", { map }, 0);
  await store.put("org0", "vehicle", "truck", vehicle, 0);
  await store.put("org0", "resource", "water", resource, 0);
  await store.put("org0", "need", "need", need, 0);
  assert.equal(
    (
      await validateConditions(store, "org0", [
        { type: "vehicle", id: "truck" },
      ])
    )[0].satisfied,
    false,
  );
  await assert.rejects(validatePlan(store, "org0", { actions: [action] }), {
    code: "VEHICLE_DRIVER",
  });
  await store.upsert("org0", "vehicle", "truck", {
    state: "blocked",
    operation: "same-load",
    load: 300,
  });
  await store.put(
    "org0",
    "operation",
    "same-load",
    {
      org: "org0",
      type: "delivery",
      vehicle: "truck",
      state: "blocked",
      phase: "delivery",
      resourceType: "water",
      quantity: 300,
      received: 0,
      destination: "b",
      confirmedBySource: true,
      times: { dispatched: 1000, prepared: 1000 },
    },
    0,
  );
  await assert.rejects(
    validatePlan(store, "org0", {
      actions: [
        {
          type: "reroute",
          owner: "org0",
          dependsOn: [],
          params: { vehicle: "truck", destination: "b" },
        },
      ],
    }),
    { code: "VEHICLE_DRIVER" },
  );
  assert.equal(
    (await store.get("org0", "operation", "same-load")).quantity,
    300,
  );
  assert.equal((await store.get("org0", "operation", "same-load")).received, 0);
  assert.equal((await store.get("org0", "vehicle", "truck")).load, 300);
  assert.equal((await store.get("org0", "resource", "water")).quantity, 300);
  assert.equal((await store.get("org0", "resource", "water")).reserved, 0);
  assert.equal((await store.list("org0", "proposal")).length, 0);
  assert.equal(
    (await store.query("SELECT COUNT(*) AS n FROM jobs")).rows[0].n,
    0,
  );
});

test("transport badges distinguish received presence, absence and unknown without revealing driver identities", () => {
  assert.match(
    driverAvailabilityBadge({ driverAvailable: false, driverName: "PRIVATE" }),
    /No driver available/,
  );
  assert.match(
    driverAvailabilityBadge({ driverAvailable: true }),
    /Driver available/,
  );
  for (const flag of [undefined, null, "true", 1])
    assert.match(
      driverAvailabilityBadge({ driverAvailable: flag }),
      /Driver availability unknown/,
    );
  assert.doesNotMatch(
    driverAvailabilityBadge({ driverAvailable: false, driverName: "PRIVATE" }),
    /PRIVATE/,
  );
});

test("signed consent shares only driver availability and its withdrawal invalidates the received offer", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  for (const org of ["org0", "org1"]) await store.organization(org);
  const key = "driver-consent-fixture",
    sender = new Network(store, { org: "org1", peers: [{ org: "org0", key }] }),
    receiver = new Network(store, {
      org: "org0",
      peers: [{ org: "org1", key }],
    }),
    actor = { org: "org1", id: "owner", role: "commander" },
    receive = (message) => {
      const e = { message, sentAt: Date.now() };
      return receiver.receive("org1", sign(key, e), e);
    };
  const v = await store.put(
    "org1",
    "vehicle",
    "private-truck",
    {
      ...vehicle,
      owner: "org1",
      driver: "private-driver-identity",
      personnel: [{ name: "PRIVATE" }],
    },
    0,
  );
  await sender.share(
    actor,
    { kind: "vehicle", id: v.id, version: v.version, to: "org0" },
    "share-driver",
  );
  const messages = (
    await store.query(
      "SELECT payload FROM jobs WHERE org='org1' AND kind='peer_send' ORDER BY created_at,id",
    )
  ).rows;
  for (const job of messages) await receive(job.payload.message);
  const offers = await store.list("org0", "peer_offer");
  assert.equal(offers.length, 1);
  assert.equal(offers[0].projection.driverAvailable, false);
  assert.equal(
    JSON.stringify(offers).includes("private-driver-identity"),
    false,
  );
  assert.equal(JSON.stringify(offers).includes("PRIVATE"), false);
  await sender.share(
    actor,
    { kind: "vehicle", id: v.id, version: v.version, to: "org0", revoke: true },
    "withdraw-driver",
  );
  const revocation = (
    await store.query(
      "SELECT payload FROM jobs WHERE org='org1' AND kind='peer_send'",
    )
  ).rows.find((row) => row.payload.message.revoke);
  await receive(revocation.payload.message);
  assert.equal(
    (await store.get("org0", "peer_offer", offers[0].id)).active,
    false,
  );
});
