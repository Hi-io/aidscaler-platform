import {
  runDiscoveryEpisode,
  summarizeDiscovery,
  DISCOVERY_PROTOCOL,
} from "../evaluation/discovery-benchmark.mjs";
import {
  buildFingerprint,
  evaluatorFingerprint,
} from "../evaluation/harness.mjs";
import { checkFinalBuilds, requireLoadedSimulatorBuild } from "../evaluation/simulator-build.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const o = Object.fromEntries(
  process.argv.slice(2).map((s) => s.replace(/^--/, "").split("=")),
);
const seeds = Number(o.seeds ?? 1),
  arms = (o.arms ?? "B5,B6,B8").split(","),
  budget = Number(o.budget ?? 0.5),
  cap = Number(o["episode-budget"] ?? 0.12);
if (
  !Number.isSafeInteger(seeds) ||
  seeds < 1 ||
  seeds > 20 ||
  !(budget > 0 && budget <= 5) ||
  !(cap > 0 && cap <= budget) ||
  new Set(arms).size !== arms.length ||
  !arms.every((a) => ["B5", "B6", "B8", "B0", "B9"].includes(a))
)
  throw Error("Invalid declared campaign");
const candidateFingerprint = await buildFingerprint(),
  evaluatorBuild = await evaluatorFingerprint(),
  simulatorBuild = await requireLoadedSimulatorBuild(),
  folder = "reports/discovery/" + Date.now();
const config = {
  count: Number(o.needs ?? 12),
  noise: Number(o.noise ?? 48),
  reposts: Number(o.reposts ?? 2),
  humanReadMs: Number(o["read-ms"] ?? 60000),
  humanWorkers: Number(o.workers ?? 2),
  clarificationWorkers: Number(o["confirm-workers"] ?? 1),
  formalDelayMs: Number(o["formal-ms"] ?? 1800000),
  extentKm: Number(o.km ?? 6),
  grid: Number(o.grid ?? 9),
  horizonMs: Number(o["horizon-ms"] ?? 10800000),
  silentFraction: Number(o.silent ?? 0),
  traffic: Number(o.traffic ?? 0),
  packetLoss: Number(o.loss ?? 0),
  budgetUsd: cap,
  maxModelCalls: Number(o.calls ?? 16),
  candidateFingerprint,
  evaluatorBuild,
};
await mkdir(folder, { recursive: true });
await writeFile(
  folder + "/protocol.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      ...DISCOVERY_PROTOCOL,
      config,
      seeds,
      arms,
      simulatorBuild,
      totalBudgetUsd: budget,
      stop: "All declared worlds retained, including failures; no edits during the campaign",
    },
    null,
    2,
  ),
);
const rows = [];
let interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
  console.log(JSON.stringify({ phase: "stopping_at_safe_boundary" }));
});
process.on("SIGTERM", () => {
  interrupted = true;
});
let charged = 0,
  stop = null;
for (let i = 1; i <= seeds && !stop; i++)
  for (const arm of arms) {
    if (["B6", "B9"].includes(arm) && charged + cap > budget) {
      stop = "budget_cap";
      break;
    }
    if ((await checkFinalBuilds({ candidate: candidateFingerprint, evaluator: evaluatorBuild, simulator: simulatorBuild }, { candidate: buildFingerprint, evaluator: evaluatorFingerprint })).invalidStatus) {
      stop = "source_changed";
      break;
    }
    const seed =
      (o["seed-prefix"] ?? "discovery-transfer") +
      "-" +
      String(i).padStart(2, "0");
    console.log(JSON.stringify({ phase: "started", folder, arm, seed }));
    const r = await runDiscoveryEpisode({
      ...config,
      arm,
      seed,
      onProgress: (progress) =>
        console.log(JSON.stringify({ phase: "progress", ...progress })),
      shouldStop: () => interrupted,
    });
    charged += r.chargedBudgetUsd;
    rows.push(r);
    await writeFile(
      folder + "/" + seed + "-" + arm + ".json",
      JSON.stringify(r, null, 2),
    );
    console.log(
      JSON.stringify({
        phase: "completed",
        arm,
        seed,
        status: r.status,
        served: r.timeToSufficientService.completed + "/" + r.outcomes.length,
        restrictedMeanMinutes:
          r.timeToSufficientService.restrictedMeanMs / 60000,
        modelCalls: r.usage.length,
        chargedUsd: r.chargedBudgetUsd,
        invariants: r.invariants.length,
        errors: r.errors.map((e) => e.code),
      }),
    );
    if (interrupted) {
      stop = "interrupted";
      break;
    }
    if (r.candidateChanged || r.evaluatorChanged || r.simulatorChanged) {
      stop = "source_changed";
      break;
    }
  }
let effects;
try { effects = summarizeDiscovery(rows); }
catch (error) {
  if (!rows.some(r => r.candidateChanged || r.evaluatorChanged || r.simulatorChanged)) throw error;
  effects = {
    runs: rows.length, completedRuns: rows.filter(r => r.status === "completed").length,
    failedRuns: rows.filter(r => r.status !== "completed").length,
    invariantViolations: rows.reduce((sum, r) => sum + r.invariants.length, 0),
    costUsd: rows.reduce((sum, r) => sum + r.costUsd, 0),
    chargedBudgetUsd: rows.reduce((sum, r) => sum + r.chargedBudgetUsd, 0),
    comparisons: [], comparisonRejected: true, reason: error.message,
    note: "Raw physical outcomes and costs are retained; no effect is computed from changed sources.",
  };
}
const summary = {
  ...effects,
  folder,
  stoppedReason: stop,
  declaredRuns: seeds * arms.length,
  missingRuns: seeds * arms.length - rows.length,
};
await writeFile(folder + "/summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (stop || summary.failedRuns || summary.invariantViolations)
  process.exitCode = 1;
