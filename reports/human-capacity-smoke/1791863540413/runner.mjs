import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runHumanCapacityEpisode, humanCapacityEvaluatorFingerprint, HUMAN_CAPACITY_PROTOCOL } from '../evaluation/human-capacity-benchmark.mjs';
import { buildFingerprint } from '../evaluation/harness.mjs';
import { requireLoadedSimulatorBuild } from '../evaluation/simulator-build.mjs';

const folder=`reports/human-capacity-smoke/${Date.now()}`;
const runnerBytes=await readFile(new URL(import.meta.url));
const source={candidate:await buildFingerprint(),evaluator:await humanCapacityEvaluatorFingerprint(),simulator:await requireLoadedSimulatorBuild()};
const args={profile:'zero',condition:'zero-smoke',seed:'native-human-capacity-smoke-01',count:4,noise:8,reposts:2,formalDelayMs:300000,horizonMs:1800000,pumpMs:60000,clarificationWorkers:2,budgetUsd:.15,maxModelCalls:1,wallLimitMs:180000};
const arms=['C_manual','C_decentralized','B8'];
await mkdir(folder,{recursive:true});
await writeFile(`${folder}/protocol.json`,JSON.stringify({label:'Structural zero-paid smoke, not an impact or model benchmark',source,args,arms,protocol:HUMAN_CAPACITY_PROTOCOL,amendment:'Version3 common60s pump/earlier received readyAt and one coordinator source feed, with host profiling. Competent received-read triage and capacity-specific handoff; native parameters and runtime-error preservation repaired. Prior smokes1791862245383/1791862573655 retained unchanged; 180s common host cap and unchanged30min physics declared before repetition.',runnerSha256:createHash('sha256').update(runnerBytes).digest('hex'),declaredAt:new Date().toISOString()},null,2),{flag:'wx'});
await writeFile(`${folder}/runner.mjs`,runnerBytes,{flag:'wx'});
const rows=[];
for(const arm of arms){
  console.log(JSON.stringify({stage:'start',arm,folder}));
  const r=await runHumanCapacityEpisode({...args,arm,candidateFingerprint:source.candidate,evaluatorBuild:source.evaluator,onProgress:p=>console.log(JSON.stringify({stage:'progress',...p}))});
  rows.push(r);await writeFile(`${folder}/${arm}.json`,JSON.stringify(r,null,2),{flag:'wx'});
  console.log(JSON.stringify({stage:'settled',arm,status:r.status,errors:r.errors,invariants:r.invariants,costUsd:r.costUsd,calls:r.modelCalls,sufficient:r.timeToSufficientService,first:r.timeToFirstUsefulService,coverage:r.sourceCoverage,humanStages:r.metrics.humanCapacity.stages,profiler:r.profiler.phases,wallMs:r.wallMs}));
}
await writeFile(`${folder}/readout.json`,JSON.stringify({label:'Structural smoke only; no estimated GenAI or time advantage',source,args,all:rows.map(r=>({arm:r.arm,status:r.status,errors:r.errors,invariants:r.invariants,costUsd:r.costUsd,calls:r.modelCalls,sufficient:r.timeToSufficientService,first:r.timeToFirstUsefulService,coverage:r.sourceCoverage,human:r.metrics.humanCapacity,wallMs:r.wallMs,proposalFunnel:r.proposalFunnel,changed:{candidate:r.candidateChanged,evaluator:r.evaluatorChanged,simulator:r.simulatorChanged}}))},null,2),{flag:'wx'});
console.log(JSON.stringify({stage:'closed',folder}));
