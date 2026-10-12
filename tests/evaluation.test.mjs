import test from "node:test";
import assert from "node:assert/strict";
import { pairedBootstrap, gates } from "../src/evaluation.mjs";
const row = (seed, v, extra = {}) => ({
  seed,
  scenario: "S23",
  manifest: {
    engineBuild: "fixed",
    config: { seed, scenario: "S23", mode: "modeled", policy: "none" },
  },
  measurementMode: "modeled",
  metrics: { simulatedMs: 1000, services: { water: { uncoveredUnitMs: v } } },
  ...extra,
});
test("paired outcomes reject missing worlds, mismatched clocks, duplicate replicates and non-finite results", () => {
  assert.throws(() => pairedBootstrap([row("a", 10)], []), /Every baseline/);
  assert.throws(
    () =>
      pairedBootstrap(
        [row("a", 10)],
        [row("a", 5, { measurementMode: "live" })],
      ),
    /must match/,
  );
  assert.throws(
    () => pairedBootstrap([row("a", 10), row("a", 20)], [row("a", 5)]),
    /Duplicate/,
  );
  const result = pairedBootstrap(
    [row("a", 100), row("b", 200)],
    [row("a", 50), row("b", 100)],
  );
  assert.equal(result.improvement, 0.5);
  assert.deepEqual(result.relativeInterval95, [0.5, 0.5]);
  assert.equal(result.evidenceLevel, "exploratory_pilot");
  const replica = pairedBootstrap(
    [row("a", 100), row("a", 100, { replicate: 1 })],
    [row("a", 50), row("a", 50, { replicate: 1 })],
  );
  assert.equal(replica.pairs, 1);
});
test("arrival with receipt pending is not mislabeled an integrity failure", () => {
  assert.equal(
    gates({
      ledgerValid: true,
      coordination: { orphanReservations: 0 },
      physical: { arrivedNotReceived: 1 },
    }).integrity,
    true,
  );
  assert.equal(
    gates({
      ledgerValid: true,
      coordination: { orphanReservations: 0 },
      physical: { arrivedNotReceived: 1 },
    }).pendingReceipts,
    1,
  );
});
