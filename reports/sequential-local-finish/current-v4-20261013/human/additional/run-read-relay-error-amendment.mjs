/** Ignored bounded adapter. No episode runs without its explicit root GO. */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildFingerprint,evaluatorFingerprint} from '../evaluation/harness.mjs';
import {requireLoadedSimulatorBuild} from '../evaluation/simulator-build.mjs';
import {runHumanCapacityEpisode,summarizeHumanCapacity,humanCapacityEvaluatorFingerprint,reconcileUsage} from '../evaluation/human-capacity-benchmark.mjs';
import {validateHumanCampaignGate,withHumanResearchLock,failedHumanCapacityWorld} from '../scripts/human-capacity-campaign.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
const json=async path=>{const bytes=await readFile(resolve(path));return {path:resolve(path),bytes,
  sha256:digest(bytes),data:JSON.parse(bytes.toString('utf8'))};};
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const condition='moderate_read_relay_1pct_review0';
const arms=['C_manual','B5','B8','B6'];
const planSha256='bb542915bb5cdf280a8b5bed5e43568016ecc45f41cbeaddae0272673aee6058';
const seed='native-human-capacity-control-read-relay-error-01';
const cap=.15;
const sourceEqual=(a,b)=>['candidate','baseEvaluator','humanEvaluator','simulator'].every(k=>a?.[k]===b?.[k]);
async function currentSource(){return {candidate:await buildFingerprint(),baseEvaluator:await evaluatorFingerprint(),
  humanEvaluator:await humanCapacityEvaluatorFingerprint(),simulator:await requireLoadedSimulatorBuild()};}

/** Explicitly rejects the CLI's all-stage error configuration and new limits. */
export function validateReadRelayPlan(plan,{sha256,current}={}){
  if(sha256!==planSha256||plan?.schema!=='read-relay-error-amendment-before-outcomes-v1'||
    plan.state!=='PREDECLARED_NOT_LAUNCHED'||!sourceEqual(plan.sourceAtDeclaration,current))
    throw Error('Exact archived stage-error amendment and unchanged source required');
  if(plan.execution?.api!=='runHumanCapacityEpisode'||plan.execution.paidEpisodes!==1||
    plan.execution.maximumConcurrency!==1||plan.execution.maximumReservedUsd!==cap||
    plan.execution.episodeCapUsd!==cap||plan.execution.callsPerPaidEpisode!==16||
    plan.totalBudgetUsd!==cap||plan.episodeBudgetUsd!==cap||plan.arms?.join(',')!==arms.join(',')||
    plan.historicalControl?.state!=='BLOCKED_NOT_LAUNCHED')
    throw Error('Declared arms, limits or historical block changed');
  const expectedConfig={count:24,noise:192,reposts:2,formalDelayMs:1800000,horizonMs:10800000,
    grid:9,extentKm:6,pumpMs:60000,clarificationWorkers:2,wallLimitMs:900000,budgetUsd:cap,maxModelCalls:16};
  if(Object.keys(plan.config??{}).length!==Object.keys(expectedConfig).length||
    Object.entries(expectedConfig).some(([k,v])=>plan.config[k]!==v))
    throw Error('Physical or provider configuration changed');
  if(plan.worlds?.length!==4||plan.execution.episodeInputs?.length!==4)
    throw Error('All four strong-reference worlds must remain declared');
  const rates={readers:2,deciders:2,relayers:1,readErrorBp:100,decisionErrorBp:0,relayErrorBp:100};
  for(let index=0;index<arms.length;index++){
    const world=plan.worlds[index],input=plan.execution.episodeInputs[index];
    if(world.arm!==arms[index]||world.profile!=='moderate'||world.condition!==condition||world.seed!==seed||
      Object.keys(world.humanCapacityOverrides??{}).length!==Object.keys(rates).length||
      Object.entries(rates).some(([k,v])=>world.humanCapacityOverrides[k]!==v))
      throw Error('Symmetric read/relay rates with zero decision/review required');
    const exact={...expectedConfig,...world,candidateFingerprint:current.candidate,evaluatorBuild:current.humanEvaluator};
    if(JSON.stringify(input)!==JSON.stringify(exact))throw Error('Archived API invocation changed');
  }
  if(plan.nativeConfigurationPerOwner?.decisionErrorBp!==0||
    plan.conditions?.[condition]?.ownerReviewErrorBpDerivedFromDecision!==0)
    throw Error('Native owner-review rate must remain zero');
  return true;
}

