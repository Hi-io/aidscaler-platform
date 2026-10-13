import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { validateProbeGate, archiveProbe, acquireProbeLock, exists, finite, sha256 } from './evidence-probe-guards.mjs';
import { digest, providerCost, sourceIntegrity } from './read-human-capacity-evidence.mjs';

// Preparing/importing this ignored wrapper never imports runtime controllers,
// opens a world or calls a provider. Launch requires a separate named ROOT_GO.
export const STUDIES={
  K15:{version:'minimal-same-family-general-agent-v1',authorization:'ROOT_GO_K15_CURRENT',seed:'k15-current-discovery-2026-01',
    worlds:['B6','B9'],episodeBudgetUsd:.15,totalBudgetUsd:.4,maxModelCalls:32,
    config:{count:24,noise:192,reposts:2,humanReadMs:30000,humanWorkers:2,clarificationWorkers:2,formalDelayMs:1800000,
      silentFraction:0,extentKm:6,grid:9,horizonMs:10800000,traffic:0,packetLoss:0,budgetUsd:.15,maxModelCalls:32},
    scope:'Fresh runDiscoveryEpisode B6 and B9 only, same exogenous received public corpus, native source profile, model/tools/permissions/stock/fleet/reviews/common compiler and budget. Not a reuse of human-capacity moderate, not all possible agents, not an independently sealed semantic family.',
    retained:'Every declared failure, recovered schema error, censor, source change, missing usage and cap exposure is retained. One seed is descriptive; no bootstrap confidence claim. No retry to select a favorable response.',
    stopping:'Current discovery service-cohort stopping is preserved as K02 scope; not source-recovery K22. Endogenous receipts/communication may differ by policy.'},
  K11_K13:{version:'compact-real-semantic-scoring-wrapper-v1',authorization:'ROOT_GO_SEMANTIC_PILOT',seed:'k11-semantic-current-2026-01',
    needs:8,organizations:1,copies:2,episodeBudgetUsd:.12,totalBudgetUsd:.12,maximumProviderAttemptsByCurrentLoop:2,wallLimitMs:300000,
    sourceScript:'scripts/semantic-load.mjs',languages:['en','es','fr','ja'],resourceTypes:['water','food','medicine','shelter','blankets'],
    entities:'Existing received public building IDs bN, supplied by ordinary scoped query(map); no hidden aliases or observer IDs inserted in model context.',
    corpus:'Current script cycles language and native resource/unit over8 explicit current requests; each also contains an old-video correction. Two public-lineage copies plus one labelled historic clip and one injection post per request. Semantic tuples are scored only by the observer after extraction.',
    scope:'Small internally authored exact-tuple K11/K13 pilot, not clinical/public-source accuracy, calibrated professional performance, K12 independent attribution, or physical response speed.',
    bound:'One organization and24 evaluated originals fit one batch30. Current SemanticIngestion permits at most one schema repair, hence at most2 provider attempts; a runtime increase is a violated predeclared bound, not an extra successful trial.',
    retained:'Full raw failed batches/rejected observations/omissions and known/unknown usage preserved. Archive child source bytes and three initial/final build hashes; never trust legacy costUsd null-to-zero or candidate-only final gate.'},
};
export const SHARED_LOCK=resolve('../../.candidate-development/nexo-platform/.local/PAID_RESEARCH_STUDY.lock');
export function admitStudy(kind,authorization){if(!Object.hasOwn(STUDIES,kind)||authorization!==STUDIES[kind].authorization)throw Error('Named ROOT_GO required');return STUDIES[kind];}
export function reserveEpisode(charged,cap,total){if(![charged,cap,total].every(finite)||charged<0||cap<=0||charged+cap>total+1e-12)throw Error('Full fixed episode cap cannot be admitted');return charged+cap;}
export function conservativeExposure(raw,cap){
  if(!Array.isArray(raw?.usage)||raw.usageMissing===true)return cap;
  const reported=raw.modelCalls??raw.metrics?.modelCalls;if(finite(reported)&&reported!==raw.usage.length)return cap;
  let charged=0;for(const u of raw.usage){const value=finite(u.cost_usd)&&u.cost_usd>=0?u.cost_usd:finite(u.reserved_usd)&&u.reserved_usd>=0?u.reserved_usd:null;
    if(value===null)return cap;charged+=value;}
  return charged;
}

