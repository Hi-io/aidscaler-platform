import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";
import { Store, hash } from "../src/store.mjs";
import { Ingestion } from "../src/ingestion.mjs";
import { receivedSnapshotFields } from "../src/context-projection.mjs";
import { Retention } from "../src/retention.mjs";
import { Domain } from "../src/domain.mjs";
import { backupLocal, restoreLocal } from "../scripts/backup.mjs";
import { rememberImmutableSourceResult } from "../src/immutable-source-result.mjs";

function fixture() {
  const map = {
    places: [{ id: "aoba", name: "Aoba Shelter" }],
    roads: [{ id: "road", open: true }],
    nodes: [{ id: "n1" }],
  };
  return {
    organization: { id: "org0" },
    now: 1,
    runId: "fragment-run",
    known: {
      map: structuredClone(map),
      edges: {},
      needs: {},
      resources: {},
      vehicles: {},
      buildings: {},
    },
    queries: [
      { id: "map", target: "map", state: "ready", completedAt: 1, result: map },
    ],
    operations: [],
    inspections: [],
    commitments: [],
  };
}
const connector = (state) => ({ state: async () => structuredClone(state) });
async function setup(t, options) {
  const store = await Store.open(options);
  t.after(() => store.close());
  await store.organization("org0");
  await store.organization("org1");
  return store;
}

test("normalized context is exact and detached through get/list/getMany, silent corrections and arbitrary full writes", async (t) => {
  const store = await setup(t),
    state = fixture(),
    ingestion = new Ingestion(store, connector(state), { org: "org0" });
  let at = 1900000000000;
  t.mock.method(Date, "now", () => at);
  const legacy = await store.put(
    "org0",
    "context",
    "operational",
    { snapshot: structuredClone(state), observedAt: 5, extra: "retained" },
    0,
  );
  await ingestion.sync({ sources: false });
  const initial = await store.get("org0", "context", "operational");
  assert.deepEqual(
    initial,
    legacy,
    "representation migration does not create a new material receipt",
  );
  const raw = (
    await store.query(
      "SELECT data,data_refs FROM entities WHERE org='org0' AND kind='context' AND id='operational'",
    )
  ).rows[0];
  assert.equal(raw.data.snapshot.known.map, undefined);
  assert.equal(raw.data.snapshot.queries[0].result, undefined);
  assert.equal(raw.data_refs.length, 2);
  assert.equal(new Set(raw.data_refs.map((r) => r.digest)).size, 1);
  assert.equal(
    (await store.query("SELECT COUNT(*) AS n FROM entity_fragments")).rows[0].n,
    1,
  );
  await store.query(
    "DELETE FROM entities WHERE org='org0' AND id='operational_projection'",
  );
  assert.deepEqual(
    await receivedSnapshotFields(store, "org0", { fields: ["now"] }),
    { now: state.now },
    "a missing read model reconstructs the normalized authoritative source",
  );
  assert.deepEqual(
    await receivedSnapshotFields(store, "org0", {
      fields: ["queries"],
      known: ["map"],
    }),
    { queries: state.queries, known: { map: state.known.map } },
    "arbitrary fields preserve complete query results",
  );
  for (const value of [
    initial,
    (await store.getMany("org0", "context", ["operational"])).get(
      "operational",
    ),
    (await store.list("org0", "context")).find(
      (row) => row.id === "operational",
    ),
  ]) {
    assert.deepEqual(value.snapshot, state);
    value.snapshot.known.map.places[0].name = "Local mutation";
    assert.equal(
      value.snapshot.queries[0].result.places[0].name,
      "Aoba Shelter",
    );
  }
  assert.deepEqual(
    (await store.get("org0", "context", "operational")).snapshot,
    state,
  );
  at += 1000;
  await ingestion.sync({ sources: false });
  assert.deepEqual(await store.get("org0", "context", "operational"), legacy);
  state.queries[0].result.roads[0].open = false;
  at += 1000;
  await ingestion.sync({ sources: false });
  const corrected = await store.get("org0", "context", "operational");
  assert.equal(corrected.version, legacy.version + 1);
  assert.equal(corrected.observedAt, at);
  assert.deepEqual(
    corrected.snapshot,
    state,
    "same-source-version correction must survive",
  );
  const arbitrary = await store.put(
    "org0",
    "context",
    "operational",
    {
      ...corrected,
      snapshot: { ...corrected.snapshot, arbitrary: { value: null } },
    },
    corrected.version,
  );
  assert.equal(
    (
      await store.query(
        "SELECT data_refs FROM entities WHERE org='org0' AND id='operational'",
      )
    ).rows[0].data_refs.length,
    0,
  );
  assert.deepEqual(
    await receivedSnapshotFields(store, "org0", {
      fields: ["arbitrary"],
      known: ["map"],
    }),
    { arbitrary: { value: null }, known: { map: state.known.map } },
  );
  assert.equal(arbitrary.snapshot.arbitrary.value, null);
  await store.query(
    "DELETE FROM entities WHERE org='org0' AND id='operational'",
  );
  assert.equal(await store.get("org0", "context", "operational", false), null);
});

