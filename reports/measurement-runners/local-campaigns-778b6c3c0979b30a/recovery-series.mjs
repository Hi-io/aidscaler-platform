import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {runSourceRecovery} from '../scripts/source-recovery.mjs';
import {buildFingerprint,evaluatorFingerprint} from '../evaluation/harness.mjs';
import {checkFinalBuilds,requireLoadedSimulatorBuild} from '../evaluation/simulator-build.mjs';
import {verificationPassed} from '../scripts/verification-gates.mjs';

if(!process.argv.includes('--go'))throw Error('Preparing this helper does not permit calls. Explicit --go required.');
const fp={candidateFingerprint:await buildFingerprint(),evaluatorFingerprint:await evaluatorFingerprint(),simulatorFingerprint:await requireLoadedSimulatorBuild()};
const gate=JSON.parse(await readFile('reports/verification-latest.json','utf8'));
if(!verificationPassed(gate)||Object.entries(fp).some(([k,x])=>gate[k]!==x))throw Error('Complete stable gate required');
let stopRequested=false; process.on('SIGINT',()=>stopRequested=true); process.on('SIGTERM',()=>stopRequested=true);
const stopFile='.local/STOP_RECOVERY_SERIES';if(existsSync(stopFile))throw Error('Stop marker exists');
const folder='reports/source-recovery/series-'+Date.now();await mkdir(folder,{recursive:true});
const profiles=[
 {name:'nominal-parser',mode:'parser',seed:'source-recovery-01',count:24,noise:96,grid:9,sourceCutoffMs:300000,maxModelCalls:32,budgetUsd:.15},
 {name:'nominal-real',mode:'real',seed:'source-recovery-01',count:24,noise:96,grid:9,sourceCutoffMs:300000,maxModelCalls:32,budgetUsd:.15},
 {name:'burst-parser',mode:'parser',seed:'source-recovery-burst-01',count:48,noise:384,grid:11,sourceCutoffMs:600000,maxModelCalls:64,budgetUsd:.2},
 {name:'burst-real',mode:'real',seed:'source-recovery-burst-01',count:48,noise:384,grid:11,sourceCutoffMs:600000,maxModelCalls:64,budgetUsd:.2},
].map(p=>({...p,horizonMs:10800000,wallLimitMs:600000,clarificationWorkers:2,reviewMs:30000,maxSourceAttempts:2,retryCooldownMs:60000}));
const index={at:new Date().toISOString(),fingerprints:fp,profiles,runs:[],stopFile,scope:'Predeclared received-version recovery with real finite owner and clarification queues, active model, four durable tenants and physical service. Parser is an explicitly separate zero-paid structural control. This is not a comparative response benefit or independent semantic-accuracy test.',rules:['Every failure and censored source remains visible.','No source/controller edits while this series runs.','No provider retry selected by favorable outcome.','Neither controller completion nor source denominator uses simulator gold.','Measured model wall/known and unknown costs retained.','No imputation of subsequent sources into the sealed cohort.']};
await writeFile(folder+'/protocol.json',JSON.stringify(index,null,2));
console.log(JSON.stringify({phase:'declared',folder,profiles:profiles.map(p=>p.name)}));
for(const profile of profiles){
 const check=await checkFinalBuilds({candidate:fp.candidateFingerprint,evaluator:fp.evaluatorFingerprint,simulator:fp.simulatorFingerprint},{candidate:buildFingerprint,evaluator:evaluatorFingerprint});
 if(check.invalidStatus||stopRequested||existsSync(stopFile)){index.stoppedReason=check.invalidStatus??'operator_stop';break;}
 console.log(JSON.stringify({phase:'started',profile:profile.name}));
 const r=await runSourceRecovery({...profile,shouldStop:()=>stopRequested||existsSync(stopFile)});
 index.runs.push({name:profile.name,reportFile:r.reportFile,status:r.status,results:r.results,recoveryCensored:r.recoveryCensored,actualWallMs:r.actualWallMs,paidCalls:r.paidCalls,paidCostUsd:r.paidCostUsd,unknownCostReserveUsd:r.unknownCostReserveUsd,errors:r.errors,invariants:r.invariants,maxPendingSourceReviews:r.maxPendingSourceReviews});
 await writeFile(folder+'/index.json',JSON.stringify(index,null,2));
 console.log(JSON.stringify({phase:'closed',profile:profile.name,status:r.status,results:r.results,paidCalls:r.paidCalls,costUsd:r.paidCostUsd,unknownReserve:r.unknownCostReserveUsd,errors:r.errors.length,invariants:r.invariants.length,maxPendingSourceReviews:r.maxPendingSourceReviews}));
 if(r.finalBuilds?.invalidStatus){index.stoppedReason=r.finalBuilds.invalidStatus;break;}
}
await writeFile(folder+'/index.json',JSON.stringify(index,null,2));
console.log(JSON.stringify({phase:'series_closed',folder,executed:index.runs.length,planned:profiles.length}));
if(index.runs.length!==profiles.length||index.runs.some(r=>r.status!=='recovered'||r.errors.length||r.invariants.length))process.exitCode=1;
