import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateProbeGate, archiveProbe, acquireProbeLock, exists, finite, sha256 } from './evidence-probe-guards.mjs';
import { providerCost, digest, sourceIntegrity } from './read-human-capacity-evidence.mjs';

// Ignored orchestration. Preparation/tests use no runtime imports, worlds or
// providers. Sequential actual launches require named GO and current full/UI.
export const PINNED={candidateFingerprint:'9b4de8b7769c69a3279067a8a093ef6d2392ec8a9728e704f871a184a69934e3',
  evaluatorFingerprint:'4b4d289e387b49da8d79fdccb260a67919b74339432731373204d96aee6668b3',
  simulatorBuild:'561e6a02fbde1d047f999c4f077cbff83c438ba5c508c4d8d18bbf59ff78e94b'};
export const NEW_LOCK=resolve('.local/PAID_RESEARCH_STUDY.lock');
const variants=['distributed','delayed'],arms=['B5','B6','B7'];
export const PLANS={
  S19:{version:'current-delegated-service-s19-v1',authorization:'ROOT_GO_S19_CURRENT',source:PINNED,modelCapUsd:.15,totalBudgetUsd:.75,
    worlds:variants.flatMap(variant=>arms.map(arm=>({scenario:'S19',variant,arm,seed:`delegated-current-2026-${variant}-01`}))),
    config:{planningRounds:12,policyIntervalMs:300000,maxCalls:8,episodeBudgetUsd:.15,responseOrder:'deadline_then_priority'},
    sourceDefaults:'Current PILOT_CONFIG: modeled, grid5/2km, no hazard/background traffic/posts/packet loss, review30s/inspection60s/load60s/unload60s/setup60s, horizon4h. Exact full normalized manifest retained; do not call this a3h human-primary world.',
    scope:'Current runEpisode B5/B6/B7 on identical distributed/delayed native dependency worlds and independent owner approval. Occupied shelter places/place-hours and native deficit, not activation alone. Modeled source-clock policy remains explicitly labeled; HTTP cost/wall separate.',
    negatives:'Keep failed, unsafe, late, partial and zero-occupancy worlds. B7 same model/tools is retained; no successful seed replacement or claim of universal composition.'},
  K22:{version:'current-source-recovery-nominal-burst-v1',authorization:'ROOT_GO_K22_CURRENT',source:PINNED,totalBudgetUsd:.45,
    worlds:[
      {name:'nominal-parser',mode:'parser',seed:'source-recovery-current-2026-01',count:24,noise:96,grid:9,sourceCutoffMs:300000,maxModelCalls:32,budgetUsd:.15},
      {name:'nominal-real',mode:'real',seed:'source-recovery-current-2026-01',count:24,noise:96,grid:9,sourceCutoffMs:300000,maxModelCalls:32,budgetUsd:.15},
      {name:'burst-parser',mode:'parser',seed:'source-recovery-current-2026-burst-01',count:48,noise:384,grid:11,sourceCutoffMs:600000,maxModelCalls:64,budgetUsd:.20},
      {name:'burst-real',mode:'real',seed:'source-recovery-current-2026-burst-01',count:48,noise:384,grid:11,sourceCutoffMs:600000,maxModelCalls:64,budgetUsd:.20}],
    config:{reposts:2,extentKm:6,horizonMs:10800000,wallLimitMs:600000,batchSize:30,clarificationWorkers:2,reviewMs:30000,
      formalDelayMs:3600000,maxSourceAttempts:2,retryCooldownMs:60000,writeReport:true},
    scope:'Received ID+version cohort sealed at the declared source cutoff, finite field and source review queues, same nominal/burst physics. Parser is a separate zero-paid substitution, real is configured provider. Recovery is not precision/recall or comparative GenAI benefit.',
    negatives:'Do not close by physical gold. Preserve rejected/truncated/revised sources, waiting_context operational attention, pending jobs/reviews/operations, wall/horizon censoring and unknown bills. Sources disposed and operational recovery are separate.'},
};
const readerBuild=x=>({candidate:x.candidateFingerprint,evaluator:x.evaluatorFingerprint,simulator:x.simulatorBuild});
export function validateCurrent(freeze,current){for(const k of Object.keys(PINNED))if(current[k]!==PINNED[k])throw Error('Declared current source mismatch:'+k);return validateProbeGate(freeze,current);}
export function admittedCap(charged,cap,total){if(![charged,cap,total].every(finite)||charged<0||cap<0||charged+cap>total+1e-12)throw Error('Full fixed cap unavailable');return charged+cap;}
export function feeEvidence(raw,cap,{parser=false}={}) {
  if(parser)return {scope:'declared parser no-paid control',providerCalls:0,totalProviderCostUsd:0,knownCostSubtotalUsd:0,totalCostKnown:true,chargedBudgetUsd:0,
    modeledUsageRecords:Array.isArray(raw?.usage)?raw.usage.length:null,externalFetchGuard:raw?.http??null};
  const cost=providerCost(raw),usage=Array.isArray(raw?.usage)?raw.usage:null;
  let charged=0,unknown=false;if(!usage||raw.usageMissing===true)unknown=true;
  for(const u of usage??[]){const n=finite(u.cost_usd)&&u.cost_usd>=0?u.cost_usd:finite(u.reserved_usd)&&u.reserved_usd>=0?u.reserved_usd:null;
    if(n===null)unknown=true;else charged+=n;}
  return {...cost,chargedBudgetUsd:unknown?cap:charged,fullCapExposureWhenUsageMissingUsd:unknown?cap:null,
    legacyReportedCostUsd:raw?.costUsd??raw?.paidCostUsd??null,note:'Bills recomputed from usage; null is never free. Missing/unpriced usage keeps cap exposure, not an invented invoice.'};
}
export function failedWorld(world,cap,error,parser=false){return {...world,status:'failed_missing_outcome',errors:[{phase:'episode',code:error?.code??error?.name??'UNKNOWN'}],
  physical:null,sourceRecovery:null,invariants:null,usage:null,fee:feeEvidence(null,cap,{parser}),note:'No returned outcome: service/recovery/calls unknown. Declared attempt and cap exposure preserved.'};}
