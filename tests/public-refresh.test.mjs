import test from "node:test";
import assert from "node:assert/strict";
import { createPublicRefresh, updatePublicRegion } from "../ui/public-refresh.mjs";
import { icons } from "../ui/icons.mjs";

const initial = () => ({ updates: [], responseProgress: { receivedDeliveries: 0 }, finance: { receivedCents: 0 }, financeReview: null });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("public response and people navigation have visible glyphs", () => {
  assert.match(icons["arrow-down"], /<path/);
  assert.match(icons.users, /<circle/);
});

test("public polling refreshes only changed reviewed projections and remembers successful regions", async () => {
  const data = initial(), writes = [], boundaries = [];
  const refresh = createPublicRefresh({ initial: structuredClone(data), load: async () => data, onData: value => boundaries.push(value.sourceConnection), apply: async (_, changed) => { writes.push(changed); return changed; } });
  assert.equal(await refresh.poll(), false);
  data.updates.push({ id: "reviewed-one", title: "Water is on the way" });
  data.finance.receivedCents = 2500;
  data.sourceConnection = { state: "connected" };
  assert.equal(await refresh.poll(), true);
  assert.deepEqual(writes, [["updates", "finance"]]);
  assert.equal(await refresh.poll(), false);
  assert.equal(boundaries.length, 3, "source boundaries are checked even when public figures do not change");
});

test("slow reads remain single-flight and stopped or detached views never receive late responses", async () => {
  const waiting = deferred(); let reads = 0, writes = 0, active = true;
  const refresh = createPublicRefresh({ initial: initial(), current: () => active, load: () => { reads++; return waiting.promise; }, apply: () => { writes++; } });
  const first = refresh.poll();
  assert.equal(await refresh.poll(), false);
  assert.equal(reads, 1);
  active = false; waiting.resolve({ ...initial(), updates: [{ id: "new" }] });
  assert.equal(await first, false); assert.equal(writes, 0);
  active = true; refresh.stop();
  assert.equal(await refresh.poll(), false); assert.equal(reads, 1);
});

test("failed reads release the guard and skipped focused regions remain eligible for retry", async () => {
  let fail = true, skip = true; const calls = [];
  const data = { ...initial(), updates: [{ id: "new" }], financeReview: { approvedAt: 123 } };
  const refresh = createPublicRefresh({ initial: initial(), load: async () => { if (fail) throw new Error("Offline"); return data; }, apply: (_, keys) => { calls.push(keys); return skip ? ["financeReview"] : keys; } });
  await assert.rejects(refresh.poll(), /Offline/);
  fail = false; await refresh.poll(); skip = false; await refresh.poll();
  assert.deepEqual(calls, [["updates", "financeReview"], ["updates"]]);
  assert.equal(await refresh.poll(), false);
});

test("updating a public region preserves disclosures and never replaces an active region or unrelated form", () => {
  const summary = { textContent: "More supply types" };
  const details = () => ({ dataset: {}, open: false, querySelector: () => summary });
  const old = details(); old.open = true; let child = old, replacements = 0;
  const form = { value: "75", receipt: "Keep confirmation open" };
  const target = { ownerDocument: { activeElement: form }, contains: element => element === child, querySelectorAll: () => [child], set innerHTML(value) { replacements++; child = details(); this.markup = value; } };
  const root = { querySelector: selector => selector === "#public-response-progress" ? target : null };
  assert.equal(updatePublicRegion(root, "#public-response-progress", "Reviewed progress"), true);
  assert.equal(child.open, true); assert.equal(replacements, 1);
  assert.deepEqual(form, { value: "75", receipt: "Keep confirmation open" });
  target.ownerDocument.activeElement = child;
  assert.equal(updatePublicRegion(root, "#public-response-progress", "Later progress"), false);
  assert.equal(replacements, 1);
});
