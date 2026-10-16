import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { operationalMapData } from '../src/map-data.mjs';

test('a city operational map includes every scoped report in its current directory, including closures beyond list limits', async t=>{
  const store=await Store.open();t.after(()=>store.close());
  await store.organization('org0');await store.organization('org1');
  const roads=Array.from({length:12716},(_,i)=>({id:`city-road-${i}`,from:`a${i}`,to:`b${i}`}));
  const geography={geography:{name:'Takamatsu, Kagawa, Japan'},nodes:[{id:'a0',x:0,z:0}],roads};
  await store.put('org0','context','geography',{map:geography},0);
  await store.query(`INSERT INTO entities(org,kind,id,data,created_at,updated_at)
    SELECT $1,'road',item->>'id',item-'id',0,0 FROM jsonb_array_elements($2::jsonb) AS item`,
    ['org0',JSON.stringify(roads.map((road,i)=>({id:road.id,open:i!==11000,at:i,sourceVersion:i+1})))]);
  await store.put('org1','road','city-road-11000',{open:true,privateNote:'Foreign report'},0);
  await store.put('org0','road','old-map-road',{open:false},0);
  await store.put('org0','need','need-1',{quantity:10},0);
  await store.put('org0','vehicle','truck-1',{state:'idle'},0);
  await store.put('org0','facility','shelter-1',{name:'Community Shelter'},0);
  const batches=[],getMany=store.getMany.bind(store),list=store.list.bind(store);
  store.getMany=async(org,kind,ids)=>{assert.equal(org,'org0');assert.equal(kind,'road');batches.push([...ids]);return getMany(org,kind,ids);};
  store.list=async(org,kind,limit)=>{assert.notEqual(kind,'road','Do not scan a road kind with an arbitrary limit');return list(org,kind,limit);};
  const result=await operationalMapData(store,'org0');
  assert.deepEqual(batches.map(page=>page.length),[10000,2716]);
  assert.deepEqual(batches.flat(),roads.map(road=>road.id));
  assert.equal(result.roads.length,12716);
  const closure=result.roads.find(road=>road.id==='city-road-11000');
  assert.equal(closure.open,false);assert.equal(closure.sourceVersion,11001);
  assert.equal(closure.privateNote,undefined);
  assert.ok(!result.roads.some(road=>road.id==='old-map-road'));
  assert.deepEqual(result.geography,geography);
  assert.equal(result.needs[0].id,'need-1');assert.equal(result.vehicles[0].id,'truck-1');assert.equal(result.facilities[0].id,'shelter-1');
});

test('missing geography triggers no road read and absent reports never become an assumed open road', async()=>{
  let geography=null,reads=0;
  const store={
    async get(){return geography?{map:geography}:null;},
    async list(){return [];},
    async getMany(org,kind,ids){reads++;assert.deepEqual(ids,['known','unknown']);return new Map([['known',{id:'known',open:false}]]);},
  };
  assert.deepEqual((await operationalMapData(store,'org0')).roads,[]);
  assert.equal(reads,0);
  geography={roads:[{id:'known'},{id:'unknown'},{id:'known'},{id:''},{}]};
  assert.deepEqual((await operationalMapData(store,'org0')).roads,[{id:'known',open:false}]);
  assert.equal(reads,1);
});
