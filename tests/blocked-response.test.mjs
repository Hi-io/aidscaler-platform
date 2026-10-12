import test from "node:test";
import assert from "node:assert/strict";
import { Store, hash } from "../src/store.mjs";
import { Worker } from "../src/worker.mjs";
import { Intake } from "../src/intake.mjs";
import { configureResponsePolicy } from "../src/response-policy.mjs";

async function setup(t) {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  return store;
}

test("a blocked loaded vehicle requests a new decision without cancelling its cargo or repeating completed work", async (t) => {
  const store = await setup(t), actions = [
    { type: "dispatch", owner: "org0", params: { vehicle: "done" } },
    { type: "dispatch", owner: "org0", params: { vehicle: "loaded", need: "water", quantity: 100 } },
  ];
  await store.put("org0", "proposal", "response", { state: "executing", actions, references: [], conditions: [], simId: "source-decision",
    authorization: { by: "owner", planHash: hash(actions) }, executionResults: [{ index: 0, result: { id: "delivered" } }, { index: 1, result: { id: "loaded-trip" } }] }, 0);
  let writes = 0;
  const physical = { organization: { id: "org0" }, proposals: [{ id: "source-decision", state: "authorized" }],
    operations: [{ id: "delivered", state: "received" }, { id: "loaded-trip", state: "blocked", quantity: 100 }] };
  const worker = new Worker({ store, config: { org: "org0" }, connector: { state: async () => physical, action: async () => { writes++; } } });
  const result = await worker.execute("response"), proposal = await store.get("org0", "proposal", "response");
  assert.equal(result.requiresReview, true); assert.deepEqual(proposal.affectedSteps, [1]); assert.deepEqual(proposal.preservedSteps, [0]);
  assert.equal(proposal.authorization, null); assert.equal(proposal.executionResults[1].result.id, "loaded-trip");
  assert.equal(physical.operations[1].state, "blocked"); assert.equal(physical.operations[1].quantity, 100);
  assert.equal((await worker.execute("response")).skipped, true); assert.equal(writes, 0);
});

test("automatic repair starts without a new post even when all requested stock is already in transit", async (t) => {
  const store = await setup(t), intake = new Intake(store, { org: "org0", autoInvestigate: true });
  await configureResponsePolicy(store, { org: "org0", id: "owner", role: "commander" }, { version: 0, order: "deadline_then_priority", reason: "Maintain useful deliveries already authorized.", maxOpenReviews: 2, investigationCooldownMs: 1000 }, "priorities");
  await store.put("org0", "need", "water", { type: "water", quantity: 100, inTransit: 100 }, 0);
  await store.put("org0", "proposal", "blocked-plan", { state: "requires_review", changedReason: "Loaded truck blocked", affectedSteps: [0], preservedSteps: [], actions: [{ type: "dispatch", owner: "org0", params: { need: "water" } }] }, 0);
  const first = await intake.kick(); assert.equal(first.queued, true);
  const job = (await store.query("SELECT * FROM jobs WHERE id=$1", [first.id])).rows[0];
  assert.equal(job.payload.repairOf, "blocked-plan"); assert.deepEqual(job.payload.ids, []);
  await store.finishJob(job.id, {}); assert.equal((await intake.kick()).empty, true);
  await store.put("org0", "proposal", "new-decision", { state: "awaiting_review", repairOf: "blocked-plan", actions: [] }, 0);
  assert.equal((await intake.kick()).empty, true);
});
