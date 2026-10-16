import test from 'node:test';
import assert from 'node:assert/strict';
import { createExternalGateway } from '../src/external-gateway.mjs';
import { Store } from '../src/store.mjs';
import { takamatsuRoads } from '../../disaster-response-simulator/generators/takamatsu.mjs';

test('city-scale contractor observations coalesce, batch exact IDs and leave unchanged source versions stable', async t => {
  const graph = takamatsuRoads(), store = await Store.open();
  let reads = 0, active = 0, peak = 0, batches = 0, maxBatch = 0, writes = 0;
  const snapshot = {organization:{id:'org4'},now:10,operations:[],queries:[],known:{
    edges:Object.fromEntries(graph.edges.map(edge=>[edge.id,{id:edge.id,from:edge.from,to:edge.to,open:true,version:1}])),
    resources:{water:{id:'water',owner:'org4',quantity:80,floor:10,reserved:5}},
    vehicles:{truck:{id:'truck',owner:'org4',state:'idle'}}, needs:{}, buildings:{},
    map:{nodes:graph.nodes,roads:graph.edges.map(({id,from,to,points,name})=>({id,from,to,points,name})),places:[],geography:graph.source},
  }};
  const connector = {async state(){
    reads++; peak=Math.max(peak,++active);
    await new Promise(resolve=>setTimeout(resolve,10));
    active--;
    return structuredClone(snapshot);
  }};
  const gateway = await createExternalGateway({org:'org4',connector,store,bootstrapPassword:'test-only-owner-password'});
  t.after(async()=>{await gateway.close();await store.close();});
  await store.organization('other');
  await store.upsert('other','resource','water',{owner:'other',quantity:900});
  const transaction = store.transaction.bind(store);
  store.transaction = fn=>transaction(async tx=>{
    const getMany = tx.getMany.bind(tx), query = tx.query.bind(tx);
    tx.getMany = (org,kind,ids)=>{assert.equal(org,'org4');batches++;maxBatch=Math.max(maxBatch,ids.length);return getMany(org,kind,ids);};
    tx.query = (sql,args)=>{if(/INSERT INTO entities/.test(sql)) writes++;return query(sql,args);};
    return fn(tx);
  });
  const observations = await Promise.all(Array.from({length:8},()=>gateway.observe()));
  assert.equal(reads,1,'Startup and worker overlap share one scoped read/commit');
  assert.equal(peak,1);
  assert.ok(observations.every(value=>value===observations[0]));
  assert.equal(graph.edges.length,12716);
  assert.equal(Number((await store.query("SELECT COUNT(*) AS count FROM entities WHERE org='org4' AND kind='road'")).rows[0].count),12716);
  assert.ok(batches>=26 && maxBatch<=500,'Every exact-ID page is bounded, even above the 10000-ID API limit');
  assert.ok(writes<40,'City roads use bounded bulk writes rather than one SQL write per road');
  const water = await store.get('org4','resource','water'), geography = await store.get('org4','context','geography');
  const firstRoad = graph.edges[0].id, beforeRoad = await store.get('org4','road',firstRoad);
  assert.equal(water.quantity,80);assert.equal(water.floor,10);assert.equal(water.reserved,5);
  assert.equal((await store.get('other','resource','water')).quantity,900,'Another organization is never overwritten');
  assert.equal(geography.map.geography.name,'Takamatsu, Kagawa, Japan');
  const previousWrites = writes;
  await gateway.observe();
  assert.equal(writes,previousWrites,'Identical dynamic observations and static map cause no entity writes');
  assert.equal((await store.get('org4','road',firstRoad)).version,beforeRoad.version);
  assert.equal((await store.get('org4','resource','water')).version,water.version);
  assert.equal((await store.get('org4','context','geography')).version,geography.version);
  await store.upsert('org4','resource','water',{operatorNote:'Keep the protected floor available'});
  const notedVersion=(await store.get('org4','resource','water')).version;
  snapshot.known.resources.water.quantity=75;
  snapshot.known.edges[firstRoad].open=false;
  await gateway.observe();
  const updated = await store.get('org4','resource','water');
  assert.equal(updated.quantity,75);assert.equal(updated.operatorNote,'Keep the protected floor available');
  assert.equal(updated.version,notedVersion+1);
  assert.equal((await store.get('org4','road',firstRoad)).open,false);
  assert.equal((await store.get('org4','road',firstRoad)).version,beforeRoad.version+1);
  assert.equal((await store.get('org4','context','geography')).version,geography.version);
});

test('failed contractor observation releases its single-flight lock and rejects a wrong organization before writing', async t=>{
  const store=await Store.open();
  let org='other',calls=0;
  const gateway=await createExternalGateway({org:'org4',store,bootstrapPassword:'test-only-owner-password',connector:{async state(){calls++;return {organization:{id:org},known:{resources:{water:{quantity:1}}}};}}});
  t.after(async()=>{await gateway.close();await store.close();});
  await assert.rejects(gateway.observe(),{code:'SOURCE_ORG'});
  assert.equal((await store.list('org4','resource')).length,0);
  org='org4';
  await gateway.observe();
  assert.equal(calls,2);
  assert.equal((await store.get('org4','resource','water')).quantity,1);
});
