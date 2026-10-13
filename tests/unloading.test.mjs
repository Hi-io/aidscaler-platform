import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { Investigator } from "../src/investigation.mjs";
import { ReplayProvider } from "../src/provider.mjs";
import { persistReceivedUnloadingRequests, unloadingPlan, unloadingCheckpoint, prepareUnloading, validateUnloadingAction } from "../src/unloading.mjs";
import { responseQueue } from "../src/response-policy.mjs";
import { validatePlan } from "../src/planning.mjs";
import { createHarness, scriptedReview, conventionalSharedProposal } from "../evaluation/harness.mjs";

const request = () => ({ id: "unload-1", operation: "aid-1", org: "org1", receiverOrg: "org0", building: "site", node: "b",
  state: "waiting_for_crew", version: 2, operationVersion: 3, targetVersion: 4, deliveryQuantity: 300, received: 0,
  staffQuantity: 1, requiredSkills: ["shelter_support"], workMs: 60000, observedAt: 1000, times: { arrived: 900 } });
async function fixture(t, { onsite = true } = {}) {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  const config = { org: "org0", peers: [], modelId: "unpaid-mechanism", maxCalls: 3 };
  await store.upsert("org0", "source", "simulator", { simulatedAt: 2000 });
  await store.upsert("org0", "context", "operational", { snapshot: { organization: { id: "org0" }, now: 2000,
    queries: [{ id: "policy", target: "policy", state: "ready", completedAt: 1000, result: { execution: {
      delivery: { loadMs: 1000, unloadMs: 1000, commandNominalLatencyMs: 1000 }, service: { setupMs: 1000 } } } }] } });
  await persistReceivedUnloadingRequests(store, "org0", { organization: { id: "org0" }, now: 2000, unloadingRequests: [request()] });
  await store.upsert("org0", "facility", "site", { ownerOrg: "org0", sourceVersion: 4, node: "b", use: "shelter" });
  await store.upsert("org0", "resource", "staff", { owner: "org0", type: "staff", node: onsite ? "b" : "a",
    quantity: 2, reserved: 0, floor: 0, qualifications: ["shelter_support"],
    staffCalendar: { version: 1, observedAt: 1000, epochAt: 0, shiftMs: 600000, restMs: 60000 } });
  await store.upsert("org0", "vehicle", "crew-van", { owner: "org0", node: "a", state: "idle", driverAvailable: true,
    capacity: 2, seats: 2, maxCargoKg: 150, volumeM3: 0.15, weightKg: 1000 });
  await store.upsert("org0", "context", "geography", { map: { nodes: [{ id: "a" }, { id: "b" }],
    roads: [{ id: "ab", from: "a", to: "b", open: true, lengthM: 100, speedMps: 10 }] } });
  return { store, config, domain: new Domain(store, config) };
}
const actor = { org: "org0", role: "analyst", id: "planner" };

test("received unloading versions cannot regress or grant another organization crew authority; missing snapshots preserve pending work", async t => {
  const f = await fixture(t), completed = { ...request(), version: 5, operationVersion: 6, state: "completed", received: 300, times: { received: 3000 } };
  await persistReceivedUnloadingRequests(f.store, "org0", { organization: { id: "org0" }, now: 4000, unloadingRequests: [completed] });
  await persistReceivedUnloadingRequests(f.store, "org0", { organization: { id: "org0" }, now: 5000, unloadingRequests: [request()] });
  assert.equal((await f.store.get("org0", "unloading_request", "unload-1")).received, 300);
  await persistReceivedUnloadingRequests(f.store, "org0", { organization: { id: "org0" }, now: 6000 });
  assert.equal((await f.store.get("org0", "unloading_request", "unload-1")).state, "completed");
  await assert.rejects(persistReceivedUnloadingRequests(f.store, "org0", { organization: { id: "org0" }, unloadingRequests: [{ ...request(), receiverOrg: "org2", org: "org3" }] }), { code: "UNLOAD_OWNER" });
  await f.store.organization("org1");
  await persistReceivedUnloadingRequests(f.store, "org1", { organization: { id: "org1" }, now: 2000, unloadingRequests: [request()] });
  const donorPlan = await unloadingPlan(f.store, "org1", "aid-1");
  assert.equal(donorPlan.readyToDraft, false); assert.equal(donorPlan.missing[0].owner, "org0");
});

