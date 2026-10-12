import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { Investigator } from "../src/investigation.mjs";
import { ReplayProvider } from "../src/provider.mjs";
test("restart resumes an unfinished tool batch without repeating inference or a completed source query", async (t) => {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  let inference = 0, physicalQueries = 0; const queries = new Map();
  const connector = { startModel: async () => ({ id: "timing" }), finishModel: async () => {}, state: async () => ({ queries: [...queries.values()] }), action: async (_, args, key) => {
    if (!queries.has(key)) { physicalQueries++; queries.set(key, { id: key, state: "ready", result: { checked: args.target } }); }
    return queries.get(key);
  } };
  const fixture = new ReplayProvider([
    { role: "assistant", tool_calls: [{ id: "q1", type: "function", function: { name: "lookup", arguments: '{"target":"inventory"}' } }] },
    { role: "assistant", tool_calls: [{ id: "done", type: "function", function: { name: "finish_without_proposal", arguments: '{"reason":"No useful feasible capacity; stop without inventing a response."}' } }] },
  ]);
  const provider = { complete: async (p) => { inference++; return fixture.complete(p); } }, config = { org: "org0", peers: [], modelId: "recorded-contract-fixture", maxCalls: 3 };
  const investigator = new Investigator({ store, domain: new Domain(store, config), connector, provider, config });
  const realPut = store.upsert.bind(store); let interrupted = false;
  store.upsert = async (org, kind, id, data) => {
    if (!interrupted && kind === "investigation_checkpoint" && data.toolOffset === 1) { interrupted = true; throw new Error("Injected crash after source receipt, before checkpoint"); }
    return realPut(org, kind, id, data);
  };
  await assert.rejects(investigator.run({}, "restart-job"));
  assert.equal(inference, 1); assert.equal(physicalQueries, 1);
  store.upsert = realPut;
  const result = await investigator.run({}, "restart-job");
  assert.equal(result.state, "inconclusive"); assert.equal(inference, 2); assert.equal(physicalQueries, 1); assert.equal(result.calls, 2);
  assert.equal((await store.get("org0", "investigation_checkpoint", "restart-job")).state, "completed");
  await investigator.run({}, "restart-job"); assert.equal(inference, 2);
});
