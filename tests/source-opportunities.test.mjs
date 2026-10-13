import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { SemanticIngestion } from "../src/semantic-ingestion.mjs";
import { processSourceOpportunities } from "../src/source-opportunities.mjs";
import { Retention } from "../src/retention.mjs";

const org = "org0",
  observation = {
    text: "Current crews report Pine access reopened",
    kind: "correction",
    sourceIds: ["source"],
    location: null,
    resourceType: "transport",
    quantity: null,
    timeStatus: "current",
    entity: { kind: "road", id: "exit" },
  };
async function fixture(t) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization(org);
  const config = { org, peers: [], modelId: "recorded-opportunity" };
  await store.put(
    org,
    "signal",
    "source",
    {
      text: "Today a crew says Pine access is passable again, unlike yesterday's closure clip.",
      sourceVersion: 1,
    },
    0,
  );
  await store.put(
    org,
    "context",
    "geography",
    {
      map: {
        nodes: [{ id: "a" }, { id: "b" }],
        places: [],
        roads: [
          {
            id: "exit",
            name: "Pine access",
            aliases: ["Pine access road"],
            from: "a",
            to: "b",
            lengthM: 100,
            speedMps: 10,
            maxWeight: 10000,
          },
        ],
      },
    },
    0,
  );
  await store.put(org, "road", "exit", { open: false, sourceVersion: 1 }, 0);
  await store.put(
    org,
    "vehicle",
    "truck",
    {
      owner: org,
      node: "a",
      state: "blocked",
      capacity: 100,
      load: 40,
      weightKg: 1000,
    },
    0,
  );
  await store.put(
    org,
    "need",
    "need",
    {
      building: "b",
      node: "b",
      type: "water",
      quantity: 40,
      served: 0,
      inTransit: 40,
    },
    0,
  );
  await store.put(
    org,
    "operation",
    "trip",
    {
      owner: org,
      vehicle: "truck",
      need: "need",
      type: "delivery",
      quantity: 40,
      resourceType: "water",
      destination: "b",
      state: "blocked",
      confirmedBySource: true,
    },
    0,
  );
  await store.put(
    org,
    "proposal",
    "original",
    {
      state: "requires_review",
      actions: [
        {
          type: "dispatch",
          owner: org,
          params: {
            vehicle: "truck",
            resource: "water",
            need: "need",
            quantity: 40,
          },
          dependsOn: [],
        },
      ],
      executionResults: [{ index: 0, result: { operation: "trip" } }],
      affectedSteps: [0],
      references: ["need"],
      authorization: null,
      previousAuthorization: { by: "owner" },
    },
    0,
  );
  let calls = 0,
    complete = false;
  const inspections = [];
  const app = {
    store,
    config,
    domain: new Domain(store, config),
    connector: {
      state: async () => ({ inspections, queries: [] }),
      action: async (type, params, key) => {
        assert.equal(type, "verify");
        assert.deepEqual(params, {
          target: "road",
          id: "exit",
          method: "clarification",
        });
        calls++;
        const i = {
          id: key,
          target: params.target,
          entity: params.id,
          method: params.method,
          state: "pending",
        };
        inspections.push(i);
        return i;
      },
    },
    ingestion: {
      sync: async () => {
        if (complete)
          for (const i of inspections) {
            i.state = "completed";
            i.result = { id: "exit", open: true, waterDepth: 0, version: 2 };
            await store.upsert(org, "road", "exit", {
              open: true,
              sourceVersion: 2,
            });
            await store.upsert(org, "verification", i.id, i);
          }
      },
    },
  };
  return {
    app,
    inspections,
    complete: () => {
      complete = true;
    },
    calls: () => calls,
  };
}

test("received named entities are bounded; invented and ambiguous road labels do not become model entity IDs", async (t) => {
  const f = await fixture(t),
    base = { ...observation, sourceIds: ["S1"] };
  let payload;
  const semantic = new SemanticIngestion({
    store: f.app.store,
    config: f.app.config,
    provider: {
      complete: async (input) => {
        payload = JSON.parse(input.messages[1].content);
        return {
          message: { content: JSON.stringify({ observations: [base] }) },
        };
      },
    },
  });
  const result = await semantic.process({ ids: ["source"] }, "named-road");
  assert.deepEqual(
    payload.knownEntities.map((e) => [e.kind, e.id]),
    [["road", "exit"]],
  );
  assert.deepEqual(result.observations[0].entity, observation.entity);
  assert.deepEqual(
    (await f.app.store.get(org, "claim", result.claimIds[0])).entity,
    observation.entity,
  );
  semantic.provider.complete = async () => ({
    message: {
      content: JSON.stringify({
        observations: [{ ...base, entity: { kind: "road", id: "unseen" } }],
      }),
    },
  });
  await assert.rejects(semantic.process({ ids: ["source"] }, "invented-road"), {
    code: "EXTRACTION_ENTITY",
  });
  await f.app.store.upsert(org, "context", "geography", {
    map: {
      places: [],
      roads: [
        { id: "one", name: "Pine access" },
        { id: "two", name: "Pine access" },
      ],
    },
  });
  semantic.provider.complete = async () => ({
    message: {
      content: JSON.stringify({
        observations: [{ ...base, entity: { kind: "road", id: "one" } }],
      }),
    },
  });
  await assert.rejects(
    semantic.process({ ids: ["source"] }, "ambiguous-road"),
    { code: "EXTRACTION_ENTITY" },
  );
});

