/** New ignored runner: the only native change is common HOST3600 for the three burst arms. */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SOURCE,ORIGINAL_ADDITIONAL_SHA,validateBurstHostPlan,validateReceivedGroup,sameSource,key} from './human-burst-recovery-v4-guards.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async path=>{const bytes=await readFile(resolve(path));return {path:resolve(path),bytes,sha256:sha(bytes),data:JSON.parse(bytes)};};
const originalPath='.local/additional-native0-v2-prepared-1791878371781/plan.json';
export const ROOT_GO='ROOT_GO_BURST_HOST3600_RECOVERY_V4';
async function current(){const [{buildFingerprint,evaluatorFingerprint},{humanCapacityEvaluatorFingerprint},{requireLoadedSimulatorBuild}]=await Promise.all([
  import('../evaluation/harness.mjs'),import('../evaluation/human-capacity-benchmark.mjs'),import('../evaluation/simulator-build.mjs')]);
  return {candidate:await buildFingerprint(),baseEvaluator:await evaluatorFingerprint(),humanEvaluator:await humanCapacityEvaluatorFingerprint(),simulator:await requireLoadedSimulatorBuild()};}
export async function run(o={}){
  if(o.run!==ROOT_GO)return {state:'PREPARED_NOT_LAUNCHED',worldsStarted:0,modelCalls:0};
  for(const k of ['plan','plan-sha','freeze','folder'])if(!o[k])throw Error('EXPLICIT_'+k.toUpperCase()+'_REQUIRED');
  const prepared=await json(o.plan),original=await json(originalPath),freeze=await json(o.freeze),source=await current();
  if(prepared.sha256!==o['plan-sha']||original.sha256!==ORIGINAL_ADDITIONAL_SHA||!sameSource(source))throw Error('EXACT_PLAN_SOURCE_REQUIRED');
  validateBurstHostPlan(prepared.data,original.data);
  const {runHumanCapacityEpisode,summarizeHumanCapacity}=await import('../evaluation/human-capacity-benchmark.mjs'),
    {validateHumanCampaignGate,withHumanResearchLock,failedHumanCapacityWorld}=await import('../scripts/human-capacity-campaign.mjs'),
    {adapterFee,nativeConfigurationAudit}=await import('./run-read-relay-error-amendment-v2.mjs'),
    {scenarioAudit}=await import('./run-additional-human-controls-v2-native0.mjs');
  validateHumanCampaignGate(freeze.data,source);
  const group=prepared.data.group,folder=resolve(o.folder),lock=resolve('.local/PAID_RESEARCH_STUDY.lock'),
    stopFile=resolve('.local/STOP_BURST_HOST3600_RECOVERY_V4');
  return withHumanResearchLock(lock,{study:'burst-common-host3600-v4',source,nonce:randomUUID(),pid:process.pid},async()=>{
    await mkdir(folder,{recursive:false});
    for(const [name,bytes]of [['protocol.json',JSON.stringify({...prepared.data,planSha256:prepared.sha256,authorization:ROOT_GO},null,2)+'\n'],
      ['burst-plan.json',prepared.bytes],['run-burst-host3600-recovery-v4.mjs',await readFile(fileURLToPath(import.meta.url))],
      ['human-capacity-benchmark.mjs',await readFile('evaluation/human-capacity-benchmark.mjs')],
      ['human-capacity-campaign.mjs',await readFile('scripts/human-capacity-campaign.mjs')]])await writeFile(resolve(folder,name),bytes,{flag:'wx'});
    const rows=[],issued=[];let charged=0,stoppedReason=null,interrupted=false;
    const signal=()=>{interrupted=true;console.log(JSON.stringify({phase:'stopping_after_settled_provider_boundary'}));};
    const shouldStop=async()=>{if(interrupted)return true;try{await access(stopFile);return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}};
    const closure=()=>{
      let valid=false,reasons=[];try{validateReceivedGroup(rows,group.execution.episodeInputs,{wallMs:3600000,arms:['C_manual','B8','B6']});
        valid=issued.length===3&&issued.every(r=>r.nativeConfiguration?.matches===true&&r.scenario?.matches===true);}catch(e){reasons.push(e.message);}
      const summary=summarizeHumanCapacity(rows,group.worlds),comparisons=summary.comparisons.filter(c=>['C_manual','B8'].includes(c.reference));
      valid=valid&&comparisons.length===2&&comparisons.every(c=>c.comparable===true);
      return {...summary,source,comparisons,allThreeCurrentComparable:valid,reasons,statisticalPoolingAllowed:false};};
    const checkpoint=async()=>writeFile(resolve(folder,'index.json'),JSON.stringify({source,issued,chargedBudgetUsd:charged,stoppedReason,
      unsettledReservedUsd:issued.filter(r=>r.state==='started'&&r.arm==='B6').length*.15,summary:closure()},null,2)+'\n');
    await checkpoint();process.on('SIGINT',signal);process.on('SIGTERM',signal);
    try{for(let i=0;i<3;i++){
      const world=group.worlds[i],inputs=group.execution.episodeInputs[i];
      if(await shouldStop()){stoppedReason='operator_stop';break;}
      if(!sameSource(await current())){stoppedReason='source_changed';break;}
      if(world.arm==='B6'&&charged+.15>.15){stoppedReason='conservative_budget';break;}
      const rec={...world,state:'started',reservedCapUsd:world.arm==='B6'?.15:0,startedAt:new Date().toISOString()};issued.push(rec);await checkpoint();
      console.log(JSON.stringify({phase:'started',world}));const started=performance.now();let result;
      try{result=await runHumanCapacityEpisode({...inputs,shouldStop,onProgress:p=>console.log(JSON.stringify({phase:'progress',...p}))});}
      catch(error){result=failedHumanCapacityWorld({world,config:inputs,source:{...source,evaluator:source.humanEvaluator},cap:.15,error,wallMs:performance.now()-started});stoppedReason='unhandled_episode_failure';}
      const fee=adapterFee(world,result),bytes=JSON.stringify(result,null,2)+'\n',path=resolve(folder,`${world.condition}-${world.seed}-${world.arm}.json`);
      charged+=fee.chargedBudgetUsd;rows.push(result);await writeFile(path,bytes,{flag:'wx'});
      Object.assign(rec,{state:'settled',finishedAt:new Date().toISOString(),path,sha256:sha(bytes),status:result.status,accounting:fee,
        nativeConfiguration:nativeConfigurationAudit(group,result),scenario:scenarioAudit(group,result)});
      if(fee.forbiddenReferenceInference)stoppedReason='reference_inference_contract_violation';
      if(result.status==='completed'&&(rec.nativeConfiguration.matches!==true||rec.scenario.matches!==true))stoppedReason='actual_configuration_mismatch';
      if(!sameSource(await current())||result.candidateChanged||result.evaluatorChanged||result.simulatorChanged)stoppedReason='source_changed';
      if(charged>.15)stoppedReason='conservative_budget_exceeded';
      await checkpoint();await writeFile(resolve(folder,'summary.json'),JSON.stringify({...closure(),chargedBudgetUsd:charged,stoppedReason},null,2)+'\n');
      console.log(JSON.stringify({phase:'settled',arm:world.arm,status:result.status,accounting:fee,errors:result.errors}));
      if(stoppedReason||result.failedBeforeFinalReport)break;
    }
    const summary={...closure(),chargedBudgetUsd:charged,stoppedReason};await checkpoint();await writeFile(resolve(folder,'summary.json'),JSON.stringify(summary,null,2)+'\n');
    return {folder,...summary};
    }finally{process.off('SIGINT',signal);process.off('SIGTERM',signal);}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const o=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return [a.slice(2,i<0?undefined:i),i<0?true:a.slice(i+1)];}));
  const r=await run(o);console.log(JSON.stringify(r,null,2));if(r.stoppedReason||r.allThreeCurrentComparable===false)process.exitCode=1;
}
