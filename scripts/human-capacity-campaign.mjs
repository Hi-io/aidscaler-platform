import { readFile, writeFile, mkdir, open, unlink, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runHumanCapacityEpisode, summarizeHumanCapacity, HUMAN_CAPACITY_PROTOCOL, humanCapacityEvaluatorFingerprint } from '../evaluation/human-capacity-benchmark.mjs';
import { buildFingerprint, evaluatorFingerprint } from '../evaluation/harness.mjs';
import { requireLoadedSimulatorBuild } from '../evaluation/simulator-build.mjs';
import { hash } from '../src/store.mjs';

const finite = x => typeof x === 'number' && Number.isFinite(x);
const simulatorOf = f => f?.simulatorBuild ?? f?.simulatorFingerprint;
export function validateHumanCampaignGate(freeze, current) {
  if (!freeze || freeze.candidateFingerprint !== current.candidate || freeze.evaluatorFingerprint !== current.baseEvaluator ||
      simulatorOf(freeze) !== current.simulator) throw Error('Human-capacity source freeze mismatch');
  const v = freeze.verification, u = freeze.ui;
  if (!v?.passed || v.candidateChanged !== false || v.evaluatorChanged !== false || v.simulatorChanged !== false ||
      !Array.isArray(v.cases) || v.cases.some(c=>c.exitCode!==0||c.signal!=null)) throw Error('Fresh unchanged full verification required');
  for (const name of ['platform-tests','simulator-tests']) {
    const t = v.cases.find(c=>c.name===name)?.tests;
    if (!t || !(t.tests>0) || t.pass!==t.tests || t.fail!==0 || t.cancelled!==0) throw Error('Missing successful full suite '+name);
  }
  if (!u?.passed || u.unchanged!==true || !Array.isArray(u.cases) || !u.cases.length || u.cases.some(c=>c.exitCode!==0||c.signal!=null))
    throw Error('Fresh unchanged UI proof required');
  for (const proof of [v,{ candidateFingerprint:v.candidateFinalFingerprint,evaluatorFingerprint:v.evaluatorFinalFingerprint,simulatorBuild:v.simulatorFinalFingerprint },u,u.finalFingerprints])
    if (proof?.candidateFingerprint!==current.candidate || proof?.evaluatorFingerprint!==current.baseEvaluator || simulatorOf(proof)!==current.simulator)
      throw Error('Full/UI proof belongs to another source build');
  return true;
}

export function campaignPlan(o={}) {
  const family=o.family??'primary';
  if(!['primary','sensitivity'].includes(family))throw Error('Unknown predeclared family');
  const arms = (o.arms ?? (family==='primary'?'C_manual,B5,B8,B6':'C_manual,C_decentralized,B5,B8,B6')).split(',');
  const profiles = (o.profiles ?? (family==='primary'?'moderate':'zero,moderate,burst,moderate_error_1pct,fast_read_5s,readers8,moderate_48,moderate_96')).split(',');
  const seeds = Number(o.seeds ?? (family==='primary'?3:1)), budget = Number(o.budget ?? .5), cap = Number(o['episode-budget'] ?? .15);
  const errorsBp = Number(o['errors-bp'] ?? 0);
  if (!Number.isSafeInteger(seeds)||seeds<1||seeds>10||!finite(budget)||budget<=0||budget>3||!finite(cap)||cap<=0||cap>budget||
      !Number.isSafeInteger(errorsBp)||errorsBp<0||errorsBp>1000||new Set(arms).size!==arms.length||
      !arms.every(a=>Object.hasOwn(HUMAN_CAPACITY_PROTOCOL.arms,a))||new Set(profiles).size!==profiles.length||
      !profiles.every(p=>Object.hasOwn(HUMAN_CAPACITY_PROTOCOL.conditions,p))) throw Error('Invalid predeclared human-capacity campaign');
  const config = { count:Number(o.needs??24),noise:Number(o.noise??192),reposts:Number(o.reposts??2),
    formalDelayMs:Number(o['formal-ms']??1800000),horizonMs:Number(o['horizon-ms']??10800000),
    grid:Number(o.grid??9),extentKm:Number(o.km??6),pumpMs:Number(o['pump-ms']??60000),
    clarificationWorkers:Number(o['confirm-workers']??2),wallLimitMs:Number(o['wall-ms']??900000),
    budgetUsd:cap,maxModelCalls:Number(o.calls??16) };
  const worlds=[];
  for (const condition of profiles) {
    const {profile,errorBp,...sensitivity}=HUMAN_CAPACITY_PROTOCOL.conditions[condition],
      declaredError=condition==='moderate_error_1pct'?errorBp:profile==='zero'?0:errorsBp;
    for(let i=1;i<=seeds;i++) for(const arm of arms) worlds.push({arm,profile,condition,
      seed:`${o['seed-prefix']??'native-human-capacity-'+family}-${String(i).padStart(2,'0')}`,
      ...(sensitivity.count?{count:sensitivity.count,noise:sensitivity.noise,maxModelCalls:sensitivity.maxModelCalls}:{}),
      ...(sensitivity.grid?{grid:sensitivity.grid}:{}),
      humanCapacityOverrides:{readers:sensitivity.readers??2,deciders:2,relayers:1,
        ...(sensitivity.readMs!=null?{readMs:sensitivity.readMs}:{}),
        readErrorBp:declaredError,decisionErrorBp:declaredError,relayErrorBp:declaredError}});
  }
  return { ...HUMAN_CAPACITY_PROTOCOL, family, config, seeds, arms, profiles, worlds, totalBudgetUsd:budget, episodeBudgetUsd:cap,
    errorsBp, orchestratorWorkers:1, experimentsBeforeResults:true,
    errorScope:errorsBp?'Explicit assumed native error sensitivity, including the decision-pool owner reviews of EVERY arm. No errors or duplicate scores are injected by the evaluator.':'Zero-error capacity study; not evidence about human mistake frequency.',
    attribution:'C_manual is a separately declared manual workflow, not a substitute for the strong existing B5/B8 references.',
    costPolicy:'Reserve each full declared paid episode cap before launch. Retain exact known cost, unknown-call reservations, every failed/censored/missing planned world. No cap raised or last episode shrunk after outcomes.',
    stopPolicy:'Honor stop/signal only at settled provider/round boundaries; source work already issued is observed to fixed horizon, with controller status stopped and demand right-censored honestly.' };
}

