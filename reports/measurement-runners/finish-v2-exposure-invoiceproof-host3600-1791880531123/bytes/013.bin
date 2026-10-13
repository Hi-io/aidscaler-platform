/** Ignored, archivable orchestration only. Runs no worlds without root GO,
 * a closed twelve-world primary, exact new freeze and the universal lock. */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {buildFingerprint,evaluatorFingerprint} from '../evaluation/harness.mjs';
import {requireLoadedSimulatorBuild} from '../evaluation/simulator-build.mjs';
import {humanCapacityEvaluatorFingerprint} from '../evaluation/human-capacity-benchmark.mjs';
import {validateHumanCampaignGate} from '../scripts/human-capacity-campaign.mjs';
import {prepareBridge,validateV4Gate,gateCounts,readHistoricalPrimary,readHistoricalControls,bridgeGroups,validateVersionedCoverage,verifyCurrentHumanRaws,validateHostBridgePlan} from './version-bridge-host3600-v2.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const json=async p=>{const bytes=await readFile(p);return {path:resolve(p),bytes,data:JSON.parse(bytes.toString('utf8')),sha256:sha(bytes)};};
const names=['decentralized','stress48','stress96'];
const key=w=>[w.condition??w.profile,w.seed,w.arm].join(':');
const sameSource=(a,b)=>a?.candidate===b.candidate&&a?.baseEvaluator===b.baseEvaluator&&
  (a?.humanEvaluator??a?.evaluator)===b.humanEvaluator&&a?.simulator===b.simulator;
async function currentSource(){return {candidate:await buildFingerprint(),baseEvaluator:await evaluatorFingerprint(),
  humanEvaluator:await humanCapacityEvaluatorFingerprint(),simulator:await requireLoadedSimulatorBuild()};}

export function classifyClosedGroup(plan,summary,rows,processResult){
  const expected=new Set(plan.worlds.map(key)),actual=new Set(rows.map(r=>key(r.data)));
  const complete=summary?.declaredRuns===expected.size&&summary?.observedRuns===expected.size&&
    (summary.missingRuns?.length??1)===0&&actual.size===expected.size&&rows.length===expected.size&&
    [...expected].every(k=>actual.has(k));
  const errors=rows.flatMap(r=>(r.data.errors??[]).map(e=>({...e,world:key(r.data)})));
  const allCompleted=complete&&rows.every(r=>r.data.status==='completed'&&r.data.invariants?.length===0&&
    r.data.candidateChanged===false&&r.data.evaluatorChanged===false&&r.data.simulatorChanged===false);
  const presentReferences=new Set(plan.worlds.filter(w=>w.arm!=='B6').map(w=>w.arm));
  const plannedComparisons=(summary?.comparisons??[]).filter(c=>presentReferences.has(c.reference));
  const comparisonsIntact=plannedComparisons.length===presentReferences.size*plan.worlds.filter(w=>w.arm==='B6').length&&
    plannedComparisons.every(c=>c.comparable===true);
  const missingUnplanned=(summary?.comparisons??[]).filter(c=>!presentReferences.has(c.reference));
  const logsIntact=!processResult?.loggingErrors?.length;
  const expectedSubsetExit=processResult?.exitCode===1&&allCompleted&&comparisonsIntact&&
    logsIntact&&missingUnplanned.length>0&&missingUnplanned.every(c=>c.reason==='missing_pair');
  return {complete,allCompleted,comparisonsIntact,recoveredErrorCount:errors.length,errors,
    process:processResult,expectedMissingUnplannedReferences:missingUnplanned,
    classification:expectedSubsetExit?'closed_declared_subset_missing_unplanned_references':
      processResult?.exitCode===0&&allCompleted&&comparisonsIntact&&logsIntact?'closed_declared_group':'failed_or_incomplete_group',
    permitsNext:allCompleted&&comparisonsIntact&&logsIntact&&(processResult?.exitCode===0||expectedSubsetExit),
    note:'Negative gains, physical deficits and recovered operational errors remain in every completed pair. Unplanned baseline pairs stay explicitly missing; the primary retains all strong baselines.'};
}

