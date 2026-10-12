import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import {
  configureResponsePolicy,
  responseQueue,
  outstanding,
} from "../src/response-policy.mjs";
import { receivedAllocationPlan } from "../src/received-allocation.mjs";
import { Intake } from "../src/intake.mjs";
import { Investigator } from "../src/investigation.mjs";
import { Domain } from "../src/domain.mjs";
const org = "org0",
  actor = { org, id: "coordinator", role: "commander" };
async function setup(t) {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization(org);
  await configureResponsePolicy(
    s,
    actor,
    {
      version: 0,
      order: "deadline_then_priority",
      reason: "Review time-critical useful windows first.",
      maxOpenReviews: 2,
      investigationCooldownMs: 1000,
    },
    "policy-initial",
  );
  return s;
}
test("distribution policy requires an operational owner, exact version and preserves native quantities", async (t) => {
  const s = await setup(t);
  await s.put(
    org,
    "need",
    "water",
    { type: "water", quantity: 1000, unit: "L", deadline: 9000, priority: 10 },
    0,
  );
  await s.put(
    org,
    "need",
    "shelter",
    {
      type: "shelter",
      quantity: 50,
      unit: "places",
      deadline: 1000,
      priority: 5,
    },
    0,
  );
  const q = await responseQueue(s, org);
  assert.deepEqual(
    q.rows.map((n) => n.id),
    ["shelter", "water"],
  );
  await assert.rejects(
    configureResponsePolicy(
      s,
      { ...actor, role: "admin" },
      {
        version: 1,
        order: "priority_then_deadline",
        reason: "Technical admin has no distribution mandate.",
      },
      "admin-policy",
    ),
    (e) => e.code === "FORBIDDEN",
  );
  await assert.rejects(
    configureResponsePolicy(
      s,
      actor,
      {
        version: 0,
        order: "priority_then_deadline",
        reason: "Old review cannot silently replace new policy.",
      },
      "stale-policy",
    ),
    (e) => e.code === "VERSION_CONFLICT",
  );
  assert.equal(
    outstanding({ id: "n", quantity: 600, served: 100, inTransit: 200 }, [
      { need: "n", quantity: 200, state: "in_transit" },
    ]),
    300,
  );
});
test("a hundred concurrent heterogeneous needs respect protected stock, finite vehicles, policy and existing proposals", async (t) => {
  const s = await setup(t),
    types = ["water", "food", "blankets"];
  for (let i = 0; i < 100; i++)
    await s.put(
      org,
      "need",
      "n" + i,
      {
        type: types[i % 3],
        quantity: 20,
        unit: types[i % 3],
        deadline: (100 - i) * 1000,
        priority: i % 7,
      },
      0,
    );
  for (const type of types)
    await s.put(
      org,
      "resource",
      type,
      { owner: org, type, quantity: 100, reserved: 10, floor: 30 },
      0,
    );
  for (let i = 0; i < 12; i++)
    await s.put(
      org,
      "vehicle",
      "v" + i,
      { owner: org, state: "idle", capacity: 20 },
      0,
    );
  await s.put(
    org,
    "proposal",
    "under-review",
    {
      state: "awaiting_review",
      actions: [
        {
          type: "dispatch",
          owner: org,
          params: {
            need: "n99",
            vehicle: "v0",
            resource: "water",
            quantity: 20,
          },
        },
      ],
    },
    0,
  );
  const plan = await receivedAllocationPlan(
    s,
    { org, peers: [] },
    { excludeVehicles: [{ owner: org, id: "v0" }] },
  );
  assert.ok(plan.allocations.length > 0);
  assert.ok(
    !plan.allocations.some((a) => a.need === "n99" || a.vehicle === "v0"),
  );
  assert.equal(
    new Set(plan.allocations.map((a) => a.vehicle)).size,
    plan.allocations.length,
  );
  for (const type of types)
    assert.ok(
      plan.allocations
        .filter((a) => a.resource === type)
        .reduce((sum, a) => sum + a.quantity, 0) <= 60,
    );
  assert.equal((await responseQueue(s, org)).total, 100);
  assert.ok(plan.deferred.some((n) => n.need === "n99"));
});
test("automatic response reevaluates a received need without requiring a new prompt, but suppresses unchanged retries and respects human backlog", async (t) => {
  const s = await setup(t),
    intake = new Intake(s, { org, autoInvestigate: true });
  await s.put(
    org,
    "need",
    "need",
    { type: "water", quantity: 100, unit: "L", deadline: 1000 },
    0,
  );
  const first = await intake.kick();
  assert.equal(first.queued, true);
  const job = (await s.query("SELECT * FROM jobs WHERE id=$1", [first.id]))
    .rows[0];
  assert.equal(job.payload.needId, "need");
  await s.finishJob(job.id, {});
  assert.equal((await intake.kick()).empty, true);
  for (let i = 0; i < 2; i++)
    await s.put(
      org,
      "proposal",
      "review" + i,
      { state: "awaiting_review", actions: [] },
      0,
    );
  assert.equal((await intake.kick()).humanBackpressure, true);
});

