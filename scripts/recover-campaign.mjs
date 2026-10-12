import { readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { summarizeCampaign } from "../evaluation/campaign-summary.mjs";
const folder = process.argv[2];
const reason =
  process.argv[3] ??
  "summary_failure_EVALUATION_CONFIG_recovered_from_raw_reports";
if (
  ![
    "summary_failure_EVALUATION_CONFIG_recovered_from_raw_reports",
    "provider_http_402_account_credit_exhausted",
  ].includes(reason)
)
  throw Error("Use an explicit supported stopped-campaign reason.");
if (!folder || !/^reports[\\/]evaluations[\\/]\d+$/.test(folder))
  throw Error("Supply a stopped campaign directory.");
const protocol = JSON.parse(
  await readFile(path.join(folder, "protocol.json"), "utf8"),
);
const rows = await Promise.all(
  (await readdir(folder))
    .filter((f) => /^S\d\d-.+-B[1-6]\.json$/.test(f))
    .map(async (f) => JSON.parse(await readFile(path.join(folder, f), "utf8"))),
);
const report = summarizeCampaign({
  folder,
  protocol,
  rows,
  stoppedReason: reason,
});
report.recovery = {
  at: new Date().toISOString(),
  rawOutcomesUnchanged: true,
  note:
    reason === "provider_http_402_account_credit_exhausted"
      ? "The operator stopped this runner after real HTTP 402 responses and a read-only account check confirming unavailable credit. Completed raw outcomes are unchanged; unfinished episodes remain missing. No extra inference was attempted to fill them, and unknown-cost reservations are retained."
      : "The terminated original runner threw during summary generation after shrinking the last episode budget. Its original summary and every raw outcome remain retained; incomparable outcomes are explicitly rejected.",
};
await copyFile(
  path.join(folder, "summary.json"),
  path.join(folder, "summary-prior-to-recovery.json"),
  1,
);
await writeFile(
  path.join(folder, "summary.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    folder,
    recoveredRuns: report.runs,
    missing: report.missing.length,
    incomparable: report.comparisons.filter((r) => r.comparisonRejected).length,
    costUsd: report.costUsd,
  }),
);
