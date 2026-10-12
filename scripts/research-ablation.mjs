import { runEpisode, buildFingerprint, evaluatorFingerprint } from "../evaluation/harness.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { pairedBootstrap } from "../src/evaluation.mjs";
import { blockedRepairEpisode } from "../evaluation/blocked-repair.mjs";
const o = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, "").split("="))),
  seeds = Number(o.seeds ?? 2), budget = Number(o.budget ?? 0.8), cap = Number(o["episode-budget"] ?? 0.1),
  kind = o.kind ?? "repair", scenarios = (o.scenarios ?? (kind === "repair" ? "S23" : "S06,S11,S18")).split(",");
if (!["repair", "inquiry"].includes(kind) || !Number.isSafeInteger(seeds) || seeds < 1 || seeds > 30 || !(cap > 0 && cap <= budget && budget <= 10) || !scenarios.every(s => /^S(0[1-9]|1[0-9]|2[0-4])$/.test(s))) throw Error("Invalid finite ablation protocol");
const folder = "reports/ablations/" + kind + "-" + Date.now(),
  protocol = { at: new Date().toISOString(), kind, scenarios, seeds, budgetUsd: budget, episodeBudgetUsd: cap, candidateFingerprint: await buildFingerprint(), evaluatorFingerprint: await evaluatorFingerprint(),
    arm: "B6", planningRounds: kind === "repair" ? 1 : 3, policyIntervalMs: 1200000, responseOrder: "deadline_then_priority", includeFailures: true,
    treatments: kind === "repair" ? ["full_refresh", "selective"] : ["broad_refresh", "active"],
    scope: "Internal mechanism ablation. Repair physically blocks a pre-existing loaded trip and compares four-class refresh with using received changes, then requires the same original cargo to arrive. Broad inquiry refreshes six classes. Treatments preserve physical work with the same model, sources, budgets, tools, owners and finite review. Not a professional baseline or independent annotation of marginal query utility.",
    metrics: ["native-unit deficit and delivery", "query/inspection counts and cost", "repair draft delay when an actual invalidation occurs", "preserved physical work", "cost and failed/abstaining episodes"] };
await mkdir(folder, { recursive: true }); await writeFile(folder + "/protocol.json", JSON.stringify(protocol, null, 2));
const rows = []; let charged = 0, stoppedReason = null;
for (const scenario of scenarios) for (let i = 1; i <= seeds && !stoppedReason; i++) for (const treatment of protocol.treatments) {
  if (charged + cap > budget) { stoppedReason = "budget_cap"; break; }
  if (protocol.candidateFingerprint !== await buildFingerprint() || protocol.evaluatorFingerprint !== await evaluatorFingerprint()) { stoppedReason = "source_changed"; break; }
  const seed = "research-ablation-" + String(i).padStart(2, "0");
  console.log(JSON.stringify({ running: { scenario, seed, kind, treatment } }));
  const report = kind === "repair" ? await blockedRepairEpisode({ seed, strategy: treatment, budgetUsd: cap }) :
    await runEpisode({ arm: "B6", scenario, seed, episodeBudgetUsd: cap, planningRounds: protocol.planningRounds, policyIntervalMs: protocol.policyIntervalMs, inquiryStrategy: treatment });
  report.scenario ??= scenario;
  charged += report.chargedBudgetUsd; rows.push({ treatment, report });
  await writeFile(`${folder}/${scenario}-${seed}-${treatment}.json`, JSON.stringify(report, null, 2));
  await writeFile(folder + "/progress.json", JSON.stringify({ completed: rows.length, chargedBudgetUsd: charged, stoppedReason }, null, 2));
}
const contrasts = [], incomplete = [];
for (const scenario of scenarios) {
 const base = rows.filter(r => r.treatment === protocol.treatments[0] && r.report.scenario === scenario).map(r => r.report),
   candidate = rows.filter(r => r.treatment === protocol.treatments[1] && r.report.scenario === scenario).map(r => r.report);
 if (base.length !== seeds || candidate.length !== seeds) { incomplete.push(scenario); continue; }
 for (const resource of new Set([...base, ...candidate].flatMap(r => Object.keys(r.metrics.services)))) contrasts.push({ scenario, resource, ...pairedBootstrap(base, candidate, { resource }) });
}
const cases = rows.map(({ treatment, report: r }) => ({ treatment, scenario: r.scenario, seed: r.seed, status: r.status, errors: r.errors, queries: r.metrics.queries, toolCost: r.metrics.cost,
  repairAttempts: r.before ? [{ state: r.status, calls: r.usage.length, wallMs: r.after?.draftWallMs ?? null, modelledDraftMs: r.after?.draftModeledMs ?? null,
    refreshTargets: r.after?.refreshTargets ?? [], repairOf: r.proposal?.repairOf ?? null, preservedOperationId: r.after?.operationId ?? null,
    delivered: r.after?.delivered ?? 0, originalLoaded: r.before.loaded }] :
    (r.activities ?? []).filter(a => a.researchAblation?.repairOf).map(a => ({ state: a.state, calls: a.calls, wallMs: a.wallMs, proposalId: a.proposalId, ...a.researchAblation })),
  inconclusive: (r.activities ?? []).filter(a => a.state === "inconclusive").length, costUsd: r.costUsd, violations: r.invariants.length }));
const summary = { protocol, cases, contrasts, incomplete, stoppedReason, completed: rows.length, costUsd: rows.reduce((s, r) => s + r.report.costUsd, 0), chargedBudgetUsd: charged,
  limitations: ["No invalidation means no repair result; an absent attempt is not a zero-minute successful repair.", "A draft or query is not executed service. Outcomes are counted by physical receipts.", "Internally defined refresh ablations do not prove that every competent planner would make those queries.", "Query usefulness is not independently judged by this test; informative changes and physical outcomes remain separate evidence."] };
await writeFile(folder + "/summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ folder, completed: rows.length, costUsd: summary.costUsd, stoppedReason, incomplete }));
if (stoppedReason || incomplete.length || rows.some(r => r.report.status !== "completed" || r.report.invariants.length)) process.exitCode = 1;
