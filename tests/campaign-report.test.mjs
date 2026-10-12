import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCampaign } from "../evaluation/campaign-summary.mjs";
import { ModelBudgetPool } from "../src/budget-pool.mjs";
const row = (arm, budget) => ({
  scenario: "S19",
  seed: "pilot-2026-01",
  arm,
  status: "failed",
  manifest: {
    config: { seed: "pilot-2026-01", scenario: "S19" },
    engineBuild: "fixed",
  },
  episodeBudgetUsd: budget,
  metrics: {
    simulatedMs: 1000,
    services: { water: { uncoveredUnitMs: 100 } },
    ledgerValid: true,
  },
  invariants: [],
  costUsd: 0.01,
  chargedBudgetUsd: 0.01,
  unknownCostCalls: 0,
});
test("incomparable budgets retain both failed outcomes and do not crash campaign summaries", () => {
  const report = summarizeCampaign({
    folder: "reports/evaluations/test",
    protocol: { scenarios: ["S19"], seeds: 1, arms: ["B1", "B4"] },
    rows: [row("B1", 0.25), row("B4", 0.24)],
  });
  assert.equal(report.runs, 2);
  assert.equal(report.complete, true);
  assert.equal(report.costUsd, 0.02);
  assert.equal(report.comparisons[0].comparisonRejected, true);
  assert.equal(report.comparisons[0].reason, "EVALUATION_CONFIG");
  assert.equal(report.comparisons[0].improvement, null);
  assert.equal(report.gates.filter((g) => g.status === "failed").length, 2);
});
test("one shared inference budget permits a busy owner without fixed quarters and retains unknown-cost reservations", () => {
  const pool = new ModelBudgetPool({ budgetUsd: 0.25, calls: 4 });
  const a = pool.reserve(0.1);
  pool.settle(a, 0.08);
  const b = pool.reserve(0.1);
  pool.settle(b, null);
  assert.equal(pool.chargedUsd, 0.18);
  assert.throws(
    () => pool.reserve(0.08),
    (e) => e.code === "MODEL_BUDGET",
  );
  const c = pool.reserve(0.02);
  pool.cancel(c);
  assert.equal(pool.entries.size, 2);
  const d = pool.reserve(0.02);
  pool.settle(d, 0.01);
  pool.settle(d, 0);
  assert.equal(pool.entries.size, 3);
  assert.equal(pool.chargedUsd, 0.19);
  const e = pool.reserve(0.01);
  pool.settle(e, 0.01);
  assert.throws(
    () => pool.reserve(0),
    (e) => e.code === "MODEL_CALL_BUDGET",
  );
});
