// Correct the defective broad-refresh reference without paying again for the
// six unchanged active-treatment runs. Retains explicit mixed-evaluator lineage.
import {
  runEpisode,
  buildFingerprint,
  evaluatorFingerprint,
} from "../evaluation/harness.mjs";
import { pairedBootstrap } from "../src/evaluation.mjs";
import { hash } from "../src/store.mjs";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";

const parent = process.argv[2];
const summaryOnly = process.argv[3]?.replace(/^--summary-only=/, "");
if (!/^reports\/ablations\/inquiry-\d+$/.test(parent ?? ""))
  throw Error("Supply the retained original inquiry directory.");
if (
  summaryOnly &&
  !/^reports\/ablations\/inquiry-corrected-\d+$/.test(summaryOnly)
)
  throw Error("Supply a retained correction directory for summary-only mode.");
const original = JSON.parse(await readFile(parent + "/protocol.json", "utf8")),
  candidate = await buildFingerprint(),
  evaluator = await evaluatorFingerprint(),
  folder = summaryOnly ?? "reports/ablations/inquiry-corrected-" + Date.now(),
  rows = [],
  queue = [];
if (candidate !== original.candidateFingerprint)
  throw Error("The active treatment cannot be reused for a changed candidate.");
for (const name of await readdir(parent)) {
  if (!/^S\d\d-.*-active\.json$/.test(name)) continue;
  const report = JSON.parse(await readFile(parent + "/" + name, "utf8"));
  if (report.candidateFingerprint !== candidate || report.invariants.length)
    throw Error("Invalid inherited active-treatment report.");
  rows.push({
    treatment: "active",
    report,
    inheritedFrom: parent + "/" + name,
  });
  queue.push({ scenario: report.scenario, seed: report.seed });
}
if (queue.length !== original.scenarios.length * original.seeds)
  throw Error(
    "The complete prespecified active group is required; no selective reuse.",
  );
const protocol = summaryOnly
  ? JSON.parse(await readFile(folder + "/protocol.json", "utf8"))
  : {
      ...original,
      at: new Date().toISOString(),
      parent,
      candidateFingerprint: candidate,
      evaluatorFingerprint: evaluator,
      inheritedEvaluatorFingerprint: original.evaluatorFingerprint,
      workers: 2,
      incrementalBudgetUsd:
        original.scenarios.length * original.seeds * original.episodeBudgetUsd,
      correction:
        "The broad refresh omitted the required owner for capabilities and failed before model inference. Only that reference is rerun. The candidate and active path are unchanged. All six original active outcomes are retained, including negatives, with their original evaluator fingerprint.",
      interpretation:
        "Two-stage internal evaluator correction, not a new confirmatory campaign or independent holdout. Wall-time contrasts across the two schedules must not be interpreted as inference speed improvement.",
      scorerFingerprint: hash(await readFile(new URL(import.meta.url), "utf8")),
    };
if (
  protocol.candidateFingerprint !== candidate ||
  protocol.evaluatorFingerprint !== evaluator ||
  protocol.parent !== parent
)
  throw Error(
    "The retained correction protocol does not match this build and parent.",
  );
if (!summaryOnly) {
  await mkdir(folder, { recursive: true });
  await writeFile(folder + "/protocol.json", JSON.stringify(protocol, null, 2));
}
let next = 0,
  charged = 0,
  spent = 0;
