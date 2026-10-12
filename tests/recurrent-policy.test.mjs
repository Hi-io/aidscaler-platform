import test from "node:test";
// The competent shared reference must also terminate after an owner declines
// an infeasible second-round request. Previously it retried the same review.
import assert from "node:assert/strict";
import { runEpisode } from "../evaluation/harness.mjs";
import { Store } from "../src/store.mjs";
import { OpenRouterProvider } from "../src/provider.mjs";
import { pairedBootstrap } from "../src/evaluation.mjs";

test("shared incident research does not repeat at each resource owner, while four scoped owner instances remain", async () => {
  const calls = [];
  const result = await runEpisode({
    arm: "B6",
    scenario: "S01",
    planningRounds: 2,
    config: { durationMs: 1800000 },
    provider: {
      async complete(request) {
        calls.push({ org: request.org, episode: request.episode });
        return {
          model: "scripted-topology-fixture",
          message: {
            role: "assistant",
            content: "No executable plan in this topology fixture.",
          },
          usage: {},
        };
      },
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(
    result.planningTopology,
    "one_incident_coordinator_independent_owner_review",
  );
  assert.equal(result.platformEvidence.length, 4);
  assert.deepEqual(
    calls.map((c) => c.org),
    ["org0", "org0"],
  );
  assert.equal(new Set(calls.map((c) => c.episode)).size, 2);
  assert.equal(result.activities.length, 2);
  assert.equal(result.invariants.length, 0);
});

test("recurrent reference policy receives a second scheduled opportunity without creating additional stock", async () => {
  const r = await runEpisode({
    arm: "B1",
    scenario: "S23",
    planningRounds: 2,
    policyIntervalMs: 120000,
    config: { durationMs: 1800000 },
  });
  assert.equal(r.status, "completed");
  assert.equal(r.roundsExecuted, 2);
  assert.equal(r.activities.length, 2);
  assert.ok(r.activities[1].atSim >= 180000);
  assert.equal(r.usage.length, 0);
  assert.equal(r.invariants.length, 0);
  assert.equal(r.metrics.services.water.served, 500);
  const unequal = { ...r, planningRounds: 1 };
  assert.throws(
    () => pairedBootstrap([r], [unequal]),
    (e) => e.code === "EVALUATION_CONFIG",
  );
});
test("shared owners decline infeasible unchanged requests instead of repeatedly retrying reviews", async () => {
  const r = await runEpisode({
    arm: "B5",
    scenario: "S23",
    seed: "pilot-2026-01",
    planningRounds: 2,
  });
  assert.equal(r.status, "completed");
  assert.equal(r.invariants.length, 0);
  assert.equal(r.errors.filter((e) => e.code === "VEHICLE_BUSY").length, 0);
  assert.equal(r.metrics.services.water.served, 600);
  assert.ok(
    r.wallMs < 120000,
    "A two-round deterministic development episode should finish within its bounded local budget.",
  );
});
test("cumulative model budget covers all rounds and unknown-cost attempts rather than resetting each turn", async (t) => {
  const s = await Store.open();
  await s.organization("org0");
  t.after(() => s.close());
  await s.query(
    "INSERT INTO usage(id,org,episode,model,request_hash,state,started_at,reserved_usd) VALUES('old','org0','run-round0','fixture','fixture','failed',$1,.9)",
    [Date.now()],
  );
  const p = new OpenRouterProvider(
    s,
    {
      apiKey: "test-only-key",
      modelId: "fixture",
      maxCalls: 8,
      modelScopePrefix: "run-",
      modelScopeCalls: 24,
      budgetUsd: 1,
      hourlyCallLimit: 40,
      // Isolate the episode cap; the larger output/price reservation also
      // correctly exceeds the default hourly cap, which is tested separately.
      hourlyBudgetUsd: 10,
    },
    () => {
      throw Error("A budget rejection must happen before provider execution");
    },
  );
  p.pricing = {
    model: "fixture",
    rates: { prompt: "0", completion: "0.0001" },
  };
  await assert.rejects(
    p.complete({ org: "org0", episode: "run-round1", messages: [] }),
    (e) => e.code === "MODEL_BUDGET",
  );
  await assert.rejects(
    p.complete({ org: "org0", episode: "different-run", messages: [] }),
    (e) => e.code === "MODEL_SCOPE",
  );
  assert.equal((await s.query("SELECT COUNT(*) AS n FROM usage")).rows[0].n, 1);
});
