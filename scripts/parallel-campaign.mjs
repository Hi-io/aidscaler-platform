import {
  runEpisode,
  buildFingerprint,
  evaluatorFingerprint,
} from "../evaluation/harness.mjs";
import { summarizeCampaign } from "../evaluation/campaign-summary.mjs";
import { mkdir, writeFile, access } from "node:fs/promises";

const options = Object.fromEntries(
  process.argv.slice(2).map((s) => s.replace(/^--/, "").split("=")),
);
const scenarios = (options.scenarios ?? "S19,S09,S01,S23").split(",");
const arms = (options.arms ?? "B1,B2,B3,B4,B5,B6").split(",");
const seeds = Number(options.seeds ?? 2),
  workers = Number(options.workers ?? 3);
const limit = Number(options.budget ?? 2),
  perEpisode = Number(options["episode-budget"] ?? 0.25);
const planningRounds = Number(options.rounds ?? 2),
  policyIntervalMs = Number(options["interval-ms"] ?? 600000);
if (
  !Number.isSafeInteger(seeds) ||
  seeds < 1 ||
  seeds > 1000 ||
  !Number.isSafeInteger(workers) ||
  workers < 1 ||
  workers > 4 ||
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
  new Set(scenarios).size !== scenarios.length ||
  !arms.every((s) => /^B[1-6]$/.test(s)) ||
  new Set(arms).size !== arms.length
)
  throw Error("Invalid parallel evaluation configuration.");
const folder = `reports/evaluations/${Date.now()}`,
  rows = [],
  worlds = [];
for (const scenario of scenarios)
  for (let i = 1; i <= seeds; i++)
    worlds.push({ scenario, seed: "pilot-2026-" + String(i).padStart(2, "0") });
await mkdir(folder, { recursive: true });
const protocol = {
  at: new Date().toISOString(),
  scenarios,
  arms,
  seeds,
  seedPrefix: "pilot-2026-",
  plannedRuns: worlds.length * arms.length,
  budgetUsd: limit,
  episodeBudgetUsd: perEpisode,
  candidateFingerprint: await buildFingerprint(),
  evaluatorFingerprint: await evaluatorFingerprint(),
  modelRequestPolicy: {
    maxOutputTokens: Number(process.env.MODEL_MAX_OUTPUT_TOKENS ?? 8192),
    reasoningEnabled: process.env.MODEL_REASONING !== "false",
    providerSort: process.env.MODEL_PROVIDER_SORT ?? "latency",
    priceMultiplier: Number(process.env.MODEL_PRICE_MULTIPLIER ?? 2),
  },
  primary: "uncoveredUnitMs by native resource type",
  clock: "modeled",
  includeFailures: true,
  heldOut: false,
  operator: "scripted",
  planningRounds,
  policyIntervalMs,
  execution: {
    workers,
    isolation:
      "Each world has independent source servers, model budget pool, databases, owners and physical state. Arms within a world run sequentially.",
    wallTime:
      "Shared-host contention and provider queues can affect actual latency. This pilot compares declared modeled delays, not an industrial real-time throughput claim.",
  },
  planningTopology:
    "Shared B5/B6 use one incident research coordinator and independently authorized partner execution; isolated arms use one instance.",
  scope:
    "Development pilot, not independent disaster calibration. All scheduled outcomes and failures are retained; no missing outcome is imputed.",
  costPolicy:
    "Before launching an episode reserve its full fixed cap against the total campaign budget; settle known costs plus unknown-cost reservations. Never shrink a final episode cap.",
};
await writeFile(folder + "/protocol.json", JSON.stringify(protocol, null, 2));
let nextWorld = 0,
  charged = 0,
  reserved = 0,
  stoppedReason = null,
  saveTail = Promise.resolve();
let releaseWaiters = [];
process.on("SIGINT", () => {
  stoppedReason ??= "interrupted_after_active_episodes";
});
async function save() {
  saveTail = saveTail.then(async () => {
    const summary = summarizeCampaign({
      folder,
      protocol,
      rows: [...rows],
      stoppedReason,
    });
    await writeFile(folder + "/summary.json", JSON.stringify(summary, null, 2));
    await writeFile(
      "reports/evaluation-latest.json",
      JSON.stringify(summary, null, 2),
    );
  });
  await saveTail;
}
async function cancelled() {
  if (!options["stop-file"]) return false;
  try {
    await access(options["stop-file"]);
    return true;
  } catch {
    return false;
  }
}
async function worker(index) {
  while (nextWorld < worlds.length && !stoppedReason) {
    const world = worlds[nextWorld++];
    for (const arm of arms) {
      if (await cancelled())
        stoppedReason ??= "operator_stop_file_after_active_episodes";
      if (stoppedReason) break;
      if (
        protocol.candidateFingerprint !== (await buildFingerprint()) ||
        protocol.evaluatorFingerprint !== (await evaluatorFingerprint())
      ) {
        stoppedReason = "build_changed";
        break;
      }
      // No await between the test and reservation: shared scheduling is atomic
      // on this JS thread, even when three independent worlds are active.
      while (
        charged + reserved + perEpisode > limit + 1e-9 &&
        reserved > 0 &&
        !stoppedReason
      ) {
        await new Promise((resolve) => releaseWaiters.push(resolve));
      }
      if (stoppedReason) break;
      if (charged + perEpisode > limit + 1e-9) {
        stoppedReason = "campaign_budget_exhausted";
        break;
      }
      reserved += perEpisode;
      console.log(
        JSON.stringify({ worker: index, running: { ...world, arm } }),
      );
      try {
        const report = await runEpisode({
          ...world,
          arm,
          episodeBudgetUsd: perEpisode,
          planningRounds,
          policyIntervalMs,
        });
        charged += report.chargedBudgetUsd;
        rows.push(report);
        await writeFile(
          `${folder}/${world.scenario}-${world.seed}-${arm}.json`,
          JSON.stringify(report, null, 2),
        );
        if (report.errors.some((e) => e.code === "PROVIDER_FUNDS"))
          stoppedReason = "provider_credit_exhausted";
        await save();
        console.log(
          JSON.stringify({
            worker: index,
            scenario: world.scenario,
            seed: world.seed,
            arm,
            status: report.status,
            runs: rows.length,
            costUsd: report.costUsd,
            violations: report.invariants.length,
          }),
        );
      } catch (e) {
        stoppedReason ??= e.code ?? e.name;
      } finally {
        reserved -= perEpisode;
        const waiters = releaseWaiters;
        releaseWaiters = [];
        waiters.forEach((resolve) => resolve());
      }
    }
  }
}
console.log(
  JSON.stringify({
    folder,
    plannedRuns: protocol.plannedRuns,
    workers,
    budgetUsd: limit,
  }),
);
await save();
await Promise.all(Array.from({ length: workers }, (_, i) => worker(i + 1)));
await save();
console.log(
  JSON.stringify({
    folder,
    runs: rows.length,
    complete: rows.length === protocol.plannedRuns,
    stoppedReason,
    chargedBudgetUsd: charged,
  }),
);
if (stoppedReason && stoppedReason !== "campaign_budget_exhausted")
  process.exitCode = 1;
