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

test("an empty city database receives 12716 roads with bounded writes and preserves revisions and organization scope", async (t) => {
  const s = await Store.open(); t.after(() => s.close());
  await s.organization("org0"); await s.organization("org1");
  const roads = Array.from({ length: 12716 }, (_, i) => ({ id: `city-road-${i}`, open: true, version: 1, at: 50000 }));
  roads[0].createdAt = 123; roads[0].updatedAt = 456;
  await s.put("org1", "road", roads[10000].id, { open: false, sourceVersion: 99, note: "Private foreign road" }, 0);
  await s.put("org0", "facility", roads[10000].id, { name: "Separate entity kind" }, 0);
  const foreign = await s.get("org1", "road", roads[10000].id),
    unrelatedKind = await s.get("org0", "facility", roads[10000].id);
  const state = { organization: { id: "org0" }, runId: "city-batch-regression", now: 60000,
    known: { resources: {}, vehicles: {}, needs: {}, buildings: {}, edges: Object.fromEntries(roads.map(r => [r.id, r])) },
    queries: [{ id: "map-1", target: "map", state: "ready", completedAt: 50000,
      result: { topology: "takamatsu", extentM: 10000, roads: roads.map(({ id }) => ({ id, from: "a", to: "b" })) } }],
    commitments: [], operations: [], inspections: [] };
  const connector = { state: async () => structuredClone(state), feed: async () => ({ posts: [], nextCursor: 100 }),
    inbox: async () => ({ posts: [] }), ackBatch: async () => [] };
  const ingestion = new Ingestion(s, connector, { org: "org0" });
  const query = Store.prototype.query;
  let batches = [], writePages = [], rowReads = 0;
  Store.prototype.query = function(sql, values) {
    if (sql.startsWith("SELECT incoming.item") && values?.[1] === "road") {
      assert.equal(values[0], "org0"); batches.push(JSON.parse(values[2]).map(row => row.id));
    }
    if (sql.startsWith("SELECT") && values?.[1] === "road" && sql.includes("AND id=$3")) rowReads++;
    if (sql.includes("WITH incoming AS") && values?.[1] === "road") writePages.push(JSON.parse(values[2]));
    return query.call(this, sql, values);
  };
  t.after(() => { Store.prototype.query = query; });
  const checkBatches = () => {
    assert.deepEqual(batches.map(b => b.length), [10000, 2716]);
    assert.deepEqual(batches.flat(), roads.map(r => r.id), "no road may be skipped at the page boundary");
  };
  await ingestion.sync(); checkBatches();
  assert.equal(rowReads, 0, "initial city ingestion must not read back each inserted row");
  assert.equal(writePages.length, 26);
  assert.ok(writePages.every(page => page.length <= 500));
  assert.equal(writePages.flat().length, roads.length);
  assert.equal((await s.get("org0", "source", "simulator")).state, "connected");
  assert.equal((await s.get("org0", "road", roads.at(-1).id)).sourceVersion, 1);
  const untouched = await s.get("org0", "road", roads[10001].id),
    geography = await s.get("org0", "context", "geography"),
    storedData = (await s.query("SELECT data FROM entities WHERE org=$1 AND kind=$2 AND id=$3", ["org0", "road", roads[0].id])).rows[0].data;
  for (const key of ["id", "version", "createdAt", "updatedAt"]) assert.equal(Object.hasOwn(storedData, key), false, key);
  for (const i of [9999, 10000]) { state.known.edges[roads[i].id].open = false; state.known.edges[roads[i].id].version = 2; }
  state.now = 90000; state.queries[0].completedAt = 85000; batches = []; writePages = []; rowReads = 0;
  await ingestion.sync(); checkBatches();
  assert.equal(rowReads, 0, "revisions must also avoid individual readbacks");
  assert.equal(writePages.length, 1); assert.equal(writePages[0].length, 2);
  for (const i of [9999, 10000]) {
    const road = await s.get("org0", "road", roads[i].id);
    assert.equal(road.open, false); assert.equal(road.sourceVersion, 2); assert.equal(road.version, 2);
  }
  assert.deepEqual(await s.get("org0", "road", roads[10001].id), untouched);
  assert.deepEqual(await s.get("org1", "road", roads[10000].id), foreign);
  assert.deepEqual(await s.get("org0", "facility", roads[10000].id), unrelatedKind);
  assert.equal((await s.get("org0", "source", "simulator")).state, "connected");
  assert.equal((await s.get("org0", "source", "simulator")).simulatedAt, 90000);
  assert.deepEqual(await s.get("org0", "context", "geography"), geography,
    "unchanged map content keeps its material receipt without rewriting the directory");
  assert.equal((await s.query("SELECT payload FROM jobs WHERE org=$1 AND kind='invalidate'", ["org0"])).rows.length, 2,
    "only the two newly received closures invalidate dependent work");
  state.queries[0].result.extentM = 12000; state.now = 100000;
  await ingestion.sync();
  const revisedMap = await s.get("org0", "context", "geography");
  assert.equal(revisedMap.version, geography.version + 1); assert.equal(revisedMap.map.extentM, 12000);
  await assert.rejects(s.getMany("org0", "road", roads.map(r => r.id)), { code: "BATCH_SCOPE" },
    "the underlying store bound remains enforced");
});

