import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ledgerCost, safeChildOutput, childEnvironment, readout, validateFixtureBundle, FIXTURE_SHA, SOURCE_PIN, FIXTURES, PLAN } from './current-media-byte-v4.mjs';
const final={candidateChanged:false,evaluatorChanged:false,simulatorChanged:false};
const manifest=FIXTURES.map((filename,i)=>({filename,sha256:String(i+1).repeat(64)}));
const good=()=>({candidateFingerprint:SOURCE_PIN.candidateFingerprint,model:PLAN.expectedModel,kind:'synthetic-byte-integration',notAccuracyValidation:true,
  usage:[{model:PLAN.expectedModel,state:'completed',cost_usd:.01}],results:[...manifest.map(f=>({...f,contentHash:f.sha256,passed:true})),
    {filename:'reviewed-public-rendition.png',passed:true,syntheticReceiptFixture:true,notPublishedByDefault:true,metadataStripped:true}]});
test('complete fixture contracts require original content hashes and do not create aid/accuracy claims',()=>{
  const r=readout(good(),{final,exit:{code:0,signal:null},fixtureManifest:manifest});
  assert.equal(r.eligibleForByteIntegration,true);assert.equal(r.costClosed,true);assert.equal(r.physicalAid,null);assert.equal(r.independentSemanticAccuracy,null);
  assert.equal(r.publicPublishing,null);assert.equal(r.cost.providerCalls,1);
});
test('missing failed duplicate or changed bytes preserve incomplete outcome',()=>{
  for(const mutation of [r=>r.results.pop(),r=>r.results[0].passed=false,r=>r.results.push(r.results[0]),r=>r.results[0].contentHash='bad']) {
    const raw=good();mutation(raw);assert.equal(readout(raw,{final,exit:{code:0,signal:null},fixtureManifest:manifest}).eligibleForByteIntegration,false);
  }
  assert.equal(readout(null,{final,exit:{code:1,signal:null}}).status,'failed_missing_outcome');
});
test('unknown fees remain unknown with a full cap, not zero or known subtotal plus cap',()=>{
  const raw=good();raw.usage.push({model:PLAN.expectedModel,state:'failed',cost_usd:null});raw.costUsd=0;
  const r=readout(raw,{final,exit:{code:0,signal:null},fixtureManifest:manifest});
  assert.equal(r.cost.totalCostUsd,null);assert.equal(r.cost.knownCostSubtotalUsd,.01);assert.equal(r.cost.unknownCostRows,1);
  assert.equal(r.cost.chargedExposureUsd,.25);assert.equal(r.costClosed,false);assert.equal(r.legacyReportedCostUsd,0);
  assert.equal(r.eligibleForByteIntegration,true,'Unknown billing does not erase actual byte proof; cost closure stays separate');
  assert.equal(ledgerCost({}).chargedExposureUsd,.25);assert.equal(ledgerCost({usage:[{cost_usd:''}]}).totalCostUsd,null);
});
test('models/source change/call cap failures are explicit, with all raw outcomes retained',()=>{
  const raw=good();raw.usage=Array.from({length:7},()=>({model:'wrong',cost_usd:.01}));
  const r=readout(raw,{final:{...final,simulatorChanged:true},exit:{code:0,signal:null},fixtureManifest:manifest});
  assert.equal(r.eligibleForByteIntegration,false);assert.ok(r.reasons.includes('actual_provider_call_bound'));
  assert.ok(r.reasons.includes('unexpected_actual_model'));assert.ok(r.reasons.includes('final_source_unknown_or_changed'));
  assert.equal(r.results.length,5);
});
test('only whitelisted known child progress is exposed; secret/error chatter is not emitted',()=>{
  const text='Processed actual bytes: return-note.wav\nAPI_KEY=sentinel\nprivate stack\nProcessed actual bytes: unknown-file\nProcessed actual bytes: reviewed public image rendition (private by default)';
  assert.deepEqual(safeChildOutput(text),['Processed actual bytes: return-note.wav','Processed actual bytes: reviewed public image rendition (private by default)']);
});
test('task CWD isolates mutable latest reports/evidence without reassigning system profile variables',()=>{
  const parent={HOME:'original-home',CODEX_HOME:'original-codex',USERPROFILE:'original-profile',OPENROUTER_API_KEY:'private-provider',
    DATABASE_URL:'private-db',SOURCE_AGENT_KEY:'private-actor',NODE_OPTIONS:'private-options'};
  const e=childEnvironment(parent,path.resolve('task-run'));
  assert.equal(e.HOME,parent.HOME);assert.equal(e.CODEX_HOME,parent.CODEX_HOME);assert.equal(e.USERPROFILE,parent.USERPROFILE);
  assert.equal(e.OPENROUTER_API_KEY,parent.OPENROUTER_API_KEY);assert.equal(e.DATABASE_URL,undefined);assert.equal(e.SOURCE_AGENT_KEY,undefined);assert.equal(e.NODE_OPTIONS,undefined);
  assert.ok(e.NEXO_LOCAL_DIR.startsWith(path.resolve('task-run')+path.sep));assert.equal(parent.DATABASE_URL,'private-db');
});
test('actual recipe archives inputs before spawn and requests stop without force killing the child',async()=>{
  const source=await readFile(new URL('./current-media-byte-v4.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf('archiveCurrentMedia(freezePath)')<source.indexOf('const child=spawn'));
  assert.doesNotMatch(source,/\.kill\(|taskkill|Stop-Process|TerminateProcess/);
  assert.match(source,/softDeadline=true;stopRequested=true/);assert.match(source,/processKilledByWrapper:false/);
  assert.match(source,/cwd:taskDir/);assert.match(source,/MEDIA_RUNTIME_REQUIRED_BEFORE_ADMISSION/);
});
test('predeclared byte fixtures cannot silently be replaced after preparation or a failure',()=>{
  const rows=FIXTURES.map(filename=>({filename,sha256:FIXTURE_SHA[filename]}));assert.equal(validateFixtureBundle(rows),true);
  assert.throws(()=>validateFixtureBundle(rows.slice(1)));
  assert.throws(()=>validateFixtureBundle(rows.map((r,i)=>i? r:{...r,sha256:'new-favorable-image'})),/Predeclared bytes changed/);
});
