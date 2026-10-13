import { readFile, writeFile, mkdir, open, access, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { runEpisode, buildFingerprint, evaluatorFingerprint } from "../evaluation/harness.mjs";
import { blockedRepairEpisode } from "../evaluation/blocked-repair.mjs";
import { requireLoadedSimulatorBuild, checkFinalBuilds } from "../evaluation/simulator-build.mjs";
import { pairedBootstrap } from "../src/evaluation.mjs";

// Ignored orchestration only: uses the current evaluator unchanged. No provider
// call without an explicit root GO and the three independently checked hashes.
const definitions = {
  K07: { kind: "repair", scenarios: ["S23"], seeds: 2, budgetUsd: 0.5, episodeBudgetUsd: 0.1,
    treatments: ["full_refresh", "selective"], planningRounds: 1, policyIntervalMs: 1200000,
    responseOrder: "common reviewed prelude; preserve existing cargo",
    primary: ["original 300 L physically received", "same original operation", "one stock draw and delivery", "change accessible to valid draft and useful service"],
    attribution: "Internal refresh-policy ablation. Scripted loaded-trip prelude is common and is not credited to the model; this is not a professional conventional-planner comparison." },
  K14: { kind: "inquiry", scenarios: ["S06", "S11", "S18"], seeds: 1, budgetUsd: 0.7, episodeBudgetUsd: 0.1,
    treatments: ["broad_refresh", "active"], planningRounds: 3, policyIntervalMs: 1200000,
    responseOrder: "deadline_then_priority",
    primary: ["native service and deficit by resource", "questions and inspections", "tool/model cost", "changed feasibility and executed response"],
    attribution: "Internal active-vs-six-class-refresh policy ablation. Lower query count alone is not success and does not independently annotate marginal question utility." },
};
const args = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, "").split("="))),
  definition = definitions[args.study], study = args.study;
if (!definition) throw Error("Choose --study=K07 or --study=K14.");
const planned = definition.scenarios.flatMap(scenario => Array.from({ length: definition.seeds }, (_, i) =>
  definition.treatments.map(treatment => ({ scenario, seed: "research-ablation-" + String(i + 1).padStart(2, "0"), treatment })))).flat(),
  stopFile = resolve(".local/STOP_RESEARCH_" + study + "_CANDIDATE"),
  guardrails = ["same current candidate/evaluator/engine/model/tools/permission/physical resources/review/caps", "all failed and censored worlds retained", "no inherited outcomes from another hash", "native units and silent/remote groups kept separate", "provider wall/failures and unknown cost reservations retained", "no paid poll solely for known ongoing physical work", "a new source, hazard, repair or operator request must not be hidden by a wait gate"];
if (Object.hasOwn(args, "plan")) {
  console.log(JSON.stringify({ state: "prepared_not_launched", study, ...definition, planned, workers: 1,
    requiredGate: "Root GO plus three-hash verified freeze", stopFile, guardrails,
    command: ["node", "--env-file-if-exists=../../nexo-platform/.env.local", ".local/research-studies-controlled.mjs", "--study=" + study, "--freeze=ROOT_APPROVED_FREEZE.json", "--run=ROOT_GO_" + study] }, null, 2));
  process.exit(0);
}
if (!args.freeze) throw Error("A root-approved freeze file is mandatory; --plan makes no calls.");
const expected = JSON.parse(await readFile(resolve(args.freeze), "utf8")),
  current = { candidateFingerprint: await buildFingerprint(), evaluatorFingerprint: await evaluatorFingerprint(), simulatorBuild: await requireLoadedSimulatorBuild() };
