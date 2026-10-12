import {
  runEpisode,
  buildFingerprint,
  evaluatorFingerprint,
} from "../evaluation/harness.mjs";
import { summarizeCampaign } from "../evaluation/campaign-summary.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const options = Object.fromEntries(
    process.argv.slice(2).map((s) => s.replace(/^--/, "").split("=")),
  ),
  scenarios = (options.scenarios ?? "S23,S01,S09").split(","),
  arms = (options.arms ?? "B1,B2,B3,B4").split(","),
  seeds = Number(options.seeds ?? 2),
  limit = Number(options.budget ?? 1),
  perEpisode = Number(options["episode-budget"] ?? 0.25),
  planningRounds = Number(options.rounds ?? 1),
  policyIntervalMs = Number(options["interval-ms"] ?? 600000),
  rows = [],
  planned = [],
  run = Date.now(),
  folder = `reports/evaluations/${run}`;
if (
  !Number.isSafeInteger(seeds) ||
  seeds < 1 ||
  seeds > 1000 ||
  !Number.isFinite(limit) ||
  limit <= 0 ||
  !Number.isFinite(perEpisode) ||
  perEpisode <= 0 ||
  !Number.isSafeInteger(planningRounds) ||
  planningRounds < 1 ||
  planningRounds > 24 ||
  !Number.isSafeInteger(policyIntervalMs) ||
  policyIntervalMs < 60000 ||
  !scenarios.every((s) => /^S(0[1-9]|1[0-9]|2[0-4])$/.test(s)) ||
  !arms.every((a) => /^B[1-6]$/.test(a)) ||
  new Set(arms).size !== arms.length
)
  throw Error("Invalid evaluation configuration.");
for (const scenario of scenarios)
  for (let i = 1; i <= seeds; i++)
    for (const arm of arms)
      planned.push({
        scenario,
        arm,
        seed: "pilot-2026-" + String(i).padStart(2, "0"),
      });
await mkdir(folder, { recursive: true });
const protocol = {
  at: new Date().toISOString(),
  scenarios,
  arms,
  seeds,
  plannedRuns: planned.length,
  seedPrefix: "pilot-2026-",
  budgetUsd: limit,
  episodeBudgetUsd: perEpisode,
  candidateFingerprint: await buildFingerprint(),
  evaluatorFingerprint: await evaluatorFingerprint(),
  primary: "uncoveredUnitMs by native resource type",
  clock: "modeled",
  includeFailures: true,
  heldOut: false,
  operator: "scripted",
  planningRounds,
  policyIntervalMs,
  scope:
    "Finite scheduled policy rounds plus physical execution, partner decisions and receipts at a fixed horizon. The model budget is cumulative across rounds. This is a development pilot, not an independently authored disaster calibration.",
  costPolicy:
    "Known provider receipts plus conservative reservations for unknown-cost attempts; actual invoice can differ from estimates.",
};
await writeFile(folder + "/protocol.json", JSON.stringify(protocol, null, 2));
let cost = 0,
  charged = 0,
  stoppedReason = null;
let stopRequested = false;
process.on("SIGINT", () => {
  stopRequested = true;
});
async function saveSummary() {
  const report = summarizeCampaign({ folder, protocol, rows, stoppedReason });
  await writeFile(folder + "/summary.json", JSON.stringify(report, null, 2));
  await writeFile(
    "reports/evaluation-latest.json",
    JSON.stringify(report, null, 2),
  );
  return report;
}
try {
  for (const p of planned) {
    if (stopRequested) {
      stoppedReason = "interrupted_after_current_episode";
      break;
    }
    if (limit - charged < perEpisode) {
      stoppedReason = "campaign_budget_exhausted";
      break;
    }
    if (
      protocol.candidateFingerprint !== (await buildFingerprint()) ||
      protocol.evaluatorFingerprint !== (await evaluatorFingerprint())
    ) {
      stoppedReason = "build_changed";
      break;
    }
    console.log("Running", p.arm, p.scenario, p.seed);
    const report = await runEpisode({
      ...p,
      episodeBudgetUsd: perEpisode,
      planningRounds,
      policyIntervalMs,
    });
    cost += report.costUsd;
    charged += report.chargedBudgetUsd;
    rows.push(report);
    await writeFile(
      `${folder}/${p.scenario}-${p.seed}-${p.arm}.json`,
      JSON.stringify(report, null, 2),
    );
    await saveSummary();
    console.log(
      JSON.stringify({
        status: report.status,
        served: Object.fromEntries(
          Object.entries(report.metrics.services).map(([k, v]) => [
            k,
            v.served,
          ]),
        ),
        calls: report.usage.length,
        costUsd: report.costUsd,
        violations: report.invariants.length,
      }),
    );
  }
} catch (e) {
  stoppedReason = e.code ?? e.name;
  console.error(
    "Campaign stopped; every completed report is retained:",
    stoppedReason,
  );
}
const summary = await saveSummary();
console.log(
  JSON.stringify({
    folder,
    runs: summary.runs,
    complete: summary.complete,
    stoppedReason,
    costUsd: cost,
    missing: summary.missing.length,
    comparisons: summary.comparisons.map((c) => ({
      scenario: c.scenario,
      baseline: c.baseline,
      candidate: c.candidate,
      resource: c.resource,
      pairs: c.pairs,
      improvement: c.improvement,
      interval95: c.relativeInterval95,
    })),
  }),
);
if (stoppedReason && stoppedReason !== "campaign_budget_exhausted")
  process.exitCode = 1;