export function missingOutcome(arm,seed,cap,error){return {arm,seed,status:'failed_missing_outcome',errors:[{phase:'episode',code:error?.code??error?.name??'UNKNOWN'}],
  usage:null,usageMissing:true,physicalService:null,chargedBudgetUsd:cap,
  cost:{...providerCost(null,{missing:true,cap}),note:'No returned outcome/usage: full episode cap retained as exposure, service unknown, not zero-minute success.'}};}
export function k15Readout(rows,current){
  const projected=rows.map(r=>({arm:r.arm,seed:r.seed,status:r.status,errors:r.errors??null,invariants:r.invariants??null,
    source:sourceIntegrity(r,current),cost:{...(r.cost??providerCost(r)),chargedBudgetUsd:conservativeExposure(r,STUDIES.K15.episodeBudgetUsd)},firstUseful:r.timeToFirstUsefulService??null,sufficient:r.timeToSufficientService??null,
    native:r.metrics?.services??null,outcomes:r.outcomes??null,proposalFunnel:r.proposalFunnel??null,corpus:r.corpus??null,
    protocolHash:r.protocol?digest(r.protocol):null,sourceConfigHash:r.manifest?.config?digest(r.manifest.config):null}));
  const a=rows.find(r=>r.arm==='B9'),b=rows.find(r=>r.arm==='B6'),reasons=[];
  if(!a||!b||rows.length!==2)reasons.push('missing_or_duplicate_declared_pair');
  else {
    for(const r of [a,b]){
      if(r.status!=='completed'||!sourceIntegrity(r,current).stable||!Array.isArray(r.invariants)||r.invariants.length||!Array.isArray(r.outcomes)||r.outcomes.length!==24)reasons.push('incomplete_or_invalid:'+r.arm);
      for(const field of ['count','noise','reposts','formalDelayMs','silentFraction'])if(r.corpus?.config?.[field]!==STUDIES.K15.config[field])reasons.push('not_declared_corpus:'+r.arm+':'+field);
      for(const field of ['humanReadMs','humanWorkers','clarificationWorkers','extentKm','grid','horizonMs','traffic','packetLoss','budgetUsd','maxModelCalls'])if(r.protocol?.[field]!==STUDIES.K15.config[field])reasons.push('not_declared_protocol:'+r.arm+':'+field);
    }
    for(const field of ['seed','protocol','corpus'])if(digest(a[field])!==digest(b[field]))reasons.push('different_'+field);
    if(digest(a.manifest?.config)!==digest(b.manifest?.config))reasons.push('different_native_source_profile');
    for(const field of ['timeToFirstUsefulService','timeToSufficientService'])if(!finite(a[field]?.restrictedMeanMs)||!finite(b[field]?.restrictedMeanMs))reasons.push('unknown_'+field);
  }
  const models=r=>[...new Set((r?.usage??[]).map(u=>u.model).filter(x=>typeof x==='string'))].sort(),candidateModels=models(b),referenceModels=models(a);
  if(candidateModels.length&&referenceModels.length&&digest(candidateModels)!==digest(referenceModels))reasons.push('different_actual_models');
  const comparable=!reasons.length,endpoint=field=>({referenceRmstMs:a?.[field]?.restrictedMeanMs??null,candidateRmstMs:b?.[field]?.restrictedMeanMs??null,
    reductionFraction:comparable&&a[field].restrictedMeanMs>0?(a[field].restrictedMeanMs-b[field].restrictedMeanMs)/a[field].restrictedMeanMs:null});
  return {scope:STUDIES.K15.scope,worlds:projected,comparable,reasons,firstUseful:endpoint('timeToFirstUsefulService'),sufficient:endpoint('timeToSufficientService'),
    modelEvidence:{candidateModels,referenceModels,sameActuallyObserved:candidateModels.length>0&&referenceModels.length>0&&digest(candidateModels)===digest(referenceModels)},
    note:'Completed recovered errors remain included. Physical receipts and deficit, not interpretations or proposal counts, measure benefit. Single-seed descriptive comparison; no population confidence interval.'};
}