/** Raw outcome fields remain untouched; independent accounting stays separate. */
export function adapterFee(world,result){
  const ledger=Array.isArray(result?.usage)&&result.usageMissing!==true?result.usage:null;
  const accountingLedger=ledger?.map(row=>({...row,
    reserved_usd:row.cost_usd==null&&(row.reserved_usd==null||!finite(Number(row.reserved_usd)))?cap:row.reserved_usd}));
  const reconciled=reconcileUsage(accountingLedger??null,cap);
  if(world.arm!=='B6')return {...reconciled,chargedBudgetUsd:0,
    referencePaidContract:'Provider rejects all reference inference; unknown native ledger is still unknown.',
    forbiddenReferenceInference:reconciled.modelCalls!=null&&reconciled.modelCalls>0};
  return {...reconciled,chargedBudgetUsd:Math.max(reconciled.chargedBudgetUsd,
    finite(result?.chargedBudgetUsd)?result.chargedBudgetUsd:0),
    declaredCapUsd:cap,missingLedgerRetainsFullCap:ledger===null};
}

export function amendmentClosure(rows,planned){
  const summary=summarizeHumanCapacity(rows,planned);
  const comparisons=summary.comparisons.filter(c=>['C_manual','B5','B8'].includes(c.reference));
  const missingUnplanned=summary.comparisons.filter(c=>c.reference==='C_decentralized');
  const complete=summary.observedRuns===4&&summary.declaredRuns===4&&summary.missingRuns.length===0;
  return {...summary,plannedComparisons:comparisons,unplannedComparisons:missingUnplanned,
    allPlannedPairsComparable:complete&&summary.failedOrStoppedRuns===0&&comparisons.length===3&&comparisons.every(c=>c.comparable),
    note:'All four declared arms, losses, recovered errors and censoring are retained. The absent decentralized arm remains explicitly unplanned, not silently compared. This sensitivity excludes decision/review attention lapses.'};
}

export function nativeConfigurationAudit(plan,result){
  const actual=result?.manifest?.config?.humanCapacity??null;
  return {expected:plan.nativeConfigurationPerOwner,actual,
    matches:actual===null?null:Object.entries(plan.nativeConfigurationPerOwner).every(([k,v])=>actual[k]===v),
    ownerReviewErrorBp:actual?.decisionErrorBp??null,
    note:'Actual source manifest configuration, not the CLI global error heading; same profile applies to every owner.'};
}

