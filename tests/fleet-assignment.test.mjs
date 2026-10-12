import test from "node:test";
import assert from "node:assert/strict";
import { allocationPlan } from "../src/planning.mjs";

function fixture() {
  const needs = [
    {
      id: "first",
      type: "water",
      quantity: 20,
      priority: 10,
      deadline: 600000,
      node: "N1",
    },
    {
      id: "second",
      type: "water",
      quantity: 30,
      priority: 5,
      deadline: 700000,
      node: "N2",
    },
  ];
  const resources = ["a", "b"].map((owner) => ({
    id: "r",
    owner,
    node: owner.toUpperCase(),
    type: "water",
    quantity: 100,
    reserved: 10,
    floor: 10,
  }));
  const vehicles = ["a", "b"].map((owner) => ({
    id: "v",
    owner,
    node: owner.toUpperCase(),
    state: "idle",
    capacity: 100,
    weightKg: 1000,
    speedMps: 10,
  }));
  const roads = [
    ["A", "N1", 10],
    ["B", "N1", 20],
    ["A", "N2", 20],
    ["B", "N2", 1000],
  ].map(([from, to, lengthM]) => ({
    id: from + to,
    from,
    to,
    lengthM,
    speedMps: 10,
    open: true,
  }));
  return {
    needs,
    resources,
    vehicles,
    map: { roads },
    executionPolicy: {
      reservation: { defaultTtlMs: 900000, maxTtlMs: 86400000 },
      delivery: { loadMs: 0, unloadMs: 0, commandNominalLatencyMs: 0 },
    },
  };
}

test("concurrent matching avoids greedy crossing while retaining priority admission and exact quantities", () => {
  const f = fixture(),
    plan = allocationPlan(f);
  assert.deepEqual(
    plan.allocations.map((a) => [a.need, a.quantity, a.owner]),
    [
      ["first", 20, "b"],
      ["second", 30, "a"],
    ],
  );
  assert.equal(plan.assignment.beforeSeconds, 101);
  assert.equal(plan.assignment.afterSeconds, 4);
  assert.equal(plan.assignment.swaps, 1);
  assert.equal(plan.unserved.length, 0);
  assert.deepEqual(
    f.resources.map((r) => [r.reserved, r.floor]),
    [
      [10, 10],
      [10, 10],
    ],
  );
  assert.deepEqual(
    allocationPlan(f),
    plan,
    "same received inputs produce the same assignment",
  );
});

test("a route improvement cannot borrow protected stock or overload the receiving vehicle", () => {
  for (const constraint of ["stock", "vehicle", "fuel", "road"]) {
    const f = fixture();
    if (constraint === "stock") f.resources[0].quantity = 45; // only25 available
    if (constraint === "vehicle") f.vehicles[0].capacity = 25;
    if (constraint === "fuel") {
      f.vehicles[0].fuel = 1;
      f.vehicles[0].fuelMlPerKm = 100;
    }
    if (constraint === "road") f.observedRoads = { AN2: { open: false } };
    const plan = allocationPlan(f);
    assert.deepEqual(
      plan.allocations.map((a) => a.owner),
      ["a", "b"],
      constraint,
    );
    assert.equal(plan.assignment.swaps, 0);
  }
});

test("shorter total travel does not worsen a declared missed useful window", () => {
  const f = fixture();
  f.needs[0].deadline = 1000;
  const plan = allocationPlan(f);
  assert.equal(plan.assignment.swaps, 0);
  assert.equal(plan.allocations[0].owner, "a");
});

test("matching never replaces a priority-admitted need with a lower priority request", () => {
  const f = fixture();
  f.needs.push({
    id: "unselected",
    type: "water",
    node: "A",
    quantity: 1,
    priority: 1,
  });
  const plan = allocationPlan(f);
  assert.deepEqual(
    plan.allocations.map((a) => a.need),
    ["first", "second"],
  );
  assert.equal(plan.unserved.find((n) => n.need === "unselected").remaining, 1);
});
