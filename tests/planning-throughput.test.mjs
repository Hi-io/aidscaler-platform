import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { Investigator } from "../src/investigation.mjs";
import { responseQueue } from "../src/response-policy.mjs";
import { receivedAllocationPlan } from "../src/received-allocation.mjs";

const org = "org0";
async function fixture(t) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization(org);
  await store.put(
    org,
    "need",
    "need",
    { type: "water", unit: "L", quantity: 600, served: 0, node: "b" },
    0,
  );
  await store.put(
    org,
    "resource",
    "water",
    {
      owner: org,
      type: "water",
      quantity: 1000,
      reserved: 100,
      floor: 100,
      node: "a",
    },
    0,
  );
  for (const id of ["v0", "v1", "v2"])
    await store.put(
      org,
      "vehicle",
      id,
      { owner: org, state: "idle", capacity: 300, node: "a" },
      0,
    );
  await store.put(
    org,
    "context",
    "geography",
    {
      map: {
        nodes: [{ id: "a" }, { id: "b" }],
        roads: [{ id: "ab", from: "a", to: "b", open: true, lengthM: 100 }],
      },
    },
    0,
  );
  return {
    store,
    config: { org, peers: [], maxCalls: 2, modelId: "mechanism-only" },
  };
}
const action = (quantity, vehicle = "v0") => ({
  type: "dispatch",
  owner: org,
  params: { need: "need", resource: "water", vehicle, quantity },
  dependsOn: [],
});
const message = (name, args, id = name) => ({
  role: "assistant",
  tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
});

test("research verification passes the chosen channel and reuses received pending checks", async (t) => {
  for (const reuse of [false, true]) {
    const { store, config } = await fixture(t);
    config.maxCalls = 1;
    let actions = 0;
    const inspection = {
      id: "inspection",
      target: "resource",
      entity: "water",
      method: "clarification",
      state: reuse ? "clarification_pending" : "completed",
    };
    const connector = {
      startModel: async () => ({ id: "model" }),
      finishModel: async () => {},
      state: async () => ({
        inspections: reuse || actions ? [inspection] : [],
      }),
      action: async (type, p) => {
        actions++;
        assert.equal(type, "verify");
        assert.equal(p.method, "clarification");
        return inspection;
      },
    };
    const provider = {
      complete: async () => ({
        usage: { providerCost: 0 },
        message: message(
          "verify",
          JSON.stringify({
            target: "resource",
            id: "water",
            method: "clarification",
            reason: "Check the current owner report.",
          }),
        ),
      }),
    };
    const investigator = new Investigator({
      store,
      config,
      connector,
      provider,
      domain: new Domain(store, config),
    });
    const result = await investigator.run({}, "channel-" + reuse);
    assert.equal(result.steps[0].state, "completed");
    assert.equal(actions, reuse ? 0 : 1);
    assert.equal(Boolean(result.steps[0].result.reusedPending), reuse);
    assert.equal((await store.list(org, "proposal")).length, 0);
  }
});

test("a partial draft keeps the residual need actionable without reusing held stock or vehicle", async (t) => {
  const { store, config } = await fixture(t);
  await store.put(
    org,
    "proposal",
    "first",
    { state: "awaiting_review", actions: [action(100)] },
    0,
  );
  let row = (await responseQueue(store, org)).rows[0];
  assert.equal(row.outstanding, 600);
  assert.equal(row.draftHeldQuantity, 100);
  assert.equal(row.planningOutstanding, 500);
  let plan = await receivedAllocationPlan(store, config);
  assert.deepEqual(
    plan.allocations.map((a) => a.quantity).sort((a, b) => a - b),
    [200, 300],
  );
  assert.deepEqual(plan.allocations.map((a) => a.vehicle).sort(), ["v1", "v2"]);
  assert.equal((await store.get(org, "need", "need")).quantity, 600);
  assert.equal((await store.get(org, "resource", "water")).reserved, 100);
  assert.equal((await store.list(org, "operation")).length, 0);
  await store.upsert(org, "proposal", "first", { state: "rejected" });
  row = (await responseQueue(store, org)).rows[0];
  assert.equal(row.planningOutstanding, 600);
  plan = await receivedAllocationPlan(store, config);
  assert.equal(
    plan.allocations.reduce((sum, a) => sum + a.quantity, 0),
    600,
  );
  assert.equal(plan.deferred.length, 0);
});

