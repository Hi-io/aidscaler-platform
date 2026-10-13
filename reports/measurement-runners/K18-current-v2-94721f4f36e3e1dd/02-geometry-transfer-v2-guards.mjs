// Pure orchestration guards; no evaluator, world, provider or outcome imports.
import {validateProbeGate,V2_SOURCE} from './evidence-probe-guards-v2.mjs';
import {providerCost} from './read-human-capacity-evidence.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export const GEOMETRY_SOURCE={candidate:V2_SOURCE.candidate,baseEvaluator:V2_SOURCE.baseEvaluator,humanEvaluator:V2_SOURCE.humanEvaluator,simulator:V2_SOURCE.simulator};
export function validateGeometryGate(freeze,current){
  validateProbeGate(freeze,current);
  if(current.humanEvaluatorFingerprint!==GEOMETRY_SOURCE.humanEvaluator)throw Error('Actual v4 human fingerprint required');
  const counts={platform:freeze.verification.cases.find(c=>c.name==='platform-tests')?.tests?.tests,
    simulator:freeze.verification.cases.find(c=>c.name==='simulator-tests')?.tests?.tests,
    ui:freeze.ui.cases.reduce((n,c)=>n+(c.report?.checks?.length??0),0)};
  if(counts.platform!==486||counts.simulator!==247||counts.ui!==113)throw Error('Exact fresh 486/247/UI113 gate required');
  return counts;
}
export function validateGeometryPlan(plan,original){
  if(plan.amendment?.legacyDeclaredTraffic!==.15||plan.amendment?.correctedNativeVehicleCount!==15||
    JSON.stringify(plan.source)!==JSON.stringify(GEOMETRY_SOURCE))throw Error('Explicit authorized traffic/source amendment required');
  const material=p=>({worlds:p.worlds,arms:p.arms,config:p.config,totalBudgetUsd:p.totalBudgetUsd,paidEpisodes:p.paidEpisodes,plannedEpisodes:p.plannedEpisodes});
  const before=material(original),after=material(plan);after.config={...after.config,traffic:.15};
  if(JSON.stringify(before)!==JSON.stringify(after)||plan.config.traffic!==15||plan.totalBudgetUsd!==.4||plan.config.budgetUsd!==.15)
    throw Error('Only invalid traffic parameter and orchestration metadata may change');
  return {declaredStudyAdmissionBudgetUsd:.40,selectedNominalPaidCapsUsd:.30,worlds:6,paidWorlds:2};
}
export function geometryFee(raw,arm){
  const cap=arm==='B6'?.15:0,cost=providerCost(raw,{missing:!raw,cap});
  let charged=0,unknown=!Array.isArray(raw?.usage);
  for(const u of raw?.usage??[]){const value=finite(u.cost_usd)&&u.cost_usd>=0?u.cost_usd:finite(u.reserved_usd)&&u.reserved_usd>=0?u.reserved_usd:null;
    if(value===null)unknown=true;else charged+=value;}
  return {...cost,chargedBudgetUsd:unknown?Math.max(cap,charged):charged,unknownExposure:unknown,
    fullCapExposureWhenReservationUnknownUsd:unknown?cap:null,legacyReportedCostUsd:raw?.costUsd??null};
}
export function auditGeometryProfile(raw,item,plan){
  const problems=[];
  for(const [key,wanted] of Object.entries({backgroundTraffic:15,packetLoss:.05,grid:item.grid,extentKm:item.extentKm,durationMs:plan.config.horizonMs}))
    if(raw?.manifest?.config?.[key]!==wanted)problems.push('native_'+key+'_mismatch_or_unknown');
  for(const [key,wanted] of Object.entries({count:12,noise:96,reposts:2,silentFraction:.25,formalDelayMs:3600000}))
    if(raw?.corpus?.config?.[key]!==wanted)problems.push('corpus_'+key+'_mismatch_or_unknown');
  if(raw?.seed!==item.seed||raw?.arm!==item.arm)problems.push('identity_mismatch');
  return {matches:!problems.length,problems,legacyDeclaredTraffic:.15,correctedNativeVehicleCount:15,
    scope:'Observed native configuration after the episode, never information passed to the controller. 15 is a vehicle count, not a density or percentage.'};
}
