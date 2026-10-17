import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { Store } from "../src/store.mjs";
import { Ingestion } from "../src/ingestion.mjs";
import { receivedSnapshotFields, receivedDirectoryPlaces } from "../src/context-projection.mjs";
import { receivedExecutionPolicy } from "../src/reservation-policy.mjs";

const connectionPath = new URL("../.local/native-postgres/connection.json", import.meta.url);
let privateConnection, admin, nativeStore, embeddedStore, schema;
const clean = ({ createdAt, updatedAt, ...record }) => record;
async function exercise(store) {
  await store.organization("org0"); await store.organization("org1");
  await store.put("org1", "resource", "water", { quantity: 777 }, 0);
  const snapshot = { organization: { id: "org0" }, runId: "storage-parity", now: 60000,
    known: { resources: { water: { id: "water", type: "water", owner: "org0", quantity: 100, reserved: 0, floor: 10, version: 1, node: "n1" } },
      needs: {}, vehicles: {}, buildings: {}, edges: { road: { id: "road", open: true, version: 1 } } },
    operations: [], inspections: [], commitments: [], queries: [
      { id: "map", target: "map", state: "ready", result: { nodes: [{ id: "n1" }, { id: "n2" }], roads: [{ id: "road", from: "n1", to: "n2" }], places: [{ id: "shelter", node: "n2", name: "Aoba Shelter" }] } },
      { id: "policy", target: "policy", state: "ready", completedAt: 50000, result: { version: 1, execution: { delivery: { loadMs: 1000 } } } },
    ] };
  const ingestion = new Ingestion(store, { state: async () => structuredClone(snapshot) }, { org: "org0" });
  await ingestion.sync({ sources: false });
  const initial = await store.get("org0", "road", "road");
  await ingestion.sync({ sources: false });
  assert.deepEqual(await store.get("org0", "road", "road"), initial);
  snapshot.known.edges.road.open = false; // Same physical version; preserve silent corrections.
  await ingestion.sync({ sources: false });
  assert.equal((await store.get("org0", "road", "road")).version, 2);
  await assert.rejects(store.transaction(async tx => {
    await tx.upsert("org0", "note", "rolled-back", { text: "Must not survive" });
    throw new Error("rollback fixture");
  }), /rollback fixture/);
  assert.equal(await store.get("org0", "note", "rolled-back", false), null);
  const command = () => store.command("org0", "stable-command", { value: 1 }, tx => tx.upsert("org0", "note", "saved", { text: "Retained once" }));
  const once = await command(); assert.deepEqual(await command(), once);
  await assert.rejects(store.put("org0", "note", "saved", { text: "Stale" }, 999), { code: "VERSION_CONFLICT" });
  assert.equal((await store.get("org1", "resource", "water")).quantity, 777);
  return {
    resource: clean(await store.get("org0", "resource", "water")), road: clean(await store.get("org0", "road", "road")),
    saved: clean(await store.get("org0", "note", "saved")),
    context: await receivedSnapshotFields(store, "org0", { fields: ["now", "runId"] }),
    directory: await receivedDirectoryPlaces(store, "org0"), policy: await receivedExecutionPolicy(store, "org0"),
  };
}
try {
  privateConnection = JSON.parse(await readFile(connectionPath, "utf8"));
  const endpoint = new URL(privateConnection.databaseUrl);
  assert.equal(endpoint.hostname, "127.0.0.1"); assert.equal(endpoint.port, "5488");
  admin = new pg.Pool({ connectionString: endpoint.href });
  schema = "aidscaler_smoke_" + randomUUID().replaceAll("-", "");
  assert.match(schema, /^aidscaler_smoke_[a-f0-9]{32}$/);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  endpoint.searchParams.set("options", "-c search_path=" + schema);
  nativeStore = await Store.open({ databaseUrl: endpoint.href });
  embeddedStore = await Store.open();
  const native = await exercise(nativeStore), embedded = await exercise(embeddedStore);
  assert.deepEqual(native, embedded);
  const settings = (await admin.query("SELECT version() AS version,current_setting('listen_addresses') AS listen,current_setting('port') AS port,current_setting('fsync') AS fsync,current_setting('synchronous_commit') AS synchronous_commit,current_setting('full_page_writes') AS full_page_writes")).rows[0];
  const report = { at: new Date().toISOString(), parity: true, checks: ["received ingestion", "silent corrections", "transaction rollback", "idempotent commands", "optimistic versions", "organization scope", "durable read models", "received policy order"], settings };
  await writeFile(new URL("../.local/native-postgres/store-parity.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log("Native PostgreSQL and embedded Store parity passed: " + report.checks.length + " checks. Private cluster uses loopback only and normal durability.");
} catch (error) {
  const message = String(error.message).replaceAll(privateConnection?.password ?? "NO_PRIVATE_VALUE", "[redacted]").replaceAll(privateConnection?.databaseUrl ?? "NO_PRIVATE_URL", "[private connection]");
  console.error(message); process.exitCode = 1;
} finally {
  await nativeStore?.close(); await embeddedStore?.close();
  if (admin && schema && /^aidscaler_smoke_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin?.end();
}
