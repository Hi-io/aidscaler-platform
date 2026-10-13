import test from "node:test";
import assert from "node:assert/strict";
import { createHarness, scriptedReview } from "../evaluation/harness.mjs";
import { receivedAllocationPlan } from "../src/received-allocation.mjs";

// Physical setup belongs to the test laboratory. Every decision below uses
// ordinary source HTTP, received records and signed, owner-consented offers.
// No provider is attached and no observer state is supplied to a planner.
async function fixture(t) {
  const h = await createHarness({
    scenario: "S01",
    organizations: 2,
    seed: "literal-empty-return-window",
    config: {
      grid: 5,
      extentKm: 1,
      hazard: "none",
      postsPerHour: 0,
      backgroundTraffic: 0,
      packetLoss: 0,
      durationMs: 7200000,
      networkLatencyMs: 1000,
      loadMs: 10000,
      unloadMs: 10000,
    },
  });
  t.after(() => h.close());
  const w = h.lab.world;
  for (const r of w.state.resources.filter((r) => r.type === "water")) {
    r.quantity = ["org0", "org1"].includes(r.owner) ? 300 : 0;
    r.reserved = 0;
    r.floor = 0;
    w.observeResource(r.owner, r);
  }
  for (const v of w.state.vehicles.filter((v) => !v.background)) {
    if (!["v-org0-0", "v-org1-0"].includes(v.id)) v.state = "disabled";
    else {
      v.capacity = 300;
      v.maxCargoKg = 300;
      v.volumeM3 = 1;
    }
    if (v.id === "v-org1-0")
      v.calendar = {
        ...v.calendar,
        version: 1,
        observedAt: 0,
        availableAfter: 600000,
        availableUntil: 7000000,
        nextCommitment: {
          id: "next-owner-shift",
          startsAt: 6900000,
          node: w.organization("org1").node,
        },
      };
    w.reportVehicle(v);
    w.state.observations[v.owner].vehicles[v.id] = w.vehicleView(v);
  }
  const sent = new Set();
  const transport = async (app) => {
    for (const job of (
      await app.store.query(
        "SELECT id,payload FROM jobs WHERE org=$1 AND kind='peer_send' ORDER BY created_at,id",
        [app.config.org],
      )
    ).rows) {
      if (sent.has(job.id)) continue;
      await app.network.send(job.payload);
      sent.add(job.id);
    }
  };
  const refresh = async (app) => {
    for (const target of ["inventory", "vehicles", "map", "policy"])
      await app.connector.action(
        "query",
        { target },
        "return-window-query-" + app.config.org + "-" + target + "-" + w.now,
      );
    await app.ingestion.sync({ sources: false });
  };
  const share = async () => {
    const app = h.apps[1],
      org = "org1";
    for (const [kind, id] of [
      ["resource", "r-org1-water"],
      ["vehicle", "v-org1-0"],
    ]) {
      const row = await app.store.get(org, kind, id);
      await app.network.share(
        { org, id: "source-owner", role: "commander" },
        { kind, id, version: row.version, to: "org0" },
        "return-window-share-" + kind + "-" + row.version,
      );
    }
    await transport(app);
  };
  // The source publishes the initial need at minute 0.5. Do not inject a
  // need directly into the candidate's store before that real report.
  h.advanceUntil(() => w.now >= 30000);
  await refresh(h.apps[0]);
  await refresh(h.apps[1]);
  await share();
  return { h, w, refresh, share, transport };
}
async function propose(app, plan, key) {
  return app.domain.propose(
    { org: app.config.org, id: "received-planner", role: "agent" },
    {
      title: "Use current received capacity within the owner's window",
      summary:
        "A currently available vehicle must preserve its next commitment.",
      rationale:
        "Received inventory, calendar and roads; every owner reviews independently.",
      benefit: "A physically receipted 300 L contribution",
      references: plan.evidenceIds,
      actions: plan.actions,
      conditions: [],
      alternatives: [],
    },
    key,
  );
}

