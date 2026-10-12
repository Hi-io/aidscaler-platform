import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { assessmentPlan, servicePlan } from "../src/services.mjs";
import { assessmentCurrent, recordAssessmentReceipt } from "../src/assessment-receipts.mjs";
import { createHarness, scriptedReview, conventionalSharedProposal } from "../evaluation/harness.mjs";
import { configureResponsePolicy } from "../src/response-policy.mjs";
import { Worker } from "../src/worker.mjs";

async function fixture(t) {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  await store.upsert("org0", "source", "simulator", { simulatedAt: 1000 });
  await store.upsert("org0", "facility", "site", { sourceVersion: 7, use: "shelter", capacity: 20,
    dependencies: {}, provisioned: {}, node: "n1", safe: false, ownerOrg: "org0" });
  for (const [kind, projection] of [["resource", { id: "staff", type: "staff", available: 1, qualifications: ["field_assessment"] }],
    ["vehicle", { id: "truck", owner: "org1", state: "idle", capacity: 2 }]])
    await store.upsert("org0", "peer_offer", kind + "-offer", { from: "org1", kind, projection,
      active: true, expiresAt: Date.now() + 60000, permissionVersion: 1 });
  return store;
}
const sourceReceipt = () => ({ id: "inspection-1", org: "org1", target: "building", entity: "site",
  method: "field", purpose: "facility_safety", reportTo: "org0", targetVersion: 7,
  requestProposal: "source-plan", requestStep: 0, state: "completed", confirmedBySource: true,
  observedAt: 600, completedAt: 900, result: { safe: true, version: 7,
    assessment: { purpose: "facility_safety", method: "field", competent: true,
      inspectorOrg: "org1", staffResource: "staff", vehicle: "truck", operation: "operation-1",
      targetVersion: 7, observedAt: 600, validUntil: 10000, qualifications: ["field_assessment"] } } });

test("checked assessment draft uses only consented qualified owner capacity and holds the crew while approval is pending", async t => {
  const store = await fixture(t), plan = await assessmentPlan(store, "org0", "site");
  assert.equal(plan.readyToDraft, true); assert.equal(plan.actions[0].owner, "org1");
  assert.deepEqual(plan.ownerApprovals, ["org0", "org1"]);
  assert.deepEqual(plan.actions[0].params, { target: "building", id: "site", method: "field",
    purpose: "facility_safety", reportTo: "org0", staff: "staff", vehicle: "truck", targetVersion: 7, validForMs: 21600000 });
  assert.equal((await servicePlan(store, "org0", "site")).readyToDraft, false);
  await store.upsert("org0", "proposal", "waiting", { state: "awaiting_review", actions: plan.actions });
  assert.equal((await assessmentPlan(store, "org0", "site")).pending[0].proposal, "waiting");
  await store.upsert("org0", "facility", "second", { sourceVersion: 1, use: "shelter", capacity: 20 });
  assert.equal((await assessmentPlan(store, "org0", "second")).readyToDraft, false, "An unapproved draft cannot soft-assign the same crew twice");
  await store.upsert("org0", "proposal", "waiting", { state: "rejected" });
  await store.upsert("org0", "peer_offer", "resource-offer", { active: false });
  assert.equal((await assessmentPlan(store, "org0", "site")).readyToDraft, false, "Revoked capability is unavailable");
});

test("clarification, insufficient competence, wrong owner, old target version and expired source time cannot satisfy site assessment", async t => {
  const store = await fixture(t), facility = await store.get("org0", "facility", "site"), v = sourceReceipt();
  assert.equal(assessmentCurrent(v, facility, 1000), true);
  for (const mutate of [x => x.method = "clarification", x => x.confirmedBySource = false,
    x => x.result.assessment.competent = false, x => x.result.assessment.qualifications = [],
    x => x.result.assessment.inspectorOrg = "org2", x => x.result.version = 6,
    x => x.result.assessment.validUntil = 1000, x => x.result.assessment.observedAt = 2000]) {
    const bad = structuredClone(v); mutate(bad); assert.equal(assessmentCurrent(bad, facility, 1000), false);
  }
  await store.upsert("org0", "verification", v.id, v);
  await store.upsert("org0", "facility", "site", { safe: true });
  assert.equal((await servicePlan(store, "org0", "site")).readyToDraft, true);
  await store.upsert("org0", "source", "simulator", { simulatedAt: 10000 });
  assert.equal((await servicePlan(store, "org0", "site")).readyToDraft, false, "Wall time cannot extend an expired simulated assessment");
});

