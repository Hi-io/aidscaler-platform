import test from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../evaluation/harness.mjs";
import { syncReservation } from "../src/reservations.mjs";
test("source reservations stay pending until acknowledgment, are idempotent and reconcile source-clock expiry", async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  h.lab.world.advance(60000);
  const a = h.apps[0],
    org = a.config.org;
  await a.connector.action("query", { target: "inventory" }, "hold-inventory");
  await a.ingestion.sync();
  const actor = (
      await a.store.query(
        "SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",
        [org],
      )
    ).rows[0],
    r = await a.store.get(org, "resource", "r-org0-water");
  const c = await a.domain.reserve(
    actor,
    {
      resource: r.id,
      version: r.version,
      quantity: 40,
      ttlMs: 60000,
      requester: org,
    },
    "pending-source-hold",
  );
  assert.equal(c.syncState, "pending");
  await assert.rejects(
    () =>
      a.domain.commitment(
        actor,
        c.id,
        { action: "confirm", version: c.version },
        "premature-confirm",
      ),
    (e) => e.code === "RESERVATION_PENDING",
  );
  const receipt = await syncReservation(a.worker, {
    id: c.id,
    action: "reserve",
  });
  assert.ok(receipt.id);
  const duplicate = await syncReservation(a.worker, {
    id: c.id,
    action: "reserve",
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(
    h.lab.world.state.commitments.filter(
      (x) => x.resource === r.id && x.requester === org,
    ).length,
    1,
  );
  await a.ingestion.sync({ sources: false });
  let current = await a.store.get(org, "commitment", c.id);
  assert.equal(current.syncState, "acknowledged");
  assert.equal(
    (await a.store.get(org, "resource", r.id)).reserved,
    40,
    "A pending local hold is not counted twice after the source ack",
  );
  await a.domain.commitment(
    actor,
    c.id,
    { action: "confirm", version: current.version },
    "confirmed-source-hold",
  );
  await syncReservation(a.worker, { id: c.id, action: "confirm" });
  h.lab.world.advance(h.lab.world.now + 120000);
  await a.ingestion.sync({ sources: false });
  current = await a.store.get(org, "commitment", c.id);
  assert.equal(current.state, "expired");
  assert.equal((await a.store.get(org, "resource", r.id)).reserved, 0);
  assert.deepEqual(h.lab.world.invariants(), []);
});
