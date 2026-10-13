import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { responseQueue } from "../src/response-policy.mjs";
import { receivedAllocationPlan } from "../src/received-allocation.mjs";
import { assessmentPlan } from "../src/services.mjs";
import { createHarness, scriptedReview } from "../evaluation/harness.mjs";

async function fixture(t, owner) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  const config = { org: "org0", peers: [{ org: "org1" }] };
  await store.upsert("org0", "need", "water", {
    type: "water",
    quantity: 100,
    served: 0,
    unit: "L",
    deadline: 900000,
  });
  const rows = [
    [
      "resource",
      {
        id: "water-stock",
        owner,
        type: "water",
        quantity: 100,
        available: 100,
        reserved: 0,
        floor: 0,
      },
    ],
    [
      "resource",
      {
        id: "assessors",
        owner,
        type: "staff",
        quantity: 2,
        available: 2,
        reserved: 0,
        floor: 0,
        qualifications: ["field_assessment"],
      },
    ],
    ["vehicle", { id: "crew", owner, capacity: 100, seats: 1, state: "idle" }],
    ["vehicle", { id: "backup", owner, capacity: 100, seats: 1, state: "idle" }],
  ];
  for (const [kind, row] of rows) {
    if (owner === config.org) await store.upsert(config.org, kind, row.id, row);
    else
      await store.upsert(config.org, "peer_offer", `${owner}-${row.id}`, {
        from: owner,
        kind,
        active: true,
        expiresAt: Date.now() + 600000,
        permissionVersion: 1,
        projection: row,
      });
  }
  await store.upsert(config.org, "facility", "another-site", {
    use: "shelter",
    node: "site",
    capacity: 20,
    sourceVersion: 1,
  });
  const proposal = await store.upsert(config.org, "proposal", "field-review", {
    state: "awaiting_review",
    actions: [
      {
        type: "verify",
        owner,
        params: {
          target: "building",
          id: "first-site",
          method: "field",
          purpose: "facility_safety",
          staff: "assessors",
          vehicle: "crew",
          targetVersion: 1,
          validForMs: 21600000,
        },
        dependsOn: [],
      },
    ],
  });
  return { store, config, proposal };
}

