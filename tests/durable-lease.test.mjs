import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
test("heartbeat renews a long inference lease; a stale worker cannot finish or fail a reclaimed job", async (t) => {
  const s = await Store.open(); t.after(() => s.close()); await s.organization("org0");
  await s.enqueue("org0", "investigate", {}, "long-inference");
  const first = await s.lease("org0");
  await s.renewJob(first, 360000);
  assert.equal(await s.lease("org0"), null);
  await s.query("UPDATE jobs SET leased_until=0 WHERE id=$1", [first.id]);
  const second = await s.lease("org0");
  assert.notEqual(first.lease_token, second.lease_token);
  await assert.rejects(s.finishJob(first.id, { invalid: true }, first.lease_token), (e) => e.code === "JOB_LEASE_LOST");
  await s.failJob(first, new Error("stale error"));
  assert.equal((await s.query("SELECT state FROM jobs WHERE id=$1", [second.id])).rows[0].state, "running");
  await s.finishJob(second.id, { ok: true }, second.lease_token);
});