test("owner assessment receipt binds source request and exact crew, preserves evidence and rejects cross-authorization replay", async t => {
  const store = await fixture(t), plan = await assessmentPlan(store, "org0", "site"),
    p = { id: "decision", simId: "source-plan", actions: plan.actions }, v = sourceReceipt();
  for (const mutate of [x => x.requestStep = 1, x => x.requestProposal = "other",
    x => x.result.assessment.vehicle = "other-truck", x => x.reportTo = "org2"]) {
    const bad = structuredClone(v); mutate(bad);
    await assert.rejects(store.transaction(tx => recordAssessmentReceipt(tx, "org0", "org1", p, 0, "completed", bad)),
      e => e.code === "PEER_ASSESSMENT");
  }
  await store.transaction(tx => recordAssessmentReceipt(tx, "org0", "org1", p, 0, "completed", v));
  const received = await store.get("org0", "verification", "peer:org1:inspection-1");
  assert.equal(received.sourceOwner, "org1"); assert.equal(received.sourceId, "inspection-1");
  assert.equal(assessmentCurrent(received, await store.get("org0", "facility", "site"), 1000), true);
  await store.transaction(tx => recordAssessmentReceipt(tx, "org0", "org1", p, 0, "completed", v));
  assert.equal((await store.list("org0", "verification", 100)).length, 1);
  await assert.rejects(store.transaction(tx => recordAssessmentReceipt(tx, "org0", "org1", { ...p, id: "another" }, 0, "completed", v)),
    e => e.code === "PEER_ASSESSMENT");
});

test("an expired delegated assessment ends the dependency wait for review instead of polling the completed partner forever", async t => {
  const store = await fixture(t), plan = await assessmentPlan(store, "org0", "site"), source = sourceReceipt();
  await store.upsert("org0", "proposal", "expired-assessment", { state: "awaiting_partner",
    actions: plan.actions, conditions: [], references: [], simId: "source-plan", authorization: { by: "owner" },
    executionResults: [{ index: 0, owner: "org1", state: "completed", requestId: "approved-request", partnerResult: source }] });
  let writes = 0;
  const worker = new Worker({ store, config: { org: "org0" }, connector: {
    state: async () => ({ now: 10000, organization: { id: "org0" },
      proposals: [{ id: "source-plan", state: "authorized" }], known: { buildings: {} }, operations: [], inspections: [] }),
    action: async () => { writes++; },
  } });
  const result = await worker.execute("expired-assessment");
  assert.equal(result.requiresReview, true);
  const after = await store.get("org0", "proposal", "expired-assessment");
  assert.equal(after.state, "requires_review"); assert.equal(after.authorization, null);
  assert.equal(after.executionResults[0].partnerResult.id, source.id, "Historical source evidence remains auditable");
  assert.equal(writes, 0); assert.equal((await worker.execute(after.id)).skipped, true);
});

