import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { SemanticIngestion } from "../src/semantic-ingestion.mjs";

const valid = { text: "Current water shortage", kind: "need", sourceIds: ["S1"], location: "b1",
  resourceType: "water", quantity: 40, unit: "L", timeStatus: "current" };
async function fixture(t, responses) {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  await store.put("org0", "signal", "source", { text: "At b1 we need 40 litres of water today.", sourceVersion: 1 }, 0);
  await store.put("org0", "context", "geography", { map: { places: [{ id: "b1", name: "Site" }] } }, 0);
  let calls = 0; const settled = [], inputs = [];
  const semantic = new SemanticIngestion({ store, config: { org: "org0", modelId: "recorded-repair" },
    connector: { startModel: async () => ({ id: "timing-" + calls }),
      finishModel: async (id, usage) => { settled.push({ id, usage }); return { id, availableAt: 1000 + settled.length * 15000 }; } },
    provider: { complete: async input => { inputs.push(input); const response = responses[calls++];
      if (typeof response === "function") return response(store, input);
      if (response instanceof Error) throw response;
      return { model: "recorded-repair", message: { content: typeof response === "string" ? response : JSON.stringify(response) },
        usage: { providerCost: 0.001, wallMs: 25 } };
    } } });
  return { store, semantic, settled, inputs, calls: () => calls };
}

test("one charged schema repair preserves first failure paths, two timing receipts and exact original grounding", async t => {
  const f = await fixture(t, [{ observations: [{ ...valid, quantity: "40" }] }, { observations: [valid] }]);
  const r = await f.semantic.process({ ids: ["source"] }, "repair");
  assert.equal(f.calls(), 2); assert.equal(r.modelAttempts.length, 2); assert.equal(r.schemaFailures.length, 1);
  assert.equal(f.settled.length, 2); assert.ok(f.settled.every(s => s.usage.providerCost === 0.001 && s.usage.wallMs === 25));
  assert.ok(r.schemaFailures[0].issues.some(i => i.path.includes("quantity") && i.code === "invalid_type"));
  const rejected = await f.store.get("org0", "semantic_receipt", "repair-schema-failure-1");
  assert.equal(rejected.state, "schema_rejected_unverified"); assert.equal(rejected.claimIds.length, 0);
  assert.equal((await f.store.get("org0", "activity", "repair")).calls, 2);
  assert.deepEqual(r.observations[0].sourceIds, ["source"]);
  const retryInput = JSON.parse(f.inputs[1].messages[1].content);
  assert.deepEqual(retryInput.knownLocations, [{ id: "b1", name: "Site" }]);
  assert.equal(retryInput.sources.length, 1); assert.equal(f.inputs[1].maxOutputTokens, 8192);
  assert.equal((await f.store.list("org0", "need")).length, 0);
  const attention = (await f.store.list("org0", "source_attention"))[0];
  assert.equal(attention.state, "reading_acknowledged_unverified"); assert.equal(attention.history.length, 2);
  assert.equal((await f.semantic.process({ ids: ["source"] }, "repair")).id, r.id); assert.equal(f.calls(), 2);
});

test("unknown IDs or returned authority are never automatically repaired or accepted", async t => {
  for (const [name, output, code] of [
    ["citation", { observations: [{ ...valid, sourceIds: ["unseen"], quantity: "40" }] }, "EXTRACTION_REFERENCE"],
    ["location", { observations: [{ ...valid, location: "unseen", quantity: "40" }] }, "EXTRACTION_LOCATION"],
    ["authority", { observations: [{ ...valid, approved: true }] }, "EXTRACTION_AUTHORITY"],
  ]) {
    const f = await fixture(t, [output, { observations: [valid] }]);
    await assert.rejects(f.semantic.process({ ids: ["source"] }, name), { code });
    assert.equal(f.calls(), 1); assert.equal((await f.store.list("org0", "claim")).length, 0);
  }
});

test("failed repair remains reviewable and the exact batch cannot automatically start another retry after restart", async t => {
  const f = await fixture(t, ["{", "{"]);
  await assert.rejects(f.semantic.process({ ids: ["source"] }, "twice"), { code: "EXTRACTION_SCHEMA" });
  assert.equal(f.calls(), 2); assert.equal((await f.store.list("org0", "semantic_receipt")).length, 2);
  const restarted = new SemanticIngestion({ ...f.semantic });
  await assert.rejects(restarted.process({ ids: ["source"] }, "twice"), { code: "SEMANTIC_RETRY_REVIEW" });
  assert.equal(f.calls(), 2); assert.equal((await f.store.list("org0", "source_attention"))[0].state, "awaiting_review");
});

test("repair uses the same call budget and preserves an exhausted budget and its first rejected attempt", async t => {
  const exhausted = Object.assign(Error("Declared call cap exhausted"), { code: "MODEL_CALL_BUDGET" }),
    f = await fixture(t, ["{", exhausted]);
  await assert.rejects(f.semantic.process({ ids: ["source"] }, "cap"), { code: "MODEL_CALL_BUDGET" });
  assert.equal(f.calls(), 2); assert.equal(f.settled.length, 2); assert.equal(f.settled[1].usage.failed, true);
  assert.equal((await f.store.get("org0", "activity", "cap")).schemaFailures.length, 1);
  assert.equal((await f.store.list("org0", "claim")).length, 0);
});

test("cancel or erasure during the first failed attempt prevents a schema-repair call; cancellation during valid output prevents claims", async t => {
  for (const mode of ["cancel", "erase", "valid-cancel"]) {
    const f = await fixture(t, [async store => {
      if (mode === "erase") await store.upsert("org0", "signal", "source", { state: "erased" });
      else await store.upsert("org0", "activity", mode, { cancelRequested: true });
      return { message: { content: mode === "valid-cancel" ? JSON.stringify({ observations: [valid] }) : "{" }, usage: { wallMs: 25 } };
    }, { observations: [valid] }]);
    await assert.rejects(f.semantic.process({ ids: ["source"] }, mode), { code: mode === "erase" ? "SEMANTIC_VERSION" : "SEMANTIC_CANCELLED" });
    assert.equal(f.calls(), 1); assert.equal((await f.store.list("org0", "claim")).length, 0);
  }
});
