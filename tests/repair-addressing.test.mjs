import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { repairContext } from "../src/repair.mjs";
import { Domain } from "../src/domain.mjs";
import { Worker } from "../src/worker.mjs";
import { hash } from "../src/store.mjs";

test("unrelated extra help cannot claim to repair a loaded blocked trip", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  const original = {
    type: "dispatch",
    owner: "org0",
    params: { vehicle: "v1", resource: "water", need: "n", quantity: 300 },
    dependsOn: [],
  };
  await s.put(
    "org0",
    "operation",
    "blocked",
    {
      vehicle: "v1",
      state: "blocked",
      confirmedBySource: true,
      quantity: 300,
      destination: "n13",
      need: "n",
    },
    0,
  );
  await s.put(
    "org0",
    "proposal",
    "old",
    {
      state: "requires_review",
      actions: [original],
      affectedSteps: [0],
      executionResults: [{ index: 0, result: { id: "blocked" } }],
    },
    0,
  );
  await assert.rejects(
    repairContext(s, "org0", "old", [
      { ...original, params: { ...original.params, vehicle: "other" } },
    ]),
    { code: "REPAIR_UNADDRESSED" },
  );
  const result = await repairContext(s, "org0", "old", [
    {
      type: "reroute",
      owner: "org0",
      params: { vehicle: "v1", destination: "n13" },
      dependsOn: [],
    },
  ]);
  assert.equal(result.inheritedWork[0].operationId, "blocked");
  assert.equal(result.inheritedWork[0].state, "still_in_progress");
});

test("completed replacement work does not close an inherited physical blockage that still exists", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  const actions = [
    { type: "coverage", owner: "org0", params: {}, dependsOn: [] },
  ];
  await s.put(
    "org0",
    "proposal",
    "old",
    { state: "requires_review", actions: [], affectedSteps: [0] },
    0,
  );
  await s.put(
    "org0",
    "proposal",
    "replacement",
    {
      state: "executing",
      actions,
      conditions: [],
      references: [],
      simId: "sim",
      repairOf: "old",
      inheritedWork: [
        {
          operationId: "blocked",
          state: "still_in_progress",
          action: { type: "dispatch", owner: "org0", params: { vehicle: "v" } },
        },
      ],
      authorization: { by: "owner", planHash: hash(actions) },
      executionResults: [{ index: 0, result: { id: "coverage-ack" } }],
    },
    0,
  );
  const worker = new Worker({
    store: s,
    config: { org: "org0" },
    connector: {
      state: async () => ({
        organization: { id: "org0" },
        proposals: [
          {
            id: "sim",
            state: "authorized",
            plan: { actions: structuredClone(actions) },
          },
        ],
        operations: [{ id: "blocked", state: "blocked" }],
      }),
    },
  });
  await worker.execute("replacement");
  assert.equal(
    (await s.get("org0", "proposal", "old")).state,
    "requires_review",
  );
});