test("an inconclusive automatic focus stays visible but does not starve another community; changed received capacity reopens it", async (t) => {
  const s = await setup(t),
    config = { org, peers: [], maxCalls: 1, modelId: "recorded-focus-policy" },
    inputs = [];
  await s.put(
    org,
    "need",
    "shelter",
    { type: "shelter", quantity: 50, unit: "places", deadline: 1000 },
    0,
  );
  await s.put(
    org,
    "need",
    "water",
    { type: "water", quantity: 100, unit: "L", deadline: 2000 },
    0,
  );
  const provider = {
    complete: async ({ messages }) => {
      inputs.push(JSON.parse(messages[1].content));
      return {
        usage: { providerCost: 0 },
        message: {
          role: "assistant",
          tool_calls: [
            {
              id: "stop-" + inputs.length,
              type: "function",
              function: {
                name: "finish_without_proposal",
                arguments:
                  '{"reason":"A current dependency remains unavailable; retain this need for manual review or changed evidence."}',
              },
            },
          ],
        },
      };
    },
  };
  const investigator = new Investigator({
    store: s,
    domain: new Domain(s, config),
    config,
    provider,
  });
  await investigator.run({}, "first-focus");
  await investigator.run({}, "second-focus");
  assert.deepEqual(
    inputs.map((i) => i.focusNeed.id),
    ["shelter", "water"],
  );
  assert.ok(inputs.every((i) => i.focusMode === "automatic"));
  let queue = await responseQueue(s, org);
  assert.equal(queue.total, 2);
  assert.ok(queue.rows.every((n) => n.investigationDeferred));
  assert.equal(
    (await new Intake(s, { org, autoInvestigate: true }).kick()).empty,
    true,
  );
  await s.put(
    org,
    "resource",
    "new-energy",
    { owner: org, type: "energy", quantity: 1, floor: 0, reserved: 0 },
    0,
  );
  queue = await responseQueue(s, org);
  assert.ok(queue.rows.every((n) => !n.investigationDeferred));
  await investigator.run({}, "changed-focus");
  assert.equal(inputs.at(-1).focusNeed.id, "shelter");
});

test("automatic planning batches concurrent native needs while a manual focus remains specific", async (t) => {
  for (const automatic of [true, false]) {
    const s = await setup(t),
      config = {
        org,
        peers: [],
        maxCalls: 2,
        modelId: "recorded-batch-policy",
      };
    for (const id of ["one", "two"])
      await s.put(
        org,
        "need",
        id,
        {
          type: "water",
          quantity: 20,
          unit: "L",
          deadline: id === "one" ? 1000 : 2000,
          node: "b",
        },
        0,
      );
    await s.put(
      org,
      "resource",
      "water-stock",
      {
        owner: org,
        type: "water",
        quantity: 100,
        reserved: 0,
        floor: 20,
        node: "a",
      },
      0,
    );
    for (const id of ["v1", "v2"])
      await s.put(
        org,
        "vehicle",
        id,
        { owner: org, node: "a", state: "idle", capacity: 20 },
        0,
      );
    await s.put(
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
    let calls = 0;
    const provider = {
      complete: async ({ messages }) => {
        calls++;
        const indices =
          calls === 2
            ? JSON.parse(messages.at(-1).content).allocations.map((_, i) => i)
            : [];
        return {
          usage: { providerCost: 0 },
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "batch-" + calls,
                type: "function",
                function: {
                  name: calls === 1 ? "plan_allocations" : "prepare_allocation",
                  arguments: JSON.stringify(
                    calls === 1
                      ? {}
                      : {
                          indices,
                          title: "A useful reviewed batch",
                          rationale:
                            "Current source quantities, protected reserves and finite vehicles are checked.",
                          benefit: "Useful water deliveries to received needs",
                        },
                  ),
                },
              },
            ],
          },
        };
      },
    };
    const investigator = new Investigator({
      store: s,
      domain: new Domain(s, config),
      config,
      provider,
    });
    const activity = await investigator.run(
      automatic ? {} : { needId: "one" },
      "batch-" + automatic,
    );
    assert.equal(activity.state, "ready", JSON.stringify(activity.steps));
    const proposal = await s.get(org, "proposal", activity.proposalId);
    assert.equal(proposal.state, "awaiting_review");
    assert.equal(proposal.actions.length, automatic ? 2 : 1);
    assert.equal(proposal.authorization, null);
  }
});
