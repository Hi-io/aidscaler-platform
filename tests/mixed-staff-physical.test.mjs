import test from "node:test";
import assert from "node:assert/strict";
import { createHarness, scriptedReview } from "../evaluation/harness.mjs";
import { assessmentPlan, servicePlan } from "../src/services.mjs";

async function advanceAll(h, until, limit = 40) {
  for (let i = 0; i < limit; i++) {
    h.lab.world.advance(Math.min(h.lab.world.config.durationMs, h.lab.world.now + 300000));
    for (const app of h.apps) {
      await app.ingestion.sync({ sources: false });
      for (const p of await app.store.list(app.config.org, "proposal", 100)) {
        if (p.state === "awaiting_review") await scriptedReview(app, p);
        if (["authorized", "executing", "awaiting_partner"].includes((await app.store.get(app.config.org, "proposal", p.id)).state)) await app.worker.execute(p.id);
      }
      await app.worker.drain();
    }
    if (await until()) return;
  }
  const rows = await Promise.all(h.apps.map(async a => ({ org: a.config.org,
    proposals: (await a.store.list(a.config.org, "proposal", 100)).map(p => ({ id: p.id, state: p.state,
      changedReason: p.changedReason, executionResults: p.executionResults })),
    jobs: (await a.store.query("SELECT kind,state,last_error FROM jobs WHERE state IN ('retry','failed')")).rows })));
  assert.fail("Expected owner-reviewed physical effect did not complete: " + JSON.stringify(rows));
}

test("HTTP received mixed staff and explicit peer consent enable qualified assessment, exact provisioning and an occupied four-owner shelter", async t => {
  const h = await createHarness({ scenario: "S19", seed: "mixed-staff-http-physical", organizations: 4,
    config: { compositionVariant: "delayed" } });
  t.after(() => h.close());
  const a = h.apps[0], crew = h.apps[2], recipient = h.apps[3], org = a.config.org;
  h.lab.world.advance(60000);
  // Real owner commands establish a heterogeneous depot and move away the
  // coordinator's only assessor. No candidate sees or edits evaluator truth.
  await crew.connector.action("purchase", { type: "staff", quantity: 2, price: 1, leadMs: 60000 }, "mixed-new-unqualified", { human: true });
  h.lab.world.advance(h.lab.world.now + 120000);
  const transfer = await a.connector.action("transfer", { resource: "r-org0-staff", quantity: 1, to: "org3" }, "mixed-move-own-assessor", { human: true });
  await recipient.connector.action("transfer", { action: "accept", id: transfer.id }, "mixed-receive-own-assessor", { human: true });
  const trip = await a.connector.action("dispatch", { transfer: transfer.id, vehicle: "v-org0-0" }, "mixed-assessor-trip", { human: true });
  for (let i = 0; i < 20; i++) {
    const state = await a.connector.state();
    if (state.operations.find(o => o.id === trip.id)?.state === "completed" && state.known.vehicles[trip.vehicle]?.state === "idle") break;
    h.lab.world.advance(h.lab.world.now + 120000);
  }
  assert.equal((await a.connector.state()).operations.find(o => o.id === trip.id).state, "completed");
  for (const app of h.apps) {
    for (const target of ["inventory", "vehicles", "map", "policy"]) await app.connector.action("query", { target }, `mixed-${app.config.org}-${target}`);
    await app.ingestion.sync({ sources: false });
  }
  const staffLots = (await crew.store.list("org2", "resource", 100)).filter(r => r.type === "staff");
  const mixed = staffLots.find(r => r.id === "r-org2-staff");
  const purchased = staffLots.find(r => r.id.startsWith("purchase-stock-"));
  // A purchase with no received shift calendar is a distinct source lot;
  // merging it into the existing calendar would invent working hours. The
  // depot still contains eight real people with heterogeneous qualifications.
  assert.equal(staffLots.reduce((n, r) => n + r.quantity, 0), 8);
  assert.equal(mixed.quantity, 6);
  assert.equal(purchased.quantity, 2); assert.deepEqual(purchased.qualifications, []);
  assert.deepEqual(purchased.qualificationCounts, {});
  assert.equal(mixed.qualificationCounts.field_assessment, 6);
  const building = (await a.store.get(org, "context", "geography")).map.places.find(b => b.use === "shelter");
  for (const app of h.apps.slice(1)) {
    const owner = (await app.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'", [app.config.org])).rows[0];
    for (const kind of ["resource", "vehicle"])
      for (const row of (await app.store.list(app.config.org, kind, 100)).filter(r => r.owner === app.config.org &&
        !(app.config.org === "org3" && kind === "resource" && r.type === "staff")))
        await app.network.share(owner, { kind, id: row.id, version: row.version, to: org }, "mixed-share-" + row.id);
    await app.worker.drain();
  }
  await a.connector.action("verify", { target: "building", id: building.id, method: "clarification" }, "mixed-site-metadata");
  await a.ingestion.sync({ sources: false });
  const plan = await assessmentPlan(a.store, org, building.id, { peers: [{ org: "org2" }] });
  assert.equal(plan.readyToDraft, true, JSON.stringify(plan)); assert.equal(plan.actions[0].owner, "org2");
  const draft = async (x, key) => a.domain.propose({ id: "test-agent", org, role: "agent" }, {
    title: "Qualified mixed staff work", summary: "Received competent capacity and independent owner approval",
    benefit: "A physical operating shelter", rationale: "Only exact qualified staff may be assigned", actions: x.actions,
    references: x.references, conditions: [], alternatives: [] }, key);
  const p = await draft(plan, "mixed-assessment-proposal");
  await scriptedReview(a, p); await a.worker.execute(p.id); await a.worker.drain();
  assert.equal((await crew.store.list("org2", "proposal", 100))[0].state, "awaiting_review");
  await advanceAll(h, async () => (await a.store.get(org, "proposal", p.id)).state === "completed");
  const service = await servicePlan(a.store, org, building.id);
  assert.equal(service.readyToDraft, true, JSON.stringify(service));
  const selected = service.actions.find(x => x.type === "dispatch" && x.params.resource === mixed.id);
  assert.deepEqual(selected.params.staffSkills, ["shelter_support"]); assert.equal(selected.owner, "org2");
  const s = await draft(service, "mixed-service-proposal");
  await scriptedReview(a, s); await a.worker.execute(s.id); await a.worker.drain();
  await advanceAll(h, async () => (await a.store.get(org, "proposal", s.id)).state === "completed");
  const physical = h.lab.world.building(building.id);
  assert.equal(physical.state, "operating"); assert.equal(physical.occupancy, 50);
  const staffDelivery = h.lab.world.state.operations.find(o => o.type === "delivery" && o.building === building.id && o.resource === mixed.id);
  assert.ok(staffDelivery.received > 0); assert.deepEqual(staffDelivery.receivedStaff.qualifications,
    ["field_assessment", "shelter_support", "water_operations"]);
  assert.equal(h.lab.world.resource(mixed.id).qualificationCounts.shelter_support, 6 - staffDelivery.received);
  assert.deepEqual(h.lab.world.invariants(), []);
});
