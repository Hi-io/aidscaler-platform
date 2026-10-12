import test from "node:test";
import assert from "node:assert/strict";
import { caseContext, readContext, toolContext } from "../src/case-context.mjs";
import { Store } from "../src/store.mjs";
import { Investigator } from "../src/investigation.mjs";
import { Domain } from "../src/domain.mjs";
import { ReplayProvider } from "../src/provider.mjs";

test("loading custom action contracts on demand does not weaken server parameter validation", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  const config = { org: "org0", modelId: "fixture", maxCalls: 3, peers: [] };
  const call = (name, args) => ({
    role: "assistant",
    tool_calls: [
      {
        id: name,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  });
  const provider = new ReplayProvider([
    call("read_action_contract", { types: ["dispatch"] }),
    call("draft_response", {
      title: "Attempt a custom response",
      summary: "An invalid plan",
      rationale: "Testing exact contracts",
      benefit: "No operation should execute",
      references: ["source"],
      actions: [
        {
          type: "dispatch",
          owner: "org0",
          params: { vehicle: "v", resource: "r", amount: 100 },
          dependsOn: [],
        },
      ],
    }),
    call("finish_without_proposal", {
      reason: "The custom parameters did not pass validation",
    }),
  ]);
  const activity = await new Investigator({
    store,
    domain: new Domain(store, config),
    config,
    provider,
  }).run({}, "contract-read-test");
  assert.ok(
    activity.steps[0].result.parameterSchemas.dispatch.required.includes(
      "quantity",
    ),
  );
  assert.equal(activity.steps[1].state, "failed");
  assert.equal((await store.list("org0", "proposal")).length, 0);
  assert.equal((await store.list("org0", "operation")).length, 0);
});

test("irrelevant histories do not bury a focused urgent case, provenance or protected stock", () => {
  const needs = Array.from({ length: 1000 }, (_, i) => ({
    id: "n" + i,
    building: "b" + i,
    type: "water",
    quantity: 50,
    served: 0,
    priority: 1,
    version: 1,
  }));
  const urgent = {
    id: "selected",
    building: "critical",
    type: "shelter",
    quantity: 60,
    served: 0,
    deadline: 600000,
    priority: 0,
    sourceVersion: 8,
    uncertainty: "unconfirmed number",
  };
  const stock = {
    id: "power",
    type: "energy",
    quantity: 5,
    reserved: 2,
    floor: 2,
    compatibility: { connector: "C1", powerKw: 20 },
    sourceVersion: 3,
    owner: "org0",
  };
  const raw = {
    organization: "org0",
    signals: [
      {
        id: "post1",
        location: "critical",
        text: "Help is needed. Some reports disagree.",
        sourceVersion: 3,
        originalReferences: ["original"],
      },
    ],
    focusNeed: urgent,
    known: {
      needs: [...needs, urgent],
      resources: [stock],
      vehicles: [],
      buildings: [],
      edges: Array.from({ length: 10000 }, (_, i) => ({ id: "road" + i })),
    },
    operations: Array.from({ length: 3000 }, (_, i) => ({
      id: "op" + i,
      state: "completed",
      need: "n" + i,
      quantity: 40,
      events: Array(30).fill("noise"),
    })),
    humanEvidenceGroups: [
      {
        id: "correction",
        members: ["post1"],
        state: "active",
        reason: "Do not merge these witnesses",
      },
    ],
    knownLocations: Array.from({ length: 1000 }, (_, i) => ({
      id: "b" + i,
      name: "Community " + i,
      node: "v" + i,
    })),
    media: [],
    integrations: [],
  };
  const focused = caseContext(raw);
  assert.equal(focused.known.needs[0].id, "selected");
  assert.deepEqual(
    focused.known.resources[0].compatibility,
    stock.compatibility,
  );
  assert.equal(focused.known.resources[0].floor, 2);
  assert.equal(focused.signals[0].sourceVersion, 3);
  assert.deepEqual(focused.signals[0].originalReferences, ["original"]);
  assert.equal(
    focused.humanEvidenceGroups[0].reason,
    "Do not merge these witnesses",
  );
  assert.equal(focused.coverage.omittedFromInitialPreview.operation, 2988);
  assert.ok(JSON.stringify(focused).length < JSON.stringify(raw).length / 10);
  assert.match(focused.coverage.note, /does NOT mean absent/);
});

test("omitted received records can be retrieved in stable pages without another organization's data or credentials", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.organization("org1");
  for (let i = 0; i < 23; i++)
    await store.upsert(
      "org0",
      "resource",
      "stock" + String(i).padStart(2, "0"),
      {
        type: "water",
        quantity: i,
        reserved: 1,
        floor: 2,
        node: "n1",
        conditions: ["requires owner"],
        password: "private-fixture",
        compatibility: { apiKey: "private-fixture", connector: "C" },
      },
    );
  await store.upsert("org1", "resource", "hidden", {
    quantity: 99999,
    type: "water",
  });
  const first = await readContext(store, "org0", {
    kind: "resource",
    type: "water",
    limit: 20,
  });
  assert.equal(first.totalAvailable, 23);
  assert.equal(first.nextOffset, 20);
  const last = await readContext(store, "org0", {
    kind: "resource",
    offset: first.nextOffset,
    limit: 20,
  });
  assert.equal(last.records.length, 3);
  assert.equal(last.nextOffset, null);
  const exact = await readContext(store, "org0", {
    kind: "resource",
    ids: ["stock22", "hidden"],
    detail: true,
  });
  assert.equal(exact.records.length, 1);
  assert.equal(exact.records[0].quantity, 22);
  assert.deepEqual(exact.records[0].conditions, ["requires owner"]);
  assert.equal(exact.records[0].password, undefined);
  assert.equal(exact.records[0].compatibility.apiKey, undefined);
  assert.equal(exact.records[0].compatibility.connector, "C");
  for (const args of [
    { kind: "account" },
    { kind: "context" },
    { kind: "resource", limit: 1000 },
    { kind: "resource", offset: -1 },
  ])
    await assert.rejects(
      readContext(store, "org0", args),
      (e) => e.code === "CONTEXT_SCOPE",
    );
});