test("a contextual correction directs one pending normal inquiry across batches, then drafts only the same checked cargo for owner review", async (t) => {
  const f = await fixture(t);
  const first = await processSourceOpportunities(f.app, "first", {
    observations: [observation],
  });
  assert.equal(first.state, "waiting_evidence");
  assert.equal(f.calls(), 1);
  assert.equal((await f.app.store.list(org, "proposal")).length, 1);
  const second = await processSourceOpportunities(f.app, "second", {
    observations: [observation],
  });
  assert.equal(second.opportunities[0].reused, true);
  assert.equal(f.calls(), 1);
  f.complete();
  const ready = await processSourceOpportunities(f.app, "first");
  assert.equal(ready.state, "ready");
  assert.equal(ready.proposalIds.length, 1);
  const repair = await f.app.store.get(org, "proposal", ready.proposalIds[0]);
  assert.equal(repair.state, "awaiting_review");
  assert.equal(repair.authorization, null);
  assert.equal(repair.repairOf, "original");
  assert.deepEqual(repair.actions, [
    {
      type: "reroute",
      owner: org,
      params: { vehicle: "truck", destination: "b" },
      dependsOn: [],
    },
  ]);
  assert.ok(repair.references.includes("source"));
  assert.ok(repair.references.includes(first.opportunities[0].id));
  assert.equal((await f.app.store.get(org, "vehicle", "truck")).load, 40);
  assert.equal((await f.app.store.get(org, "need", "need")).served, 0);
  const reused = await processSourceOpportunities(f.app, "second");
  assert.deepEqual(reused.proposalIds, ready.proposalIds);
  assert.equal((await f.app.store.list(org, "proposal")).length, 2);
});

test("historical or unresolved road context remains visible and cannot erase a need or request a fabricated entity", async (t) => {
  const f = await fixture(t);
  const result = await processSourceOpportunities(f.app, "unresolved", {
    observations: [
      { ...observation, timeStatus: "historical" },
      { ...observation, entity: { kind: "road", id: "invented" } },
    ],
  });
  assert.equal(f.calls(), 0);
  assert.equal(result.unresolved.length, 2);
  assert.equal((await f.app.store.get(org, "need", "need")).quantity, 40);
  assert.equal((await f.app.store.list(org, "proposal")).length, 1);
});

test("source erasure or cancellation during a pending opportunity prevents new queries and repair drafts after restart", async (t) => {
  const f = await fixture(t);
  await processSourceOpportunities(f.app, "pending", {
    observations: [observation],
  });
  await f.app.store.upsert(org, "signal", "source", { state: "erased" });
  f.complete();
  await assert.rejects(processSourceOpportunities(f.app, "pending"), {
    code: "SEMANTIC_VERSION",
  });
  assert.equal(f.calls(), 1);
  assert.equal((await f.app.store.list(org, "proposal")).length, 1);
  await assert.rejects(
    processSourceOpportunities(f.app, "cancelled", {
      observations: [observation],
      stopRequested: async () => true,
    }),
    { code: "DISCOVERY_CANCELLED" },
  );
});

test("approved source erasure tombstones stored opportunity text while keeping physical cargo and existing commands", async (t) => {
  const f = await fixture(t);
  await processSourceOpportunities(f.app, "retained", {
    observations: [observation],
  });
  const retention = new Retention(f.app.store, f.app.domain, f.app.config),
    actor = { org, role: "commander", id: "owner" };
  const preview = await retention.preview(actor, {
    kind: "signal",
    id: "source",
  });
  assert.ok(preview.records.some((r) => r.kind === "source_opportunity"));
  await retention.erase(
    actor,
    {
      kind: "signal",
      id: "source",
      version: preview.version,
      planHash: preview.planHash,
      reason: "Approved source privacy erasure",
    },
    "erase-source",
  );
  assert.equal(
    (await f.app.store.get(org, "source_opportunity", "retained")).state,
    "erased",
  );
  await assert.rejects(processSourceOpportunities(f.app, "retained"), {
    code: "SOURCE_ERASED",
  });
  assert.equal((await f.app.store.get(org, "vehicle", "truck")).load, 40);
  assert.equal((await f.app.store.get(org, "operation", "trip")).quantity, 40);
  assert.equal(f.calls(), 1);
});
