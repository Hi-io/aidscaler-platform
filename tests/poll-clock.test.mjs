import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createHarness, scriptedReview } from "../evaluation/harness.mjs";
import { effectiveNeed } from "../src/response-receipts.mjs";

const POLLS = 10;
const terminal = new Set(["completed", "failed"]);

async function peerJobs(app) {
  return (
    await app.store.query(
      "SELECT id,state,payload FROM jobs WHERE org=$1 AND kind='peer_send' ORDER BY created_at,id",
      [app.config.org],
    )
  ).rows;
}

async function continuations(app, proposal) {
  return (
    await app.store.query(
      "SELECT id,state,attempts FROM jobs WHERE org=$1 AND kind='continue_proposal' AND payload->>'id'=$2",
      [app.config.org, proposal],
    )
  ).rows;
}

// This regression uses the real actor HTTP boundary, two separate databases,
// owner approvals and signed peer transport. It does not replace the provider
// with a planner or reveal observer state to either platform. World inspection
// below is assertion-only, as it is in the comparative laboratory.
async function runCadence(t, wallGapMs) {
  let providerCalls = 0;
  const h = await createHarness({
    scenario: "S23",
    seed: "physical-poll-cadence-regression",
    organizations: 2,
    config: {
      extentKm: 20,
      postsPerHour: 0,
      healthReports: false,
      recurringNeeds: false,
      packetLoss: 0,
      backgroundTraffic: 0,
    },
    provider: {
      async complete() {
        providerCalls++;
        throw new Error("The polling regression must never invoke a provider.");
      },
    },
  });
  t.after(() => h.close());
  const [origin, owner] = h.apps;
  const w = h.lab.world;
  w.advance(60000);
  for (const app of h.apps) {
    for (const target of ["map", "inventory", "vehicles"])
      await app.connector.action(
        "query",
        { target },
        "poll-bootstrap-" + app.config.org + "-" + target,
      );
    await app.ingestion.sync({ sources: false });
  }

  const p = await origin.domain.propose(
    { org: "org0", id: "poll-regression-agent", role: "agent" },
    {
      title: "One partner shipment, independently authorized",
      summary: "A 300 litre partial water response",
      benefit: "Physical useful aid, not just a dispatched instruction",
      rationale:
        "Current actor-visible demand; the stock owner approves its own finite resource and vehicle.",
      references: ["need-water-main"],
      conditions: [],
      actions: [
        {
          type: "dispatch",
          owner: "org1",
          dependsOn: [],
          params: {
            resource: "r-org1-water",
            vehicle: "v-org1-0",
            need: "need-water-main",
            quantity: 300,
          },
        },
      ],
    },
    "poll-origin-proposal",
  );
  assert.equal(await scriptedReview(origin, p), true);
  await origin.worker.drain(32);
  // Each drain owns a finite created_at snapshot. The peer outbox produced by
  // execution is intentionally eligible only in the following drain.
  await origin.worker.drain(32);
  const partner = (await owner.store.list("org1", "proposal")).find(
    (x) => x.originProposal === p.id,
  );
  assert.ok(
    partner,
    "The request crossed signed peer HTTP into the other database",
  );
  assert.equal(partner.state, "awaiting_review");
  assert.equal(partner.authorization, null);
  assert.equal(
    w.state.operations.filter((o) => o.type === "delivery").length,
    0,
    "An origin's approval does not authorize the partner's stock",
  );
  assert.equal(await scriptedReview(owner, partner), true);
  await owner.worker.drain(32);
  await owner.worker.drain(32);
  assert.equal(
    w.state.operations.filter((o) => o.type === "delivery").length,
    1,
  );

  assert.equal(
    h.advanceUntil(
      () =>
        w.state.operations.some(
          (o) => o.type === "delivery" && o.state === "dispatched",
        ),
      300000,
    ),
    true,
  );
  w.advance(w.now + 5000);
  await owner.ingestion.sync({ sources: false });
  await owner.worker.execute(partner.id);
  await owner.worker.drain(32);
  await origin.worker.drain(32);

  const before = {
    now: w.now,
    peerJobs: (await peerJobs(owner)).length,
    transports: w.log.filter((e) => e.type === "platform_peer_transport")
      .length,
    dispatches: w.log.filter(
      (e) => e.type === "action_accepted" && e.data.type === "dispatch",
    ).length,
    journeys: w.log.filter(
      (e) => e.type === "vehicle_dispatched" && e.entity === "v-org1-0",
    ).length,
    served: w.need("need-water-main").served,
  };
  assert.equal(before.served, 0, "Transit is not useful service");
  assert.equal(before.dispatches, 1);
  assert.equal(before.journeys, 1);

  for (let i = 0; i < POLLS; i++) {
    if (wallGapMs) await delay(wallGapMs);
    await owner.worker.execute(partner.id);
    await owner.worker.drain(32);
    await origin.worker.execute(p.id);
    await origin.worker.drain(32);
    assert.equal(
      (await peerJobs(owner)).length,
      before.peerJobs,
      "Unchanged source polling cannot create another physical-event receipt",
    );
    assert.equal(
      w.now,
      before.now,
      "A wall-time continuation must not invent virtual network latency",
    );
    for (const [app, id] of [
      [origin, p.id],
      [owner, partner.id],
    ]) {
      const rows = await continuations(app, id);
      assert.equal(
        rows.length,
        1,
        "A proposal has one durable continuation identity",
      );
      assert.equal(
        rows.filter((j) => !terminal.has(j.state)).length,
        1,
        "Polling coalesces into one active continuation, including eligible worker polls",
      );
      assert.ok(
        rows[0].attempts <= 1,
        "An incomplete physical operation does not exhaust the retry budget",
      );
    }
  }
  assert.equal(
    w.log.filter((e) => e.type === "platform_peer_transport").length,
    before.transports,
  );
  assert.equal(
    w.log.filter(
      (e) => e.type === "action_accepted" && e.data.type === "dispatch",
    ).length,
    1,
  );
  assert.equal(
    w.log.filter(
      (e) => e.type === "vehicle_dispatched" && e.entity === "v-org1-0",
    ).length,
    1,
  );

  // Advance the same exogenous clock in both runs. A real unloading receipt,
  // rather than a boolean promise from the other organization, finishes work.
  w.advance(7200000);
  await owner.ingestion.sync({ sources: false });
  const finished = await owner.worker.execute(partner.id);
  assert.equal(finished.complete, true);
  await owner.worker.drain(32);
  await origin.worker.drain(32);
  assert.equal(
    (await origin.store.get("org0", "proposal", p.id)).state,
    "completed",
    "A completed peer receipt wakes the durable origin continuation without a direct origin execute",
  );
  const peerOperations = (await origin.store.list("org0", "operation")).filter(
    (o) => o.peerOwner === "org1",
  );
  assert.equal(peerOperations.length, 1);
  assert.equal(peerOperations[0].received, 300);
  assert.equal(peerOperations[0].confirmedBySource, true);
  assert.equal(
    effectiveNeed(
      await origin.store.get("org0", "need", "need-water-main"),
      peerOperations,
    ).served,
    300,
  );
  assert.equal(w.need("need-water-main").served, 300);
  const physical = w.state.operations.filter((o) => o.type === "delivery");
  assert.equal(physical.length, 1);
  assert.equal(physical[0].state, "completed");
  assert.equal(physical[0].received, 300);
  assert.equal(w.vehicle("v-org1-0").load, 0);
  assert.deepEqual(w.invariants(), []);
  assert.equal(w.state.invalidActions, 0);
  assert.equal(providerCalls, 0);

  const completedReceipts = (await peerJobs(owner)).filter(
    (j) => j.payload.message.projection.state === "completed",
  );
  assert.equal(completedReceipts.length, 1);
  const peerCount = (await peerJobs(owner)).length;
  const finalNow = w.now;
  for (let i = 0; i < 3; i++) {
    await owner.worker.execute(partner.id);
    await owner.worker.drain(32);
    await origin.worker.execute(p.id);
    await origin.worker.drain(32);
  }
  assert.equal((await peerJobs(owner)).length, peerCount);
  assert.equal(w.now, finalNow);
  for (const [app, id] of [
    [origin, p.id],
    [owner, partner.id],
  ])
    assert.equal(
      (await continuations(app, id)).filter((j) => !terminal.has(j.state))
        .length,
      0,
    );

  return {
    before,
    finalNow,
    totalTransports: w.log.filter((e) => e.type === "platform_peer_transport")
      .length,
    dispatches: w.log.filter(
      (e) => e.type === "action_accepted" && e.data.type === "dispatch",
    ).length,
    journeys: w.log.filter(
      (e) => e.type === "vehicle_dispatched" && e.entity === "v-org1-0",
    ).length,
    physicalTimes: physical[0].times,
    received: physical[0].received,
    served: w.need("need-water-main").served,
    ownerReceipts: peerCount,
    finalProposalState: (await origin.store.get("org0", "proposal", p.id))
      .state,
  };
}

test(
  "HTTP owner work and useful peer receipts are invariant under fast vs one-second wall polling",
  { timeout: 120000 },
  async (t) => {
    const fast = await runCadence(t, 0);
    const wall = await runCadence(t, 1100);
    assert.deepEqual(
      wall,
      fast,
      "Same world, approvals and physical actions must not depend on CPU or wall polling cadence",
    );
  },
);
