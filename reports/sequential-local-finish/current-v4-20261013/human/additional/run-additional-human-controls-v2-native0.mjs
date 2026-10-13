/** Ignored queue adapter. Unsupported scenario parameters fail before execution. */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {validateAdditionalNative0File} from './additional-native0-v2-guards.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildFingerprint,evaluatorFingerprint} from '../evaluation/harness.mjs';
import {requireLoadedSimulatorBuild} from '../evaluation/simulator-build.mjs';
import {runHumanCapacityEpisode,humanCapacityEvaluatorFingerprint,summarizeHumanCapacity} from '../evaluation/human-capacity-benchmark.mjs';
import {validateHumanCampaignGate,withHumanResearchLock,failedHumanCapacityWorld} from '../scripts/human-capacity-campaign.mjs';
import {adapterFee,nativeConfigurationAudit} from './run-read-relay-error-amendment-v2.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
const parse=async path=>{const bytes=await readFile(resolve(path));return {path:resolve(path),bytes,
  sha256:digest(bytes),data:JSON.parse(bytes.toString('utf8'))};};
const ids=['formal_immediate','silent_loss','burst'];
const cap=.15;
const sameSource=(a,b)=>['candidate','baseEvaluator','humanEvaluator','simulator'].every(k=>a?.[k]===b?.[k]);
const key=w=>[w.condition,w.seed,w.arm].join(':');
async function currentSource(){return {candidate:await buildFingerprint(),baseEvaluator:await evaluatorFingerprint(),
  humanEvaluator:await humanCapacityEvaluatorFingerprint(),simulator:await requireLoadedSimulatorBuild()};}

export function selectAdditionalGroups(plan,selection){
  const selected=selection?selection.split(','):ids;
  if(new Set(selected).size!==selected.length||!selected.length||selected.some(id=>!ids.includes(id)))
    throw Error('Only exact predeclared unique group IDs permitted');
  const groups=selected.map(id=>plan.groups.find(g=>g.id===id));
  if(groups.some(g=>!g||!g.execution?.apiSupported||g.state==='BLOCKED_API_UNSUPPORTED'))
    throw Error('silent_loss is BLOCKED_API_UNSUPPORTED: the frozen human API would ignore.25/.05; default all3 selection cannot launch any world');
  return groups;
}

export async function validateAdditionalPlan(plan,{sha256,current,expectedSha}={}){
  await validateAdditionalNative0File(plan,{sha256,expectedSha,current});
  if(sha256!==expectedSha||plan?.schema!=='additional-human-controls-before-own-outcomes-v1'||
    !sameSource(plan.sourceAtDeclaration,current)||plan.declaredWorlds!==9||plan.worlds?.length!==9||
    plan.maximumPaidEpisodes!==3||plan.maximumReservedUsd!==.45||plan.maxModelCallsPerPaidEpisode!==16||
    plan.groups?.map(g=>g.id).join(',')!==ids.join(','))
    throw Error('Exact archived additional-control plan and unchanged source required');
  for(const g of plan.groups){
    if(g.worlds?.length!==3||g.worlds.map(w=>w.arm).join(',')!=='C_manual,B8,B6'||
      g.execution.episodeCapUsd!==cap||g.execution.modelCallsCap!==16||g.execution.worldConcurrency!==1||
      g.nativeConfigurationPerOwner.readErrorBp!==0||g.nativeConfigurationPerOwner.decisionErrorBp!==0||
      g.nativeConfigurationPerOwner.relayErrorBp!==0)
      throw Error('Strong-reference arms or error0 native parameters changed');
  }
  const silent=plan.groups.find(g=>g.id==='silent_loss');
  if(silent.state!=='BLOCKED_API_UNSUPPORTED'||silent.execution.episodeInputs!==null||
    silent.desiredNativeScenario.silentFraction!==.25||silent.desiredNativeScenario.packetLoss!==.05)
    throw Error('Unsupported silent/loss controls cannot be silently substituted');
  return true;
}

export function scenarioAudit(group,result){
  const actual={formalDelayMs:result?.corpus?.config?.formalDelayMs??null,
    silentFraction:result?.corpus?.config?.silentFraction??null,
    packetLoss:result?.manifest?.config?.packetLoss??null};
  return {expected:group.desiredNativeScenario,actual,
    matches:Object.entries(group.desiredNativeScenario).every(([k,v])=>actual[k]===v),
    note:'Post-execution source configuration audit only; nothing from private demand or gold is passed to the controller.'};
}

