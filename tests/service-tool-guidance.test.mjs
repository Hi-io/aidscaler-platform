import test from "node:test";
import assert from "node:assert/strict";
import { planningToolGuidance, researchTools } from "../src/investigation.mjs";
const diagnosis = (reason, extra = {}) => ({ owner: "org1", resource: "crew", evidence: "received-offer", reason,
  receivedAvailable: 2, qualifiedAvailable: 0, requiredSkills: ["shelter_support"], vehicleIds: ["truck"], ...extra });
const result = (reason, extra = {}) => ({ building: "site", readyToDraft: false, missing: [{ type: "staff", quantity: 1,
  diagnostics: [diagnosis(reason, extra)] }], pending: [] });
test("received stock without transport guides a scoped fleet check rather than repeating inventory or foreign verification", () => {
  const foreign = planningToolGuidance("plan_service", result("transport"));
  assert.equal(foreign.nextTool, "lookup");
  assert.deepEqual(foreign.nextArguments, { target: "capabilities", org: "org1" });
  assert.equal(foreign.blockingDependency.reason, "transport");
  const own = planningToolGuidance("plan_service", result("transport", { owner: "org0", resource: "crew", evidence: "crew" }));
  assert.deepEqual(own.nextArguments, { kind: "vehicle", ids: ["truck"], detail: true });
});
test("qualification and compatibility retain the exact received evidence instead of equating headcount or quantity with feasibility", () => {
  for (const reason of ["qualification", "compatibility"]) {
    const g = planningToolGuidance("plan_service", result(reason));
    assert.deepEqual(g.nextArguments, { kind: "peer_offer", ids: ["received-offer"], detail: true });
    assert.equal(g.blockingDependency.owner, "org1");
    assert.equal(g.blockingDependency.reason, reason);
  }
});
test("known depleted or expired capacity refreshes only an identified permitted owner and never invents a reversible wait", () => {
  for (const reason of ["stock", "expiry"]) {
    const g = planningToolGuidance("plan_service", result(reason));
    assert.equal(g.nextTool, "lookup");
    assert.deepEqual(g.nextArguments, { target: "capabilities", org: "org1" });
    assert.equal(g.waitFor, undefined);
  }
});
test("only the same site's active workflow can yield a no-duplicate-work wait, and review is not physical receipt", () => {
  for (const state of ["awaiting_review", "executing"]) {
    const g = planningToolGuidance("plan_service", { ...result("hold"), waitReceipt: true,
      pending: [{ building: "site", proposal: "real-owner-workflow", state }] });
    assert.equal(g.nextTool, null);
    assert.equal(g.waitFor, state === "awaiting_review" ? "owner_review_of_this_site" : "current_received_physical_work");
    assert.equal(g.pendingReferences[0].proposal, "real-owner-workflow");
  }
  for (const pending of [[{ building: "other", proposal: "unrelated", state: "executing" }],
    [{ building: "site", proposal: "terminal", state: "failed" }], [{ building: "site", state: "executing" }], []]) {
    const g = planningToolGuidance("plan_service", { ...result("hold"), waitReceipt: true, pending });
    assert.notEqual(g.nextTool, null);
    assert.equal(g.waitFor, undefined);
  }
});
test("a received provision requires this site's current status while unrelated receipt hints cannot refresh another building", () => {
  const g = planningToolGuidance("plan_service", { ...result("stock"), waitReceipt: true,
    refreshRequest: { target: "facility", id: "site", afterReceiptAt: 1000 }, pending: [{ type: "current_facility_status" }] });
  assert.deepEqual(g.nextArguments, { target: "facility", id: "site" });
  const unrelated = planningToolGuidance("plan_service", { ...result("stock"), refreshRequest: { target: "facility", id: "another" } });
  assert.notEqual(unrelated.nextArguments.id, "another");
});
test("absence of received owner diagnostics remains an honest bounded discovery and never an invented org or fake tool", () => {
  const g = planningToolGuidance("plan_service", { building: "site", missing: [{ type: "sanitation", quantity: 1 }] });
  assert.deepEqual(g.nextArguments, { kind: "peer_offer", type: "sanitation" });
  assert.ok(researchTools.some(t => t.function.name === g.nextTool));
  const unsafe = planningToolGuidance("plan_service", { building: "site", missing: [{ type: "current_safety_assessment", quantity: 1 }] });
  assert.deepEqual(unsafe.nextArguments, { building: "site" });
  assert.equal(unsafe.nextTool, "plan_assessment");
});