test("batched source writes preserve local holds and roll back all pages on an optimistic insert conflict", async (t) => {
  const s = await Store.open(); t.after(() => s.close()); await s.organization("org0");
  const prior = { id: "existing-road", open: true, version: 1 };
  await s.put("org0", "road", prior.id, { ...prior, sourceSnapshot: prior, sourceVersion: 1 }, 0);
  const original = await s.get("org0", "road", prior.id);
  await s.put("org0", "commitment", "pending-hold", { state: "reserved", syncState: "pending", resource: "water", quantity: 7 }, 0);
  const roads = [ { ...prior, open: false, version: 2 }, ...Array.from({ length: 501 }, (_, i) => ({ id: `new-road-${i}`, open: true, version: 1 })) ],
    state = { organization: { id: "org0" }, runId: "atomic-city-snapshot", now: 60000,
      known: { resources: { water: { id: "water", type: "water", quantity: 30, reserved: 5, floor: 2, version: 1 } },
        vehicles: {}, needs: {}, buildings: {}, edges: Object.fromEntries(roads.map(r => [r.id, r])) },
      queries: [], commitments: [], operations: [], inspections: [] };
  const connector = { state: async () => structuredClone(state), feed: async () => ({ posts: [], nextCursor: 100 }),
    inbox: async () => ({ posts: [] }), ackBatch: async () => [] };
  const ingestion = new Ingestion(s, connector, { org: "org0" }), query = Store.prototype.query;
  let roadPage = 0;
  Store.prototype.query = async function(sql, values) {
    if (sql.includes("WITH incoming AS") && values?.[1] === "road" && ++roadPage === 2) {
      const collision = JSON.parse(values[2])[0];
      await query.call(this, "INSERT INTO entities(org,kind,id,data,created_at,updated_at) VALUES($1,$2,$3,$4,0,0)",
        ["org0", "road", collision.id, JSON.stringify({ race: true })]);
    }
    return query.call(this, sql, values);
  };
  t.after(() => { Store.prototype.query = query; });
  await assert.rejects(ingestion.sync(), { code: "VERSION_CONFLICT" });
  Store.prototype.query = query;
  assert.deepEqual(await s.get("org0", "road", prior.id), original, "the first page's update must roll back");
  assert.equal((await s.list("org0", "road", 1000)).length, 1, "all first-page insertions and the racing row roll back");
  assert.equal(await s.get("org0", "resource", "water", false), null, "earlier entity kinds roll back with roads");
  assert.equal(await s.get("org0", "context", "operational", false), null);
  assert.equal((await s.get("org0", "source", "simulator")).state, "degraded");
  assert.equal((await s.query("SELECT id FROM jobs WHERE org=$1 AND kind='invalidate'", ["org0"])).rows.length, 0);
  await ingestion.sync();
  const resource = await s.get("org0", "resource", "water");
  assert.equal(resource.reserved, 12); assert.equal(resource.floor, 2);
  assert.equal((await s.get("org0", "road", prior.id)).version, original.version + 1);
  assert.equal((await s.get("org0", "source", "simulator")).state, "connected");
});

