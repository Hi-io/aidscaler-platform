import { blockedRepairEpisode } from "../evaluation/blocked-repair.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const options = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, "").split("="))),
  seed = options.seed ?? "blocked-transfer-01", strategy = options.strategy ?? "selective", budgetUsd = Number(options.budget ?? .15);
if (!/^[a-zA-Z0-9_-]{3,80}$/.test(seed) || !(budgetUsd > 0 && budgetUsd <= 1)) throw Error("Use a bounded reproducible repair proof");
await mkdir("reports/runs", { recursive: true });
const report = await blockedRepairEpisode({ seed, strategy, budgetUsd });
await writeFile("reports/runs/" + report.episode + ".json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ episode: report.episode, status: report.status, error: report.error, before: report.before, after: report.after,
  costUsd: report.costUsd, calls: report.usage.length, invariants: report.invariants.length, candidateChanged: report.candidateChanged }));
if (report.status !== "completed" || report.candidateChanged || report.invariants.length) process.exitCode = 1;
