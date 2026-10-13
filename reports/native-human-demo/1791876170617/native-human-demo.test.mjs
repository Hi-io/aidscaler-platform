import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { rebaseSource, instrumentHarness, instrumentBenchmark, validateExecuteOptions, installPassiveObserver, DESIGN } from './native-human-demo.mjs';

test('import rebasing anchors fingerprints and dynamic imports to exact original source',()=>{
  const url='file:///C:/workspace/platform/evaluation/harness.mjs';
  const source=`import {x} from '../src/x.mjs';\nconst y = import("../src/y.mjs");\nconst dir = new URL('../src/', import.meta.url);\nimport {readFile} from 'node:fs/promises';`;
  const result=rebaseSource(source,url);
  assert.match(result,/file:\/\/\/C:\/workspace\/platform\/src\/x.mjs/);
  assert.match(result,/import\("file:\/\/\/C:\/workspace\/platform\/src\/y.mjs"\)/);
  assert.match(result,/new URL\('\.\.\/src\/', "file:\/\/\/C:\/workspace\/platform\/evaluation\/harness.mjs"\)/);
  assert.match(result,/from "node:fs\/promises"/);assert.doesNotMatch(result,/import\.meta\.url/);
});
test('current full source transforms only explicit presentation/port callbacks, preserving finite workflow and model clock',async()=>{
  const hurl=new URL('../evaluation/harness.mjs',import.meta.url),burl=new URL('../evaluation/human-capacity-benchmark.mjs',import.meta.url);
  const [h,b]=await Promise.all([readFile(hurl,'utf8'),readFile(burl,'utf8')]);
  const hc=instrumentHarness(h,hurl.href),bc=instrumentBenchmark(b,burl.href,'file:///ignored/observer-harness.mjs');
  assert.match(hc,/observerPort: demoObserverPort/);assert.doesNotMatch(hc,/observerPort: 0,/);
  assert.match(bc,/from "file:\/\/\/ignored\/observer-harness.mjs"/);
  assert.match(bc,/await demoReady\(\{ h, arm, profile, seed/);
  assert.match(bc,/await demoTick\(\{ arm, sourceNow: w.now, target, turns \}\);\n      const progress = w.advance\(target/);
  assert.match(bc,/await demoFinished\(\{ h, result \}\);\n  return result;/);
  assert.ok(bc.includes('Math.max(w.config.modelLatencyMs, finite(usage?.wallMs) ? usage.wallMs : 0)'));
  assert.ok(bc.includes("nativeHumanWorkParams(stage,reference,dependsOn,recipient,horizonMs)"));
  assert.ok(bc.includes('w.advance(horizonMs, { maxEvents: 1000000 });'));
  assert.ok(bc.includes('try { await h.close(); }'));
});
test('changed/duplicate instrumentation anchors fail closed',()=>{
  assert.throws(()=>instrumentHarness('observerPort: 0','file:///x/harness.mjs'),/exact instrumentation anchor/);
  const duplicated='  awaitReviews = true,\n  awaitReviews = true,\n      observerPort: 0,';
  assert.throws(()=>instrumentHarness(duplicated,'file:///x/harness.mjs'),/exact instrumentation anchor/);
});
test('separate execution authorization and actual provider selection are required',()=>{
  assert.throws(()=>validateExecuteOptions({arm:'B6',prepared:'x',seal:'y'}),/ROOT_GO_NATIVE_DEMO/);
  assert.throws(()=>validateExecuteOptions({authorization:'ROOT_GO_NATIVE_DEMO',arm:'B6',prepared:'x',seal:'y'}),/real configured provider/);
  assert.throws(()=>validateExecuteOptions({authorization:'ROOT_GO_NATIVE_DEMO',arm:'B5',prepared:'x',seal:'y'}),/declared live demo arms/);
  assert.equal(validateExecuteOptions({authorization:'ROOT_GO_NATIVE_DEMO',arm:'B6',prepared:'x',seal:'y','real-provider':true}),true);
  assert.equal(DESIGN.count,4);assert.equal(DESIGN.noise,32);assert.equal(DESIGN.budgetUsd,.1);
});
test('passive observer blocks source-clock mutations, retains login and real read-only presentation',()=>{
  const observer=new EventEmitter();let called=0;
  observer.on('request',(req,res)=>{called++;res.setHeader('Content-Type','text/html');res.end('<html><body>Native viewer</body></html>');});
  const restore=installPassiveObserver({observer},'C_manual');
  const response=()=>({headers:{},status:null,body:null,setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},
    removeHeader(k){delete this.headers[k];},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(body){this.body=body;}});
  const denied=response();observer.emit('request',{method:'POST',url:'/api/inject'},denied);
  assert.equal(denied.status,409);assert.equal(called,0);assert.match(denied.body,/DEMO_RUNNER_OWNS_CLOCK/);
  const login=response();observer.emit('request',{method:'POST',url:'/api/login'},login);assert.equal(called,1);
  const html=response();observer.emit('request',{method:'GET',url:'/'},html);assert.equal(called,2);
  assert.match(html.body,/Native viewer/);assert.match(html.body,/modeled finite read \/ decide \/ relay/);
  assert.match(html.body,/not primary evidence/);
  const state=response();observer.emit('request',{method:'GET',url:'/api/state'},state);assert.equal(called,3);
  assert.doesNotMatch(state.body,/not primary evidence/,'only HTML presentation is annotated');
  restore();assert.equal(observer.listeners('request').length,1);
});