test("a new simulator run cannot reuse an old deterministic cargo ID or its reviewed unloading checkpoint", async t => {
  const f = await fixture(t);
  await f.store.upsert("org0", "source", "simulator", { runId: "run-A" });
  await persistReceivedUnloadingRequests(f.store, "org0", { organization: { id: "org0" }, runId: "run-A", now: 2000, unloadingRequests: [request()] });
  const old = await unloadingPlan(f.store, "org0", "aid-1"); assert.equal(old.readyToDraft, true);
  await f.store.upsert("org0", "source", "simulator", { runId: "run-B" });
  assert.equal((await unloadingPlan(f.store, "org0", "aid-1")).readyToDraft, false);
  await persistReceivedUnloadingRequests(f.store, "org0", { organization: { id: "org0" }, runId: "run-B", now: 2000,
    unloadingRequests: [{ ...request(), version: 1, operationVersion: 1 }] });
  assert.equal((await f.store.get("org0", "unloading_request", "unload-1")).sourceRunId, "run-B");
  await assert.rejects(prepareUnloading(f.domain, f.store, actor, { operation: "aid-1", checkpoint: unloadingCheckpoint(old) }, "old-run-review"), { code: "UNLOAD_CHANGED" });
  await assert.rejects(persistReceivedUnloadingRequests(f.store, "org0", { organization: { id: "org0" }, now: 3000,
    unloadingRequests: [request()] }), { code: "UNLOAD_RUN_SCOPE" });
});

test("onsite plan binds exact original quantities and versions, remains a reviewable draft, and material changes invalidate preparation", async t => {
  const f = await fixture(t), plan = await unloadingPlan(f.store, "org0", "aid-1");
  assert.equal(plan.stage, "unload"); assert.equal(plan.readyToDraft, true);
  assert.deepEqual(plan.actions[0].params, { operation: "aid-1", staff: "staff", quantity: 1, targetVersion: 4,
    requestVersion: 2, sourceVersion: 3, deliveryQuantity: 300 });
  await f.store.upsert("org0", "resource", "staff", { reserved: 1 });
  await assert.rejects(prepareUnloading(f.domain, f.store, actor, { operation: "aid-1", checkpoint: unloadingCheckpoint(plan) }, "stale"), { code: "UNLOAD_CHANGED" });
  const fresh = await unloadingPlan(f.store, "org0", "aid-1"), p = await prepareUnloading(f.domain, f.store, actor,
    { operation: "aid-1", checkpoint: unloadingCheckpoint(fresh) }, "draft");
  assert.equal(p.state, "awaiting_review"); assert.equal(p.authorization, null); assert.equal(p.unloadingOperation, "aid-1");
  assert.equal((await f.store.list("org0", "operation")).length, 0);
  assert.equal((await unloadingPlan(f.store, "org0", "aid-1")).waitReceipt, true);
  assert.equal((await responseQueue(f.store, "org0")).planningHolds[0].quantity, 1);
});

test("unloading rejects stale cargo, offsite/foreign or unqualified crew and work extending through rest", async t => {
  const f = await fixture(t), plan = await unloadingPlan(f.store, "org0", "aid-1"), action = plan.actions[0];
  for (const field of ["requestVersion", "sourceVersion", "targetVersion", "deliveryQuantity", "quantity"])
    await assert.rejects(validateUnloadingAction(f.store, "org0", { ...action, params: { ...action.params, [field]: action.params[field] + 1 } }), { code: "UNLOAD_CHANGED" });
  await f.store.upsert("org0", "resource", "staff", { owner: "org1" });
  await assert.rejects(validateUnloadingAction(f.store, "org0", action), { code: "UNLOAD_CREW_LOCATION" });
  await f.store.upsert("org0", "resource", "staff", { owner: "org0", node: "a" });
  await assert.rejects(validateUnloadingAction(f.store, "org0", action), { code: "UNLOAD_CREW_LOCATION" });
  await f.store.upsert("org0", "resource", "staff", { node: "b", qualifications: [] });
  await assert.rejects(validateUnloadingAction(f.store, "org0", action), { code: "UNLOAD_CREW_CAPACITY" });
  await f.store.upsert("org0", "resource", "staff", { qualifications: ["shelter_support"], condition: "expired" });
  await assert.rejects(validateUnloadingAction(f.store, "org0", action), { code: "SUPPLY_EXPIRED" });
  assert.equal((await unloadingPlan(f.store, "org0", "aid-1")).readyToDraft, false);
  await f.store.upsert("org0", "resource", "staff", { condition: "usable",
    staffCalendar: { version: 2, observedAt: 1000, epochAt: 0, shiftMs: 20000, restMs: 60000 } });
  await assert.rejects(validateUnloadingAction(f.store, "org0", action), { code: "STAFF_CALENDAR" });
  assert.equal((await unloadingPlan(f.store, "org0", "aid-1")).readyToDraft, false);
});

