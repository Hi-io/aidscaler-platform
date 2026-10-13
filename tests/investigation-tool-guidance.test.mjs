import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import {
  Investigator,
  researchTools,
  planningToolGuidance,
} from "../src/investigation.mjs";
import { ReplayProvider } from "../src/provider.mjs";
import { readContext, recordPreview } from "../src/case-context.mjs";

const message = (name, args) => ({
  role: "assistant",
  tool_calls: [
    {
      id: name,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});
const finish = message("finish_without_proposal", {
  reason:
    "Received projections are evidence only. No owner has approved execution.",
});
async function fixture(t, messages, action) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  const config = {
    org: "org0",
    peers: [{ org: "org1" }],
    modelId: "recorded-tool-guidance",
    maxCalls: messages.length,
  };
  const requests = [],
    queries = [];
  const connector = {
    startModel: async () => ({ id: "recorded-timing" }),
    finishModel: async () => {},
    state: async () => ({ queries, inspections: [] }),
    action: async (type, args) => {
      requests.push({ type, args });
      if (action) return action(type, args, queries);
      throw Error("No source request should be emitted by this fixture");
    },
  };
  return {
    store,
    requests,
    investigator: new Investigator({
      store,
      config,
      connector,
      domain: new Domain(store, config),
      provider: new ReplayProvider(messages),
    }),
  };
}

for (const policy of ["aidscaler", "general"]) {
  test(`${policy} uses only scoped partner projection after foreign verification and ambiguous lookup are refused`, async (t) => {
    const f = await fixture(
      t,
      [
        message("verify", {
          target: "resource",
          id: "foreign-staff",
          reason: "Check staff qualification",
        }),
        message("lookup", { target: "capabilities" }),
        message("lookup", { target: "capabilities", org: "org1" }),
        finish,
      ],
      (type, args, queries) => {
        assert.equal(type, "query");
        assert.deepEqual(args, { target: "capabilities", org: "org1" });
        const q = {
          id: "permitted-capabilities",
          state: "ready",
          target: args.target,
          result: {
            org: "org1",
            resources: [{ id: "foreign-staff", type: "staff", available: 2 }],
          },
        };
        queries.push(q);
        return { id: q.id, state: "pending" };
      },
    );
    await f.store.upsert("org0", "peer_offer", "consented-staff", {
      from: "org1",
      kind: "resource",
      entity: "foreign-staff",
      active: true,
      expiresAt: Date.now() + 60000,
      projection: { id: "foreign-staff", type: "staff", available: 2 },
    });
    const a = await f.investigator.run(
      { policy, focusMode: "manual" },
      "scoped-" + policy,
    );
    assert.equal(a.steps[0].result.error, "TOOL_OWNER_SCOPE");
    assert.equal(a.steps[1].result.error, "TOOL_ARGUMENTS");
    assert.equal(a.steps[2].result.result.org, "org1");
    assert.equal(
      f.requests.length,
      1,
      "Invalid or foreign direct inquiries must not reach the source",
    );
    assert.equal((await f.store.list("org0", "resource")).length, 0);
    assert.equal((await f.store.list("org0", "proposal")).length, 0);
    assert.equal((await f.store.list("org0", "operation")).length, 0);
  });
}

test("peer offers filter by received resource type and preserve exact staff profile evidence", async (t) => {
  const f = await fixture(t, [finish]);
  await f.store.upsert("org0", "peer_offer", "staff-offer", {
    kind: "resource",
    from: "org1",
    projection: {
      id: "pool",
      type: "staff",
      available: 2,
      qualificationCounts: { field_assessment: 1, shelter_support: 1 },
      qualificationProfiles: [
        { qualifications: ["field_assessment"], available: 1 },
        { qualifications: ["shelter_support"], available: 1 },
      ],
    },
  });
  await f.store.upsert("org0", "peer_offer", "sanitation-offer", {
    kind: "resource",
    from: "org1",
    projection: { id: "sanitation", type: "sanitation", available: 3 },
  });
  const actual = await readContext(f.store, "org0", {
    kind: "peer_offer",
    type: "staff",
  });
  assert.deepEqual(
    actual.records.map((r) => r.id),
    ["staff-offer"],
  );
  assert.equal(actual.records[0].projection.qualificationProfiles.length, 2);
  const misclassified = await readContext(f.store, "org0", {
    kind: "peer_offer",
    type: "resource",
  });
  assert.equal(misclassified.records.length, 0);
  assert.equal(
    (await readContext(f.store, "org0", { kind: "peer_offer" })).records.length,
    2,
  );
  const preview = recordPreview("resource", {
    id: "staff",
    type: "staff",
    qualificationCounts: { field_assessment: 1 },
    qualificationProfiles: [
      { qualifications: ["field_assessment"], available: 1 },
    ],
  });
  assert.equal(preview.qualificationProfiles[0].available, 1);
});

test("a pending actual field assessment advises waiting rather than assigning a second crew or invoking a fake tool", async (t) => {
  const f = await fixture(t, [
    message("plan_assessment", { building: "site" }),
    finish,
  ]);
  await f.store.upsert("org0", "source", "simulator", { simulatedAt: 2000 });
  await f.store.upsert("org0", "facility", "site", {
    use: "shelter",
    capacity: 30,
    sourceVersion: 7,
    node: "n",
    safe: false,
  });
  await f.store.upsert("org0", "verification", "pending-assessment", {
    target: "building",
    entity: "site",
    method: "field",
    purpose: "facility_safety",
    targetVersion: 7,
    state: "travelling",
    sourceOwner: "org1",
  });
  const a = await f.investigator.run(
    { facilityId: "site", policy: "general" },
    "pending-assessment-guide",
  );
  assert.equal(a.steps[0].result.nextTool, null);
  assert.equal(a.steps[0].result.noDuplicateWork, true);
  assert.equal(a.steps[0].result.pending[0].inspection, "pending-assessment");
  assert.equal(f.requests.length, 0);
  assert.equal((await f.store.list("org0", "proposal")).length, 0);
  const advertised = new Set(researchTools.map((t) => t.function.name));
  for (const [name, result] of [
    [
      "plan_service",
      {
        building: "site",
        missing: [{ type: "current_safety_assessment", quantity: 1 }],
      },
    ],
    [
      "plan_service",
      { building: "site", missing: [{ type: "sanitation", quantity: 2 }] },
    ],
    [
      "plan_assessment",
      {
        building: "site",
        missing: [{ type: "facility_metadata", quantity: 1 }],
      },
    ],
    ["plan_repair", { pending: [{ operationId: "blocked-trip" }] }],
  ]) {
    const next = planningToolGuidance(name, result);
    assert.ok(advertised.has(next.nextTool));
    assert.ok(next.nextArguments);
  }
});

test("generic capability composition cannot be mistaken for a checked site with transport or permission", async (t) => {
  const f = await fixture(t, [
    message("compose_service", { service: "shelter" }),
    finish,
  ]);
  const a = await f.investigator.run(
    { policy: "general", focusMode: "manual" },
    "generic-template-guide",
  );
  const result = a.steps[0].result;
  assert.equal(result.planningScope, "generic_capability_template");
  assert.equal(result.siteFeasibilityChecked, false);
  assert.equal(result.nextTool, "plan_service");
  assert.equal(f.requests.length, 0);
  assert.equal((await f.store.list("org0", "proposal")).length, 0);
});
