import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDiscovery } from "../evaluation/discovery-benchmark.mjs";

function row(seed, arm, minutes, { status = "completed", completed = 2 } = {}) {
  const time = { restrictedMeanMs: minutes * 60000, completed, eligible: 2 };
  return { seed, arm, status, candidateFingerprint: "candidate", evaluatorFingerprint: "evaluator",
    candidateChanged: false, evaluatorChanged: false, protocol: { horizonMs: 7200000 },
    corpus: { seed, config: { count: 2 } }, manifest: { engineBuild: "engine", config: { seed } },
    metrics: { simulatedMs: 7200000, services: { water: { uncoveredUnitMs: minutes * 60000 * 40 } } },
    timeToSufficientService: time, timeToFirstUsefulService: time,
    outcomes: [{ id: "a" }, { id: "b" }], errors: status === "failed" ? [{ phase: "model-discovery" }] : [],
    invariants: [], costUsd: 0, chargedBudgetUsd: 0 };
}
test("discovery effects cluster seeds and retain censored failures rather than excluding them", () => {
  const rows = [row("seed-a", "B5", 60), row("seed-a", "B6", 30),
    row("seed-b", "B5", 60), row("seed-b", "B6", 120, { status: "failed", completed: 0 })];
  const s = summarizeDiscovery(rows), c = s.comparisons[0];
  assert.equal(s.failedRuns, 1);
  assert.equal(s.modelFailures, 1);
  assert.equal(c.independentWorlds, 2);
  assert.equal(c.timeEffects.sufficient.pairs, 2);
  assert.equal(c.restrictedMeanTimeReduction, -0.25);
  assert.equal(c.completed.candidate, 2);
  assert.equal(c.timeEffects.sufficient.evidenceLevel, "exploratory_pilot");
  assert.ok(c.timeEffects.sufficient.relativeInterval95[0] < 0);
  assert.ok(c.timeEffects.sufficient.relativeInterval95[1] > 0);
  assert.deepEqual(summarizeDiscovery(rows), s);
});
test("response-effect comparison rejects changed source builds and missing censored clocks", () => {
  const a = row("seed-a", "B5", 60), b = row("seed-a", "B6", 30);
  assert.throws(() => summarizeDiscovery([a, { ...b, candidateFingerprint: "other" }]), /matching frozen/);
  assert.throws(() => summarizeDiscovery([a, { ...b, timeToFirstUsefulService: {} }]), /Missing censored/);
});
