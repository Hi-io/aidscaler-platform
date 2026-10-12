import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { Intake } from "../src/intake.mjs";
import { Ingestion } from "../src/ingestion.mjs";
test("anonymous media reports await moderation without generating model work or claiming dispatch; retries remain one report", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  const d = new Domain(s, {});
  d.intake = new Intake(s, { org: "org0" });
  await s.put(
    "org0",
    "media",
    "photo",
    { mime: "image/png", moderationRequired: true },
    0,
  );
  const input = {
      clientId: "anonymous-one",
      text: "Image awaiting review",
      observedAt: 1,
      references: ["photo"],
    },
    actor = { org: "org0", id: "community-public", role: "field" };
  const r = await d.report(actor, input, "http1");
  assert.equal(r.state, "pending_moderation");
  assert.equal((await d.report(actor, input, "http2")).id, r.id);
  assert.equal((await s.list("org0", "signal")).length, 0);
  assert.equal((await s.list("org0", "intake")).length, 0);
  await s.transaction(async (tx) => {
    const accepted = await tx.put(
      "org0",
      "report",
      r.id,
      { ...r, state: "observed" },
      r.version,
    );
    await d.stageReport(tx, "org0", accepted);
  });
  assert.deepEqual(
    (await s.get("org0", "signal", "report_" + r.id)).originalReferences,
    [r.id, "photo"],
  );
  assert.equal(
    (await s.get("org0", "signal", "report_" + r.id)).physicalConfirmation,
    false,
  );
  assert.equal((await s.list("org0", "intake")).length, 1);
});
test("a locally staged or shared entity can receive its first direct source snapshot without hashing undefined", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  await s.put(
    "org0",
    "need",
    "n",
    { owner: "org1", type: "water", quantity: 500 },
    0,
  );
  await s.put("org0", "context", "operational", { observedAt: 0 }, 0);
  const connector = {
    state: async () => ({
      organization: { id: "org0" },
      known: {
        needs: { n: { id: "n", type: "water", quantity: 600, version: 1 } },
      },
      operations: [],
    }),
    feed: async () => ({ posts: [], nextCursor: null }),
    inbox: async () => ({ posts: [] }),
  };
  await new Ingestion(s, connector, { org: "org0" }).sync();
  assert.equal((await s.get("org0", "need", "n")).sourceSnapshot.quantity, 600);
  assert.equal(
    (await s.get("org0", "context", "operational")).snapshot.organization.id,
    "org0",
  );
});