/** Unknown usage from an unreturned episode never becomes zero provider cost. */
export function failedHumanCapacityWorld({world,config,source,cap,error,wallMs}) {
  return {...world,status:'failed',candidateFingerprint:source.candidate,evaluatorFingerprint:source.evaluator,
    baseEvaluatorFingerprint:source.baseEvaluator,manifest:{engineBuild:source.simulator},
    finalCandidateFingerprint:null,finalEvaluatorFingerprint:null,finalEngineBuild:null,
    candidateChanged:null,evaluatorChanged:null,simulatorChanged:null,
    protocol:{...HUMAN_CAPACITY_PROTOCOL,...config,...world},corpus:null,outcomes:[],
    timeToSufficientService:{eligible:config.count,reached:null,rightCensored:null,restrictedMeanMs:null},
    timeToFirstUsefulService:{eligible:config.count,reached:null,rightCensored:null,restrictedMeanMs:null},
    errors:[{phase:'unhandled-episode',code:error?.code??error?.name??'UNKNOWN',message:String(error?.message??error).slice(0,250)}],
    invariants:null,usage:null,usageMissing:true,modelCalls:null,costUsd:null,knownCostUsd:null,unknownCostRows:null,
    chargedBudgetUsd:world.arm==='B6'?cap:0,wallMs,
    failedBeforeFinalReport:true,initializationAndFinalSourceIntegrityUnconfirmed:true,
    note:'No native outcomes or fee ledger returned. Planned demand denominator is known; service/censoring/calls/fees remain unknown. Paid arm reserves its full cap; reference provider forbids paid inference.'};
}
/** This owns only its exact nonce lock; callback failures still release it. */
export async function withHumanResearchLock(lockPath,metadata,callback) {
  await mkdir(dirname(lockPath),{recursive:true});
  const handle=await open(lockPath,'wx');
  try {
    await handle.writeFile(JSON.stringify(metadata));await handle.close();
    return await callback();
  } finally {
    await handle.close().catch(()=>{});
    const held=JSON.parse(await readFile(lockPath,'utf8'));
    if(held.nonce!==metadata.nonce)throw Error('Research lock identity changed; preserve it');
    await unlink(lockPath);
  }
}

