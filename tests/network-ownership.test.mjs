import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Network } from "../src/network.mjs";
test("a public observation of another owner's stock or vehicle cannot become a new local offer", async (t) => {
 const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
 const network = new Network(store, { org: "org0", peers: [{ org: "org1", key: "test-hmac", url: "http://127.0.0.1" }] });
 const actor = { org: "org0", id: "coordinator", role: "commander" };
 for (const kind of ["resource", "vehicle"]) {
  const row = await store.put("org0", kind, "foreign-" + kind, { owner: "org2", quantity: 10, reserved: 0, floor: 0, state: "idle", type: "staff", qualifications: ["shelter_support"] }, 0);
  await assert.rejects(network.share(actor, { kind, id: row.id, version: row.version, to: "org1" }, "rebrand-" + kind), { code: "OWNER" });
 }
 assert.equal((await store.list("org0", "permission")).length, 0); assert.equal((await store.query("SELECT id FROM jobs")).rows.length, 0);
 const owned = await store.put("org0", "resource", "owned", { owner: "org0", quantity: 4, reserved: 1, floor: 1, type: "staff", qualifications: ["shelter_support"] }, 0);
 await network.share(actor, { kind: "resource", id: owned.id, version: owned.version, to: "org1" }, "share-owned");
 const message = (await store.query("SELECT payload FROM jobs")).rows[0].payload.message;
 assert.equal(message.projection.available, 2); assert.equal(message.projection.owner, "org0"); assert.deepEqual(message.projection.qualifications, ["shelter_support"]);
});
