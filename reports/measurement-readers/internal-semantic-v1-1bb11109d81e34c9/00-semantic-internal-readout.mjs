// Offline presentation/consistency only; does not re-annotate or score a model.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {providerCost} from './read-human-capacity-evidence.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export const PLAN={version:'internal-semantic-existing-child-readout-v1',study:'K11_K13',seed:'k11-semantic-current-2026-01',
  organizations:1,authoredCurrentRequests:8,selectedOriginalSources:24,lineageCopiesPerRequest:2,
  originalSourceRoles:{currentRequests:8,explicitHistoricalClips:8,hostileInstructions:8},
  languages:['en','es','fr','ja'],types:['water','food','medicine','shelter','blankets'],
  quantityCycle:'80+i for i=0..7',unitCycle:['L','portions','packs','places','blankets'],
  providerCapUsd:.12,maxProviderAttempts:2,
  source:{candidate:'9b4de8b7769c69a3279067a8a093ef6d2392ec8a9728e704f871a184a69934e3',
    evaluator:'d64f62747ecd5a36f77b9cd34dc6e1b2b37a77220cae9f206bb773a0a4263090',
    simulator:'561e6a02fbde1d047f999c4f077cbff83c438ba5c508c4d8d18bbf59ff78e94b'},
  authority:'ROOT_GO_READ_K11_K13_INTERNAL',
  scope:'Report existing child observer-scored exact tuples and actual accepted/rejected interpretation outputs. No new annotation, model judge, corpus filtering, external accuracy or physical-service score.',
  unknown:['complete 24-original public ID/version roster','complete semantic_receipt.sources/modelTiming/coverage','all eight exact gold tuples when not omitted',
    'source-confirmed truth','confidence calibration','independent K12 accuracy','complete injection/credential/command safety','byte-level media interpretation'],
  safety:'Inferred observations stay unverified. Child checks one need-origin predicate and source invariants; these limited probes are not an exhaustive security assessment.'};
function observationView(o){return {kind:o.kind??null,sourceIds:o.sourceIds??null,sourceVersions:null,location:o.location??null,
  resourceType:o.resourceType??null,quantity:finite(o.quantity)?o.quantity:null,unit:o.unit??null,timeStatus:o.timeStatus??'unknown',
  entity:o.entity??null,sourceConfirmedTruth:null,confidence:null};}
