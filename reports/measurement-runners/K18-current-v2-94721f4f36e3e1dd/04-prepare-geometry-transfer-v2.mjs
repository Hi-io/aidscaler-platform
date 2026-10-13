// Byte-only preparation. Never imports a world/evaluator/provider or outcomes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {GEOMETRY_SOURCE,validateGeometryPlan} from './geometry-transfer-v2-guards.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const originalBytes=await readFile('.local/geometry-transfer-plan.json'),original=JSON.parse(originalBytes.toString('utf8'));
const plan={...original,config:{...original.config,traffic:15},source:GEOMETRY_SOURCE,
  version:'K18-current-v2-explicit-traffic-count-amendment',
  amendment:{legacyDeclaredTraffic:.15,correctedNativeVehicleCount:15,
    originalParameterState:'INVALID_NATIVE_INTEGER_NO_WORLD_STARTED',
    rationale:'Original discovery traffic was passed directly to integer backgroundTraffic; no .15-to-15 conversion exists. Root approved explicit15 vehicles before outcomes, equally in all six worlds.',
    preserved:'Same two maps/seeds, arms, every other configuration value, provider limits and .40 admission ceiling; no grant, simpler arm or favorable rerun.'},
  frozenGate:{path:'reports/measurement-freezes/1791876112534-v4.json',sha256:'4c94d17e373f60b16926b7d5be5c566bf22b448efb63129034b5ead10ebdc44b',counts:{platform:486,simulator:247,ui:113}},
  command:'node .local/geometry-transfer-controlled-v2.mjs --freeze=<exact archived v4 freeze> --run=ROOT_GO_K18'};
validateGeometryPlan(plan,original);
await writeFile('.local/geometry-transfer-v2-plan.json',JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
let text=await readFile('.local/geometry-transfer-controlled.mjs','utf8');
function replace(a,b){if(!text.includes(a))throw Error('Preparation anchor missing');text=text.replace(a,b);}
replace('import { requireLoadedSimulatorBuild, checkFinalBuilds } from "../evaluation/simulator-build.mjs";',
  'import { requireLoadedSimulatorBuild, checkFinalBuilds } from "../evaluation/simulator-build.mjs";\nimport {humanCapacityEvaluatorFingerprint} from "../evaluation/human-capacity-benchmark.mjs";\nimport {validateGeometryGate,validateGeometryPlan,geometryFee,auditGeometryProfile} from "./geometry-transfer-v2-guards.mjs";');
replace('plan = JSON.parse(await readFile(new URL("./geometry-transfer-plan.json", import.meta.url), "utf8")),',
  'plan = JSON.parse(await readFile(new URL("./geometry-transfer-v2-plan.json", import.meta.url), "utf8")),\n  originalPlan = JSON.parse(await readFile(new URL("./geometry-transfer-plan.json", import.meta.url), "utf8")),');
replace('if (Object.hasOwn(args, "plan")) {','validateGeometryPlan(plan,originalPlan);\nif (Object.hasOwn(args, "plan")) {');
replace('if (args.run !== "ROOT_GO_K18") {',
  'const actualHumanFingerprint=await humanCapacityEvaluatorFingerprint();\nvalidateGeometryGate(expected,{...current,humanEvaluatorFingerprint:actualHumanFingerprint});\nif(createHash("sha256").update(await readFile(resolve(args.freeze))).digest("hex")!==plan.frozenGate.sha256)throw Error("Exact approved v4 freeze bytes required");\nif (args.run !== "ROOT_GO_K18") {');
replace('const protocol = { ...plan, state: "running", at: new Date().toISOString(), ...current, discoveryProtocol: DISCOVERY_PROTOCOL,',
  'const protocol = { ...plan, state: "running", at: new Date().toISOString(), ...current, humanEvaluatorFingerprint:actualHumanFingerprint, discoveryProtocol: DISCOVERY_PROTOCOL,');
replace('if (!Number.isFinite(report.chargedBudgetUsd)) throw Error("An outcome omitted charged cost; it cannot be treated as zero.");',
  'report.geometryProfileAudit=auditGeometryProfile(report,item,plan);\n      report.studyFeeEvidence=geometryFee(report,item.arm);');
replace('rows.push(report); charged += report.chargedBudgetUsd;', 'rows.push(report); charged += report.studyFeeEvidence.chargedBudgetUsd;');
replace('if (report.candidateChanged || report.evaluatorChanged || report.simulatorChanged)',
  'if (!report.geometryProfileAudit.matches) {stoppedReason = "declared_native_profile_mismatch";break;}\n    if (report.candidateChanged || report.evaluatorChanged || report.simulatorChanged)');
replace('try { effects = summarizeDiscovery(rows); }',
  'try { if(rows.some(r=>!r.geometryProfileAudit?.matches))throw Error("Native scenario differs from declared traffic/corpus"); effects = summarizeDiscovery(rows); }');
replace('modelConfig: r.modelConfig, wallMs: r.wallMs }));', 'modelConfig: r.modelConfig, wallMs: r.wallMs, geometryProfileAudit:r.geometryProfileAudit,fee:geometryFee(r,r.arm) }));');
replace('knownCostUsd: summaries.reduce((n,r) => n+Number(r.costUsd ?? 0), 0), chargedBudgetUsd: charged,',
  'knownCostSubtotalUsd: summaries.reduce((n,r)=>n+(r.fee.knownCostSubtotalUsd??0),0),\n    totalProviderCostUsd:missingOutcomes.length||summaries.some(r=>!r.fee.totalCostKnown)?null:summaries.reduce((n,r)=>n+r.fee.totalProviderCostUsd,0), chargedBudgetUsd: charged,');
replace('limitations: plan.unsupported };',
  'humanEvaluatorFinalFingerprint:await humanCapacityEvaluatorFingerprint(),humanEvaluatorChanged:actualHumanFingerprint!==await humanCapacityEvaluatorFingerprint(),\n    limitations: plan.unsupported };');
await writeFile('.local/geometry-transfer-controlled-v2.mjs',text,{flag:'wx'});
await mkdir('.local/evidence-runners-v2',{recursive:true});
await writeFile('.local/evidence-runners-v2/K18_TRAFFIC_AMENDMENT.md',
  '# K18 parameter amendment before outcomes\n\nOld traffic:.15 is an invalid native integer, not an automatic conversion or a percentage. The frozen discovery evaluator passes traffic directly to backgroundTraffic; source validateConfig requires integer and World schedules one background trip per index. Source inspection established the failure without starting a world/provider.\n\nRoot approved native15 vehicles common to all six new episodes. Original helper/plan/archive remain unchanged. Every other seed/map/configuration/cap remains unchanged. Actual result manifest must show backgroundTraffic15, packetLoss.05 and the declared map. All negative/silent/loss/partial/censored results remain in the denominator. This is internal geometry and connectivity variation, not native-human silent-loss sensitivity, new languages/services, independent holdout or a confidence guarantee.\n', {flag:'wx'});
console.log(JSON.stringify({state:'prepared_not_launched',plan:resolve('.local/geometry-transfer-v2-plan.json'),runner:resolve('.local/geometry-transfer-controlled-v2.mjs'),
  originalPlanSha256:sha(originalBytes),worldsStarted:0,providerCalls:0,admissionBudgetUsd:.4,nominalPaidCapsUsd:.3}));
