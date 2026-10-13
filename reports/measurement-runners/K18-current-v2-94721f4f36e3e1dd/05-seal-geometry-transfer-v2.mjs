// Byte-only sealing; never launches the prepared K18 child or reads outcomes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,basename} from 'node:path';
import {validateGeometryPlan,GEOMETRY_SOURCE,validateGeometryGate} from './geometry-transfer-v2-guards.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const names=['.local/geometry-transfer-controlled-v2.mjs','.local/geometry-transfer-v2-plan.json','.local/geometry-transfer-v2-guards.mjs',
  '.local/geometry-transfer-v2.test.mjs','.local/prepare-geometry-transfer-v2.mjs','.local/seal-geometry-transfer-v2.mjs',
  '.local/evidence-runners-v2/K18_TRAFFIC_AMENDMENT.md','.local/evidence-probe-guards-v2.mjs','.local/read-human-capacity-evidence.mjs',
  '.local/geometry-transfer-controlled.mjs','.local/geometry-transfer-plan.json'];
const rows=await Promise.all(names.map(async path=>{const bytes=await readFile(path);return {path:resolve(path),sha256:sha(bytes),bytes};}));
const plan=JSON.parse(rows[1].bytes.toString('utf8')),original=JSON.parse(rows.at(-1).bytes.toString('utf8'));
validateGeometryPlan(plan,original);
const freezeBytes=await readFile(plan.frozenGate.path),freeze=JSON.parse(freezeBytes.toString('utf8'));
if(sha(freezeBytes)!==plan.frozenGate.sha256)throw Error('New freeze bytes differ');
validateGeometryGate(freeze,{candidateFingerprint:GEOMETRY_SOURCE.candidate,evaluatorFingerprint:GEOMETRY_SOURCE.baseEvaluator,
  simulatorBuild:GEOMETRY_SOURCE.simulator,humanEvaluatorFingerprint:GEOMETRY_SOURCE.humanEvaluator});
rows.push({path:resolve(plan.frozenGate.path),sha256:sha(freezeBytes),bytes:freezeBytes});
const folder=resolve('reports/measurement-runners/K18-current-v2-'+rows[0].sha256.slice(0,16));await mkdir(folder,{recursive:true});
const files=[];
for(const [i,row] of rows.entries()){const path=resolve(folder,String(i).padStart(2,'0')+'-'+basename(row.path));
  await writeFile(path,row.bytes,{flag:'wx'});files.push({path:row.path,sha256:row.sha256,archivedPath:path,bytes:row.bytes.length});}
const manifest={schema:'K18-current-v2-explicit-traffic-count-amendment',state:'prepared_not_launched',source:GEOMETRY_SOURCE,
  entries:[{id:'K18',entry:'.local/geometry-transfer-controlled-v2.mjs',entrySha256:rows[0].sha256,
    fixedArgs:['--run=ROOT_GO_K18'],discovery:{root:'reports/discovery',prefix:'geometry-gated-'},stopFile:plan.stopFile,
    declaredStudyAdmissionBudgetUsd:.40,selectedNominalPaidCapsUsd:.30,maxReserveUsd:.40}],
  worlds:plan.worlds.flatMap(w=>plan.arms.map(arm=>({...w,arm}))),plannedWorlds:6,
  providerAttemptScopes:{paidWorlds:2,episodeBudgetUsd:.15,maxModelCallsPerPaidWorld:32,totalStudyAdmissionBudgetUsd:.40},
  freeze:plan.frozenGate,files,pureTests:{tests:6,pass:6,fail:0},worldsStarted:0,providerCalls:0,
  originalParameterFailure:{state:'source_inspection_only_no_world_started',legacyDeclaredTraffic:.15,
    directPassThrough:'evaluation/discovery-benchmark.mjs backgroundTraffic:traffic',
    sourceGuard:'contracts/config.mjs requires integer backgroundTraffic',
    correctedNativeVehicleCount:15},
  limitations:plan.unsupported,
  note:'Original plan/helper/archive remain intact. This is a pre-outcome parameter correction shared by all six arms, not favorable retry. Geometry/silence/loss uses ordinary discovery; it does not complete the blocked native-human silent_loss sensitivity.'};
const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
await writeFile(resolve(folder,'manifest.json'),bytes,{flag:'wx'});
await writeFile('.local/evidence-runners-v2/K18-manifest.json',bytes,{flag:'wx'});
console.log(JSON.stringify({folder,manifest:resolve('.local/evidence-runners-v2/K18-manifest.json'),manifestSha256:sha(bytes),runnerSha256:rows[0].sha256,
  planSha256:rows[1].sha256,tests:6,worldsStarted:0,providerCalls:0,admissionBudgetUsd:.4,nominalPaidCapsUsd:.3}));
