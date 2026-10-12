import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { OpenRouterProvider } from "../src/provider.mjs";

test("reasoning gets a sufficient configurable allowance and private reasoning is neither stored nor displayed", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  const payloads = [];
  const provider = new OpenRouterProvider(
    store,
    {
      apiKey: "test-only",
      modelId: "fixture",
      budgetUsd: 1,
      maxCalls: 3,
      modelTimeoutMs: 1000,
    },
    async (_, req) => {
      payloads.push(JSON.parse(req.body));
      return Response.json({
        id: "receipt" + payloads.length,
        model: "fixture",
        choices: [
          {
            finish_reason: "length",
            message: {
              role: "assistant",
              content: "",
              reasoning: "never-store-private-reasoning",
              reasoning_details: [{ text: "never-store-private-reasoning" }],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 8192, cost: 0.003 },
      });
    },
  );
  provider.pricing = {
    rates: { prompt: "0.000001", completion: "0.000001" },
    parameters: ["reasoning"],
    maxCompletionTokens: 16384,
  };
  const result = await provider.complete({
    org: "org0",
    episode: "case",
    messages: [],
  });
  assert.equal(payloads[0].max_tokens, 8192);
  assert.equal(payloads[0].provider.sort, "latency");
  assert.deepEqual(payloads[0].provider.max_price, {
    prompt: 2,
    completion: 2,
  });
  assert.deepEqual(payloads[0].reasoning, { enabled: true, exclude: true });
  assert.equal(result.finishReason, "length");
  assert.equal(result.message.reasoning, undefined);
  await provider.complete({
    org: "org0",
    episode: "case",
    messages: [],
    maxOutputTokens: 32768,
    task: "perception",
  });
  assert.equal(payloads[1].max_tokens, 16384);
  assert.equal(payloads[1].reasoning.enabled, false);
  const rows = (
    await store.query(
      "SELECT result,cost_usd,input_tokens,output_tokens FROM usage",
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.cost_usd === 0.003));
  assert.ok(!JSON.stringify(rows).includes("never-store-private-reasoning"));
  assert.equal(rows[0].output_tokens, 8192);
});