test("batched updates reject a changed or removed expected version instead of recreating stale source records", async (t) => {
  const s = await Store.open(); t.after(() => s.close()); await s.organization("org0");
  const before = { id: "checked-road", open: true, version: 1 };
  await s.put("org0", "road", before.id, { ...before, sourceSnapshot: before, sourceVersion: 1 }, 0);
  const original = await s.get("org0", "road", before.id), query = Store.prototype.query,
    state = { organization: { id: "org0" }, runId: "version-fence", now: 60000,
      known: { resources: {}, vehicles: {}, needs: {}, buildings: {},
        edges: { [before.id]: { ...before, open: false, version: 2 } } },
      queries: [], commitments: [], operations: [], inspections: [] },
    connector = { state: async () => structuredClone(state), feed: async () => ({ posts: [], nextCursor: 100 }),
      inbox: async () => ({ posts: [] }), ackBatch: async () => [] };
  t.after(() => { Store.prototype.query = query; });
  for (const race of ["changed", "removed"]) {
    let injected = false;
    Store.prototype.query = async function(sql, values) {
      if (!injected && sql.includes("WITH incoming AS") && values?.[1] === "road") {
        injected = true;
        await query.call(this, race === "changed"
          ? "UPDATE entities SET version=version+1 WHERE org=$1 AND kind=$2 AND id=$3"
          : "DELETE FROM entities WHERE org=$1 AND kind=$2 AND id=$3", ["org0", "road", before.id]);
      }
      return query.call(this, sql, values);
    };
    await assert.rejects(new Ingestion(s, connector, { org: "org0" }).sync(), { code: "VERSION_CONFLICT" }, race);
    Store.prototype.query = query;
    assert.deepEqual(await s.get("org0", "road", before.id), original, race);
    assert.equal(await s.get("org0", "context", "operational", false), null, race);
  }
});

test("material SQL comparison preserves context receipts, silent corrections, run changes and restart reads", async (t) => {
  const s = await Store.open(); t.after(() => s.close()); await s.organization("org0"); await s.organization("org1");
  let wall = 1900000000000;
  t.mock.method(Date, "now", () => wall);
  const road = { id: "road", open: true, version: 1 },
    state = { organization: { id: "org0" }, runId: "first-run", now: 60000,
      known: { resources: {}, vehicles: {}, needs: {}, buildings: {}, edges: { road } },
      queries: [], commitments: [], operations: [], inspections: [] },
    connector = { state: async () => structuredClone(state), feed: async () => ({ posts: [], nextCursor: 100 }),
      inbox: async () => ({ posts: [] }), ackBatch: async () => [] };
  await s.put("org0", "context", "operational", { unrelated: "Keep this metadata" }, 0);
  const ingestion = new Ingestion(s, connector, { org: "org0" });
  await ingestion.sync({ sources: false });
  const before = await s.get("org0", "context", "operational"), previousRoad = await s.get("org0", "road", "road");
  assert.equal(before.unrelated, "Keep this metadata");
  wall += 1000;
  await new Ingestion(s, connector, { org: "org0" }).sync({ sources: false });
  assert.deepEqual(await s.get("org0", "context", "operational"), before, "a restarted reader must not rewrite an identical material receipt");
  assert.deepEqual(await s.get("org0", "road", "road"), previousRoad);
  road.open = false; // No source-version bump: content must still be checked.
  wall += 1000;
  await ingestion.sync({ sources: false });
  const corrected = await s.get("org0", "context", "operational"), correctedRoad = await s.get("org0", "road", "road");
  assert.equal(corrected.version, before.version + 1); assert.equal(corrected.observedAt, wall);
  assert.equal(corrected.snapshot.known.edges.road.open, false);
  assert.equal(correctedRoad.version, previousRoad.version + 1); assert.equal(correctedRoad.open, false);
  assert.equal(correctedRoad.sourceVersion, 1);
  assert.equal((await s.query("SELECT id FROM jobs WHERE org=$1 AND kind='invalidate'", ["org0"])).rows.length, 1);
  state.now += 1000; state.runId = "replacement-run"; wall += 1000;
  await ingestion.sync({ sources: false });
  const replaced = await s.get("org0", "context", "operational");
  assert.equal(replaced.snapshot.runId, "replacement-run"); assert.equal(replaced.snapshot.now, state.now);
  assert.equal(replaced.observedAt, wall); assert.equal(replaced.version, corrected.version + 1);
  assert.equal(await s.get("org1", "road", "road", false), null);
  assert.equal(await s.get("org1", "context", "operational", false), null);
  state.organization.id = "org1";
  await assert.rejects(ingestion.sync({ sources: false }), { code: "SOURCE_ORG" });
  assert.deepEqual(await s.get("org0", "context", "operational"), replaced);
});
