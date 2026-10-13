/** Preparation only by default. No source module is imported and no world/model
 * is started until the separate literal demo authorization is supplied. */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const own=fileURLToPath(import.meta.url),root=resolve(dirname(own),'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const save=(f,x)=>writeFile(f,JSON.stringify(x,null,2));
const readJson=async f=>JSON.parse(await readFile(f,'utf8'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const AUTHORIZATION='ROOT_GO_NATIVE_DEMO';
export const DESIGN=Object.freeze({version:'native-human-observer-microdemo-v1',
  scenario:'S23',arms:['C_manual','B6'],ports:{C_manual:4328,B6:4329},seed:'native-human-demo-2026-01',
  profile:'moderate',count:4,noise:32,reposts:2,formalDelayMs:1800000,horizonMs:3600000,
  grid:5,extentKm:2,pumpMs:60000,clarificationWorkers:2,budgetUsd:.1,maxModelCalls:6,wallLimitMs:900000,
  frameWallMs:750,holdAfterMs:300000,
  physical:'Original finite S23 fleet, stock, permission, inspection and owner review rules. No traffic, resource topup, fabricated need or packet-loss change.',
  clocks:'Native source time remains owned by the copied actual controller. Extra wall pauses expose finite native queues and moving vehicles; they are never added as human work. Actual provider wall remains charged by the existing model availability rule.',
  manual:'Actual native authenticated read→decide→relay receipts; legacy policy:conventional is not used as a human workflow.',
  model:'B6 uses the configured real OpenRouter model with the declared cap; Gemma is labeled Gemma. No simulated model response or Gemini quality claim.',
  presentation:'Two independent observer ports can show the same seeded microcase. Observer truth and actor received perspectives remain distinct. Camera/follow/feed reads are real. World-control POSTs are rejected while a runner owns its clock.',
  limits:['Microdemonstration, not a primary comparative score or new gain estimate. Viewer/host overhead may affect provider wall time.',
    'Native human durations are explicit hypothetical assumptions; source owner review is scripted, not a human trial.',
    'The default simulator A/B algorithm selector is not a C_manual-versus-B6 controller comparison.',
    'A recorded replay must be labeled recorded. This adapter prepares a live standalone episode and never opens/pauses a running study.'],
});

function once(source,needle,replacement) {
  assert.equal(source.split(needle).length-1,1,'Expected one exact instrumentation anchor: '+needle);
  return source.replace(needle,replacement);
}
/** Imports and import.meta.url retain their original file anchors; only the
 * benchmark's harness dependency points at the instrumented local copy. */
export function rebaseSource(source,originalUrl,overrides={}) {
  const rebase=p=>overrides[p]??(p.startsWith('.')?new URL(p,originalUrl).href:p);
  return source.replace(/(\bfrom\s*)(['"])([^'"]+)\2/g,(_m,head,quote,p)=>head+JSON.stringify(rebase(p)))
    .replace(/(\bimport\(\s*)(['"])([^'"]+)\2/g,(_m,head,quote,p)=>head+JSON.stringify(rebase(p)))
    .replaceAll('import.meta.url',JSON.stringify(originalUrl));
}
export function instrumentHarness(source,originalUrl) {
  let body=rebaseSource(source,originalUrl);
  body=once(body,'  awaitReviews = true,\n','  awaitReviews = true,\n  demoObserverPort = 4328,\n');
  body=once(body,'      observerPort: 0,','      observerPort: demoObserverPort,');
  return body;
}
export function instrumentBenchmark(source,originalUrl,harnessUrl) {
  let body=rebaseSource(source,originalUrl,{'./harness.mjs':harnessUrl});
  body=once(body,'  candidateFingerprint, evaluatorBuild, onProgress = () => {}, shouldStop = () => false,',
    '  candidateFingerprint, evaluatorBuild, onProgress = () => {}, shouldStop = () => false,\n  demoObserverPort = 4328, demoReady = async () => {}, demoTick = async () => {}, demoFinished = async () => {},');
  body=once(body,"  const h = await createHarness({ scenario: 'S23', seed, organizations: 4,",
    "  const h = await createHarness({ scenario: 'S23', seed, organizations: 4, demoObserverPort,");
  body=once(body,'  const corpus = installResponseBenchmark(w, { count, noise, reposts, formalDelayMs, silentFraction: 0 });',
    '  const corpus = installResponseBenchmark(w, { count, noise, reposts, formalDelayMs, silentFraction: 0 });\n  await demoReady({ h, arm, profile, seed, sourceManifest: w.manifest, corpusManifest: corpus.manifest });');
  body=once(body,'      const progress = w.advance(target, { maxEvents: 1000000 });',
    '      await demoTick({ arm, sourceNow: w.now, target, turns });\n      const progress = w.advance(target, { maxEvents: 1000000 });');
  body=once(body,'  return result;\n  } finally {','  await demoFinished({ h, result });\n  return result;\n  } finally {');
  return body;
}
export function validateExecuteOptions(options) {
  assert.equal(options.authorization,AUTHORIZATION,'Separate parent ROOT_GO_NATIVE_DEMO required');
  assert.ok(DESIGN.arms.includes(options.arm),'Only the two declared live demo arms');
  assert.ok(options.prepared&&options.seal,'Prepared byte archive and current full/UI/source seal required');
  assert.ok(options.arm!=='B6'||options['real-provider']===true,'B6 must explicitly select the real configured provider');
  return true;
}
const argsOf=argv=>Object.fromEntries(argv.map(s=>{const p=s.indexOf('=');return [s.slice(2,p<0?undefined:p),p<0?true:s.slice(p+1)];}));

export async function prepare(folder=join(root,'reports/native-human-demo',String(Date.now()))) {
  const id=folder.split(/[\\/]/).at(-1),moduleDir=join(root,'.local/native-human-demo-prepared',id);
  assert.match(id,/^[0-9]+$/,'New timestamped demo preparation');
  try{await access(join(folder,'protocol.json'));throw Error('DEMO_PREPARATION_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(folder,{recursive:true});await mkdir(moduleDir,{recursive:true});
  const paths={harness:join(root,'evaluation/harness.mjs'),benchmark:join(root,'evaluation/human-capacity-benchmark.mjs')};
  const [harness,benchmark,helper]=await Promise.all([readFile(paths.harness,'utf8'),readFile(paths.benchmark,'utf8'),readFile(own)]);
  const harnessCopy=join(moduleDir,'observer-harness.mjs'),benchmarkCopy=join(moduleDir,'observer-human-capacity.mjs');
  const copies={harness:instrumentHarness(harness,pathToFileURL(paths.harness).href),
    benchmark:instrumentBenchmark(benchmark,pathToFileURL(paths.benchmark).href,pathToFileURL(harnessCopy).href)};
  for(const [kind,body]of Object.entries(copies)) {
    const target=kind==='harness'?harnessCopy:benchmarkCopy;
    await writeFile(target,body);await writeFile(join(folder,'instrumented-'+kind+'.mjs'),body);
    await writeFile(join(folder,'original-'+kind+'.mjs'),kind==='harness'?harness:benchmark);
  }
  await writeFile(join(folder,'native-human-demo.mjs'),helper);
  const guidePath=join(root,'.local/native-human-demo-plan.md');
  const guide=await readFile(guidePath);await writeFile(join(folder,'plan.md'),guide);
  const test=await readFile(join(root,'.local/native-human-demo.test.mjs'));await writeFile(join(folder,'native-human-demo.test.mjs'),test);
  const protocol={design:DESIGN,preparedAt:new Date().toISOString(),prepared:true,executed:false,worldsStarted:0,modelCalls:0,
    folder,moduleDir,original:{harness:{path:paths.harness,sha256:sha(harness)},benchmark:{path:paths.benchmark,sha256:sha(benchmark)}},
    instrumented:{harness:{path:harnessCopy,sha256:sha(copies.harness)},benchmark:{path:benchmarkCopy,sha256:sha(copies.benchmark)}},
    helperSha256:sha(helper),testSha256:sha(test),guideSha256:sha(guide),instrumentation:['Rebased import URLs retain canonical fingerprint roots.',
      'Explicit fixed observer ports make same-origin observer login valid.', 'Callbacks persist ignored private access handles, add wall-only presentation pacing and hold servers open after actual completion.',
      'The live observer adapter rejects world-control mutations; camera, scoped snapshots, feeds and measurements remain read-only native views.']};
  await save(join(folder,'protocol.json'),protocol);return protocol;
}

async function evidenceGate(sealPath,harness,builds) {
  const seal=await readJson(sealPath),v=await readJson(seal.verification),u=await readJson(seal.ui.path),b=await readJson(seal.engineBenchmark);
  for(const [path,digest]of [[seal.verification,seal.verificationByteHash],[seal.ui.path,seal.ui.byteHash],[seal.engineBenchmark,seal.engineBenchmarkByteHash]])
    assert.equal(sha(await readFile(path)),digest,'A sealed evidence artifact changed');
  const current={candidate:await harness.buildFingerprint(),evaluator:await harness.evaluatorFingerprint(),simulator:await builds.requireLoadedSimulatorBuild()};
  assert.equal(v.passed,true);assert.equal(v.candidateChanged,false);assert.equal(v.evaluatorChanged,false);assert.equal(v.simulatorChanged,false);
  for(const kind of ['candidate','evaluator','simulator']) {
    assert.equal(seal[kind+'Fingerprint'],current[kind]);assert.equal(v[kind+'Fingerprint'],current[kind]);assert.equal(v[kind+'FinalFingerprint'],current[kind]);
    assert.equal(seal.ui[kind+'Fingerprint'],current[kind]);
  }
  assert.equal(seal.ui.passed,true);assert.ok(Array.isArray(u.checks)&&u.checks.length>0);assert.equal(u.errors?.length??0,0);
  assert.equal(b.valid,true);assert.equal(b.complete,true);assert.equal(b.sourceUnchanged,true);
  assert.equal(b.engineBuildInitial,current.simulator);assert.equal(b.engineBuildFinal,current.simulator);
  return current;
}

/** This is observer instrumentation, outside the native engine. A viewer cannot
 * play/reset/inject/compare or act as an owner inside this live microepisode. */
export function installPassiveObserver(lab,arm) {
  const listeners=lab.observer.listeners('request');lab.observer.removeAllListeners('request');
  const label=arm==='C_manual'?'C_manual · modeled finite read / decide / relay':'B6 · actual configured model perception';
  const markup=`<script>addEventListener('DOMContentLoaded',()=>{const n=document.createElement('div');n.textContent=${JSON.stringify(label+' · live microdemo, not primary evidence · runner owns source clock')};n.style.cssText='position:fixed;left:12px;bottom:8px;z-index:9999;background:#fff;color:#263444;padding:7px 12px;border:1px solid #d8dde5;border-radius:9px;font:11px system-ui;pointer-events:none;max-width:90vw';document.body.append(n);for(const id of ['play','speed','toggleConfig','toggleCommand']){const e=document.getElementById(id);if(e){e.disabled=true;e.title='The demo runner owns the source clock and physical commands';}}});</script>`;
  const wrapper=(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(req.method==='POST'&&pathname.startsWith('/api/')&&pathname!=='/api/login') {
      res.writeHead(409,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:'DEMO_RUNNER_OWNS_CLOCK',message:'This standalone microdemo is read-only. Camera, follow, actor perspective and feeds remain available.'}));return;
    }
    if(req.method==='GET'&&['/','/index.html'].includes(pathname)) {
      const end=res.end.bind(res);res.end=(chunk,...more)=>{
        if(chunk&&(res.getHeader('Content-Type')??'').includes('text/html')) {
          res.removeHeader('Content-Length');chunk=String(chunk).replace('</body>',markup+'</body>');
        }
        return end(chunk,...more);
      };
    }
    for(const listener of listeners)listener(req,res);
  };
  lab.observer.on('request',wrapper);return ()=>{lab.observer.removeListener('request',wrapper);for(const l of listeners)lab.observer.on('request',l);};
}

async function execute(options) {
  validateExecuteOptions(options);
  const protocol=await readJson(resolve(options.prepared)),folder=dirname(resolve(options.prepared));
  assert.deepEqual(protocol.design,DESIGN,'The declared microdemo protocol changed');
  assert.equal(protocol.helperSha256,sha(await readFile(own)));
  for(const kind of ['harness','benchmark'])for(const group of ['original','instrumented'])
    assert.equal(sha(await readFile(protocol[group][kind].path)),protocol[group][kind].sha256,'A prepared source byte archive changed');
  const harness=await import(pathToFileURL(protocol.instrumented.harness.path));
  const builds=await import(pathToFileURL(join(root,'evaluation/simulator-build.mjs')));
  const fingerprints=await evidenceGate(resolve(options.seal),harness,builds);
  const bench=await import(pathToFileURL(protocol.instrumented.benchmark.path));
  if(options.arm==='B6'&&!process.env.OPENROUTER_API_KEY) {
    try{process.loadEnvFile(join(root,'.env'));}catch{}
    assert.ok(process.env.OPENROUTER_API_KEY,'Configured real provider key is required; never printed or archived');
  }
  const id=String(Date.now())+'-'+options.arm,resultFolder=join(root,'reports/native-human-demo',id);
  const privateFolder=join(root,'.local/native-human-demo-access',id);
  await mkdir(resultFolder,{recursive:true});await mkdir(privateFolder,{recursive:true});
  // Keep any generated bootstrap key, media evidence and runtime paths inside
  // this ignored demo handle, even when a shell inherited normal app paths.
  process.env.NEXO_LOCAL_DIR=join(privateFolder,'config');
  process.env.EVIDENCE_DIR=join(privateFolder,'evidence');
  process.env.DATA_DIR=join(privateFolder,'pgdata');
  await save(join(resultFolder,'execution-protocol.json'),{...protocol,executed:true,authorization:AUTHORIZATION,arm:options.arm,fingerprints,
    publicObserverUrl:`http://127.0.0.1:${DESIGN.ports[options.arm]}`,privateAccess:'Ignored local handle only; no credentials in report or stdout',
    viewerMutationGuard:'All API POST except authenticated same-origin login refused by ignored adapter, not by changed engine source.'});
  let stop=false,restore=null;const onSignal=()=>{stop=true;};
  process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(request,init)=>{
    const url=new URL(typeof request==='string'||request instanceof URL?request:request.url);
    const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    assert.ok(local||(options.arm==='B6'&&url.origin==='https://openrouter.ai'&&['/api/v1/models','/api/v1/chat/completions'].includes(url.pathname)), 'External fetch outside the explicitly configured real provider refused');
    return originalFetch(request,init);
  };
  try {
    const result=await bench.runHumanCapacityEpisode({...DESIGN,arm:options.arm,condition:'moderate',candidateFingerprint:fingerprints.candidate,
      evaluatorBuild:await bench.humanCapacityEvaluatorFingerprint(),demoObserverPort:DESIGN.ports[options.arm],shouldStop:()=>stop,
      demoReady:async({h})=>{
        restore=installPassiveObserver(h.lab,options.arm);
        // This is the only persistent observer access handle. It is deliberately
        // ignored, never copied to reports and never emitted on stdout.
        await save(join(privateFolder,'observer-access.json'),{observerUrl:`http://127.0.0.1:${h.lab.observerPort}`,observerKey:h.lab.observerKey,
          sourceUrl:`http://127.0.0.1:${h.lab.sourcePort}`,arm:options.arm,kind:'standalone-live-microdemo',sourceClockOwner:'native copied controller',
          apps:h.apps.map(a=>({org:a.config.org,url:a.url}))});
        console.log(JSON.stringify({ready:true,arm:options.arm,observerUrl:`http://127.0.0.1:${h.lab.observerPort}`,accessHandle:'Ignored native-human-demo-access handle',sourceClockOwnedByRunner:true}));
      },
      demoTick:async()=>{await sleep(DESIGN.frameWallMs);},
      demoFinished:async({result})=>{
        const adapterFinal={harness:sha(await readFile(protocol.instrumented.harness.path)),benchmark:sha(await readFile(protocol.instrumented.benchmark.path)),helper:sha(await readFile(own))};
        const adapterUnchanged=adapterFinal.harness===protocol.instrumented.harness.sha256&&adapterFinal.benchmark===protocol.instrumented.benchmark.sha256&&adapterFinal.helper===protocol.helperSha256;
        await save(join(resultFolder,'episode.json'),{...result,demoOnly:true,comparativeClaimAllowed:false,
          adapterUnchanged,adapterFinal,instrumentedHarnessSha256:protocol.instrumented.harness.sha256,instrumentedBenchmarkSha256:protocol.instrumented.benchmark.sha256});
        console.log(JSON.stringify({episodeFinished:true,arm:options.arm,status:result.status,holdAfterMs:DESIGN.holdAfterMs,report:resultFolder,comparativeClaimAllowed:false}));
        const deadline=Date.now()+DESIGN.holdAfterMs;while(!stop&&Date.now()<deadline)await sleep(500);
      },
    });
    return {executed:true,arm:options.arm,status:result.status,report:resultFolder,comparativeClaimAllowed:false};
  } finally {restore?.();globalThis.fetch=originalFetch;process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);}
}

async function cli() {
  const options=argsOf(process.argv.slice(2));
  if(options.execute) {console.log(JSON.stringify(await execute(options)));return;}
  const protocol=await prepare();console.log(JSON.stringify({prepared:true,executed:false,folder:protocol.folder,worldsStarted:0,modelCalls:0}));
}
if(process.argv[1]&&resolve(process.argv[1])===own)cli().catch(e=>{console.error(e.message);process.exitCode=1;});
