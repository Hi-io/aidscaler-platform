import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { workspacePulse, recordedWorkLabel } from '../src/workspace-pulse.mjs';
import { newItemsSince } from '../ui/live.mjs';
import { monitorState, monitorTitle, agentMonitor } from '../ui/autonomy.mjs';

const now = 1900000000000;
async function fixture(t) {
  const store = await Store.open(); await store.organization('org0'); await store.organization('org1');
  t.after(() => store.close());
  await store.put('org0','context','operational',{snapshot:{runId:'current-run',now:900000000,organization:{id:'org0'}}},0);
  await store.put('org1','context','operational',{snapshot:{runId:'other-run',now:999999999}},0);
  const entity = async (org,kind,id,data,created=now-1000) => {
    await store.put(org,kind,id,data,0);
    await store.query('UPDATE entities SET created_at=$4,updated_at=$4 WHERE org=$1 AND kind=$2 AND id=$3',[org,kind,id,created]);
  };
  const job = async (id,{org='org0',kind='investigate',state='queued',leasedUntil=null,created=now-1000}={}) => {
    await store.enqueue(org,kind,{private:'Secret untrusted request'},id);
    await store.query('UPDATE jobs SET state=$2,leased_until=$3,created_at=$4 WHERE id=$1',[id,state,leasedUntil,created]);
  };
  return {store,entity,job};
}

test('workspace pulse is scoped to one organization and counts distinct flows, live inference leases and queued work', async t => {
  const {store,entity,job}=await fixture(t);
  await entity('org0','signal','s1',{state:'unverified'}); await entity('org0','signal','s2',{state:'erased'});
  await entity('org1','signal','private-signal',{state:'unverified'});
  await entity('org0','activity','f1',{state:'checking',steps:[]});
  await entity('org0','activity','f2',{state:'ready',steps:[]});
  await entity('org1','activity','private-flow',{state:'reading',steps:[]});
  await store.upsert('org0','activity','f1',{steps:[{tool:'lookup'},{tool:'verify'}]});
  for(const kind of ['investigate','discover_response','compile_response','interpret_sources','analyze_media']) await job('live-'+kind,{kind,state:'running',leasedUntil:now+1000});
  await job('queued'); await job('retry',{state:'retry'});
  await job('expired',{state:'running',leasedUntil:now-1});
  await job('exact-expiry',{state:'running',leasedUntil:now});
  await job('no-lease',{state:'running'});
  await job('completed',{state:'completed',leasedUntil:now+1000});
  await job('background',{kind:'ingest',state:'running',leasedUntil:now+1000});
  await job('other-org',{org:'org1',state:'running',leasedUntil:now+1000});
  const p=await workspacePulse(store,'org0',{now});
  assert.equal(p.runId,'current-run'); assert.deepEqual(p.signals,{received:2,available:1});
  assert.deepEqual(p.flows,{total:2,lastHour:2,lastMinute:2,active:5,queued:2});
  assert.equal(p.recent.length,2); assert.equal(p.recent.find(a=>a.id==='f1').stepCount,2);
  assert.ok(!p.recent.some(a=>a.id==='private-flow'));
});

test('hour and minute counters are organization-wide wall-time flows rather than accelerated scenario time or update frequency', async t => {
  const {store,entity}=await fixture(t);
  for(const [id,created] of [['old',now-3600001],['hour-boundary',now-3600000],['hour',now-60001],['minute-boundary',now-60000],['recent',now-200]])
    await entity('org0','activity',id,{state:'ready',startedAt:1,steps:[]},created);
  await store.upsert('org0','activity','old',{state:'checking',steps:[{tool:'lookup'}]});
  const p=await workspacePulse(store,'org0',{now});
  assert.deepEqual(p.flows,{total:5,lastHour:4,lastMinute:2,active:0,queued:0});
  assert.equal(newItemsSince(p,await workspacePulse(store,'org0',{now:now+1000}),'activity'),0,'updated flows are not newly started flows');
});

test('erasing source content lowers availability without manufacturing new collected signals or workflow starts', async t => {
  const {store,entity}=await fixture(t);
  await entity('org0','signal','s1',{state:'unverified',text:'Private original'});
  await entity('org0','signal','s2',{state:'unverified'});
  await entity('org0','activity','f1',{state:'ready',steps:[{tool:'lookup'}]});
  const before=await workspacePulse(store,'org0',{now});
  await store.upsert('org0','signal','s1',{state:'erased',text:null});
  await store.upsert('org0','activity','f1',{erasure:{at:now},steps:[]});
  const erased=await workspacePulse(store,'org0',{now:now+1000});
  assert.deepEqual(erased.signals,{received:2,available:1});
  assert.equal(newItemsSince(before,erased,'signal'),0); assert.equal(newItemsSince(before,erased,'activity'),0);
  assert.equal(erased.recent[0].label,'Source content removed');assert.equal(erased.recent[0].stepCount,0);
  await entity('org0','signal','s3',{state:'unverified'});
  const next=await workspacePulse(store,'org0',{now:now+2000});assert.equal(newItemsSince(before,next,'signal'),1);
});