test("a pending owner-approved assessment and concurrent aid use separate real vehicles with the unchanged fleet", async (t) => {
  const h = await createHarness({
    scenario: "S19",
    config: { compositionVariant: "distributed" },
    seed: "assessment-and-aid-concurrent",
    organizations: 4,
  });
  t.after(() => h.close());
  h.lab.world.advance(60000);
  for (const app of h.apps) {
    for (const target of ["inventory", "vehicles", "map", "policy"])
      await app.connector.action(
        "query",
        { target },
        `crew-hold-${app.config.org}-${target}`,
      );
    await app.ingestion.sync({ sources: false });
  }
  const app = h.apps[0],
    org = app.config.org,
    site = (await app.store.get(org, "context", "geography")).map.places.find(
      (p) => p.use === "shelter",
    );
  assert.ok(
    site,
    "The service site is selected from the received public directory",
  );
  await app.connector.action(
    "verify",
    { target: "building", id: site.id, method: "clarification" },
    "crew-hold-site-metadata",
  );
  await app.connector.action(
    "verify",
    { target: "need", id: "need-water-main", method: "clarification" },
    "crew-hold-water-demand",
  );
  await app.ingestion.sync({ sources: false });
  for (const peer of h.apps.slice(1)) {
    const actor = (
      await peer.store.query(
        "SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",
        [peer.config.org],
      )
    ).rows[0];
    for (const kind of ["resource", "vehicle"])
      for (const row of (
        await peer.store.list(peer.config.org, kind, 100)
      ).filter((r) => r.owner === peer.config.org))
        await peer.network.share(
          actor,
          { kind, id: row.id, version: row.version, to: org },
          `crew-hold-share-${row.id}`,
        );
    await peer.worker.drain();
  }
  const assessment = await assessmentPlan(app.store, org, site.id, {
    peers: app.config.peers,
  });
  assert.equal(assessment.readyToDraft, true, JSON.stringify(assessment));
  const crew = assessment.actions[0];
  const p = await app.domain.propose(
    { id: "common-compiler-fixture", org, role: "agent" },
    {
      title: "Assess the public service site with an available qualified crew",
      summary: "Each owner approves its own finite physical work",
      benefit: "A source-confirmed assessment, not presumed site safety",
      rationale:
        "The shared compiler identifies the same exact crew for any planning policy",
      actions: assessment.actions,
      references: assessment.references,
      conditions: [],
      alternatives: [],
    },
    "crew-hold-assessment-draft",
  );
  await scriptedReview(app, p);
  await app.worker.execute(p.id);
  await app.worker.drain();
  const aid = await receivedAllocationPlan(app.store, app.config, {
    needIds: ["need-water-main"],
  });
  assert.ok(aid.allocations.length > 0, JSON.stringify(aid));
  assert.ok(
    !aid.allocations.some(
      (a) => a.owner === crew.owner && a.vehicle === crew.params.vehicle,
    ),
    "The prospective field crew cannot be stolen before its owner's command is received",
  );
  const q = await app.domain.propose(
    { id: "common-compiler-fixture", org, role: "agent" },
    {
      title:
        "Deliver useful water concurrently through the remaining received fleet",
      summary: "No extra vehicle or artificial reservation is introduced",
      benefit:
        "Aid and field work can both progress using distinct existing transport",
      rationale:
        "Capacity, prospective field assignment and all independent owners remain checked",
      actions: aid.actions,
      references: aid.evidenceIds,
      conditions: [],
      alternatives: [],
    },
    "crew-hold-aid-draft",
  );
  await scriptedReview(app, q);
  await app.worker.execute(q.id);
  await app.worker.drain();
  let physical;
  for (let i = 0; i < 30; i++) {
    h.lab.world.advance(h.lab.world.now + 60000);
    for (const current of h.apps) {
      await current.ingestion.sync({ sources: false });
      for (const proposal of await current.store.list(
        current.config.org,
        "proposal",
        100,
      )) {
        if (proposal.state === "awaiting_review")
          await scriptedReview(current, proposal);
        const state = (
          await current.store.get(current.config.org, "proposal", proposal.id)
        ).state;
        if (["authorized", "executing", "awaiting_partner"].includes(state))
          await current.worker.execute(proposal.id);
      }
      await current.worker.drain();
    }
    const peer = h.apps.find((a) => a.config.org === crew.owner);
    physical = (await peer.connector.state()).inspections.find(
      (i) => i.entity === site.id && i.method === "field" && !i.sourceOwner,
    );
    if (
      physical?.state === "completed" &&
      h.lab.world.need("need-water-main").served >= 100
    )
      break;
  }
  assert.equal(physical?.state, "completed");
  assert.equal(physical.vehicle, crew.params.vehicle);
  assert.ok(physical.observedAt > physical.startedAt);
  const cargo = h.lab.world.state.operations.filter(
    (o) => o.type === "delivery" && o.need === "need-water-main",
  );
  assert.ok(cargo.some((o) => o.state === "completed" && o.received > 0));
  assert.ok(
    cargo.every(
      (o) => o.org !== crew.owner || o.vehicle !== crew.params.vehicle,
    ),
  );
  assert.deepEqual(h.lab.world.invariants(), []);
});

