import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Network, sign } from "../src/network.mjs";
import { receivedStaffCapacity, staffCapacityProjection } from "../src/staff-capacity.mjs";
import { assessmentPlan, servicePlan } from "../src/services.mjs";
import { validatePlan } from "../src/planning.mjs";
import { actionSchema } from "../src/contracts.mjs";
import { recordResponseReceipt } from "../src/response-receipts.mjs";
import { actionBrief } from "../ui/uploads.mjs";

const skills = ["field_assessment", "shelter_support", "water_operations"];
const staff = () => ({ id: "mixed", owner: "org0", type: "staff", quantity: 3, reserved: 0, floor: 0,
  node: "n0", qualifications: [], qualificationCounts: Object.fromEntries(skills.map(s => [s, 1])),
  qualificationProfiles: [{ quantity: 1, qualifications: skills }, { quantity: 2, qualifications: [] }] });
const assessment = () => ({ id: "check", org: "org0", reportTo: "org0", entity: "site", target: "building",
  method: "field", purpose: "facility_safety", targetVersion: 4, state: "completed", confirmedBySource: true,
  observedAt: 900, completedAt: 950, result: { safe: true, version: 4, assessment: {
    purpose: "facility_safety", method: "field", competent: true, inspectorOrg: "org0", staffResource: "mixed",
    vehicle: "truck", operation: "field-operation", targetVersion: 4, observedAt: 900, validUntil: 10000, qualifications: ["field_assessment"] } } });
async function fixture(t) {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  await store.upsert("org0", "source", "simulator", { simulatedAt: 1000 });
  await store.upsert("org0", "facility", "site", { sourceVersion: 4, use: "shelter", capacity: 20,
    dependencies: { staff: 1 }, provisioned: {}, node: "n1", safe: false, ownerOrg: "org0", requiredStaffSkills: ["shelter_support"] });
  await store.upsert("org0", "resource", "mixed", staff());
  await store.upsert("org0", "vehicle", "truck", { owner: "org0", node: "n0", state: "idle", capacity: 10,
    seats: 3, maxCargoKg: 225, volumeM3: 0.225 });
  return store;
}

test("received marginal counts never invent a shared qualification and every reserved/protected/planned person reduces guaranteed capacity", () => {
  assert.equal(receivedStaffCapacity(staff(), skills), 1);
  assert.equal(receivedStaffCapacity({ ...staff(), reserved: 1 }, skills), 0);
  assert.equal(receivedStaffCapacity({ ...staff(), floor: 1 }, skills), 0);
  assert.equal(receivedStaffCapacity(staff(), skills, 1), 0);
  const marginal = { type: "staff", quantity: 3, qualificationCounts: { a: 2, b: 2 } };
  assert.equal(receivedStaffCapacity(marginal, ["a", "b"]), 1);
  assert.equal(receivedStaffCapacity({ ...marginal, quantity: 4 }, ["a", "b"]), 0);
  assert.equal(receivedStaffCapacity({ ...staff(), qualificationProfiles: [{ quantity: 3, qualifications: [] }] }, skills), 0);
  assert.equal(receivedStaffCapacity({ ...staff(), qualificationCounts: { field_assessment: 100 } }, ["field_assessment"]), 0);
  assert.equal(receivedStaffCapacity({ type: "staff", available: 2, qualifications: ["field_assessment"] }, ["field_assessment"]), 2);
  assert.equal(receivedStaffCapacity({ type: "staff", available: 2 }, ["field_assessment"]), 0);
  assert.equal(receivedStaffCapacity({ type: "staff", quantity: 2, qualifications: "field_assessment" }, ["field_assessment"]), 0);
});