test("a field crew blocked in transit returns its assessment for review while retaining the real assigned operation", async t => {
  const store = await fixture(t), plan = await assessmentPlan(store, "org0", "site"),
    actions = [{ ...plan.actions[0], owner: "org0", params: { ...plan.actions[0].params, staff: "own-staff", vehicle: "own-truck" } }];
  await store.upsert("org0", "proposal", "blocked-assessment", { state: "executing", actions,
    conditions: [], references: [], simId: "own-source-plan", authorization: { by: "owner" },
    executionResults: [{ index: 0, result: { id: "field-inspection", state: "queued" } }] });
  let writes = 0;
  const worker = new Worker({ store, config: { org: "org0" }, connector: {
    state: async () => ({ now: 5000, organization: { id: "org0" }, proposals: [{ id: "own-source-plan", state: "authorized" }],
      known: { buildings: {} }, operations: [{ id: "actual-field-trip", type: "inspection", inspection: "field-inspection", state: "blocked", vehicle: "own-truck" }],
      inspections: [] }),
    action: async () => { writes++; },
  } });
  assert.equal((await worker.execute("blocked-assessment")).requiresReview, true);
  const after = await store.get("org0", "proposal", "blocked-assessment");
  assert.equal(after.authorization, null); assert.deepEqual(after.affectedSteps, [0]);
  assert.equal(after.executionResults[0].result.id, "field-inspection"); assert.equal(writes, 0);
});