export function budgetReadout(summary,rows,cap){
  const paid=rows.filter(r=>r.data.arm==='B6'),missing=paid.length===0;
  const nonnegative=x=>finite(x)&&x>=0;
  const known=paid.filter(r=>nonnegative(r.data.costUsd)),unknown=missing||paid.some(r=>!nonnegative(r.data.costUsd));
  const rowCharge=missing?cap:paid.reduce((s,r)=>s+(
    r.data.usageMissing===true||(!Array.isArray(r.data.usage)&&!nonnegative(r.data.costUsd))?cap:
      nonnegative(r.data.chargedBudgetUsd)?r.data.chargedBudgetUsd:cap),0);
  // A summary written before the paid world starts may report zero. Missing
  // paid final usage still retains the full reserved cap, independently.
  const charged=Math.max(rowCharge,nonnegative(summary?.chargedBudgetUsd)?summary.chargedBudgetUsd:0);
  return {costUsd:unknown?null:known.reduce((s,r)=>s+r.data.costUsd,0),
    knownCostUsd:!paid.length||paid.some(r=>!nonnegative(r.data.knownCostUsd))?null:paid.reduce((s,r)=>s+r.data.knownCostUsd,0),
    modelCalls:missing||paid.some(r=>!Number.isSafeInteger(r.data.modelCalls)||r.data.modelCalls<0)?null:paid.reduce((s,r)=>s+r.data.modelCalls,0),
    chargedBudgetUsd:charged,usageUnknown:unknown,
    providerWallMs:missing||paid.some(r=>!Array.isArray(r.data.usage)||r.data.usage.some(u=>!nonnegative(u.wall_ms)))?null:
      paid.reduce((s,r)=>s+r.data.usage.reduce((n,u)=>n+u.wall_ms,0),0),
    note:'Unknown fees/calls/wall remain null; missing paid ledger retains its full cap. Known cost is a lower bound, not a replacement for unknown total cost.'};
}

async function readWorlds(folder,worlds){
  const rows=[];for(const w of worlds){const filename=`${w.condition??w.profile}-${w.seed}-${w.arm}.json`;
    try{rows.push(await json(resolve(folder,filename)));}catch(e){if(e.code!=='ENOENT')throw e;}}
  return rows;
}

async function child(args,stdoutPath,stderrPath){
  const out=createWriteStream(stdoutPath,{flags:'wx'}),err=createWriteStream(stderrPath,{flags:'wx'});
  const loggingErrors=[];
  const settle=stream=>new Promise(done=>{let closed=false;const finish=()=>{if(!closed){closed=true;done();}};
    stream.once('finish',finish);stream.once('close',finish);stream.once('error',e=>{
      loggingErrors.push({code:e.code??e.name,message:String(e.message).slice(0,250)});finish();});});
  const loggingDone=Promise.all([settle(out),settle(err)]);
  const childProcess=spawn(globalThis.process.execPath,args,{cwd:globalThis.process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});
  childProcess.stdout.pipe(out);childProcess.stderr.pipe(err);
  const result=await new Promise(resolveDone=>{childProcess.once('error',e=>resolveDone({exitCode:null,signal:null,error:{code:e.code,message:e.message}}));
    childProcess.once('close',(exitCode,signal)=>resolveDone({exitCode,signal}));});
  await loggingDone;
  return loggingErrors.length?{...result,loggingErrors}:result;
}