export function semanticPilotReadout(raw,current,final){
  const cost=raw?{...providerCost({...raw,modelCalls:Array.isArray(raw.usage)?raw.usage.length:undefined}),chargedBudgetUsd:conservativeExposure(raw,STUDIES.K11_K13.episodeBudgetUsd)}:
    providerCost(null,{missing:true,cap:STUDIES.K11_K13.episodeBudgetUsd}),reasons=[];
  if(!raw)reasons.push('missing_raw_semantic_outcome');
  if(raw&&raw.status!=='completed')reasons.push('not_completed:'+raw.status);
  if(raw&&(!Array.isArray(raw.invariants)||raw.invariants.length))reasons.push('invariant_failure_or_missing');
  if(raw&&(raw.candidateFingerprint!==current.candidate||raw.evaluatorFingerprint!==current.evaluator||raw.candidateChanged!==false))reasons.push('child_source_mismatch');
  if(!final||['candidateChanged','evaluatorChanged','simulatorChanged'].some(k=>final[k]!==false))reasons.push('final_build_unknown_or_changed');
  if(cost.providerCalls!==null&&cost.providerCalls>STUDIES.K11_K13.maximumProviderAttemptsByCurrentLoop)reasons.push('predeclared_call_bound_exceeded');
  return {scope:STUDIES.K11_K13.scope,status:raw?.status??'missing',eligibleForInternalScoring:!reasons.length,reasons,
    initial:current,final,measurements:raw?.measurements??null,findings:raw?.findings??null,error:raw?.error??null,invariants:raw?.invariants??null,
    cost,legacyReportedCostUsd:raw?.costUsd??null,independentK12:'pending_external',providerAttemptBound:STUDIES.K11_K13.maximumProviderAttemptsByCurrentLoop,
    note:'Scoring uses the internally authored exact tuples, not the model grading itself. Missing/failed/rejected claims remain in denominators. No physical service or external multilingual accuracy claim.'};
}

export async function archiveStudies(){
  const childBytes=await readFile(STUDIES.K11_K13.sourceScript),plan={...STUDIES,sharedLock:SHARED_LOCK,childScriptSha256:sha256(childBytes)};
  const archive=await archiveProbe({names:['minimal-semantic-studies.mjs','minimal-semantic-studies.test.mjs','minimal-semantic-studies-guide.md',
    'evidence-probe-guards.mjs','read-human-capacity-evidence.mjs'],tag:'minimal-semantic-'+plan.childScriptSha256.slice(0,8),plan});
  const file=resolve(archive.folder,'semantic-load.mjs');try{await writeFile(file,childBytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||sha256(await readFile(file))!==plan.childScriptSha256)throw e;}
  return {...archive,childScriptSha256:plan.childScriptSha256};
}
async function runtime(){const [h,b]=await Promise.all([import('../evaluation/harness.mjs'),import('../evaluation/simulator-build.mjs')]);
  const current={candidateFingerprint:await h.buildFingerprint(),evaluatorFingerprint:await h.evaluatorFingerprint(),simulatorBuild:await b.requireLoadedSimulatorBuild()};return {h,b,current};}
const asReaderBuild=x=>({candidate:x.candidateFingerprint,evaluator:x.evaluatorFingerprint,simulator:x.simulatorBuild});
async function finalBuilds(lib){return lib.b.checkFinalBuilds(asReaderBuild(lib.current),{candidate:lib.h.buildFingerprint,evaluator:lib.h.evaluatorFingerprint});}

async function childSemantic(folder,shouldStop){
  const p=STUDIES.K11_K13,before=new Set(await readdir('reports/semantic').catch(e=>e.code==='ENOENT'?[]:Promise.reject(e))),log=[];
  const child=spawn(process.execPath,[p.sourceScript,`--needs=${p.needs}`,`--orgs=${p.organizations}`,`--copies=${p.copies}`,`--budget=${p.episodeBudgetUsd}`,`--seed=${p.seed}`],
    {cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},p.wallLimitMs);
  for(const pipe of [child.stdout,child.stderr])pipe.on('data',x=>{if(log.reduce((n,s)=>n+s.length,0)<131072)log.push(String(x));});
  const exit=await new Promise((yes,no)=>{child.once('error',no);child.once('exit',(code,signal)=>yes({code,signal}));}).finally(()=>clearTimeout(timer));
  await writeFile(resolve(folder,'child.log'),log.join(''),{flag:'wx'});
  const files=(await readdir('reports/semantic').catch(()=>[])).filter(f=>!before.has(f)&&f.endsWith('.json')&&!f.endsWith('-protocol.json'));
  if(files.length!==1)return {raw:null,exit,timedOut,files,operatorStop:await shouldStop()};
  const file=resolve('reports/semantic',files[0]),bytes=await readFile(file),raw=JSON.parse(bytes);
  await writeFile(resolve(folder,'raw-semantic.json'),bytes,{flag:'wx'});
  return {raw,rawFile:file,rawSha256:sha256(bytes),exit,timedOut,operatorStop:await shouldStop()};
}