const failures = [];
async function worker(id) {
  while (next < queue.length) {
    const entry = queue[next++];
    if (
      candidate !== (await buildFingerprint()) ||
      evaluator !== (await evaluatorFingerprint())
    )
      throw Error("Frozen correction build changed.");
    console.log(
      JSON.stringify({
        worker: id,
        running: { ...entry, treatment: "broad_refresh" },
      }),
    );
    try {
      const report = await runEpisode({
        ...entry,
        arm: "B6",
        episodeBudgetUsd: original.episodeBudgetUsd,
        planningRounds: original.planningRounds,
        policyIntervalMs: original.policyIntervalMs,
        inquiryStrategy: "broad_refresh",
      });
      spent += report.costUsd;
      charged += report.chargedBudgetUsd;
      rows.push({ treatment: "broad_refresh", report });
      await writeFile(
        folder +
          "/" +
          entry.scenario +
          "-" +
          entry.seed +
          "-broad_refresh.json",
        JSON.stringify(report, null, 2),
      );
      console.log(
        JSON.stringify({
          worker: id,
          ...entry,
          status: report.status,
          queries: report.metrics.queries,
          costUsd: report.costUsd,
          violations: report.invariants.length,
          completedNew: rows.length - queue.length,
        }),
      );
    } catch (e) {
      charged += original.episodeBudgetUsd;
      failures.push({
        ...entry,
        code: e.code ?? e.name,
        costUsd: null,
        reservedUsd: original.episodeBudgetUsd,
      });
    }
    await writeFile(
      folder + "/progress.json",
      JSON.stringify(
        {
          completed: rows.length,
          newCostUsd: spent,
          newChargedBudgetUsd: charged,
          failures,
        },
        null,
        2,
      ),
    );
  }
}
if (summaryOnly) {
  const progress = JSON.parse(
    await readFile(folder + "/progress.json", "utf8"),
  );
  spent = progress.newCostUsd;
  charged = progress.newChargedBudgetUsd;
  failures.push(...progress.failures);
  for (const entry of queue) {
    const report = JSON.parse(
      await readFile(
        folder +
          "/" +
          entry.scenario +
          "-" +
          entry.seed +
          "-broad_refresh.json",
        "utf8",
      ),
    );
    if (
      report.candidateFingerprint !== candidate ||
      report.evaluatorFingerprint !== evaluator ||
      report.scenario !== entry.scenario ||
      report.seed !== entry.seed
    )
      throw Error("A retained outcome does not match its correction protocol.");
    rows.push({ treatment: "broad_refresh", report });
  }
} else await Promise.all([worker(1), worker(2)]);
const contrasts = [];
for (const scenario of original.scenarios) {
  const base = rows
      .filter(
        (row) =>
          row.treatment === "broad_refresh" && row.report.scenario === scenario,
      )
      .map((row) => row.report),
    active = rows
      .filter(
        (row) => row.treatment === "active" && row.report.scenario === scenario,
      )
      .map((row) => row.report);
  if (base.length !== original.seeds) continue;
  for (const resource of new Set(
    [...base, ...active].flatMap((report) =>
      Object.keys(report.metrics.services),
    ),
  )) {
    try {
      contrasts.push({
        scenario,
        resource,
        ...pairedBootstrap(base, active, { resource }),
      });
    } catch (error) {
      if (error.code !== "EVALUATION_CONFIG") throw error;
      contrasts.push({
        scenario,
        resource,
        status: "not_comparable",
        code: error.code,
        improvement: null,
        interval95: null,
        reason:
          "Different evaluator fingerprints. All outcome metrics are retained, but the strict paired bootstrap remains closed; no advantage or confidence interval is inferred from this two-stage correction.",
      });
    }
  }
}
const summary = {
  protocol,
  completed: rows.length,
  planned: queue.length * 2,
  inherited: queue.length,
  newCostUsd: spent,
  newChargedBudgetUsd: charged,
  costUsd: rows.reduce((sum, row) => sum + row.report.costUsd, 0),
  chargedBudgetUsd:
    charged +
    rows
      .filter((row) => row.inheritedFrom)
      .reduce((sum, row) => sum + row.report.chargedBudgetUsd, 0),
  failures,
  contrasts,
  summaryScorerFingerprint: hash(
    await readFile(new URL(import.meta.url), "utf8"),
  ),
  summaryOnly: Boolean(summaryOnly),
  cases: rows.map(({ treatment, report, inheritedFrom }) => ({
    treatment,
    scenario: report.scenario,
    seed: report.seed,
    status: report.status,
    errors: report.errors,
    queries: report.metrics.queries,
    services: report.metrics.services,
    costUsd: report.costUsd,
    violations: report.invariants.length,
    candidateFingerprint: report.candidateFingerprint,
    evaluatorFingerprint: report.evaluatorFingerprint,
    inheritedFrom: inheritedFrom ?? null,
  })),
  limitations: [
    protocol.interpretation,
    "The defective old broad-refresh outcomes are preserved in the parent directory and excluded from advantage claims.",
    "Lower query count does not prove independently judged marginal value, human usefulness or field outcomes.",
  ],
};
await writeFile(folder + "/summary.json", JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify({
    folder,
    completed: rows.length,
    inherited: queue.length,
    newCostUsd: spent,
    failures: failures.length,
    contrasts: contrasts.length,
  }),
);
if (
  failures.length ||
  rows.length !== queue.length * 2 ||
  rows.some(
    (row) => row.report.status !== "completed" || row.report.invariants.length,
  )
)
  process.exitCode = 1;
