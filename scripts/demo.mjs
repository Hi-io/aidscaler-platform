import {createLabServers} from '../../disaster-response-simulator/sources/server.mjs';
import {evaluate} from '../../disaster-response-simulator/evaluation/metrics.mjs';
import {createPlatform} from '../server.mjs';
import {Store} from '../src/store.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const scenario=process.env.DEMO_SCENARIO??'S23';
const lab=await createLabServers({observerPort:0,sourcePort:0,persistCredentials:false,config:{scenario,seed:process.env.DEMO_SEED??'nexo-live-demo-001',policy:'none',mode:'modeled',grid:5,extentKm:2,topology:'grid',hazard:'none',backgroundTraffic:0,postsPerHour:0,packetLoss:0,networkLatencyMs:1000,queryLatencyMs:1000,reviewMs:1000,inspectionMs:1000,loadMs:1000,unloadMs:1000,setupMs:1000,durationMs:14400000}});
const [agent]=Object.entries(lab.actorKeys).find(([,a])=>a.org==='org0');const humanKey='local-demo-human-key';lab.actorKeys[humanKey]={id:'evaluation-operator',org:'org0',role:'commander'};
const store=await Store.open();const app=await createPlatform({port:0,org:'org0',store,sourceUrl:`http://127.0.0.1:${lab.sourcePort}`,sourceAgentKey:agent,sourceHumanKey:humanKey,autoIngest:false,startWorker:false,writeAccessFile:false,bootstrapPassword:'local-demo-password',maxCalls:8});
const control=async b=>{const r=await fetch(`http://127.0.0.1:${lab.observerPort}/api/control`,{method:'POST',headers:{Authorization:`Bearer ${lab.observerKey}`,'Content-Type':'application/json'},body:JSON.stringify(b)});if(!r.ok)throw new Error('Evaluation clock control failed.');};
try{
  console.log('Demo: collecting actor-visible sources.');lab.world.advance(60000);await app.ingestion.sync();await control({play:true,rate:1000});
  const originalActivity=app.investigator.activity.bind(app.investigator);let previous='';app.investigator.activity=async(id,data)=>{const step=data.steps.at(-1),label=data.state+' '+(step?.tool??'')+' '+(step?.state??'');if(label!==previous){console.log('Demo:',label);if(step?.state==='failed')console.log('Check feedback:',String(step.result?.message).slice(0,300));previous=label;}return originalActivity(id,data);};
  const activity=await app.investigator.run({},'live-demo-'+scenario+'-'+Date.now());await control({play:false});
  let outcome={proposal:false,authorized:false,executed:false,receipt:false};
  if(activity.proposalId){outcome.proposal=true;const p=await store.get('org0','proposal',activity.proposalId);const pending=p.conditions.filter(c=>!c.satisfied);console.log('Model proposal:',p.title,'· pending conditions:',pending.length);
    if(!pending.length){const actor=(await store.query("SELECT id,org,name,role FROM users WHERE org=$1 AND role='commander'",['org0'])).rows[0];await app.domain.review(actor,p.id,{version:p.version,decision:'approve',note:'Scripted evaluation operator. This does not measure human comprehension.'},'demo-authorize-'+p.id);outcome.authorized=true;await control({play:true,rate:1000});try{await app.worker.execute(p.id);outcome.executed=true;}catch(e){outcome.executionError=e.code??e.message;}await control({play:false});lab.world.advance(lab.world.config.durationMs);await app.ingestion.sync();outcome.receipt=lab.world.state.operations.some(o=>o.times?.received!=null);}
  }
  const usage=(await store.query('SELECT episode,model,state,wall_ms,input_tokens,output_tokens,cost_usd,provider_id FROM usage')).rows;
  const report={at:new Date().toISOString(),scenario,seed:lab.world.config.seed,engineBuild:lab.world.manifest.engineBuild,clock:'modeled, accelerated; live provider latency separately recorded',operator:'scripted; not a human UX trial',outcome,activity,usage,metrics:evaluate(lab.world),invariants:lab.world.invariants()};
  await mkdir('reports/runs',{recursive:true});await writeFile(`reports/runs/demo-${scenario}-${Date.now()}.json`,JSON.stringify(report,null,2));await writeFile(`reports/live-demo-${scenario}.json`,JSON.stringify(report,null,2));assert.equal(report.invariants.length,0);assert.ok(usage.some(u=>u.state==='completed'),'The model must actually run.');console.log(JSON.stringify({scenario,outcome,model:app.config.modelId,calls:usage.length,costUsd:usage.reduce((n,u)=>n+Number(u.cost_usd??0),0),served:report.metrics.services,integrity:report.invariants.length===0},null,2));
}finally{await app.close();await store.close();await lab.close();}
