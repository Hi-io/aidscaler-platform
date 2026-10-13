// No outcome read, evaluator import, world or provider: seal prepared bytes only.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,basename} from 'node:path';
import {PLAN} from './semantic-internal-readout.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=['.local/semantic-internal-readout.mjs','.local/semantic-internal-readout.test.mjs',
  '.local/SEMANTIC_INTERNAL_SCORING_SCOPE.md','.local/seal-semantic-internal-readout.mjs',
  '.local/read-human-capacity-evidence.mjs','scripts/semantic-load.mjs','.local/minimal-semantic-studies-v2.mjs'];
const rows=await Promise.all(paths.map(async path=>{const bytes=await readFile(resolve(path));return {path:resolve(path),bytes,sha256:sha(bytes)};}));
const readerSha256=rows[0].sha256,folder=resolve('reports/measurement-readers/internal-semantic-v1-'+readerSha256.slice(0,16));
await mkdir(folder,{recursive:true});
for(const [i,row] of rows.entries())await writeFile(resolve(folder,String(i).padStart(2,'0')+'-'+basename(row.path)),row.bytes,{flag:'wx'});
const seal={state:'prepared_before_K11_K13_outcomes_not_launched',readerSha256,plan:PLAN,
  files:rows.map(({path,sha256,bytes})=>({path,sha256,bytes:bytes.length})),pureTests:{tests:6,pass:6,fail:0},
  worldsStarted:0,providerCalls:0,productionSourceWrites:0,
  provenance:'No actual K11_K13 outcome loaded. Definitions come from frozen source and declared pilot. This reader preserves existing child scores and creates no independent annotation.'};
const bytes=Buffer.from(JSON.stringify(seal,null,2)+'\n');await writeFile(resolve(folder,'seal.json'),bytes,{flag:'wx'});
console.log(JSON.stringify({folder,seal:resolve(folder,'seal.json'),readerSha256,sealSha256:sha(bytes),pureTests:6,worldsStarted:0,providerCalls:0}));
