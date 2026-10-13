import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,basename} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const folder=resolve('reports/analysis/native-human-primary-all12-20261013-support');await mkdir(folder,{recursive:true});
const helpers=['.local/analyze-native-human-primary-final.mjs','.local/audit-primary-inquiry-attribution.mjs','.local/archive-native-human-primary-final.mjs'];
const artifacts=['reports/analysis/native-human-primary-all12-20261013-closed.json','reports/analysis/native-human-primary-all12-20261013-closed.md',
 'reports/analysis/native-human-primary-all12-20261013-diagnosis.json','reports/analysis/native-human-primary-all12-20261013-diagnosis.md',
 'reports/analysis/native-human-primary-all12-20261013-inquiry-attribution.json',
 'reports/kpi-companion/definitions-v1/seal.json',
 'reports/kpi-companion/native-primary-all12-summary-1791870506706/summary.json',
 'reports/kpi-companion/native-primary-all12-summary-1791870506706/readout.md'];
const helperRefs=[],artifactRefs=[];
for(const file of helpers){const b=await readFile(file),archive=resolve(folder,basename(file));await writeFile(archive,b,{flag:'wx'});helperRefs.push({file:resolve(file),archive,sha256:sha(b)});}
for(const file of artifacts){const b=await readFile(file);artifactRefs.push({file:resolve(file),sha256:sha(b)});}
const readout=JSON.parse(await readFile(artifacts[0],'utf8'));
const manifest={schema:'closed-all12-offline-evidence-manifest-v1',createdAt:new Date().toISOString(),
 provenance:'Original reader and KPI companion sealed before final all12 reading. Integration helpers authored after outcomes; no metrics/eligibility/source changes and no episodes/providers.',
 helpers:helperRefs,artifacts:artifactRefs,reader:readout.reader,protocol:readout.protocol,
 rawRefs:readout.rows.map(r=>({arm:r.arm,seed:r.seed,file:r.file,sha256:r.sha256})),declared:readout.declaredRuns,observed:readout.observedRawRuns,valid:readout.validRuns,
 preservedRunnerExit:{code:1,reason:'summary attempted C_decentralized pairs not declared by the primary protocol',physicalProductFailure:false}};
await writeFile(resolve(folder,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
console.log(JSON.stringify({folder,manifestSha256:sha(Buffer.from(JSON.stringify(manifest,null,2))),artifacts:artifactRefs.map(x=>({file:basename(x.file),sha256:x.sha256}))}));
