import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { proposalServiceFunnel, collectProposalServiceFunnel } from "../evaluation/proposal-funnel.mjs";
import { createHarness, ruleProposal, scriptedReview } from "../evaluation/harness.mjs";

const action = (owner = "org0", extra = {}) => ({ type: "dispatch", owner,
  params: { need: "need-a", resource: "water", vehicle: "truck", quantity: 100 }, dependsOn: [], ...extra });
const review = (org, id, decision = "approve", version = 1, sequence = 1) => ({ org, entity: id, actor: "human:" + org,
  action: "proposal." + decision, detail: { version, note: "Exact reviewed scope", conditions: [] }, sequence, occurred_at: 10000 + sequence });
const proposal = (id = "p0", org = "org0") => ({ id, version: 3, state: "completed", simId: "source-plan:" + id,
  actions: [action(org)], authorization: { by: "human:" + org, proposalVersion: 1, at: 10001 },
  executionResults: [{ index: 0, result: { id: "op0", state: "authorized" } }] });
const operation = (extra = {}) => ({ id: "op0", org: "org0", type: "delivery", state: "completed", need: "need-a",
  building: "home-a", resource: "water", resourceType: "water", vehicle: "truck", quantity: 100,
  received: 100, createdAt: 5, times: { authorized: 5, received: 100, service: 100 }, ...extra });
const received = (p, o) => ({ ...o, owner: o.org, proposalId: p.id, step: 0, confirmedBySource: true });
function fixture(p = proposal(), o = operation()) {
  return { asOfSourceClock: 200, owners: [{ org: "org0", proposals: [p], audit: [review("org0", p.id)], operations: [received(p, o)] }],
    source: { operations: [o], proposals: [{ id: p.simId, org: "org0", state: "authorized", reviewedAt: 4, version: 2, authorizedBy: "commander:org0" }],
      needs: [{ id: "need-a", building: "home-a", type: "water" }] } };
}

test("K16 positive physical receipt is exact and partial remains distinct from the reviewed quantity", () => {
  const f = fixture(proposal(), operation({ received: 40 })), original = structuredClone(f), r = proposalServiceFunnel(f);
  assert.equal(r.scope, "observer_post_execution_only"); assert.equal(r.denominators.reviewedProposals, 1);
  assert.equal(r.denominators.usefulServiceProposals, 1); assert.equal(r.denominators.partialUsefulServiceProposals, 1);
  assert.equal(r.denominators.nativePositiveReceipts[0].received, 40); assert.equal(r.records[0].steps[0].receivedByPlatform, true);
  assert.equal(r.records[0].sourceReview.reviewedAtSourceClock, 4); assert.equal(r.records[0].reviews[0].atWallClock, 10001);
  assert.deepEqual(f, original, "Scoring is pure and does not advance policy or mutate evidence");
});

test("two real source-positive receipts for one already covered demand are positive links, not two deficit reductions", () => {
  const first = proposal("first"), second = proposal("second"), a = operation(),
    b = operation({ id: "op1", createdAt: 150, times: { authorized: 150, received: 190, service: 190 } });
  second.executionResults = [{ index: 0, result: { id: "op1", state: "completed" } }];
  const source = { operations: [a, b], needs: [{ id: "need-a", building: "home-a", type: "water", quantity: 100, served: 200, completedAt: 100 }] },
    f = { asOfSourceClock: 200, source, owners: [{ org: "org0", proposals: [first, second],
      operations: [received(first, a), received(second, b)], audit: [review("org0", first.id), review("org0", second.id)] }] },
    original = structuredClone(f), r = proposalServiceFunnel(f);
  assert.equal(r.denominators.uniquePositivePhysicalSourceOperations, 2);
  assert.equal(r.denominators.positivePhysicalServiceProposals, 2);
  assert.ok(r.records.every(p => p.steps[0].positivePhysicalService));
  assert.equal(r.denominators.uniqueUsefulSourceOperations, 2, "Legacy counts stay compatible but explicitly mean positive receipts.");
  assert.equal(r.denominators.nativePositiveReceipts.reduce((s, x) => s + x.received, 0), 200, "Do not hide redundant physical cargo by clamping receipt quantities.");
  assert.match(r.definitions.legacyAliases, /not aid benefit or deficit reduction/);
  assert.match(r.definitions.service, /redundant delivered supply/);
  assert.deepEqual(f, original, "The observer does not rewrite source deficit, receipts or controller state.");
});

