import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Store } from "../src/store.mjs";
import { SemanticIngestion } from "../src/semantic-ingestion.mjs";
import { OpenRouterProvider } from "../src/provider.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, provider) {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  await store.put("org0", "signal", "source", { text: "We still need water at shelter.", sourceVersion: 1 }, 0);
  await store.put("org0", "context", "geography", { map: { places: [{ id: "shelter", name: "Shelter" }] } }, 0);
  const receipts = [], config = { org: "org0", modelId: "local-http-timing-fixture", apiKey: "synthetic-local-fixture",
    modelTimeoutMs: 30000, modelMaxOutputTokens: 1024, maxCalls: 8, budgetUsd: 1 };
  const semantic = new SemanticIngestion({ store, config, provider, connector: {
    startModel: async () => ({ id: "timing-once" }),
    finishModel: async (id, usage) => { receipts.push({ id, usage }); return { id, availableAt: Math.max(15000, usage.wallMs) }; },
  } });
  return { store, semantic, config, receipts };
}

test("real local HTTP timing excludes slow budget/usage bookkeeping from the semantic model clock", async t => {
  let requests = 0;
  const server = http.createServer(async (_request, response) => {
    requests++; await pause(8);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "local-fixture-receipt", choices: [{ finish_reason: "stop", message: { content: '{"observations":[]}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0 } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const f = await fixture(t), local = `http://127.0.0.1:${server.address().port}`;
  const query = f.store.query.bind(f.store);
  f.store.query = async (sql, params) => {
    if (sql.startsWith("INSERT INTO usage") || sql.startsWith("UPDATE usage SET state='completed'")) await pause(45);
    return query(sql, params);
  };
  const provider = new OpenRouterProvider(f.store, f.config, (url, params) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    return fetch(local, params);
  });
  provider.pricing = { rates: { prompt: "0", completion: "0" }, parameters: [], maxCompletionTokens: 1024 };
  f.semantic.provider = provider;
  const result = await f.semantic.process({ ids: ["source"] }, "success-http"), accounting = result.modelClockAccounting;
  assert.equal(requests, 1); assert.equal(f.receipts.length, 1);
  assert.ok(result.usage.wallMs > 0); assert.equal(f.receipts[0].usage.wallMs, result.usage.wallMs);
  assert.equal(accounting.modelClockWallMs, result.usage.wallMs);
  assert.equal(accounting.modelClockScope, "provider_reported_http_duration");
  assert.ok(accounting.providerCompleteElapsedMs - result.usage.wallMs >= 60, "Both slow SQL updates remain separately measured overhead");
  assert.ok(accounting.unattributedOverheadMs >= 60);
  assert.equal(result.modelTimingReceipt.availableAt, Math.max(15000, result.usage.wallMs));
  assert.equal((await f.store.query("SELECT state FROM usage")).rows[0].state, "completed");
  assert.equal((await f.store.list("org0", "need")).length, 0);
});

test("unknown and malformed reported durations retain measured elapsed fallback rather than a fabricated zero", async t => {
  const f = await fixture(t);
  for (const wallMs of [undefined, -5, Number.NaN, Infinity, "5"]) {
    f.semantic.provider = { complete: async () => { await pause(12); return { message: { content: '{"observations":[]}' }, usage: { wallMs, providerCost: 0 } }; } };
    const receipt = await f.semantic.process({ ids: ["source"] }, "fallback-" + f.receipts.length), a = receipt.modelClockAccounting;
    assert.equal(a.providerWallMs, null); assert.equal(a.unattributedOverheadMs, null);
    assert.equal(a.modelClockScope, "provider_complete_elapsed_fallback");
    assert.ok(a.modelClockWallMs >= 8); assert.equal(f.receipts.at(-1).usage.wallMs, a.providerCompleteElapsedMs);
  }
  f.semantic.provider = { complete: async () => { await pause(12); return { message: { content: '{"observations":[]}' }, usage: { wallMs: 0, providerCost: 0 } }; } };
  const knownZero = await f.semantic.process({ ids: ["source"] }, "reported-zero");
  assert.equal(knownZero.modelClockAccounting.modelClockScope, "provider_reported_http_duration");
  assert.equal(f.receipts.at(-1).usage.wallMs, 0, "A specifically reported zero is distinguishable from an unknown duration");
  assert.equal(knownZero.modelTimingReceipt.availableAt, 15000, "Declared source latency is preserved even when reported duration is zero");
});

test("failed inference retains elapsed latency and one failed clock receipt with explicit unknown HTTP scope", async t => {
  const f = await fixture(t, { complete: async () => { await pause(20); throw Object.assign(Error("Fixture provider timeout"), { code: "PROVIDER_TIMEOUT" }); } });
  await assert.rejects(f.semantic.process({ ids: ["source"] }, "failure-latency"), { code: "PROVIDER_TIMEOUT" });
  assert.equal(f.receipts.length, 1); assert.equal(f.receipts[0].usage.failed, true); assert.ok(f.receipts[0].usage.wallMs >= 15);
  const activity = await f.store.get("org0", "activity", "failure-latency");
  assert.equal(activity.state, "failed"); assert.equal(activity.modelClockAccounting.providerWallMs, null);
  assert.equal(activity.modelClockAccounting.modelClockScope, "provider_complete_elapsed_fallback");
  assert.equal(activity.modelClockAccounting.modelClockWallMs, f.receipts[0].usage.wallMs);
  assert.equal((await f.store.list("org0", "semantic_receipt")).length, 0);
});
