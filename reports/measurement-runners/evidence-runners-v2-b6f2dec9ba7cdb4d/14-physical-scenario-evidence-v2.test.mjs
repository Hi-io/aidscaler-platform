import test from 'node:test';
import assert from 'node:assert/strict';
import {PHYSICAL_PLAN, physicalChainReadout, selectPublicFacility, hazardLeads,draftMaterialKey} from './physical-scenario-evidence-v2.mjs';

function plantFixture() {
  return {protocol:{common:{horizonMs:1000}},scenario:'S03',variant:'standard',status:'completed',sourceStoppedAt:1000,selectedFacility:{id:'plant'},usage:[],invariants:[],
    finalBuilds:{candidateChanged:false,evaluatorChanged:false,simulatorChanged:false},
    scorerOnlySource:{facilities:[{id:'plant',openAt:20}],resources:[{id:'production-plant',owner:'org0',produced:100},{id:'raw-plant',consumed:100}],
      needs:[{id:'n',type:'water',unit:'L',quantity:80,served:100,completedAt:100}],
      operations:[{id:'o',org:'org0',type:'delivery',resource:'production-plant',need:'n',received:100,createdAt:40,times:{service:100},state:'received'}]},
    proposalFunnel:{records:[{steps:[{sourceId:'o',owner:'org0',correctlyLinked:true,usefulPhysicalService:true}]}]}};
}
function evacuationFixture() {
  const f=plantFixture();f.scenario='S05';f.scorerOnlySource.operations=[{id:'o',org:'org0',type:'evacuation',need:'n',building:'shelter',received:20,
    quantity:20,createdAt:40,times:{service:100},state:'completed'}];f.scorerOnlySource.needs=[{id:'n',type:'shelter',unit:'place',building:'b',quantity:20,served:20,completedAt:100}];
  f.receivedHazardLeads=[{id:'s',version:1,location:'b',receivedAtSourceClock:10,firstReadAtSourceClock:12}];
  f.receivedNeedSnapshots=[{id:'n',type:'shelter',quantity:20,firstReadAtSourceClock:20}];return f;
}
test('six predeclared native attempts neither presume success nor add model/resource authority',()=>{
  assert.equal(PHYSICAL_PLAN.worlds.length,6);assert.equal(PHYSICAL_PLAN.modelCallsAllowed,0);
  assert.deepEqual(PHYSICAL_PLAN.worlds.filter(w=>w.variant==='infeasible').map(w=>w.compositionVariant),['insufficient_staff','insufficient_staff']);
  assert.equal(PHYSICAL_PLAN.worlds.filter(w=>/favorable/.test(w.declaredLabel)).every(w=>w.declaredLabel.includes('not_presumed')),true);
});
test('selector uses only received public directory; raw source labels cannot determine the selected building',()=>{
  assert.equal(selectPublicFacility({places:[{id:'z',use:'plant'},{id:'a',use:'plant'}]},'plant').id,'a');
  assert.equal(selectPublicFacility({private:{plantId:'secret'},places:[]},'plant'),null);
  const signals=[{id:'s',text:'Visible damage near b. Families are outside.',location:'b',receivedAtSourceClock:12},
    {id:'c',text:'Fire',location:'not-in-directory'},{id:'d',text:'Fire',location:'b',deleted:true}];
  assert.deepEqual(hazardLeads(signals,{places:[{id:'b'}]}).map(s=>s.id),['s']);
});
test('unchanged source polls do not redraft, but real stock receipts allow another independently reviewed batch',()=>{
  const plan={actions:[{type:'dispatch',owner:'org0',params:{need:'n',resource:'r',vehicle:'v',quantity:100}}],references:['r']},
    record={kind:'resource',record:{id:'r',sourceVersion:3,version:20,quantity:100,observedAt:500}},
    first=draftMaterialKey('send',plan,[record]);
  assert.equal(draftMaterialKey('send',plan,[{...record,record:{...record.record,version:21,observedAt:600}}]),first);
  assert.notEqual(draftMaterialKey('send',plan,[{...record,record:{...record.record,sourceVersion:4,quantity:110}}]),first);
});
test('plant chain requires finite feedstock production and exact owner-reviewed useful produced-water receipt',()=>{
  const f=plantFixture(),r=physicalChainReadout(f);assert.equal(r.physicalChain.proved,true);assert.equal(r.physicalChain.usefulProducedWaterL,80);
  assert.equal(r.validForPhysicalClaim,true);
  assert.equal(r.GenAIAttribution,false);assert.equal(r.comparisonBenefit,null);
  for(const change of [x=>x.scorerOnlySource.operations[0].received=0,x=>x.scorerOnlySource.operations[0].resource='ordinary-depot-water',
    x=>x.scorerOnlySource.resources[0].produced=0,x=>x.scorerOnlySource.resources[1].consumed=null,
    x=>x.scorerOnlySource.facilities[0].openAt=null,x=>x.proposalFunnel.records[0].steps[0].owner='org1',
    x=>x.proposalFunnel.records[0].steps[0].correctlyLinked=false,x=>x.scorerOnlySource.operations[0].createdAt=null]) {
    const bad=structuredClone(f);change(bad);assert.equal(physicalChainReadout(bad).physicalChain.proved,false);
  }
});
test('an opened plant, ordinary stock or completed proposal alone cannot prove S03 useful service',()=>{
  const f=plantFixture();f.scorerOnlySource.operations=[];assert.equal(physicalChainReadout(f).physicalChain.proved,false);
  f.proposalFunnel.records[0].state='completed';assert.equal(physicalChainReadout(f).physicalChain.usefulProducedWaterL,0);
});
test('S05 requires hazard and current shelter need received before physical admission work, never payment/arrival',()=>{
  const f=evacuationFixture();assert.equal(physicalChainReadout(f).physicalChain.usefulAdmissionPlaces,20);
  for(const change of [x=>x.scorerOnlySource.operations[0].state='arrived',x=>x.scorerOnlySource.operations[0].received=0,
    x=>x.receivedHazardLeads[0].receivedAtSourceClock=60,x=>x.receivedHazardLeads[0].firstReadAtSourceClock=60,
    x=>x.receivedHazardLeads[0].location='other-building',x=>x.receivedNeedSnapshots=[],
    x=>x.receivedNeedSnapshots[0].firstReadAtSourceClock=60,x=>x.scorerOnlySource.operations[0].times.service=1001,
    x=>x.proposalFunnel.records[0].steps[0].usefulPhysicalService=false]) {
    const bad=structuredClone(f);change(bad);assert.equal(physicalChainReadout(bad).physicalChain.proved,false);
  }
});
test('all incomplete and native censored outcomes remain visible, and liters are never places/lives',()=>{
  const f=evacuationFixture();f.status='wall_limit';f.scorerOnlySource.operations[0].received=0;
  f.scorerOnlySource.needs.push({id:'silent',type:'water',unit:'L',quantity:100,served:0});
  const r=physicalChainReadout(f);assert.equal(r.status,'wall_limit');assert.equal(r.failedOrIncomplete.length,1);
  assert.equal(r.nativeNeeds.length,2);assert.equal(r.nativeNeeds[1].rightCensored,true);
  assert.equal(r.providerCalls,0);assert.equal(r.physicalChain.usefulAdmissionPlaces,0);
  assert.equal(r.validForPhysicalClaim,false);
});
test('duplicate source receipts and changed sources cannot silently validate a physical claim',()=>{
  const f=plantFixture();f.scorerOnlySource.operations.push({...f.scorerOnlySource.operations[0]});
  assert.equal(physicalChainReadout(f).physicalChain.proved,false);
  const changed=plantFixture();changed.finalBuilds.simulatorChanged=true;
  assert.equal(physicalChainReadout(changed).validForPhysicalClaim,false);
  const unknown=plantFixture();delete unknown.finalBuilds;
  assert.equal(physicalChainReadout(unknown).validForPhysicalClaim,false);
});
