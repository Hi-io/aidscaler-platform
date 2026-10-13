// Ignored, archived native arithmetic proof. No product/evaluator mutation.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {createLabServers} from '../sources/server.mjs';
import {World} from '../engine/world.mjs';
import {integrateUtilization} from '../engine/utilization.mjs';
import {evaluate} from '../evaluation/metrics.mjs';
import {ENGINE_BUILD} from '../contracts/config.mjs';
import {requireLoadedSimulatorBuild,simulatorFingerprint} from '../../nexo-platform/evaluation/simulator-build.mjs';

const script=fileURLToPath(import.meta.url),root=path.resolve(path.dirname(script),'..'),
  args=Object.fromEntries(process.argv.slice(2).map(v=>v.replace(/^--/,'').split(/=(.*)/s).slice(0,2))),
  folder=path.resolve(args.out??path.join(root,'../nexo-platform/reports/arithmetic-proof',String(Date.now()))),
  sha=b=>createHash('sha256').update(b).digest('hex'),save=(name,x)=>writeFile(path.join(folder,name),JSON.stringify(x,null,2));
const config={scenario:'S23',seed:'hand-sheet-native-human-2026-01',organizations:2,grid:5,extentKm:1,
  durationMs:1200000,policy:'none',hazard:'none',topology:'grid',postsPerHour:0,backgroundTraffic:0,
  packetLoss:0,healthReports:false,recurringNeeds:false,reviewMs:1000,
  networkLatencyMs:1000,queryLatencyMs:1000,loadMs:1000,unloadMs:1000,
  humanCapacity:{profile:'moderate',readers:1,deciders:1,relayers:1,readMs:1000,decisionMs:1000,relayMs:1000}};
const design=[{id:'hand-a',owner:'org0',quantity:50,send:50,deadline:600000},
  {id:'hand-b',owner:'org0',quantity:90,send:30,deadline:600000},
  {id:'hand-c',owner:'org1',quantity:40,send:40,deadline:600000},
  {id:'hand-d',owner:'org1',quantity:25,send:0,deadline:1800000}];