test("one mixed assessor can be drafted once; a skilled service selection is exact, and owner review rechecks reserves and site version", async t => {
  const store = await fixture(t), plan = await assessmentPlan(store, "org0", "site");
  assert.equal(plan.readyToDraft, true); assert.equal(plan.actions[0].params.staff, "mixed");
  await validatePlan(store, "org0", { id: "new", actions: plan.actions });
  await store.upsert("org0", "proposal", "held", { state: "authorized", actions: plan.actions });
  await store.upsert("org0", "facility", "other", { sourceVersion: 2, use: "shelter", capacity: 20 });
  assert.equal((await assessmentPlan(store, "org0", "other")).readyToDraft, false);
  await assert.rejects(validatePlan(store, "org0", { id: "competing", actions: [{ ...plan.actions[0], params: { ...plan.actions[0].params, id: "other", targetVersion: 2 } }] }), { code: "STAFF_QUALIFICATIONS" });
  await store.upsert("org0", "proposal", "held", { state: "rejected" });
  await store.upsert("org0", "verification", "check", assessment());
  await store.upsert("org0", "facility", "site", { safe: true });
  const service = await servicePlan(store, "org0", "site");
  assert.equal(service.readyToDraft, true);
  const cargo = service.actions.find(a => a.type === "dispatch");
  assert.deepEqual(cargo.params.staffSkills, ["shelter_support"]); assert.equal(cargo.params.quantity, 1);
  assert.equal(actionSchema.safeParse(cargo).success, true);
  await validatePlan(store, "org0", { id: "selected", actions: [cargo] });
  await store.upsert("org0", "resource", "mixed", { reserved: 1 });
  assert.equal((await servicePlan(store, "org0", "site")).readyToDraft, false);
  await assert.rejects(validatePlan(store, "org0", { id: "selected", actions: [cargo] }), { code: "STAFF_QUALIFICATIONS" });
  await store.upsert("org0", "resource", "mixed", { reserved: 0 });
  await store.upsert("org0", "facility", "site", { sourceVersion: 5 });
  await assert.rejects(validatePlan(store, "org0", { id: "old-site", actions: plan.actions }), { code: "ASSESSMENT_VERSION" });
  assert.equal(actionSchema.safeParse({ ...cargo, params: { ...cargo.params, staffSkills: ["shelter_support", "shelter_support"] } }).success, false);
});

test("explicit consent transmits anonymous skill aggregates; loss or revocation invalidates unissued crew work without disclosing private selection", async t => {
  const store = await Store.open(); t.after(() => store.close());
  for (const org of ["org0", "org1"]) await store.organization(org);
  const key = "mixed-staff-consent-test", n0 = new Network(store, { org: "org0", peers: [{ org: "org1", key }] }),
    n1 = new Network(store, { org: "org1", peers: [{ org: "org0", key }] }), owner = { id: "owner", org: "org1", role: "commander" };
  const receive = m => { const e = { message: m, sentAt: Date.now() }; return n0.receive("org1", sign(key, e), e); };
  const row = await store.put("org1", "resource", "mixed", { ...staff(), owner: "org1",
    staffReservations: [{ key: "secret-selection" }], personnel: [{ name: "private name" }] }, 0);
  await n1.share(owner, { kind: "resource", id: row.id, version: row.version, to: "org0" }, "share-mixed");
  const first = (await store.query("SELECT payload FROM jobs WHERE kind='peer_send' ORDER BY created_at")).rows[0].payload.message;
  assert.equal(JSON.stringify(first).includes("secret-selection"), false); assert.equal(JSON.stringify(first).includes("private name"), false);
  await receive(first);
  const offer = (await store.list("org0", "peer_offer"))[0];
  assert.equal(receivedStaffCapacity(offer.projection, ["field_assessment"]), 1);
  assert.deepEqual(offer.projection.staffCapacity, staffCapacityProjection(row).staffCapacity);
  const action = { type: "verify", owner: "org1", dependsOn: [], params: { target: "building", id: "site", method: "field",
    purpose: "facility_safety", reportTo: "org0", staff: "mixed", vehicle: "truck", targetVersion: 4, validForMs: 21600000 } };
  await store.upsert("org0", "proposal", "future", { state: "authorized", authorization: { by: "coordinator" },
    actions: [action], dependencies: [offer.id], references: [offer.id], executionResults: [] });
  await store.upsert("org1", "resource", "mixed", { qualificationCounts: {}, qualificationProfiles: [{ quantity: 3, qualifications: [] }] });
  await n1.refresh();
  const messages = (await store.query("SELECT payload FROM jobs WHERE kind='peer_send' ORDER BY created_at")).rows.map(r => r.payload.message);
  const refreshed = messages.find(m => m.version > first.version);
  await receive(refreshed);
  assert.equal((await store.get("org0", "proposal", "future")).state, "requires_review");
  assert.equal((await store.get("org0", "proposal", "future")).authorization, null);
  await receive(first);
  assert.equal(receivedStaffCapacity((await store.get("org0", "peer_offer", offer.id)).projection, ["field_assessment"]), 0, "An old signed capability cannot restore lost competence");
  const current = await store.get("org1", "resource", "mixed");
  await n1.share(owner, { kind: "resource", id: current.id, version: current.version, to: "org0", revoke: true }, "revoke-mixed");
  const revoke = (await store.query("SELECT payload FROM jobs WHERE kind='peer_send'")).rows.map(r => r.payload.message).find(m => m.revoke);
  await receive(revoke);
  assert.equal((await store.get("org0", "peer_offer", offer.id)).active, false);
});

