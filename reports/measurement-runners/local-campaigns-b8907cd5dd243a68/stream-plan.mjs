import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { runDiscoveryEpisode, summarizeDiscovery, DISCOVERY_PROTOCOL } from '../evaluation/discovery-benchmark.mjs';
import { buildFingerprint, evaluatorFingerprint } from '../evaluation/harness.mjs';
import { checkFinalBuilds, requireLoadedSimulatorBuild } from '../evaluation/simulator-build.mjs';
import { verificationPassed } from '../scripts/verification-gates.mjs';
import { createHash } from 'node:crypto';

const [phase, planFile, section, indexFile] = process.argv.slice(2);
if (!['free','paid'].includes(phase) || !planFile || !['primary','controls'].includes(section)) throw Error('Use free|paid PLAN primary|controls [exact index]');
const plan=JSON.parse(await readFile(planFile,'utf8'));
const planBytes=await readFile(planFile), helperBytes=await readFile(new URL(import.meta.url));
const planSha256=createHash('sha256').update(planBytes).digest('hex'),
 helperSha256=createHash('sha256').update(helperBytes).digest('hex');
const fp={candidateFingerprint:await buildFingerprint(),evaluatorFingerprint:await evaluatorFingerprint(),simulatorFingerprint:await requireLoadedSimulatorBuild()};
const v=JSON.parse(await readFile('reports/verification-latest.json','utf8'));
if(!verificationPassed(v)||Object.entries(fp).some(([k,x])=>plan[k]!==x||v[k]!==x))throw Error('Plan and complete stable gate must match all source hashes');
let file,index,stopped=false,invalid=false,next=0;
let persistence=Promise.resolve();
function checkpoint(){
 const bytes=JSON.stringify(index,null,2);
 persistence=persistence.then(()=>writeFile(file,bytes));
 return persistence;
}
process.on('SIGINT',()=>stopped=true);process.on('SIGTERM',()=>stopped=true);
if(phase==='free'){
 if(indexFile)throw Error('Free phase creates a new preserved index');
 const base='reports/comparisons/'+Date.now()+'-'+section;await mkdir(base,{recursive:true});file=base+'/index.json';
 index={at:new Date().toISOString(),planFile,section,planSha256,helperSha256,fingerprints:fp,stopFile:'.local/STOP_MEASUREMENT',profiles:[],runs:[],orchestration:'Two zero-inference worlds in parallel, then one paid world at a time. Same physical resources, modeled delays, seeds and scoped authority in every arm. Every declared outcome including failures retained.'};
 const specs=section==='primary'?[{...plan.primary,name:'primary'}]:plan.controls.map(c=>({...plan.primary,...c}));
 for(const p of specs){
  const folder=base+'/'+p.name;await mkdir(folder,{recursive:true});
  const config={count:p.needs,noise:p.noise,reposts:p.reposts,humanReadMs:p.humanReadMs,humanWorkers:p.humanWorkers,clarificationWorkers:p.clarificationWorkers,formalDelayMs:p.formalDelayMs,horizonMs:p.horizonMs,maxModelCalls:p.maxModelCalls,budgetUsd:p.episodeBudgetUsd,silentFraction:p.silentFraction??0,packetLoss:p.packetLoss??0,traffic:p.traffic??0,extentKm:p.extentKm??6,grid:p.grid??9,candidateFingerprint:fp.candidateFingerprint,evaluatorBuild:fp.evaluatorFingerprint};
  index.profiles.push({name:p.name,folder,p,config});
  await writeFile(folder+'/protocol.json',JSON.stringify({at:index.at,...DISCOVERY_PROTOCOL,planFile,section,name:p.name,seeds:p.seeds,seedPrefix:p.seedPrefix,arms:p.arms,config,simulatorBuild:fp.simulatorFingerprint,totalBudgetUsd:p.campaignBudgetUsd,orchestration:index.orchestration,stop:'All declared worlds retained. Existing physical-cohort completion is distinct from K22 source-recovery.'},null,2));
 }
 await writeFile(file,JSON.stringify(index,null,2));console.log(JSON.stringify({phase:'declared',file,profiles:index.profiles.map(p=>({name:p.name,seeds:p.p.seeds,arms:p.p.arms}))}));
}else{
 if(!indexFile)throw Error('Paid phase requires exact closed free index');file=indexFile;index=JSON.parse(await readFile(file,'utf8'));
 if(index.planFile!==planFile||index.section!==section||index.planSha256!==planSha256||index.helperSha256!==helperSha256||Object.entries(fp).some(([k,x])=>index.fingerprints[k]!==x))throw Error('Index mismatch');
 if(!index.phases?.some(p=>p.phase==='free'&&!p.invalid&&!p.stopped))throw Error('Free phase must close before paid phase');
 const freeOutcomes=await Promise.all(index.runs.filter(r=>r.file).map(r=>readFile(r.file,'utf8').then(JSON.parse)));
 if(freeOutcomes.some(r=>r.status!=='completed'||r.errors?.length||r.invariants?.length||r.candidateChanged||r.evaluatorChanged||r.simulatorChanged))throw Error('Paid admission requires complete stable zero-inference physical controls; failures remain retained for diagnosis');
}
if(existsSync(index.stopFile))throw Error('Stop marker exists');
const tasks=[];
for(const profile of index.profiles)for(let i=1;i<=profile.p.seeds;i++)for(const arm of profile.p.arms.filter(a=>phase==='paid'?['B6','B9'].includes(a):!['B6','B9'].includes(a))){
 const seed=profile.p.seedPrefix+'-'+String(i).padStart(2,'0'),reportFile=profile.folder+'/'+seed+'-'+arm+'.json';
 if(existsSync(reportFile))throw Error('Never overwrite an already attempted world: '+reportFile);
 tasks.push({profile,arm,seed,reportFile});
}
async function worker(){
 while(next<tasks.length&&!stopped&&!invalid&&!existsSync(index.stopFile)){
  const t=tasks[next++],p=t.profile;
  const gate=await checkFinalBuilds({candidate:fp.candidateFingerprint,evaluator:fp.evaluatorFingerprint,simulator:fp.simulatorFingerprint},{candidate:buildFingerprint,evaluator:evaluatorFingerprint});
  if(gate.invalidStatus){invalid=true;break;}
  const charged=index.runs.filter(r=>r.folder===p.folder).reduce((s,r)=>s+(r.chargedBudgetUsd??p.p.episodeBudgetUsd),0);
  if(phase==='paid'&&charged+p.p.episodeBudgetUsd>p.p.campaignBudgetUsd+1e-10){index.runs.push({folder:p.folder,seed:t.seed,arm:t.arm,status:'not_launched_budget_cap',chargedBudgetUsd:0});continue;}
  console.log(JSON.stringify({phase:'started',file,name:p.name,arm:t.arm,seed:t.seed}));
  let r;
  try{r=await runDiscoveryEpisode({...p.config,arm:t.arm,seed:t.seed,shouldStop:()=>stopped||existsSync(index.stopFile),...(phase==='free'?{provider:{complete:async()=>{throw Object.assign(Error('Inference forbidden in free phase'),{code:'FREE_MODEL_REQUEST'});}}}:{})});}
  catch(e){index.runs.push({folder:p.folder,seed:t.seed,arm:t.arm,status:'missing_after_exception',error:e.code??e.name,chargedBudgetUsd:phase==='paid'?p.p.episodeBudgetUsd:0,providerCalls:null,providerCostUsd:null});await checkpoint();stopped=true;break;}
  await writeFile(t.reportFile,JSON.stringify(r,null,2));
  index.runs.push({folder:p.folder,file:t.reportFile,seed:t.seed,arm:t.arm,status:r.status,chargedBudgetUsd:r.chargedBudgetUsd});
  if(r.candidateChanged||r.evaluatorChanged||r.simulatorChanged)invalid=true;
  await checkpoint();
  console.log(JSON.stringify({phase:'completed',name:p.name,arm:t.arm,seed:t.seed,status:r.status,served:r.timeToSufficientService.completed+'/'+r.outcomes.length,rmstMinutes:r.timeToSufficientService.restrictedMeanMs/60000,calls:r.usage.length,chargedUsd:r.chargedBudgetUsd,errors:r.errors.map(e=>e.code),invariants:r.invariants.length}));
  if(phase==='free'&&(r.usage.length||r.chargedBudgetUsd))throw Error('Free guard failed');
 }
}
await Promise.all(Array.from({length:phase==='free'?2:1},worker));
index.phases??=[];index.phases.push({phase,at:new Date().toISOString(),stopped,invalid});
for(const p of index.profiles){
 const rows=await Promise.all(index.runs.filter(r=>r.folder===p.folder&&r.file).map(r=>readFile(r.file,'utf8').then(JSON.parse)));
 const summary={...summarizeDiscovery(rows),declaredRuns:p.p.seeds*p.p.arms.length,missingRuns:p.p.seeds*p.p.arms.length-rows.length,stoppedReason:invalid?'source_changed':stopped?'interrupted':phase==='free'?'awaiting_paid_phase':null};
 await writeFile(p.folder+'/summary.json',JSON.stringify(summary,null,2));
}
await writeFile(file,JSON.stringify(index,null,2));console.log(JSON.stringify({phase:'closed',file,executed:index.runs.length,stopped,invalid}));if(stopped||invalid)process.exitCode=1;
