import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { Investigator } from "../src/investigation.mjs";
import { ReplayProvider } from "../src/provider.mjs";
import { allocationPlan, validateConditions } from "../src/planning.mjs";
import {
  receivedAllocationPlan,
  validateAllocationOffers,
} from "../src/received-allocation.mjs";
import { runEpisode } from "../evaluation/harness.mjs";

async function fixture(t) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.organization("org1");
  await store.put(
    "org0",
    "need",
    "need",
    { type: "water", unit: "L", quantity: 600, served: 0, deadline: 3600000 },
    0,
  );
  await store.put(
    "org0",
    "resource",
    "water",
    { owner: "org0", type: "water", quantity: 600, reserved: 0, floor: 100 },
    0,
  );
  await store.put(
    "org0",
    "vehicle",
    "truck",
    { owner: "org0", capacity: 500, state: "idle" },
    0,
  );
  const expiry = Date.now() + 100000;
  for (const [kind, projection] of [
    ["resource", { id: "water", type: "water", unit: "L", available: 250 }],
    ["vehicle", { id: "truck", capacity: 200, state: "idle" }],
  ])
    await store.put(
      "org0",
      "peer_offer",
      `org1-${kind}`,
      {
        from: "org1",
        kind,
        active: true,
        expiresAt: expiry,
        permissionVersion: 1,
        projection,
      },
      0,
    );
  // Private stock in another tenant is not an offer and cannot enter a plan.
  await store.put(
    "org1",
    "resource",
    "secret",
    { owner: "org1", type: "water", quantity: 90000, floor: 0, reserved: 0 },
    0,
  );
  return {
    store,
    config: {
      org: "org0",
      peers: [{ org: "org1" }],
      modelId: "fixture",
      maxCalls: 2,
    },
  };
}
const call = (name, args, id) => ({
  role: "assistant",
  tool_calls: [
    {
      id,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});

test("allocation identities remain separate when independent owners use the same stock and vehicle IDs", () => {
  const plan = allocationPlan({
    needs: [{ id: "n", type: "water", quantity: 150, served: 0 }],
    resources: [
      {
        id: "r",
        owner: "a",
        type: "water",
        quantity: 100,
        reserved: 0,
        floor: 20,
      },
      {
        id: "r",
        owner: "b",
        type: "water",
        quantity: 100,
        reserved: 0,
        floor: 20,
      },
    ],
    vehicles: [
      { id: "v", owner: "a", capacity: 100, state: "idle" },
      { id: "v", owner: "b", capacity: 100, state: "idle" },
    ],
  });
  assert.deepEqual(
    plan.allocations.map((a) => [a.owner, a.quantity]),
    [
      ["a", 80],
      ["b", 70],
    ],
  );
  assert.equal(plan.unserved.length, 0);
});

test("received allocation compiles only current consented projections and preserves native offer references", async (t) => {
  const { store, config } = await fixture(t),
    plan = await receivedAllocationPlan(store, config);
  assert.deepEqual(
    plan.allocations.map((a) => [a.owner, a.quantity]),
    [
      ["org0", 500],
      ["org1", 100],
    ],
  );
  assert.deepEqual(plan.ownerApprovals, ["org0", "org1"]);
  assert.ok(plan.evidenceIds.includes("org1-resource"));
  assert.ok(plan.evidenceIds.includes("org1-vehicle"));
  assert.ok(!plan.evidenceIds.includes("secret"));
  assert.equal(plan.unserved.length, 0);
  assert.equal((await store.list("org0", "operation")).length, 0);
  const disconnected = await receivedAllocationPlan(store, {
    org: "org0",
    peers: [],
  });
  assert.equal(disconnected.unserved[0].remaining, 100);
  for (const [name, patch] of [
    ["revoked", { active: false }],
    ["expired", { active: true, expiresAt: Date.now() - 1 }],
  ]) {
    await store.upsert("org0", "peer_offer", "org1-resource", patch);
    const p = await receivedAllocationPlan(store, config);
    assert.equal(p.unserved[0].remaining, 100, name);
  }
});

test("withdrawal or projection version change between planning and preparation requires rebuilding the draft", async (t) => {
  const { store, config } = await fixture(t),
    plan = await receivedAllocationPlan(store, config);
  await validateAllocationOffers(store, config, plan.allocations);
  await store.upsert("org0", "peer_offer", "org1-resource", { active: false });
  await assert.rejects(
    () => validateAllocationOffers(store, config, plan.allocations),
    (e) => e.code === "SHARED_CAPACITY_CHANGED",
  );
  const updated = await receivedAllocationPlan(store, config);
  await validateAllocationOffers(store, config, updated.allocations);
  assert.equal(updated.allocations.length, 1);
});

test("investigator prepares compiled multiowner allocations without fabricated consent or authority", async (t) => {
  const { store, config } = await fixture(t);
  const provider = new ReplayProvider([
    call("plan_allocations", {}, "plan"),
    call(
      "prepare_allocation",
      {
        indices: [0, 1],
        title: "Cover the remaining water need",
        rationale:
          "Observed stock and consented partner capacity, each owner reviews its steps.",
        benefit: "600 L proposed, no receipt yet.",
      },
      "prepare",
    ),
  ]);
  const investigator = new Investigator({
    store,
    config,
    domain: new Domain(store, config),
    provider,
    connector: {
      startModel: async () => ({ id: "m" }),
      finishModel: async () => {},
    },
  });
  const activity = await investigator.run({}, "shared-fixture"),
    proposal = await store.get("org0", "proposal", activity.proposalId);
  assert.equal(proposal.state, "awaiting_review");
  assert.deepEqual(proposal.conditions, []);
  assert.deepEqual(
    proposal.actions.map((a) => [a.owner, a.params.quantity]),
    [
      ["org0", 500],
      ["org1", 100],
    ],
  );
  assert.ok(proposal.references.includes("org1-resource"));
  assert.equal(proposal.authorization, null);
  assert.equal(
    (
      await store.query(
        "SELECT COUNT(*) AS n FROM jobs WHERE kind='execute_proposal'",
      )
    ).rows[0].n,
    0,
  );
});

test("approval conditions must identify an existing proposal, not an invented owner approval label", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(
    () =>
      validateConditions(store, "org0", [
        { type: "approval", id: "org1_approval", satisfied: true },
      ]),
    (e) => e.code === "APPROVAL_REFERENCE",
  );
  await store.put(
    "org0",
    "proposal",
    "other-plan",
    { state: "awaiting_review", authorization: null },
    0,
  );
  assert.equal(
    (
      await validateConditions(store, "org0", [
        { type: "approval", id: "other-plan" },
      ])
    )[0].satisfied,
    false,
  );
  await store.upsert("org0", "proposal", "other-plan", {
    state: "authorized",
    authorization: { actorId: "owner" },
  });
  assert.equal(
    (
      await validateConditions(store, "org0", [
        { type: "approval", id: "other-plan" },
      ])
    )[0].satisfied,
    true,
  );
});

test("compiled shared aid reaches physical receipts after all independent owners review; replay is only a mechanism regression", async () => {
  const result = await runEpisode({
    arm: "B6",
    scenario: "S01",
    planningRounds: 1,
    provider: new ReplayProvider([
      call("plan_allocations", {}, "plan"),
      call(
        "prepare_allocation",
        {
          indices: [0, 1, 2],
          title: "Complete the known water demand",
          rationale:
            "Received owned and shared capacities. Independent reviews remain mandatory.",
          benefit: "Propose 600 L.",
        },
        "prepare",
      ),
    ]),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.platformEvidence.length, 4);
  assert.equal(result.metrics.services.water.served, 600);
  assert.equal(result.metrics.services.water.pending, 0);
  assert.equal(result.invariants.length, 0);
  assert.equal(
    result.activities[0].steps.find((s) => s.tool === "prepare_allocation")
      .result.conditions.length,
    0,
  );
});
