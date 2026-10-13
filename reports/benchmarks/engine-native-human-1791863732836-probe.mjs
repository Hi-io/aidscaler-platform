import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';

const root = process.cwd(), id = Date.now(), wallLimitMs = 600000;
const hash = value => createHash('sha256').update(value).digest('hex');
const freshBuild = () => execFileSync(process.execPath, ['--input-type=module', '-e',
  "import {ENGINE_BUILD} from './contracts/config.mjs'; process.stdout.write(ENGINE_BUILD)"],
  {cwd:root, encoding:'utf8', windowsHide:true});
const sourceHashes = async () => {
  const files = (await Promise.all(['contracts','engine','generators','content','scenarios','sources'].map(async dir =>
    (await readdir(dir)).filter(n=>n.endsWith('.mjs')).map(n=>`${dir}/${n}`)))).flat()
    .concat((await readdir('viewer',{recursive:true})).filter(n=>/\.(?:m?js|html|css)$/.test(n)).map(n=>'viewer/'+n.replaceAll('\\','/')),
      ['adapters/reference.mjs','evaluation/metrics.mjs',
      'scripts/benchmark.mjs','scripts/benchmark-worker.mjs', 'manifests/unit.json','manifests/city.json','manifests/region.json']).sort();
  return Object.fromEntries(await Promise.all(files.map(async f => [f,hash((await readFile(f,'utf8')).replaceAll('\r\n','\n'))])));
};
await mkdir('runs/benchmarks',{recursive:true});
const prefix = `runs/benchmarks/native-human-${id}`, before = freshBuild(), filesBefore=await sourceHashes();
const protocol = { declaredAt:new Date().toISOString(), purpose:'Current isolated candidate engine headless performance and integrity only',
  engineBuild:before, wallLimitMs, profiles:['unit','city','region','default-48h','information-10000'],
  sourceHashes:filesBefore, hardware:{os:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,
    logicalCpus:os.availableParallelism(), memoryGiB:os.totalmem()/1073741824,node:process.version},
  command:[process.execPath,'scripts/benchmark.mjs'],
  helperSha256:hash(await readFile('.local/engine-current-probe.mjs')),
  concurrency:'Parent authorized one small no-provider platform smoke on the same host; subsequent full verification may overlap. Wall speed is not a hardware-isolated guarantee.',
  limits:['No provider, platform, UI or display rendering. No x1000 inference claim.',
    'Concurrent platform laboratory processes may compete for this machine; wall time is one run, not a hardware-isolated performance guarantee.',
    'Default benchmark includes synthetic traffic/information/health; source-only information profile is not disaster-frequency calibration.',
    'Retain every profile, including slow or incomplete results. Source mutation invalidates the aggregate. No tuning after observing results.'] };
await writeFile(`${prefix}-protocol.json`,JSON.stringify(protocol,null,2));
await writeFile(`${prefix}-probe.mjs`,await readFile('.local/engine-current-probe.mjs'));
console.log(`PREREGISTERED ${prefix}-protocol.json ENGINE_BUILD ${before}`);
const start=performance.now(), child=spawn(process.execPath,['scripts/benchmark.mjs'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',timedOut=false;
child.stdout.on('data',d=>stdout+=d.toString());
child.stderr.on('data',d=>{stderr+=d.toString(); process.stdout.write(d);});
const timer=setTimeout(()=>{timedOut=true; child.kill();},wallLimitMs);
const {code,signal}=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
clearTimeout(timer);
let report=null,parseError=null;
try { if(stdout.trim()) report=JSON.parse(stdout); } catch(e) {parseError=e.message;}
const after=freshBuild(),filesAfter=await sourceHashes(), unchanged=before===after&&JSON.stringify(filesBefore)===JSON.stringify(filesAfter),
  profileBuildsMatch=report?.results?.every(r=>r.engineBuild===before)??false,
  ledgerValid=report?.results?.every(r=>r.ledgerValid===true)??false,
  result={recordedAt:new Date().toISOString(),protocol:`${prefix}-protocol.json`,engineBuildInitial:before,engineBuildFinal:after,
    sourceUnchanged:unchanged,sourceHashesAfter:filesAfter,profileBuildsMatch,ledgerValid,
    complete:code===0&&!timedOut&&report?.results?.length===5,
    valid:code===0&&!timedOut&&unchanged&&profileBuildsMatch&&ledgerValid&&report?.results?.length===5,
    process:{code,signal,timedOut,wallLimitMs,totalWallMs:performance.now()-start,parseError},
    benchmark:report,stderr};
await writeFile(`${prefix}.json`,JSON.stringify(result,null,2));
await writeFile(`${prefix}-stdout.txt`,stdout);
console.log(JSON.stringify({artifact:`${prefix}.json`,valid:result.valid,complete:result.complete,
  engineBuildInitial:before,engineBuildFinal:after,sourceUnchanged:unchanged,
  profiles:report?.results?.map(r=>({name:r.name,wallMs:r.wallMs,effectiveRate:r.effectiveRate,
    events:r.events,posts:r.posts,peakRssMiB:r.peakRssMiB,ledgerValid:r.ledgerValid}))},null,2));
if(!result.valid) process.exitCode=1;
