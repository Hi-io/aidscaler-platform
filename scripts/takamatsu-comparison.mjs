import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFingerprint, evaluatorFingerprint } from '../evaluation/harness.mjs';
import { requireLoadedSimulatorBuild } from '../evaluation/simulator-build.mjs';
import { runHumanCapacityEpisode, humanCapacityEvaluatorFingerprint, summarizeHumanCapacity } from '../evaluation/human-capacity-benchmark.mjs';
import { withHumanResearchLock, failedHumanCapacityWorld } from './human-capacity-campaign.mjs';
import { responseStages } from '../evaluation/response-stages.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
export function takamatsuStudyPlan({preflight=false,seeds=3,seedStart=1,backend='pglite-memory'}={}) {
  if(!Number.isSafeInteger(seeds)||seeds<1||seeds>3||!Number.isSafeInteger(seedStart)||seedStart<1||seedStart+seeds>4)
    throw Error('Use a declared subset of the original three seeds.');
  if(!['pglite-memory','postgres-native-local'].includes(backend))throw Error('Use a declared local storage backend.');
  const config={topology:'takamatsu',grid:66,extentKm:10,count:preflight?2:24,noise:preflight?8:192,
    reposts:2,formalDelayMs:1800000,horizonMs:10800000,pumpMs:60000,clarificationWorkers:2,
    maxModelCalls:16,budgetUsd:.15,wallLimitMs:3600000,
    humanCapacityOverrides:{readers:2,deciders:2,relayers:1,readErrorBp:0,decisionErrorBp:0,relayErrorBp:0}};
  const worlds=[];
  for(let n=seedStart;n<seedStart+(preflight?1:seeds);n++)for(const arm of preflight?['C_manual']:['C_manual','B6'])
    worlds.push({arm,profile:'moderate',condition:'moderate',seed:`native-human-capacity-primary-${String(n).padStart(2,'0')}`});
  return {schema:'takamatsu-two-methods-v1',preflight,seeds:preflight?1:seeds,seedStart,backend,config,worlds,maximumPaidExposureUsd:preflight?0:Number((seeds*.15).toFixed(2)),
    hostPreflight:preflight?{method:'Stop at the first reported turn >=21, after measuring the 20 turns following turn1. Settle already-issued physical work to the same horizon; abort is intentional and is not a response-outcome comparison.',warmControllerTurns:20}:null,
    actualModel:preflight?null:'google/gemma-4-31b-it',GeminiUsed:false,
    comparisonToHistorical:'Geographic replication, not a paired causal estimate of changing geography: original 9x9 grid/6 km becomes pinned 10x10 km Takamatsu roads. The same original seeds, 24 requests, 192 distractors, two reposts, 30-minute formal delay, three-hour horizon, four owners, original supply/fleet/human parameters and zero background traffic are retained. Geography changes building IDs, distances and seeded placement/quantities; only within-geography pairs have identical corpus/supply. Host wall-time safety limit is extended identically to one hour for both methods to permit city-scale CPU/SQL work; it does not advance simulated time.'};
}
const current=async()=>({candidate:await buildFingerprint(),baseEvaluator:await evaluatorFingerprint(),evaluator:await humanCapacityEvaluatorFingerprint(),simulator:await requireLoadedSimulatorBuild()});
const stable=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]);
const reduction=(a,b)=>Number.isFinite(a)&&a>0&&Number.isFinite(b)?1-b/a:null;
const scaled=(value,divisor)=>Number.isFinite(value)?value/divisor:null;
export function studyReadout(rows, plan, source) {
  const summary=summarizeHumanCapacity(rows,plan.worlds);
  summary.comparisons=summary.comparisons.filter(c=>c.reference==='C_manual').map(c=>({...c,
    note:'Within-seed comparison of conventional response and AidScaler with measured Gemma under the declared shared inputs and assumptions; not measured real-world life savings.'}));
  const presentations=rows.map(r=>({arm:r.arm,seed:r.seed,status:r.status,
    sufficient:r.timeToSufficientService,firstUseful:r.timeToFirstUsefulService,
    stages:responseStages(r),services:r.metrics?.services,
    distanceM:r.metrics?.physical?.distanceM??null,fuelMl:r.metrics?.physical?.fuelMl??null,
    providerCalls:r.modelCalls,costUsd:r.costUsd,unknownCostRows:r.unknownCostRows,errors:r.errors,invariants:r.invariants,controllerHostProgress:r.controllerHostProgress??null}));
  const pairs=summary.comparisons.map(c=>{
    const a=presentations.find(p=>p.seed===c.seed&&p.arm==='C_manual'),b=presentations.find(p=>p.seed===c.seed&&p.arm==='B6');
    const phasesComplete=a.stages.complete&&b.stages.complete;
    return {...c,phasesComplete,coordinationReduction:phasesComplete?reduction(a.stages.means.preAuthorizationMs,b.stages.means.preAuthorizationMs):null,
      withoutShipmentTravelReduction:phasesComplete?reduction(a.stages.means.withoutShipmentTravelMs,b.stages.means.withoutShipmentTravelMs):null,
      staffWorkReduction:reduction(a.stages.attentionWorkPersonMinutes,b.stages.attentionWorkPersonMinutes)};
  });
  const aggregate=arm=>{
    const p=presentations.filter(r=>r.arm===arm),mean=fn=>p.length&&p.every(r=>Number.isFinite(fn(r)))?p.reduce((s,r)=>s+fn(r),0)/p.length:null;
    return {arm,worlds:p.length,needs:p.reduce((s,r)=>s+(r.sufficient?.eligible??0),0),reached:p.every(r=>Number.isFinite(r.sufficient?.reached))?p.reduce((s,r)=>s+r.sufficient.reached,0):null,
      censored:p.every(r=>Number.isFinite(r.sufficient?.rightCensored))?p.reduce((s,r)=>s+r.sufficient.rightCensored,0):null,sufficientMinutes:mean(r=>scaled(r.sufficient?.restrictedMeanMs,60000)),
      preAuthorizationMinutes:p.every(r=>r.stages.complete)?mean(r=>scaled(r.stages.means.preAuthorizationMs,60000)):null,
      withoutShipmentTravelMinutes:p.every(r=>r.stages.complete)?mean(r=>scaled(r.stages.means.withoutShipmentTravelMs,60000)):null,
      loadedTravelMinutes:p.every(r=>r.stages.complete)?mean(r=>scaled(r.stages.means.loadedTravelMs,60000)):null,
      pickupTravelMinutes:p.every(r=>r.stages.complete)?mean(r=>scaled(r.stages.means.pickupTravelMs,60000)):null,
      attentionWorkPersonMinutes:mean(r=>r.stages.attentionWorkPersonMinutes),distanceKm:mean(r=>scaled(r.distanceM,1000)),fuelLitres:mean(r=>scaled(r.fuelMl,1000)),
      providerCalls:p.every(r=>Number.isFinite(r.providerCalls))?p.reduce((s,r)=>s+r.providerCalls,0):null,costUsd:p.every(r=>Number.isFinite(r.costUsd))?p.reduce((s,r)=>s+r.costUsd,0):null};
  };
  const conventional=aggregate('C_manual'),aidscaler=aggregate('B6');
  return {schema:'takamatsu-two-methods-readout-v1',at:new Date().toISOString(),source,plan,summary,presentations,pairs,aggregate:{conventional,aidscaler,
    sufficientReduction:reduction(conventional.sufficientMinutes,aidscaler.sufficientMinutes),coordinationReduction:reduction(conventional.preAuthorizationMinutes,aidscaler.preAuthorizationMinutes),
    withoutShipmentTravelReduction:reduction(conventional.withoutShipmentTravelMinutes,aidscaler.withoutShipmentTravelMinutes),staffWorkReduction:reduction(conventional.attentionWorkPersonMinutes,aidscaler.attentionWorkPersonMinutes)},
    eligible:!plan.preflight&&source.stable&&rows.length===plan.worlds.length&&pairs.length===plan.seeds&&pairs.every(p=>p.comparable),
    limits:['Developer-authored paired simulations are not independent field validation or a guarantee of general performance.','Gemma is measured; Gemini is not inferred. Human pool durations are assumptions.','All censored needs remain in the primary horizon-limited mean; incomplete phase means cannot become headline metrics.','The historical result uses another build and geography and is not pooled here.']};
}