export function presentInternalSemantic(raw,wrapper,{rawSha256=null}={}){
  const issues=[];
  if(!raw)issues.push('missing_raw');
  if(!wrapper)issues.push('missing_wrapper_final_proof');
  if(raw&&raw.status!=='completed')issues.push('child_status:'+raw.status);
  if(wrapper?.eligibleForInternalScoring!==true)issues.push('wrapper_not_eligible');
  if(raw&&(raw.protocol?.seed!==PLAN.seed||raw.protocol?.count!==8||raw.protocol?.organizations!==1||raw.protocol?.copies!==2||raw.protocol?.budgetUsd!==.12))issues.push('not_predeclared_profile');
  if(rawSha256&&wrapper?.child?.sha256!==rawSha256)issues.push('child_raw_bytes_mismatch');
  for(const [key,value] of Object.entries(PLAN.source)){
    if(wrapper?.initial?.[key]!==value)issues.push('initial_'+key+'_mismatch_or_unknown');
    const finalKey={candidate:'finalCandidateFingerprint',evaluator:'finalEvaluatorFingerprint',simulator:'finalEngineBuild'}[key];
    if(wrapper?.final?.[finalKey]!==value||wrapper?.final?.[key+'Changed']!==false)issues.push('final_'+key+'_mismatch_or_unknown');
  }
  if(raw&&(raw.candidateFingerprint!==PLAN.source.candidate||raw.evaluatorFingerprint!==PLAN.source.evaluator||raw.candidateChanged!==false))issues.push('child_identity_mismatch_or_unknown');
  if(!Array.isArray(raw?.invariants)||raw.invariants.length)issues.push('invariants_missing_or_failed');
  const measurements=Array.isArray(raw?.measurements)?raw.measurements:[],findings=Array.isArray(raw?.findings)?raw.findings:[];
  if(measurements.length!==1||findings.length!==1)issues.push('missing_or_extra_declared_org');
  const organizations=measurements.map(m=>{
    const observed=findings.filter(f=>f.org===m.org),f=observed.length===1?observed[0]:null,
      observations=Array.isArray(f?.observations)?f.observations:[],rejected=Array.isArray(f?.rejected)?f.rejected:[],
      nonHistorical=observations.filter(o=>o.kind==='need'&&o.timeStatus!=='historical'),rejectedNeeds=rejected.filter(r=>r.kind==='need'),
      errors=[];
    if(!f)errors.push('finding_missing_or_duplicate');
    if(m.nativeNeeds!==8)errors.push('authored_request_denominator_mismatch');
    if(m.evaluatedSources!==24)errors.push('selected_originals_not_all_received_or_processed');
    if(!Number.isSafeInteger(m.detected)||m.detected<0||m.detected>8)errors.push('invalid_detected_count');
    if(m.currentNeedObservations!==nonHistorical.length)errors.push('nonhistorical_observation_count_mismatch');
    if(m.rejectedNeedObservations!==rejectedNeeds.length)errors.push('rejected_need_count_mismatch');
    const exact=m.preciseNeedObservations;
    if(!Number.isSafeInteger(exact)||exact<0||exact>nonHistorical.length||exact<m.detected)errors.push('invalid_reported_exact_observation_count');
    const expectedRecall=finite(m.detected)?m.detected/8:null,
      expectedPrecision=nonHistorical.length?exact/nonHistorical.length:null,
      denominator=nonHistorical.length+rejectedNeeds.length,expectedConservative=denominator?exact/denominator:null;
    for(const [name,expected] of [['recall',expectedRecall],['precision',expectedPrecision],['conservativeReturnedNeedPrecision',expectedConservative]])
      if(expected===null?m[name]!==null:!finite(m[name])||Math.abs(m[name]-expected)>1e-12)errors.push('reported_'+name+'_arithmetic_mismatch');
    if(!Array.isArray(m.omissions)||m.omissions.length!==8-m.detected)errors.push('omissions_count_missing_or_mismatch');
    return {org:m.org,consistent:errors.length===0,issues:errors,
      declared:{authoredRequests:8,selectedOriginals:24},receivedSourceRecords:m.sourceRecordsReceived??null,evaluatedOriginals:m.evaluatedSources??null,
      childReported:{detected:m.detected??null,recall:m.recall??null,preciseNeedObservations:m.preciseNeedObservations??null,
        nonhistoricalNeedObservations:m.currentNeedObservations??null,acceptedNonhistoricalExactTupleFraction:m.precision??null,
        conservativeExactTupleFractionIncludingRejectedNeeds:m.conservativeReturnedNeedPrecision??null,falseMergeCandidates:m.falseMergeCandidates??null},
      observations:observations.map(observationView),rejectedObservations:rejected,omissions:m.omissions??null,
      failedBatches:{measurement:m.failedBatches??null,findings:f?.failedBatches??null},
      needTimeKinds:{current:observations.filter(o=>o.kind==='need'&&o.timeStatus==='current').length,
        historical:observations.filter(o=>o.kind==='need'&&o.timeStatus==='historical').length,
        unknown:observations.filter(o=>o.kind==='need'&&!['current','historical'].includes(o.timeStatus)).length},
      limitedSafety:{inferenceWroteAuthoritativeNeed:m.inferenceWritesAuthoritativeNeed??null,
        sourceInvariantViolations:raw.invariants??null,completeSecurityAssessment:null},
      reportedWall:{batchP50Ms:m.modelBatchMsP50??null,batchP95Ms:m.modelBatchMsP95??null,sourceThroughInterpretationMs:m.sourceThroughInterpretationWallMs??null},
      note:'Recall and fractions are child observer-scored authored exact tuples, not independent truth precision. Unknown time remains explicit; rejected and omitted sources are retained. No language-specific accuracy can be independently reconstructed from this export.'};
  });
  if(organizations.some(o=>!o.consistent))issues.push('measurement_consistency_failed');
  const costs=providerCost(raw?{...raw,modelCalls:Array.isArray(raw.usage)?raw.usage.length:undefined}:null,{missing:!raw,cap:.12});
  let charge=0,chargeUnknown=!Array.isArray(raw?.usage);
  for(const u of raw?.usage??[]){const value=finite(u.cost_usd)&&u.cost_usd>=0?u.cost_usd:finite(u.reserved_usd)&&u.reserved_usd>=0?u.reserved_usd:null;
    if(value===null)chargeUnknown=true;else charge+=value;}
  costs.chargedBudgetUsd=chargeUnknown?Math.max(.12,charge):charge;
  costs.fullCapExposureWhenAnyReservationUnknownUsd=chargeUnknown?.12:null;
  if(costs.providerCalls!==null&&costs.providerCalls>2)issues.push('predeclared_provider_attempts_exceeded');
  return {plan:PLAN,eligibleForReportingExistingInternalScore:issues.length===0,issues,organizations,
    status:raw?.status??'missing',childError:raw?.error??null,wrapperReasons:wrapper?.reasons??null,
    allFailedBatches:findings.flatMap(f=>(f.failedBatches??[]).map(row=>({org:f.org,...row}))),
    costs,legacyCostUsd:raw?.costUsd??null,sourceProof:{initial:wrapper?.initial??null,final:wrapper?.final??null,rawSha256},
    provenanceAudit:{completeOriginalRoster:false,exactVersions:null,completeGoldExport:false,completeSemanticReceipts:false},
    independentK12:'pending_external',newScorerUsed:false,sourceTruthPrecision:null,confidenceCalibration:null,
    limitations:PLAN.unknown,note:PLAN.scope};
}
export function markdown(r){return `# Internal K11/K13 readout\n\n${r.note}\n\nEligible to report the existing child score: ${r.eligibleForReportingExistingInternalScore}. Issues: ${r.issues.join(', ')||'none'}.\n\n`+
  r.organizations.map(o=>`- ${o.org}: ${o.childReported.detected??'unknown'}/8 authored requests; reported recall ${o.childReported.recall??'unknown'}; accepted nonhistorical exact-tuple fraction ${o.childReported.acceptedNonhistoricalExactTupleFraction??'unknown'}; conservative fraction including rejected needs ${o.childReported.conservativeExactTupleFractionIncludingRejectedNeeds??'unknown'}.\n`).join('')+
  `\nFailures/rejections/omissions are retained in JSON. Total provider bill: ${r.costs.totalProviderCostUsd??'unknown'} USD; known subtotal: ${r.costs.knownCostSubtotalUsd??'unknown'} USD.\n\nComplete public ID/version roster and semantic receipts are absent from the child export. Source truth, calibrated confidence, independent K12 accuracy, complete security, byte-level media interpretation and physical service are not measured here. This presentation does not create a new scorer.\n`;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const opts=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return [x.slice(2,i),x.slice(i+1)];}));
  if(opts.run!==PLAN.authority)throw Error('Named read-only ROOT_GO required');
  for(const k of ['raw','wrapper','seal','output'])if(!opts[k])throw Error('Explicit '+k+' required');
  const seal=JSON.parse(await readFile(resolve(opts.seal),'utf8')),self=await readFile(fileURLToPath(import.meta.url));
  if(seal.readerSha256!==sha(self)||JSON.stringify(seal.plan)!==JSON.stringify(PLAN))throw Error('Reader/plan seal changed');
  for(const file of seal.files??[])if(sha(await readFile(file.path))!==file.sha256)throw Error('Sealed reader/dependency/source bytes changed');
  const rawBytes=await readFile(resolve(opts.raw)),wrapperBytes=await readFile(resolve(opts.wrapper));
  const result=presentInternalSemantic(JSON.parse(rawBytes.toString('utf8')),JSON.parse(wrapperBytes.toString('utf8')),{rawSha256:sha(rawBytes)});
  result.files={raw:{path:resolve(opts.raw),sha256:sha(rawBytes)},wrapper:{path:resolve(opts.wrapper),sha256:sha(wrapperBytes)},reader:{sha256:sha(self)},seal:{path:resolve(opts.seal)}};
  await mkdir(dirname(resolve(opts.output)),{recursive:true});
  await writeFile(resolve(opts.output)+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  await writeFile(resolve(opts.output)+'.md',markdown(result),{flag:'wx'});
  console.log(JSON.stringify({output:resolve(opts.output),eligible:result.eligibleForReportingExistingInternalScore,issues:result.issues}));
}