export async function runReadRelayAmendment(options={}){
  if(options.run!=='ROOT_GO_READ_RELAY_ERROR')return {state:'PREPARED_NOT_LAUNCHED',worldsStarted:0,
    modelCalls:0,maximumPaidEpisodes:1,maximumReservedUsd:cap,arms,
    condition,readErrorBp:100,relayErrorBp:100,decisionErrorBp:0,nativeOwnerReviewErrorBp:0,
    originalError1pct:'BLOCKED_NOT_LAUNCHED',requires:'Exact archived plan/current full+UI freeze/root GO/universal lock'};
  for(const field of ['plan','freeze'])if(!options[field])throw Error('Explicit --'+field+' required');
  const declared=await json(options.plan),freeze=await json(options.freeze),source=await currentSource();
  validateReadRelayPlan(declared.data,{sha256:declared.sha256,current:source});
  validateHumanCampaignGate(freeze.data,{candidate:source.candidate,baseEvaluator:source.baseEvaluator,simulator:source.simulator});
  const lock=resolve('.local/PAID_RESEARCH_STUDY.lock');
  if(options.lock&&resolve(options.lock)!==lock)throw Error('Universal research lock required');
  const stopFile=resolve(options['stop-file']??'.local/STOP_READ_RELAY_ERROR_AMENDMENT');
  const folder=resolve(options.folder??'reports/human-capacity-read-relay-error/'+Date.now());
  const metadata={study:'read-relay-error-amendment',nonce:randomUUID(),pid:process.pid,source};
  return withHumanResearchLock(lock,metadata,async()=>{
    await mkdir(folder,{recursive:true});
    const wrapperBytes=await readFile(new URL(import.meta.url)),benchmarkBytes=await readFile('evaluation/human-capacity-benchmark.mjs'),
      campaignBytes=await readFile('scripts/human-capacity-campaign.mjs');
    const protocol={...declared.data,schema:'read-relay-error-api-adapter-v1',adapterDeclaredAt:new Date().toISOString(),
      source,amendment:{path:declared.path,sha256:declared.sha256},freeze:{path:freeze.path,sha256:freeze.sha256},
      authorization:'ROOT_GO_READ_RELAY_ERROR',worldsStarted:0,modelCalls:0,
      wrapperSha256:digest(wrapperBytes),benchmarkSha256:digest(benchmarkBytes),campaignSha256:digest(campaignBytes),
      executionAdapter:{api:'runHumanCapacityEpisode',maximumConcurrency:1,universalLock:lock,stopFile,
        finiteOwnerReviewRetained:true,ownerReviewRateDerivedFromDecision:0},
      attribution:'New communication/reading sensitivity, not the historical all-stage1% condition. No global100bp label; actual stage-specific native config is recorded per world.'};
    // Exact wrapper, plan and freeze bytes are retained before an episode.
    for(const [name,bytes]of[['protocol.json',JSON.stringify(protocol,null,2)+'\n'],['amendment-plan.json',declared.bytes],
      ['freeze.json',freeze.bytes],['run-read-relay-error-amendment.mjs',wrapperBytes],
      ['human-capacity-benchmark.mjs',benchmarkBytes],['human-capacity-campaign.mjs',campaignBytes]])
      await writeFile(resolve(folder,name),bytes,{flag:'wx'});
    const rows=[],issued=[];let charged=0,stop=null,interrupted=false;
    const closure=()=>{const pair=amendmentClosure(rows,declared.data.worlds),
      nativeVerified=issued.length===4&&issued.every(i=>i.nativeConfiguration?.matches===true);
      return {...pair,allPlannedPairsComparable:pair.allPlannedPairsComparable&&nativeVerified,
        nativeConfigurationVerified:nativeVerified};};
    const index=async()=>writeFile(resolve(folder,'index.json'),JSON.stringify({recordedAt:new Date().toISOString(),
      source,protocol:resolve(folder,'protocol.json'),issued,chargedBudgetUsd:charged,stoppedReason:stop,
      unsettledReservedUsd:issued.filter(i=>i.state==='started'&&i.arm==='B6').length*cap,
      plannedWorlds:declared.data.worlds,missingWorlds:declared.data.worlds.filter(w=>!rows.some(r=>r.arm===w.arm)),
      summary:closure()},null,2)+'\n');
    await index();
    const onSignal=()=>{interrupted=true;console.log(JSON.stringify({phase:'stopping_after_settled_provider_boundary'}));};
    const shouldStop=async()=>{if(interrupted)return true;try{await access(stopFile);return true;}
      catch(e){if(e.code!=='ENOENT')throw e;return false;}};
    process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
    try{
      for(let at=0;at<declared.data.worlds.length;at++){
        const world=declared.data.worlds[at],inputs=declared.data.execution.episodeInputs[at];
        if(await shouldStop()){stop='operator_stop';break;}
        if(!sourceEqual(await currentSource(),source)){stop='source_changed';break;}
        if(world.arm==='B6'&&charged+cap>cap){stop='conservative_budget';break;}
        const record={arm:world.arm,seed:world.seed,condition:world.condition,state:'started',startedAt:new Date().toISOString(),
          reservedCapUsd:world.arm==='B6'?cap:0};issued.push(record);await index();
        console.log(JSON.stringify({phase:'started',folder,world}));
        let result;const started=performance.now();
        try{result=await runHumanCapacityEpisode({...inputs,shouldStop,
          onProgress:p=>console.log(JSON.stringify({phase:'progress',...p}))});}
        catch(error){result=failedHumanCapacityWorld({world,config:inputs,
          source:{...source,evaluator:source.humanEvaluator},cap,error,wallMs:performance.now()-started});
          stop='unhandled_episode_failure';}
        const fee=adapterFee(world,result);charged+=fee.chargedBudgetUsd;rows.push(result);
        const path=resolve(folder,`${world.condition}-${world.seed}-${world.arm}.json`);
        const raw=JSON.stringify(result,null,2)+'\n';await writeFile(path,raw,{flag:'wx'});
        Object.assign(record,{state:'settled',finishedAt:new Date().toISOString(),status:result.status,
          path,sha256:digest(raw),accounting:fee,nativeConfiguration:nativeConfigurationAudit(declared.data,result)});
        if(fee.forbiddenReferenceInference)stop='reference_inference_contract_violation';
        if(result.status==='completed'&&record.nativeConfiguration.matches!==true)stop='native_stage_configuration_unconfirmed';
        if(result.candidateChanged||result.evaluatorChanged||result.simulatorChanged)stop='source_changed';
        if(charged>cap)stop='actual_or_conservative_budget_exceeded';
        await index();await writeFile(resolve(folder,'summary.json'),JSON.stringify({
          ...closure(),source,folder,issued,chargedBudgetUsd:charged,stoppedReason:stop},null,2)+'\n');
        console.log(JSON.stringify({phase:'settled',arm:world.arm,status:result.status,costUsd:result.costUsd,
          errors:result.errors,accounting:fee}));
        if(stop||result.failedBeforeFinalReport)break;
      }
      const summary={...closure(),source,folder,issued,
        chargedBudgetUsd:charged,stoppedReason:stop};
      await index();await writeFile(resolve(folder,'summary.json'),JSON.stringify(summary,null,2)+'\n');return summary;
    }finally{process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);}
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=Object.fromEntries(process.argv.slice(2).map(a=>{const at=a.indexOf('=');
    return at<0?[a.replace(/^--/,''),true]:[a.slice(2,at),a.slice(at+1)];}));
  const result=await runReadRelayAmendment(options);console.log(JSON.stringify(result,null,2));
  if(result.stoppedReason||result.failedOrStoppedRuns||result.allPlannedPairsComparable===false)process.exitCode=1;
}