test("observed cargo and a new unissued draft are counted separately, and an issued draft is not counted twice", async (t) => {
  const { store, config } = await fixture(t);
  await store.put(
    org,
    "operation",
    "incoming",
    {
      owner: org,
      need: "need",
      vehicle: "v0",
      quantity: 100,
      state: "in_transit",
      confirmedBySource: true,
      proposalId: "first",
      step: 0,
    },
    0,
  );
  await store.put(
    org,
    "proposal",
    "first",
    {
      state: "executing",
      actions: [action(100)],
      executionResults: [{ index: 0, result: { operation: "incoming" } }],
    },
    0,
  );
  let row = (await responseQueue(store, org)).rows[0];
  assert.equal(row.outstanding, 500);
  assert.equal(row.draftHeldQuantity, 0);
  assert.equal(row.planningOutstanding, 500);
  let plan = await receivedAllocationPlan(store, config);
  assert.equal(
    plan.allocations.reduce((s, a) => s + a.quantity, 0),
    500,
  );
  assert.ok(!plan.allocations.some((a) => a.vehicle === "v0"));
  await store.put(
    org,
    "proposal",
    "second",
    { state: "awaiting_review", actions: [action(100, "v1")] },
    0,
  );
  row = (await responseQueue(store, org)).rows[0];
  assert.equal(row.draftHeldQuantity, 100);
  assert.equal(row.planningOutstanding, 400);
  plan = await receivedAllocationPlan(store, config);
  assert.deepEqual(
    plan.allocations.map((a) => [a.vehicle, a.quantity]),
    [["v2", 300]],
  );
  assert.equal(plan.unserved[0].remaining, 100);
});

test("planning holds preserve protected stock across different needs, even before human review", async (t) => {
  const { store, config } = await fixture(t);
  await store.put(
    org,
    "need",
    "other",
    { type: "water", quantity: 1000, unit: "L", node: "b" },
    0,
  );
  await store.put(
    org,
    "proposal",
    "first",
    { state: "awaiting_review", actions: [action(700)] },
    0,
  );
  const plan = await receivedAllocationPlan(store, config);
  assert.equal(
    plan.allocations.reduce((s, a) => s + a.quantity, 0),
    100,
  );
  assert.ok(
    plan.allocations.every((a) => a.need === "other" && a.vehicle !== "v0"),
  );
});

test("an empty optional tool payload executes as an object; empty required payloads and malformed JSON remain rejected", async (t) => {
  for (const [name, args, expected] of [
    ["plan_allocations", "", "completed"],
    ["verify", "", "failed"],
    ["plan_allocations", "{", "failed"],
  ]) {
    const { store, config } = await fixture(t);
    config.maxCalls = 1;
    let requested = false;
    const investigator = new Investigator({
      store,
      config,
      domain: new Domain(store, config),
      provider: {
        complete: async () => ({
          usage: { providerCost: 0 },
          message: message(name, args),
        }),
      },
      connector: {
        startModel: async () => ({ id: "model" }),
        finishModel: async () => {},
        action: async () => {
          requested = true;
          throw Error("should not execute");
        },
      },
    });
    const result = await investigator.run(
      {},
      `optional-${name}-${args.length}`,
    );
    assert.equal(result.steps[0].state, expected);
    assert.equal(requested, false);
    assert.equal((await store.list(org, "proposal")).length, 0);
    if (expected === "completed")
      assert.equal(
        result.steps[0].result.allocations.reduce((s, a) => s + a.quantity, 0),
        600,
      );
  }
});

test("a concurrent draft appearing between calculation and preparation cannot create an overlapping proposal", async (t) => {
  const { store, config } = await fixture(t);
  let calls = 0;
  const provider = {
    complete: async () => {
      calls++;
      if (calls === 1)
        return {
          usage: { providerCost: 0 },
          message: message("plan_allocations", "{}"),
        };
      await store.put(
        org,
        "proposal",
        "competing",
        { state: "awaiting_review", actions: [action(300)] },
        0,
      );
      return {
        usage: { providerCost: 0 },
        message: message(
          "prepare_allocation",
          JSON.stringify({
            indices: [0, 1],
            title: "A checked response",
            rationale:
              "Received stock and finite vehicle quantities support this response.",
            benefit: "600 L proposed for owner review.",
          }),
        ),
      };
    },
  };
  const investigator = new Investigator({
    store,
    config,
    provider,
    domain: new Domain(store, config),
  });
  const result = await investigator.run({}, "concurrent-draft");
  assert.equal(result.state, "inconclusive");
  assert.equal(result.steps.at(-1).result.error, "ALLOCATION_CHANGED");
  assert.equal((await store.list(org, "proposal")).length, 1);
});
