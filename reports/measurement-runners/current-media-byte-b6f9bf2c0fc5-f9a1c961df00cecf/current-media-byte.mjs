/** Controlled wrapper only. No child, decoder, world or provider runs during
 * preparation. The original media-smoke source is executed without edits. */
import { readFile, writeFile, mkdir, copyFile, open } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { archiveProbe, acquireProbeLock, validateProbeGate, sha256, exists } from './evidence-probe-guards.mjs';

const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..');
export const SOURCE_PIN={candidateFingerprint:'9b4de8b7769c69a3279067a8a093ef6d2392ec8a9728e704f871a184a69934e3',
  evaluatorFingerprint:'4b4d289e387b49da8d79fdccb260a67919b74339432731373204d96aee6668b3',
  simulatorBuild:'561e6a02fbde1d047f999c4f077cbff83c438ba5c508c4d8d18bbf59ff78e94b'};
export const FIXTURES=['return-note.wav','water-storage.png','access.mp4','field-note.pdf'];
export const PLAN={version:'current-media-byte-controlled-v1',authorization:'ROOT_GO_MEDIA_BYTES',source:SOURCE_PIN,
  childScript:'scripts/media-smoke.mjs',fixtures:FIXTURES,maxCalls:6,budgetUsd:.25,expectedModel:'google/gemma-4-31b-it',
  sharedLock:'.local/PAID_RESEARCH_STUDY.lock',softStopAfterMs:900000,
  scope:'Actual synthetic WAV/PNG/MP4/PDF bytes + private-by-default metadata-free public rendition fixture. Byte/decode/model-contract integration, not semantic accuracy, actual aid, public publishing or field effectiveness.',
  stopping:'The intact four-fixture child is one settled boundary. Stop/signal/soft deadline is recorded but never kills the child or a provider; native decoder/provider/call/budget bounds remain unchanged. A requested stop may still permit remaining bounded fixture calls before child settlement.',
  isolation:'Run the intact source script by absolute path from a new ignored task CWD with byte-identical fixture copies. Relative evidence/latest reports go there; no legacy result is overwritten. HOME/CODEX_HOME are not reassigned.',
  syntheticReceipt:'The child authors byte-smoke-receipt only for image transformation/publication guards. It is explicitly syntheticFixture and must never count as physical aid.',
  cost:'Full ledger retained. Null/missing/failed billing is unknown; full .25 cap exposure retained without counting known subtotal twice. Legacy totals kept separately, never null-to-zero.',
  gate:'Named ROOT_GO + current unchanged three-hash/full483/247/UI113 proof archived before spawn; post-child source/fixture/script hashes checked.',
};
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const save=(f,x)=>writeFile(f,JSON.stringify(x,null,2),{flag:'wx'});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function price(x){if(x==null||typeof x==='boolean'||typeof x==='string'&&!x.trim())return null;const n=Number(x);return Number.isFinite(n)&&n>=0?n:null;}
export function ledgerCost(raw,{cap=PLAN.budgetUsd}={}) {
  const rows=Array.isArray(raw?.usage)?raw.usage:null;
  if(!rows)return {providerCalls:null,knownCostSubtotalUsd:0,totalCostUsd:null,unknownCostRows:null,chargedExposureUsd:cap,ledgerMissing:true};
  let known=0,unknown=0;for(const row of rows){const n=price(row.cost_usd);if(n===null)unknown++;else known+=n;}
  return {providerCalls:rows.length,knownCostSubtotalUsd:known,totalCostUsd:unknown?null:known,unknownCostRows:unknown,
    chargedExposureUsd:unknown?Math.max(cap,known):known,ledgerMissing:false,
    note:'Unknown cost reserves the whole episode cap; known subtotal is part of that exposure, not added to it again.'};
}
export function safeChildOutput(text) {
  const known=new Set(FIXTURES.map(f=>'Processed actual bytes: '+f));
  known.add('Processed actual bytes: reviewed public image rendition (private by default)');
  return String(text).split(/\r?\n/).map(s=>s.trim()).filter(s=>known.has(s));
}
export function childEnvironment(parent,taskDirectory) {
  const out={...parent,NEXO_LOCAL_DIR:join(taskDirectory,'.local/runtime'),DATA_DIR:join(taskDirectory,'.local/unused-db')};
  // Existing OS profile and configured Python/model paths remain unchanged.
  // Source/DB/HTTP secrets outside the provider are unnecessary for this child.
  for(const k of ['DATABASE_URL','SOURCE_AGENT_KEY','SOURCE_HUMAN_KEY','NEXO_MCP_KEY','NEXO_BOOTSTRAP_PASSWORD','NODE_OPTIONS'])delete out[k];
  return out;
}
export function readout(raw,{current=SOURCE_PIN,final,exit={code:null,signal:null},stopRequested=false,fixtureManifest=null}={}) {
  const cost=ledgerCost(raw),reasons=[];
  if(!raw)reasons.push('missing_raw_media_outcome');
  if(exit.code!==0||exit.signal!==null)reasons.push('child_failed_or_signal');
  if(raw?.error)reasons.push('raw_child_error:'+raw.error);
  if(raw&&raw.candidateFingerprint!==current.candidateFingerprint)reasons.push('child_candidate_mismatch');
  if(!final||['candidateChanged','evaluatorChanged','simulatorChanged'].some(k=>final[k]!==false))reasons.push('final_source_unknown_or_changed');
  const rows=raw?.results??[];
  for(const filename of FIXTURES){const matching=rows.filter(r=>r.filename===filename);if(matching.length!==1||matching[0].passed!==true)reasons.push('missing_failed_or_duplicate_fixture:'+filename);
    const declared=fixtureManifest?.find(f=>f.filename===filename);if(!declared||matching[0]?.contentHash!==declared.sha256)reasons.push('missing_or_mismatched_byte_hash:'+filename);}
  const rendition=rows.filter(r=>r.filename==='reviewed-public-rendition.png');
  if(rendition.length!==1||rendition[0].passed!==true||rendition[0].syntheticReceiptFixture!==true||rendition[0].notPublishedByDefault!==true||rendition[0].metadataStripped!==true)reasons.push('rendition_contract_incomplete');
  if(!Array.isArray(raw?.usage))reasons.push('missing_usage_ledger');
  if(cost.providerCalls!==null&&(cost.providerCalls<1||cost.providerCalls>PLAN.maxCalls))reasons.push('actual_provider_call_bound');
  if(raw&&raw.model!==PLAN.expectedModel)reasons.push('unexpected_configured_model');
  if((raw?.usage??[]).some(r=>r.model!==PLAN.expectedModel))reasons.push('unexpected_actual_model');
  if(cost.knownCostSubtotalUsd>PLAN.budgetUsd+1e-9)reasons.push('known_cost_exceeds_declared_cap');
  return {study:'current_media_bytes',status:!raw?'failed_missing_outcome':reasons.length?'incomplete_or_invalid':'completed_byte_integration',
    eligibleForByteIntegration:reasons.length===0,reasons,stopRequested,cost,costClosed:cost.totalCostUsd!==null,legacyReportedCostUsd:raw?.costUsd??null,
    actualModels:[...new Set((raw?.usage??[]).map(r=>r.model).filter(x=>typeof x==='string'))],
    results:rows,rawError:raw?.error??null,rawKind:raw?.kind??null,notAccuracyValidation:raw?.notAccuracyValidation??null,
    physicalAid:null,independentSemanticAccuracy:null,publicPublishing:null,note:PLAN.scope};
}

