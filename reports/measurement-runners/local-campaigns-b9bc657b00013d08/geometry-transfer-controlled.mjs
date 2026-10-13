import { readFile, writeFile, mkdir, open, access, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { runDiscoveryEpisode, summarizeDiscovery, DISCOVERY_PROTOCOL } from "../evaluation/discovery-benchmark.mjs";
import { buildFingerprint, evaluatorFingerprint } from "../evaluation/harness.mjs";
import { requireLoadedSimulatorBuild, checkFinalBuilds } from "../evaluation/simulator-build.mjs";

// Ignored orchestration. Imports the frozen evaluator unchanged; never modifies
// corpus, world, controller or permissions. Explicit root GO is mandatory.
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("="))),
  plan = JSON.parse(await readFile(new URL("./geometry-transfer-plan.json", import.meta.url), "utf8")),
  planned = plan.worlds.flatMap(world => plan.arms.map(arm => ({ ...world, arm }))),
  stopFile = resolve(plan.stopFile), lockFile = resolve(".local/PAID_RESEARCH_STUDY.lock");
if (Object.hasOwn(args, "plan")) {
  console.log(JSON.stringify({ ...plan, planned, providerCalls: "not_started" }, null, 2));
  process.exit(0);
}
if (!args.freeze) throw Error("A new root-approved freeze is mandatory. --plan makes no calls.");
const expected = JSON.parse(await readFile(resolve(args.freeze), "utf8")),
  current = { candidateFingerprint: await buildFingerprint(), evaluatorFingerprint: await evaluatorFingerprint(), simulatorBuild: await requireLoadedSimulatorBuild() };
for (const key of Object.keys(current)) {
  const desired = key === "simulatorBuild" ? expected.simulatorBuild ?? expected.simulatorFingerprint ?? expected.engineBuild : expected[key];
  if (!desired || desired !== current[key]) throw Error("Freeze mismatch: " + key);
}
if (args.run !== "ROOT_GO_K18") {
  console.log(JSON.stringify({ state: "dry_run_hashes_match_no_provider_call", ...current, planned }, null, 2));
  process.exit(0);
}
async function stopped() { try { await access(stopFile); return true; } catch (e) { if (e.code !== "ENOENT") throw e; return false; } }
if (await stopped()) throw Error("Preserve the new study stop marker; request a new root gate instead of deleting it.");
const nonce = randomUUID(), lock = await open(lockFile, "wx");
await lock.writeFile(JSON.stringify({ nonce, pid: process.pid, study: plan.study, at: new Date().toISOString(), ...current }));
await lock.close();
const folder = "reports/discovery/geometry-gated-" + Date.now(),
  runnerBytes = await readFile(new URL(import.meta.url)), rows = [], missingOutcomes = [];
let charged = 0, activeEpisode = null, stoppedReason = null, interrupt = false;
process.on("SIGINT", () => { interrupt = true; });
process.on("SIGTERM", () => { interrupt = true; });
const shouldStop = async () => interrupt || await stopped();
await mkdir(folder, { recursive: true });
const protocol = { ...plan, state: "running", at: new Date().toISOString(), ...current, discoveryProtocol: DISCOVERY_PROTOCOL,
  rootApprovedFreeze: resolve(args.freeze), planned, runnerSha256: createHash("sha256").update(runnerBytes).digest("hex"),
  stopPolicy: "One episode at a time. Interrupt only at a settled provider/round boundary; costs and already issued physical consequences remain retained." };
