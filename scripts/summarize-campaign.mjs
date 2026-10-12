// Offline postprocessing only: preserve protocols, raw outcomes and the original
// summary, including negative results and unknown-cost reservations.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { summarizeCampaign } from "../evaluation/campaign-summary.mjs";
import { hash } from "../src/store.mjs";

const folder = process.argv[2];
if (!/^reports\/evaluations\/[a-zA-Z0-9_-]+$/.test(folder ?? ""))
  throw Error("Supply a retained evaluation directory.");
const protocol = JSON.parse(await readFile(folder + "/protocol.json", "utf8"));
const previous = JSON.parse(await readFile(folder + "/summary.json", "utf8"));
const rows = [];
for (const name of await readdir(folder)) {
  if (!/^S\d\d-.*-B[1-7]\.json$/.test(name)) continue;
  rows.push(JSON.parse(await readFile(folder + "/" + name, "utf8")));
}
const inheritedOutcomePaths = [];
if (protocol.continuation) {
  if (!/^reports\/evaluations\/[a-zA-Z0-9_-]+$/.test(protocol.parent ?? ""))
    throw Error("Invalid inherited outcome directory.");
  for (const name of await readdir(protocol.parent)) {
    if (!/^S\d\d-.*-B[1-7]\.json$/.test(name)) continue;
    const inheritedPath = protocol.parent + "/" + name;
    const report = JSON.parse(await readFile(inheritedPath, "utf8"));
    if (
      rows.some(
        (row) =>
          row.scenario === report.scenario &&
          row.seed === report.seed &&
          row.arm === report.arm,
      )
    )
      throw Error("An inherited outcome must not be counted twice.");
    if (
      report.candidateFingerprint !== protocol.candidateFingerprint ||
      report.evaluatorFingerprint !== protocol.evaluatorFingerprint
    )
      throw Error(
        "An inherited outcome does not match the continuation protocol.",
      );
    rows.push(report);
    inheritedOutcomePaths.push(inheritedPath);
  }
}
if (rows.length !== previous.runs)
  throw Error("All previously recorded outcomes must be retained.");
const summary = summarizeCampaign({
  folder,
  protocol,
  rows,
  stoppedReason: previous.stoppedReason,
});
// A diagnostic continuation may also retain an unclassified aborted run's
// conservative reservation. Never remove it merely because no outcome exists.
summary.chargedBudgetUsd = Math.max(
  previous.chargedBudgetUsd,
  summary.chargedBudgetUsd,
);
summary.unknownCostCalls = Math.max(
  previous.unknownCostCalls,
  summary.unknownCostCalls,
);
if (protocol.continuation) {
  summary.continuation = true;
  summary.inheritedOutcomePaths = inheritedOutcomePaths;
  summary.infrastructureFailures = previous.infrastructureFailures;
  summary.interpretation = previous.interpretation;
}
summary.summaryCorrection = {
  previousSummary: folder + "/summary.json",
  reason:
    "Count all planned structural-variant worlds, not only seeds per variant. Reject unplanned world pairs. No source, clock, model call, protocol, raw outcome or paired-bootstrap formula is changed.",
  summaryFingerprint: hash(
    await Promise.all([
      readFile(
        new URL("../evaluation/campaign-summary.mjs", import.meta.url),
        "utf8",
      ),
      readFile(new URL(import.meta.url), "utf8"),
    ]),
  ),
  modelCalls: 0,
};
await writeFile(
  folder + "/summary-reviewed.json",
  JSON.stringify(summary, null, 2),
);
console.log(
  JSON.stringify({
    folder,
    complete: summary.complete,
    runs: summary.runs,
    chargedBudgetUsd: summary.chargedBudgetUsd,
    missingWorldPairs: summary.comparisons.map((row) => row.missingWorldPairs),
  }),
);
