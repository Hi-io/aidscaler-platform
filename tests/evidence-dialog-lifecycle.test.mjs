import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtras } from '../ui/extras.mjs';

const media = { id:'field-photo', title:'Shelter supply photo', source:'Field team', mime:'image/png', state:'unverified', contentHash:'a'.repeat(64) };
function fixture(record) {
  const events=[];
  const controls=createExtras({ record, escape:value=>String(value??''), badge:value=>String(value),
    action:label=>label, state:{user:{role:'analyst'}}, modal:()=>events.push('modal') });
  return {controls,events};
}
test('closing or replacing the originating dialog while media metadata waits cannot open another dialog or attach a return button',async()=>{
  const gate=Promise.withResolvers(),started=Promise.withResolvers(); let current=true;
  const {controls,events}=fixture(async kind=>{
    if(kind==='media'){started.resolve();await gate.promise;return media;}
    return null;
  });
  const opening=controls.run('media-open',media.id,{isCurrent:()=>current,afterOpen:()=>events.push('return')});
  await started.promise;current=false;gate.resolve();
  assert.equal(await opening,true,'the requested action is consumed even when its view was dismissed');
  assert.deepEqual(events,[]);
});
test('dismissing the origin during a delayed interpretation read also cancels media presentation',async()=>{
  const gate=Promise.withResolvers(),started=Promise.withResolvers();let current=true;
  const {controls,events}=fixture(async kind=>{
    if(kind==='media')return media;
    started.resolve();await gate.promise;return null;
  });
  const opening=controls.run('media-open',media.id,{isCurrent:()=>current,afterOpen:()=>events.push('return')});
  await started.promise;current=false;gate.resolve();await opening;
  assert.deepEqual(events,[]);
});
test('an active evidence load creates its return control synchronously with its own modal',async()=>{
  const {controls,events}=fixture(async kind=>kind==='media'?media:null);
  await controls.run('media-open',media.id,{isCurrent:()=>true,afterOpen:()=>events.push('return')});
  assert.deepEqual(events,['modal','return']);
  events.length=0;
  await controls.run('media-open',media.id);
  assert.deepEqual(events,['modal'],'ordinary media inspection keeps its existing optional-options contract');
});