test("qualified crew transport observes passenger/mass capacity and holds; it never dispatches original aid or starts unloading", async t => {
  const f = await fixture(t, { onsite: false }), plan = await unloadingPlan(f.store, "org0", "aid-1");
  assert.equal(plan.readyToDraft, true); assert.equal(plan.stage, "transport_crew");
  assert.deepEqual(plan.actions.map(a => a.type), ["dispatch"]); assert.equal(plan.actions[0].params.resource, "staff");
  assert.equal(plan.actions[0].params.need, undefined); assert.equal(plan.actions[0].params.destination, "b");
  await validatePlan(f.store, "org0", { actions: plan.actions });
  await f.store.upsert("org0", "vehicle", "crew-van", { seats: 0 });
  assert.equal((await unloadingPlan(f.store, "org0", "aid-1")).readyToDraft, false);
  await f.store.upsert("org0", "vehicle", "crew-van", { seats: 2, maxCargoKg: 50 });
  assert.equal((await unloadingPlan(f.store, "org0", "aid-1")).readyToDraft, false);
});

test("unloading prospective crew holds release after source reservation or rejection without reserving original aid twice", async t => {
  const f = await fixture(t), plan = await unloadingPlan(f.store, "org0", "aid-1"), p = await prepareUnloading(f.domain, f.store, actor,
    { operation: "aid-1", checkpoint: unloadingCheckpoint(plan) }, "hold");
  assert.equal((await responseQueue(f.store, "org0")).planningHolds[0].quantity, 1);
  await persistReceivedUnloadingRequests(f.store, "org0", { organization: { id: "org0" }, now: 3000,
    unloadingRequests: [{ ...request(), version: 3, state: "working", staff: "staff", quantity: 1 }] });
  assert.equal((await responseQueue(f.store, "org0")).planningHolds[0].quantity, 0);
  await f.store.upsert("org0", "proposal", p.id, { state: "rejected" });
  assert.equal((await responseQueue(f.store, "org0")).planningHolds.length, 0);
});

test("the model tool prepares the same sourced continuation and never receives authority or a physical receipt from its draft", async t => {
  const f = await fixture(t), message = (name,args) => ({ role: "assistant", tool_calls: [{ id: name, type: "function", function: { name, arguments: JSON.stringify(args) } }] }),
    provider = new ReplayProvider([message("plan_unloading", { operation: "aid-1" }), message("prepare_unloading",
      { title: "Unload the arrived cargo", rationale: "Received receiver request and qualified onsite crew", benefit: "Finish the same delivery after human review" })]);
  let physical = 0;
  const investigator = new Investigator({ ...f, provider, connector: { startModel: async () => ({ id: "fixture" }),
    finishModel: async () => {}, state: async () => ({}), action: async () => { physical++; throw Error("No automatic crew action"); } } });
  const activity = await investigator.run({}, "unload-tools");
  assert.equal(activity.state, "ready", JSON.stringify(activity.steps));
  const p = await f.store.get("org0", "proposal", activity.proposalId);
  assert.equal(p.state, "awaiting_review"); assert.equal(p.actions[0].type, "unload"); assert.equal(physical, 0);
});