export async function runHumanCapacityCampaign(options={}) {
  const plan=campaignPlan(options);
  if (options.run!=='ROOT_GO_HUMAN_CAPACITY') {
    console.log(JSON.stringify({state:'prepared_not_launched',plan})); return {state:'prepared_not_launched',plan};
  }
  if (!options.freeze) throw Error('Explicit current freeze file is required');
  const current={candidate:await buildFingerprint(),baseEvaluator:await evaluatorFingerprint(),
    evaluator:await humanCapacityEvaluatorFingerprint(),simulator:await requireLoadedSimulatorBuild()};
  validateHumanCampaignGate(JSON.parse(await readFile(resolve(options.freeze),'utf8')),current);
  const nonce=randomUUID();
  const lockPath=resolve(options.lock??'.local/PAID_RESEARCH_STUDY.lock');
  return withHumanResearchLock(lockPath,{study:'native-human-capacity',nonce,pid:process.pid,source:current},async()=>{
  const folder=resolve(options.folder??`reports/human-capacity/${Date.now()}`);
  await mkdir(folder,{recursive:true});
  const runnerBytes=await readFile(new URL('./human-capacity-campaign.mjs',import.meta.url),'utf8');
  const evaluatorBytes=await readFile(new URL('../evaluation/human-capacity-benchmark.mjs',import.meta.url),'utf8');
  const protocol={...plan,source:current,runnerSha256:createHash('sha256').update(runnerBytes).digest('hex'),benchmarkSha256:createHash('sha256').update(evaluatorBytes).digest('hex'),
    declaredAt:new Date().toISOString(),freezePath:resolve(options.freeze)};
  // Preserve runner/protocol bytes BEFORE outcomes; archives never replace a
  // prior favorable or failed run. An existing folder is not reused.
  await writeFile(resolve(folder,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
  await writeFile(resolve(folder,'human-capacity-campaign.mjs'),runnerBytes,{flag:'wx'});
  await writeFile(resolve(folder,'human-capacity-benchmark.mjs'),evaluatorBytes,{flag:'wx'});
  const rows=[]; let charged=0,stop=null,interrupted=false;
  const onSignal=()=>{interrupted=true;console.log(JSON.stringify({phase:'stopping_at_settled_boundary'}));};
  process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  const shouldStop=async()=>{
    if(interrupted)return true;
    if(!options['stop-file'])return false;
    try{await access(resolve(options['stop-file']));return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}
  };
  try{
    for(const world of plan.worlds){
      if(await shouldStop()){stop='operator_stop';break;}
      const now={candidate:await buildFingerprint(),baseEvaluator:await evaluatorFingerprint(),evaluator:await humanCapacityEvaluatorFingerprint(),simulator:await requireLoadedSimulatorBuild()};
      if(hash(now)!==hash(current)){stop='source_changed';break;}
      if(world.arm==='B6'&&charged+plan.episodeBudgetUsd>plan.totalBudgetUsd){stop='campaign_budget';break;}
      console.log(JSON.stringify({phase:'started',folder,world}));
      let r;const episodeStarted=performance.now();
      try {r=await runHumanCapacityEpisode({...plan.config,...world,candidateFingerprint:current.candidate,evaluatorBuild:current.evaluator,
        shouldStop,onProgress:p=>console.log(JSON.stringify({phase:'progress',...p}))});}
      catch(error){r=failedHumanCapacityWorld({world,config:{...plan.config,...world},source:current,
        cap:plan.episodeBudgetUsd,error,wallMs:performance.now()-episodeStarted});stop='unhandled_episode_failure';}
      // Missing final usage reserves the full cap, never assumes zero calls.
      charged+=finite(r.chargedBudgetUsd)?r.chargedBudgetUsd:(world.arm==='B6'?plan.episodeBudgetUsd:0);
      rows.push(r);
      await writeFile(resolve(folder,`${world.condition}-${world.seed}-${world.arm}.json`),JSON.stringify(r,null,2),{flag:'wx'});
      await writeFile(resolve(folder,'summary.json'),JSON.stringify({...summarizeHumanCapacity(rows,plan.worlds),folder,chargedBudgetUsd:charged,stoppedReason:stop},null,2));
      console.log(JSON.stringify({phase:'completed',arm:r.arm,profile:r.profile,condition:r.condition,seed:r.seed,status:r.status,
        reached:r.timeToSufficientService?.reached,eligible:r.outcomes.length,rmstMs:r.timeToSufficientService?.restrictedMeanMs,
        costUsd:r.costUsd,chargedBudgetUsd:r.chargedBudgetUsd,unknownCostRows:r.unknownCostRows,errors:r.errors.map(e=>e.code)}));

      if(r.failedBeforeFinalReport)break;
      if(r.candidateChanged||r.evaluatorChanged||r.simulatorChanged){stop='source_changed';break;}
      if(await shouldStop()){stop='operator_stop';break;}
    }
    const summary={...summarizeHumanCapacity(rows,plan.worlds),folder,chargedBudgetUsd:charged,stoppedReason:stop,
      source:current,protocolSha256:hash(protocol)};
    await writeFile(resolve(folder,'summary.json'),JSON.stringify(summary,null,2));
    console.log(JSON.stringify(summary));return summary;
  }finally{
    process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);
  }
  });
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const options=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
  const result=await runHumanCapacityCampaign(options);
  if(result.stoppedReason||result.failedOrStoppedRuns||result.comparisons?.some(c=>!c.comparable))process.exitCode=1;
}
