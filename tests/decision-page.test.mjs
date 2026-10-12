import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
test("decision pages retain every pending item beyond the ordinary record-list cap, with priority and stable navigation", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  await s.organization("org1");
  await s.query(
    "INSERT INTO entities(org,kind,id,data,created_at,updated_at) SELECT 'org0','proposal','p'||i,jsonb_build_object('state','awaiting_review','priority',CASE WHEN i=2600 THEN 'urgent' ELSE 'normal' END,'title','Work '||i),i,i FROM generate_series(1,2600) AS i",
  );
  await s.put(
    "org0",
    "proposal",
    "old",
    { state: "completed", priority: "urgent" },
    0,
  );
  await s.put(
    "org1",
    "proposal",
    "foreign",
    { state: "awaiting_review", priority: "urgent" },
    0,
  );
  const first = await s.decisionPage("org0");
  assert.equal(first.total, 2600);
  assert.equal(first.rows[0].id, "p2600");
  assert.equal(first.rows.length, 12);
  const last = await s.decisionPage("org0", { offset: 2592 });
  assert.equal(last.rows.length, 8);
  assert.equal(last.total, 2600);
  assert.equal((await s.decisionPage("org0", { history: true })).total, 1);
  await assert.rejects(
    () => s.decisionPage("org0", { offset: NaN }),
    (e) => e.code === "PAGINATION",
  );
});
