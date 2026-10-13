import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const options=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return[a.slice(2,i<0?undefined:i),i<0?true:a.slice(i+1)];}));
const pins={"candidate":"2a9c64640f12fb0b6eee1f5d5215161cb7f9f096fa77b81e44e949039b2f6040","baseEvaluator":"19e0a3b9f67a7906d1717b83ca648a28a97ccf57e474982c35f59ab068cf3aba","evaluator":"228caacb6500adb6e46db7235bba13cf8eb53ae291d7b8bab8dfdc197122ea46"};
const seed='native-human-capacity-primary-01',worlds=['C_manual','B6'].map(arm=>({arm,profile:'moderate',condition:'moderate',seed}));
const common={count:24,noise:192,reposts:2,formalDelayMs:1800000,horizonMs:10800000,grid:9,extentKm:6,pumpMs:60000,clarificationWorkers:2,maxModelCalls:16,budgetUsd:.15,wallLimitMs:900000,humanCapacityOverrides:{readers:2,deciders:2,relayers:1,readErrorBp:0,decisionErrorBp:0,relayErrorBp:0}};
if(options.run!=='ROOT_GO_FINAL_TWO_RESPONSE'){console.log(JSON.stringify({state:'PREPARED_NOT_LAUNCHED',worlds,common}));process.exit(0);}
if(!process.env.OPENROUTER_API_KEY)throw Error('Provider key must be supplied by the local environment; no key is printed.');
if(process.env.MODEL_ID && process.env.MODEL_ID !== 'google/gemma-4-31b-it')throw Error('This fixed comparison profile requires Gemma 4.');
const [{buildFingerprint,evaluatorFingerprint},{requireLoadedSimulatorBuild},{runHumanCapacityEpisode,humanCapacityEvaluatorFingerprint,summarizeHumanCapacity},{withHumanResearchLock,failedHumanCapacityWorld}]=await Promise.all([
 import('../evaluation/harness.mjs'),import('../evaluation/simulator-build.mjs'),import('../evaluation/human-capacity-benchmark.mjs'),import('../scripts/human-capacity-campaign.mjs')]);