await writeFile(folder + "/protocol.json", JSON.stringify(protocol, null, 2));
await writeFile(folder + "/runner.mjs", runnerBytes);
async function checkpoint() {
  await writeFile(folder + "/progress.json", JSON.stringify({ completed: rows.length, planned: planned.length, chargedBudgetUsd: charged,
    activeEpisode, missingOutcomes, stoppedReason }, null, 2));
}
try {
  for (const item of planned) {
    if (await shouldStop()) { stoppedReason = "operator_stop_boundary"; break; }
    if (item.arm === "B6" && charged + plan.config.budgetUsd > plan.totalBudgetUsd + 1e-10) { stoppedReason = "budget_cap"; break; }
    const before = await checkFinalBuilds({ candidate: current.candidateFingerprint, evaluator: current.evaluatorFingerprint, simulator: current.simulatorBuild }, { candidate: buildFingerprint, evaluator: evaluatorFingerprint });
    if (before.invalidStatus) { stoppedReason = "source_changed_before_episode"; break; }
    activeEpisode = { ...item, reservedUsd: item.arm === "B6" ? plan.config.budgetUsd : 0,
      calls: null, costUsd: null, state: "inflight_not_an_outcome", at: new Date().toISOString() };
    await checkpoint();
    console.log(JSON.stringify({ folder, running: activeEpisode }));
    let report;
    try {
      report = await runDiscoveryEpisode({ ...plan.config, arm: item.arm, seed: item.seed, grid: item.grid, extentKm: item.extentKm,
        candidateFingerprint: current.candidateFingerprint, evaluatorBuild: current.evaluatorFingerprint, shouldStop,
        onProgress: p => console.log(JSON.stringify({ phase: "progress", world: item.id, arm: item.arm, ...p })) });
      if (!Number.isFinite(report.chargedBudgetUsd)) throw Error("An outcome omitted charged cost; it cannot be treated as zero.");
      await writeFile(`${folder}/${item.id}-${item.arm}.json`, JSON.stringify(report, null, 2));
      rows.push(report); charged += report.chargedBudgetUsd;
    } catch (e) {
      const reservedUsd = item.arm === "B6" ? plan.config.budgetUsd : 0;
      charged += reservedUsd;
      missingOutcomes.push({ ...item, status: "missing_outcome_after_exception", calls: null, costUsd: null, reservedUsd,
        error: { code: e.code ?? e.name, message: String(e.message).slice(0, 250) } });
      stoppedReason = "unsettled_or_unrecordable_episode";
    }
    activeEpisode = null;
    await checkpoint();
    if (stoppedReason) break;
    if (report.candidateChanged || report.evaluatorChanged || report.simulatorChanged) { stoppedReason = "source_changed_during_episode"; break; }
    if (report.status === "aborted") { stoppedReason = "operator_stop_boundary"; break; }
  }
  let effects;
  try { effects = summarizeDiscovery(rows); }
  catch (e) { effects = { comparisons: [], comparisonRejected: true, reason: e.message }; }
  const finalBuilds = await checkFinalBuilds({ candidate: current.candidateFingerprint, evaluator: current.evaluatorFingerprint, simulator: current.simulatorBuild }, { candidate: buildFingerprint, evaluator: evaluatorFingerprint });
  if (finalBuilds.invalidStatus) stoppedReason ??= "source_changed_after_episode";
  const summaries = rows.map(r => ({ arm: r.arm, seed: r.seed, status: r.status, errors: r.errors,
    timeToFirstUsefulService: r.timeToFirstUsefulService, timeToSufficientService: r.timeToSufficientService,
    nativeServices: r.metrics?.services, subgroups: r.metrics?.subgroups, perCommunity: r.metrics?.perCommunity,
    physical: r.metrics?.physical, invariants: r.invariants, sourceCoverage: r.sourceCoverage,
    calls: r.usage?.length ?? null, costUsd: r.costUsd, chargedBudgetUsd: r.chargedBudgetUsd,
    unknownCostCalls: r.unknownCostCalls ?? r.usage?.filter(u => u.cost_usd == null).length ?? null,
    providerWallMs: (r.usage ?? []).filter(u => Number.isFinite(u.wall_ms)).reduce((n,u) => n+u.wall_ms, 0),
    providerWallMissing: (r.usage ?? []).filter(u => !Number.isFinite(u.wall_ms)).length,
    modelConfig: r.modelConfig, wallMs: r.wallMs }));
  const summary = { ...effects, protocol, finalBuilds, stoppedReason, cases: summaries, missingOutcomes,
    plannedEpisodes: planned.length, closedEpisodes: rows.length,
    notAttempted: planned.filter(p => !rows.some(r => r.seed === p.seed && r.arm === p.arm) && !missingOutcomes.some(r => r.seed === p.seed && r.arm === p.arm)),
    knownCostUsd: summaries.reduce((n,r) => n+Number(r.costUsd ?? 0), 0), chargedBudgetUsd: charged,
    limitations: plan.unsupported };
  await writeFile(folder + "/summary.json", JSON.stringify(summary, null, 2));
  await checkpoint();
  console.log(JSON.stringify({ folder, closedEpisodes: rows.length, plannedEpisodes: planned.length, stoppedReason,
    chargedBudgetUsd: charged, missingOutcomes: missingOutcomes.length }));
  if (stoppedReason || rows.length !== planned.length || missingOutcomes.length || rows.some(r => r.status !== "completed" || r.invariants?.length)) process.exitCode = 1;
} finally {
  const held = JSON.parse(await readFile(lockFile, "utf8"));
  if (held.nonce !== nonce || held.pid !== process.pid) throw Error("The single-worker lock changed; preserve it for review.");
  await unlink(lockFile);
}
