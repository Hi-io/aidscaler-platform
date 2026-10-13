import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { SemanticIngestion } from "../src/semantic-ingestion.mjs";
import { semanticSourceAttention } from "../src/source-attention.mjs";
import {
  sealSourceCohort,
  sourceRecoveryDisposition,
} from "../scripts/source-recovery.mjs";

const sources = [
  {
    id: "first",
    sourceVersion: 1,
    text: "Current water request at shelter",
    publishedAt: 1,
  },
  {
    id: "second",
    sourceVersion: 1,
    text: "Another current water request at shelter",
    publishedAt: 2,
  },
];
const observation = {
  text: "Current water request",
  kind: "need",
  sourceIds: ["S1"],
  location: "shelter",
  resourceType: "water",
  quantity: 40,
};
async function fixture(t, rejectedReferences) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  for (const s of sources) await store.put("org0", "signal", s.id, s, 0);
  await store.put(
    "org0",
    "context",
    "geography",
    { map: { places: [{ id: "shelter" }] } },
    0,
  );
  const semantic = new SemanticIngestion({
    store,
    config: { org: "org0", modelId: "recorded-attention" },
    provider: {
      complete: async () => ({
        message: {
          content: JSON.stringify({
            observations: [
              observation,
              { ...observation, quantity: -5, sourceIds: rejectedReferences },
            ],
          }),
        },
      }),
    },
  });
  return { store, semantic };
}

test("a rejected observation with complete grounded citations affects only its exact cited source", async (t) => {
  const f = await fixture(t, ["S2"]);
  const receipt = await f.semantic.process(
    { ids: sources.map((s) => s.id) },
    "partial",
  );
  assert.equal(receipt.state, "partially_interpreted_unverified");
  assert.deepEqual(receipt.coverage.rejectedObservations[0].sourceIds, [
    "second",
  ]);
  assert.equal(
    receipt.coverage.rejectedObservations[0].attributionComplete,
    true,
  );
  assert.equal(semanticSourceAttention(receipt, "first").requiresReview, false);
  assert.equal(semanticSourceAttention(receipt, "second").requiresReview, true);
  const items = sealSourceCohort(sources);
  assert.equal(
    sourceRecoveryDisposition(items[0], {
      current: sources[0],
      receipts: [receipt],
      retainedVersion: true,
    }).closed,
    true,
  );
  assert.equal(
    sourceRecoveryDisposition(items[1], {
      current: sources[1],
      receipts: [receipt],
      retainedVersion: true,
    }).closed,
    false,
  );
  const attention = await f.store.list("org0", "source_attention");
  assert.equal(attention.length, 1);
  assert.equal(attention[0].sourceId, "second");
  assert.equal((await f.store.list("org0", "signal")).length, 2);
});

test("unknown or missing rejected references keep the whole batch in attention", async (t) => {
  for (const refs of [["S2", "invented"], []]) {
    const f = await fixture(t, refs),
      receipt = await f.semantic.process(
        { ids: sources.map((s) => s.id) },
        "unknown",
      );
    assert.equal(
      receipt.coverage.rejectedObservations[0].attributionComplete,
      false,
    );
    assert.ok(
      sources.every(
        (s) => semanticSourceAttention(receipt, s.id).requiresReview,
      ),
    );
    assert.equal((await f.store.list("org0", "source_attention")).length, 2);
    assert.ok(
      sealSourceCohort(sources).every(
        (item, i) =>
          !sourceRecoveryDisposition(item, {
            current: sources[i],
            receipts: [receipt],
            retainedVersion: true,
          }).closed,
      ),
    );
  }
});

test("a bounded later exact-version interpretation acknowledges reading without deleting partial rejection history", async (t) => {
  const f = await fixture(t, ["S2"]),
    first = await f.semantic.process(
      { ids: sources.map((s) => s.id) },
      "attempt-one",
    );
  f.semantic.provider.complete = async () => ({
    message: {
      content: JSON.stringify({
        observations: [{ ...observation, sourceIds: ["S1"] }],
      }),
    },
  });
  const later = await f.semantic.process({ ids: ["second"] }, "attempt-two");
  const second = sealSourceCohort(sources).find((s) => s.id === "second");
  const result = sourceRecoveryDisposition(second, {
    current: sources[1],
    receipts: [first, later],
    retainedVersion: true,
  });
  assert.equal(result.closed, true);
  assert.equal(result.receipt, later.id);
  assert.equal(result.attentionHistory.length, 2);
  assert.equal(result.attentionHistory[0].requiresReview, true);
  const attention = (await f.store.list("org0", "source_attention"))[0];
  assert.equal(attention.state, "reading_acknowledged_unverified");
  assert.equal(attention.history.length, 2);
  assert.equal(attention.history[0].requiresReview, true);
  assert.equal(
    (await f.store.get("org0", "semantic_receipt", first.id)).coverage
      .rejectedObservations.length,
    1,
  );
  assert.equal((await f.store.list("org0", "need")).length, 0);
  assert.equal((await f.store.list("org0", "proposal")).length, 0);
});