async function setup(t) {
  const h = await createHarness({ scenario: "S19", seed: "staffless-delegated-composition", organizations: 4 });
  t.after(() => h.close());
  // Fixture intervention, never candidate access: the coordinating team has
  // no assessor. Conservation and the same received source view are retained.
  const r = h.lab.world.resource("r-org0-staff"); r.lost += r.quantity; r.quantity = 0; r.version++;
  h.lab.world.observeResource("org0", r); h.lab.world.advance(60000);
  for (const app of h.apps) {
    for (const target of ["inventory", "vehicles", "map"])
      await app.connector.action("query", { target }, `delegated-${app.config.org}-${target}`);
    await app.ingestion.sync();
  }
  const a = h.apps[0], org = a.config.org,
    b = (await a.store.get(org, "context", "geography")).map.places.find(b => b.use === "shelter");
  await configureResponsePolicy(a.store, { id: "fixture-coordinator", org, role: "commander" },
    { version: 0, order: "priority_then_deadline", protectedTypes: ["shelter"], reason: "Fixture decision prioritizes the displaced shelter group" }, "delegated-priority");
  for (const app of h.apps.slice(1)) {
    const actor = (await app.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'", [app.config.org])).rows[0];
    for (const kind of ["resource", "vehicle"])
      for (const row of (await app.store.list(app.config.org, kind, 100)).filter(r => r.owner === app.config.org))
        await app.network.share(actor, { kind, id: row.id, version: row.version, to: org }, "delegated-share-" + row.id);
    await app.worker.drain();
  }
  return { h, a, org, b };
}
async function advanceAll(h, { until = () => false, limit = 30 } = {}) {
  for (let i = 0; i < limit; i++) {
    h.lab.world.advance(Math.min(h.lab.world.config.durationMs, h.lab.world.now + 300000));
    for (const app of h.apps) {
      await app.ingestion.sync({ sources: false });
      for (const row of await app.store.list(app.config.org, "proposal", 100)) {
        if (row.state === "awaiting_review") await scriptedReview(app, row);
        if (["authorized", "executing", "awaiting_partner"].includes((await app.store.get(app.config.org, "proposal", row.id)).state))
          await app.worker.execute(row.id);
      }
      await app.worker.drain();
    }
    if (await until()) break;
  }
}

test("inventory refresh and signed peer offers preserve the owner's explicit field competence", async t => {
  const { h, a, org } = await setup(t), peer = h.apps.find(app => app.config.org === "org2"),
    staff = (await peer.store.list(peer.config.org, "resource", 100)).find(r => r.type === "staff" && r.owner === peer.config.org && r.quantity > 0);
  assert.ok(staff.qualifications?.includes("field_assessment"), "The owned inventory API must report staff competence, not headcount alone");
  const offer = (await a.store.list(org, "peer_offer", 100)).find(o => o.from === peer.config.org && o.kind === "resource" && o.projection.id === staff.id);
  assert.ok(offer?.active); assert.ok(offer.projection.qualifications.includes("field_assessment"));
});

test("a staffless coordinator obtains peer-approved physical assessment and opens an occupied four-owner shelter", async t => {
  const { h, a, org, b } = await setup(t);
  await a.connector.action("verify", { target: "building", id: b.id, method: "clarification" }, "delegated-site-description");
  await a.ingestion.sync({ sources: false });
  const plan = await assessmentPlan(a.store, org, b.id, { peers: a.config.peers });
  assert.equal(plan.readyToDraft, true, JSON.stringify(plan)); assert.notEqual(plan.actions[0].owner, org);
  assert.equal((await servicePlan(a.store, org, b.id)).readyToDraft, false);
  const proposal = await a.domain.propose({ id: "assessment-test", org, role: "agent" },
    { title: "Delegate a qualified mobile field assessment", summary: "Each owner approves its own work",
      benefit: "A physically assessed candidate shelter", rationale: "No qualified coordinating crew is available",
      actions: plan.actions, references: plan.references, conditions: [], alternatives: [] }, "delegated-assessment-draft");
  await scriptedReview(a, proposal); await a.worker.execute(proposal.id); await a.worker.drain();
  const peer = h.apps.find(app => app.config.org === plan.actions[0].owner),
    partner = (await peer.store.list(peer.config.org, "proposal", 100))[0];
  assert.equal(partner.state, "awaiting_review"); assert.equal(partner.authorization, null);
  assert.equal((await peer.connector.state()).inspections.length, 0, "Originating approval alone cannot order another owner field crew");
  await advanceAll(h, { until: async () => (await a.store.get(org, "proposal", proposal.id)).state === "completed" });
  const completed = await a.store.get(org, "proposal", proposal.id);
  assert.equal(completed.state, "completed", JSON.stringify(completed));
  const ownField = (await a.connector.state()).inspections.filter(i => i.method === "field" && !i.sourceOwner);
  assert.equal(ownField.length, 0, "The coordinator never ran a staffless field visit");
  const physical = (await peer.connector.state()).inspections.find(i => i.target === "building" && i.entity === b.id && i.method === "field");
  assert.equal(physical.state, "completed"); assert.equal(physical.confirmedBySource, true);
  assert.ok(physical.observedAt > physical.startedAt && physical.arrivedAt >= physical.startedAt);
  await a.ingestion.sync({ sources: false });
  const service = await servicePlan(a.store, org, b.id);
  assert.equal(service.readyToDraft, true, JSON.stringify(service.missing));
  const serviceProposal = await a.domain.propose({ id: "assessment-test", org, role: "agent" },
    { title: "Open and occupy a peer-assessed four-owner shelter", summary: "Owner-received safety and complementary physical deliveries",
      benefit: "Displaced people reach an operating shelter", rationale: "A received competent assessment gates service activation",
      actions: service.actions, references: service.references, conditions: [], alternatives: [] }, "delegated-service-draft");
  await scriptedReview(a, serviceProposal); await a.worker.execute(serviceProposal.id); await a.worker.drain();
  await advanceAll(h, { until: async () => (await a.store.get(org, "proposal", serviceProposal.id)).state === "completed" });
  assert.equal((await a.store.get(org, "proposal", serviceProposal.id)).state, "completed");
  const actual = h.lab.world.building(b.id);
  assert.equal(actual.state, "operating"); assert.equal(actual.occupancy, 50);
  assert.deepEqual(h.lab.world.invariants(), []);
});

test("competent shared conventional planning can request the identical delegated field capability", async t => {
  const { a, org } = await setup(t);
  const result = await conventionalSharedProposal(a, "conventional-delegated-round");
  assert.equal(result.state, "ready", JSON.stringify(result));
  const p = await a.store.get(org, "proposal", result.proposalId);
  assert.equal(p.actions[0].type, "verify"); assert.notEqual(p.actions[0].owner, org);
  assert.equal(p.actions[0].params.method, "field"); assert.equal(p.authorization, null);
});
