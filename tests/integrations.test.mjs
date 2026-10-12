import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Store } from "../src/store.mjs";
import { createPlatform } from "../server.mjs";
import { Integrations } from "../src/integrations.mjs";
import { McpConnector } from "../src/mcp.mjs";
test("external HTTP imports preserve source provenance without silently confirming needs or following redirects", async (t) => {
  const store = await Store.open();
  await store.organization("a");
  const actor = { org: "a", id: "admin", role: "admin" },
    connector = new Integrations(store, {});
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/data" });
      res.end();
    } else {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          results: [{ id: "field-1", text: "Water needed", quantity: 300 }],
        }),
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await store.close();
  });
  const config = {
    id: "field-source",
    name: "Authorized field service",
    type: "http_json",
    url: origin + "/data",
    allowedOrigin: origin,
    purpose: "Read authorized evidence",
    license: "Synthetic test fixture",
  };
  await connector.configure(actor, config, "configure-1");
  const record = await connector.read("a", "field-source");
  assert.equal(record.untrustedContent, true);
  assert.equal((await store.list("a", "need")).length, 0);
  assert.equal((await store.list("a", "signal"))[0].state, "unverified");
  await assert.rejects(
    () =>
      connector.configure(
        actor,
        { ...config, id: "observer", url: origin + "/api/credentials" },
        "configure-2",
      ),
    /Observer/,
  );
  await assert.rejects(() =>
    connector.configure(
      actor,
      { ...config, id: "secret", credentialsEnv: "OPENROUTER_API_KEY" },
      "configure-3",
    ),
  );
  await connector.configure(
    actor,
    { ...config, url: origin + "/redirect" },
    "configure-4",
  );
  await assert.rejects(() => connector.read("a", "field-source"));
  assert.equal(
    (await store.get("a", "integration", "field-source")).state,
    "degraded",
  );
});
test("a real MCP HTTP exchange reads only scoped records and exposes no authorization tools", async (t) => {
  const store = await Store.open();
  const app = await createPlatform({
    store,
    port: 0,
    org: "a",
    autoIngest: false,
    startWorker: false,
    writeAccessFile: false,
    bootstrapPassword: "test-password-12345",
  });
  t.after(async () => {
    await app.close();
    await store.close();
  });
  await store.put("a", "signal", "visible", { text: "Public need" }, 0);
  await store.organization("b");
  await store.put(
    "b",
    "signal",
    "private",
    { text: "Private partner note" },
    0,
  );
  assert.equal(
    (await fetch(app.url + "/mcp", { method: "POST", body: "{}" })).status,
    401,
  );
  const client = new McpConnector({
    url: app.url + "/mcp",
    allowedOrigin: app.url,
    token: app.config.mcpReadKey,
    allowedTools: ["nexo_signals", "nexo_evidence"],
  });
  const listing = await client.connect();
  assert.equal(
    listing.tools.some((t) => /dispatch|authorize|approve/.test(t.name)),
    false,
  );
  const data = await client.call("nexo_signals", { limit: 100 });
  assert.equal(JSON.parse(data.content[0].text).length, 1);
  assert.equal(JSON.stringify(data).includes("Private partner note"), false);
  await assert.rejects(() => client.call("dispatch", {}), /permitted/);
  const absent = await client.call("nexo_evidence", { id: "private" });
  assert.equal(JSON.parse(absent.content[0].text), null);
  await client.close();
});