test("fleet backpressure can recover only one additional own arrived cargo and cannot reuse its vehicle before an actual idle receipt", async t => {
  const f = await fixture(t, { onsite: false });
  await f.store.upsert("org0", "vehicle", "crew-van", { state: "arrived", operation: "extra-aid", node: "b" });
  await f.store.upsert("org0", "proposal", "occupied", { state: "executing", actions: [{ type: "dispatch", owner: "org0",
    dependsOn: [], params: { resource: "water", vehicle: "crew-van", quantity: 300, need: "need" } }],
    executionResults: [{ index: 0, result: { id: "extra-aid" } }] });
  await f.store.upsert("org0", "operation", "extra-aid", { org: "org0", owner: "org0", type: "delivery", state: "waiting_to_unload",
    building: "site", vehicle: "crew-van", resourceType: "water", received: 0, need: "need", quantity: 300, confirmedBySource: true,
    sourceSnapshot: { version: 8 } });
  await f.store.upsert("org0", "need", "need", { type: "water", building: "site", quantity: 600, served: 0 });
  await persistReceivedUnloadingRequests(f.store, "org0", { organization: { id: "org0" }, now: 2000,
    unloadingRequests: [{ ...request(), id: "extra-request", operation: "extra-aid", org: "org0" }] });
  const plan = await unloadingPlan(f.store, "org0", "aid-1");
  assert.equal(plan.stage, "recover_crew_vehicle"); assert.equal(plan.actions.length, 1);
  assert.deepEqual(plan.actions[0], { type: "cancel", owner: "org0", dependsOn: [], params: { id: "extra-aid" } });
  assert.notEqual(plan.actions[0].params.id, plan.operation);
  const p = await prepareUnloading(f.domain, f.store, actor, { operation: "aid-1", checkpoint: unloadingCheckpoint(plan) }, "recover");
  await f.store.upsert("org0", "proposal", p.id, { state: "completed" });
  await f.store.upsert("org0", "operation", "extra-aid", { state: "returning" });
  await f.store.upsert("org0", "vehicle", "crew-van", { state: "en_route" });
  assert.equal((await unloadingPlan(f.store, "org0", "aid-1")).readyToDraft, false);
  await f.store.upsert("org0", "operation", "extra-aid", { state: "cancelled" });
  await f.store.upsert("org0", "vehicle", "crew-van", { state: "idle", node: "a", operation: null });
  assert.equal((await unloadingPlan(f.store, "org0", "aid-1")).stage, "transport_crew");
  await f.store.upsert("org0", "vehicle", "crew-van", { state: "en_route" });
  await f.store.upsert("org0", "operation", "extra-aid", { state: "waiting_to_unload", owner: "org1", org: "org1" });
  assert.equal((await unloadingPlan(f.store, "org0", "aid-1")).readyToDraft, false, "No foreign cargo cancellation can be drafted");
});

