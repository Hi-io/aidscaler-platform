import test from "node:test";
import assert from "node:assert/strict";
import {
  receivedProgressReference,
  routinePublicCommentary,
} from "../src/source-relevance.mjs";
import { Store } from "../src/store.mjs";
import { SemanticIngestion } from "../src/semantic-ingestion.mjs";
import { createHarness, scriptedReview } from "../evaluation/harness.mjs";

const post = {
  id: "post",
  sourceVersion: 1,
  text: "The receiving team confirms 40 L of water.",
  location: "b7",
  publishedAt: 200,
};
const receipt = {
  id: "operation-1",
  org: "org0",
  type: "delivery",
  confirmedBySource: true,
  state: "received",
  building: "b7",
  resourceType: "water",
  quantity: 40,
  received: 40,
  times: { received: 100, service: 100 },
  observedAt: 150,
};
test("routine support is a narrow queue aid and cannot hide needs, hazards or unread media", () => {
  const support = {
    id: "support",
    text: "Thinking of the families at b7. Please keep sharing original updates, not private contact details.",
  };
  assert.equal(
    routinePublicCommentary(support).disposition,
    "routine_public_commentary_unverified",
  );
  for (const text of [
    support.text + " They need water.",
    "Thinking of the families at b7 without electricity.",
    "Thinking of the trapped people in b7.",
    "Thinking of the families at b7. Can somebody check?",
    "All needs are covered at b7.",
  ])
    assert.equal(routinePublicCommentary({ ...support, text }), null, text);
  assert.equal(
    routinePublicCommentary({
      ...support,
      attachments: [{ kind: "video", description: "Unknown content" }],
    }),
    null,
  );
});
test("public progress never substitutes for a received physical receipt", () => {
  assert.equal(receivedProgressReference(post, []), null);
  assert.equal(
    receivedProgressReference(post, [{ ...receipt, confirmedBySource: false }]),
    null,
  );
  assert.equal(
    receivedProgressReference(post, [{ ...receipt, state: "in_transit" }]),
    null,
  );
  assert.equal(
    receivedProgressReference(post, [{ ...receipt, received: 20 }]),
    null,
  );
  assert.equal(
    receivedProgressReference(post, [{ ...receipt, building: "b8" }]),
    null,
  );
  assert.equal(
    receivedProgressReference({ ...post, publishedAt: 99 }, [receipt]),
    null,
  );
  assert.equal(
    receivedProgressReference(post, [
      receipt,
      { ...receipt, id: "operation-2" },
    ]),
    null,
  );
  assert.equal(
    receivedProgressReference(post, [receipt]).operationId,
    receipt.id,
  );
  const peer = {
    ...receipt,
    id: "peer:org1:operation-1",
    owner: "org1",
    sourceId: "operation-1",
    sourceSnapshot: receipt,
  };
  delete peer.building;
  assert.equal(
    receivedProgressReference(post, [peer]).sourceOperationId,
    "operation-1",
  );
});
test("actual HTTP ingestion reconciles a source publication only after physical delivery", async (t) => {
  let calls = 0;
  const h = await createHarness({
    scenario: "S23",
    config: {
      healthReports: false,
      recurringNeeds: false,
      postsPerHour: 0,
      observationRate: 1,
      authorshipMs: 0,
      sourceIndexMs: 0,
    },
    provider: {
      complete: async () => {
        calls++;
        throw Error("Unnecessary model call");
      },
    },
  });
  t.after(() => h.close());
  const app = h.apps[0],
    w = h.lab.world;
  const building = w.state.map.buildings.find(
    (b) => b.use === "residential",
  ).id;
  const need = w.addNeed({
    id: "progress-fixture",
    building,
    type: "water",
    unit: "L",
    quantity: 40,
    population: 10,
    deadline: 7200000,
  });
  w.advance(60000);
  for (const target of ["map", "inventory", "vehicles", "policy"])
    await app.connector.action(
      "query",
      { target },
      "progress-bootstrap-" + target,
    );
  await app.connector.action(
    "verify",
    { target: "building", id: building, method: "clarification" },
    "progress-check",
  );
  await app.ingestion.sync();
  const received = await app.connector.state(),
    resource = Object.values(received.known.resources).find(
      (r) => r.owner === "org0" && r.type === "water",
    ),
    vehicle = Object.values(received.known.vehicles).find(
      (v) => v.owner === "org0" && v.state === "idle",
    );
  const proposal = await app.domain.propose(
    { org: "org0", id: "progress-fixture-agent", role: "agent" },
    {
      title: "Checked water delivery",
      summary: "40 L for a received need",
      benefit: "Physical aid",
      rationale: "Owner approval required",
      references: [need.id],
      conditions: [],
      actions: [
        {
          type: "dispatch",
          owner: "org0",
          dependsOn: [],
          params: {
            vehicle: vehicle.id,
            resource: resource.id,
            quantity: 40,
            need: need.id,
          },
        },
      ],
    },
    "progress-delivery",
  );
  assert.equal(await scriptedReview(app, proposal), true);
  await app.worker.execute(proposal.id);
  w.advance(7200000, { maxEvents: 1000000 });
  await app.ingestion.sync();
  assert.equal(w.need(need.id).served, 40);
  const operations = await app.store.list("org0", "operation", 10000),
    signals = await app.store.list("org0", "signal", 10000);
  const signal = signals.find(
    (s) =>
      s.text === "The receiving team confirms 40 L of water." &&
      s.location === building,
  );
  assert.ok(signal, "Actual public delivery publication received through HTTP");
  assert.ok(receivedProgressReference(signal, operations));
  const result = await app.semantic.process(
    { ids: [signal.id] },
    "actual-delivery-progress",
  );
  assert.equal(result.state, "reconciled_progress_unverified");
  assert.equal(calls, 0);
  assert.equal(w.need(need.id).served, 40);
  assert.deepEqual(w.invariants(), []);
});
test("changed needs, hazards and corrections always retain semantic attention", () => {
  for (const text of [
    post.text + " Still need 20 L.",
    post.text + " But the road is blocked.",
    "We did not receive the 40 L of water.",
    "Water received. Families elsewhere need help.",
    "The receiving team confirms 40 portions of water.",
  ])
    assert.equal(
      receivedProgressReference({ ...post, text }, [receipt]),
      null,
      text,
    );
});
test("bounded semantic intake reconciles progress without another provider call and still reads unknown content", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.upsert("org0", "signal", post.id, post);
  await store.upsert("org0", "operation", receipt.id, receipt);
  let calls = 0,
    starts = 0;
  const semantic = new SemanticIngestion({
    store,
    config: { org: "org0", modelId: "fixture" },
    connector: {
      startModel: async () => {
        starts++;
        return { id: "model" };
      },
      finishModel: async () => {},
    },
    provider: {
      complete: async (request) => {
        calls++;
        const input = JSON.parse(request.messages[1].content);
        assert.equal(input.sources.length, 1);
        assert.equal(input.sources[0].id, "new-need");
        return {
          model: "fixture",
          message: { content: '{"observations":[]}' },
          usage: {},
        };
      },
    },
  });
  const first = await semantic.process({ ids: [post.id] }, "known-progress");
  assert.equal(first.state, "reconciled_progress_unverified");
  assert.equal(first.model, null);
  assert.equal(calls, 0);
  assert.equal(starts, 0);
  assert.equal(first.claimIds.length, 0);
  assert.equal((await store.get("org0", "signal", post.id)).text, post.text);
  assert.equal((await store.get("org0", "operation", receipt.id)).received, 40);
  await store.upsert("org0", "signal", "new-need", {
    ...post,
    id: "new-need",
    text: "Families at b7 still need water.",
  });
  const mixed = await semantic.process({ ids: [post.id, "new-need"] }, "mixed");
  assert.equal(calls, 1);
  assert.equal(starts, 1);
  assert.equal(mixed.coverage.presentedSources, 1);
  assert.equal(mixed.coverage.reconciledProgress.length, 1);
  await semantic.process({ ids: [post.id, "new-need"] }, "mixed");
  assert.equal(calls, 1);
  // A revised public post with an additional need cannot reuse a prior receipt.
  await store.upsert("org0", "signal", post.id, {
    ...post,
    sourceVersion: 2,
    text: post.text + " Need blankets.",
  });
  await assert.rejects(
    semantic.process({ ids: [post.id] }, "known-progress"),
    (e) => e.code === "SEMANTIC_VERSION",
  );
});