export function additionalClosure(rows,plan,selectedGroups){
  const summary=summarizeHumanCapacity(rows,plan.worlds);
  const selected=new Set(selectedGroups.flatMap(g=>g.worlds.map(key)));
  const selectedMissing=selectedGroups.flatMap(g=>g.worlds).filter(w=>!rows.some(r=>key(r)===key(w)));
  const selectedRows=rows.filter(r=>selected.has(key(r)));
  const pairs=summary.comparisons.filter(p=>['C_manual','B8'].includes(p.reference));
  const expectedPairs=selectedGroups.length*2;
  return {...summary,requestedGroupIds:selectedGroups.map(g=>g.id),requestedWorlds:selected.size,
    missingRequestedWorlds:selectedMissing,plannedComparisons:pairs,
    unplannedReferenceComparisons:summary.comparisons.filter(p=>!['C_manual','B8'].includes(p.reference)),
    allSelectedPairsComparable:selectedRows.length===selected.size&&selectedMissing.length===0&&
      selectedRows.every(r=>r.status==='completed')&&pairs.length===expectedPairs&&pairs.every(p=>p.comparable),
    allDeclaredWorldsComplete:summary.observedRuns===9&&summary.missingRuns.length===0&&summary.failedOrStoppedRuns===0,
    blockedGroupIds:plan.groups.filter(g=>!g.execution.apiSupported).map(g=>g.id),
    note:'Nine declared worlds remain the full denominator, even when only supported groups are explicitly requested. B5/decentralized are not planned here; primary B5 stays the strong reference. Keep negative, recovered-error and censored outcomes.'};
}

