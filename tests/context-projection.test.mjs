import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Store } from "../src/store.mjs";
import {
  receivedSnapshotFields,
  receivedPolicyQueries,
  receivedDirectoryPlaces,
  receivedDirectoryRevision,
  persistOperationalReadModel,
  persistDirectoryReadModel,
} from "../src/context-projection.mjs";
import { receivedExecutionPolicy } from "../src/reservation-policy.mjs";
import { Coverage } from "../src/coverage.mjs";

const options = {
  fields: ["now", "runId", "inspections", "operations"],
  known: ["buildings", "sectorContacts", "buildingContacts"],
};
const select = (snapshot) => ({
  now: snapshot.now,
  runId: snapshot.runId,
  inspections: snapshot.inspections,
  operations: snapshot.operations,
  known: {
    buildings: snapshot.known.buildings,
    sectorContacts: snapshot.known.sectorContacts,
    buildingContacts: snapshot.known.buildingContacts,
  },
});
const fixture = () => ({
  now: 0,
  runId: "received-run",
  organization: { id: "org0" },
  known: {
    map: { privateUnusedBlob: "x".repeat(1000000) },
    edges: { e: { open: false } },
    buildings: { shelter: { id: "shelter", safe: null } },
    sectorContacts: null,
    buildingContacts: {},
  },
  inspections: [{ id: "i1", state: "pending", result: null }],
  operations: [],
  queries: [
    {
      id: "map",
      target: "map",
      state: "ready",
      result: { unrelatedLargeDocument: "y".repeat(1000000) },
    },
    {
      id: "policy-first",
      target: "policy",
      state: "ready",
      completedAt: 5,
      result: { version: 1, execution: { delivery: { loadMs: 0 } } },
    },
    {
      id: "policy-pending",
      target: "policy",
      state: "pending",
      completedAt: 100,
      result: { execution: {} },
    },
    {
      id: "policy-last",
      target: "policy",
      state: "ready",
      completedAt: 5,
      result: {
        version: 2,
        observedAt: 0,
        execution: { delivery: { loadMs: 1 } },
      },
    },
  ],
});
async function setup(t) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.organization("org1");
  return store;
}

test("received read models return exact selected JSON values, policy order and scope while retaining the complete source snapshot", async (t) => {
  const s = await setup(t),
    snapshot = fixture(),
    map = {
      nodes: [{ id: "n1" }],
      roads: [{ id: "e" }],
      places: [
        {
          id: "shelter",
          node: "n1",
          name: "Harbor Shelter",
          sector: null,
          extra: { x: 1 },
        },
      ],
    };
  const operational = await s.put(
      "org0",
      "context",
      "operational",
      { snapshot },
      0,
    ),
    geography = await s.put(
      "org0",
      "context",
      "geography",
      { map, sourceMapHash: "map-v1" },
      0,
    );
  const before = await receivedSnapshotFields(s, "org0", options);
  assert.deepEqual(before, select(snapshot));
  await s.transaction(async (tx) => {
    await persistOperationalReadModel(
      tx,
      "org0",
      snapshot,
      operational.version,
    );
    await persistDirectoryReadModel(
      tx,
      "org0",
      map,
      geography.version,
      "map-v1",
    );
  });
  assert.deepEqual(await receivedSnapshotFields(s, "org0", options), before);
  assert.deepEqual(
    await receivedPolicyQueries(s, "org0"),
    snapshot.queries.filter((q) => q.target === "policy"),
  );
  assert.deepEqual(await receivedExecutionPolicy(s, "org0"), {
    delivery: { loadMs: 1 },
    queryId: "policy-last",
    observedAt: 0,
    sourceVersion: 2,
  });
  assert.deepEqual(await receivedDirectoryPlaces(s, "org0"), {
    places: map.places,
  });
  assert.deepEqual(await receivedDirectoryRevision(s, "org0"), {
    version: geography.version,
    source_map_hash: "map-v1",
  });
  assert.deepEqual(
    (await s.get("org0", "context", "operational")).snapshot,
    snapshot,
    "AI and explicit evidence reads keep the complete received source",
  );
  assert.deepEqual((await s.get("org0", "context", "geography")).map, map);
  assert.deepEqual(
    await receivedSnapshotFields(s, "org0", {
      fields: ["organization"],
      known: ["edges"],
    }),
    {
      organization: snapshot.organization,
      known: { edges: snapshot.known.edges },
    },
    "a non-materialized field falls back to the complete source",
  );
  assert.equal(await receivedSnapshotFields(s, "org1", options), undefined);
  assert.deepEqual(await receivedPolicyQueries(s, "org1"), []);
  assert.equal(await receivedDirectoryPlaces(s, "org1"), undefined);
  for (const invalid of [
    { fields: ["known"] },
    { fields: ["now); DROP TABLE entities"] },
    { known: Array(33).fill("buildings") },
  ])
    await assert.rejects(receivedSnapshotFields(s, "org0", invalid), {
      code: "CONTEXT_FIELDS",
    });
});

