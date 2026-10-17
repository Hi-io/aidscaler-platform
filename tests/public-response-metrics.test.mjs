import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePublicResponseProgress, publicResponseMetrics } from '../src/public-response-metrics.mjs';
import { approximateCoordinates } from '../ui/portal.mjs';

const published = operationIds => [{ state: 'published', operationIds }];
const op = (id, overrides={}) => ({ id, org:'org0', type:'delivery', resource:'water-stock', quantity:100, received:0, state:'en_route', times:{departed:20}, confirmedBySource:true, ...overrides });
const resources = [{ id:'water-stock', type:'water', unit:'L' }, { id:'food-stock', type:'food', unit:'kg' }];

test('public aid totals require a reviewed operation link, source confirmation and physical receipt/departure', () => {
  const operations = [op('moving'), op('received',{ received:70, state:'completed', times:{received:40} }),
    op('not-public'),op('not-confirmed',{confirmedBySource:false}), op('not-departed',{times:{requested:1}}),
    op('not-received',{received:80,state:'completed',times:{}}), op('blocked',{state:'blocked'}),
    op('inspection',{type:'assessment',received:100,times:{received:40}})];
  const result = aggregatePublicResponseProgress(published(operations.filter(o=>o.id!=='not-public').map(o=>o.id)), operations, resources);
  assert.equal(result.receivedDeliveries,1); assert.equal(result.enRouteDeliveries,1);
  assert.deepEqual(result.materials,[{type:'water',label:'Drinking water',unit:'L',received:70,enRoute:100}]);
  assert.doesNotMatch(JSON.stringify(result),/stock|org0|not-public|moving|inspection/);
});

test('corrections, retractions, repeated references and peer mirrors do not inflate published progress', () => {
  const operations=[op('physical'), {...op('mirror'),sourceSnapshot:op('physical')},op('withdrawn')];
  const publications=[...published(['physical','mirror','physical']),{state:'retracted',operationIds:['withdrawn']},{state:'superseded',operationIds:['withdrawn']}];
  const result=aggregatePublicResponseProgress(publications,operations,resources);
  assert.equal(result.enRouteDeliveries,1);assert.equal(result.materials[0].enRoute,100);
});

test('native units and supply kinds remain separate; partial receipts leave only actual unreceived cargo in transit', () => {
  const operations=[op('partial',{received:30,times:{departed:10,service:20},state:'unloading'}),
    op('food',{resource:'food-stock',quantity:25}),op('water-kg',{resourceType:'water',unit:'kg',quantity:15}),
    op('unknown',{resourceType:'SECRET_RESOURCE_NAME',unit:'secret_unit',quantity:80}),
    op('unsafe-unit',{resourceType:'water',unit:'Private Shelter Name',quantity:80}),
    op('over-receipt',{quantity:20,received:99,state:'completed',times:{received:90}})];
  const result=aggregatePublicResponseProgress(published(operations.map(o=>o.id)),operations,resources);
  assert.equal(result.receivedDeliveries,2); assert.equal(result.enRouteDeliveries,5);
  assert.equal(result.materials.find(m=>m.type==='water'&&m.unit==='L').received,50);
  assert.equal(result.materials.find(m=>m.type==='water'&&m.unit==='L').enRoute,70);
  assert.equal(result.materials.find(m=>m.type==='water'&&m.unit==='kg').enRoute,15);
  assert.equal(result.materials.find(m=>m.type==='food').enRoute,25);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|secret_unit|Private Shelter Name/);
});

test('public metrics lookup only publication-linked records within the requested organization', async () => {
  const calls=[];
  const store={get:async(org,kind,id,required)=>{calls.push([org,kind,id,required]);return kind==='operation'?op(id):resources[0];}};
  const result=await publicResponseMetrics(store,'org0',[...published(['published-one','published-one']),{state:'draft',operationIds:['private-one']}]);
  assert.equal(result.enRouteDeliveries,1);
  assert.deepEqual(calls,[['org0','operation','published-one',false],['org0','resource','water-stock',false]]);
});

test('community location uses one approximate coordinate value and rejects invalid device coordinates', () => {
  assert.equal(approximateCoordinates({latitude:35.613759,longitude:139.618275}),'Approximate coordinates: 35.614, 139.618');
  for (const invalid of [undefined,{}, {latitude:NaN,longitude:10},{latitude:91,longitude:10},{latitude:10,longitude:181},{latitude:'35',longitude:139}]) assert.equal(approximateCoordinates(invalid),null);
});


test('the actual source dispatched lifecycle counts loaded cargo, never an empty pickup or a departure without a physical timestamp', () => {
  const operations = [
    op('delivery', { state:'dispatched', times:{dispatched:200} }),
    op('pickup', { state:'dispatched', phase:'pickup', times:{pickupDispatched:100,dispatched:200} }),
    op('no-departure', { state:'dispatched', times:{authorized:100} }),
    op('invalid-departure', { state:'dispatched', times:{dispatched:-1} }),
    op('unloading', { state:'waiting_to_unload', times:{dispatched:200,arrived:300} }),
  ];
  const result = aggregatePublicResponseProgress(published(operations.map(o=>o.id)),operations,resources);
  assert.equal(result.enRouteDeliveries,2);
  assert.deepEqual(result.materials,[{type:'water',label:'Drinking water',unit:'L',received:0,enRoute:200}]);
});