test("HTTP S14 conventional receiver transports qualified crew, independently approves finite unload and receives the original donor cargo exactly once", { timeout: 90000 }, async t => {
  const h = await createHarness({ scenario: "S14", seed: "platform-unloading-real", organizations: 2,
    config: { loadMs: 1000, unloadMs: 2000, setupMs: 1000, reviewMs: 1000, healthReports: false, recurringNeeds: false } });
  t.after(() => h.close()); const w = h.lab.world, receiver = h.apps[0], donor = h.apps[1];
  for (const app of h.apps) {
    for (const target of ["inventory", "vehicles", "roads", "map", "policy"])
      await app.connector.action("query", { target }, `unload-bootstrap-${app.config.org}-${target}`);
    await app.ingestion.sync({ sources: false });
  }
  const map = (await receiver.store.get("org0", "context", "geography")).map,
    site = map.places.find(p => p.use === "shelter");
  await receiver.connector.action("query", { target: "facility", id: site.id }, "receiver-site");
  await receiver.ingestion.sync({ sources: false });
  const aid = await donor.connector.action("dispatch", { vehicle: "v-org1-0", resource: "r-org1-water", need: "need-water-main", quantity: 300 }, "donor-original-aid", { human: true });
  assert.equal(h.advanceUntil(() => w.actorView("org0").unloadingRequests.some(r => r.operation === aid.id)), true);
  await receiver.ingestion.sync({ sources: false }); await donor.ingestion.sync({ sources: false });
  const original = w.state.operations.find(o => o.id === aid.id);
  assert.equal(original.state, "waiting_to_unload"); assert.equal(original.received ?? 0, 0);
  assert.equal((await unloadingPlan(donor.store, "org1", aid.id)).readyToDraft, false);
  const arrivedRequest = (await receiver.store.list("org0", "unloading_request"))[0];
  await receiver.connector.action("verify", { target: "building", id: arrivedRequest.building, method: "clarification" }, "receive-current-unloading-site");
  await receiver.ingestion.sync({ sources: false });
  const readyCrew = await unloadingPlan(receiver.store, "org0", aid.id);
  assert.equal(readyCrew.readyToDraft, true, JSON.stringify({ readyCrew, receivedSite: await receiver.store.get("org0", "facility", arrivedRequest.building, false) }));
  const crewDraft = await conventionalSharedProposal(receiver, "receiver-crew-trip"), trip = await receiver.store.get("org0", "proposal", crewDraft.proposalId);
  assert.equal(trip.actions[0].type, "dispatch"); assert.equal(trip.actions[0].params.resource, "r-org0-staff");
  assert.equal(await scriptedReview(receiver, trip), true); await receiver.worker.execute(trip.id);
  const crewOp = w.state.operations.find(o => o.org === "org0" && o.resourceType === "staff");
  assert.equal(h.advanceUntil(() => w.actorView("org0").operations.find(o => o.id === crewOp.id)?.state === "completed"), true);
  await receiver.ingestion.sync({ sources: false }); await receiver.worker.execute(trip.id);
  const plan = await unloadingPlan(receiver.store, "org0", aid.id);
  assert.equal(plan.stage, "unload", JSON.stringify(plan)); assert.equal(plan.readyToDraft, true);
  const draft = await conventionalSharedProposal(receiver, "receiver-finite-unload"), p = await receiver.store.get("org0", "proposal", draft.proposalId);
  await assert.rejects(receiver.worker.execute(p.id), { code: "AUTHORIZATION_REQUIRED" });
  assert.equal(original.received ?? 0, 0);
  assert.equal(await scriptedReview(receiver, p), true);
  assert.equal((await receiver.worker.execute(p.id)).complete, false, "ACK and arrival are not physical reception");
  assert.equal(h.advanceUntil(() => w.actorView("org0").unloadingRequests.find(r => r.operation === aid.id)?.state === "completed"), true);
  await receiver.ingestion.sync({ sources: false }); await donor.ingestion.sync({ sources: false });
  assert.equal((await receiver.worker.execute(p.id)).complete, true);
  assert.equal(original.received, 300); assert.equal(w.need("need-water-main").served, 300);
  assert.equal(w.state.operations.filter(o => o.resourceType === "water").length, 1);
  assert.equal((await donor.store.get("org1", "unloading_request", plan.references[0])).received, 300);
  await receiver.worker.execute(p.id); assert.equal(w.need("need-water-main").served, 300);
  // A declared external shift update during a second finite job must produce
  // an inconclusive received request, not a model or worker completion.
  const second = await receiver.connector.action("dispatch", { vehicle: "v-org0-0", resource: "r-org0-water",
    need: "need-water-main", quantity: 300 }, "donor-second-physical-case", { human: true });
  assert.equal(h.advanceUntil(() => w.actorView("org0").unloadingRequests.some(r => r.operation === second.id)), true);
  await receiver.ingestion.sync({ sources: false });
  const secondPlan = await unloadingPlan(receiver.store, "org0", second.id);
  assert.equal(secondPlan.readyToDraft, true);
  const secondDraft = await prepareUnloading(receiver.domain, receiver.store, actor,
    { operation: second.id, checkpoint: unloadingCheckpoint(secondPlan) }, "review-second-work");
  assert.equal(await scriptedReview(receiver, secondDraft), true);
  await receiver.worker.execute(secondDraft.id);
  assert.equal(h.advanceUntil(() => w.state.unloadingRequests.find(r => r.operation === second.id)?.state === "working"), true);
  w.setStaffCalendar(w.resource(secondDraft.actions[0].params.staff), { epochAt: w.now, shiftMs: 500, restMs: 10000 });
  assert.equal(h.advanceUntil(() => w.actorView("org0").unloadingRequests.find(r => r.operation === second.id)?.state === "inconclusive"), true);
  await receiver.ingestion.sync({ sources: false });
  assert.equal((await receiver.worker.execute(secondDraft.id)).requiresReview, true);
  assert.equal((await receiver.store.get("org0", "proposal", secondDraft.id)).state, "requires_review");
  assert.equal(w.state.operations.find(o => o.id === second.id).received ?? 0, 0);
  assert.equal(w.vehicle("v-org0-0").load, 300); assert.equal(w.need("need-water-main").served, 300);
  assert.deepEqual(w.invariants(), []);
  assert.equal((await receiver.store.query("SELECT COUNT(*) AS n FROM usage")).rows[0].n, 0);
});

