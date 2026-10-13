import { readFile, writeFile, mkdir, open, access, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

// Ignored orchestration only. No evaluator/provider import before an explicit
// verified gate. Imports for --plan, --archive and these pure tests are free.
export const PLAN_100 = {
  schema: 'coupled-100-current-v1', study: 'K27_T16_coupled_supply_load', state: 'prepared_not_launched',
  seed: 'local-combined-load-seed-01', modes: ['parser', 'real'], workers: 1,
  common: { seed: 'local-combined-load-seed-01', count: 100, noise: 192, reposts: 2, grid: 13, extentKm: 6,
    sourceCutoffMs: 300000, horizonMs: 10800000, formalDelayMs: 3600000, clarificationWorkers: 2,
    reviewMs: 30000, batchSize: 30, maxSourceAttempts: 2, retryCooldownMs: 60000, wallLimitMs: 900000 },
  limits: { parser: { maxModelCalls: 32, budgetUsd: .01, providerPaidCapUsd: 0 }, real: { maxModelCalls: 64, budgetUsd: .30, providerPaidCapUsd: .30 } },
  stopFile: '.local/STOP_COUPLED_100_CURRENT', lockFile: '.local/PAID_RESEARCH_STUDY.lock',
  mandatoryGate: 'Explicit ROOT_GO_100 plus current three hashes and same-hash successful full verification/UI seal.',
  coreLimitAmendment: 'Real cap64 uses the existing source-recovery API bound, not a core change; original requested96 would fail its <=64 validator. Root approved64/.30 before outcomes.',
  physicalScope: 'Four owner databases; 100 distinct water/food/blanket needs, original native stocks/fleet/skills/payload limits/permissions, finite confirmation and owner review. No additional stock, teleport or automated authority.',
  readout: ['all sealed source versions/dispositions/revisions/attention', 'all owner review receipts and queue state',
    'all100 fixed-horizon physical outcomes/partial/sufficient/censored', 'exact source operation receipts',
    'provider wall/errors/known costs/unknown reserves', 'initial/final three hashes', 'declared controller stopping point and hardware wall allowance'],
  limitations: ['Not a comparison against B5/B8 and not100 arbitrary complex reasoning categories.',
    'Parser substitute demonstrates integration and bounded queues, not real-model semantic accuracy.',
    'Native service counts are not lives saved; Gemma cannot be attributed to Gemini.',
    'No K01/K09/K16 or independent accuracy figure inferred if absent from this runner export.',
    'Four in-memory owner stores in one process do not establish12-process quality or production throughput.',
    'The historical420s control14/100 sufficient with86 censored remains retained; no inherited result for this build.']
};

const finite = n => typeof n === 'number' && Number.isFinite(n), sha = b => createHash('sha256').update(b).digest('hex');
const wantedHash = (row, key) => key === 'simulatorBuild' ? row?.simulatorBuild ?? row?.simulatorFingerprint ?? row?.engineBuild : row?.[key];
export function validate100Gate(freeze, current) {
  for (const key of ['candidateFingerprint', 'evaluatorFingerprint', 'simulatorBuild']) {
    const value = wantedHash(freeze, key);
    if (!/^[a-f0-9]{64}$/.test(value ?? '') || value !== current[key]) throw Error('Freeze mismatch: ' + key);
  }
  const v = freeze.verification, u = freeze.ui;
  if (v?.passed !== true || [v.candidateChanged, v.evaluatorChanged, v.simulatorChanged].some(x => x !== false) ||
    !Array.isArray(v.cases) || !v.cases.length || v.cases.some(c => c.exitCode !== 0 || c.signal != null)) throw Error('Successful unchanged full verification is mandatory.');
  for (const name of ['platform-tests', 'simulator-tests']) {
    const row = v.cases.find(c => c.name === name)?.tests;
    if (!row || !(row.tests > 0) || row.pass !== row.tests || row.fail !== 0 || row.cancelled !== 0) throw Error('Full suite missing or failed: ' + name);
  }
  if (u?.passed !== true || u.unchanged !== true || !Array.isArray(u.cases) || !u.cases.length ||
    u.cases.some(c => c.exitCode !== 0 || c.signal != null)) throw Error('Successful unchanged UI verification is mandatory.');
  const finalV = { candidateFingerprint: v.candidateFinalFingerprint, evaluatorFingerprint: v.evaluatorFinalFingerprint,
    simulatorBuild: v.simulatorFinalFingerprint };
  for (const row of [v, finalV, u, u.finalFingerprints]) for (const key of Object.keys(current))
    if (wantedHash(row, key) !== current[key]) throw Error('Gate evidence belongs to another build: ' + key);
  return true;
}

export function cost100(report, mode) {
  if (!PLAN_100.modes.includes(mode)) throw Error('Unknown mode');
  if (mode === 'parser') return { paidCalls: 0, knownProviderCostUsd: 0, totalProviderCostUsd: 0, unknownCostCalls: 0,
    knownUnknownCostReserveUsd: 0, unknownReserveCalls: 0, chargedBudgetUsd: 0, parserCalls: report.providerCalls?.length ?? null,
    providerWallKnownSubtotalMs: null, providerWallMissingCalls: null, note: 'External HTTP refused by the parser control; substitute calls are not paid model calls.' };
  const rows = Array.isArray(report.usage) ? report.usage : null, cap = PLAN_100.limits.real.providerPaidCapUsd;
  if (!rows) return { paidCalls: null, knownProviderCostUsd: null, totalProviderCostUsd: null, unknownCostCalls: null,
    knownUnknownCostReserveUsd: null, unknownReserveCalls: null, chargedBudgetUsd: cap,
    providerWallKnownSubtotalMs: null, providerWallMissingCalls: null, note: 'Missing settled usage: reserve the episode cap, do not invent zero calls or billing.' };
  const known = rows.filter(r => finite(r.cost_usd)), unknown = rows.filter(r => !finite(r.cost_usd)),
    knownCost = known.reduce((n,r) => n+r.cost_usd,0), knownReserve = unknown.filter(r => finite(r.reserved_usd)).reduce((n,r) => n+r.reserved_usd,0),
    missingReserves = unknown.filter(r => !finite(r.reserved_usd)).length;
  return { paidCalls: rows.length, knownProviderCostUsd: knownCost, totalProviderCostUsd: unknown.length ? null : knownCost,
    unknownCostCalls: unknown.length, knownUnknownCostReserveUsd: knownReserve, unknownReserveCalls: missingReserves,
    chargedBudgetUsd: missingReserves ? Math.max(cap, knownCost+knownReserve) : knownCost+knownReserve,
    failedProviderCalls: rows.filter(r => r.state === 'failed' || r.error).length,
    providerWallKnownSubtotalMs: rows.filter(r => finite(r.wall_ms)).reduce((n,r) => n+r.wall_ms,0),
    providerWallMissingCalls: rows.filter(r => !finite(r.wall_ms)).length,
    providerWallTotalMs: rows.every(r => finite(r.wall_ms)) ? rows.reduce((n,r) => n+r.wall_ms,0) : null,
    models: [...new Set(rows.map(r => r.model).filter(Boolean))],
    note: 'Unknown reserves are exposure, not billing. Failed/truncated/provider-exception usage is retained. Infrastructure and wages are unpriced.' };
}

export function outcome100(report, mode) {
  const outcomes = Array.isArray(report.outcomes) ? report.outcomes : null, byType = {};
  for (const row of outcomes ?? []) {
    const k = JSON.stringify([row.type ?? 'unknown', row.unit ?? 'unknown']);
    byType[k] ??= { type: row.type ?? null, unit: row.unit ?? null, needs: 0, demand: 0, received: 0, overprovided: 0, missingExcessRows: 0, missingQuantityRows: 0, firstUseful: 0, sufficient: 0, rightCensored: 0 };
    const s = byType[k]; s.needs++;
    if (finite(row.quantity) && finite(row.served)) { s.demand += row.quantity; s.received += row.served; } else s.missingQuantityRows++;
    if(finite(row.overprovided))s.overprovided+=row.overprovided;else s.missingExcessRows++;
    if (row.firstUsefulCensored === false) s.firstUseful++;
    if (row.sufficientCensored === false) s.sufficient++; else s.rightCensored++;
  }
  for (const s of Object.values(byType)) { if (s.missingQuantityRows) { s.demand = null; s.received = null; } if(s.missingExcessRows)s.overprovided=null; }
  return { mode, status: report.status ?? 'unknown', controllerStoppedAt: report.controllerStoppedAt ?? null,
    sealedSources: report.results ?? null, localState: report.localState ?? null,
    physicallyEligible: outcomes?.length ?? null, missingExpectedOutcomes: outcomes ? Math.max(0,100-outcomes.length) : 100,
    extraOutcomeRecords: outcomes ? Math.max(0,outcomes.length-100) : null,
    native: Object.values(byType), errors: report.errors ?? null, invariants: report.invariants ?? null,
    costs: cost100(report,mode), finalBuilds: report.finalBuilds ?? null,
    unavailable: { K01_integratedDeficit: null, K09_utilization: null, K16_linkedFunnel: report.proposalFunnel ?? null,
      semanticPrecisionRecall: null, independentlyValidatedEffectiveness: null },
    note: 'Supply volumes, portions and item counts remain distinct. Recovery closure is schema/provenance plus received lifecycle, not independently scored accuracy. Missing physical clocks, deficit/utilization or K16 remain unknown.' };
}

const bundleNames = ['combined-100-controlled.mjs','combined-100-controlled.test.mjs','combined-100-guide.md'];
export async function archive100() {
  const rows = await Promise.all(bundleNames.map(async name => { const bytes=await readFile(new URL('./'+name,import.meta.url)); return {name,bytes,sha256:sha(bytes)}; }));
  const folder=resolve('reports/measurement-runners/coupled-100-'+rows[0].sha256.slice(0,16));
  await mkdir(folder,{recursive:true});
  for(const row of rows) {
    const target=resolve(folder,row.name); let prior=null; try{prior=await readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(prior && sha(prior)!==row.sha256)throw Error('Archived bytes differ; never overwrite: '+row.name);
    if(!prior)await writeFile(target,row.bytes,{flag:'wx'});
  }
  const planBytes=Buffer.from(JSON.stringify(PLAN_100,null,2)+'\n'), planFile=resolve(folder,'plan.json');
  let oldPlan=null;try{oldPlan=await readFile(planFile);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(oldPlan && sha(oldPlan)!==sha(planBytes))throw Error('Archived protocol differs; never overwrite');
  if(!oldPlan)await writeFile(planFile,planBytes,{flag:'wx'});
  const manifest={artifact:'Prepared coupled100 runner; no results and no provider calls',state:'prepared_not_launched',modelCalls:0,
    runnerSha256:rows[0].sha256,planSha256:sha(planBytes),files:rows.map(({name,sha256,bytes})=>({name,sha256,bytes:bytes.length})),
    command:'node --test .local/combined-100-controlled.test.mjs',verifiedTests:6,scope:'Pure gate, cost/unknown and native-outcome tests only. No campaign quality or performance measured.'};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),target=resolve(folder,'manifest.json');
  let prior=null;try{prior=await readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior && sha(prior)!==sha(manifestBytes))throw Error('Archived manifest differs; never overwrite');
  if(!prior)await writeFile(target,manifestBytes,{flag:'wx'});
  return {folder,runnerSha256:rows[0].sha256,planSha256:sha(planBytes),modelCalls:0};
}

async function main(){
  const args=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf('=');if(!s.startsWith('--'))throw Error('Use named arguments');return [s.slice(2,i<0?undefined:i),i<0?true:s.slice(i+1)];}));
  if(args.plan){console.log(JSON.stringify(PLAN_100,null,2));return;}
  if(args.archive){console.log(JSON.stringify(await archive100()));return;}
  if(!args.freeze)throw Error('Fresh verified freeze required; --plan and --archive never launch.');
  const expected=JSON.parse(await readFile(resolve(args.freeze),'utf8')),
    {buildFingerprint,evaluatorFingerprint}=await import('../evaluation/harness.mjs'),
    {requireLoadedSimulatorBuild,checkFinalBuilds}=await import('../evaluation/simulator-build.mjs'),
    current={candidateFingerprint:await buildFingerprint(),evaluatorFingerprint:await evaluatorFingerprint(),simulatorBuild:await requireLoadedSimulatorBuild()};
  validate100Gate(expected,current);
  if(args.run!=='ROOT_GO_100'){console.log(JSON.stringify({state:'dry_run_verified_no_provider',...current,plan:PLAN_100}));return;}
  let interrupt=false;process.on('SIGINT',()=>{interrupt=true;});process.on('SIGTERM',()=>{interrupt=true;});
  const stop=resolve(PLAN_100.stopFile),stopped=async()=>{if(interrupt)return true;try{await access(stop);return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}};
  if(await stopped())throw Error('Stop marker exists; preserve it and request a new gate.');
  const archive=await archive100(), lockFile=resolve(PLAN_100.lockFile),nonce=randomUUID();
  await mkdir('.local',{recursive:true});const lock=await open(lockFile,'wx');
  await lock.writeFile(JSON.stringify({nonce,pid:process.pid,study:PLAN_100.study,at:new Date().toISOString(),...current}));await lock.close();
  const folder=resolve('reports/combined/coupled-100-current-'+Date.now()), cases=[],missingOutcomes=[],protocol={...PLAN_100,state:'running',
    at:new Date().toISOString(),...current,freezePath:resolve(args.freeze),archive,planned:PLAN_100.modes.map(mode=>({mode,seed:PLAN_100.seed})),
    stopPolicy:'Settled provider boundary only; no SIGKILL. Pending usage reserves full cap and already-issued physical outcomes remain retained.'};
  let activeEpisode=null,stoppedReason=null;
  const checkpoint=()=>writeFile(resolve(folder,'index.json'),JSON.stringify({protocol,activeEpisode,cases,missingOutcomes,stoppedReason,
    notAttempted:PLAN_100.modes.filter(mode=>!cases.some(c=>c.mode===mode)&&!missingOutcomes.some(c=>c.mode===mode)&&activeEpisode?.mode!==mode)
      .map(mode=>({mode,state:'explicitly_not_attempted',providerCostUsd:0,paidCalls:0}))},null,2));
  const checkBuilds=()=>checkFinalBuilds({candidate:current.candidateFingerprint,evaluator:current.evaluatorFingerprint,simulator:current.simulatorBuild},{candidate:buildFingerprint,evaluator:evaluatorFingerprint});
  try{
    await mkdir(folder,{recursive:true});await writeFile(resolve(folder,'protocol.json'),JSON.stringify(protocol,null,2));await checkpoint();
    const {runSourceRecovery}=await import('../scripts/source-recovery.mjs');
    for(const mode of PLAN_100.modes){
      if(await stopped()){stoppedReason='operator_stop_boundary';break;}
      const before=await checkBuilds();if(before.invalidStatus){stoppedReason='source_changed_before_episode';break;}
      activeEpisode={mode,seed:PLAN_100.seed,state:'inflight_not_an_outcome',costUsd:null,paidCalls:null,reservedUsd:PLAN_100.limits[mode].providerPaidCapUsd};
      await checkpoint();console.log(JSON.stringify({folder,running:activeEpisode}));
      try{
        const limit=PLAN_100.limits[mode],report=await runSourceRecovery({...PLAN_100.common,maxModelCalls:limit.maxModelCalls,budgetUsd:limit.budgetUsd,mode,writeReport:true,shouldStop:stopped});
        const readout=outcome100(report,mode),rawBytes=await readFile(resolve(report.reportFile)),rawFile=resolve(folder,mode+'-raw.json');
        await writeFile(rawFile,rawBytes);await writeFile(resolve(folder,mode+'-readout.json'),JSON.stringify(readout,null,2));
        cases.push({mode,seed:PLAN_100.seed,reportFile:resolve(report.reportFile),rawFile,rawSha256:sha(rawBytes),readout});
        if(report.finalBuilds?.invalidStatus)stoppedReason='source_changed_during_episode';
        if(['aborted_operator','incomplete_wall_limit','failed_control','failed_integrity'].includes(report.status))stoppedReason??=report.status;
      }catch(e){
        missingOutcomes.push({mode,seed:PLAN_100.seed,status:'missing_outcome_after_exception',calls:null,costUsd:null,
          reservedUsd:PLAN_100.limits[mode].providerPaidCapUsd,error:{code:e.code??e.name,message:String(e.message).slice(0,250)}});
        stoppedReason='unsettled_or_unrecordable_episode';
      }
      activeEpisode=null;await checkpoint();if(stoppedReason)break;
    }
    const finalBuilds=await checkBuilds();if(finalBuilds.invalidStatus)stoppedReason??='source_changed_after_episode';
    await writeFile(resolve(folder,'summary.json'),JSON.stringify({protocol,cases,missingOutcomes,stoppedReason,finalBuilds,
      notAttempted:PLAN_100.modes.filter(mode=>!cases.some(c=>c.mode===mode)&&!missingOutcomes.some(c=>c.mode===mode)),
      providerKnownSubtotalUsd:cases.every(c=>finite(c.readout.costs.knownProviderCostUsd))?cases.reduce((n,c)=>n+c.readout.costs.knownProviderCostUsd,0):null,
      totalProviderCostUsd:!missingOutcomes.length&&cases.length===2&&cases.every(c=>finite(c.readout.costs.totalProviderCostUsd))?cases.reduce((n,c)=>n+c.readout.costs.totalProviderCostUsd,0):null,
      chargedExposureUsd:cases.reduce((n,c)=>n+c.readout.costs.chargedBudgetUsd,0)+missingOutcomes.reduce((n,c)=>n+c.reservedUsd,0),
      comparisons:[],comparativeClaim:false,limitations:PLAN_100.limitations},null,2));await checkpoint();
    console.log(JSON.stringify({folder,closed:cases.length,planned:2,stoppedReason,missingOutcomes:missingOutcomes.length}));
    if(stoppedReason||cases.length!==2||cases.some(c=>c.readout.status!=='recovered'||c.readout.errors?.length||c.readout.invariants?.length))process.exitCode=1;
  }finally{
    const held=JSON.parse(await readFile(lockFile,'utf8'));if(held.nonce!==nonce||held.pid!==process.pid)throw Error('Single study lock changed; preserve for review.');await unlink(lockFile);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
