import test from "node:test";
import assert from "node:assert/strict";
import { Store, hash } from "../src/store.mjs";
import { Network, sign } from "../src/network.mjs";
import { Worker } from "../src/worker.mjs";
import { responseQueue } from "../src/response-policy.mjs";
import { repairContext } from "../src/repair.mjs";

const action = {
  type: "dispatch",
  owner: "org1",
  dependsOn: [],
  params: {
    need: "n",
    vehicle: "v",
    resource: "r",
    quantity: 19,
    ttlMs: 1500000,
  },
};
const operation = {
  id: "pickup",
  org: "org1",
  type: "delivery",
  state: "failed",
  failure: "commitment_invalid",
  need: "n",
  vehicle: "v",
  resource: "r",
  quantity: 19,
  received: 0,
  times: { authorized: 100, pickupDispatched: 101, pickupArrived: 1100000 },
  commitment: "expired",
};
async function setup(t) {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  await s.organization("org1");
  const authorization = { by: "owner", planHash: hash([action]) };
  await s.upsert("org0", "need", "n", {
    type: "blankets",
    quantity: 19,
    served: 0,
  });
  await s.put(
    "org0",
    "proposal",
    "collective",
    {
      state: "executing",
      actions: [action],
      conditions: [],
      references: [],
      authorization,
      executionResults: [
        {
          index: 0,
          owner: "org1",
          state: "in_transit",
          requestId: "work_collective_0",
          partnerResult: { ...operation, state: "arrived" },
        },
      ],
    },
    0,
  );
  await s.upsert("org0", "operation", "peer:org1:pickup", {
    ...operation,
    state: "arrived",
    owner: "org1",
    sourceId: "pickup",
    proposalId: "collective",
    step: 0,
    confirmedBySource: true,
  });
  await s.enqueueContinuation("org0", "collective");
  await s.put(
    "org1",
    "proposal",
    "owner-work",
    {
      state: "executing",
      actions: [action],
      conditions: [],
      references: [],
      simId: "sim",
      authorization,
      originPartner: "org0",
      originProposal: "collective",
      originStep: 0,
      executionResults: [{ index: 0, result: { id: "pickup" } }],
    },
    0,
  );
  const ownerNetwork = new Network(s, { org: "org1", peers: [] }),
    receiving = new Network(s, {
      org: "org0",
      peers: [{ org: "org1", key: "test-local-key" }],
    });
  const worker = new Worker({
    store: s,
    config: { org: "org1" },
    network: ownerNetwork,
    connector: {
      state: async () => ({
        now: 1200000,
        organization: { id: "org1" },
        proposals: [
          {
            id: "sim",
            state: "authorized",
            plan: { actions: [structuredClone(action)] },
          },
        ],
        operations: [operation],
      }),
    },
  });
  const deliver = async () => {
    const jobs = (
      await s.query(
        "SELECT payload FROM jobs WHERE org='org1' AND kind='peer_send'",
      )
    ).rows;
    assert.equal(jobs.length, 1);
    const envelope = { message: jobs[0].payload.message, sentAt: Date.now() };
    return receiving.receive(
      "org1",
      sign("test-local-key", envelope),
      envelope,
    );
  };
  return { s, worker, deliver, receiving };
}

test("received failed pickup frees only a planning hold, preserves sunk trip history and requires new owner review", async (t) => {
  const { s, worker, deliver } = await setup(t);
  assert.equal((await responseQueue(s, "org0")).rows.length, 0);
  assert.equal((await worker.execute("owner-work")).requiresReview, true);
  await deliver();
  const p = await s.get("org0", "proposal", "collective"),
    queue = await responseQueue(s, "org0");
  assert.equal(p.state, "requires_review");
  assert.equal(p.authorization, null);
  assert.equal(p.previousAuthorization.by, "owner");
  assert.equal(
    p.executionResults[0].partnerResult.failure,
    "commitment_invalid",
  );
  assert.equal(queue.rows[0].planningOutstanding, 19);
  assert.equal(queue.planningHolds.length, 0);
  const history = await repairContext(s, "org0", "collective", []);
  assert.equal(history.inheritedWork[0].state, "failed_history");
  assert.equal(history.inheritedWork[0].receipt.times.pickupArrived, 1100000);
  assert.equal((await worker.execute("owner-work")).skipped, true);
  assert.equal(
    (
      await s.query(
        "SELECT COUNT(*) AS n FROM jobs WHERE org='org0' AND kind='continue_proposal' AND state IN ('queued','running','retry')",
      )
    ).rows[0].n,
    0,
  );
});

test("late authenticated failure preserves a concurrent operator cancellation and already issued work", async (t) => {
  const { s, worker, deliver } = await setup(t);
  await worker.execute("owner-work");
  await s.upsert("org0", "proposal", "collective", {
    state: "cancelled",
    authorization: null,
  });
  await deliver();
  assert.equal(
    (await s.get("org0", "proposal", "collective")).state,
    "cancelled",
  );
  assert.equal(
    (await s.get("org0", "operation", "peer:org1:pickup")).state,
    "failed",
  );
});

test("a partner failure boolean cannot replace the bound physical operation", async (t) => {
  const { s, receiving } = await setup(t),
    now = Date.now();
  const message = {
    id: "invalid",
    from: "org1",
    to: "org0",
    kind: "response_receipt",
    entityId: "work_collective_0",
    version: 1,
    permissionVersion: 1,
    at: now,
    expiresAt: now + 10000,
    revoke: false,
    projection: {
      originProposal: "collective",
      originStep: 0,
      state: "failed",
      operation: { confirmedBySource: true },
    },
  };
  const envelope = { message, sentAt: now };
  await assert.rejects(
    receiving.receive("org1", sign("test-local-key", envelope), envelope),
    (e) => e.code === "PEER_RECEIPT",
  );
  assert.equal(
    (await s.get("org0", "proposal", "collective")).state,
    "executing",
  );
  assert.equal(
    (await s.get("org0", "operation", "peer:org1:pickup")).state,
    "arrived",
  );
});

test("a peer blockage repair must address its bound source trip; cancellation uses the source ID", async (t) => {
  const { s } = await setup(t);
  await s.upsert("org0", "proposal", "collective", {
    state: "requires_review",
    authorization: null,
  });
  await s.upsert("org0", "operation", "peer:org1:pickup", { state: "blocked" });
  await assert.rejects(
    repairContext(s, "org0", "collective", [action]),
    (e) => e.code === "REPAIR_UNADDRESSED",
  );
  const history = await repairContext(s, "org0", "collective", [
    { type: "cancel", owner: "org1", params: { id: "pickup" }, dependsOn: [] },
  ]);
  assert.equal(history.inheritedWork[0].operationId, "peer:org1:pickup");
  assert.equal(history.inheritedWork[0].state, "still_in_progress");
});
