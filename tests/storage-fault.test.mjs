import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";

test("DB write outage rolls back entity, audit, job and idempotency together; retry commits only once", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.command("org0", "prior-success", {}, (tx) =>
    tx.put("org0", "claim", "prior", { state: "pending" }, 0),
  );
  let fail = true,
    callbacks = 0;
  const command = () =>
    store.command("org0", "atomic-response", { quantity: 100 }, async (tx) => {
      callbacks++;
      const result = await tx.put(
        "org0",
        "proposal",
        "p",
        { state: "awaiting_review" },
        0,
      );
      await tx.enqueue(
        "org0",
        "review_notification",
        { proposal: "p" },
        "review-p",
      );
      await tx.audit("org0", "operator", "proposal.created", "p", {
        quantity: 100,
      });
      const query = tx.query.bind(tx);
      tx.query = (sql, args) => {
        if (fail && sql.startsWith("UPDATE idempotency SET result=")) {
          const error = new Error(
            "Injected DB write unavailable at final command receipt",
          );
          error.code = "08006";
          throw error;
        }
        return query(sql, args);
      };
      return result;
    });
  await assert.rejects(command(), { code: "08006" });
  assert.equal(await store.get("org0", "proposal", "p", false), null);
  for (const [sql, args] of [
    ["SELECT COUNT(*)::int AS n FROM jobs WHERE id=$1", ["review-p"]],
    ["SELECT COUNT(*)::int AS n FROM audit WHERE entity=$1", ["p"]],
    [
      "SELECT COUNT(*)::int AS n FROM idempotency WHERE key=$1",
      ["atomic-response"],
    ],
  ])
    assert.equal((await store.query(sql, args)).rows[0].n, 0);
  assert.equal((await store.get("org0", "claim", "prior")).state, "pending");
  fail = false;
  const committed = await command(),
    duplicate = await command();
  assert.deepEqual(duplicate, committed);
  assert.equal(callbacks, 2);
  assert.equal(
    (
      await store.query(
        "SELECT COUNT(*)::int AS n FROM jobs WHERE id='review-p'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await store.query("SELECT COUNT(*)::int AS n FROM audit WHERE entity='p'"))
      .rows[0].n,
    1,
  );
  assert.equal(
    (
      await store.query(
        "SELECT COUNT(*)::int AS n FROM idempotency WHERE key='atomic-response'",
      )
    ).rows[0].n,
    1,
  );
});
