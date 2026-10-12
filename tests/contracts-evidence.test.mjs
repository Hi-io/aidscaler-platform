import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { actionSchema } from "../src/contracts.mjs";
import { Finance } from "../src/finance.mjs";
test("a source receipt is citable but a model cannot certify a claim as confirmed", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0", "Test");
  const d = new Domain(s, { peers: [] });
  await s.put(
    "org0",
    "verification",
    "inspection-1",
    { state: "completed", result: { safe: true } },
    0,
  );
  const agent = { id: "agent", org: "org0", role: "agent" };
  await assert.rejects(
    () =>
      d.createClaim(
        agent,
        {
          text: "Verified safe",
          state: "confirmed",
          references: ["inspection-1"],
        },
        "bad-confirm",
      ),
    /certify/,
  );
  assert.equal(
    (
      await d.createClaim(
        agent,
        {
          text: "A completed inspection reports safety",
          state: "observed",
          references: ["inspection-1"],
        },
        "evidence-observation",
      )
    ).state,
    "observed",
  );
});
test("offline report retries use the original client ID even when transport request IDs change", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0", "Test");
  const d = new Domain(s, {}),
    actor = { id: "field", org: "org0", role: "field" },
    input = {
      clientId: "device-report-001",
      text: "Road blocked",
      observedAt: 1,
      kind: "road",
    };
  const a = await d.report(actor, input, "http-1"),
    b = await d.report(actor, input, "http-2");
  assert.equal(a.id, b.id);
  assert.equal((await s.list("org0", "report")).length, 1);
  await assert.rejects(
    () => d.report(actor, { ...input, text: "Changed report" }, "http-3"),
    /same key/,
  );
});
test("physical action contracts match simulator parameter names rather than plausible guesses", () => {
  for (const [type, params] of [
    ["repair", { edge: "road" }],
    ["evacuate", { from: "b1", to: "b2", vehicle: "v", quantity: 2 }],
    ["purchase", { type: "water", quantity: 10, price: 1, leadMs: 5000 }],
    ["cancel", { id: "op" }],
    ["coverage", {}],
    [
      "record_outcome",
      { summary: "Received", conditions: [], references: ["op"] },
    ],
  ])
    assert.equal(
      actionSchema.parse({ type, params, owner: "org0" }).type,
      type,
    );
  assert.throws(() =>
    actionSchema.parse({
      type: "evacuate",
      owner: "org0",
      params: { need: "n", shelter: "b", vehicle: "v", quantity: 2 },
    }),
  );
});
test("a settled payment cannot be refunded after its pooled funds are committed", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0", "Test");
  const f = new Finance(s, { secret: "test" }),
    d = await f.checkout("org0", { amountCents: 500 });
  let e = { org: "org0", id: d.id, eventId: "settle", state: "settled" };
  await f.webhook(e, f.signature(e));
  await f.allocate(
    { org: "org0", id: "finance", role: "finance" },
    { amountCents: 400, reason: "Procurement" },
    "funds",
  );
  e = { ...e, eventId: "refund", state: "refunded" };
  await assert.rejects(() => f.webhook(e, f.signature(e)), /released/);
  assert.equal((await f.summary("org0")).availableCents, 100);
});
