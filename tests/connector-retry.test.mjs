import test from "node:test";
import assert from "node:assert/strict";
import { SimulatorConnector } from "../src/connector.mjs";
const reset = () =>
  Object.assign(new TypeError("Temporary source connection reset"), {
    cause: { code: "ECONNRESET" },
  });
test("a source read retries one reset without widening its scope or inventing a result", async () => {
  let attempts = 0;
  const connector = new SimulatorConnector({
    sourceUrl: "http://127.0.0.1:1",
    sourceAgentKey: "test-only",
    fetcher: async (url) => {
      assert.equal(new URL(url).pathname, "/api/actor/state");
      if (++attempts === 1) throw reset();
      return { ok: true, json: async () => ({ organization: { id: "org0" } }) };
    },
  });
  assert.equal((await connector.state()).organization.id, "org0");
  assert.equal(attempts, 2);
  assert.equal(connector.transportRetries, 1);
  await assert.rejects(connector.request("/api/observer/state"), {
    code: "SOURCE_SCOPE",
  });
});
test("retrying a command requires its exact idempotency key; an unkeyed POST and a second outage fail visibly", async () => {
  const bodies = [],
    connector = new SimulatorConnector({
      sourceUrl: "http://127.0.0.1:1",
      sourceAgentKey: "test-only",
      fetcher: async (_url, o) => {
        bodies.push(o.body);
        throw reset();
      },
    });
  await assert.rejects(
    connector.action("query", { target: "inventory" }, "same-source-command"),
  );
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(JSON.parse(bodies[0]).idempotencyKey, "same-source-command");
  bodies.length = 0;
  await assert.rejects(
    connector.request("/api/actor/action", {
      method: "POST",
      body: { type: "query", params: { target: "inventory" } },
    }),
  );
  assert.equal(bodies.length, 1);
});

test("the cloud connector allows the queue round trip and retries a DOM timeout once", async () => {
  let attempts = 0, deadline;
  const original = AbortSignal.timeout;
  AbortSignal.timeout = ms => { deadline = ms; return new AbortController().signal; };
  try {
    const connector = new SimulatorConnector({
      sourceUrl: "http://127.0.0.1:1", sourceTimeoutMs: 35000,
      fetcher: async () => {
        if (++attempts === 1) throw new DOMException("Timed out", "TimeoutError");
        return { ok: true, json: async () => ({ received: true }) };
      },
    });
    assert.equal((await connector.request("/api/actor/state")).received, true);
    assert.equal(deadline, 35000);
    assert.equal(attempts, 2);
  } finally { AbortSignal.timeout = original; }
});