export async function coordinateBridgeControls(options={}){
  if(options.prepare||options.template)return prepareBridge(options);
  if(options.run!=='ROOT_GO_COMPACT_BRIDGE_HOST3600_V2')return {state:'PREPARED_NOT_LAUNCHED',groups:names,declaredWorlds:9,maximumReservedUsd:.45,
    blockedGroup:'error_1pct pending native-review-lapse lifecycle audit',worldsStarted:0,modelCalls:0,
    prerequisites:['explicit plan','closed twelve-world primary','exact fresh full/UI freeze','root GO','universal .local/PAID_RESEARCH_STUDY.lock']};
  for(const name of ['plan','plan-sha'])if(!options[name])throw Error('Explicit --'+name+' required');
  const source=await currentSource(),plan=await json(resolve(options.plan));
  if(plan.sha256!==options['plan-sha']||plan.data.schema!=='native-human-compact-control-bridge-host3600-before-new-outcomes')throw Error('Exact v2 plan SHA/schema required');
  await validateHostBridgePlan(plan.data);
  const freeze=await json(plan.data.freeze.path),t27=await json(plan.data.t27.path);
  if(freeze.sha256!==plan.data.freeze.sha256||t27.sha256!==plan.data.t27.sha256)throw Error('Fresh proof bytes changed');
  validateV4Gate(freeze.data,source);
  if(JSON.stringify(gateCounts(freeze.data))!==JSON.stringify(plan.data.freeze.counts)||t27.data.valid!==true||t27.data.passed!==true||t27.data.sourceUnchanged!==true||[t27.data.initialFingerprints,t27.data.finalFingerprints].some(f=>f?.candidate!==source.candidate||f?.evaluator!==source.baseEvaluator||f?.simulator!==source.simulator))throw Error('Exact fresh full/UI/T27 required');
  for(const f of plan.data.files)if(sha(await readFile(f.path))!==f.sha256)throw Error('Prepared bridge runner bytes changed');
  if(!sameSource(plan.data.source,source))throw Error('V2 preregistration source changed');
  validateHumanCampaignGate(freeze.data,{candidate:source.candidate,baseEvaluator:source.baseEvaluator,simulator:source.simulator});
  const groups=names.map(id=>plan.data.groups.find(g=>g.id===id));
  if(groups.some(g=>!g||g.state!=='PREDECLARED_NOT_LAUNCHED'||g.plan.episodeBudgetUsd!==.15||g.paidEpisodes!==1))
    throw Error('Exact three v2 bridge groups required');
  const primary=await readHistoricalPrimary(),historicalControls=await readHistoricalControls(),expectedGroups=await bridgeGroups();
  if(JSON.stringify(groups)!==JSON.stringify(expectedGroups)||JSON.stringify(primary)!==JSON.stringify(plan.data.primary)||JSON.stringify(historicalControls)!==JSON.stringify(plan.data.historicalControls))throw Error('Exact native original groups and predecessor bytes required');
  const lock=resolve('.local/PAID_RESEARCH_STUDY.lock');
  const stopFile=resolve(options['stop-file']??'.local/STOP_COMPACT_BRIDGE_HOST3600_V2');
  const folder=resolve(options.folder??'reports/human-capacity-controls-bridge/'+Date.now());await mkdir(folder,{recursive:true});
  const coordinatorBytes=await readFile(new URL(import.meta.url)),runnerBytes=await readFile('scripts/human-capacity-campaign.mjs'),
    benchmarkBytes=await readFile('evaluation/human-capacity-benchmark.mjs');
  const declared={schema:'compact-human-controls-coordinator-version-bridge-host3600-v2',declaredAt:new Date().toISOString(),source,groups,
    primary,historicalControls,hostAmendment:plan.data.hostAmendment,retainedStoppedHost900:plan.data.stoppedAntecedent,coverageType:'EXPLICIT_VERSIONED_COVERAGE',statisticalPoolingAllowed:false,all17SingleVersionClosed:false,
    freeze:{path:freeze.path,sha256:freeze.sha256},plan:{path:plan.path,sha256:plan.sha256},
    universalLock:lock,stopFile,paidConcurrency:1,worldConcurrency:1,worlds:groups.reduce((n,g)=>n+g.plan.worlds.length,0),
    maximumReservedBudgetUsd:.45,episodeCapUsd:.15,
    blocked:[{group:'error_1pct',status:'BLOCKED_NOT_LAUNCHED',reason:'Native owner-review lapse lifecycle must be reviewed before this sensitivity; no source changes during active studies.'}],
    coordinatorSha256:sha(coordinatorBytes),runnerSha256:sha(runnerBytes),benchmarkSha256:sha(benchmarkBytes),
    scope:'Root-approved staged secondary controls. No world/UI/source benchmark overlaps paid HTTP/model clocks. Preserve all losses, deficits, censored and recovered-error outcomes; no comparison to unplanned baselines or empirically calibrated human rates.',
    assumptions:'A native relay transports one received snapshot per task; manual flow does not batch many need handoffs into one call. C_decentralized broadcasts all relevant milestones and is a secondary upper-broadcast profile, not universal conventional practice. Zero/5-second-reading/8-readers controls bound rate assumptions.'};
  for(const [name,bytes]of[['protocol.json',JSON.stringify(declared,null,2)+'\n'],['coordinator.mjs',coordinatorBytes],
    ['human-capacity-campaign.mjs',runnerBytes],['human-capacity-benchmark.mjs',benchmarkBytes]])
    await writeFile(resolve(folder,name),bytes,{flag:'wx'});
  const records=[];let stoppedReason=null,chargedBudgetUsd=0,interrupted=false;
  const coverage=()=>records.length===3&&!stoppedReason&&records.every(r=>r.closure?.permitsNext)?validateVersionedCoverage(historicalControls,{source,records,stoppedReason},source):null;
  const index=async()=>writeFile(resolve(folder,'index.json'),JSON.stringify({recordedAt:new Date().toISOString(),source,
    protocol:resolve(folder,'protocol.json'),records,chargedBudgetUsd,stoppedReason,
    unsettledReservedUsd:records.filter(r=>r.status==='starting').reduce((s,r)=>s+r.reservedCapUsd,0),
    conservativeCommittedUsd:chargedBudgetUsd+records.filter(r=>r.status==='starting').reduce((s,r)=>s+r.reservedCapUsd,0),
    declaredRuns:9,observedRuns:records.reduce((n,r)=>n+(r.worlds?.length??0),0),historicalControls,primary,coverage:coverage(),
    oldFeesCountedExactlyOnce:true,newFees:chargedBudgetUsd,statisticalPoolingAllowed:false,all17SingleVersionClosed:false,
    missingGroups:groups.filter(g=>!records.some(r=>r.id===g.id)).map(g=>g.id),blocked:declared.blocked},null,2)+'\n');
  await index();
  const onSignal=()=>{interrupted=true;console.log(JSON.stringify({phase:'stopping_after_settled_child_provider'}));
    writeFile(stopFile,JSON.stringify({requestedAt:new Date().toISOString(),scope:'compact-human-controls'}),{flag:'a'})
      .catch(e=>console.error(JSON.stringify({phase:'stop_file_failure',code:e.code,message:e.message})));};
  process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  try {
  for(const group of groups){
    if(interrupted){stoppedReason='operator_stop';break;}
    try{await access(stopFile);stoppedReason='operator_stop';break;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!sameSource(await currentSource(),source)){stoppedReason='source_changed';break;}
    try{await access(lock);stoppedReason='universal_research_lock_busy';break;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(chargedBudgetUsd+.15>.45+1e-12){stoppedReason='conservative_budget';break;}
    const destination=resolve(folder,group.id),options={...group.options,freeze:freeze.path,lock,
      folder:destination,'stop-file':stopFile,run:'ROOT_GO_HUMAN_CAPACITY'};
    const args=['scripts/human-capacity-campaign.mjs',...Object.entries(options).map(([k,v])=>`--${k}=${v}`)];
    const record={id:group.id,status:'starting',reservedCapUsd:.15,destination,args,startedAt:new Date().toISOString()};records.push(record);await index();
    console.log(JSON.stringify({phase:'compact-group-started',id:group.id,destination}));
    const processResult=await child(args,resolve(folder,group.id+'.stdout.txt'),resolve(folder,group.id+'.stderr.txt'));
    let summary=null,rows=[];
    try{summary=await json(resolve(destination,'summary.json'));rows=await readWorlds(destination,group.plan.worlds);}
    catch(e){record.reportError={code:e.code??e.name,message:String(e.message).slice(0,250)};}
    const closure=classifyClosedGroup(group.plan,summary?.data,rows,processResult),budget=budgetReadout(summary?.data,rows,.15);
    try{verifyCurrentHumanRaws(rows,source);}catch{closure.permitsNext=false;closure.classification='current_source_or_raw_invalid';}
    if(!sameSource(await currentSource(),source)||(await Promise.all(plan.data.files.map(async f=>sha(await readFile(f.path))===f.sha256))).some(ok=>!ok)){closure.permitsNext=false;closure.classification='changed_source_or_runner';}
    Object.assign(record,{status:closure.classification,finishedAt:new Date().toISOString(),closure,budget,
      summary:summary?{path:summary.path,sha256:summary.sha256}:null,
      worlds:rows.map(r=>({path:r.path,sha256:r.sha256,status:r.data.status,errors:r.data.errors,
        sufficient:r.data.timeToSufficientService,firstUseful:r.data.timeToFirstUsefulService,
        costUsd:r.data.costUsd,modelCalls:r.data.modelCalls,unknownCostRows:r.data.unknownCostRows,
        chargedBudgetUsd:r.data.chargedBudgetUsd,sourceChanged:!!(r.data.candidateChanged||r.data.evaluatorChanged||r.data.simulatorChanged)}))});
    chargedBudgetUsd+=budget.chargedBudgetUsd;await index();
    console.log(JSON.stringify({phase:'compact-group-closed',id:group.id,closure:closure.classification,budget}));
    if(!closure.permitsNext){stoppedReason='failed_or_incomplete_group';break;}
  }
  await index();return {folder,groups:records.length,chargedBudgetUsd,stoppedReason,blocked:declared.blocked,
    note:'Raw outcomes retained. No actual/human/clinical/GenAI advantage inferred by this coordinator.'};
  } finally {process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=Object.fromEntries(process.argv.slice(2).map(s=>{const at=s.indexOf('=');return at<0?[s.replace(/^--/,''),true]:[s.slice(2,at),s.slice(at+1)];}));
  const result=await coordinateBridgeControls(options);console.log(JSON.stringify(result,null,2));
  if(result.stoppedReason)process.exitCode=1;
}
