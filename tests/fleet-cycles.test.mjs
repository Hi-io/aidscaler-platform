import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationPlan } from '../src/planning.mjs';
function fixture() {
 const times=[[18,17,4],[49,14,31],[28,7,28]];
 const owners=['o0','o1','o2'];
 return {
  needs:[0,1,2].map(i=>({id:'n'+i,type:'water',quantity:1,node:'N'+i,priority:3-i})),
  resources:owners.map(owner=>({id:'r',owner,type:'water',quantity:10,reserved:2,floor:2,node:owner})),
  vehicles:owners.map(owner=>({id:'v',owner,node:owner,state:'idle',capacity:10,weightKg:1000})),
  map:{roads:owners.flatMap((owner,i)=>times[i].map((seconds,j)=>({id:owner+'N'+j,from:owner,to:'N'+j,lengthM:seconds*10,speedMps:10,open:true})))},
  executionPolicy:{reservation:{defaultTtlMs:900000,maxTtlMs:86400000},delivery:{loadMs:0,unloadMs:0,commandNominalLatencyMs:0}}
 };
}
test('bounded three-way matching escapes the received pair-swap local minimum without changing admission',()=>{
 const f=fixture(), originals=structuredClone(f), p=allocationPlan(f);
 assert.equal(p.assignment.beforeSeconds,56);assert.equal(p.assignment.afterSeconds,46);
 assert.equal(p.assignment.swaps,0);assert.equal(p.assignment.cycles,1);
 assert.deepEqual(p.allocations.map(a=>[a.need,a.quantity,a.owner]),[['n0',1,'o2'],['n1',1,'o1'],['n2',1,'o0']]);
 assert.deepEqual(f,originals);assert.deepEqual(allocationPlan(f),p);assert.equal(p.unserved.length,0);
});
test('cycle matching preserves windows, ownership, already assigned fleet and received route restrictions',()=>{
 for(const mode of ['deadline','closed','busy','capacity','driver','lot','fuel']){
  const f=fixture();
  if(mode==='deadline')f.needs[0].deadline=18000;
  if(mode==='closed')f.observedRoads={o2N0:{open:false}};
  if(mode==='busy')f.operations=[{id:'trip',owner:'o2',vehicle:'v',state:'travelling'}];
  if(mode==='capacity')f.vehicles[2].capacity=0;
  if(mode==='driver')f.vehicles[2].driverAvailable=false;
  if(mode==='lot'){f.resources[2].lotId='current';f.resources[2].useByAt=10000;}
  if(mode==='fuel'){f.vehicles[2].fuel=1;f.vehicles[2].fuelMlPerKm=1000;}
  const p=allocationPlan(f);assert.equal(p.assignment.cycles,0,mode);
  if(mode==='busy')assert.ok(p.allocations.every(a=>a.owner!=='o2'));
 }
});
test('cycle matching does not turn resources with different types into substitute quantities',()=>{
 const f=fixture();f.resources[2].type='food';
 const p=allocationPlan(f);assert.equal(p.assignment.cycles,0);
 assert.ok(p.allocations.every(a=>a.owner!=='o2'));
 assert.equal(p.unserved.length,1);
});
test('an unequal-quantity rotation cannot spend another owner\'s protected or reserved stock',()=>{
 const f=fixture();f.needs.forEach((n,i)=>n.quantity=i+1);
 f.resources.forEach((r,i)=>r.quantity=[5,7,6][i]);
 const p=allocationPlan(f);
 assert.equal(p.assignment.beforeSeconds,56);assert.equal(p.assignment.afterSeconds,56);
 assert.equal(p.assignment.cycles,0);assert.equal(p.unserved.length,0);
 assert.deepEqual(p.allocations.map(a=>[a.need,a.quantity,a.owner]),[['n0',1,'o0'],['n1',2,'o2'],['n2',3,'o1']]);
});
test('unknown command or handling time cannot be treated as zero to approve a deadline-preserving rotation',()=>{
 const f=fixture();f.needs.forEach(n=>n.deadline=60000);
 delete f.executionPolicy.delivery.unloadMs;
 const p=allocationPlan(f);assert.equal(p.assignment.cycles,0);assert.equal(p.assignment.afterSeconds,56);
});
