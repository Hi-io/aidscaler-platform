import test from "node:test";
import assert from "node:assert/strict";
import { runEpisode } from "../evaluation/harness.mjs";

test("a safe evaluation stop preserves the fixed horizon and does not launch a paid round", async () => {
  let providerCalls = 0;
  const result = await runEpisode({
    arm: "B6",
    scenario: "S23",
    seed: "safe-round-stop",
    planningRounds: 4,
    shouldStop: () => true,
    provider: {
      complete: async () => {
        providerCalls++;
        throw Error("Unexpected provider call");
      },
    },
    config: { healthReports: false, recurringNeeds: false, postsPerHour: 0 },
  });
  assert.equal(result.status, "aborted");
  assert.equal(result.roundsExecuted, 0);
  assert.equal(providerCalls, 0);
  assert.equal(result.usage.length, 0);
  assert.equal(result.costUsd, 0);
  assert.ok(Number.isFinite(result.stopRequestedAt));
  assert.ok(result.errors.some((e) => e.code === "CAMPAIGN_INTERRUPTED"));
  assert.equal(result.invariants.length, 0);
  assert.equal(result.candidateChanged, false);
  assert.equal(result.evaluatorChanged, false);
  assert.equal(result.simulatorChanged, false);
  assert.equal(result.metrics.services.water.served, 0);
  assert.ok(result.metrics.services.water.pending > 0);
});
