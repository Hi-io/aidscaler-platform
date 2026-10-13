import test from "node:test";
import assert from "node:assert/strict";
import { repairTiming } from "../evaluation/blocked-repair.mjs";
const base = { changeAccessibleAt: 1000, alternativeAccessibleAt: 1500, repairStartAt: 1600, draftAt: 2000,
  authorizedAt: 2500, issuedAt: 2600, rerouteReceivedAt: 2800, horizonAt: 10000,
  operationId: "original", owner: "org0", need: "water", loaded: 300,
  sourceOperation: { id: "original", org: "org0", need: "water", type: "delivery", state: "completed",
    received: 300, times: { arrived: 3500, received: 4500, service: 4500 } } };
test("repair timing starts at actual received change and distinguishes draft, authority, order and same-cargo service", () => {
  const r = repairTiming(base);
  assert.equal(r.draftObservedMs, 1000);
  assert.equal(r.firstUsefulServiceObservedMs, 3500);
  assert.equal(r.sufficientServiceObservedMs, 3500);
  assert.equal(r.originalOperationServiceAt, 4500);
  assert.equal(r.sufficientRightCensored, false);
  assert.equal(r.rerouteReceivedAt, 2800);
});
test("failed repair keeps the same horizon censor rather than reporting a zero-minute successful stage", () => {
  const r = repairTiming({ ...base, draftAt: null, authorizedAt: null, issuedAt: null, rerouteReceivedAt: null, sourceOperation: null });
  assert.equal(r.draftAt, null);
  assert.equal(r.draftRightCensored, true);
  assert.equal(r.serviceRightCensored, true);
  assert.equal(r.draftObservedMs, 9000);
  assert.equal(r.sufficientServiceObservedMs, 9000);
  assert.equal(repairTiming({ ...base, changeAccessibleAt: null }).sufficientServiceObservedMs, null);
});
test("arrival, wrong operation/destination/owner and historical service never restore the original cargo", () => {
  for (const change of [{ id: "different" }, { org: "org1" }, { need: "other" }, { received: null },
    { state: "arrived", times: { arrived: 3500 } }, { times: { service: 500 } }]) {
    const r = repairTiming({ ...base, sourceOperation: { ...base.sourceOperation, ...change } });
    assert.equal(r.originalCargoRecoveredAt, null);
    assert.equal(r.sufficientRightCensored, true);
    assert.equal(r.sufficientServiceObservedMs, 9000);
  }
});
test("actual partial receipt is useful but does not become sufficient merely because 300 L were authorized", () => {
  const r = repairTiming({ ...base, sourceOperation: { ...base.sourceOperation, quantity: 300, received: 120 } });
  assert.equal(r.originalOperationReceived, 120);
  assert.equal(r.originalOperationServiceAt, 4500);
  assert.equal(r.originalCargoRecoveredAt, null);
  assert.equal(r.serviceRightCensored, false);
  assert.equal(r.sufficientRightCensored, true);
});
