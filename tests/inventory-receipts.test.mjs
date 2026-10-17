import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { InventoryReceipts } from '../src/inventory-receipts.mjs';
import { demoResupply } from '../src/demo-gateway.mjs';
import { incomingResources, incomingReceiptInput, incomingReceiptForm, incomingReceiptHistory } from '../ui/inventory-receipts.mjs';

const actor = {org:'org0',id:'warehouse-operator',role:'commander'};
const input = {resource:'source-water',quantity:100,receiptReference:'DELIVERY-1042',note:'Received at the depot',confirmedReceived:true};
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

test('warehouse receipts recover lost source acknowledgements without inventing stock or duplicating a delivery', async t => {
  const store = await Store.open(); t.after(() => store.close()); await store.organization('org0');
  await store.put('org0','resource','source-water',{owner:'org0',type:'water',quantity:500,reserved:150,unit:'L',sourceVersion:1},0);
  await store.put('org0','resource','partner-water',{owner:'org1',type:'water',quantity:500,sourceVersion:1},0);
  await store.put('org0','resource','local-water',{owner:'org0',type:'water',quantity:500},0);
  const physical = {quantity:500,reserved:150,produced:0}, receipts = new Map(); let calls=0, loseAck=true, refreshed=0;
  const connector = {
    async request(route, options) {
      calls++; assert.equal(route,'/api/actor/inventory/receipt'); assert.equal(options.human,true); assert.equal(options.method,'POST');
      const d=options.body;
      if (!receipts.has(d.idempotencyKey)) {
        physical.quantity+=d.quantity; physical.produced+=d.quantity;
        receipts.set(d.idempotencyKey,{receipt:{id:'warehouse-receipt-1',org:actor.org,resource:d.resource,quantity:d.quantity,unit:'L',at:60000,reference:d.receiptReference,manual:true}});
      }
      if(loseAck){loseAck=false;throw Object.assign(Error('Reply lost after physical receipt.'),{status:504});}
      return receipts.get(d.idempotencyKey);
    },
    async action(type,data) {assert.equal(type,'query');assert.equal(data.target,'inventory');refreshed++;}
  };
  const service = new InventoryReceipts(store,connector);
  for(const role of ['agent','analyst','field','admin']) await assert.rejects(service.record({...actor,role},input),{status:403});
  await assert.rejects(service.record(actor,{...input,resource:'partner-water'}),{status:403});
  await assert.rejects(service.record(actor,{...input,resource:'local-water'}),{code:'SOURCE_INVENTORY'});
  assert.equal(calls,0);
  await assert.rejects(service.record(actor,input),{status:504});
  assert.deepEqual(physical,{quantity:600,reserved:150,produced:100});
  const pending=(await store.list('org0','inventory_receipt'))[0]; assert.equal(pending.state,'awaiting_source'); assert.equal(pending.physicalConfirmation,false);
  assert.equal((await store.get('org0','resource','source-water')).quantity,500,'an unacknowledged observation cannot add stock');
  const recovered=await new InventoryReceipts(store,connector).record(actor,{...input,receiptReference:'  delivery-1042  '});
  assert.equal(recovered.state,'confirmed');assert.equal(recovered.physicalConfirmation,true);assert.equal(refreshed,1);
  assert.deepEqual(physical,{quantity:600,reserved:150,produced:100});
  assert.equal((await store.get('org0','resource','source-water')).quantity,500,'only a later source observation updates the inventory projection');
  assert.equal((await service.record(actor,input)).id,recovered.id); assert.equal(calls,2,'confirmed replay does not contact the warehouse again');
  await assert.rejects(service.record(actor,{...input,quantity:200}),{code:'IDEMPOTENCY_CONFLICT',status:409});
  assert.equal((await store.list('org0','inventory_receipt')).length,1);assert.deepEqual(physical,{quantity:600,reserved:150,produced:100});
  const history=await store.query("SELECT action FROM audit WHERE org='org0' ORDER BY sequence");
  assert.deepEqual(history.rows.map(r=>r.action),['inventory.receipt_requested','inventory.receipt_confirmed']);
  const bad = new InventoryReceipts(store,{request:async()=>({receipt:{...recovered.receipt,org:'org1'}})});
  await assert.rejects(bad.record(actor,{...input,receiptReference:'DELIVERY-OTHER'}),{code:'INVENTORY_RECEIPT_ACK',status:502});
  assert.equal((await store.list('org0','inventory_receipt')).find(r=>r.receiptReference==='DELIVERY-OTHER').physicalConfirmation,false);
});

test('incoming delivery forms use existing owned inventory and keep warehouse arrivals separate from community deliveries', () => {
  const own={id:'r-org0-water',owner:'org0',label:'Harbor drinking water',type:'water',unit:'L',sourceVersion:2,quantity:0};
  const delivered={...own,id:'lot-org0-shelter-water',node:'shelter-node',quantity:100};
  const rows=incomingResources([own,delivered,{...own,id:'partner',owner:'org1'},{...own,id:'local',sourceVersion:undefined},{...own,id:'staff',type:'staff'}],'org0',true);
  assert.deepEqual(rows,[own]);
  assert.deepEqual(incomingResources([own,delivered],'org0',false),[own,delivered],'the demo canonical-depot restriction does not affect normal connected inventory');
  const data={resource:own.id,quantity:'120',receiptReference:' TRUCK-42 ',note:' Received ',confirmedReceived:'on'};
  assert.deepEqual(incomingReceiptInput(data,rows,{demo:true}),{resource:own.id,quantity:120,receiptReference:'TRUCK-42',note:'Received',confirmedReceived:true});
  for(const patch of [{resource:'partner'},{quantity:''},{quantity:'601'},{quantity:'1.5'},{confirmedReceived:''},{receiptReference:'x<script>'}])
    assert.throws(()=>incomingReceiptInput({...data,...patch},rows,{demo:true}));
  const html=incomingReceiptForm(rows,{escape,demo:true});
  assert.match(html,/Harbor drinking water/);assert.match(html,/physically|received at our warehouse/);assert.match(html,/30 simulated minutes/);
  assert.doesNotMatch(html,/name="node"|name="owner"|name="newResource"/);
  const history=incomingReceiptHistory([{...input,state:'confirmed',receipt:{unit:'L',at:100},requestedAt:100}],{escape,time:n=>'Time '+n,badge:s=>s});
  assert.match(history,/Incoming warehouse supplies/);assert.match(history,/Deliveries to communities appear in Operations/);assert.match(history,/Warehouse confirmed/);
});

test('demo resupply validation rejects resource and cadence expansion', () => {
  assert.deepEqual(demoResupply(),{enabled:true,intervalMs:1800000,water:300,food:60});
  const valid={enabled:false,intervalMs:300000,water:600,food:120};assert.deepEqual(demoResupply(valid),valid);
  for(const patch of [{enabled:'true'},{intervalMs:299999},{intervalMs:21600001},{water:601},{food:121},{water:-1},{extra:true}])
    assert.throws(()=>demoResupply({...valid,...patch}));
});