for (const key of Object.keys(current)) {
  const wanted = key === "simulatorBuild" ? expected[key] ?? expected.simulatorFingerprint ?? expected.engineBuild : expected[key];
  if (!wanted || wanted !== current[key]) throw Error("Freeze mismatch: " + key);
}
if (args.run !== "ROOT_GO_" + study) {
  console.log(JSON.stringify({ state: "dry_run_hashes_match_no_provider_call", study, ...current, planned, workers: 1, stopFile, guardrails }, null, 2));
  process.exit(0);
}
let interrupt = false;
process.on("SIGINT", () => { interrupt = true; });
process.on("SIGTERM", () => { interrupt = true; });
async function stopped() { if (interrupt) return true; try { await access(stopFile); return true; } catch (e) { if (e.code !== "ENOENT") throw e; return false; } }
if (await stopped()) throw Error("The new study-specific stop marker exists; preserve it and seek a new root gate.");
await mkdir(".local", { recursive: true });
const lockFile = resolve(".local/PAID_RESEARCH_STUDY.lock"), nonce = randomUUID(),
  lock = await open(lockFile, "wx");
await lock.writeFile(JSON.stringify({ nonce, pid: process.pid, study, at: new Date().toISOString(), ...current }));
await lock.close();
const folder = "reports/ablations/" + definition.kind + "-gated-" + Date.now(),
  runnerBytes = await readFile(new URL(import.meta.url)),
  protocol = { at: new Date().toISOString(), study, ...definition, ...current, arm: "B6", workers: 1,
    seedPrefix: "research-ablation-", plannedRuns: planned.length, planned,
    includeFailures: true, stopFile, guardrails, rootApprovedFreeze: resolve(args.freeze),
    runnerSha256: createHash("sha256").update(runnerBytes).digest("hex"),
    orchestrationAmendment: "One host episode at a time; no change to physical staffing, clocks or review. K14 stops only after active provider work settles at a safe round boundary; K07 stops after its bounded repair episode settles.",
    metrics: [...definition.primary, "first useful and sufficient service/censoring", "native deficit/overprovided", "vehicle km/fuel/work", "versioned physical receipts", "provider wall/calls/known and unknown cost", "invariants and retained failures"] };