test("compiled allocation previews retain exact selection indices but omit duplicate action graphs", () => {
  const response = {
    allocations: Array.from({ length: 80 }, (_, i) => ({
      need: "n" + i,
      resource: "r" + i,
      vehicle: "v" + i,
      quantity: i + 1,
      owner: "org0",
    })),
    actions: Array(80).fill({ type: "dispatch" }),
    evidenceIds: Array(240).fill("same"),
    unserved: [{ need: "urgent", remaining: 50, unit: "litre" }],
    nextTool: "prepare_allocation",
  };
  const preview = toolContext("plan_allocations", response);
  assert.equal(preview.allocations[29].index, 29);
  assert.equal(preview.allocations[29].quantity, 30);
  assert.equal(preview.allocationsTotalAvailable, 80);
  assert.equal(preview.actions, undefined);
  assert.deepEqual(preview.unserved, response.unserved);
});

test("a length-truncated model response never executes its partial tool calls; recovery has more output space", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  const config = {
    org: "org0",
    modelId: "fixture",
    maxCalls: 2,
    modelMaxOutputTokens: 8192,
    peers: [],
  };
  let calls = 0,
    allowances = [];
  const provider = {
    async complete(args) {
      allowances.push(args.maxOutputTokens);
      calls++;
      return calls === 1
        ? {
            finishReason: "length",
            usage: {},
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "partial",
                  type: "function",
                  function: { name: "record_claim", arguments: "{}" },
                },
              ],
            },
          }
        : {
            usage: {},
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "done",
                  type: "function",
                  function: {
                    name: "finish_without_proposal",
                    arguments: JSON.stringify({ reason: "No verified demand" }),
                  },
                },
              ],
            },
          };
    },
  };
  const agent = new Investigator({
    store,
    domain: new Domain(store, config),
    config,
    provider,
  });
  const activity = await agent.run({}, "truncated-case");
  assert.deepEqual(allowances, [8192, 16384]);
  assert.equal(activity.steps[0].type, "output_limit");
  assert.equal((await store.list("org0", "claim")).length, 0);
  assert.equal(activity.calls, 2);
  assert.equal(activity.state, "inconclusive");
});
