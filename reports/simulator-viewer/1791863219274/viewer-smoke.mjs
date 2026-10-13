// Real, zero-provider browser proof. The exact helper and observation-only
// injected JavaScript are archived; no engine/viewer implementation is edited.
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import {createLabServers} from '../sources/server.mjs';
import {ENGINE_BUILD} from '../contracts/config.mjs';
import {digest} from '../engine/determinism.mjs';

const script=fileURLToPath(import.meta.url),root=path.resolve(path.dirname(script),'..');
const argv=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
const folder=path.resolve(argv.out??path.join(root,'../nexo-platform/reports/simulator-viewer',String(Date.now())));
const sha=s=>createHash('sha256').update(s).digest('hex');
const save=(name,value)=>writeFile(path.join(folder,name),JSON.stringify(value,null,2));
async function freshBuild(){
  const files=(await Promise.all(['contracts','engine','generators','content','scenarios','sources'].map(async dir=>
    (await readdir(path.join(root,dir))).filter(f=>f.endsWith('.mjs')).map(f=>dir+'/'+f)))).flat();
  files.push(...(await readdir(path.join(root,'viewer'),{recursive:true})).filter(f=>/\.(?:m?js|html|css)$/.test(f)).map(f=>'viewer/'+f.replaceAll('\\','/')),
    'adapters/reference.mjs','evaluation/metrics.mjs');
  const entries=await Promise.all(files.sort().map(async f=>[f,(await readFile(path.join(root,f),'utf8')).replaceAll('\r\n','\n')]));
  return digest(Object.fromEntries(entries));
}
const config={scenario:'S23',seed:'real-viewer-native-human-2026-01',organizations:2,grid:5,extentKm:2,
  hazard:'none',policy:'none',backgroundTraffic:0,postsPerHour:0,healthReports:false,recurringNeeds:false,
  packetLoss:0,networkLatencyMs:1000,queryLatencyMs:1000,reviewMs:1000,loadMs:1000,unloadMs:1000,
  durationMs:1800000,humanCapacity:{profile:'moderate',readers:1,deciders:1,relayers:1,readMs:120000}};
await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'viewer-smoke.mjs'),await readFile(script));
const initial=await freshBuild();assert.equal(initial,ENGINE_BUILD);
await save('protocol.json',{schema:'real-viewer-smoke-v1',recordedAt:new Date().toISOString(),initialBuild:initial,
  helperSha256:sha(await readFile(script)),config,viewports:[{width:1920,height:1080},{width:390,height:844}],
  observerScope:'Authenticated private observer with organization display filters; this browser remains observer-capable and is not an autonomous actor gateway.',
  actorScope:'Ordinary authenticated HTTP feed ingestion, human_work, owner propose/review and dispatch; no hidden data used to compile the fixed shipment.',
  instrumentation:'Only copies native camera, LOD, WebGL renderer statistics and A/B camera positions into a readout. Original/instrumented bytes archived, no source mutation.',
  limits:['Behavioral/overflow screenshot smoke; not user research, semantic accuracy, FPS certification or throughput comparison.',
    'Playwright/Chromium supplied by the sibling platform host dev dependencies; not a cold browser installation.',
    'A/B uses identical rules policies to test clock/camera synchronization, not policy benefit.'],
  machine:{platform:process.platform,release:os.release(),cpu:os.cpus()[0]?.model,node:process.version}});
