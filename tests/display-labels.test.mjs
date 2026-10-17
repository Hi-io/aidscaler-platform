import test from 'node:test';
import assert from 'node:assert/strict';
import { setDisplayContext, entityLabel, registerDisplayRecords, readableText, resourceLabel, labelHints, vehicleReferenceLabel } from '../ui/labels.mjs';

test('laboratory aliases remain unique, deterministic and presentation-only', () => {
  const geography = {places:[{id:'b41',node:'n41',use:'shelter'},{id:'b53',node:'n53',use:'shelter'}]};
  const original = structuredClone(geography);
  setDisplayContext({organization:{id:'org0',name:'Relief North'},geography});
  assert.equal(entityLabel('org0'),'Relief North');
  assert.equal(entityLabel('b41'),'Sakura Shelter');
  assert.equal(entityLabel('b53'),'Sakura Shelter 2');
  assert.equal(entityLabel('v-org0-1'),'Relief North · Vehicle 2');
  const need = {id:'need-water-main',building:'b41',type:'water',quantity:600};
  registerDisplayRecords('need',need);
  assert.equal(readableText('Response for need-water-main'), 'Response for Water at Sakura Shelter');
  assert.equal(need.id,'need-water-main');
  assert.equal(need.quantity,600);
  assert.deepEqual(geography,original);
  assert.match(labelHints(),/display aliases/);
  setDisplayContext({organization:{id:'org0',name:'Relief North'},geography:{places:[...geography.places].reverse()}});
  assert.equal(entityLabel('b41'),'Sakura Shelter');
  assert.equal(entityLabel('b53'),'Sakura Shelter 2');
});

test('real names take precedence and unknown identifiers are not invented', () => {
  setDisplayContext({organization:{id:'real-team',name:'Response Team'},geography:{places:[{id:'b41',node:'n41',name:'Community Hall',use:'shelter'}]}});
  assert.equal(entityLabel('b41'),'Community Hall');
  assert.equal(entityLabel('b99'),'b99');
  assert.equal(entityLabel('org0'),'org0');
  assert.equal(labelHints(),'');
  assert.equal(resourceLabel({id:'r-1',type:'water',label:'Potable water · Lot A'}),'Potable water · Lot A');
  registerDisplayRecords('vehicle',{id:'vehicle-1',name:'Van A'});
  assert.equal(entityLabel('vehicle-1'),'Van A');
});

test('an older laboratory directory uses its declared junction name rather than conflicting with source reports', () => {
  setDisplayContext({organization:{id:'org0',name:'Relief North'},geography:{places:[{id:'b41',node:'n41',use:'shelter'}],nodes:[{id:'n41',name:'South Hill Shelter Junction'}]}});
  assert.equal(entityLabel('b41'),'South Hill Shelter');
  assert.equal(entityLabel('n41'),'South Hill Shelter Junction');
});

test('unshared partner vehicles use an ordinal reference without inventing a plate or owner name', () => {
  setDisplayContext({ organization: { id: 'demo-org-3', name: 'Sakura Aid' } });
  assert.equal(vehicleReferenceLabel('v-org3-0', 'org3'), 'Partner vehicle 1');
  assert.equal(vehicleReferenceLabel('unknown-car', 'org3'), null);
  setDisplayContext({ organization: { id: 'org0', name: 'Relief North' } });
  assert.equal(vehicleReferenceLabel('v-org3-0', 'org3'), 'Medical West · Vehicle 1');
  assert.doesNotMatch(vehicleReferenceLabel('v-org3-0', 'org3'), /TK-|registration/);
});
