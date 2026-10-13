// Descriptive post-outcome attribution, not a new performance estimator.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const readout=JSON.parse(await readFile('reports/analysis/native-human-primary-all12-20261013-closed.json','utf8'));
const rows=[];
for(const w of readout.rows){
  const bytes=await readFile(w.file),raw=JSON.parse(bytes);if(sha(bytes)!==w.sha256)throw Error('RAW_CHANGED');
  const requests=(raw.activities??[]).filter(x=>x.stage==='source-directed-confirmation');
  const perNeed=w.physical.needs.map(n=>{const matching=requests.filter(x=>x.location===n.building);return {
    id:n.id,building:n.building,type:n.type,firstRequestProvenance:matching[0]?.provenance??null,
    requestActivities:matching.length,provenances:[...new Set(matching.map(x=>x.provenance))]};});
  const events=(raw.activities??[]).filter(x=>x.stage==='model-controller-availability');
  rows.push({arm:w.arm,seed:w.seed,rawSha256:w.sha256,perNeed,
    firstRequestCounts:Object.fromEntries([...new Set(perNeed.map(x=>x.firstRequestProvenance))].map(p=>[p??'unknown',perNeed.filter(x=>x.firstRequestProvenance===p).length])),
    requestsOutsidePhysicalCohort:requests.filter(x=>!w.physical.needs.some(n=>n.building===x.location)).length,
    modelClockRecords:events.map(x=>({request:x.request,nativeDeclaredAvailableAt:x.nativeDeclaredAvailableAt,controllerObservedAt:x.controllerObservedAt,measuredProviderWallMs:x.measuredProviderWallMs})),
    maximumModelProviderWallMs:events.length?Math.max(...events.map(x=>x.measuredProviderWallMs)):null,
    lastModelControllerObservedAt:events.length?Math.max(...events.map(x=>x.controllerObservedAt)):null,
    note:'Request activity order/provenance is not proof that a delivered verification originated exclusively in this lane. Shared pending reuse may combine lanes.'});
}
await writeFile('reports/analysis/native-human-primary-all12-20261013-inquiry-attribution.json',JSON.stringify({
  schema:'post-outcome-request-provenance-v1',allDeclaredWorlds:rows.length,rows,
  limits:'Received request activity only; no actual confirmation time inferred from ACK, no model necessity or semantic accuracy inferred.'},null,2),{flag:'wx'});
console.log(JSON.stringify(rows.map(({perNeed,modelClockRecords,...r})=>r)));