test("completed proposal, arrival, fake row, wrong owner/destination/quantity and future receipt get no shallow useful credit", () => {
  for (const defect of ["no-issued", "no-source", "arrival", "owner", "need", "vehicle", "quantity", "zero", "future", "historical", "missing-createdAt", "conflict"]) {
    const f = fixture();
    if (defect === "no-issued") { f.owners[0].proposals[0].executionResults = []; f.owners[0].operations = []; }
    if (defect === "no-source") f.source.operations = [];
    if (defect === "arrival") f.source.operations[0].times = { arrived: 100 };
    if (defect === "owner") f.source.operations[0].org = "org1";
    if (defect === "need") f.source.operations[0].need = "other";
    if (defect === "vehicle") f.source.operations[0].vehicle = "other";
    if (defect === "quantity") f.source.operations[0].quantity = 200;
    if (defect === "zero") f.source.operations[0].received = 0;
    if (defect === "future") f.source.operations[0].times.service = 300;
    if (defect === "historical") f.source.operations[0].times.service = 1;
    if (defect === "missing-createdAt") delete f.source.operations[0].createdAt;
    if (defect === "conflict") f.owners[0].operations[0].sourceId = "other-op";
    const r = proposalServiceFunnel(f);
    assert.equal(r.denominators.usefulServiceProposals, 0, defect);
    assert.equal(r.denominators.completedWithoutDirectUsefulService, 1, defect);
  }
});

test("all owners, rejected/clarified versions and authority reasons remain in the review denominator", () => {
  const f = fixture(), rejected = { ...proposal("declined", "org1"), state: "rejected", authorization: null, executionResults: [] };
  f.owners.push({ org: "org1", proposals: [rejected], operations: [], audit: [
    review("org1", "declined", "clarify", 1, 3), review("org1", "declined", "reject", 2, 4),
    { org: "org1", entity: "declined", action: "proposal.command_rejected", detail: { code: "STAFF_CALENDAR", step: 0 }, sequence: 5, occurred_at: 10005 }] });
  const r = proposalServiceFunnel(f);
  assert.equal(r.denominators.proposals, 2); assert.equal(r.denominators.reviewedVersions, 3);
  assert.equal(r.denominators.reviewDecisions, 3); assert.equal(r.denominators.rejectionDecisions, 1);
  assert.equal(r.denominators.usefulPerReviewedProposal, .5); assert.equal(r.perOwner.length, 2);
  const p = r.records.find(p => p.org === "org1");
  assert.deepEqual(p.reviews.map(r => r.version), [1, 2]); assert.equal(p.validation.failures[0].detail.code, "STAFF_CALENDAR");
});

test("purchase receipt, assessment and activation are intermediate outcomes, never independent service receipts", () => {
  const p = proposal(); p.actions = [action("org0", { type: "purchase", params: { type: "water", quantity: 100, price: 2 } }),
    action("org0", { type: "verify", params: { target: "building", id: "shelter" } }),
    action("org0", { type: "activate", params: { building: "shelter" } })];
  p.executionResults = [{ index: 0, result: { id: "purchase0", state: "received" } },
    { index: 1, result: { id: "inspection0", state: "completed" } }, { index: 2, result: { id: "shelter", state: "operating" } }];
  const f = fixture(p); f.owners[0].operations = []; f.source.operations = [];
  f.source.purchases = [{ id: "purchase0", org: "org0", state: "partial", quantity: 100, receivedQuantity: 60, currency: "sandbox_credit" }];
  f.source.inspections = [{ id: "inspection0", org: "org0", state: "completed", method: "field" }];
  const r = proposalServiceFunnel(f);
  assert.equal(r.denominators.issuedProposals, 1); assert.equal(r.denominators.usefulServiceProposals, 0);
  assert.equal(r.records[0].steps[0].financialReceipt.receivedQuantity, 60);
  assert.equal(r.records[0].steps[1].assessmentReceipt.method, "field");
  assert.equal(r.records[0].steps[2].nonServiceReason, "activation_not_occupied_service");
});

test("a consented peer and coordinator retain separate review scopes but only one native physical receipt", () => {
  const root = proposal("joint"), child = proposal("delegate", "org1"), physical = operation({ org: "org1" });
  root.actions = [action("org1")]; root.executionResults = [{ index: 0, owner: "org1", state: "completed", partnerResult: { id: "op0", state: "completed" } }];
  child.originPartner = "org0"; child.originProposal = "joint"; child.originStep = 0;
  const f = { asOfSourceClock: 200, source: { operations: [physical] }, owners: [
    { org: "org0", proposals: [root], audit: [review("org0", "joint")], operations: [{ ...received(root, physical), id: "peer:org1:op0", sourceId: "op0" }] },
    { org: "org1", proposals: [child], audit: [review("org1", "delegate")], operations: [received(child, physical)] }] };
  const r = proposalServiceFunnel(f);
  assert.equal(r.denominators.reviewedProposals, 2); assert.equal(r.denominators.usefulServiceProposals, 2);
  assert.equal(r.denominators.uniqueUsefulSourceOperations, 1); assert.equal(r.denominators.nativePositiveReceipts.length, 1);
  assert.equal(r.records.find(p => p.id === "delegate").originProposal, "joint");
});

test("received-by-platform stays false when the source later physically serves but the actor only saw in transit", () => {
  const f = fixture(); f.owners[0].operations[0].received = 0; f.owners[0].operations[0].times = { received: null };
  const r = proposalServiceFunnel(f);
  assert.equal(r.records[0].steps[0].usefulPhysicalService, true); assert.equal(r.records[0].steps[0].receivedByPlatform, false);
});