export async function runTakamatsuStudy({folder,preflight=false,seeds=3,seedStart=1,onProgress=console.log,evaluationDatabaseUrl,databaseConfig}={}) {
  if(databaseConfig&&evaluationDatabaseUrl)throw Error('Choose one private database configuration source.');
  if(databaseConfig)evaluationDatabaseUrl=JSON.parse(await readFile(resolve(databaseConfig),'utf8')).databaseUrl;
  if(databaseConfig&&!evaluationDatabaseUrl)throw Error('The private database configuration needs databaseUrl.');
  const plan=takamatsuStudyPlan({preflight,seeds,seedStart,backend:evaluationDatabaseUrl?'postgres-native-local':'pglite-memory'}),initial=await current();
  if(!preflight&&!process.env.OPENROUTER_API_KEY)throw Error('Load the authorized provider key from the private local environment.');
  if(process.env.MODEL_ID&&process.env.MODEL_ID!=='google/gemma-4-31b-it')throw Error('This study requires the declared Gemma model.');
  folder=resolve(folder??`reports/takamatsu/${Date.now()}`);
  return withHumanResearchLock(resolve('.local/PAID_RESEARCH_STUDY.lock'),{study:'takamatsu-two-methods',pid:process.pid,nonce:randomUUID()},async()=>{
    await mkdir(resolve(folder,'..'),{recursive:true});await mkdir(folder,{recursive:false});
    const runnerBytes=await readFile(new URL(import.meta.url)),readerBytes=await readFile(new URL('../evaluation/response-stages.mjs',import.meta.url));
    await writeFile(resolve(folder,'protocol.json'),JSON.stringify({...plan,source:initial,declaredAt:new Date().toISOString(),runnerSha256:sha(runnerBytes),readerSha256:sha(readerBytes)},null,2)+'\n',{flag:'wx'});
    await writeFile(resolve(folder,'runner.mjs.txt'),runnerBytes,{flag:'wx'});await writeFile(resolve(folder,'reader.mjs.txt'),readerBytes,{flag:'wx'});
    const rows=[];let stop=null,interrupted=false;const interrupt=()=>{interrupted=true;};
    process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
    try {
      for(const world of plan.worlds) {
        if(interrupted){stop='operator_stop';break;}
        if(!stable(initial,await current())){stop='source_changed';break;}
        onProgress(JSON.stringify({phase:'started',...world,folder}));
        let row,preflightBoundary=false;const start=performance.now(),hostProgress=[];
        try{row=await runHumanCapacityEpisode({...plan.config,...world,evaluationDatabaseUrl,shouldStop:()=>interrupted||preflightBoundary,onProgress:p=>{
          const progress={...p,elapsedWallMs:performance.now()-start};hostProgress.push(progress);
          onProgress(JSON.stringify({phase:'progress',...progress}));
          if(preflight&&p.turns>=21)preflightBoundary=true;
        }});}
        catch(error){row=failedHumanCapacityWorld({world,config:plan.config,source:initial,cap:world.arm==='B6'?.15:0,error,wallMs:performance.now()-start});}
        row.controllerHostProgress={records:hostProgress,initializationAndFirstTurnMs:hostProgress[0]?.elapsedWallMs??null,
          twentySubsequentTurnsMs:hostProgress.length>=2?hostProgress[1].elapsedWallMs-hostProgress[0].elapsedWallMs:null,
          plannedPreflightStopReached:preflightBoundary};
        rows.push(row);await writeFile(resolve(folder,world.seed+'-'+world.arm+'.json'),JSON.stringify(row,null,2)+'\n',{flag:'wx'});
        const final=await current(),readout=studyReadout(rows,plan,{initial,final,stable:stable(initial,final)});
        await writeFile(resolve(folder,'summary.json'),JSON.stringify(readout,null,2)+'\n');
        onProgress(JSON.stringify({phase:'settled',arm:row.arm,seed:row.seed,status:row.status,reached:row.timeToSufficientService.reached,sufficientMinutes:row.timeToSufficientService.restrictedMeanMs/60000,calls:row.modelCalls,costUsd:row.costUsd,errors:row.errors,wallMs:row.wallMs}));
        if(preflightBoundary){stop='preflight_fixed_twenty_turns';break;}
        if(interrupted){stop='operator_stop';break;}
        if(!stable(initial,final)){stop='source_changed';break;}
        if(row.failedBeforeFinalReport){stop='unhandled_episode_failure';break;}
      }
      const final=await current(),readout=studyReadout(rows,plan,{initial,final,stable:stable(initial,final)});readout.stoppedReason=stop;
      await writeFile(resolve(folder,'summary.json'),JSON.stringify(readout,null,2)+'\n');
      onProgress(JSON.stringify({phase:'closed',folder,eligible:readout.eligible,aggregate:readout.aggregate,pairs:readout.pairs,stoppedReason:stop}));
      return readout;
    }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const opts=Object.fromEntries(process.argv.slice(2).map(a=>a.slice(2).split('=')));
  const settings={preflight:opts.preflight==='true',seeds:Number(opts.seeds??3),seedStart:Number(opts['seed-start']??1)};
  if(opts.run!=='TAKAMATSU_COMPARISON')console.log(JSON.stringify({state:'prepared_not_launched',plan:takamatsuStudyPlan({...settings,backend:opts['database-config']?'postgres-native-local':'pglite-memory'})}));
  else {const result=await runTakamatsuStudy({folder:opts.folder,databaseConfig:opts['database-config'],...settings});if(result.stoppedReason&&result.stoppedReason!=='preflight_fixed_twenty_turns'||!result.plan.preflight&&!result.eligible)process.exitCode=1;}
}
