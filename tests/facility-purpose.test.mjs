import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { Investigator } from "../src/investigation.mjs";
import { ReplayProvider } from "../src/provider.mjs";
import { servicePlan } from "../src/services.mjs";
import { validatePlan } from "../src/planning.mjs";

test("a safe demand location with zero service capacity cannot become a composed or custom shelter", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.upsert("org0", "facility", "demand-site", {
    use: "residential",
    safe: true,
    capacity: 0,
    node: "n1",
    dependencies: { water: 60 },
  });
  await assert.rejects(
    () => servicePlan(store, "org0", "demand-site"),
    (e) => e.code === "FACILITY_PURPOSE",
  );
  await assert.rejects(
    () =>
      validatePlan(store, "org0", {
        actions: [
          {
            type: "activate",
            owner: "org0",
            params: { building: "demand-site", permit: true },
            dependsOn: [],
          },
        ],
        conditions: [],
        references: ["demand-site"],
      }),
    (e) => e.code === "FACILITY_PURPOSE",
  );
  assert.equal((await store.list("org0", "proposal")).length, 0);
});

test("facility research reads only the received directory and does not invent safety or unknown sites", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.upsert("org0", "context", "geography", {
    map: {
      places: [
        { id: "demand-site", use: "residential", node: "n1" },
        { id: "possible-site", use: "shelter", node: "n2" },
      ],
    },
  });
  const config = {
    org: "org0",
    modelId: "recorded-fixture",
    maxCalls: 2,
    peers: [],
  };
  const call = (id, name, args) => ({
    role: "assistant",
    tool_calls: [
      {
        id,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  });
  const provider = new ReplayProvider([
    call("t1", "find_facilities", { use: "shelter" }),
    call("t2", "finish_without_proposal", {
      reason: "A directory alone does not establish safety or permission.",
    }),
  ]);
  const connector = {
    startModel: async () => ({ id: "m" }),
    finishModel: async () => {},
    ack: async () => {},
    state: async () => ({}),
  };
  const agent = new Investigator({
    store,
    domain: new Domain(store, config),
    connector,
    provider,
    config,
  });
  const result = await agent.run({}, "directory-test");
  const candidates = result.steps[0].result.candidates;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, "possible-site");
  assert.equal(candidates[0].receivedAssessment, null);
  assert.equal(result.steps[0].result.source, "received_geography_directory");
  assert.equal(result.state, "inconclusive");
  assert.equal((await store.list("org0", "operation")).length, 0);
});