for (const owner of ["org0", "org1"]) {
  test(`${owner} assessment awaiting review cannot lose its assigned mobile crew to an aid allocation`, async (t) => {
    const { store, config, proposal } = await fixture(t, owner);
    const queue = await responseQueue(store, config.org);
    const hold = queue.planningHolds.find((h) => h.proposal === proposal.id);
    assert.ok(
      hold,
      "A field-review draft must hold its exact crew prospectively",
    );
    assert.equal(hold.owner, owner);
    assert.equal(hold.vehicle, "crew");
    assert.equal(hold.resource, "assessors");
    assert.equal(hold.quantity, 1);
    assert.deepEqual(
      hold.needIds,
      [],
      "One assessor is not a served unit of aid",
    );
    assert.equal(queue.rows[0].planningOutstanding, 100);
    const plan = await receivedAllocationPlan(store, config);
    assert.equal(plan.allocations.length, 1);
    assert.equal(plan.allocations[0].quantity, 100);
    assert.equal(plan.allocations[0].vehicle, "backup");
    assert.equal(plan.allocations[0].owner, owner);
    assert.equal(
      (await store.list(config.org, "operation")).length,
      0,
      "A planning hold neither dispatches aid nor starts an inspection",
    );
  });

  test(`${owner} source-reserved field staff are not subtracted twice, but the vehicle remains held until receipt`, async (t) => {
    const { store, config, proposal } = await fixture(t, owner);
    await store.upsert(config.org, "proposal", proposal.id, {
      state: "executing",
      executionResults: [
        {
          index: 0,
          ...(owner === config.org
            ? { result: { id: "actual-field" } }
            : { partnerResult: { id: "actual-field" } }),
        },
      ],
    });
    const verificationId =
      owner === config.org ? "actual-field" : "peer:org1:actual-field";
    await store.upsert(config.org, "verification", verificationId, {
      sourceId: "actual-field",
      id: verificationId,
      target: "building",
      entity: "first-site",
      method: "field",
      purpose: "facility_safety",
      state: "traveling",
      staff: "source-reservation",
      sourceOwner: owner,
      vehicle: "crew",
      targetVersion: 1,
    });
    if (owner === config.org)
      await store.upsert(config.org, "resource", "assessors", {
        quantity: 2,
        reserved: 1,
        floor: 0,
        available: 1,
      });
    else
      await store.upsert(config.org, "peer_offer", `${owner}-assessors`, {
        projection: {
          id: "assessors",
          owner,
          type: "staff",
          quantity: 2,
          available: 1,
          reserved: 1,
          floor: 0,
          qualifications: ["field_assessment"],
        },
      });
    const queue = await responseQueue(store, config.org);
    const hold = queue.planningHolds.find((h) => h.proposal === proposal.id);
    assert.equal(hold.vehicle, "crew");
    assert.equal(
      hold.quantity,
      0,
      "The source already reports the staff reservation",
    );
    const second = await assessmentPlan(store, config.org, "another-site", {
      peers: config.peers,
    });
    assert.equal(second.readyToDraft, true, JSON.stringify(second));
    assert.equal(second.actions[0].params.vehicle, "backup");
    await store.upsert(config.org, "verification", verificationId, {
      state: "completed",
    });
    const after = await responseQueue(store, config.org);
    assert.ok(!after.planningHolds.some((h) => h.proposal === proposal.id));
    const released = await receivedAllocationPlan(store, config, {
      excludeVehicles: [{ owner, id: "backup" }],
    });
    assert.equal(released.allocations[0].vehicle, "crew");
  });

  test(`${owner} rejecting an unissued field draft releases only the prospective assignment`, async (t) => {
    const { store, config, proposal } = await fixture(t, owner);
    await store.upsert(config.org, "proposal", proposal.id, {
      state: "rejected",
    });
    const queue = await responseQueue(store, config.org);
    assert.ok(!queue.planningHolds.some((h) => h.proposal === proposal.id));
    const plan = await receivedAllocationPlan(store, config, {
      excludeVehicles: [{ owner, id: "backup" }],
    });
    assert.equal(plan.allocations[0].vehicle, "crew");
    assert.equal((await store.list(config.org, "operation")).length, 0);
    assert.equal((await store.list(config.org, "verification")).length, 0);
  });
}