test('pulse never projects source content, tool arguments/results, private reasoning, provider data or credentials', async t => {
  const {store,entity,job}=await fixture(t);
  const secret='PRIVATE_UNTRUSTED_CONTENT_12345';
  await entity('org0','signal','s1',{state:'unverified',text:secret,attachments:[{description:secret}],metadata:{key:secret}});
  await entity('org0','activity','flow',{state:'checking',startedAt:now-100,model:secret,summary:secret,rationale:secret,thoughts:secret,
    steps:[{tool:'lookup',label:secret,text:secret,params:{apiKey:secret},result:{text:secret},reasoning:secret}],result:secret,providerResponse:secret});
  await job('job',{state:'running',leasedUntil:now+1000});
  await store.query('UPDATE jobs SET result=$2,last_error=$3,payload=$4 WHERE id=$1',['job',JSON.stringify({secret}),secret,JSON.stringify({secret})]);
  const p=await workspacePulse(store,'org0',{now}), encoded=JSON.stringify(p);
  assert.doesNotMatch(encoded,new RegExp(secret));
  assert.deepEqual(Object.keys(p.recent[0]).sort(),['eventKey','finishedAt','id','label','startedAt','state','stepCount','updatedAt','version'].sort());
  assert.equal(p.recent[0].label,'Checking operational data');
  assert.equal(recordedWorkLabel({state:'ready',steps:[{tool:'unknown-secret-tool',label:secret}]}),'Investigation results recorded');
});

test('freshness delta ignores absent snapshots, counter decreases and run replacements', () => {
  const baseline={runId:'r1',signals:{received:100,available:80},flows:{total:20}};
  assert.equal(newItemsSince(undefined,baseline,'signal'),0);assert.equal(newItemsSince(baseline,undefined,'signal'),0);
  assert.equal(newItemsSince(baseline,{...baseline,signals:{received:107,available:1}},'signal'),7);
  assert.equal(newItemsSince(baseline,{...baseline,flows:{total:24}},'activity'),4);
  assert.equal(newItemsSince(baseline,{...baseline,signals:{received:20}},'signal'),0);
  assert.equal(newItemsSince(baseline,{...baseline,runId:'r2',signals:{received:200}},'signal'),0);
  assert.equal(newItemsSince({...baseline,runId:null},{...baseline,signals:{received:200}},'signal'),0);
  assert.equal(newItemsSince(baseline,{...baseline,runId:null,signals:{received:200}},'signal'),0);
});

test('live monitor names actual workflows and retains budget/paused state instead of claiming fictitious parallel agents', () => {
  const intake={policy:{enabled:true},runtime:{state:'monitoring',active:99,queued:99}};
  const pulse={flows:{active:2,queued:3,lastHour:31,lastMinute:4}};
  assert.deepEqual(monitorState(intake,pulse),{active:2,queued:3,lastHour:31,lastMinute:4,pending:0,enabled:true,state:'monitoring'});
  assert.match(monitorTitle(intake,pulse,'google/gemma-4-31b-it'),/Gemma 4 is investigating/);
  assert.equal(monitorTitle({policy:{enabled:true},runtime:{state:'budget_limit'}},{flows:{active:0,queued:3}},'x'),'Model budget reached');
  assert.equal(monitorTitle({policy:{enabled:false}},{flows:{active:0,queued:3}},'x'),'Automatic investigation is paused');
  const markup=agentMonitor(intake,{pulse,model:'google/gemma-4-31b-it',escape:String,icon:()=>'<svg></svg>'});
  assert.match(markup,/2 active workflows/);assert.match(markup,/31 flows started · last hour/);
  assert.doesNotMatch(markup,/99|2 agents/);
});

// Malformed snapshots should never turn a freshness banner into NaN or count all historical records as new.
test('freshness delta fails closed for missing, nonfinite and fractional aggregate counters', () => {
  const good={runId:'r1',signals:{received:100},flows:{total:20}};
  for(const invalid of [{runId:'r1'}, {runId:'r1',signals:{received:NaN}}, {runId:'r1',signals:{received:Infinity}}, {runId:'r1',signals:{received:'invalid'}}, {runId:'r1',signals:{received:-1}}, {runId:'r1',signals:{received:1.5}}]) {
    assert.equal(newItemsSince(invalid,good,'signal'),0);
    assert.equal(newItemsSince(good,invalid,'signal'),0);
  }
});
