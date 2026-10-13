import test from "node:test";
import assert from "node:assert/strict";
import { Store, hash } from "../src/store.mjs";
import { Worker } from "../src/worker.mjs";

const actions = [
  {
    type: "dispatch",
    owner: "org0",
    dependsOn: [],
    params: {
      vehicle: "truck",
      resource: "water",
      need: "request",
      quantity: 50,
    },
  },
];
async function fixture(
  t,
  { sourceState = "awaiting_approval", issued = false } = {},
) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  const authorization = {
    by: "owner",
    at: 1,
    expiresAt: Date.now() + 3600000,
    planHash: hash(actions),
  };
  const executionResults = issued
    ? [{ index: 0, result: { id: "cargo", state: "loading" } }]
    : [];
  await store.put(
    "org0",
    "proposal",
    "response",
    {
      state: issued ? "executing" : "authorized",
      actions,
      conditions: [],
      references: [],
      simId: "source-plan",
      authorization,
      executionResults,
    },
    0,
  );
  const source = {
    now: 1000,
    organization: { id: "org0" },
    proposals: [
      {
        id: "source-plan",
        org: "org0",
        state: sourceState,
        version: 1,
        plan: { actions: structuredClone(actions) },
      },
    ],
    operations: issued
      ? [{ id: "cargo", type: "delivery", state: "loading", quantity: 50 }]
      : [],
    inspections: [],
    queries: [],
    known: { buildings: {} },
  };
  return { store, authorization, executionResults, source };
}
async function revoke(f, state) {
  const row = await f.store.get("org0", "proposal", "response");
  await f.store.put(
    "org0",
    "proposal",
    row.id,
    {
      ...row,
      state,
      previousAuthorization: row.authorization,
      authorization: null,
      changedReason:
        "A current human decision superseded this execution while source I/O was pending",
    },
    row.version,
  );
}

for (const sourceState of [
  "awaiting_approval",
  "authorized",
  "rejected",
  "needs_clarification",
]) {
  for (const localState of ["cancelled", "requires_review"]) {
    test(`${sourceState} source observation cannot undo a concurrent ${localState} decision or approve new work`, async (t) => {
      const f = await fixture(t, { sourceState, issued: true });
      let commands = 0,
        reads = 0;
      const worker = new Worker({
        store: f.store,
        config: { org: "org0" },
        connector: {
          state: async () => {
            if (++reads === 1) await revoke(f, localState);
            return f.source;
          },
          action: async () => {
            commands++;
            throw Error(
              "Obsolete authority must not send source review or a physical command",
            );
          },
        },
      });
      const result = await worker.execute("response"),
        row = await f.store.get("org0", "proposal", "response");
      assert.equal(result.authorityChanged, true);
      assert.equal(row.state, localState);
      assert.equal(row.authorization, null);
      assert.deepEqual(row.previousAuthorization, f.authorization);
      assert.deepEqual(row.executionResults, f.executionResults);
      assert.equal(row.sourceReview, undefined);
      assert.equal(commands, 0);
      assert.equal(f.source.operations[0].quantity, 50);
      assert.equal((await worker.execute("response")).skipped, true);
      assert.equal(
        (
          await f.store.query(
            "SELECT count(*)::int AS n FROM jobs WHERE state IN ('queued','retry','running')",
          )
        ).rows[0].n,
        0,
      );
    });
  }
}

test("a cancellation after source approval was queued preserves the cancellation and never starts its physical actions", async (t) => {
  const f = await fixture(t);
  let reviews = 0,
    commands = 0,
    reads = 0;
  const worker = new Worker({
    store: f.store,
    config: { org: "org0" },
    connector: {
      state: async () => {
        if (++reads === 2) await revoke(f, "cancelled");
        return f.source;
      },
      action: async (type, params, key, options) => {
        if (type !== "review") {
          commands++;
          throw Error("No physical work follows cancellation");
        }
        reviews++;
        assert.equal(options.human, true);
        assert.equal(options.version, 1);
        assert.deepEqual(params, { id: "source-plan", decision: "approve" });
        f.source.proposals[0].reviewPending = true;
        return { id: "source-plan", state: "queued", readyAt: 2000 };
      },
    },
  });
  assert.equal((await worker.execute("response")).authorityChanged, true);
  const row = await f.store.get("org0", "proposal", "response");
  assert.equal(row.state, "cancelled");
  assert.equal(row.authorization, null);
  assert.deepEqual(row.previousAuthorization, f.authorization);
  assert.equal(row.sourceReview, undefined);
  assert.equal(reviews, 1);
  assert.equal(commands, 0);
  f.source.proposals[0].state = "authorized";
  assert.equal((await worker.execute("response")).skipped, true);
  assert.equal(commands, 0);
});

for (const state of ["awaiting_approval", "authorized"]) {
  test(`a ${state} operational plan that changes quantities preserves loaded cargo and requires new exact owner review`, async (t) => {
    const f = await fixture(t, { sourceState: state, issued: true });
    let commands = 0;
    f.source.proposals[0].plan.actions[0].params.quantity = 75;
    const worker = new Worker({
      store: f.store,
      config: { org: "org0" },
      connector: {
        state: async () => f.source,
        action: async () => {
          commands++;
          throw Error("Modified source scope is not local authorization");
        },
      },
    });
    const result = await worker.execute("response"),
      row = await f.store.get("org0", "proposal", "response");
    assert.equal(result.requiresReview, true);
    assert.equal(result.scopeChanged, true);
    assert.equal(row.state, "requires_review");
    assert.equal(row.authorization, null);
    assert.deepEqual(row.previousAuthorization, f.authorization);
    assert.deepEqual(row.executionResults, f.executionResults);
    assert.equal(row.actions[0].params.quantity, 50);
    assert.equal(row.sourceReview.state, "scope_changed");
    assert.notEqual(
      row.sourceReview.approvedPlanHash,
      row.sourceReview.receivedPlanHash,
    );
    assert.equal(f.source.operations[0].quantity, 50);
    assert.equal(commands, 0);
    assert.equal((await worker.execute("response")).skipped, true);
  });
}

test("an absent source plan cannot stand in for exact operational authorization", async (t) => {
  const f = await fixture(t, { sourceState: "authorized" });
  delete f.source.proposals[0].plan;
  let commands = 0;
  const worker = new Worker({
    store: f.store,
    config: { org: "org0" },
    connector: {
      state: async () => f.source,
      action: async () => {
        commands++;
        throw Error("Missing exact scope is not authority");
      },
    },
  });
  assert.equal((await worker.execute("response")).scopeChanged, true);
  assert.equal(
    (await f.store.get("org0", "proposal", "response")).sourceReview
      .receivedPlanHash,
    null,
  );
  assert.equal(commands, 0);
});
