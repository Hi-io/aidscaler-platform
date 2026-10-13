import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Ingestion } from "../src/ingestion.mjs";

test("batch reads preserve exact scope and versions inside a committing transaction", async (t) => {
  const s = await Store.open(); t.after(() => s.close());
  for (const org of ["org0", "org1"]) await s.organization(org);
  await s.put("org0", "signal", "shared-id", { text: "Local source" }, 0);
  await s.put("org1", "signal", "shared-id", { text: "Private foreign source" }, 0);
  await s.put("org0", "need", "shared-id", { text: "Other entity kind" }, 0);
  const rows = await s.getMany("org0", "signal", ["shared-id", "missing", "shared-id"]);
  assert.equal(rows.size, 1); assert.deepEqual(rows.get("shared-id"), await s.get("org0", "signal", "shared-id"));
  assert.equal((await s.getMany("org0", "signal", [])).size, 0);
  await assert.rejects(s.getMany("org0", "signal", [null]), { code: "BATCH_SCOPE" });
  const before = rows.get("shared-id");
  await s.transaction(async (tx) => {
    await tx.put("org0", "signal", "shared-id", { text: "New version" }, before.version);
    assert.equal((await tx.getMany("org0", "signal", ["shared-id"])).get("shared-id").version, before.version + 1);
  });
  assert.equal((await s.getMany("org1", "signal", ["shared-id"])).get("shared-id").text, "Private foreign source");
});

test("unchanged source polling batches topology reads without rewriting receipts or their first reception time", async (t) => {
  const s = await Store.open(); t.after(() => s.close()); await s.organization("org0");
  const state = {
    organization: { id: "org0" }, runId: "batch-regression", now: 60000,
    known: { resources: {}, vehicles: {}, needs: {}, buildings: {}, edges: Object.fromEntries(Array.from({ length: 300 }, (_, i) => ["e" + i, { id: "e" + i, open: true, version: 1, at: 50000 }])) },
    operations: [{ id: "delivery-1", org: "org0", need: "need-1", type: "delivery", state: "completed", quantity: 300, received: 300, times: { service: 50000 }, version: 1 }],
    inspections: [{ id: "inspection-1", target: "building", entity: "shelter-1", method: "clarification", state: "completed", result: { safe: true, version: 1 }, version: 1 }],
    queries: [], commitments: [],
  };
  const connector = { state: async () => structuredClone(state), feed: async () => ({ posts: [], nextCursor: 100 }), inbox: async () => ({ posts: [] }), ackBatch: async () => [] };
  const ingestion = new Ingestion(s, connector, { org: "org0" });
  await ingestion.sync();
  const operation = await s.get("org0", "operation", "delivery-1"), verification = await s.get("org0", "verification", "inspection-1");
  assert.equal(verification.receivedAtSourceClock, 60000);
  let roadReads = 0;
  const query = Store.prototype.query;
  Store.prototype.query = function(sql, values) { if (sql.startsWith("SELECT") && values?.[1] === "road") roadReads++; return query.call(this, sql, values); };
  t.after(() => { Store.prototype.query = query; });
  state.now = 90000; await ingestion.sync();
  assert.equal(roadReads, 1, "one bounded topology read replaces 300 individual lookups");
  assert.deepEqual(await s.get("org0", "operation", "delivery-1"), operation);
  assert.deepEqual(await s.get("org0", "verification", "inspection-1"), verification);
  state.now = 100000; state.inspections[0].result = { safe: false, version: 2 }; state.inspections[0].version = 2;
  state.operations[0].received = 200; state.operations[0].version = 2;
  await ingestion.sync();
  const changed = await s.get("org0", "verification", "inspection-1");
  assert.equal(changed.receivedAtSourceClock, 100000); assert.equal(changed.version, verification.version + 1);
  assert.equal((await s.get("org0", "operation", "delivery-1")).received, 200);
  assert.equal((await s.get("org0", "operation", "delivery-1")).version, operation.version + 1);
});