export async function isolatedRecoveryCall(fn){const original=globalThis.fetch;try{return await fn();}finally{globalThis.fetch=original;}}
function recoveryAsBuild(raw){const f=raw.protocol?.fingerprints??{},end=raw.finalBuilds??{};return {candidateFingerprint:f.candidate,evaluatorFingerprint:f.evaluator,
  manifest:{engineBuild:f.simulator},...end};}
export function projectWorld(study,world,raw,current=PINNED){
  if(raw.status==='failed_missing_outcome')return {...world,...raw,eligible:false};
  const recovery=study==='K22',integrity=sourceIntegrity(recovery?recoveryAsBuild(raw):raw,readerBuild(current)),cap=recovery?world.budgetUsd:PLANS.S19.modelCapUsd,
    fee=feeEvidence(raw,cap,{parser:recovery&&world.mode==='parser'}),issues=[];
  if(!integrity.stable)issues.push(...integrity.reasons);
  if(!Array.isArray(raw.invariants)||raw.invariants.length)issues.push('invariants_missing_or_failed');
  const finished=recovery?raw.status==='recovered':raw.status==='completed';if(!finished)issues.push('not_successful:'+raw.status);
  return {...world,status:raw.status,eligible:!issues.length,issues,source:integrity,errors:raw.errors??null,invariants:raw.invariants??null,fee,
    sourceClockMode:raw.measurementMode??raw.protocol?.scope??null,
    physical:recovery?{outcomes:raw.outcomes??null,counts:raw.results?{eligible:raw.results.physicalEligible,sufficient:raw.results.physicalSufficient}:null,
      operations:raw.scorerOnlyPhysical?.operations??null}: {native:raw.metrics?.services??null,collective:raw.metrics?.collective??null,
      community:raw.metrics?.perCommunity??null,population:raw.metrics?.population??null,physicalTotals:raw.metrics?.physical??null,
      utilization:raw.metrics?.utilization??null,assessmentAndOwnerEvidence:raw.platformEvidence??null,proposalFunnel:raw.proposalFunnel??null},
    sourceRecovery:recovery?{eligible:raw.results?.eligible??null,closed:raw.results?.closed??null,retainedAttention:raw.results?.retainedAttention??null,
      recoveryCensored:raw.recoveryCensored??null,recoveredAt:raw.recoveredAt??null,durationMs:raw.recoveryDurationMs??null,
      cutoffMs:raw.protocol?.sourceCutoffMs??null,cohortHash:raw.cohortHash??null,dispositions:raw.dispositions??null,localState:raw.localState??null,
      maxPendingSourceReviews:raw.maxPendingSourceReviews??null,timeline:raw.timeline??null,attempts:raw.sourceAttempts??null}:null,
    rawClocks:raw.metrics?.latency??null,actualWallMs:raw.wallMs??raw.actualWallMs??null,
    note:'Every failure/partial/censored result remains visible. Positive receipts, service benefit, source disposition and operational recovery are separate denominators.'};
}
export function studySummary(study,plan,rows,current=PINNED){
  const id=w=>study==='S19'?`${w.variant}:${w.arm}`:w.name,projected=rows.map(r=>projectWorld(study,r.world,r.raw,current)),
    missing=plan.worlds.filter(w=>!rows.some(r=>id(r.world)===id(w))),pairs=[];
  if(study==='S19')for(const variant of variants)for(const reference of ['B5','B7']){
    const a=rows.filter(r=>r.world.variant===variant&&r.world.arm===reference),b=rows.filter(r=>r.world.variant===variant&&r.world.arm==='B6'),reasons=[];
    if(a.length!==1||b.length!==1)reasons.push('missing_or_duplicate_pair');
    else{
      if(!projectWorld(study,a[0].world,a[0].raw,current).eligible||!projectWorld(study,b[0].world,b[0].raw,current).eligible)reasons.push('incomplete_or_invalid_world');
      for(const k of ['seed','planningRounds','policyIntervalMs','responseOrder','episodeBudgetUsd','modelConfig'])if(digest(a[0].raw[k])!==digest(b[0].raw[k]))reasons.push('different_'+k);
      if(digest(a[0].raw.manifest?.config)!==digest(b[0].raw.manifest?.config)||a[0].raw.initialMapHash!==b[0].raw.initialMapHash)reasons.push('different_physical_world');
    }
    const native=[];for(const type of ['water','shelter']){const x=a[0]?.raw.metrics?.services?.[type],y=b[0]?.raw.metrics?.services?.[type];native.push({type,
      reference:x??null,candidate:y??null,deficitReductionFraction:!reasons.length&&finite(x?.uncoveredUnitMs)&&x.uncoveredUnitMs>0&&finite(y?.uncoveredUnitMs)?
        (x.uncoveredUnitMs-y.uncoveredUnitMs)/x.uncoveredUnitMs:null});}
    pairs.push({variant,reference,candidate:'B6',comparable:!reasons.length,reasons,native,
      note:'One seed per variant; no confidence interval or universal composition/model benefit. Occupied place-hours, not opening alone, supports service.'});
  }
  return {study,plan,declaredRuns:plan.worlds.length,observedRuns:rows.length,missing,worlds:projected,pairs,
    knownCostSubtotalUsd:projected.reduce((s,r)=>s+(finite(r.fee?.knownCostSubtotalUsd)?r.fee.knownCostSubtotalUsd:0),0),
    totalProviderCostUsd:!missing.length&&projected.every(r=>r.fee?.totalCostKnown)?projected.reduce((s,r)=>s+r.fee.totalProviderCostUsd,0):null,
    chargedBudgetUsd:projected.reduce((s,r)=>s+(finite(r.fee?.chargedBudgetUsd)?r.fee.chargedBudgetUsd:0),0),
    note:'All declared negatives and missing slots retained. K22 is a lifecycle control, not a comparison of GenAI accuracy or physical response superiority.'};
}
export async function sealCurrentStudies(){const freeze=JSON.parse(await readFile('reports/measurement-freeze-current.json','utf8'));
  validateCurrent(freeze,PINNED);const archive=await archiveProbe({names:['current-service-recovery.mjs','current-service-recovery.test.mjs',
    'current-service-recovery-guide.md','evidence-probe-guards.mjs','read-human-capacity-evidence.mjs'],tag:'current-service-recovery',plan:{plans:PLANS,newLock:NEW_LOCK}});
  const bytes=await readFile('reports/measurement-freeze-current.json'),file=resolve(archive.folder,'measurement-freeze-current.json');
  try{await writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||sha256(await readFile(file))!==sha256(bytes))throw e;}
  return {...archive,freezeSha256:sha256(bytes)};
}
export async function runStudy(options={}){
  const plan=PLANS[options.study];if(!plan)throw Error('Use study S19 or K22');
  if(options.run!==plan.authorization)return {state:'prepared_not_launched',providerCalls:0,plan};
  const [h,b]=await Promise.all([import('../evaluation/harness.mjs'),import('../evaluation/simulator-build.mjs')]),
    current={candidateFingerprint:await h.buildFingerprint(),evaluatorFingerprint:await h.evaluatorFingerprint(),simulatorBuild:await b.requireLoadedSimulatorBuild()},
    freeze=JSON.parse(await readFile(resolve(options.freeze??'reports/measurement-freeze-current.json'),'utf8'));
  validateCurrent(freeze,current);const archive=await sealCurrentStudies(),nonce=randomUUID(),release=await acquireProbeLock(NEW_LOCK,{nonce,pid:process.pid,study:options.study,source:current});
  const identity=digest([plan,current]),folder=resolve(options.folder??`reports/service-recovery/${options.study}-${identity.slice(0,16)}`),rows=[];
  let interrupted=false,charged=0,stoppedReason=null;const signal=()=>{interrupted=true;};process.on('SIGINT',signal);process.on('SIGTERM',signal);
  const stopFile=resolve(options['stop-file']??'.local/STOP_CURRENT_SERVICE_RECOVERY'),stop=async()=>interrupted||await exists(stopFile),
    builds=()=>b.checkFinalBuilds(readerBuild(current),{candidate:h.buildFingerprint,evaluator:h.evaluatorFingerprint});
  try{
    if(await stop())throw Object.assign(Error('Stop before launch'),{code:'OPERATOR_STOP'});
    await mkdir('.local/service-recovery-admission',{recursive:true});await writeFile(resolve('.local/service-recovery-admission',identity+'.json'),JSON.stringify({identity,folder,nonce,plan,source:current,at:new Date().toISOString()}),{flag:'wx'});
    await mkdir(folder,{recursive:true});await writeFile(resolve(folder,'protocol.json'),JSON.stringify({plan,archive,source:current,identity,newLock:NEW_LOCK,declaredAt:new Date().toISOString()},null,2),{flag:'wx'});
    const recovery=options.study==='K22'?await import('../scripts/source-recovery.mjs'):null;
    for(const world of plan.worlds){if(await stop()){stoppedReason='operator_stop';break;}const before=await builds();if(before.invalidStatus){stoppedReason=before.invalidStatus;break;}
      const cap=options.study==='K22'?(world.mode==='parser'?0:world.budgetUsd):plan.modelCapUsd;admittedCap(charged,cap,plan.totalBudgetUsd);
      await writeFile(resolve(folder,`attempt-${rows.length+1}.json`),JSON.stringify({world,cap,at:new Date().toISOString(),source:current,state:'started_result_or_bill_not_yet_known'},null,2),{flag:'wx'});
      let raw;try{raw=options.study==='S19'?await h.runEpisode({...plan.config,arm:world.arm,scenario:'S19',seed:world.seed,config:{compositionVariant:world.variant},shouldStop:stop}):
        await isolatedRecoveryCall(()=>recovery.runSourceRecovery({...plan.config,...world,shouldStop:stop}));}
      catch(e){raw=failedWorld(world,cap,e,world.mode==='parser');}
      const row=projectWorld(options.study,world,raw,current);charged+=row.fee?.chargedBudgetUsd??cap;rows.push({world,raw});
      await writeFile(resolve(folder,`${rows.length}-${options.study==='S19'?world.variant+'-'+world.arm:world.name}.json`),JSON.stringify(raw,null,2),{flag:'wx'});
      await writeFile(resolve(folder,'summary.json'),JSON.stringify({...studySummary(options.study,plan,rows,current),archive,stoppedReason},null,2));
      console.log(JSON.stringify({phase:'closed',study:options.study,world,status:raw.status,chargedBudgetUsd:charged,knownCostUsd:row.fee?.knownCostSubtotalUsd??null}));
      if(raw.status==='failed_missing_outcome'||!row.source?.stable||raw.errors?.some(e=>e.code==='PROVIDER_FUNDS')){stoppedReason=raw.status==='failed_missing_outcome'?'missing_outcome_or_usage':'source_or_provider_failure';break;}
    }
    const result={...studySummary(options.study,plan,rows,current),archive,source:current,stoppedReason,finalBuilds:await builds()};
    await writeFile(resolve(folder,'summary.json'),JSON.stringify(result,null,2));return {folder,...result};
  }finally{process.off('SIGINT',signal);process.off('SIGTERM',signal);await release();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const opts=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf('=');return i<0?[s.replace(/^--/,''),true]:[s.slice(0,i).replace(/^--/,''),s.slice(i+1)];}));
  const r=opts.seal?await sealCurrentStudies():await runStudy(opts);
  console.log(JSON.stringify({state:r.state,folder:r.folder,runnerSha256:r.runnerSha256,planSha256:r.planSha256,freezeSha256:r.freezeSha256,declared:r.declaredRuns,observed:r.observedRuns,missing:r.missing,stoppedReason:r.stoppedReason,providerCalls:r.providerCalls}));
}