await mkdir(folder, { recursive: true });
await writeFile(folder + "/protocol.json", JSON.stringify(protocol, null, 2));
await writeFile(folder + "/runner.mjs", runnerBytes);
const rows = [], missingOutcomes = []; let charged = 0, stoppedReason = null, activeEpisode = null;
async function checkpoint() {
  await writeFile(folder + "/progress.json", JSON.stringify({ completed: rows.length, planned: planned.length,
    chargedBudgetUsd: charged, activeEpisode, missingOutcomes, stoppedReason }, null, 2));
}
try {
  await checkpoint();
  for (const item of planned) {
    if (await stopped()) { stoppedReason = "operator_stop_boundary"; break; }
    if (charged + definition.episodeBudgetUsd > definition.budgetUsd + 1e-10) { stoppedReason = "budget_cap"; break; }
    const before = await checkFinalBuilds({ candidate: current.candidateFingerprint, evaluator: current.evaluatorFingerprint, simulator: current.simulatorBuild }, { candidate: buildFingerprint, evaluator: evaluatorFingerprint });
    if (before.invalidStatus) { stoppedReason = "source_changed_before_episode"; break; }
    activeEpisode = { ...item, at: new Date().toISOString(), reservedUsd: definition.episodeBudgetUsd,
      costUsd: null, calls: null, state: "inflight_not_an_outcome" };
    await checkpoint();
    console.log(JSON.stringify({ folder, running: activeEpisode }));
    let report;
    try {
      report = definition.kind === "repair"
        ? await blockedRepairEpisode({ seed: item.seed, strategy: item.treatment, budgetUsd: definition.episodeBudgetUsd })
        : await runEpisode({ arm: "B6", scenario: item.scenario, seed: item.seed, episodeBudgetUsd: definition.episodeBudgetUsd,
            planningRounds: definition.planningRounds, policyIntervalMs: definition.policyIntervalMs,
            responseOrder: definition.responseOrder, inquiryStrategy: item.treatment, shouldStop: stopped });
      report.scenario ??= item.scenario;
      if (!Number.isFinite(report.chargedBudgetUsd)) throw Error("Outcome omitted its charged cost; cannot record it as zero.");
      await writeFile(`${folder}/${item.scenario}-${item.seed}-${item.treatment}.json`, JSON.stringify(report, null, 2));
      rows.push({ ...item, report });
      charged += report.chargedBudgetUsd;
    } catch (e) {
      charged += definition.episodeBudgetUsd;
      missingOutcomes.push({ ...item, status: "missing_outcome_after_exception", costUsd: null, calls: null,
        reservedUsd: definition.episodeBudgetUsd, error: { code: e.code ?? e.name, message: String(e.message).slice(0, 250) } });
      stoppedReason = "unsettled_or_unrecordable_episode";
    }
    activeEpisode = null;
    await checkpoint();
    if (stoppedReason) break;
    if (report.candidateChanged || report.evaluatorChanged || report.simulatorChanged) { stoppedReason = "source_changed_during_episode"; break; }
    if (report.status === "aborted") { stoppedReason = "operator_stop_boundary"; break; }
  }
  const contrasts = [], timingContrasts = [], incomplete = [];
  for (const scenario of definition.scenarios) {
    const baseline = rows.filter(r => r.scenario === scenario && r.treatment === definition.treatments[0]).map(r => r.report),
      candidate = rows.filter(r => r.scenario === scenario && r.treatment === definition.treatments[1]).map(r => r.report);
    if (baseline.length !== definition.seeds || candidate.length !== definition.seeds) { incomplete.push(scenario); continue; }
    for (const resource of new Set([...baseline, ...candidate].flatMap(r => Object.keys(r.metrics?.services ?? {})))) {
      try { contrasts.push({ scenario, resource, ...pairedBootstrap(baseline, candidate, { resource }) }); }
      catch (e) { contrasts.push({ scenario, resource, comparisonRejected: true, reason: e.code ?? e.name, message: e.message, improvement: null }); }
    }
    if (study === "K07") {
      // Use the common comparator as the source/config/horizon pair guard.
      // Timing remains measured milliseconds, not relabelled resource deficit.
      try {
        pairedBootstrap(baseline, candidate, { resource: "water" });
        for (const field of ["draftObservedMs", "firstUsefulServiceObservedMs", "sufficientServiceObservedMs"]) {
          const pairs = baseline.map(b => {
            const c = candidate.find(v => v.seed === b.seed);
            return { seed: b.seed, baselineMs: b.timing?.[field] ?? null, candidateMs: c.timing?.[field] ?? null,
              baselineCensored: field === "draftObservedMs" ? b.timing?.draftRightCensored : field === "firstUsefulServiceObservedMs" ? b.timing?.serviceRightCensored : b.timing?.sufficientRightCensored,
              candidateCensored: field === "draftObservedMs" ? c.timing?.draftRightCensored : field === "firstUsefulServiceObservedMs" ? c.timing?.serviceRightCensored : c.timing?.sufficientRightCensored,
              originalOperationIds: [b.timing?.originalOperationId ?? null, c.timing?.originalOperationId ?? null] };
          });
          const complete = pairs.every(p => Number.isFinite(p.baselineMs) && Number.isFinite(p.candidateMs)),
            baselineMeanMs = complete ? pairs.reduce((s,p) => s+p.baselineMs,0)/pairs.length : null,
            candidateMeanMs = complete ? pairs.reduce((s,p) => s+p.candidateMs,0)/pairs.length : null;
          timingContrasts.push({ scenario, field, unit: "milliseconds since change became accessible to the platform", pairs,
            baselineMeanMs, candidateMeanMs, improvement: baselineMeanMs > 0 ? 1-candidateMeanMs/baselineMeanMs : null,
            incomplete: !complete, evidenceLevel: "two internally authored worlds, descriptive ablation only",
            note: "Missing change receipt is null; missing draft/service is right-censored at the same finite horizon. No professional-baseline or population claim." });
        }
      } catch(e) { timingContrasts.push({ scenario, comparisonRejected: true, reason: e.code ?? e.name, message: e.message, improvement: null }); }
    }
  }
  const summaries = rows.map(({ report: r, ...item }) => ({ ...item, status: r.status, errors: [...(r.errors ?? []), ...(r.error ? [r.error] : [])],
    candidateFingerprint: r.candidateFingerprint, evaluatorFingerprint: r.evaluatorFingerprint, engineBuild: r.manifest?.engineBuild,
    services: r.metrics?.services, subgroups: r.metrics?.subgroups, perCommunity: r.metrics?.perCommunity,
    physical: r.metrics?.physical, collective: r.metrics?.collective, response: r.metrics?.response,
    queries: r.metrics?.queries, toolCost: r.metrics?.cost, violations: r.invariants,
    providerCalls: r.usage?.length ?? null, providerWallMs: (r.usage ?? []).reduce((s, u) => s + (Number.isFinite(u.wall_ms) ? u.wall_ms : 0), 0),
    providerWallMissing: (r.usage ?? []).filter(u => !Number.isFinite(u.wall_ms)).length,
    models: [...new Set((r.usage ?? []).map(u => u.model).filter(Boolean))],
    knownCostUsd: r.costUsd, chargedBudgetUsd: r.chargedBudgetUsd,
    unknownCostCalls: r.unknownCostCalls ?? (r.usage ?? []).filter(u => u.cost_usd == null).length,
    before: r.before, after: r.after, timing: r.timing, funnel: r.funnel, totalWallMs: r.wallMs }));
  const finalBuilds = await checkFinalBuilds({ candidate: current.candidateFingerprint, evaluator: current.evaluatorFingerprint, simulator: current.simulatorBuild }, { candidate: buildFingerprint, evaluator: evaluatorFingerprint });
  if (finalBuilds.invalidStatus) stoppedReason ??= "source_changed_after_episode";
  const summary = { protocol, completed: rows.length, planned: planned.length, incomplete, missingOutcomes,
    notAttempted: planned.filter(p => !rows.some(r => r.scenario === p.scenario && r.seed === p.seed && r.treatment === p.treatment) &&
      !missingOutcomes.some(r => r.scenario === p.scenario && r.seed === p.seed && r.treatment === p.treatment)),
    stoppedReason, finalBuilds, cases: summaries, contrasts, timingContrasts,
    knownCostUsd: summaries.reduce((s, r) => s + Number(r.knownCostUsd ?? 0), 0),
    chargedBudgetUsd: charged, unknownCostCalls: summaries.reduce((s, r) => s + r.unknownCostCalls, 0),
    limitations: [definition.attribution, "An absent/censored attempt is not a zero-minute success; a query is not useful service.",
      "Few internal worlds do not establish population superiority or an independently annotated query-value score.",
      "Missing outcomes reserve the full episode cap, with unknown provider calls/cost, and are not paired or silently dropped."] };
  await writeFile(folder + "/summary.json", JSON.stringify(summary, null, 2));
  await checkpoint();
  console.log(JSON.stringify({ folder, completed: rows.length, planned: planned.length, stoppedReason,
    knownCostUsd: summary.knownCostUsd, chargedBudgetUsd: charged, unknownCostCalls: summary.unknownCostCalls, missingOutcomes: missingOutcomes.length }));
  if (stoppedReason || incomplete.length || missingOutcomes.length || rows.some(r => r.report.status !== "completed" || r.report.invariants?.length)) process.exitCode = 1;
} finally {
  const held = JSON.parse(await readFile(lockFile, "utf8"));
  if (held.nonce !== nonce || held.pid !== process.pid) throw Error("The single-worker study lock changed; leave it for review.");
  await unlink(lockFile);
}
