import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { Casework } from "../src/casework.mjs";
const actor = { org: "org0", id: "analyst", role: "analyst" };
async function setup(t) {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  for (const id of ["s1", "s2", "s3"])
    await s.put(
      "org0",
      "signal",
      id,
      { text: "Source " + id, state: "unverified" },
      0,
    );
  const d = new Domain(s, {});
  return { s, d, c: new Casework(s, d) };
}
test("reclassifying and splitting evidence preserves originals and demand, records history and invalidates only dependent future plans", async (t) => {
  const { s, c } = await setup(t);
  await s.put(
    "org0",
    "need",
    "n1",
    { type: "water", quantity: 600, served: 100 },
    0,
  );
  const original = await c.group(
    actor,
    {
      label: "Same shelter reports",
      members: ["s1", "s2", "s3"],
      reason: "Classified from their reported place",
    },
    "group1",
  );
  await s.put(
    "org0",
    "proposal",
    "p1",
    {
      state: "authorized",
      authorization: { by: "owner" },
      dependencies: [original.id],
      actions: [],
    },
    0,
  );
  const changed = await c.group(
    actor,
    {
      id: original.id,
      version: original.version,
      label: "Reports need separation",
      members: ["s1", "s2"],
      reason: "One report refers to another place",
    },
    "group2",
  );
  assert.equal(
    (await s.get("org0", "proposal", "p1")).state,
    "requires_review",
  );
  const restored = await c.restoreGrouping(
    actor,
    {
      id: changed.id,
      version: changed.version,
      historyVersion: original.version,
      reason: "Original grouping is useful for review",
    },
    "restore1",
  );
  assert.deepEqual(restored.members, original.members);
  await assert.rejects(
    () =>
      c.split(
        actor,
        {
          id: restored.id,
          version: restored.version,
          reason: "Incorrect partition",
          partitions: [
            { label: "First", members: ["s1"] },
            { label: "Other", members: ["s1", "s2"] },
          ],
        },
        "bad-split",
      ),
    /exactly once/,
  );
  const split = await c.split(
    actor,
    {
      id: restored.id,
      version: restored.version,
      reason: "These are two different incident locations",
      partitions: [
        { label: "First location", members: ["s1"] },
        { label: "Second location", members: ["s2", "s3"] },
      ],
    },
    "split1",
  );
  assert.equal(split.length, 2);
  assert.equal(
    (await s.get("org0", "evidence_group", original.id)).state,
    "split",
  );
  assert.equal((await s.get("org0", "need", "n1")).quantity, 600);
  assert.equal((await s.get("org0", "need", "n1")).served, 100);
  assert.equal((await s.get("org0", "signal", "s1")).version, 1);
});
test("a claim correction is human-owned, source-scoped and invalidates its old authorization while retaining the old evidence snapshot", async (t) => {
  const { s, d, c } = await setup(t);
  const claim = await d.createClaim(
    actor,
    { text: "Shelter seems empty", state: "inferred", references: ["s1"] },
    "claim1",
  );
  await s.put(
    "org0",
    "proposal",
    "p1",
    {
      state: "authorized",
      authorization: { by: "owner" },
      dependencies: [claim.id],
      actions: [],
    },
    0,
  );
  const input = {
    id: claim.id,
    version: claim.version,
    text: "Old video; current occupancy remains uncertain",
    state: "pending",
    references: ["s1", "s2"],
    reason: "Date and current source disagree",
  };
  await assert.rejects(
    () => c.correctClaim({ ...actor, role: "agent" }, input, "agent-correct"),
    /role/,
  );
  const after = await c.correctClaim(actor, input, "human-correct");
  assert.equal(after.state, "pending");
  assert.equal(
    (await s.get("org0", "claim_history", claim.id + "_1")).snapshot.text,
    claim.text,
  );
  assert.equal((await s.get("org0", "proposal", "p1")).authorization, null);
  await assert.rejects(
    () =>
      c.correctClaim(
        actor,
        { ...input, version: after.version, references: ["foreign"] },
        "foreign-correct",
      ),
    /accessible/,
  );
});
