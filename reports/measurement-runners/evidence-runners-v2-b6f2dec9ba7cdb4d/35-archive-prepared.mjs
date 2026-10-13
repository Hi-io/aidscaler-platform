// Pure byte archiving. No evaluator/world/provider imports or outcome reads.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,basename} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifestPath=resolve('.local/evidence-runners-v2/manifest.json'),bytes=await readFile(manifestPath),manifest=JSON.parse(bytes.toString('utf8'));
const extra=['.local/prepare-evidence-runners-v2.mjs','.local/evidence-runners-v2/preparation.test.mjs',
  '.local/evidence-runners-v2/archive-prepared.mjs','.local/evidence-runners-v2/README.md'];
const rows=[{path:manifestPath,bytes,sha256:sha(bytes)},...await Promise.all([
  ...manifest.files.map(f=>f.path),...manifest.files.map(f=>f.original.path),...manifest.dependencies.map(f=>f.path),...extra
].map(async path=>{const b=await readFile(path);return {path:resolve(path),bytes:b,sha256:sha(b)};}))];
for(const f of [...manifest.files,...manifest.dependencies])if(rows.find(r=>r.path===resolve(f.path))?.sha256!==f.sha256)throw Error('Prepared runner changed before archival');
const folder=resolve('reports/measurement-runners/evidence-runners-v2-'+sha(bytes).slice(0,16));await mkdir(folder,{recursive:true});
const files=[];
for(const [i,row] of rows.entries()){
  const name=String(i).padStart(2,'0')+'-'+basename(row.path),target=resolve(folder,name);
  try{await writeFile(target,row.bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||sha(await readFile(target))!==row.sha256)throw e;}
  files.push({path:row.path,archivedPath:target,sha256:row.sha256,bytes:row.bytes.length});
}
const seal={state:'prepared_not_launched_gate_pending',source:manifest.source,manifest:{path:manifestPath,sha256:sha(bytes)},
  files,providerCallsMadeDuringPreparation:0,worldsStarted:0,
  note:'Exact v2 copies plus untouched predecessors archived. New successful source-bound full/UI and T27 are still required by root finish-v2. No favorable rerun, study result or executable authorization is implied.'};
const sealBytes=Buffer.from(JSON.stringify(seal,null,2)+'\n');
try{await writeFile(resolve(folder,'seal.json'),sealBytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||sha(await readFile(resolve(folder,'seal.json')))!==sha(sealBytes))throw e;}
console.log(JSON.stringify({folder,sealSha256:sha(sealBytes),manifestSha256:sha(bytes),files:files.length,worldsStarted:0,providerCalls:0}));
