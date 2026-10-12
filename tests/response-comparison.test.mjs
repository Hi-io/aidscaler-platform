import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { Investigator } from "../src/investigation.mjs";
import { ReplayProvider } from "../src/provider.mjs";
import { responseOptions } from "../src/response-options.mjs";
import { blockedRepairEpisode } from "../evaluation/blocked-repair.mjs";
import {
  captureResponseComparison,
  assertComparisonSourcesCurrent,
  assertComparisonOptionsCurrent,
  consideredAlternatives,
} from "../src/response-comparison.mjs";

const call = (name, args = {}) => ({
  role: "assistant",
  tool_calls: [
    {
      id: name,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});
const prepare = {
  title: "Supply the shelter",
  benefit: "Proposed water, pending human review",
  rationale: "Compare received capacity while retaining unresolved options.",
  indices: [0],
};
async function fixture(t) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.organization("org1");
  await store.upsert("org0", "need", "need", {
    type: "water",
    unit: "L",
    quantity: 100,
    served: 0,
  });
  await store.upsert("org0", "resource", "water", {
    owner: "org0",
    type: "water",
    quantity: 100,
    reserved: 0,
    floor: 0,
  });
  await store.upsert("org0", "vehicle", "truck", {
    owner: "org0",
    capacity: 100,
    state: "idle",
  });
  await store.upsert("org0", "context", "geography", {
    map: { places: [{ id: "plant", use: "plant" }] },
  });
  await store.upsert("org1", "facility", "private-plant", {
    safe: true,
    use: "plant",
    capacity: 9000,
  });
  const config = {
    org: "org0",
    peers: [],
    modelId: "recorded-comparison",
    maxCalls: 4,
  };
  const domain = new Domain(store, config);
  return { store, config, domain };
}
async function run(
  f,
  messages,
  provider = new ReplayProvider(messages),
  job = "comparison-fixture",
) {
  return new Investigator({
    ...f,
    provider,
    connector: {
      startModel: async () => ({ id: "timing" }),
      finishModel: async () => {},
    },
  }).run({}, job);
}
async function compare(f) {
  const options = await responseOptions(f.store, f.config, { needId: "need" });
  return {
    options,
    comparison: await captureResponseComparison(f.store, "org0", options, {
      needId: "need",
    }),
  };
}
function draft(comparison) {
  return {
    ...prepare,
    summary: prepare.benefit,
    references: ["need", "water", "truck", ...comparison.references],
    conditions: [],
    alternatives: consideredAlternatives(comparison, [
      {
        type: "dispatch",
        owner: "org0",
        params: { need: "need", quantity: 100 },
      },
    ]),
    actions: [
      {
        type: "dispatch",
        owner: "org0",
        params: {
          need: "need",
          resource: "water",
          vehicle: "truck",
          quantity: 100,
        },
        dependsOn: [],
      },
    ],
  };
}

test("compiled allocation persists only actually compared, bounded options and unresolved site status", async (t) => {
  const f = await fixture(t),
    activity = await run(f, [
      call("compare_responses"),
      call("plan_allocations"),
      call("prepare_allocation", prepare),
    ]);
  const p = await f.store.get("org0", "proposal", activity.proposalId);
  assert.equal(p.state, "awaiting_review");
  assert.equal(p.authorization, null);
  assert.equal(p.alternatives.length, 1);
  assert.match(p.alternatives[0].reason, /checks/);
  assert.equal(p.comparison.org, "org0");
  assert.equal(
    p.comparison.options.find((c) => c.building === "plant").status,
    "pending_checks",
  );
  assert.ok(
    p.comparison.sourceVersions.some(
      (v) => v.kind === "context" && v.id === "geography",
    ),
  );
  assert.ok(!JSON.stringify(p.comparison).includes("private-plant"));
  assert.ok(p.comparison.options.length <= 5);
  assert.ok(p.alternatives.length <= 4);
  assert.deepEqual(
    (
      await f.store.get(
        "org0",
        "investigation_checkpoint",
        "comparison-fixture",
      )
    ).state,
    "completed",
  );
  assert.equal(
    (
      await f.store.query(
        "SELECT COUNT(*)::int AS n FROM jobs WHERE kind='execute_proposal'",
      )
    ).rows[0].n,
    0,
  );
});

test("compiled preparation without comparison does not manufacture alternatives", async (t) => {
  const f = await fixture(t),
    activity = await run(f, [
      call("plan_allocations"),
      call("prepare_allocation", prepare),
    ]);
  const p = await f.store.get("org0", "proposal", activity.proposalId);
  assert.deepEqual(p.alternatives, []);
  assert.equal(p.comparison, undefined);
});

test("a material alternative change before compiled preparation cannot silently persist an outdated comparison", async (t) => {
  const f = await fixture(t),
    replay = new ReplayProvider([
      call("compare_responses"),
      call("plan_allocations"),
      call("prepare_allocation", prepare),
      call("finish_without_proposal", {
        reason: "The alternative changed; a new comparison is needed.",
      }),
    ]);
  let calls = 0;
  const provider = {
    complete: async (x) => {
      if (++calls === 2)
        await f.store.upsert("org0", "context", "geography", {
          map: { places: [{ id: "new-plant", use: "plant" }] },
        });
      return replay.complete(x);
    },
  };
  const result = await run(f, [], provider);
  assert.equal(result.proposalId, null);
  assert.ok(result.steps.some((s) => s.result?.error === "COMPARISON_CHANGED"));
  assert.equal((await f.store.list("org0", "proposal")).length, 0);
});

test("read and capture timestamps alone do not invalidate a comparison, but permissions and actual expiry do", async (t) => {
  const f = await fixture(t);
  await f.store.upsert("org0", "peer_offer", "offer", {
    from: "org1",
    active: true,
    expiresAt: Date.now() + 100000,
    permissionVersion: 1,
    kind: "resource",
    projection: { id: "r", type: "water", available: 10 },
  });
  const { options, comparison } = await compare(f);
  await assertComparisonOptionsCurrent(
    f.store,
    "org0",
    { ...comparison, capturedAt: 0 },
    { ...options, generatedAt: Date.now(), readAt: Date.now() },
  );
  const synthetic = await captureResponseComparison(f.store, "org0", {
    ...options,
    serviceAlternatives: [
      {
        building: "plant",
        readyToDraft: false,
        nextCheck: "verify",
        references: ["offer"],
      },
    ],
  });
  await assert.rejects(
    assertComparisonSourcesCurrent(f.store, "org1", synthetic),
    { code: "COMPARISON_SCOPE" },
  );
  await f.store.upsert("org0", "peer_offer", "offer", { permissionVersion: 2 });
  await assert.rejects(
    assertComparisonSourcesCurrent(f.store, "org0", synthetic),
    { code: "COMPARISON_CHANGED" },
  );
  const fresh = await captureResponseComparison(f.store, "org0", {
    ...options,
    serviceAlternatives: [{ building: "plant", references: ["offer"] }],
  });
  const realNow = Date.now;
  t.after(() => {
    Date.now = realNow;
  });
  Date.now = () => realNow() + 200000;
  await assert.rejects(assertComparisonSourcesCurrent(f.store, "org0", fresh), {
    code: "COMPARISON_CHANGED",
  });
});

test("approval revalidates alternative evidence and policy; manual revision clears stale comparison", async (t) => {
  const f = await fixture(t),
    { comparison } = await compare(f),
    actor = { org: "org0", id: "owner", role: "commander" };
  const d = draft(comparison);
  delete d.indices;
  const p = await f.domain.propose(actor, d, "choice", { comparison });
  await f.store.upsert("org0", "response_policy", "active", {
    approved: true,
    order: "deadline_then_priority",
  });
  await assert.rejects(
    f.domain.review(
      actor,
      p.id,
      { decision: "approve", version: p.version },
      "stale-approve",
    ),
    { code: "COMPARISON_CHANGED" },
  );
  const clarified = await f.domain.review(
    actor,
    p.id,
    { decision: "clarify", version: p.version },
    "clarify",
  );
  const revised = await f.domain.revise(
    actor,
    p.id,
    {
      ...d,
      version: clarified.version,
      note: "Reassess manually under the new policy",
      alternatives: [],
    },
    "revision",
  );
  assert.equal(revised.comparison, null);
  assert.equal(revised.previousComparison.signature, comparison.signature);
  assert.equal(revised.authorization, null);
});

test("partial quantities and new delivery alternatives cannot pretend to complete or repair an existing loaded trip", () => {
  const comparison = {
    options: [
      {
        kind: "delivery",
        title: "Supply water",
        reason: "Observed supply only",
        quantities: [
          { owner: "org0", need: "n", quantity: 50 },
          { owner: "org0", need: "n", quantity: 50 },
        ],
      },
      {
        kind: "service",
        title: "Open site",
        building: "site",
        reason: "Missing inspection",
      },
    ],
  };
  const partial = [
    { type: "dispatch", owner: "org0", params: { need: "n", quantity: 50 } },
  ];
  assert.equal(consideredAlternatives(comparison, partial).length, 2);
  const repair = consideredAlternatives(comparison, [
    { type: "reroute", owner: "org0", params: { vehicle: "v" } },
  ]);
  assert.match(repair[0].reason, /does not repair/);
  assert.equal(
    consideredAlternatives(comparison, [
      { type: "activate", params: { building: "site" } },
    ]).length,
    1,
  );
});

test("a compared physical assessment cannot remain valid after its source-clock expiry", async (t) => {
  const f = await fixture(t);
  await f.store.upsert("org0", "source", "simulator", { simulatedAt: 100 });
  await f.store.upsert("org0", "verification", "inspection", {
    result: { assessment: { validUntil: 200 } },
  });
  const { options } = await compare(f),
    comparison = await captureResponseComparison(f.store, "org0", {
      ...options,
      serviceAlternatives: [{ building: "plant", references: ["inspection"] }],
    });
  await assertComparisonSourcesCurrent(f.store, "org0", comparison);
  await f.store.upsert("org0", "source", "simulator", { simulatedAt: 200 });
  await assert.rejects(
    assertComparisonSourcesCurrent(f.store, "org0", comparison),
    { code: "COMPARISON_CHANGED" },
  );
});

test("identical receipt refreshes preserve comparison, while a newly assessed directory-only option invalidates it", async (t) => {
  const f = await fixture(t),
    { comparison } = await compare(f);
  await f.store.upsert("org0", "context", "geography", {
    observedAt: 9000,
    map: { places: [{ id: "plant", use: "plant" }] },
  });
  await assertComparisonSourcesCurrent(f.store, "org0", comparison);
  await f.store.upsert("org0", "facility", "plant", {
    safe: false,
    sourceVersion: 1,
  });
  await assert.rejects(
    assertComparisonSourcesCurrent(f.store, "org0", comparison),
    { code: "COMPARISON_CHANGED" },
  );
});

test("compiled service retains its compared delivery alternative and physical assessment sources", async (t) => {
  const f = await fixture(t);
  await f.store.upsert("org0", "source", "simulator", { simulatedAt: 5000 });
  await f.store.upsert("org0", "facility", "plant", {
    use: "plant",
    capacity: 100,
    node: "plant-node",
    ownerOrg: "org0",
    safe: true,
    sourceVersion: 1,
    at: 1000,
    state: "candidate",
    dependencies: {},
  });
  await f.store.upsert("org0", "verification", "inspection", {
    target: "building",
    entity: "plant",
    org: "org0",
    method: "field",
    purpose: "facility_safety",
    state: "completed",
    confirmedBySource: true,
    completedAt: 1100,
    targetVersion: 1,
    result: {
      safe: true,
      version: 1,
      assessment: {
        method: "field",
        purpose: "facility_safety",
        competent: true,
        targetVersion: 1,
        observedAt: 1000,
        validUntil: 3600000,
        qualifications: ["field_assessment"],
        inspectorOrg: "org0",
        staffResource: "crew",
        vehicle: "inspection-car",
        operation: "inspection-trip",
      },
    },
  });
  const activity = await run(f, [
    call("compare_responses"),
    call("plan_service", { building: "plant" }),
    call("prepare_service", prepare),
  ]);
  const p = await f.store.get("org0", "proposal", activity.proposalId);
  assert.equal(p.actions[0].type, "activate");
  assert.equal(p.alternatives[0].title, "Deliver available supplies");
  assert.ok(p.references.includes("inspection"));
  assert.ok(
    p.comparison.sourceVersions.some(
      (v) => v.id === "inspection" && v.assessmentValidUntil === 3600000,
    ),
  );
  assert.equal(p.authorization, null);
});

test(
  "compiled repair preserves a real comparison and completes the same physical cargo",
  { timeout: 120000 },
  async () => {
    let calls = 0;
    const provider = {
      complete: async () => {
        const names = ["compare_responses", "plan_repair", "prepare_repair"];
        const message = call(names[calls++], calls === 3 ? prepare : {});
        return {
          model: "recorded-comparison-repair",
          usage: { providerCost: 0 },
          message,
        };
      },
    };
    const report = await blockedRepairEpisode({ provider });
    assert.equal(
      report.status,
      "completed",
      JSON.stringify({ error: report.error, steps: report.activity?.steps }),
    );
    assert.equal(calls, 3);
    assert.ok(report.proposal.comparison);
    assert.ok(
      report.proposal.comparison.sourceVersions.some(
        (v) => v.kind === "context",
      ),
    );
    assert.equal(report.after.operationId, report.before.operationId);
    assert.equal(report.after.deliveryOperationCount, 1);
    assert.equal(report.after.stock, report.before.stock);
    assert.equal(report.after.delivered, 300);
  },
);