test("version fences expose silent source corrections, absent fields, erasure and rolled-back writes without stale cached authority", async (t) => {
  const s = await setup(t),
    snapshot = fixture();
  const original = await s.put(
    "org0",
    "context",
    "operational",
    { snapshot },
    0,
  );
  await persistOperationalReadModel(s, "org0", snapshot, original.version);
  const corrected = structuredClone(snapshot);
  corrected.now = 2000;
  corrected.runId = "new-run";
  corrected.known.buildings.shelter.safe = false;
  corrected.queries.at(-1).result.execution.delivery.loadMs = 5000;
  const changed = await s.put(
    "org0",
    "context",
    "operational",
    { snapshot: corrected },
    original.version,
  );
  assert.deepEqual(
    await receivedSnapshotFields(s, "org0", options),
    select(corrected),
    "the old derived version must not hide a correction",
  );
  assert.equal(
    (await receivedExecutionPolicy(s, "org0")).delivery.loadMs,
    5000,
  );
  await persistOperationalReadModel(s, "org0", corrected, changed.version);
  await assert.rejects(
    s.transaction(async (tx) => {
      const rolled = { ...corrected, now: 999999 };
      const saved = await tx.put(
        "org0",
        "context",
        "operational",
        { snapshot: rolled },
        changed.version,
      );
      await persistOperationalReadModel(tx, "org0", rolled, saved.version);
      throw new Error("Rollback both authoritative data and its read model");
    }),
    /Rollback both/,
  );
  assert.deepEqual(
    await receivedSnapshotFields(s, "org0", options),
    select(corrected),
  );
  assert.equal(
    (await s.get("org0", "context", "operational_projection"))
      .sourceEntityVersion,
    changed.version,
  );
  const erased = await s.put(
    "org0",
    "context",
    "operational",
    { sourceErased: true },
    changed.version,
  );
  assert.equal(await receivedSnapshotFields(s, "org0", options), undefined);
  assert.deepEqual(await receivedPolicyQueries(s, "org0"), []);
  for (const value of [null, {}, { now: null, known: null }, { known: {} }]) {
    const saved = await s.upsert("org0", "context", "operational", {
      snapshot: value,
    });
    const before = await receivedSnapshotFields(s, "org0", options);
    await persistOperationalReadModel(s, "org0", value, saved.version);
    assert.deepEqual(
      await receivedSnapshotFields(s, "org0", options),
      before,
      "null and missing field values stay distinct",
    );
  }
  assert.ok(erased.version > changed.version);
});

test("derived geography is durable across a database restart and invalidates on a corrected directory version", async (t) => {
  const root = path.resolve(".local");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "context-read-model-"));
  let s;
  t.after(async () => {
    if (s && !s.db.closed) await s.close();
    if (!path.resolve(dir).startsWith(root + path.sep))
      throw Error("Invalid fixture cleanup path");
    await rm(dir, { recursive: true, force: true });
  });
  s = await Store.open({ dataDir: dir });
  await s.organization("org0");
  const map = {
      places: [{ id: "a", name: "Aoba Shelter" }],
      roads: [{ id: "large-road-geometry" }],
    },
    saved = await s.put(
      "org0",
      "context",
      "geography",
      { map, sourceMapHash: "old" },
      0,
    );
  await persistDirectoryReadModel(s, "org0", map, saved.version, "old");
  await s.close();
  s = await Store.open({ dataDir: dir });
  assert.deepEqual(await receivedDirectoryPlaces(s, "org0"), {
    places: map.places,
  });
  const updated = await s.put(
    "org0",
    "context",
    "geography",
    {
      map: { places: [{ id: "a", name: "Corrected name" }] },
      sourceMapHash: "corrected",
    },
    saved.version,
  );
  assert.deepEqual(await receivedDirectoryPlaces(s, "org0"), {
    places: [{ id: "a", name: "Corrected name" }],
  });
  assert.deepEqual(await receivedDirectoryRevision(s, "org0"), {
    version: updated.version,
    source_map_hash: "corrected",
  });
});

test("coverage summary remains identical to the full-context reader with source-confirmed checks and unknown places", async (t) => {
  const s = await setup(t),
    snapshot = {
      ...fixture(),
      now: 1000,
      inspections: [
        {
          id: "exact",
          target: "building",
          entity: "a",
          org: "org0",
          state: "completed",
          confirmedBySource: true,
          observedAt: 900,
          result: { id: "a", version: 1 },
        },
      ],
    },
    map = {
      places: [
        { id: "a", name: "Aoba", node: "n1", sector: "s" },
        { id: "b", node: "n2", sector: "s" },
      ],
      roads: [{ id: "unused" }],
    };
  const o = await s.put("org0", "context", "operational", { snapshot }, 0),
    g = await s.put("org0", "context", "geography", { map }, 0);
  const coverage = new Coverage(s, {}, { org: "org0" }),
    context = coverage.context.bind(coverage);
  coverage.context = async (store) => ({
    ...(await context(store)),
    map: (await (store ?? s).get("org0", "context", "geography")).map,
    snapshot: (await (store ?? s).get("org0", "context", "operational"))
      .snapshot,
  });
  const full = await coverage.summary();
  coverage.context = context;
  await persistOperationalReadModel(s, "org0", snapshot, o.version);
  await persistDirectoryReadModel(s, "org0", map, g.version, "map");
  assert.deepEqual(await coverage.summary(), full);
});
