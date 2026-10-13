import test from "node:test";
import assert from "node:assert/strict";
import { createUnloadingControls } from "../ui/unloading.mjs";

test("recent completed receipts cannot hide an older pending unloading request behind the twelve-card limit", async () => {
  const receipt = i => ({ receiverOrg: "org0", state: "completed", building: "completed-" + i,
    operation: "old-cargo-" + i, received: 300, deliveryQuantity: 300, staffQuantity: 1, requiredSkills: [], workMs: 1000 }),
    pending = { ...receipt(24), state: "waiting_for_crew", building: "urgent-original", operation: "pending-cargo", received: 0 },
    rows = [...Array.from({ length: 24 }, (_, i) => receipt(i)), pending],
    controls = createUnloadingControls({ api: async () => rows, escape: String,
      state: { user: { org: "org0", role: "analyst" } }, toast: () => {}, render: async () => {} });
  const html = await controls.view();
  assert.match(html, /1 pending · 25 received requests/);
  assert.ok(html.indexOf("urgent-original") < html.indexOf("completed-0"));
  assert.match(html, /0 \/ 300 received · waiting for crew/);
  assert.equal((html.match(/<details /g) ?? []).length, 12);
  assert.match(html, /Showing 12 of 25/); assert.match(html, /Show 12 more requests/);
});
