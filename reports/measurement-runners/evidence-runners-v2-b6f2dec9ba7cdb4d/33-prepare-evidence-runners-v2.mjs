// Offline-only copies: no evaluator import, world, provider or outcomes read.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
export const SOURCE={candidate:'9b4de8b7769c69a3279067a8a093ef6d2392ec8a9728e704f871a184a69934e3',
  baseEvaluator:'d64f62747ecd5a36f77b9cd34dc6e1b2b37a77220cae9f206bb773a0a4263090',
  humanEvaluator:'75c635a59eda752820aabef317a42799915a46a5fc7fba82ad9d0382d69ea29e',
  simulator:'561e6a02fbde1d047f999c4f077cbff83c438ba5c508c4d8d18bbf59ff78e94b'};
const names=['evidence-probe-guards','minimal-semantic-studies','current-service-recovery',
  'research-studies-controlled','combined-100-controlled','physical-scenario-evidence'];
const extra=['evidence-probe-guards.test.mjs','minimal-semantic-studies.test.mjs','minimal-semantic-studies-guide.md',
  'current-service-recovery.test.mjs','current-service-recovery-guide.md','combined-100-controlled.test.mjs',
  'combined-100-guide.md','physical-scenario-evidence.test.mjs','physical-scenario-evidence-guide.md'];