for (const variant of ["favorable", "short_window", "owner_declines"])
  test(
    `S01 ${variant}: the exact returning truck is required for the second 300 L and cannot bypass its owner or declared window`,
    { timeout: 120000 },
    async (t) => {
      const { h, w, refresh, share, transport } = await fixture(t),
        coordinator = h.apps[0],
        owner = h.apps[1];
      let plan = await receivedAllocationPlan(
        coordinator.store,
        coordinator.config,
        { needIds: ["need-water-main"] },
      );
      const returnOffer = (
        await coordinator.store.list("org0", "peer_offer", 100)
      ).find(
        (o) =>
          o.kind === "vehicle" &&
          (o.sourceId === "v-org1-0" || o.projection?.id === "v-org1-0"),
      );
      assert.equal(
        returnOffer?.projection.calendar.plannedReturn.cargo,
        0,
        "The future empty return is received owner metadata, not observer state.",
      );
      assert.equal(plan.allocations.length, 1, JSON.stringify(plan));
      assert.equal(plan.allocations[0].vehicle, "v-org0-0");
      assert.equal(
        plan.unserved[0].remaining,
        300,
        "Future busy capacity remains a deficit, not a fictional reservation.",
      );
      const first = await propose(coordinator, plan, "return-window-first");
      assert.equal(await scriptedReview(coordinator, first), true);
      await coordinator.worker.execute(first.id);
      assert.equal(
        w.state.operations.filter((o) => o.type === "delivery").length,
        1,
      );
      h.advanceUntil(() =>
        w.state.operations.some(
          (o) => o.vehicle === "v-org0-0" && o.received === 300,
        ),
      );
      await refresh(coordinator);
      await coordinator.worker.execute(first.id);
      assert.equal(w.need("need-water-main").served, 300);
      assert.equal(
        (await coordinator.store.get("org0", "proposal", first.id)).state,
        "completed",
      );
      h.advanceUntil(
        () =>
          ["idle", "arrived"].includes(w.vehicle("v-org1-0").state) &&
          w.vehicle("v-org1-0").node === w.organization("org1").node,
      );
      const returnedAt = w.now;
      assert.ok(returnedAt >= 600000);
      assert.equal(w.vehicle("v-org1-0").load ?? 0, 0);
      assert.equal(
        w.state.operations.filter((o) => o.vehicle === "v-org1-0").length,
        0,
        "The original empty return is a real pre-existing trip; it is not a second aid shipment.",
      );
      if (variant === "short_window") {
        const vehicle = w.vehicle("v-org1-0");
        vehicle.calendar = {
          ...vehicle.calendar,
          version: (vehicle.calendar?.version ?? 1) + 1,
          observedAt: w.now,
          availableUntil: w.now + 20000,
          nextCommitment: {
            id: "urgent-next-task",
            startsAt: w.now + 20000,
            node: vehicle.node,
          },
        };
        vehicle.version++;
        w.reportVehicle(vehicle);
      }
      await refresh(owner);
      await refresh(coordinator);
      await share();
      // Capture the actual heterogeneous note, without claiming this recorded
      // functional fixture establishes a learned interpretation advantage.
      await coordinator.ingestion.sync({ sources: true });
      assert.ok(
        (await coordinator.store.list("org0", "signal", 2000)).some((s) =>
          /drives back empty/i.test(s.text),
        ),
      );
      plan = await receivedAllocationPlan(
        coordinator.store,
        coordinator.config,
        { needIds: ["need-water-main"] },
      );
      if (variant === "short_window") {
        assert.equal(plan.actions.length, 0);
        assert.equal(plan.unserved[0].remaining, 300);
        assert.equal(
          plan.unserved[0].blockingReasons[0].code,
          "VEHICLE_CALENDAR",
        );
        assert.equal(w.need("need-water-main").served, 300);
        assert.equal(w.resource("r-org1-water").reserved, 0);
        return;
      }
      assert.equal(plan.allocations.length, 1);
      assert.equal(plan.allocations[0].quantity, 300);
      assert.equal(plan.allocations[0].vehicle, "v-org1-0");
      assert.equal(plan.allocations[0].owner, "org1");
      assert.ok(
        plan.allocations[0].travelEstimate.calendar.nextReturnAt > returnedAt,
      );
      const second = await propose(coordinator, plan, "return-window-second");
      assert.equal(await scriptedReview(coordinator, second), true);
      await coordinator.worker.execute(second.id);
      await transport(coordinator);
      const peer = (await owner.store.list("org1", "proposal")).find(
        (p) => p.originProposal === second.id,
      );
      assert.ok(peer);
      assert.equal(peer.state, "awaiting_review");
      assert.equal(
        w.state.operations.filter((o) => o.vehicle === "v-org1-0").length,
        0,
        "The first owner's approval and a signed request grant no authority over the peer truck.",
      );
      if (variant === "owner_declines") {
        await owner.domain.review(
          { org: "org1", id: "responsible-peer", role: "commander" },
          peer.id,
          {
            version: peer.version,
            decision: "reject",
            note: "Preserve this vehicle for independent local work.",
          },
          "return-window-decline",
        );
        await owner.network.response(peer, "rejected", {
          reason: "Owner retained its capacity.",
        });
        await transport(owner);
        await coordinator.worker.execute(second.id);
        assert.notEqual(
          (await coordinator.store.get("org0", "proposal", second.id)).state,
          "completed",
        );
        assert.equal(w.need("need-water-main").served, 300);
        assert.equal(
          w.state.operations.filter((o) => o.vehicle === "v-org1-0").length,
          0,
        );
        assert.equal(w.resource("r-org1-water").reserved, 0);
        return;
      }
      assert.equal(await scriptedReview(owner, peer), true);
      await owner.worker.execute(peer.id);
      h.advanceUntil(() =>
        w.state.operations.some(
          (o) => o.vehicle === "v-org1-0" && o.received === 300,
        ),
      );
      await refresh(owner);
      await owner.worker.execute(peer.id);
      await transport(owner);
      await coordinator.ingestion.sync({ sources: false });
      await coordinator.worker.execute(second.id);
      const deliveries = w.state.operations.filter(
        (o) => o.type === "delivery",
      );
      assert.deepEqual(
        deliveries.map((o) => [o.vehicle, o.quantity, o.received]).sort(),
        [
          ["v-org0-0", 300, 300],
          ["v-org1-0", 300, 300],
        ],
      );
      const returnedDelivery = deliveries.find((o) => o.vehicle === "v-org1-0");
      assert.ok(returnedDelivery.times.authorized >= returnedAt);
      assert.equal(w.need("need-water-main").served, 600);
      assert.equal(
        (await coordinator.store.get("org0", "proposal", second.id)).state,
        "completed",
      );
      h.advanceUntil(
        () =>
          w.vehicle("v-org1-0").node === w.organization("org1").node &&
          ["idle", "arrived"].includes(w.vehicle("v-org1-0").state),
      );
      assert.ok(
        w.now <= w.vehicle("v-org1-0").calendar.nextCommitment.startsAt,
      );
      assert.equal(w.vehicle("v-org1-0").load ?? 0, 0);
      assert.equal(
        w.state.operations.filter((o) => o.type === "delivery").length,
        2,
      );
    },
  );
