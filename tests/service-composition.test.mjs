import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness,scriptedReview} from '../evaluation/harness.mjs';
import {servicePlan} from '../src/services.mjs';

test('four scoped instances independently authorize complementary physical deliveries before opening a service',async t=>{
  const h=await createHarness({scenario:'S19',seed:'nexo-composition-functional',organizations:4});t.after(()=>h.close());
  h.lab.world.advance(60000);
  for(const app of h.apps){
    for(const target of ['inventory','vehicles','map'])await app.connector.action('query',{target},'composition-'+app.config.org+'-'+target);
    await app.ingestion.sync();
  }
  const a=h.apps[0],org=a.config.org;
  const building=(await a.store.get(org,'context','geography')).map.places.find(b=>b.use==='shelter');
  assert.ok(building,'Candidate uses an actor-visible facility, never evaluator truth');
  const assessment=await a.connector.action('verify',{target:'building',id:building.id},'composition-inspection');
  const verification=(await a.connector.state()).inspections.find(v=>v.id===assessment.id);
  assert.equal(verification.state,'completed');await a.store.upsert(org,'verification',verification.id,verification);await a.ingestion.sync({sources:false});
  const isolated=await servicePlan(a.store,org,building.id);assert.equal(isolated.readyToDraft,false);
  assert.ok(isolated.missing.some(m=>['energy','sanitation','staff'].includes(m.type)));
  for(const app of h.apps.slice(1)){
    const actor=(await app.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",[app.config.org])).rows[0];
    for(const kind of ['resource','vehicle'])for(const r of await app.store.list(app.config.org,kind,100))await app.network.share(actor,{kind,id:r.id,version:r.version,to:org},'composition-share-'+r.id);
    while(await app.worker.once()){}
  }
  const joint=await servicePlan(a.store,org,building.id);assert.equal(joint.readyToDraft,true,JSON.stringify(joint.missing));assert.equal(joint.ownerApprovals.length,4);
  const p=await a.domain.propose({id:'functional-agent',org,role:'agent'},{title:'Open the shelter with complementary capabilities',summary:'Four owners provide checked dependencies',benefit:'A physical operating shelter',rationale:'Received safety assessment, finite stock, compatible power and separate transport.',actions:joint.actions,references:joint.references,conditions:[],alternatives:[]},'composition-draft');
  await scriptedReview(a,p);await a.worker.execute(p.id);while(await a.worker.once()){}
  for(const app of h.apps.slice(1)){const received=await app.store.list(app.config.org,'proposal',100);assert.ok(received.length);assert.equal(received[0].authorization,null);assert.equal((await app.connector.state()).operations.some(o=>o.type==='delivery'),false,'The origin cannot dispatch another owner stock');}
  for(let i=0;i<100;i++){
    h.lab.world.advance(Math.min(h.lab.world.config.durationMs,h.lab.world.now+60000));
    for(const app of h.apps){
      await app.ingestion.sync({sources:false});
      for(const row of await app.store.list(app.config.org,'proposal',100)){
        if(row.state==='awaiting_review')await scriptedReview(app,row);
        if(['authorized','executing','awaiting_partner'].includes((await app.store.get(app.config.org,'proposal',row.id)).state))await app.worker.execute(row.id);
      }
      while(await app.worker.once()){}
    }
    if((await a.store.get(org,'proposal',p.id)).state==='completed')break;
  }
  const finished=await a.store.get(org,'proposal',p.id);assert.equal(finished.state,'completed',JSON.stringify(finished.executionResults));
  const actual=h.lab.world.building(building.id);assert.equal(actual.state,'operating');assert.deepEqual(h.lab.world.invariants(),[]);
  const trace=h.lab.world.state.operations.filter(o=>o.type==='delivery');assert.equal(new Set(trace.map(o=>o.org)).size,4);assert.ok(trace.every(o=>['received','completed'].includes(o.state)));
  assert.ok(finished.executionResults.filter(r=>r.owner).every(r=>r.partnerResult.confirmedBySource));
});
