import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pairedBootstrap } from "../src/evaluation.mjs";

const folder = process.argv[2];
if (!folder || !/^reports[\\/]evaluations[\\/]\d+$/.test(folder))
  throw Error("Supply a local reports/evaluations/<run> directory.");
const summary = JSON.parse(
  await readFile(path.join(folder, "summary.json"), "utf8"),
);
if (!summary.complete && !summary.stoppedReason)
  throw Error(
    "The campaign is still running. Analyze its retained final summary later.",
  );
const protocol = JSON.parse(
  await readFile(path.join(folder, "protocol.json"), "utf8"),
);
const rows = await Promise.all(
  (await readdir(folder))
    .filter((f) => /^S\d\d-.+-B[1-7]\.json$/.test(f))
    .map(async (f) => JSON.parse(await readFile(path.join(folder, f), "utf8"))),
);
const comparisons = [];
const contrasts = [
  ["B1", "B2", "Extraction over deterministic allocation"],
  ["B2", "B4", "Investigation beyond extraction"],
  ["B3", "B4", "AidScaler versus same-model general investigator"],
  ["B1", "B5", "Conventional sharing benefit; not a GenAI contribution"],
  ["B4", "B6", "Network AidScaler versus a single AidScaler instance"],
  ["B5", "B6", "GenAI contribution beyond conventional sharing"],
  ["B7", "B6", "AidScaler versus same-model general investigator with the SAME shared owners and tools"],
];
for (const scenario of protocol.scenarios)
  for (const [baseline, candidate, question] of contrasts) {
    const aa = rows.filter(
      (r) => r.scenario === scenario && r.arm === baseline,
    );
    const bb = rows.filter(
      (r) => r.scenario === scenario && r.arm === candidate,
    );
    const paired = aa.filter((r) => bb.some((x) => x.seed === r.seed));
    const a = paired;
    const b = bb.filter((r) => paired.some((x) => x.seed === r.seed));
    if (!a.length) continue;
    for (const resource of new Set(
      [...a, ...b].flatMap((r) => Object.keys(r.metrics.services)),
    )) {
      let result;
      try {
        result = pairedBootstrap(a, b, { resource });
      } catch (e) {
        comparisons.push({
          scenario,
          baseline,
          candidate,
          question,
          resource,
          comparisonRejected: true,
          reason: e.code ?? e.name,
          pairs: 0,
          attemptedWorldPairs: a.length,
          improvement: null,
          note: "Raw outcomes preserved. No statistical result is assigned to unequal configuration/budget/build.",
        });
        continue;
      }
      comparisons.push({
        scenario,
        baseline,
        candidate,
        question,
        expectedWorldPairs: protocol.seeds,
        missingWorldPairs: protocol.seeds - result.pairs,
        ...result,
        nativeUnitHours: {
          baseline: result.baselineMean / 3600000,
          candidate: result.candidateMean / 3600000,
          reduction: result.delta / 3600000,
        },
        baselineFailures: a.filter((r) => r.status !== "completed").length,
        candidateFailures: b.filter((r) => r.status !== "completed").length,
        baselineProviderUsd: a.reduce((s, r) => s + r.costUsd, 0),
        candidateProviderUsd: b.reduce((s, r) => s + r.costUsd, 0),
      });
    }
  }
const report = {
  at: new Date().toISOString(),
  protocol: summary.protocol,
  candidateFingerprint: protocol.candidateFingerprint,
  evaluatorFingerprint: protocol.evaluatorFingerprint,
  runs: summary.runs,
  plannedRuns: summary.plannedRuns,
  complete: summary.complete,
  stoppedReason: summary.stoppedReason,
  costUsd: summary.costUsd,
  chargedBudgetUsd: summary.chargedBudgetUsd,
  missing: summary.missing,
  comparisons,
  failuresIncluded: true,
  clinicalOrHumanBenefitValidated: false,
  independentHoldout: protocol.heldOut === true,
  limits: [
    "Development pilot; two worlds do not support confirmatory inference.",
    "A reduction can be negative; zero baseline means undefined relative improvement.",
    "Different service units remain separate; no total score combines litres and places.",
    "Rule-based reviewers and reference competence have not been calibrated with professionals.",
    "Earlier pilots divided the network inference budget equally across owners. Later reports identify a shared total pool; do not combine outcomes from these different evaluators.",
    "Gemma results do not establish Gemini performance, clinical lives saved, public trust or field effectiveness.",
  ],
};
await writeFile(
  path.join(folder, "contrasts.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    folder,
    runs: report.runs,
    comparisons: comparisons.length,
    costUsd: report.costUsd,
    incomplete: report.missing.length,
  }),
);