test("a peer cannot satisfy an approved staff selector with different or unqualified physical cargo and the human sees the qualification scope", async t => {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  const action = { type: "dispatch", owner: "org1", dependsOn: [], params: { resource: "mixed", vehicle: "truck",
    destination: "n1", building: "site", quantity: 1, staffSkills: ["shelter_support"] } },
    p = { id: "typed-service", actions: [action] },
    source = { id: "physical-staff", org: "org1", type: "delivery", resource: "mixed", resourceType: "staff",
      vehicle: "truck", quantity: 1, received: 1, destination: "n1", building: "site", need: null,
      state: "completed", confirmedBySource: true, observedAt: 1000, times: { received: 900 },
      staffSkills: ["shelter_support"], receivedStaff: { quantity: 1, qualifications: ["shelter_support"],
        qualificationCounts: { shelter_support: 1 }, qualificationProfiles: [{ quantity: 1, qualifications: ["shelter_support"] }] } };
  for (const mutate of [x => delete x.staffSkills, x => x.staffSkills = ["water_operations"],
    x => delete x.receivedStaff, x => x.receivedStaff.quantity = 2,
    x => x.receivedStaff = { quantity: 1, qualifications: [], qualificationCounts: {}, qualificationProfiles: [{ quantity: 1, qualifications: [] }] }]) {
    const invalid = structuredClone(source); mutate(invalid);
    await assert.rejects(store.transaction(tx => recordResponseReceipt(tx, "org0", "org1", p, 0, "completed", invalid)), { code: "PEER_STAFF_SCOPE" });
  }
  await store.transaction(tx => recordResponseReceipt(tx, "org0", "org1", p, 0, "completed", source));
  const receipt = (await store.list("org0", "operation"))[0];
  assert.equal(receipt.received, 1); assert.deepEqual(receipt.staffSkills, action.params.staffSkills);
  assert.match(actionBrief(action), /qualified for shelter support/);
});

test("a missing service dependency explains only received qualifications, transport and exact prospective holds", async t => {
  const store = await fixture(t);
  await store.upsert("org0", "verification", "check", assessment());
  await store.upsert("org0", "facility", "site", { safe: true, dependencies: { staff: 1, energy: 1 } });
  await store.upsert("org0", "vehicle", "truck", { state: "dispatched" });
  let plan = await servicePlan(store, "org0", "site"), d = plan.missing.find(m => m.type === "staff").diagnostics[0];
  assert.equal(d.reason, "transport"); assert.equal(d.owner, "org0"); assert.equal(d.resource, "mixed");
  assert.equal(d.qualifiedAvailable, 1); assert.deepEqual(d.requiredSkills, ["shelter_support"]);
  const absent = plan.missing.find(m => m.type === "energy");
  assert.equal(absent.quantity, 1); assert.deepEqual(absent.diagnostics, []);
  assert.match(absent.note, /has been received/);
  await store.upsert("org0", "vehicle", "truck", { state: "idle" });
  await store.upsert("org0", "proposal", "crew-hold", { state: "awaiting_review", actions: [{ type: "verify", owner: "org0",
    params: { target: "building", id: "other-site", method: "field", purpose: "facility_safety", staff: "other-staff", vehicle: "truck" } }] });
  plan = await servicePlan(store, "org0", "site"); d = plan.missing.find(m => m.type === "staff").diagnostics[0];
  assert.equal(d.reason, "hold"); assert.deepEqual(d.heldVehicleIds, ["truck"]); assert.equal(d.heldQuantity, 0);
  await store.upsert("org0", "proposal", "crew-hold", { state: "rejected" });
  await store.upsert("org0", "resource", "mixed", { qualificationCounts: {}, qualificationProfiles: [{ quantity: 3, qualifications: [] }] });
  plan = await servicePlan(store, "org0", "site"); d = plan.missing.find(m => m.type === "staff").diagnostics[0];
  assert.equal(d.reason, "qualification"); assert.equal(d.receivedAvailable, 3); assert.equal(d.qualifiedAvailable, 0);
  assert.equal(plan.readyToDraft, false); assert.equal((await store.list("org0", "operation")).length, 0);
});