const files=[...names.map(n=>n+'.mjs'),...extra];
const v2=n=>n.replace(/(\.test)?\.(mjs|md)$/,(_,test='',ext)=>'-v2'+test+'.'+ext);
function replace(text,a,b){if(!text.includes(a))throw Error('Missing preparation anchor: '+a.slice(0,70));return text.replace(a,b);}
function rebind(text){for(const name of files)text=text.replaceAll(name,v2(name));return text;}
const paths=[];
for(const name of files){
  const originalPath=resolve('.local',name),originalBytes=await readFile(originalPath);
  let text=rebind(originalBytes.toString('utf8'));
  if(name==='evidence-probe-guards.mjs'){
    text=replace(text,'export function validateProbeGate(freeze, current) {',`export const V2_SOURCE=${JSON.stringify(SOURCE)};
export function validateProbeGate(freeze, current) {
  const declared={candidateFingerprint:V2_SOURCE.candidate,evaluatorFingerprint:V2_SOURCE.baseEvaluator,simulatorBuild:V2_SOURCE.simulator};
  for(const key of Object.keys(declared)) if(current[key]!==declared[key])throw Error('Authorized v4 source mismatch: '+key);
  if(freeze?.humanEvaluatorFingerprint!=null&&freeze.humanEvaluatorFingerprint!==V2_SOURCE.humanEvaluator)
    throw Error('Authorized v4 human evaluator mismatch');`);
  }
  if(name==='current-service-recovery.mjs'){
    text=replace(text,'4b4d289e387b49da8d79fdccb260a67919b74339432731373204d96aee6668b3',SOURCE.baseEvaluator);
    text=replace(text,"export async function sealCurrentStudies(){const freeze=JSON.parse(await readFile('reports/measurement-freeze-current.json','utf8'));",
      "export async function sealCurrentStudies(freezePath){if(!freezePath)throw Error('Explicit current freeze path required');const freeze=JSON.parse(await readFile(resolve(freezePath),'utf8'));" );
    text=replace(text,"const bytes=await readFile('reports/measurement-freeze-current.json'),file=",'const bytes=await readFile(resolve(freezePath)),file=');
    text=replace(text,'const archive=await sealCurrentStudies(),nonce=', 'const archive=await sealCurrentStudies(options.freeze),nonce=');
    text=replace(text,'opts.seal?await sealCurrentStudies():await runStudy(opts)', 'opts.seal?await sealCurrentStudies(opts.freeze):await runStudy(opts)');
  }
  if(name==='combined-100-controlled.mjs'){
    text=replace(text,"import { createHash, randomUUID } from 'node:crypto';", "import { createHash, randomUUID } from 'node:crypto';\nimport {validateProbeGate} from './evidence-probe-guards-v2.mjs';");
    text=replace(text,'export function validate100Gate(freeze, current) {','export function validate100Gate(freeze, current) {\n  validateProbeGate(freeze,current);');
    text=replace(text,"const bundleNames = ['combined-100-controlled-v2.mjs','combined-100-controlled-v2.test.mjs','combined-100-guide-v2.md'];",
      "const bundleNames = ['combined-100-controlled-v2.mjs','combined-100-controlled-v2.test.mjs','combined-100-guide-v2.md','evidence-probe-guards-v2.mjs'];");
  }
  if(name==='research-studies-controlled.mjs'){
    text=replace(text,'import { pairedBootstrap } from "../src/evaluation.mjs";', 'import { pairedBootstrap } from "../src/evaluation.mjs";\nimport {validateProbeGate} from "./evidence-probe-guards-v2.mjs";');
    text=replace(text,'if (args.run !== "ROOT_GO_" + study) {','validateProbeGate(expected,current);\nif (args.run !== "ROOT_GO_" + study) {');
  }
  // Only synthetic gate fixtures change to the authorized source; assertions remain.
  if(name.endsWith('.test.mjs')){
    text=text.replaceAll("candidate:'a'.repeat(64)",`candidate:'${SOURCE.candidate}'`)
      .replaceAll("evaluator:'b'.repeat(64)",`evaluator:'${SOURCE.baseEvaluator}'`)
      .replaceAll("simulator:'c'.repeat(64)",`simulator:'${SOURCE.simulator}'`)
      .replaceAll("candidateFingerprint:'a'.repeat(64)",`candidateFingerprint:'${SOURCE.candidate}'`)
      .replaceAll("evaluatorFingerprint:'b'.repeat(64)",`evaluatorFingerprint:'${SOURCE.baseEvaluator}'`)
      .replaceAll("simulatorBuild:'c'.repeat(64)",`simulatorBuild:'${SOURCE.simulator}'`)
      .replaceAll("candidateFingerprint:'c'.repeat(64)",`candidateFingerprint:'${SOURCE.candidate}'`)
      .replaceAll("evaluatorFingerprint:'e'.repeat(64)",`evaluatorFingerprint:'${SOURCE.baseEvaluator}'`)
      .replaceAll("simulatorBuild:'a'.repeat(64)",`simulatorBuild:'${SOURCE.simulator}'`);
  }
  const path=resolve('.local',v2(name)),bytes=Buffer.from(text);
  await writeFile(path,bytes,{flag:'wx'});
  paths.push({path,sha256:sha(bytes),bytes:bytes.length,original:{path:originalPath,sha256:sha(originalBytes)}});
}
const entries=[
  {id:'K11_K13',stem:'minimal-semantic-studies',maxReserveUsd:.12,folder:true,fixedArgs:['--kind=K11_K13','--run=ROOT_GO_SEMANTIC_PILOT'],stopFile:'.local/STOP_MINIMAL_SEMANTIC_STUDIES'},
  {id:'K15',stem:'minimal-semantic-studies',maxReserveUsd:.30,folder:true,fixedArgs:['--kind=K15','--run=ROOT_GO_K15_CURRENT'],stopFile:'.local/STOP_MINIMAL_SEMANTIC_STUDIES'},
  {id:'K07',stem:'research-studies-controlled',maxReserveUsd:.40,fixedArgs:['--study=K07','--run=ROOT_GO_K07'],stopFile:'.local/STOP_RESEARCH_K07_CANDIDATE',discovery:{root:'reports/ablations',prefix:'repair-gated-'}},
  {id:'K14',stem:'research-studies-controlled',maxReserveUsd:.60,fixedArgs:['--study=K14','--run=ROOT_GO_K14'],stopFile:'.local/STOP_RESEARCH_K14_CANDIDATE',discovery:{root:'reports/ablations',prefix:'inquiry-gated-'}},
  {id:'coupled100',stem:'combined-100-controlled',maxReserveUsd:.30,fixedArgs:['--run=ROOT_GO_100'],stopFile:'.local/STOP_COUPLED_100_CURRENT',discovery:{root:'reports/combined',prefix:'coupled-100-current-'}},
  {id:'physical_chain',stem:'physical-scenario-evidence',maxReserveUsd:0,fixedArgs:['--run=ROOT_GO_PHYSICAL_CHAIN'],stopFile:'.local/STOP_PHYSICAL_CHAIN_CURRENT',discovery:{root:'reports/physical-chain',prefix:'native-current-'}},
  {id:'S19',stem:'current-service-recovery',maxReserveUsd:.60,folder:true,fixedArgs:['--study=S19','--run=ROOT_GO_S19_CURRENT'],stopFile:'.local/STOP_CURRENT_SERVICE_RECOVERY'},
  {id:'K22',stem:'current-service-recovery',maxReserveUsd:.35,folder:true,fixedArgs:['--study=K22','--run=ROOT_GO_K22_CURRENT'],stopFile:'.local/STOP_CURRENT_SERVICE_RECOVERY'},
].map(({stem,...e})=>({...e,entry:'.local/'+stem+'-v2.mjs',entrySha256:paths.find(p=>p.path===resolve('.local',stem+'-v2.mjs')).sha256}));
const dependencyPaths=['.local/read-human-capacity-evidence.mjs','scripts/semantic-load.mjs'];
const dependencies=await Promise.all(dependencyPaths.map(async path=>{const bytes=await readFile(path);return {path:resolve(path),sha256:sha(bytes),bytes:bytes.length};}));
const manifest={schema:'current-evidence-runners-identity-v4-rebind-v2',state:'prepared_not_launched_gate_pending',source:SOURCE,
  worldsStarted:0,modelCalls:0,lock:'.local/PAID_RESEARCH_STUDY.lock',entries,files:paths,dependencies,
  freeze:{path:null,sha256:null,counts:null,status:'pending_new_successful_full_UI'},
  amendment:['Ignored runner paths and their archives only','Authorized v4 base evaluator and unchanged candidate/source','S19/K22 archivist uses explicitly supplied freeze path','All children require successful unchanged source-bound full/UI; coordinator binds exact fresh full counts and human evaluator'],
  unchanged:['all seeds/scenarios/configuration/physics/permissions/staffing','provider caps and reservation exposure','GO tokens and stopping markers','native units/censoring/unknown fees/failure retention','no re-use or statistical pooling of predecessor outcomes'],
  launch:'Only root-controlled finish-v2 with exact source4hash, fresh full/UI/T27 proofs and named study GO. Add --freeze=<archived approved proof>. Manifest preparation is not launch authorization.'};
await mkdir('.local/evidence-runners-v2',{recursive:true});
const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
await writeFile('.local/evidence-runners-v2/manifest.json',bytes,{flag:'wx'});
await writeFile('.local/evidence-runners-v2/README.md',`Prepared only. No worlds or provider calls.\n\nManifest SHA256: ${sha(bytes)}\n\nChildren preserve original study arguments and output discovery paths. Core/production tests and old runner files remain unchanged. Root's finish-v2 binds the exact new full/UI counts plus human evaluator hash; these copies pin the candidate/base/source hashes and successful full/UI proof.\n\nS19/K22 seal command: node .local/current-service-recovery-v2.mjs --seal --freeze=<fresh approved archive>\n\nEvery launch must use the same explicit fresh proof; no default predecessor proof substitution. Preserve all raw failures, censoring and unknown charge exposure.\n`,{flag:'wx'});
console.log(JSON.stringify({state:manifest.state,manifest:resolve('.local/evidence-runners-v2/manifest.json'),manifestSha256:sha(bytes),copies:paths.length,worldsStarted:0,modelCalls:0}));
