import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Offline, all-world diagnosis only. This reader imports no mutable evaluator,
// contacts no source/provider, and never passes physical cohort IDs to a controller.
const base = resolve('../../.candidate-development/nexo-platform');
const companionPath = resolve(base, 'reports/analysis/frozen-physical-primary-all-closed-1791857386133.json');
const companionBytes = await readFile(companionPath), companion = JSON.parse(companionBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const components = ['onsetToThisAuthorizationMs', 'authorizationToLoadedDepartureMs', 'loadedDepartureToArrivalMs', 'arrivalToUsefulServiceMs'];
const mean = values => values.length && values.every(Number.isFinite) ? values.reduce((a,b)=>a+b,0)/values.length : null;
const rows = [];
for (const detail of companion.details) {
  const bytes = await readFile(detail.file), report = JSON.parse(bytes);
  if (sha(bytes) !== detail.sha256) throw Error('Companion file bytes changed: '+detail.file);
  const inquiryMap = new Map();
  const remember = (id, entity, kind, sourceIds = []) => {
    if (!id || !entity) return;
    const old = inquiryMap.get(id) ?? { id, entity, kinds: new Set(), sourceIds: new Set() };
    old.kinds.add(kind); sourceIds.forEach(s=>old.sourceIds.add(s)); inquiryMap.set(id,old);
  };
  for (const a of report.activities) {
    if (a.stage === 'source-directed-confirmation') remember(a.inspection,a.location,'direct-need',a.references);
    for (const v of a.verifications ?? []) remember(v.id,v.location,'semantic-need');
    for (const o of a.sourceOpportunities?.opportunities ?? []) remember(o.id,o.entity,o.kind,o.sourceIds);
  }
  const queries = [...inquiryMap.values()].map(q=>({...q,kinds:[...q.kinds],sourceIds:[...q.sourceIds]}));
  const cohort = new Set(detail.needs.map(n=>n.building));
  const multiple = [...new Set(queries.map(q=>q.entity))].map(entity=>({entity,inspectionIds:queries.filter(q=>q.entity===entity).map(q=>q.id)})).filter(q=>q.inspectionIds.length>1);
  rows.push({ file:detail.file,sha256:detail.sha256,arm:detail.arm,seed:detail.seed,status:detail.status,
    validForComparison:detail.validForComparison,eligible:detail.eligible,first:detail.first,sufficient:detail.sufficient,
    cost:detail.costs,errors:detail.errors,invariants:detail.invariants,
    physicalStagesMs:Object.fromEntries(components.map(k=>[k,mean(detail.needs.map(n=>n.sufficientThresholdContribution?.components?.[k]))])),
    byResource:detail.byResource,
    hostWallMs:report.wallMs,providerHttpSumMs:report.usage.every(u=>Number.isFinite(Number(u.wall_ms)))?report.usage.reduce((s,u)=>s+Number(u.wall_ms),0):null,
    nativeModelClockMs:report.metrics.modelWallMs,modelCallCount:report.usage.length,
    eventCounts:report.metrics.eventCounts,planningTurns:report.operationalDiagnostics.planningTurns,
    fuel:report.metrics.physical?.fuel,physical:report.metrics.physical,utilization:report.metrics.utilization,
    sourceCoverage:report.sourceCoverage,inquiries:queries,nonCohortInquiries:queries.filter(q=>!cohort.has(q.entity)),multipleInquiriesSameEntity:multiple,
    needs:detail.needs.map(n=>({id:n.id,building:n.building,type:n.type,unit:n.unit,quantity:n.quantity,served:n.served,
      censored:n.censored,timeToSufficientServiceMs:n.timeToSufficientServiceMs,
      confirmedNeedReceivedAtSourceClock:n.confirmedNeedReceivedAtSourceClock,directInquiries:n.directInquiries,
      firstUsefulContribution:n.firstUsefulContribution,sufficientThresholdContribution:n.sufficientThresholdContribution,issues:n.issues})) });
}
const pairs = [];
for (const candidate of rows.filter(r=>r.arm==='B6')) for (const referenceArm of ['B5','B8']) {
  const reference = rows.find(r=>r.seed===candidate.seed&&r.arm===referenceArm);
  if (!reference) throw Error('Declared reference absent');
  pairs.push({ seed:candidate.seed,candidate:'B6',reference:referenceArm,
    sufficientExtraMin:(candidate.sufficient.restrictedMeanMs-reference.sufficient.restrictedMeanMs)/60000,
    sufficientReductionPct:100*(1-candidate.sufficient.restrictedMeanMs/reference.sufficient.restrictedMeanMs),
    stagesExtraMin:Object.fromEntries(components.map(k=>[k,(candidate.physicalStagesMs[k]-reference.physicalStagesMs[k])/60000])),
    sufficientCoverage:[candidate.sufficient.completed,reference.sufficient.completed],
    verificationCompleted:[candidate.eventCounts.verification_completed,reference.eventCounts.verification_completed],
    nativeDeficits:Object.fromEntries(Object.keys(candidate.byResource).map(type=>[type,{
      unit:candidate.byResource[type].unit,
      candidateUnitHours:candidate.byResource[type].nativeMetrics.uncoveredUnitMs/3600000,
      referenceUnitHours:reference.byResource[type].nativeMetrics.uncoveredUnitMs/3600000,
    }])) });
}
const output={schema:'offline-frozen-three-causal-v1',generatedAt:new Date().toISOString(),readerSha256:sha(await readFile(new URL(import.meta.url))),
  companion:{file:companionPath,sha256:sha(companionBytes)},freeze:companion.readout.requestedFreeze,
  selection:'All nine declared worlds and all 24 physical outcomes retained in each world; no exclusion of the schema-error world.',rows,pairs,
  aggregate:Object.fromEntries(['B5','B8'].map(reference=>[reference,{pairedSeeds:pairs.filter(p=>p.reference===reference).length,
    canonicalRatioOfMeanRmstReductionPct:100*(1-mean(rows.filter(r=>r.arm==='B6').map(r=>r.sufficient.restrictedMeanMs))/mean(rows.filter(r=>r.arm===reference).map(r=>r.sufficient.restrictedMeanMs))),
    meanPairedReductionPct:mean(pairs.filter(p=>p.reference===reference).map(p=>p.sufficientReductionPct)),
    meanExtraMin:mean(pairs.filter(p=>p.reference===reference).map(p=>p.sufficientExtraMin)),
    stageExtraMin:Object.fromEntries(components.map(k=>[k,mean(pairs.filter(p=>p.reference===reference).map(p=>p.stagesExtraMin[k]))]))}])),
  limitations:['Before authorization mixes evidence, queue, draft, owner and fleet wait; it is not wholly perception.',
    'A submitted inquiry ACK is not its completed observation. Missing receipt clocks remain null.',
    'Non-cohort inquiries are not automatically false or useless; this labels only their offline cohort membership.',
    'Host SQL/CPU wall time is separate from provider/native model clock.',
    'Physical contribution components refer to that shipment, not an inferred causal counterfactual.']};
const out=resolve('.local/frozen-three-causal-1791857386133.json'); await writeFile(out,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({out,rows:rows.length,aggregate:output.aggregate,
  summary:rows.map(r=>({seed:r.seed,arm:r.arm,rmstMin:r.sufficient.restrictedMeanMs/60000,stagesMin:Object.fromEntries(components.map(k=>[k,r.physicalStagesMs[k]/60000])),
    verifications:r.eventCounts.verification_completed,uniqueRecordedInquiries:r.inquiries.length,nonCohort:r.nonCohortInquiries.length,
    duplicatedEntities:r.multipleInquiriesSameEntity,providerHttpSeconds:r.providerHttpSumMs/1000,nativeModelClockMs:r.nativeModelClockMs,
    calls:r.modelCallCount,errors:r.errors}))}));
