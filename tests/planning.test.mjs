import test from "node:test";
import assert from "node:assert/strict";
import {
  allocationPlan,
  shortestRoute,
  composeService,
  validateConditions,
} from "../src/planning.mjs";
import { Store } from "../src/store.mjs";
test("global allocation respects scarce fleet, existing aid and reserve floors for every resource type", () => {
  const result = allocationPlan({
    needs: [
      { id: "a", type: "food", quantity: 100, served: 0, priority: 9 },
      { id: "b", type: "water", quantity: 200, served: 0, priority: 5 },
    ],
    resources: [
      {
        id: "food",
        owner: "org0",
        type: "food",
        quantity: 80,
        reserved: 0,
        floor: 20,
      },
      {
        id: "water",
        owner: "org0",
        type: "water",
        quantity: 100,
        reserved: 10,
        floor: 30,
      },
    ],
    vehicles: [{ id: "v", owner: "org0", capacity: 100, state: "idle" }],
  });
  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0].quantity, 60);
  assert.equal(result.allocations[0].need, "a");
  assert.equal(result.unserved[1].remaining, 200);
});
test("route uses known restrictions, weight, distance and uncertainty rather than direct-line teleportation", () => {
  const map = {
    roads: [
      {
        id: "ab",
        from: "a",
        to: "b",
        lengthM: 100,
        speedMps: 10,
        maxWeight: 4000,
      },
      { id: "ac", from: "a", to: "c", lengthM: 200, speedMps: 10 },
      { id: "cb", from: "c", to: "b", lengthM: 200, speedMps: 10 },
    ],
  };
  const route = shortestRoute(
    map,
    "a",
    "b",
    { weightKg: 3500 },
    { ab: { open: false } },
  );
  assert.deepEqual(route.nodes, ["a", "c", "b"]);
  assert.equal(route.seconds, 40);
  assert.equal(route.unknownEdges.length, 2);
  assert.equal(shortestRoute(map, "b", "a"), null);
});
test("joint service is not ready until safety, permission and every operational dependency exist", () => {
  const types = ["water", "sanitation", "staff", "energy", "transport"];
  const offers = types.map((type, i) => ({
    id: type,
    type,
    owner: "org" + i,
    available: 1,
    expiresAt: Date.now() + 100000,
  }));
  assert.equal(composeService({ service: "shelter", offers }).ready, false);
  const result = composeService({
    service: "shelter",
    offers,
    inspection: { id: "inspect", state: "completed", result: { safe: true } },
    permit: { id: "permit", authorizedBy: "owner" },
  });
  assert.equal(result.ready, true);
});
test("a model cannot self-certify inspection, compatibility or owner conditions", async () => {
  const s = await Store.open();
  await s.organization("org0");
  try {
    const c = await validateConditions(s, "org0", [
      { type: "inspection", id: "fiction", satisfied: true },
      { type: "owner", id: "fake-owner", satisfied: true },
    ]);
    assert.ok(c.every((c) => c.satisfied === false));
  } finally {
    await s.close();
  }
});
test("vehicle preconditions use received fleet state and reject stock-resource mislabelling", async () => {
  const s = await Store.open();
  await s.organization("org0");
  try {
    const v = await s.upsert("org0", "vehicle", "van", { state: "idle" });
    const [ready] = await validateConditions(s, "org0", [
      { type: "vehicle", id: "van", version: v.version },
    ]);
    assert.equal(ready.satisfied, true);
    const [stale] = await validateConditions(s, "org0", [
      { type: "vehicle", id: "van", version: v.version + 1, satisfied: true },
    ]);
    assert.equal(stale.satisfied, false);
    await s.upsert("org0", "vehicle", "van", { state: "in_transit" });
    const [busy] = await validateConditions(s, "org0", [
      { type: "vehicle", id: "van", satisfied: true },
    ]);
    assert.equal(busy.satisfied, false);
    await assert.rejects(
      validateConditions(s, "org0", [{ type: "resource", id: "van" }]),
      (e) => e.code === "CONDITION_KIND",
    );
  } finally {
    await s.close();
  }
});
