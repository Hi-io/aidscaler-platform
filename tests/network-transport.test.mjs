import test from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../evaluation/harness.mjs";
test("a laboratory peer outage prevents real HTTP delivery, retains retry and allows local owned work", async (t) => {
  const h = await createHarness({
    scenario: "S23",
    seed: "partition-transport",
    organizations: 2,
  });
  t.after(() => h.close());
  h.lab.world.advance(60000);
  const a = h.apps[0],
    b = h.apps[1];
  await a.connector.action("query", { target: "inventory" }, "own-stock");
  await a.ingestion.sync();
  const r = (await a.store.list("org0", "resource")).find(
    (r) => r.owner === "org0",
  );
  const actor = (
    await a.store.query(
      "SELECT id,org,role FROM users WHERE org='org0' AND role='commander'",
    )
  ).rows[0];
  h.lab.world.organization("org1").connected = false;
  await a.network.share(
    actor,
    { kind: "resource", id: r.id, version: r.version, to: "org1" },
    "share-during-outage",
  );
  await a.worker.drain();
  assert.equal((await b.store.list("org1", "peer_offer")).length, 0);
  assert.equal(
    (await a.store.query("SELECT state FROM jobs WHERE kind='peer_send'"))
      .rows[0].state,
    "retry",
  );
  const held = await a.domain.reserve(
    actor,
    {
      resource: r.id,
      version: r.version,
      quantity: 1,
      requester: "org0",
      ttlMs: 60000,
    },
    "local-hold",
  );
  assert.equal(held.state, "reserved");
  h.lab.world.organization("org1").connected = true;
  await a.store.query("UPDATE jobs SET due_at=$1 WHERE kind='peer_send'", [
    Date.now(),
  ]);
  await a.worker.drain();
  assert.equal((await b.store.list("org1", "peer_offer")).length, 1);
  assert.deepEqual(h.lab.world.invariants(), []);
});
