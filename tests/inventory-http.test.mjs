import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.mjs';
import { createPlatform } from '../server.mjs';
import { createDemoGateway } from '../src/demo-gateway.mjs';
import { createDemoSource } from '../src/demo-source.mjs';
import { createLabServers } from '../../disaster-response-simulator/sources/server.mjs';

const config={scenario:'S23',seed:'incoming-stock-http',topology:'grid',grid:5,extentKm:2,organizations:4,mode:'interactive',
  hazard:'none',policy:'none',backgroundTraffic:0,postsPerHour:0,packetLoss:0,queryLatencyMs:100,networkLatencyMs:100,clockLatency:'wall'};
const noModel={complete(){throw Error('Warehouse intake must not request a model.');}};
async function waitFor(fn) {for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Source projection did not arrive.');}

test('demo supply schedule and manual warehouse receipt are real, scoped, bounded and preserve reservations', {timeout:60000}, async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'aidscaler-supply-'));
  const lab=await createLabServers({isolated:true,observerPort:0,sourcePort:0,persistCredentials:false,storageDir:path.join(dir,'source'),projectionMs:20,
    config:{...config,continuousDemo:true}});
  const store=await Store.open();let gateway;
  t.after(async()=>{await gateway?.close();await store.close();await lab.close();await rm(dir,{recursive:true,force:true});});
  const source=createDemoSource({observerUrl:`http://127.0.0.1:${lab.observerPort}`,sourceUrl:`http://127.0.0.1:${lab.sourcePort}`,observerKey:lab.observerKey});
  source.baseOrganizations=[];
  gateway=await createDemoGateway({store,source,secret:'supply-http-private-session-secret'.repeat(2),origin:'http://demo.test',port:0,dataDir:dir,startBase:false,
    providerFactory:()=>noModel,testConfig:{startWorker:false,autoIngest:false}});
  async function api(cookie,route,data,csrf,key='supply-http-command') {
    const response=await fetch(gateway.url+route,{method:data?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(data?{Origin:'http://demo.test','Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key}:{})},body:data?JSON.stringify(data):undefined});
    return {response,data:await response.json()};
  }
  async function join(name,key){const s=await api(null,'/demo/api/session'),cookie=s.response.headers.get('set-cookie').split(';')[0];
    const result=await api(cookie,'/demo/api/join',{name,kit:'response',resupply:{enabled:false,intervalMs:1800000,water:300,food:60}},s.data.csrf,key);
    assert.equal(result.response.status,201,JSON.stringify(result.data));return {cookie,session:result.data};}
  const a=await join('Harbor Warehouse','join-incoming-harbor'), b=await join('Sora Warehouse','join-incoming-sora');
  const org=a.session.organization.id,other=b.session.organization.id,app=gateway.apps.get(org);
  const schedule={enabled:true,intervalMs:300000,water:100,food:20};
  assert.equal((await api(a.cookie,'/demo/api/session/resupply',schedule,'wrong','schedule-wrong-csrf')).response.status,403);
  assert.equal((await api(a.cookie,'/demo/api/session/resupply',{...schedule,water:601},a.session.csrf,'schedule-too-large')).response.status,400);
  assert.equal((await api(a.cookie,'/demo/api/session/resupply',{...schedule,org:other},a.session.csrf,'schedule-other-org')).response.status,400);
  const changed=await api(a.cookie,'/demo/api/session/resupply',schedule,a.session.csrf,'schedule-own-update');
  assert.equal(changed.response.status,200,JSON.stringify(changed.data));assert.equal(changed.data.organization.resupply.water,100);
  assert.equal(changed.data.organization.resupply.nextAt,300000);assert.equal(changed.data.organization.resupply.waterCap,1200);
  assert.equal((await api(b.cookie,'/demo/api/session')).data.organization.resupply.enabled,false);
  const replay=await api(a.cookie,'/demo/api/session/resupply',schedule,a.session.csrf,'schedule-own-update');
  assert.equal(replay.response.status,200);assert.equal(replay.data.organization.resupply.nextAt,300000);
  assert.equal((await api(a.cookie,'/demo/api/session/resupply',{...schedule,water:200},a.session.csrf,'schedule-own-update')).response.status,409);
  await lab.advance(1000);await waitFor(async()=> (await app.connector.state()).now>=1000);await app.ingestion.sync({sources:false});
  const me=(await api(a.cookie,'/demo/workspace/api/me')).data.user;
  const resource=`r-${org}-water`, body={resource,quantity:150,receiptReference:'WAREHOUSE-42',note:'Supplies received at our depot',confirmedReceived:true};
  const reservation=await app.connector.action('commitment',{action:'reserve',resource,quantity:100,requester:org,ttlMs:3600000},'source-supply-reservation',{human:true});
  assert.equal(reservation.quantity,100);
  assert.equal((await api(a.cookie,'/demo/workspace/api/inventory/receipt',body,'wrong','receipt-wrong-csrf')).response.status,403);
  assert.equal((await api(a.cookie,'/demo/workspace/api/inventory/receipt',{...body,resource:`r-${other}-water`},me.csrf,'receipt-wrong-owner')).response.status,404);
  assert.equal((await api(a.cookie,'/demo/workspace/api/inventory/receipt',{...body,quantity:601,receiptReference:'TOO-LARGE'},me.csrf,'receipt-large')).response.status,400);
  await assert.rejects(app.connector.request('/api/actor/inventory/receipt',{method:'POST',body:{resource,quantity:1,receiptReference:'AGENT-RECEIPT',idempotencyKey:'agent-stock-denied'}}),{status:403});
  const recorded=await api(a.cookie,'/demo/workspace/api/inventory/receipt',body,me.csrf,'receipt-real-owner');
  assert.equal(recorded.response.status,201,JSON.stringify(recorded.data));assert.equal(recorded.data.state,'confirmed');assert.equal(recorded.data.receipt.quantity,150);
  const again=await api(a.cookie,'/demo/workspace/api/inventory/receipt',body,me.csrf,'receipt-real-owner-retry');
  assert.equal(again.response.status,201);assert.equal(again.data.id,recorded.data.id);
  assert.equal((await api(a.cookie,'/demo/workspace/api/inventory/receipt',{...body,quantity:151},me.csrf,'receipt-altered-retry')).response.status,409);
  assert.equal((await api(a.cookie,'/demo/workspace/api/inventory/receipt',{...body,receiptReference:'WAREHOUSE-43'},me.csrf,'receipt-cooldown')).response.status,429);
  let physical=(await lab.checkpoint()).state.resources.find(r=>r.id===resource);
  assert.equal(physical.quantity,750);assert.equal(physical.reserved,100);assert.equal(physical.received,150);
  await lab.advance(301000);await waitFor(async()=> (await app.connector.state()).now>=301000);await app.ingestion.sync({sources:false});
  physical=(await lab.checkpoint()).state.resources.find(r=>r.id===resource);
  assert.equal(physical.quantity,850,'one scheduled 100-L arrival is real source stock');assert.equal(physical.reserved,100);
  assert.equal((await store.get(org,'resource',resource)).quantity,850,'normal observations, rather than the receipt form, update platform inventory');
  const otherStock=(await lab.checkpoint()).state.resources.find(r=>r.id===`r-${other}-water`);assert.equal(otherStock.quantity,600);
  const disable=await api(a.cookie,'/demo/api/session/resupply',{...schedule,enabled:false},a.session.csrf,'schedule-disable');
  assert.equal(disable.data.organization.resupply.nextAt,null);assert.equal(disable.data.organization.resupply.receiptsCount,3,'manual water plus scheduled water and food are separate source receipts');
});

test('normal interactive platform records received inventory through its human connector without demo cadence limits', {timeout:30000}, async t => {
  const lab=await createLabServers({observerPort:0,sourcePort:0,persistCredentials:false,config});
  const store=await Store.open(),human='incoming-human-commander',agent=Object.entries(lab.actorKeys).find(([,a])=>a.org==='org0')[0];
  lab.actorKeys[human]={org:'org0',id:'warehouse-commander',role:'commander'};
  const app=await createPlatform({store,org:'org0',port:0,startWorker:false,autoIngest:false,writeAccessFile:false,bootstrapPassword:'incoming-normal-password',provider:noModel,
    sourceUrl:`http://127.0.0.1:${lab.sourcePort}`,sourceAgentKey:agent,sourceHumanKey:human});
  t.after(async()=>{await app.close();await store.close();await lab.close();});
  await app.connector.state();await app.connector.action('query',{target:'inventory'},'normal-incoming-inventory');lab.world.advance(5000);await app.ingestion.sync({sources:false});
  async function login(role){const r=await fetch(app.url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${role}@org0.aidscaler.local`,password:'incoming-normal-password'})});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf};}
  const commander=await login('commander'),analyst=await login('analyst');
  async function post(session,ref){const r=await fetch(app.url+'/api/inventory/receipt',{method:'POST',headers:{cookie:session.cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrf,'Idempotency-Key':'normal-'+ref},body:JSON.stringify({resource:'r-org0-water',quantity:700,receiptReference:ref,note:'Received',confirmedReceived:true})});return {response:r,data:await r.json()};}
  assert.equal((await post(analyst,'NORMAL-DENIED')).response.status,403);
  const before=lab.world.resource('r-org0-water').quantity;
  const first=await post(commander,'NORMAL-1');assert.equal(first.response.status,201,JSON.stringify(first.data));
  const second=await post(commander,'NORMAL-2');assert.equal(second.response.status,201,JSON.stringify(second.data));
  assert.equal(lab.world.resource('r-org0-water').quantity,before+1400,'normal sources do not inherit demo receipt caps or cadence');
  assert.equal((await post(commander,'NORMAL-1')).response.status,201);assert.equal(lab.world.resource('r-org0-water').quantity,before+1400);
});