test("fragment transactions, missing pieces and organization scope never resurrect cached source data", async (t) => {
  const store = await setup(t),
    state = fixture(),
    ingestion = new Ingestion(store, connector(state), { org: "org0" }),
    query = Store.prototype.query;
  const fault = t.mock.method(
    Store.prototype,
    "query",
    async function (sql, values) {
      if (sql.startsWith("INSERT INTO audit"))
        throw Error("rollback received pieces");
      return query.call(this, sql, values);
    },
  );
  await assert.rejects(
    ingestion.sync({ sources: false }),
    /rollback received pieces/,
  );
  fault.mock.restore();
  assert.equal(
    Number(
      (await store.query("SELECT COUNT(*) AS n FROM entity_fragments")).rows[0]
        .n,
    ),
    0,
  );
  assert.equal(await store.get("org0", "context", "operational", false), null);
  await ingestion.sync({ sources: false });
  const original = await store.get("org0", "context", "operational");
  const references = (
    await store.query(
      "SELECT data_refs FROM entities WHERE org='org0' AND id='operational'",
    )
  ).rows[0].data_refs;
  await store.query(
    "INSERT INTO entities(org,kind,id,data,data_refs,created_at,updated_at) VALUES('org1','context','operational',$1,$2,0,0)",
    [
      JSON.stringify({ snapshot: { known: {}, queries: [{}] } }),
      JSON.stringify(references),
    ],
  );
  await assert.rejects(store.get("org1", "context", "operational"), {
    code: "CONTEXT_STORAGE",
  });
  await store.query("DELETE FROM entity_fragments WHERE org='org0'");
  await assert.rejects(store.get("org0", "context", "operational"), {
    code: "CONTEXT_STORAGE",
  });
  await assert.rejects(store.getMany("org0", "context", ["operational"]), {
    code: "CONTEXT_STORAGE",
  });
  assert.equal(original.snapshot.runId, state.runId);
});

test("recovery is self-contained, disk restart is exact and privacy erasure includes normalized source fragments", async (t) => {
  const root = path.resolve(".local");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "fragment-recovery-")),
    dataDir = path.join(directory, "db"),
    state = fixture();
  let store = await Store.open({ dataDir });
  await store.organization("org0");
  const sensitive =
    "Private report with a sensitive location belonging to a resident.";
  state.known.map.places[0].description = sensitive;
  state.queries[0].result.places[0].description = sensitive;
  for (const value of [state.known.map, state.queries[0].result])
    rememberImmutableSourceResult(value, hash(value), JSON.stringify(value));
  await new Ingestion(
    store,
    { state: async () => state },
    { org: "org0" },
  ).sync({ sources: false });
  const before = await store.get("org0", "context", "operational");
  await store.close();
  store = await Store.open({ dataDir });
  t.after(() => store.close());
  assert.deepEqual(await store.get("org0", "context", "operational"), before);
  const bundle = await backupLocal(store, {
    evidenceDir: path.join(directory, "evidence"),
  });
  assert(
    bundle.payload.tables.entities.every((row) => row.data_refs.length === 0),
  );
  const restored = await restoreLocal(bundle, path.join(directory, "restored")),
    copy = await Store.open({ dataDir: restored.dataDir });
  try {
    assert.deepEqual(await copy.get("org0", "context", "operational"), before);
  } finally {
    await copy.close();
  }
  await store.put("org0", "signal", "source", { text: sensitive }, 0);
  const retention = new Retention(store, new Domain(store, {}), {}),
    actor = { org: "org0", id: "owner", role: "commander" },
    plan = await retention.preview(actor, { kind: "signal", id: "source" });
  await retention.erase(
    actor,
    {
      kind: "signal",
      id: "source",
      version: plan.version,
      planHash: plan.planHash,
      reason: "Approved privacy erasure",
    },
    "erase-fragment",
  );
  assert(
    !JSON.stringify(
      (await store.query("SELECT data FROM entity_fragments WHERE org='org0'"))
        .rows,
    ).includes(sensitive),
  );
  assert(
    !JSON.stringify(await store.get("org0", "context", "operational")).includes(
      sensitive,
    ),
  );
});