export async function runAdditionalControls(options={}){
  if(options.run!=='ROOT_GO_ADDITIONAL_HUMAN_CONTROLS_V2_NATIVE0')return {state:'PREPARED_NOT_LAUNCHED',
    worldsStarted:0,modelCalls:0,declaredWorlds:9,maximumReservedUsd:.45,
    supportedGroups:['formal_immediate','burst'],blockedGroups:['silent_loss'],
    note:'Default all3selection refuses unsupported silent/loss before launching; explicit supported subset still retains pending planned worlds.'};
  for(const field of ['plan','freeze'])if(!options[field])throw Error('Explicit --'+field+' required');
  const declared=await parse(options.plan),source=await currentSource();
  await validateAdditionalPlan(declared.data,{sha256:declared.sha256,current:source,expectedSha:options['plan-sha']});
  const groups=selectAdditionalGroups(declared.data,options.groups),freeze=await parse(options.freeze);
  validateHumanCampaignGate(freeze.data,{candidate:source.candidate,baseEvaluator:source.baseEvaluator,simulator:source.simulator});
  const lock=resolve('.local/PAID_RESEARCH_STUDY.lock');
  if(options.lock&&resolve(options.lock)!==lock)throw Error('Universal research lock required');
  const stopFile=resolve(options['stop-file']??'.local/STOP_ADDITIONAL_HUMAN_CONTROLS_V2_NATIVE0');
  const folder=resolve(options.folder??'reports/human-capacity-additional-controls/'+Date.now());
  return withHumanResearchLock(lock,{study:'additional-human-controls',nonce:randomUUID(),pid:process.pid,source},async()=>{
    await mkdir(folder,{recursive:true});
    const archives=[];
    for(const [name,path]of [['run-additional-human-controls-v2-native0.mjs',fileURLToPath(import.meta.url)],
      ['run-read-relay-error-amendment.mjs','.local/run-read-relay-error-amendment.mjs'],
      ['human-capacity-benchmark.mjs','evaluation/human-capacity-benchmark.mjs'],
      ['human-capacity-campaign.mjs','scripts/human-capacity-campaign.mjs']]){
      const bytes=await readFile(resolve(path));await writeFile(resolve(folder,name),bytes,{flag:'wx'});
      archives.push({source:resolve(path),archive:name,sha256:digest(bytes)});}
    const protocol={...declared.data,adapterDeclaredAt:new Date().toISOString(),
      authorization:'ROOT_GO_ADDITIONAL_HUMAN_CONTROLS_V2_NATIVE0',source,
      plan:{path:declared.path,sha256:declared.sha256},freeze:{path:freeze.path,sha256:freeze.sha256},
      requestedGroups:groups.map(g=>g.id),universalLock:lock,stopFile,archives,
      worldConcurrency:1,paidConcurrency:1,unrequestedDeclaredWorlds:declared.data.groups.filter(g=>!groups.includes(g)).flatMap(g=>g.worlds)};
    await writeFile(resolve(folder,'protocol.json'),JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
    await writeFile(resolve(folder,'amendment-plan.json'),declared.bytes,{flag:'wx'});
    await writeFile(resolve(folder,'freeze.json'),freeze.bytes,{flag:'wx'});
    const rows=[],issued=[];let charged=0,stop=null,interrupted=false;
    const closure=()=>{const c=additionalClosure(rows,declared.data,groups),verified=issued.length===c.requestedWorlds&&
      issued.every(i=>i.nativeConfiguration?.matches===true&&i.scenario?.matches===true);
      return {...c,allSelectedPairsComparable:c.allSelectedPairsComparable&&verified,actualNativeConfigurationsVerified:verified};};
    const index=async()=>writeFile(resolve(folder,'index.json'),JSON.stringify({recordedAt:new Date().toISOString(),source,
      issued,chargedBudgetUsd:charged,stoppedReason:stop,
      unsettledReservedUsd:issued.filter(i=>i.state==='started'&&i.arm==='B6').length*cap,summary:closure()},null,2)+'\n');
    await index();
    const onSignal=()=>{interrupted=true;console.log(JSON.stringify({phase:'stopping_after_settled_provider_boundary'}));};
    const shouldStop=async()=>{if(interrupted)return true;try{await access(stopFile);return true;}
      catch(e){if(e.code!=='ENOENT')throw e;return false;}};
    process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
    try{
      outer:for(const group of groups)for(let at=0;at<group.worlds.length;at++){
        const world=group.worlds[at],inputs=group.execution.episodeInputs[at];
        if(await shouldStop()){stop='operator_stop';break outer;}
        if(!sameSource(await currentSource(),source)){stop='source_changed';break outer;}
        if(world.arm==='B6'&&charged+cap>.45){stop='conservative_budget';break outer;}
        const record={group:group.id,...world,state:'started',startedAt:new Date().toISOString(),reservedCapUsd:world.arm==='B6'?cap:0};
        issued.push(record);await index();console.log(JSON.stringify({phase:'started',folder,world}));
        let result;const started=performance.now();
        try{result=await runHumanCapacityEpisode({...inputs,shouldStop,onProgress:p=>console.log(JSON.stringify({phase:'progress',...p}))});}
        catch(error){result=failedHumanCapacityWorld({world,config:inputs,source:{...source,evaluator:source.humanEvaluator},
          cap,error,wallMs:performance.now()-started});stop='unhandled_episode_failure';}
        const accounting=adapterFee(world,result);charged+=accounting.chargedBudgetUsd;rows.push(result);
        const path=resolve(folder,`${world.condition}-${world.seed}-${world.arm}.json`),bytes=JSON.stringify(result,null,2)+'\n';
        await writeFile(path,bytes,{flag:'wx'});Object.assign(record,{state:'settled',finishedAt:new Date().toISOString(),
          status:result.status,path,sha256:digest(bytes),accounting,nativeConfiguration:nativeConfigurationAudit(group,result),
          scenario:scenarioAudit(group,result)});
        if(accounting.forbiddenReferenceInference)stop='reference_inference_contract_violation';
        if(result.status==='completed'&&(record.nativeConfiguration.matches!==true||record.scenario.matches!==true))stop='actual_configuration_mismatch';
        if(result.candidateChanged||result.evaluatorChanged||result.simulatorChanged)stop='source_changed';
        if(charged>.45)stop='actual_or_conservative_budget_exceeded';
        await index();await writeFile(resolve(folder,'summary.json'),JSON.stringify({...closure(),source,folder,issued,
          chargedBudgetUsd:charged,stoppedReason:stop},null,2)+'\n');
        console.log(JSON.stringify({phase:'settled',group:group.id,arm:world.arm,status:result.status,accounting,errors:result.errors}));
        if(stop||result.failedBeforeFinalReport)break outer;
      }
      const summary={...closure(),source,folder,issued,chargedBudgetUsd:charged,stoppedReason:stop};
      await index();await writeFile(resolve(folder,'summary.json'),JSON.stringify(summary,null,2)+'\n');return summary;
    }finally{process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);}
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=Object.fromEntries(process.argv.slice(2).map(a=>{const at=a.indexOf('=');
    return at<0?[a.replace(/^--/,''),true]:[a.slice(2,at),a.slice(at+1)];}));
  const result=await runAdditionalControls(options);console.log(JSON.stringify(result,null,2));
  if(result.stoppedReason||result.failedOrStoppedRuns||result.allSelectedPairsComparable===false)process.exitCode=1;
}