const current=async()=>({candidate:await buildFingerprint(),baseEvaluator:await evaluatorFingerprint(),evaluator:await humanCapacityEvaluatorFingerprint(),simulator:await requireLoadedSimulatorBuild()});
const initial=await current();
if(Object.entries(pins).some(([k,v])=>initial[k]!==v)||initial.simulator!=='4ea1bf884ea8d8d2282436aac53367f121fa3b0d308688957849a4774e34f1fa')throw Error('The declared AidScaler candidate, evaluators or simulator changed before the comparison.');
const same=s=>Object.keys(initial).every(k=>s[k]===initial[k]);
const folder=resolve(options.folder??'reports/final-two-response/'+Date.now()),lock=resolve('.local/PAID_RESEARCH_STUDY.lock');
let interrupted=false;const signal=()=>{interrupted=true;};process.on('SIGINT',signal);process.on('SIGTERM',signal);
try{await withHumanResearchLock(lock,{study:'final-two-response',nonce:randomUUID(),pid:process.pid,source:initial},async()=>{
 await mkdir(resolve(folder,'..'),{recursive:true});await mkdir(folder,{recursive:false});
 const helper=await readFile(new URL(import.meta.url));
 const protocol={schema:'final-two-response-v1',declaredAt:new Date().toISOString(),source:initial,worlds,common,helperSha256:sha(helper),
  actualModel:'google/gemma-4-31b-it',futureModel:'Gemini; not used or inferred here',maximumPaidExposureUsd:.15,
  checksReportedByRoot:{simulator:249,affectedPlatform:31,browser:7,media:5},freshFullPlatformGateClaimed:false,
  scope:'Same original seed and common resources/permissions/physics. All negatives, unknown costs, failures and censored cases retained; no outcome retry.'};
 await writeFile(resolve(folder,'protocol.json'),JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
 await writeFile(resolve(folder,'runner.mjs.txt'),helper,{flag:'wx'});
 const rows=[],records=[];let stop=null;
 const checkpoint=()=>writeFile(resolve(folder,'index.json'),JSON.stringify({source:initial,records,stoppedReason:stop,interrupted,declaredWorlds:2},null,2)+'\n');
 for(const world of worlds){
  if(interrupted){stop='operator_stop_before_next_world';break;}
  const before=await current();if(!same(before)){stop='source_changed_before_world';break;}
  const record={...world,state:'starting',sourceBefore:before,startedAt:new Date().toISOString(),reservedCapUsd:world.arm==='B6'?.15:0};records.push(record);await checkpoint();
  console.log(JSON.stringify({phase:'started',arm:world.arm,seed,folder}));
  let row;const started=performance.now();
  try{row=await runHumanCapacityEpisode({...world,...common,shouldStop:async()=>interrupted,onProgress:p=>console.log(JSON.stringify({phase:'progress',...p}))});}
  catch(error){row=failedHumanCapacityWorld({world,config:common,source:initial,cap:world.arm==='B6'?.15:0,error,wallMs:performance.now()-started});}
  rows.push(row);const bytes=Buffer.from(JSON.stringify(row,null,2)+'\n'),path=resolve(folder,world.arm+'.json');await writeFile(path,bytes,{flag:'wx'});
  const after=await current();Object.assign(record,{state:'settled',status:row.status,finishedAt:new Date().toISOString(),path,sha256:sha(bytes),sourceAfter:after,sourceStable:same(after),
   providerCalls:row.modelCalls,knownCostUsd:row.knownCostUsd,totalCostUsd:row.usageMissing?null:row.costUsd,chargedBudgetUsd:row.chargedBudgetUsd,unknownUsageRows:row.unknownCostRows,errors:row.errors});await checkpoint();
  console.log(JSON.stringify({phase:'settled',arm:world.arm,status:row.status,cost:record.totalCostUsd,errors:row.errors}));
  if(!same(after)){stop='source_changed_after_world';break;}
 }
 const summary=summarizeHumanCapacity(rows,worlds);summary.comparisons=summary.comparisons.filter(p=>p.reference==='C_manual');
 const finalSource=await current(),stable=same(finalSource),pair=summary.comparisons[0]??null;
 const presentation=rows.map(r=>({arm:r.arm,label:r.arm==='C_manual'?'Conventional':'AidScaler + Gemma 4',status:r.status,
  sufficient:r.timeToSufficientService,firstUseful:r.timeToFirstUsefulService,cases:r.outcomes?.length??0,covered:r.outcomes?.filter(x=>!x.censored).length??0,
  censored:r.outcomes?.filter(x=>x.censored).length??null,resources:['water','food','blankets'].map(type=>{const a=(r.outcomes??[]).filter(x=>x.type===type);return{type,unit:a[0]?.unit??null,demand:a.reduce((n,x)=>n+x.quantity,0),received:a.reduce((n,x)=>n+x.served,0),excess:a.reduce((n,x)=>n+x.overprovided,0)};}),
  distanceM:r.metrics?.physical?.distanceM??null,fuelMl:r.metrics?.physical?.fuelMl??null,providerCalls:r.modelCalls,knownCostUsd:r.knownCostUsd,totalCostUsd:r.usageMissing?null:r.costUsd,
  chargedBudgetUsd:r.chargedBudgetUsd,unknownUsageRows:r.unknownCostRows,errors:r.errors,invariants:r.invariants}));
 const result={schema:'final-two-response-closed-v1',source:{initial,final:finalSource,stable},summary,presentation,stoppedReason:stop,
  actualModel:'Gemma 4 via OpenRouter',GeminiUsed:false,comparativeClaimEligible:stable&&rows.length===2&&rows.every(r=>r.status==='completed')&&pair?.comparable===true,
  notes:['Simulation with hypothetical moderate human-capacity parameters; one paired seed, not independent field validation.','All24 cases, censored failures and unknown bills retained. Positive physical service is not independent semantic precision.']};
 await writeFile(resolve(folder,'summary.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 const minute=n=>typeof n==='number'?(n/60000).toFixed(3):'unknown',usd=n=>typeof n==='number'?n.toFixed(8):'unknown';
 let md='# Conventional / AidScaler + Gemma 4\n\nBoth methods receive the same seeded scenario, resources, permissions and physical rules. AidScaler uses Gemma 4 through OpenRouter. These are simulated response outcomes; minutes saved do not establish lives saved.\n\n| Metric | Conventional | AidScaler + Gemma 4 | Meaning for the response / beneficiaries |\n|---|---:|---:|---|\n';
 const left=presentation.find(r=>r.arm==='C_manual'),right=presentation.find(r=>r.arm==='B6'),cell=(r,f)=>r?f(r):'not run';
 const metrics=[
  ['Run status',r=>r.status,'Whether the declared simulation finished. A completed run still needs valid source integrity and physical evidence before comparison.'],
  ['Needs receiving sufficient help',r=>r.covered+'/'+r.cases,'Needs whose physical receipts covered their required quantity. This counts needs, not people or families.'],
  ['Needs still unresolved at the horizon',r=>r.censored??'unknown','These cases remain in the result rather than disappearing from the average. Censoring means sufficient help was not observed within the declared time window.'],
  ['Mean time to sufficient help, min (horizon-limited)',r=>minute(r.sufficient?.restrictedMeanMs),'Lower means required help arrived sooner on average. Unresolved cases remain limited by the same horizon; this is not an average of successful cases only.'],
  ['Vehicle travel, km',r=>r.distanceM==null?'unknown':(r.distanceM/1000).toFixed(3),'Distance travelled by the finite fleet. More travel uses transport capacity and can be a tradeoff even when help arrives sooner.'],
  ['Fuel consumed, L',r=>r.fuelMl==null?'unknown':(r.fuelMl/1000).toFixed(3),'Physical fuel used by the response. Less fuel conserves an operational resource; it does not by itself prove more people were helped.'],
  ['Known model-provider cost, USD',r=>usd(r.knownCostUsd),'Recorded inference charges only. This subtotal is not a complete bill when some usage is unknown.'],
  ['Total model-provider cost, USD',r=>usd(r.totalCostUsd),'The full recorded inference bill when available. Unknown is kept explicit and never presented as zero; deployment, salaries and supplies are outside this figure.'],
  ['Model-provider calls',r=>r.providerCalls??'unknown','Actual model requests made during the run. Calls are computational work, not deliveries or beneficiaries.']
 ];
 for(const [label,f,meaning]of metrics)md+='| '+label+' | '+cell(left,f)+' | '+cell(right,f)+' | '+meaning+' |\n';
 const resourceValue=(r,type,field)=>{const resource=r.resources.find(x=>x.type===type);return resource?.unit==null?'unknown':resource[field]+' '+resource.unit;};
 for(const [type,label,unitMeaning]of [
  ['water','Water','Water is reported in its native volume unit.'],
  ['food','Food','Food quantities represent portions; no equivalence to people or families is assumed.'],
  ['blankets','Blankets','Each blanket unit represents one blanket; no equivalence to people or families is assumed.']
 ]){
  for(const [field,description,meaning]of [
   ['demand','required','Required quantity for the declared needs.'],
   ['received','physically received','Quantity credited by the recorded physical receipts; compare it with demand rather than treating dispatch as arrival.'],
   ['excess','received beyond demand','Recorded overprovision is retained as a resource tradeoff and does not count as additional need coverage.']
  ])md+='| '+label+' — '+description+' | '+cell(left,r=>resourceValue(r,type,field))+' | '+cell(right,r=>resourceValue(r,type,field))+' | '+meaning+' '+unitMeaning+' |\n';
 }
 md+='\nThis is one paired seed under declared, hypothetical human-capacity settings. '+(result.comparativeClaimEligible?'The matched pair is eligible for comparison; eligibility does not imply a win.':'No comparative win is claimed: inspect run status, source integrity and missing or censored evidence.')+'\n\n[Protocol](protocol.json), [complete summary](summary.json), [Conventional outcomes](C_manual.json) and [AidScaler + Gemma 4 outcomes](B6.json) retain quantities, failures, recovered errors, invariants and known or unknown usage. First partial help and sufficient help remain distinct endpoints in those records.\n';
 await writeFile(resolve(folder,'readout.md'),md,{flag:'wx'});await checkpoint();console.log(JSON.stringify({folder,sourceStable:stable,eligible:result.comparativeClaimEligible,presentation}));
 if(!result.comparativeClaimEligible)process.exitCode=1;
});}finally{process.off('SIGINT',signal);process.off('SIGTERM',signal);}