test("reroute can link an existing delivery or occupied evacuation without claiming a new service receipt", () => {
  for (const type of ["delivery", "evacuation", "repair"]) {
    const p = proposal(), o = operation({ type });
    p.actions = [action("org0", { type: "reroute", params: { vehicle: "truck", operation: "op0", destination: "new-node" } })];
    const r = proposalServiceFunnel(fixture(p, o)), step = r.records[0].steps[0];
    assert.equal(step.correctlyLinked, type !== "repair", type);
    assert.equal(step.usefulPhysicalService, false, "A rerouted existing operation is not a second independent aid receipt");
    assert.equal(r.denominators.uniqueUsefulSourceOperations, 0);
    if (type === "repair") assert.ok(step.missing.includes("different_operation_type"));
  }
});

test("offline collector reads all owner stores and historical audits without issuing source queries or commands", async t => {
  const stores = await Promise.all([Store.open(), Store.open()]); t.after(() => Promise.all(stores.map(s => s.close())));
  for (let i = 0; i < 2; i++) {
    const org = "org" + i, p = proposal("p" + i, org);
    await stores[i].organization(org); await stores[i].put(org, "proposal", p.id, p, 0);
    await stores[i].audit(org, "human:" + org, "proposal.reject", p.id, { version: 1, note: "Retained declined scope" });
  }
  const apps = stores.map((store, i) => ({ store, config: { org: "org" + i }, connector: { action: () => { throw Error("no source I/O"); } } }));
  const r = await collectProposalServiceFunnel(apps, { now: 200, state: {} });
  assert.equal(r.denominators.proposals, 2); assert.equal(r.denominators.rejectionDecisions, 2);
  assert.equal(r.denominators.usefulServiceProposals, 0); assert.equal(r.perOwner.length, 2);
});

test("real HTTP approved dispatch has an exact positive service link; declined scope stays counted without a new trip", async t => {
  const h = await createHarness({ scenario: "S23", seed: "K16-physical-01", organizations: 1, provider: { complete: () => { throw Error("No paid call permitted"); } },
    config: { grid: 5, extentKm: 1, hazard: "none", backgroundTraffic: 0, packetLoss: 0, postsPerHour: 0, healthReports: false,
      recurringNeeds: false, queryLatencyMs: 1000, reviewMs: 1000, loadMs: 1000, unloadMs: 1000 } });
  t.after(() => h.close());
  const app = h.apps[0]; h.lab.world.advance(60000);
  for (const target of ["inventory", "vehicles", "map", "policy"])
    await app.connector.action("query", { target }, "K16-initial-" + target);
  await app.ingestion.sync({ sources: false });
  const plan = await ruleProposal(app, "K16-physical-01"); assert.ok(plan.proposalId);
  let p = await app.store.get("org0", "proposal", plan.proposalId); assert.equal(await scriptedReview(app, p), true);
  await app.worker.execute(p.id);
  for (let i = 0; i < 30; i++) { h.lab.world.advance(h.lab.world.now + 60000); await app.ingestion.sync({ sources: false }); await app.worker.execute(p.id); }
  const actor = (await app.store.query("SELECT id,org,name,role FROM users WHERE org=$1 AND role='commander'", ["org0"])).rows[0];
  const declined = await app.domain.propose(actor, { title: "Retain a declined option", summary: "Operator declines another plan", benefit: "None until approved",
    rationale: "This is an explicit negative review", references: p.references, conditions: [], alternatives: [], priority: "normal", actions: p.actions }, "K16-declined");
  await app.domain.review(actor, declined.id, { decision: "reject", version: declined.version, note: "No duplicate shipment requested" }, "K16-decline");
  const before = h.lab.world.state.operations.length, r = await collectProposalServiceFunnel(h.apps, h.lab.world);
  assert.equal(r.denominators.proposals, 2); assert.equal(r.denominators.reviewedProposals, 2);
  assert.equal(r.denominators.usefulServiceProposals, 1); assert.equal(r.denominators.rejectedProposals, 1);
  const dispatches = p.actions.filter(a => a.type === "dispatch");
  assert.ok(dispatches.length > 0); assert.equal(r.denominators.uniqueUsefulSourceOperations, dispatches.length);
  for (const receipt of r.denominators.nativePositiveReceipts) {
    const source = h.lab.world.state.operations.find(o => o.id === receipt.id && o.org === receipt.owner);
    assert.ok(receipt.received > 0); assert.equal(receipt.received, source.received);
    assert.equal(receipt.serviceAtSourceClock, source.times.service);
    assert.equal(source.need, dispatches.find(a => a.params.vehicle === source.vehicle).params.need);
  }
  assert.equal(h.lab.world.state.operations.length, before); assert.equal(h.lab.world.invariants().length, 0);
});