const require=createRequire(new URL('../../nexo-platform/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const checks=[],errors=[],warnings=[],externalRequests=[],expectedAuthentication=[];let lab,browser,closed=false,authenticated=false;
const check=(name,data={})=>checks.push({name,passed:true,...data});
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
  const url=new URL(typeof input==='string'?input:input.url??String(input));
  assert.ok(['localhost','127.0.0.1','::1'].includes(url.hostname),'External fetch forbidden');
  return originalFetch(input,options);
};
function redact(text){let result=String(text);for(const key of [lab?.observerKey,...Object.keys(lab?.actorKeys??{})])
  if(key)result=result.replaceAll(key,'[redacted]');return result;}
async function request(base,url,{key,body}={}){
  const response=await fetch(base+url,{headers:{...(key?{Authorization:'Bearer '+key}:{}),
    ...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  assert.ok(response.ok,'Source HTTP '+url+' returned '+response.status);return response.json();
}
async function viewportProof(page,name){
  const size=page.viewportSize(),bounds=await page.locator('#canvas').boundingBox();
  assert.ok(bounds.width>200&&bounds.height>140,'Actual 3D viewport must remain usable');
  const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    height:innerHeight,scrollHeight:document.documentElement.scrollHeight}));
  assert.ok(overflow.scrollWidth<=overflow.width+1,'Horizontal page overflow');
  for(const id of ['toggleConfig','openMeasurements','play','perspective']){
    assert.equal(await page.locator('#'+id).isVisible(),true,id+' visible');
    const b=await page.locator('#'+id).boundingBox();assert.ok(b.x>=-1&&b.y>=-1&&b.x+b.width<=size.width+1&&b.y+b.height<=size.height+1,id+' clipped');
  }
  check(name+' viewport/controls/overflow',{viewport:size,canvas:bounds,overflow});
}
async function unusedPort(){
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;await new Promise((resolve,reject)=>probe.close(e=>e?reject(e):resolve()));return port;
}
try{
  // The native same-origin contract uses the declared observer port; declare
  // the actual port explicitly instead of requesting port zero in this probe.
  lab=await createLabServers({observerPort:await unusedPort(),sourcePort:0,persistCredentials:false,config});
  const observer='http://127.0.0.1:'+lab.observerPort,source='http://127.0.0.1:'+lab.sourcePort;
  const actor0=Object.entries(lab.actorKeys).find(([,a])=>a.org==='org0')[0],actor1=Object.entries(lab.actorKeys).find(([,a])=>a.org==='org1')[0];
  for(const [family,type,text]of [['P01','video','Families are waiting for water at the shelter.'],['P02','image','A photograph of families waiting at the shelter.']])
    await request(observer,'/api/inject',{key:lab.observerKey,body:{type:'scenario_signal',data:{family,type,text,
      building:lab.world.state.map.shelterId,false:false,compositionMs:0,causeEvent:'viewer-'+family}}});
  // A 10 MB video takes its declared bandwidth time plus indexing latency.
  await request(observer,'/api/control',{key:lab.observerKey,body:{advanceTo:30000}});
  const feed=await request(source,'/api/feed');assert.ok(feed.posts.length>=2,'Actual public reports must have arrived and indexed');
  const post=feed.posts[0];
  for(const p of feed.posts)await request(source,'/api/actor/ingestion',{key:actor0,body:{id:p.id,version:p.version,stage:'downloaded'}});
  for(let i=0;i<3;i++)await request(source,'/api/actor/action',{key:actor0,body:{type:'human_work',params:{stage:'read',
    reference:{kind:'post',id:post.id,version:post.version}},idempotencyKey:'viewer-human-org0-'+i}});
  await request(source,'/api/actor/action',{key:actor1,body:{type:'human_work',params:{stage:'read',
    reference:{kind:'post',id:post.id,version:post.version}},idempotencyKey:'viewer-human-org1'}});
  const own=await request(source,'/api/actor/state',{key:actor0});
  assert.equal(own.state,undefined);assert.equal(own.humanWork.length,3);assert.ok(own.humanWork.every(t=>t.org==='org0'&&!Object.hasOwn(t,'privatePayload')));
  check('HTTP actor scope and actual native attention/intake',{sourceReceipts:lab.world.state.ingestion.length,
    nativeReadTasks:own.humanWork.length,queued:own.humanCapacity.backlog,working:own.humanCapacity.working});
  const provision=await request(observer,'/api/actors/provision',{key:lab.observerKey,body:{org:'org0',role:'commander',id:'viewer-owner'}});
  const n=Object.values(own.known.needs).find(n=>n.type==='water'),resource=Object.values(own.known.resources).find(r=>r.type==='water'),
    vehicle=Object.values(own.known.vehicles).find(v=>v.state==='idle');assert.ok(n&&resource&&vehicle);
  const params={need:n.id,resource:resource.id,vehicle:vehicle.id,quantity:100};
  const proposal=await request(source,'/api/actor/action',{key:actor0,body:{type:'propose',params:{title:'Viewer physical shipment',references:[n.id],plan:{actions:[{type:'dispatch',params}]}},idempotencyKey:'viewer-plan'}});
  await request(source,'/api/actor/action',{key:provision.key,body:{type:'review',params:{id:proposal.id,decision:'approve'},idempotencyKey:'viewer-owner-review'}});
  await request(observer,'/api/control',{key:lab.observerKey,body:{advanceTo:31000}});
  assert.equal((await request(source,'/api/actor/state',{key:actor0})).proposals.find(p=>p.id===proposal.id).state,'authorized');
  const operation=await request(source,'/api/actor/action',{key:provision.key,body:{type:'dispatch',params:{...params,proposal:proposal.id,step:0},idempotencyKey:'viewer-exact-shipment'}});
  await request(observer,'/api/control',{key:lab.observerKey,body:{advanceTo:35000}});
  check('Owner-reviewed actual physical vehicle mission',{operation:operation.id,vehicle:vehicle.id,
    state:lab.world.state.operations.find(o=>o.id===operation.id).state,modelCalls:lab.world.state.modelCalls});
  assert.equal(lab.world.state.modelCalls,0);
  const original=await readFile(path.join(root,'viewer/app.js'),'utf8'),anchor='renderer.render(scene, camera);';assert.equal(original.split(anchor).length,2);
  const observed=original.replace(anchor,`window.__readOnlyViewerProbe={zoom:camera.zoom,position:camera.position.toArray(),target:controls.target.toArray(),orthographic:camera.isOrthographicCamera,buildingsVisible:layerGroups.buildings?.visible,sectorsVisible:layerGroups.sectors?.visible,calls:renderer.info.render.calls,lost:renderer.getContext().isContextLost()};\n`+anchor);
  const comparisonOriginal=await readFile(path.join(root,'viewer/comparison.js'),'utf8'),pairAnchor='for (const v of views) v.renderer.render(v.scene, v.camera);';
  assert.equal(comparisonOriginal.split(pairAnchor).length,2);
  const comparisonObserved=comparisonOriginal.replace(pairAnchor,`window.__readOnlyPairProbe=views.map(v=>({position:v.camera.position.toArray(),target:v.controls.target.toArray(),zoom:v.camera.zoom,calls:v.renderer.info.render.calls,lost:v.renderer.getContext().isContextLost()}));\n`+pairAnchor);
  await writeFile(path.join(folder,'observed-app.js'),observed);await writeFile(path.join(folder,'observed-comparison.js'),comparisonObserved);
  await save('instrumentation.json',{originalAppSha256:sha(original),observedAppSha256:sha(observed),
    originalComparisonSha256:sha(comparisonOriginal),observedComparisonSha256:sha(comparisonObserved)});
  browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  const context=await browser.newContext({viewport:{width:1920,height:1080}});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!['127.0.0.1','localhost','::1'].includes(url.hostname)){externalRequests.push({url:url.origin+url.pathname});return route.abort();}
    if(url.pathname==='/app.js')return route.fulfill({status:200,contentType:'text/javascript',body:observed});
    if(url.pathname==='/comparison.js')return route.fulfill({status:200,contentType:'text/javascript',body:comparisonObserved});
    if(url.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
    return route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>{if(!closed)errors.push({type:'pageerror',message:redact(e.message)});});
  page.on('console',m=>{if(closed)return;if(m.type()==='error'&&!authenticated&&m.text().includes('401 (Unauthorized)'))expectedAuthentication.push({type:'console',message:redact(m.text())});
    else if(m.type()==='error')errors.push({type:'console',message:redact(m.text())});
    else if(m.type()==='warning')warnings.push({type:'warning',message:redact(m.text())});});
  page.on('response',r=>{if(closed||r.status()<400)return;const row={type:'HTTP',status:r.status(),path:new URL(r.url()).pathname};
    if(!authenticated&&r.status()===401&&['/api/catalog','/api/state'].includes(row.path))expectedAuthentication.push(row);else errors.push(row);});
  await page.goto(observer);await page.locator('#key').fill(lab.observerKey);await page.locator('#loginForm button').click();
  await page.locator('#app').waitFor({state:'visible'});authenticated=true;await page.waitForFunction(()=>window.__readOnlyViewerProbe?.calls>0&&!window.__readOnlyViewerProbe.lost);
  const camera=await page.evaluate(()=>window.__readOnlyViewerProbe);assert.equal(camera.orthographic,true);check('Actual WebGL orthographic rendered scene',{camera});
  await viewportProof(page,'desktop16:9');await page.screenshot({path:path.join(folder,'desktop-observer.png')});
  const pausedHash=lab.world.stateHash();
  await page.locator('#canvas').click({position:{x:80,y:80}});await page.keyboard.press('ArrowRight');
  await page.waitForFunction(prior=>window.__readOnlyViewerProbe.position[0]!==prior,camera.position[0]);check('Native keyboard pan');
  const bounds=await page.locator('#canvas').boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.wheel(0,1400);
  await page.waitForFunction(()=>window.__readOnlyViewerProbe.zoom<.55);const distant=await page.evaluate(()=>window.__readOnlyViewerProbe);
  assert.equal(distant.buildingsVisible,false);assert.equal(distant.sectorsVisible,true);check('Native zoom-out building-to-sector LOD',{distant});
  await page.screenshot({path:path.join(folder,'desktop-lod.png')});await page.locator('#home').click();
  await page.locator('#toggleConfig').click();await page.locator('#find').fill(vehicle.id);await page.locator('#find').press('Enter');
  // Native selection already starts following; the control toggles it off.
  await page.locator('#follow').waitFor({state:'visible'});
  await page.waitForFunction(id=>document.getElementById('canvas').dataset.tracking==='vehicle:'+id,vehicle.id);
  await page.screenshot({path:path.join(folder,'desktop-follow.png')});
  // The inspector covers the map toolbar; its native tracking toggle remains
  // the directly accessible stop control for this open-panel state.
  await page.locator('#follow').click();await page.waitForFunction(()=>document.getElementById('canvas').dataset.tracking==='');
  check('Find/follow/stop existing physical vehicle');
  if(await page.locator('#inspector').isVisible())await page.locator('#closeInspector').click();
  await page.locator('#perspective').selectOption('org0');await page.waitForFunction(()=>document.getElementById('realityCount').textContent.includes('Ground truth hidden'));
  assert.ok((await page.locator('#reality').innerText()).includes('World truth is hidden'));
  await page.waitForFunction(()=>document.querySelectorAll('#communication .feedCard').length>0&&document.querySelectorAll('#ingestion .feedCard').length>0);
  check('Actual public reports and acknowledged intake cards; actor display hides ground truth',{receivedReports:feed.posts.length});
  await page.locator('#openMeasurements').click();await page.locator('#measurementsDrawer details summary').click();
  const table=page.locator('#informationStats table').last();await table.waitFor({state:'visible'});
  const read=await table.locator('tbody tr').first().innerText();assert.ok(/^Read\s+2\s+1\s+0$/.test(read),'Actor human queue includes only3org0 tasks');
  assert.ok((await page.locator('#informationStats').innerText()).includes('Reading or approval is not physical aid'));check('Native scoped attention diagnostics',{readRow:read});
  await table.scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:path.join(folder,'desktop-actor-attention.png')});await page.locator('#closeMeasurements').click();
  assert.equal(lab.world.stateHash(),pausedHash,'Paused view interactions must not mutate full physical source');check('Camera/views preserve complete paused world hash',{stateHash:pausedHash});
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('#canvas canvas').width>0);
  await viewportProof(page,'mobile');await page.screenshot({path:path.join(folder,'mobile-actor.png')});
  await page.locator('#openMeasurements').click();await table.waitFor({state:'visible'});
  const panel=await page.locator('#measurementsDrawer').boundingBox();assert.ok(panel.x>=-1&&panel.x+panel.width<=391);check('Mobile attention panel stays within viewport',{panel});
  await table.scrollIntoViewIfNeeded();await page.screenshot({animations:'disabled',path:path.join(folder,'mobile-attention.png')});await page.locator('#closeMeasurements').click();
  const oldClock=lab.world.now;await page.locator('#speed').selectOption('10');await page.locator('#play').click();
  await page.waitForFunction(()=>document.getElementById('play').textContent==='Pause');
  await page.waitForFunction(clock=>document.getElementById('clock').textContent!==clock,await page.locator('#clock').innerText());
  await page.locator('#play').click();await page.waitForFunction(()=>document.getElementById('play').textContent==='Play');
  assert.ok(lab.world.now>oldClock);const stoppedHash=lab.world.stateHash();await page.waitForTimeout(1200);assert.equal(lab.world.stateHash(),stoppedHash);
  check('Play/source clock advances and pause stops source evolution',{sourceClockBefore:oldClock,sourceClockAfter:lab.world.now});
  await page.setViewportSize({width:1920,height:1080});await page.locator('#toggleConfig').click();await page.locator('#openComparison').click();
  await page.locator('#policyA').selectOption('rules');await page.locator('#policyB').selectOption('rules');await page.locator('#comparisonForm button').first().click();
  await page.waitForFunction(()=>document.getElementById('comparisonStatus').textContent.includes('clocks synchronized')&&window.__readOnlyPairProbe?.every(p=>p.calls>0&&!p.lost));
  assert.equal(await page.locator('#compareA canvas').count(),1);assert.equal(await page.locator('#compareB canvas').count(),1);
  const pair=await page.evaluate(()=>fetch('/api/compare?pair=1').then(r=>r.json()));assert.equal(pair.a.now,pair.b.now);assert.equal(pair.a.state.map.hash,pair.b.state.map.hash);
  const pairCamera=await page.evaluate(()=>window.__readOnlyPairProbe);assert.deepEqual(pairCamera[0].position,pairCamera[1].position);assert.equal(pairCamera[0].zoom,pairCamera[1].zoom);
  check('A/B real WebGL canvases synchronized source clock/map/cameras',{atSourceClock:pair.a.now,mapHash:pair.a.state.map.hash,pairCamera});
  await page.screenshot({path:path.join(folder,'desktop-paired.png')});
  await page.locator('#comparePlay').click();await page.waitForFunction(()=>document.getElementById('compareAMetrics').textContent.slice(0,8)!=='00:00:00');
  await page.locator('#comparePlay').click();const evolved=await page.evaluate(()=>fetch('/api/compare?pair=1').then(r=>r.json()));
  assert.equal(evolved.a.now,evolved.b.now);assert.ok(evolved.a.now>pair.a.now);check('A/B source clock equality during actual playback',{atSourceClock:evolved.a.now});
  await page.locator('#closeComparison').click();assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
  assert.ok(!warnings.some(x=>/WebGL.*(?:error|context lost)|GL_(?:INVALID|OUT_OF_MEMORY)|shader.*error/i.test(x.message)),'WebGL warning indicating actual rendering error');
  const final=await freshBuild();assert.equal(final,initial,'Source/viewer bytes changed while proving UI');
  await save('result.json',{passed:true,checks,errors,warnings,externalRequests,expectedAuthentication,initialBuild:initial,finalBuild:final,
    helperSha256:sha(await readFile(script)),browser:browser.version(),recordedAt:new Date().toISOString(),
    modelCalls:lab.world.state.modelCalls,sourceIntegrity:lab.world.invariants(),scope:'Real browser proof, no provider and no benefit claim.'});
  console.log(JSON.stringify({passed:true,checks:checks.length,build:final,report:path.join(folder,'result.json')}));
}catch(error){
  await save('result.json',{passed:false,checks,errors,warnings,externalRequests,expectedAuthentication,initialBuild:initial,finalBuild:await freshBuild(),
    error:{name:error.name,message:redact(error.message)},recordedAt:new Date().toISOString()});
  console.error(JSON.stringify({passed:false,checks:checks.length,message:redact(error.message),report:path.join(folder,'result.json')}));process.exitCode=1;
}finally{closed=true;await browser?.close();await lab?.close();globalThis.fetch=originalFetch;}
