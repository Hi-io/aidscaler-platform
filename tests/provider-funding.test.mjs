import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { OpenRouterProvider } from "../src/provider.mjs";

test("a provider timeout has a stable diagnostic and retains the unknown paid-attempt reservation", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  const provider = new OpenRouterProvider(
    store,
    {
      apiKey: "test-only",
      modelId: "fixture",
      maxCalls: 2,
      budgetUsd: 1,
      modelTimeoutMs: 120000,
    },
    async () => {
      throw new DOMException("fixture", "TimeoutError");
    },
  );
  provider.pricing = { rates: { prompt: "0.000001", completion: "0.000001" } };
  await assert.rejects(
    provider.complete({ org: "org0", episode: "timeout", messages: [] }),
    (e) => e.code === "PROVIDER_TIMEOUT" && e.status === 504,
  );
  const r = (
    await store.query("SELECT state,error,cost_usd,reserved_usd FROM usage")
  ).rows[0];
  assert.equal(r.state, "failed");
  assert.equal(r.error, "PROVIDER_TIMEOUT");
  assert.equal(r.cost_usd, null);
  assert.ok(Number(r.reserved_usd) > 0);
});

test("a provider funding refusal stops subsequent inference without new requests or zero-cost fabricated receipts", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  let attempted = 0;
  const provider = new OpenRouterProvider(
    store,
    {
      apiKey: "test-only-not-a-key",
      modelId: "test-fixture",
      maxCalls: 8,
      budgetUsd: 1,
      hourlyCallLimit: 40,
      hourlyBudgetUsd: 2,
      modelTimeoutMs: 1000,
    },
    async () => {
      attempted++;
      return new Response("Do not log untrusted provider payloads", {
        status: 402,
      });
    },
  );
  provider.pricing = {
    model: "test-fixture",
    rates: { prompt: "0.000001", completion: "0.000001" },
  };
  for (const episode of ["first", "new-case", "another-case"])
    await assert.rejects(
      provider.complete({ org: "org0", episode, messages: [] }),
      (e) => e.code === "PROVIDER_FUNDS" && e.status === 503,
    );
  assert.equal(attempted, 1);
  const rows = (
    await store.query("SELECT state,cost_usd,reserved_usd,error FROM usage")
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "failed");
  assert.equal(rows[0].cost_usd, null);
  assert.ok(Number(rows[0].reserved_usd) > 0);
  assert.equal(rows[0].error, "PROVIDER_FUNDS");
});