export function handSheet(needs,events,horizon){
  return needs.map(n=>{
    const receipts=events.filter(e=>e.type==='service_delivered'&&e.entity===n.id&&e.at<=horizon)
      .sort((a,b)=>a.at-b.at||a.index-b.index);
    let previous=0,served=0,integral=0,first=null,sufficient=null;
    for(const e of receipts){assert.ok(e.at>=previous);integral+=(e.at-previous)*(n.quantity-served);
      const useful=Math.min(Math.max(0,e.data.quantity),n.quantity-served);
      if(useful>0&&first===null)first=e.at;served+=useful;
      if(served===n.quantity&&sufficient===null)sufficient=e.at;previous=e.at;}
    integral+=(horizon-previous)*(n.quantity-served);
    return {...n,served,uncoveredUnitMs:integral,firstServiceAt:first,sufficientServiceAt:sufficient,
      firstCensored:first===null,sufficientCensored:sufficient===null,
      restrictedFirstMs:first??horizon,restrictedSufficientMs:sufficient??horizon,
      deadlineMatured:n.deadline<=horizon,missedMatureDeadline:n.deadline<=horizon&&(sufficient===null||sufficient>n.deadline),
      receipts:receipts.map(e=>({at:e.at,quantity:e.data.quantity,index:e.index}))};
  });
}
function currentOccupancy(w){
  // The journal retains all vehicle/operation states. The independent sheet
  // uses the explicit lifecycle receipt times for the final capacity integral.
  return {vehicles:w.state.vehicles.map(v=>({id:v.id,state:v.state,load:v.load??0,operation:v.operation??null})),
    operations:w.state.operations.map(o=>({id:o.id,state:o.state,times:{...o.times},createdAt:o.createdAt,received:o.received??0})),
    waterStock:w.state.resources.filter(r=>r.type==='water').reduce((s,r)=>s+r.quantity,0),
    reservedWater:w.state.resources.filter(r=>r.type==='water').reduce((s,r)=>s+r.reserved,0)};
}
function replayAuthored(initial,final){
  const replay=new World(initial.manifest.config,initial);
  for(const input of final.inputs.slice(initial.inputs.length)){
    while(replay.eventCount<input.afterEventCount){const e=replay.step();assert.ok(e&&e.at<=input.at);}
    assert.ok(replay.now<=input.at);integrateUtilization(replay,input.at);replay.now=input.at;
    try{if(input.kind==='intervention')replay.inject(input.type,input.data);
      else if(input.kind==='ingestion')replay.acknowledge(input.actor,input.request);
      else replay.act(input.actor,input.request);}catch{/* Rejected input ledger must reproduce. */}
  }
  while(!replay.advance(final.now).reached)assert.ok(!replay.modelBarrier());
  const original=new World(final.manifest.config,final),result={expected:original.stateHash(),actual:replay.stateHash()};
  result.matches=result.actual===result.expected;replay.close();original.close();return result;
}
export async function run(){
  assert.equal(args.authorization,'ROOT_GO_NUMERIC_RECEIPTS');await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,'arithmetic-proof.mjs'),await readFile(script));
  const initialBuild=await requireLoadedSimulatorBuild();assert.equal(initialBuild,ENGINE_BUILD);
  await save('protocol.json',{schema:'native-hand-arithmetic-v2',recordedAt:new Date().toISOString(),config,design,
    engineBuild:initialBuild,helperSha256:sha(await readFile(script)),modelCalls:0,
    controller:'Only ordinary HTTP received own need/resource/vehicle/proposal rows; fixed authored quantities; three exact owner reviews.',
    authoring:'Four authored needs and two original vehicles, no stock added. Initial checkpoint retained; reproduction is from this checkpoint, not an untouched seed-only S23.',
    limits:['Arithmetic and physical/authority evidence only; not comparative improvement, model quality or human empirical calibration.'],
    machine:{node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model}});
  let lab;const checks=[],ledger=[],originalFetch=globalThis.fetch;
  globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));return originalFetch(input,options);};
  try{
    lab=await createLabServers({observerPort:0,sourcePort:0,persistCredentials:false,config});const w=lab.world;
    w.updateNeed('need-water-main',{quantity:0});
    const buildings=w.state.map.buildings.filter(b=>b.use==='residential').slice(0,4);assert.equal(buildings.length,4);
    w.state.vehicles=w.state.vehicles.filter(v=>v.id==='v-org0-0'||v.id==='v-org1-0');
    for(const o of Object.values(w.state.observations))for(const id of Object.keys(o.vehicles))if(!w.state.vehicles.some(v=>v.id===id))delete o.vehicles[id];
    w.indices.clear();
    const cohort=design.map((n,i)=>({...n,building:buildings[i].id,type:'water',unit:'L',createdAt:0}));
    for(const n of cohort){const need=w.addNeed(n);w.send({kind:'need_observation',need:structuredClone(need),observedAt:w.now},n.owner,{sector:w.building(n.building).sector});}
    assert.equal(w.state.vehicles.length,2);assert.equal(w.state.needs.filter(n=>n.quantity>0).length,4);
    const initial=w.checkpoint(),initialStock=currentOccupancy(w).waterStock;await save('initial-checkpoint.json',initial);
    const base=`http://127.0.0.1:${lab.sourcePort}`,owners={};
    for(const org of ['org0','org1']){const key=Object.entries(lab.actorKeys).find(([,a])=>a.org===org)[0];
      // Scope provisioning is private laboratory setup, not a cognitive or
      // physical action. Neither key nor private observer state is archived.
      const commander='native-hand-owner-key-'+org;lab.actorKeys[commander]={id:'hand-owner-'+org,org,role:'commander'};
      owners[org]={key,commander,issued:new Set(),pending:null};}
    const request=async(org,path,body,commander=false)=>{
      const response=await fetch(base+path,{headers:{Authorization:'Bearer '+owners[org][commander?'commander':'key'],
        ...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
      assert.ok(response.ok,`${org} ${path} HTTP${response.status}`);return response.json();};
    const action=(org,type,params,key,commander=false)=>request(org,'/api/actor/action',{type,params,idempotencyKey:key},commander);
    for(let turn=1;turn<=600;turn++){
      w.advance(turn*2000);
      for(const org of ['org0','org1']){
        const owner=owners[org],view=await request(org,'/api/actor/state');
        if(owner.pending){const p=view.proposals.find(p=>p.id===owner.pending.id);
          if(p?.state==='authorized'){
            assert.equal(w.need(owner.pending.need).served,0,'Owner approval is not useful physical aid');
            // This private assertion is an observer diagnostic, not a controller decision.
            await action(org,'dispatch',{...owner.pending.params,proposal:p.id,step:0},'hand-dispatch-'+owner.pending.need,true);
            owner.issued.add(owner.pending.need);owner.pending=null;
          }
        }
        if(!owner.pending){
          const next=design.find(n=>n.owner===org&&n.send>0&&!owner.issued.has(n.id));
          if(!next)continue;
          const need=view.known.needs[next.id],resource=Object.values(view.known.resources).find(r=>r.owner===org&&r.type==='water'&&r.quantity-r.reserved-r.floor>=next.send),
            vehicle=Object.values(view.known.vehicles).find(v=>v.owner===org&&!v.load&&['idle','arrived'].includes(v.state)&&v.driverAvailable!==false);
          if(!need||!resource||!vehicle)continue;
          const params={need:need.id,resource:resource.id,vehicle:vehicle.id,quantity:next.send,ttlMs:900000};
          const p=await action(org,'propose',{title:'Fixed hand arithmetic '+need.id,references:[need.id,resource.id,vehicle.id],plan:{actions:[{type:'dispatch',owner:org,params}]}},'hand-proposal-'+need.id);
          await action(org,'review',{id:p.id,decision:'approve'},'hand-review-'+need.id,true);owner.pending={id:p.id,need:need.id,params};
        }
      }
      ledger.push({at:w.now,...currentOccupancy(w)});
    }
    const final=w.checkpoint(),events=[...w.log],metrics=evaluate(w),hand=handSheet(cohort,events,w.now);
    await save('final-checkpoint.json',final);await save('observational-ledger.json',{ledger,events});
    for(const n of hand){
      const row=metrics.perCommunity.find(r=>r.id===n.id),physical=w.need(n.id);
      const nativeIntegral=physical.pendingIntegral+(w.now-physical.integratedAt)*(physical.quantity-physical.served);
      assert.equal(row.served,n.served);assert.equal(row.firstServiceAt,n.firstServiceAt);assert.equal(row.sufficientServiceAt,n.sufficientServiceAt);assert.equal(nativeIntegral,n.uncoveredUnitMs);
      assert.equal(n.served,n.send);checks.push({name:'independent integral/timestamp/censor '+n.id,passed:true});
    }
    const [a,b,c,d]=hand,H=w.now;
    assert.equal(a.uncoveredUnitMs,50*a.firstServiceAt);assert.equal(b.uncoveredUnitMs,90*b.firstServiceAt+60*(H-b.firstServiceAt));
    assert.equal(c.uncoveredUnitMs,40*c.firstServiceAt);assert.equal(d.uncoveredUnitMs,25*H);
    assert.equal(b.sufficientCensored,true);assert.equal(d.firstCensored,true);assert.equal(d.deadlineMatured,false);
    const operations=w.state.operations.filter(o=>o.type==='delivery'),received=operations.reduce((s,o)=>s+(o.received??0),0),
      stock=currentOccupancy(w).waterStock,cargo=w.state.vehicles.reduce((s,v)=>s+(v.resourceType==='water'?v.load??0:0),0);
    assert.equal(received,120);assert.equal(initialStock,stock+cargo+received);assert.equal(currentOccupancy(w).reservedWater,0);
    const journeys=operations.map(o=>({id:o.id,requestedAt:o.createdAt,physicalReceiptAt:o.times.service,
      vehicleCommittedMs:o.times.service-o.createdAt})),vehicleCommittedMs=journeys.reduce((s,o)=>s+o.vehicleCommittedMs,0);
    assert.equal(metrics.utilization.vehicleCommittedMs,vehicleCommittedMs,'Each complete shipment occupies its finite vehicle from request until physical service');
    const human=metrics.humanCapacity;assert.equal(human.stages.decide.completed,3);assert.equal(human.stages.decide.elapsedWorkPersonMs,3000);
    assert.equal(human.stages.read.received,0);assert.equal(human.stages.relay.received,0);
    const replay=replayAuthored(initial,final);assert.equal(replay.matches,true);assert.deepEqual(w.invariants(),[]);assert.equal(w.state.modelCalls,0);
    const finalBuild=await simulatorFingerprint();assert.equal(finalBuild,initialBuild);
    checks.push(...['explicit numerical formulas','stock/reservation/cargo conservation','vehicle lifecycle integral','native source review integral','exact authored checkpoint replay'].map(name=>({name,passed:true})));
    await save('hand-sheet.json',{hand,formulas:['A=50*tA','B=90*tB+60*(H-tB)','C=40*tC','D=25*H'],horizonMs:H,
      unit:'L·ms',initialStock,stock,cargo,received,journeys,vehicleCommittedMs,nativeOwnerReviewPersonMs:3000,
      empiricalHumanHours:null,empiricalHumanHoursReason:'Source review timing is modeled, not a measurement of professional cognitive effort.'});
    await save('result.json',{passed:true,checks,initialBuild,finalBuild,modelCalls:0,invariants:[],replay,metrics,
      helperSha256:sha(await readFile(script)),scope:'Native arithmetic/authority/physical proof; no comparative benefit claim.'});
    console.log(JSON.stringify({passed:true,checks:checks.length,engineBuild:finalBuild,report:path.join(folder,'result.json')}));
  }catch(error){await save('result.json',{passed:false,checks,initialBuild,finalBuild:await simulatorFingerprint(),
    error:{name:error.name,message:error.message},modelCalls:0});console.error(JSON.stringify({passed:false,error:error.message,report:path.join(folder,'result.json')}));process.exitCode=1;
  }finally{await lab?.close();globalThis.fetch=originalFetch;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===script)await run();