async function inputBytes() {
  const child=await readFile(join(root,PLAN.childScript)),fixtures=await Promise.all(FIXTURES.map(async filename=>{
    const bytes=await readFile(join(root,'.local/media-fixtures',filename));return {filename,sha256:sha256(bytes),bytes:bytes.length};}));
  return {childScriptSha256:sha256(child),fixtures};
}
export async function archiveCurrentMedia(freezePath=join(root,'reports/measurement-freeze-current.json')) {
  const freezeBytes=await readFile(resolve(freezePath)),freeze=JSON.parse(freezeBytes);validateProbeGate(freeze,SOURCE_PIN);
  const bundle=await inputBytes(),bundleHash=sha256(JSON.stringify(bundle));
  const archive=await archiveProbe({names:['current-media-byte.mjs','current-media-byte.test.mjs','current-media-byte-guide.md','evidence-probe-guards.mjs'],
    tag:'current-media-byte-'+bundleHash.slice(0,12),root,plan:{...PLAN,...bundle,freezeSha256:sha256(freezeBytes)}});
  async function exact(name,bytes){const target=join(archive.folder,name);let old;try{old=await readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(old)assert.equal(sha256(old),sha256(bytes),'Never overwrite a changed immutable input');else await writeFile(target,bytes,{flag:'wx'});}
  await exact('original-media-smoke.mjs',await readFile(join(root,PLAN.childScript)));await exact('measurement-freeze.json',freezeBytes);
  for(const f of FIXTURES)await exact(f,await readFile(join(root,'.local/media-fixtures',f)));
  return {...archive,bundle,bundleHash,freezeSha256:sha256(freezeBytes)};
}

async function runtime() {
  const h=await import(pathToFileURL(join(root,'evaluation/harness.mjs'))),b=await import(pathToFileURL(join(root,'evaluation/simulator-build.mjs')));
  return {h,b,current:{candidateFingerprint:await h.buildFingerprint(),evaluatorFingerprint:await h.evaluatorFingerprint(),simulatorBuild:await b.requireLoadedSimulatorBuild()}};
}
export async function run(options={}) {
  if(options.run!==PLAN.authorization)return {state:'prepared_not_launched',worldsStarted:0,providerCalls:0,plan:PLAN};
  const lib=await runtime();assert.deepEqual(lib.current,SOURCE_PIN,'Pinned current sources required');
  const freezePath=resolve(options.freeze??join(root,'reports/measurement-freeze-current.json')),freeze=await json(freezePath);validateProbeGate(freeze,lib.current);
  assert.equal(process.env.MODEL_ID??PLAN.expectedModel,PLAN.expectedModel,'Configured Gemma proof only');
  assert.ok(process.env.OPENROUTER_API_KEY,'Configured provider key required; never written to argv/report/stdout');
  assert.ok(await exists(join(root,'.local/asr-venv/Scripts/python.exe')),'MEDIA_RUNTIME_REQUIRED_BEFORE_ADMISSION');
  const archive=await archiveCurrentMedia(freezePath),identity=sha256(JSON.stringify([PLAN,archive.bundle,lib.current])),nonce=randomUUID();
  const release=await acquireProbeLock(join(root,PLAN.sharedLock),{nonce,pid:process.pid,study:'current_media_bytes',source:lib.current});
  const id=Date.now()+'-media',folder=join(root,'reports/media-byte-current',id),taskDir=join(root,'.local/media-byte-private',id);
  let stopRequested=false;const onSignal=()=>{stopRequested=true;};process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  const stopFile=resolve(options['stop-file']??join(root,'.local/STOP_CURRENT_MEDIA_BYTES'));
  try {
    if(await exists(stopFile))return {state:'not_launched_operator_stop',providerCalls:0,chargedExposureUsd:0};
    await mkdir(join(root,'.local/media-byte-admission'),{recursive:true});
    const admission=await open(join(root,'.local/media-byte-admission',identity+'.json'),'wx');
    await admission.writeFile(JSON.stringify({identity,source:lib.current,bundle:archive.bundle,folder,cap:PLAN.budgetUsd,at:new Date().toISOString()}));await admission.close();
    await mkdir(folder,{recursive:true});await mkdir(join(taskDir,'.local/media-fixtures'),{recursive:true});
    for(const f of FIXTURES)await copyFile(join(archive.folder,f),join(taskDir,'.local/media-fixtures',f));
    await save(join(folder,'protocol.json'),{...PLAN,source:lib.current,archive,identity,taskDirectory:taskDir,authorization:options.run,
      state:'started_no_returned_outcome',secretValuesNotArchived:true,at:new Date().toISOString()});
    await save(join(folder,'attempt.json'),{state:'child_not_yet_settled',declaredCostExposureUsd:PLAN.budgetUsd,actualCostUsd:null});
    const child=spawn(process.execPath,[join(root,PLAN.childScript)],{cwd:taskDir,env:childEnvironment(process.env,taskDir),windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',softDeadline=false;
    child.stdout.on('data',b=>{if(stdout.length<262144)stdout+=String(b);});child.stderr.on('data',b=>{if(stderr.length<262144)stderr+=String(b);});
    const started=performance.now(),timer=setTimeout(()=>{softDeadline=true;stopRequested=true;},PLAN.softStopAfterMs);
    const poll=setInterval(()=>{exists(stopFile).then(x=>{if(x)stopRequested=true;}).catch(()=>{stopRequested=true;});},1000);timer.unref();poll.unref();
    let exit;try{exit=await new Promise((yes)=>{child.once('error',e=>yes({code:null,signal:null,errorCode:e.code??e.name}));child.once('exit',(code,signal)=>yes({code,signal}));});}
    finally{clearTimeout(timer);clearInterval(poll);}
    await save(join(folder,'child-exit.json'),{exit,softDeadline,stopRequested,wallMs:performance.now()-started,
      stdoutSafeLines:safeChildOutput(stdout),stdoutSha256:sha256(stdout),stderrSha256:sha256(stderr),stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr),
      unrecognizedOutputNotEmitted:true,processKilledByWrapper:false});
    let raw=null,rawFile=join(taskDir,'reports/media-byte-smoke.json'),rawHash=null;
    try{const bytes=await readFile(rawFile);rawHash=sha256(bytes);raw=JSON.parse(bytes);await writeFile(join(folder,'raw-media.json'),bytes,{flag:'wx'});}catch(e){await save(join(folder,'missing-outcome.json'),{code:e.code??e.name,providerCalls:null,chargedExposureUsd:PLAN.budgetUsd});}
    const final=await lib.b.checkFinalBuilds({candidate:lib.current.candidateFingerprint,evaluator:lib.current.evaluatorFingerprint,simulator:lib.current.simulatorBuild},
      {candidate:lib.h.buildFingerprint,evaluator:lib.h.evaluatorFingerprint});
    const endInputs=await inputBytes(),inputsUnchanged=JSON.stringify(endInputs)===JSON.stringify(archive.bundle);
    const result={...readout(raw,{current:lib.current,final,exit,stopRequested,fixtureManifest:archive.bundle.fixtures}),initialBuilds:lib.current,finalBuilds:final,inputsUnchanged,rawFile,rawSha256:rawHash,
      wrapperSha256:sha256(await readFile(script)),archive,wallMs:performance.now()-started};
    if(!inputsUnchanged){result.eligibleForByteIntegration=false;result.reasons.push('script_or_fixture_bytes_changed');result.status='incomplete_or_invalid';}
    await save(join(folder,'readout.json'),result);return {folder,status:result.status,eligibleForByteIntegration:result.eligibleForByteIntegration,
      cost:result.cost,inputsUnchanged,sourceUnchanged:final.candidateChanged===false&&final.evaluatorChanged===false&&final.simulatorChanged===false};
  } finally{process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);await release();}
}
async function cli(){const a=Object.fromEntries(process.argv.slice(2).map(s=>{const p=s.indexOf('=');return [s.slice(2,p<0?undefined:p),p<0?true:s.slice(p+1)];}));
  console.log(JSON.stringify(a.archive?await archiveCurrentMedia(a.freeze):await run(a)));}
if(process.argv[1]&&resolve(process.argv[1])===script)cli().catch(e=>{console.error(e.code??e.name);process.exitCode=1;});
