import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildFingerprint, evaluatorFingerprint } from '../evaluation/harness.mjs';
import { requireLoadedSimulatorBuild, checkFinalBuilds } from '../evaluation/simulator-build.mjs';
import { runDiscoveryEpisode, summarizeDiscovery, DISCOVERY_PROTOCOL } from '../evaluation/discovery-benchmark.mjs';
import { verificationPassed } from '../scripts/verification-gates.mjs';
const planFile='reports/general-agent-plan.json', plan=JSON.parse(await readFile(planFile,'utf8'));
const priorFile=process.argv[2];
if(!priorFile)throw Error('Exact newly verified B6 report path required; never reuse an old version');
const raw=await readFile(priorFile,'utf8'), prior=JSON.parse(raw);
const fp={candidateFingerprint:await buildFingerprint(),evaluatorFingerprint:await evaluatorFingerprint(),simulatorFingerprint:await requireLoadedSimulatorBuild()};
const verified=JSON.parse(await readFile('reports/verification-latest.json','utf8'));
if(!verificationPassed(verified)||Object.entries(fp).some(([k,v])=>plan[k]!==v||verified[k]!==v))throw Error('Reuse requires exact verified current source bytes');
const p=plan.profile;
const expected={count:p.needs,noise:p.noise,reposts:p.reposts,humanReadMs:p.humanReadMs,humanWorkers:p.humanWorkers,clarificationWorkers:p.clarificationWorkers,formalDelayMs:p.formalDelayMs,extentKm:6,grid:9,horizonMs:p.horizonMs,silentFraction:0,traffic:0,packetLoss:0,budgetUsd:p.episodeBudgetUsd,maxModelCalls:p.maxModelCalls,candidateFingerprint:fp.candidateFingerprint,evaluatorBuild:fp.evaluatorFingerprint};
const keyMap={candidateFingerprint:'candidateFingerprint',evaluatorFingerprint:'evaluatorFingerprint',simulatorFingerprint:'simulatorBuild'};
if(prior.arm!=='B6'||prior.seed!==p.seedPrefix+'-01'||prior.status!=='completed'||prior.candidateChanged||prior.evaluatorChanged||prior.simulatorChanged||prior.invariants.length||prior.errors.length)throw Error('Original completed B6 is not eligible for exact reuse');
const originalProtocol=JSON.parse(await readFile(path.join(path.dirname(priorFile),'protocol.json'),'utf8'));
if(Object.entries(expected).some(([k,v])=>originalProtocol.config[k]!==v))throw Error('Reuse config mismatch');
for(const [k,v] of Object.entries(fp)){
 const field=keyMap[k];
 if((prior[field]??originalProtocol.config[field]??originalProtocol[field])!==v)throw Error('Reuse original fingerprint mismatch '+field);
}
const folder='reports/discovery/general-agent-reuse-'+Date.now();await mkdir(folder,{recursive:true});
const protocol={runnerSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),at:new Date().toISOString(),...DISCOVERY_PROTOCOL,planFile,config:expected,seeds:1,arms:p.arms,seedPrefix:p.seedPrefix+'-',simulatorBuild:fp.simulatorFingerprint,totalBudgetUsd:p.campaignBudgetUsd,
 reuse:{file:priorFile,sha256:createHash('sha256').update(raw).digest('hex'),arm:'B6',reason:plan.reuse,chargedOnce:true,copy:'Exact byte-for-byte source result, not a new execution; original identity and timestamps preserved.'},stop:'Every declared result retained. One scoped seed; no favorable retry selection.'};
await writeFile(folder+'/protocol.json',JSON.stringify(protocol,null,2));await writeFile(folder+'/'+prior.seed+'-B6.json',raw);
console.log(JSON.stringify({phase:'declared_general_reference',folder,reusedB6:priorFile,model:prior.usage.map(u=>u.model).filter(Boolean)[0],originalCost:prior.chargedBudgetUsd}));
const rows=[prior];const result=await runDiscoveryEpisode({...expected,arm:'B9',seed:prior.seed,onProgress:r=>console.log(JSON.stringify({phase:'progress',...r}))});
rows.push(result);await writeFile(folder+'/'+prior.seed+'-B9.json',JSON.stringify(result,null,2));
const summary={...summarizeDiscovery(rows),folder,declaredRuns:2,missingRuns:0,reuse:protocol.reuse};
await writeFile(folder+'/summary.json',JSON.stringify(summary,null,2));
const final=await checkFinalBuilds({candidate:fp.candidateFingerprint,evaluator:fp.evaluatorFingerprint,simulator:fp.simulatorFingerprint},{candidate:buildFingerprint,evaluator:evaluatorFingerprint});
console.log(JSON.stringify({phase:'completed_general_reference',folder,status:result.status,served:result.timeToSufficientService.completed+'/'+result.outcomes.length,rmstMinutes:result.timeToSufficientService.restrictedMeanMs/60000,calls:result.usage.length,chargedUsd:result.chargedBudgetUsd,errors:result.errors.map(e=>e.code),invariants:result.invariants.length,finalIntegrity:final.invalidStatus??'PASS'}));
if(final.invalidStatus||result.candidateChanged||result.evaluatorChanged||result.simulatorChanged||result.invariants.length||result.errors.length)process.exitCode=1;

