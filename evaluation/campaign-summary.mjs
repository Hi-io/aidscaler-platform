import { pairedBootstrap, gates } from "../src/evaluation.mjs";

export function summarizeCampaign({
  folder,
  protocol,
  rows,
  stoppedReason = null,
}) {
  const planned = [];
  for (const scenario of protocol.scenarios)
    for (const variant of protocol.compositionVariants ?? ["standard"])
      for (let i = 1; i <= protocol.seeds; i++)
        for (const arm of protocol.arms)
          planned.push({
            scenario,
            arm,
            seed:
              (protocol.seedPrefix ?? "pilot-2026-") +
              ((protocol.compositionVariants?.length ?? 1) > 1
                ? variant + "-"
                : "") +
              String(i).padStart(2, "0"),
          });
  const missing = planned.filter(
    (p) =>
      !rows.some(
        (r) =>
          r.scenario === p.scenario && r.seed === p.seed && r.arm === p.arm,
      ),
  );
  const comparisons = [];
  for (const scenario of protocol.scenarios)
    for (const arm of protocol.arms.filter((a) => a !== protocol.arms[0])) {
      const aa = rows.filter(
        (r) => r.scenario === scenario && r.arm === protocol.arms[0],
      );
      const bb = rows.filter((r) => r.scenario === scenario && r.arm === arm);
      const expectedWorldSeeds = [
        ...new Set(
          planned.filter((p) => p.scenario === scenario).map((p) => p.seed),
        ),
      ];
      const seeds = [
        ...new Set(
          aa
            .filter((r) => bb.some((b) => b.seed === r.seed))
            .map((r) => r.seed),
        ),
      ];
      const a = aa.filter((r) => seeds.includes(r.seed));
      const b = bb.filter((r) => seeds.includes(r.seed));
      for (const resource of new Set(
        [...a, ...b].flatMap((r) => Object.keys(r.metrics.services)),
      )) {
        const row = {
          scenario,
          baseline: protocol.arms[0],
          candidate: arm,
          resource,
          expectedWorldPairs: expectedWorldSeeds.length,
          missingWorldPairs: expectedWorldSeeds.filter(
            (seed) => !seeds.includes(seed),
          ).length,
          unexpectedWorldPairs: seeds.filter(
            (seed) => !expectedWorldSeeds.includes(seed),
          ).length,
        };
        try {
          if (row.unexpectedWorldPairs)
            throw Object.assign(new Error("Unplanned world pair"), {
              code: "EVALUATION_PLAN",
            });
          Object.assign(row, pairedBootstrap(a, b, { resource }));
        } catch (e) {
          Object.assign(row, {
            comparisonRejected: true,
            reason: e.code ?? e.name,
            attemptedWorldPairs: seeds.length,
            pairs: 0,
            improvement: null,
            note: "All raw outcomes are retained. Mismatched worlds/budgets/builds must not be assigned an improvement.",
          });
        }
        comparisons.push(row);
      }
    }
  return {
    at: new Date().toISOString(),
    protocol: folder + "/protocol.json",
    complete: missing.length === 0,
    stoppedReason,
    runs: rows.length,
    plannedRuns: planned.length,
    missing,
    costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    chargedBudgetUsd: rows.reduce((s, r) => s + r.chargedBudgetUsd, 0),
    unknownCostCalls: rows.reduce((s, r) => s + r.unknownCostCalls, 0),
    comparisons,
    gates: rows.map((r) => ({
      scenario: r.scenario,
      seed: r.seed,
      arm: r.arm,
      status: r.status,
      ...gates(r.metrics),
      invariantViolations: r.invariants.length,
    })),
    notAClaimOfSuperiority: true,
    remainingValidation: [
      "Independent sealed structural holdout",
      "Human operator and public comprehension trials",
      "Institutional calibration and adoption",
      "Gemini remeasurement after changing models",
      "Recurrent policies across evolving emergencies",
    ],
  };
}
