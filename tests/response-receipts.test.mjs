import test from "node:test";
import assert from "node:assert/strict";
import { effectiveNeed, recordResponseReceipt } from "../src/response-receipts.mjs";

const proposal = {
  id: "response-a", actions: [{ type: "dispatch", owner: "org1",
    params: { need: "water-a", resource: "tank-a", vehicle: "truck-a", quantity: 100 } }],
};
const physical = (extra = {}) => ({
  id: "operation-1", type: "delivery", org: "org1", need: "water-a",
  resource: "tank-a", vehicle: "truck-a", quantity: 100, received: 100,
  state: "completed", times: { received: 1000, service: 1000 },
  observedAt: 1100, confirmedBySource: true, ...extra,
});
function memory() {
  const rows = new Map(), key = (org, kind, id) => JSON.stringify([org, kind, id]);
  return {
    get: async (org, kind, id) => rows.get(key(org, kind, id)) ?? null,
    upsert: async (org, kind, id, data) => rows.set(key(org, kind, id), { ...data, id }),
    list: async (org, kind) => [...rows.entries()].filter(([k]) => {
      const [o, t] = JSON.parse(k); return o === org && t === kind;
    }).map(([, v]) => v),
  };
}

test("an authenticated matching physical receipt closes a stale need exactly once", async () => {
  const tx = memory(), need = { id: "water-a", quantity: 100, served: 0, at: 0 };
  await recordResponseReceipt(tx, "org0", "org1", proposal, 0, "completed", physical());
  await recordResponseReceipt(tx, "org0", "org1", proposal, 0, "completed", physical({ observedAt: 1200 }));
  const operations = await tx.list("org0", "operation");
  assert.equal(operations.length, 1);
  assert.equal(operations[0].sourceId, "operation-1");
  assert.equal(operations[0].proposalId, "response-a");
  assert.equal(operations[0].step, 0);
  assert.equal(effectiveNeed(need, operations).served, 100);
  assert.equal(need.served, 0);
  assert.equal(effectiveNeed({ ...need, served: 100, at: 1000 }, operations).served, 100);
  assert.equal(effectiveNeed({ ...need, served: 100, at: 1500 }, operations).served, 100);
});

test("a boolean, arrival, different cargo, owner or action cannot become service", async () => {
  const tx = memory();
  for (const source of [
    { confirmedBySource: true }, physical({ state: "arrived", times: {} }),
    physical({ need: "different-need" }), physical({ resource: "different-tank" }),
    physical({ vehicle: "different-truck" }), physical({ org: "org2" }),
    physical({ quantity: 101 }), physical({ received: 101 }),
    physical({ times: { service: 1200 } }),
  ]) await assert.rejects(() => recordResponseReceipt(tx, "org0", "org1", proposal, 0,
    "completed", source), (error) => error.code === "PEER_RECEIPT");
  assert.equal((await tx.list("org0", "operation")).length, 0);
});

test("late progress never resurrects already consumed cargo or overwrites newer evidence", async () => {
  const tx = memory();
  await recordResponseReceipt(tx, "org0", "org1", proposal, 0, "completed", physical());
  const stale = await recordResponseReceipt(tx, "org0", "org1", proposal, 0, "in_transit",
    physical({ state: "dispatched", received: 0, times: {}, observedAt: 1500 }));
  assert.equal(stale.stale, true);
  const old = await recordResponseReceipt(tx, "org0", "org1", proposal, 0, "completed",
    physical({ observedAt: 1050 }));
  assert.equal(old.stale, true);
  assert.equal((await tx.list("org0", "operation"))[0].received, 100);
  await assert.rejects(() => recordResponseReceipt(tx, "org0", "org1",
    { ...proposal, id: "response-b" }, 0, "completed", physical({ observedAt: 1600 })),
    (error) => error.code === "PEER_RECEIPT");
});

test("source snapshots reconcile owner receipts by physical time and identity", () => {
  const need = { id: "water-a", served: 150, at: 1500, quantity: 300 },
    records = [
      physical({ owner: "org1", sourceId: "operation-1" }),
      physical({ id: "peer:org1:operation-1", owner: "org1", sourceId: "operation-1" }),
      physical({ id: "operation-2", org: "org0", received: 50, times: { service: 2000 } }),
      physical({ id: "operation-3", received: 70, confirmedBySource: false, times: { service: 2500 } }),
      physical({ id: "operation-4", received: 20, state: "arrived", times: { service: 2500 } }),
      physical({ id: "operation-5", received: 30, need: "other", times: { service: 2500 } }),
    ];
  assert.equal(effectiveNeed(need, records).served, 200);
  assert.equal(effectiveNeed({ ...need, sourceSnapshot: { served: 200, at: 2200 } }, records).served, 200);
  assert.equal(effectiveNeed({ ...need, at: undefined }, records).served, 150);
});

test("partial source service counts the received quantity, never the planned cargo", async () => {
  const tx = memory();
  await recordResponseReceipt(tx, "org0", "org1", proposal, 0, "in_transit",
    physical({ state: "dispatched", received: 0, times: {}, observedAt: 500 }));
  assert.equal(effectiveNeed({ id: "water-a", served: 0, at: 0 }, await tx.list("org0", "operation")).served, 0);
  await recordResponseReceipt(tx, "org0", "org1", proposal, 0, "completed", physical({ received: 85 }));
  assert.equal(effectiveNeed({ id: "water-a", served: 0, at: 0 }, await tx.list("org0", "operation")).served, 85);
});

test("evacuation service requires the assigned pickup and actual receiving shelter", async () => {
  const tx = memory(), p = { id: "evac-response", actions: [{ type: "evacuate", owner: "org1",
    params: { from: "school-a", to: "shelter-a", vehicle: "bus-a", quantity: 20 } }] };
  await tx.upsert("org0", "need", "shelter-need", { building: "school-a", type: "shelter", served: 0, at: 0 });
  const source = physical({ type: "evacuation", need: "shelter-need", vehicle: "bus-a", building: "shelter-a",
    quantity: 20, received: 20 });
  await assert.rejects(() => recordResponseReceipt(tx, "org0", "org1", p, 0,
    "completed", { ...source, building: "another-shelter" }), (error) => error.code === "PEER_RECEIPT");
  await recordResponseReceipt(tx, "org0", "org1", p, 0, "completed", source);
  assert.equal(effectiveNeed(await tx.get("org0", "need", "shelter-need"), await tx.list("org0", "operation")).served, 20);
});

test("a facility provision receipt completes the cargo step without pretending a need was served", async () => {
  const tx = memory(), p = { id: "facility-supply", actions: [{ ...proposal.actions[0],
    params: { ...proposal.actions[0].params, need: undefined, building: "shelter-a", destination: "node-a" } }] };
  await recordResponseReceipt(tx, "org0", "org1", p, 0, "completed",
    physical({ need: null, building: "shelter-a", destination: "node-a", times: { received: 1000 } }));
  const operations = await tx.list("org0", "operation");
  assert.equal(operations[0].state, "completed");
  assert.equal(effectiveNeed({ id: "water-a", served: 0, at: 0 }, operations).served, 0);
});
