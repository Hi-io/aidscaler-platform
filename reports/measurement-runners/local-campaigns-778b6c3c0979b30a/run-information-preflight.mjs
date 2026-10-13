import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hash } from "../src/store.mjs";
import { runDiscoveryEpisode, DISCOVERY_PROTOCOL } from "../evaluation/discovery-benchmark.mjs";
import { buildFingerprint, evaluatorFingerprint } from "../evaluation/harness.mjs";
import { checkFinalBuilds, requireLoadedSimulatorBuild } from "../evaluation/simulator-build.mjs";
import { verificationPassed } from "../scripts/verification-gates.mjs";

// Ignored orchestration only. Explicit GO is required; preparing this helper
// never starts the lab or a model. This is the declared free first-seed screen.
if (!process.argv.includes("--go")) throw Error("Preflight not launched: explicit --go is required");
const planFile = "reports/information-load-plan.json";
const plan = JSON.parse(await readFile(planFile, "utf8"));
const p = plan.primary;
if (p.needs !== 24 || p.noise !== 768) throw Error("Unexpected predeclared information-load profile");
const fingerprints = {
  candidateFingerprint: await buildFingerprint(),
  evaluatorFingerprint: await evaluatorFingerprint(),
  simulatorFingerprint: await requireLoadedSimulatorBuild(),
};
const verification = JSON.parse(await readFile("reports/verification-latest.json", "utf8"));
if (!verificationPassed(verification) || Object.entries(fingerprints).some(([k,v]) => verification[k] !== v || plan[k] !== v))
  throw Error("Fresh full verification and current plan must match all three frozen source hashes");
const config = {
  count: p.needs, noise: p.noise, reposts: p.reposts,
  humanReadMs: p.humanReadMs, humanWorkers: p.humanWorkers,
  clarificationWorkers: p.clarificationWorkers, formalDelayMs: p.formalDelayMs,
  horizonMs: p.horizonMs, maxModelCalls: p.maxModelCalls,
  budgetUsd: p.episodeBudgetUsd, silentFraction: p.silentFraction ?? 0,
  packetLoss: p.packetLoss ?? 0, traffic: p.traffic ?? 0,
  extentKm: p.extentKm ?? 6, grid: p.grid ?? 9,
  candidateFingerprint: fingerprints.candidateFingerprint,
  evaluatorBuild: fingerprints.evaluatorFingerprint,
};
const arms = ["B5", "B8"], seed = p.seedPrefix + "-01";
const folder = "reports/discovery/" + Date.now();
const stopFile = ".local/information-preflight.stop";
if (existsSync(stopFile)) throw Error("Preflight stop file already exists; inspect it before launching");
let interrupted = false;
process.on("SIGINT", () => { interrupted = true; console.log(JSON.stringify({phase:"stopping_at_safe_boundary"})); });
process.on("SIGTERM", () => { interrupted = true; });
await mkdir(folder, {recursive:true});
await writeFile(folder + "/protocol.json", JSON.stringify({
  at: new Date().toISOString(), purpose: "Declared free information-load preflight; does not replace the original experiment or establish an LLM benefit",
  planFile, declaredPlanHash: hash(plan), ...DISCOVERY_PROTOCOL,
  config, arms, seeds: 1, seed, simulatorBuild: fingerprints.simulatorFingerprint,
  totalBudgetUsd: 0, providerGuard: "Any inference request is an error; no billed provider is attached",
  stop: "Retain every declared outcome including censoring/failure; preserve runDiscoveryEpisode's existing physical-need/trip early completion and final fixed-horizon scoring. This is K02 attribution, not K22 recovery of all received sources",
}, null, 2));
console.log(JSON.stringify({phase:"preflight_started",folder,seed,arms}));
const rows = [];
let stoppedReason = null;
for (const arm of arms) {
  const gate = await checkFinalBuilds({candidate:fingerprints.candidateFingerprint,evaluator:fingerprints.evaluatorFingerprint,simulator:fingerprints.simulatorFingerprint},{candidate:buildFingerprint,evaluator:evaluatorFingerprint});
  if (gate.invalidStatus || interrupted || existsSync(stopFile)) { stoppedReason = gate.invalidStatus ?? "interrupted"; break; }
  console.log(JSON.stringify({phase:"started",folder,arm,seed}));
  const r = await runDiscoveryEpisode({
    ...config, arm, seed,
    provider: {complete: async () => { throw Object.assign(Error("Unexpected model request in the declared free reference preflight"),{code:"FREE_PREFLIGHT_MODEL_REQUEST"}); }},
    shouldStop: () => interrupted || existsSync(stopFile),
    onProgress: progress => console.log(JSON.stringify({phase:"progress",...progress})),
  });
  rows.push(r);
  await writeFile(folder + "/" + seed + "-" + arm + ".json",JSON.stringify(r,null,2));
  console.log(JSON.stringify({phase:"completed",folder,arm,seed,status:r.status,served:r.timeToSufficientService.completed+"/"+r.outcomes.length,rmstMinutes:r.timeToSufficientService.restrictedMeanMs/60000,calls:r.usage.length,chargedUsd:r.chargedBudgetUsd,invariants:r.invariants.length,errors:r.errors.map(e=>e.code)}));
  if (r.usage.length || r.chargedBudgetUsd) { stoppedReason = "unexpected_reference_inference"; break; }
  if (r.candidateChanged || r.evaluatorChanged || r.simulatorChanged) { stoppedReason = "source_changed"; break; }
  if (interrupted || existsSync(stopFile)) { stoppedReason = "interrupted"; break; }
}
await writeFile(folder + "/preflight-index.json",JSON.stringify({planFile,seed,arms,fingerprints,stoppedReason,declaredRuns:2,completedRuns:rows.length,runs:rows.map(r=>({arm:r.arm,status:r.status,file:seed+"-"+r.arm+".json"})),note:"Read paired closed reports before admitting paid interpretation. No favorable selection or synthetic imputation. The existing K02 physical-completion stopping condition is unchanged; this preflight cannot claim K22 source-queue recovery."},null,2));
console.log(JSON.stringify({phase:"preflight_finished",folder,stoppedReason,runs:rows.length}));
if (stoppedReason || rows.some(r=>r.status!=="completed" || r.invariants.length || r.errors.length)) process.exitCode=1;
