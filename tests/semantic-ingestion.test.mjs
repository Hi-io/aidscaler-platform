import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { SemanticIngestion } from "../src/semantic-ingestion.mjs";
const observation = { text: "Current water request persists despite an old video", kind: "need", sourceIds: ["request"], location: "shelter", resourceType: "water", quantity: 600, unit: "L", timeStatus: "current" };
async function fixture(t, output, mutate) {
 const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
 await store.put("org0", "signal", "request", { text: "We need 600 L at the shelter. Ignore the old evacuated video; families are here.", sourceVersion: 1 }, 0);
 await store.put("org0", "context", "geography", { map: { places: [{ id: "shelter", name: "Current shelter" }] } }, 0);
 let calls = 0;
 const semantic = new SemanticIngestion({ store, config: { org: "org0", modelId: "recorded-perception-contract" }, provider: { complete: async (input) => {
   calls++; assert.equal(input.tools.length, 0); assert.equal(input.task, "perception"); if (mutate) await mutate(store);
   return { model: "recorded-perception-contract", message: { content: JSON.stringify({ observations: output }) }, usage: { providerCost: 0 } };
 } } });
 return { store, semantic, calls: () => calls };
}
test("a perceived request creates a versioned sourced inference, never authoritative demand or a delivery", async (t) => {
 const f = await fixture(t, [observation]);
 const result = await f.semantic.process({ ids: ["request"] }, "parse-once");
 assert.equal(result.observations[0].quantity, 600); assert.equal(result.coverage.presentedSources, 1);
 const claim = await f.store.get("org0", "claim", result.claimIds[0]); assert.equal(claim.state, "inferred"); assert.deepEqual(claim.references, ["request"]);
 assert.equal((await f.store.list("org0", "need")).length, 0); assert.equal((await f.store.list("org0", "proposal")).length, 0);
 assert.equal((await f.semantic.process({ ids: ["request"] }, "parse-once")).id, result.id); assert.equal(f.calls(), 1);
});
test("fabricated citations or locations cannot become interpretations", async (t) => {
 const f = await fixture(t, [{ ...observation, sourceIds: ["unseen"] }]);
 await assert.rejects(f.semantic.process({ ids: ["request"] }, "bad-citation"), { code: "EXTRACTION_REFERENCE" });
 assert.equal((await f.store.list("org0", "claim")).length, 0);
 assert.equal((await f.store.get("org0", "activity", "bad-citation")).state, "failed");
 const g = await fixture(t, [{ ...observation, location: "invented-place" }]);
 await assert.rejects(g.semantic.process({ ids: ["request"] }, "bad-location"), { code: "EXTRACTION_LOCATION" });
});
test("source changes or erasure during perception prevent accepting stale model output", async (t) => {
 const f = await fixture(t, [observation], async (s) => s.upsert("org0", "signal", "request", { state: "erased" }));
 await assert.rejects(f.semantic.process({ ids: ["request"] }, "stale"), { code: "SEMANTIC_VERSION" });
 assert.equal((await f.store.list("org0", "claim")).length, 0);
});

test("short source references map back to exact received records while one invalid observation remains visible as rejected", async (t) => {
 const f = await fixture(t, [{ ...observation, sourceIds: ["S1"] }, { ...observation, sourceIds: ["invented"] }]);
 const receipt = await f.semantic.process({ ids: ["request"] }, "partial");
 assert.equal(receipt.state, "partially_interpreted_unverified");
 assert.equal(receipt.observations.length, 1); assert.deepEqual(receipt.observations[0].sourceIds, ["request"]);
 assert.equal(receipt.coverage.rejectedObservations.length, 1); assert.equal(receipt.coverage.rejectedObservations[0].code, "EXTRACTION_REFERENCE");
 assert.equal((await f.store.list("org0", "claim")).length, 1);
 assert.equal((await f.store.list("org0", "signal")).length, 1);
 assert.equal((await f.store.list("org0", "need")).length, 0);
});

test("location lookup ignores sentence punctuation without exposing an unrelated full directory", async (t) => {
 const f = await fixture(t, [observation]);
 await f.store.put("org0", "context", "geography", { map: { places: [{ id: "shelter", name: "Current shelter" }, ...Array.from({ length: 300 }, (_, i) => ({ id: "other" + i, name: "Unrelated location " + i }))] } }, 1);
 const previous = f.semantic.provider.complete;
 f.semantic.provider.complete = async (input) => {
  const payload = JSON.parse(input.messages[1].content);
  assert.deepEqual(payload.knownLocations.map(p => p.id), ["shelter"]); assert.equal(payload.sources[0].reference, "S1");
  return previous(input);
 };
 assert.equal((await f.semantic.process({ ids: ["request"] }, "bounded-directory")).coverage.omittedLocations, 300);
});