test("HTTP S14 both own trucks blocked: reviewed recovery returns cargo before crew transport and finite unloading resumes the first delivery", { timeout: 90000 }, async t => {
  const h = await createHarness({ scenario: "S14", seed: "platform-unloading-backpressure", config: {
    loadMs: 1000, unloadMs: 2000, setupMs: 1000, reviewMs: 1000, healthReports: false, recurringNeeds: false } });
  t.after(() => h.close()); const w = h.lab.world, app = h.apps[0];
  for (const target of ["inventory", "vehicles", "roads", "map", "policy"])
    await app.connector.action("query", { target }, "backpressure-bootstrap-" + target);
  await app.ingestion.sync({ sources: false });
  const water = await app.store.get("org0", "resource", "r-org0-water"), available = water.quantity - water.reserved - water.floor,
    q1 = Math.min(300, Math.floor(available / 2)), q2 = Math.min(300, available - q1);
  assert.ok(q1 > 0 && q2 > 0);
  const first = await app.connector.action("dispatch", { vehicle: "v-org0-0", resource: water.id, quantity: q1, need: "need-water-main" }, "backpressure-first", { human: true }),
    extra = await app.connector.action("dispatch", { vehicle: "v-org0-1", resource: water.id, quantity: q2, need: "need-water-main" }, "backpressure-extra", { human: true });
  assert.equal(h.advanceUntil(() => w.actorView("org0").unloadingRequests.length === 2), true);
  await app.ingestion.sync({ sources: false });
  const request = (await app.store.list("org0", "unloading_request")).find(r => r.operation === first.id);
  await app.connector.action("verify", { target: "building", id: request.building, method: "clarification" }, "backpressure-site");
  await app.ingestion.sync({ sources: false });
  const recoveryPlan = await unloadingPlan(app.store, "org0", first.id);
  assert.equal(recoveryPlan.stage, "recover_crew_vehicle", JSON.stringify(recoveryPlan)); assert.equal(recoveryPlan.actions[0].params.id, extra.id);
  const recovery = await prepareUnloading(app.domain, app.store, actor, { operation: first.id,
    checkpoint: unloadingCheckpoint(recoveryPlan) }, "backpressure-recovery");
  assert.equal(await scriptedReview(app, recovery), true); const cancelIssuedAt = w.now; await app.worker.execute(recovery.id);
  assert.equal(w.need("need-water-main").served, 0); assert.equal(w.vehicle("v-org0-0").load, q1);
  assert.equal(h.advanceUntil(() => w.actorView("org0").operations.find(o => o.id === extra.id)?.times?.returned != null &&
    w.actorView("org0").known.vehicles["v-org0-1"]?.state === "idle"), true);
  await app.ingestion.sync({ sources: false }); await app.worker.execute(recovery.id);
  const tripPlan = await unloadingPlan(app.store, "org0", first.id);
  assert.equal(tripPlan.stage, "transport_crew", JSON.stringify(tripPlan)); assert.equal(tripPlan.actions[0].params.vehicle, "v-org0-1");
  const trip = await prepareUnloading(app.domain, app.store, actor, { operation: first.id, checkpoint: unloadingCheckpoint(tripPlan) }, "backpressure-crew");
  assert.equal(await scriptedReview(app, trip), true); await app.worker.execute(trip.id);
  assert.equal(h.advanceUntil(() => w.actorView("org0").operations.some(o => o.resourceType === "staff" && o.state === "completed")), true);
  await app.ingestion.sync({ sources: false }); await app.worker.execute(trip.id);
  const finish = await unloadingPlan(app.store, "org0", first.id);
  assert.equal(finish.stage, "unload");
  const p = await prepareUnloading(app.domain, app.store, actor, { operation: first.id, checkpoint: unloadingCheckpoint(finish) }, "backpressure-finish");
  assert.equal(await scriptedReview(app, p), true); await app.worker.execute(p.id);
  assert.equal(h.advanceUntil(() => w.actorView("org0").unloadingRequests.find(r => r.operation === first.id)?.state === "completed"), true);
  await app.ingestion.sync({ sources: false }); assert.equal((await app.worker.execute(p.id)).complete, true);
  assert.equal(w.need("need-water-main").served, q1); assert.equal(w.state.operations.filter(o => o.resourceType === "water").length, 2);
  assert.equal(w.state.operations.find(o => o.id === extra.id).times.returned > cancelIssuedAt, true);
  assert.equal(w.state.operations.find(o => o.id === first.id).received, q1);
  assert.deepEqual(w.invariants(), []);
});