export async function runPrepared(options={}) {
  if(!Object.hasOwn(STUDIES,options.kind))throw Error('Use kind K15 or K11_K13');
  const plan=STUDIES[options.kind];
  if(options.run!==plan.authorization)return {state:'prepared_not_launched',providerCalls:0,plan};
  admitStudy(options.kind,options.run);if(!options.freeze)throw Error('Explicit fresh full/UI freeze file required');
  const lib=await runtime(),freeze=JSON.parse(await readFile(resolve(options.freeze),'utf8'));validateProbeGate(freeze,lib.current);
  const archive=await archiveStudies(),nonce=randomUUID(),folder=resolve(options.folder??`reports/semantic-studies/${options.kind}-${Date.now()}`);
  const release=await acquireProbeLock(SHARED_LOCK,{nonce,pid:process.pid,study:options.kind,source:lib.current});
  let stopped=false;const onSignal=()=>{stopped=true;};process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  const stopFile=resolve(options['stop-file']??'.local/STOP_MINIMAL_SEMANTIC_STUDIES'),shouldStop=async()=>stopped||await exists(stopFile);
  try {
    if(await shouldStop())throw Object.assign(Error('Stop marker present'),{code:'OPERATOR_STOP'});
    await mkdir(folder,{recursive:true});await writeFile(resolve(folder,'protocol.json'),JSON.stringify({plan,archive,source:lib.current,
      sharedLock:SHARED_LOCK,declaredAt:new Date().toISOString(),noHumanCapacityReuse:true},null,2),{flag:'wx'});
    if(options.kind==='K15') {
      const {runDiscoveryEpisode}=await import('../evaluation/discovery-benchmark.mjs'),rows=[];let charged=0;
      for(const arm of plan.worlds) {
        if(await shouldStop())break;const check=await finalBuilds(lib);if(check.invalidStatus)break;
        reserveEpisode(charged,plan.episodeBudgetUsd,plan.totalBudgetUsd);
        let r;try{r=await runDiscoveryEpisode({...plan.config,seed:plan.seed,arm,candidateFingerprint:lib.current.candidateFingerprint,evaluatorBuild:lib.current.evaluatorFingerprint,
          shouldStop,onProgress:x=>console.log(JSON.stringify({phase:'progress',...x}))});r.cost=providerCost(r);}
        catch(e){r=missingOutcome(arm,plan.seed,plan.episodeBudgetUsd,e);}
        charged+=conservativeExposure(r,plan.episodeBudgetUsd);rows.push(r);
        await writeFile(resolve(folder,arm+'.json'),JSON.stringify(r,null,2),{flag:'wx'});
        if(r.status==='failed_missing_outcome'||r.candidateChanged||r.evaluatorChanged||r.simulatorChanged)break;
      }
      const result={plan,source:lib.current,chargedBudgetUsd:charged,missing:plan.worlds.filter(a=>!rows.some(r=>r.arm===a)),
        ...k15Readout(rows,asReaderBuild(lib.current)),final:await finalBuilds(lib)};
      await writeFile(resolve(folder,'summary.json'),JSON.stringify(result,null,2),{flag:'wx'});return {folder,...result};
    }
    const child=await childSemantic(folder,shouldStop),final=await finalBuilds(lib),result={plan,source:lib.current,
      child:{file:child.rawFile??null,sha256:child.rawSha256??null,exit:child.exit,timedOut:child.timedOut,operatorStop:child.operatorStop},
      ...semanticPilotReadout(child.raw,asReaderBuild(lib.current),final)};
    if(child.exit.code!==0||child.timedOut){result.eligibleForInternalScoring=false;result.reasons.push('child_failed_or_wall_limit');}
    await writeFile(resolve(folder,'summary.json'),JSON.stringify(result,null,2),{flag:'wx'});return {folder,...result};
  }finally{process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);await release();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf('=');return i<0?[s.replace(/^--/,''),true]:[s.slice(0,i).replace(/^--/,''),s.slice(i+1)];}));
  const r=options.archive?await archiveStudies():await runPrepared(options);
  console.log(JSON.stringify({folder:r.folder,state:r.state,runnerSha256:r.runnerSha256,planSha256:r.planSha256,comparable:r.comparable,
    eligibleForInternalScoring:r.eligibleForInternalScoring,missing:r.missing,reasons:r.reasons,cost:r.cost,firstUseful:r.firstUseful,sufficient:r.sufficient,providerCalls:r.providerCalls}));
}
