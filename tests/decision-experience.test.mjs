import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionExperience, decisionCoverage, decisionReadiness } from '../ui/decision.mjs';
import { createEvidenceExperience, evidenceTitle } from '../ui/evidence.mjs';
import { setDisplayContext, registerDisplayRecords } from '../ui/labels.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const record = (kind, value) => ({ kind, record:value });
const need = {id:'need-water-main',building:'b41',type:'water',unit:'L',quantity:600,served:20,inTransit:30,references:['post-one']};
const stock = {id:'r-org0-water',type:'water',unit:'L',quantity:480,reserved:0,floor:100,owner:'org0'};
const records = new Map([
  [need.id, record('need', need)],
  [stock.id, record('resource', stock)],
  ['v-org0-0',record('vehicle',{id:'v-org0-0',owner:'org0',capacity:300,state:'available'})],
  ['v-org0-1',record('vehicle',{id:'v-org0-1',owner:'org0',capacity:300,state:'available'})],
]);
const proposal = () => ({id:'plan-one',version:1,state:'awaiting_review',title:'A 900 L promise',summary:'Send 900 L; this prose is deliberately wrong.',priority:'high',rationale:'Use available stock.',benefit:'Provide drinking water.',references:[need.id,stock.id,'v-org0-0','v-org0-1'],conditions:[],alternatives:[],actions:[
  {type:'dispatch',owner:'org0',params:{vehicle:'v-org0-0',resource:stock.id,quantity:300,need:need.id},dependsOn:[]},
  {type:'dispatch',owner:'org0',params:{vehicle:'v-org0-1',resource:stock.id,quantity:80,need:need.id},dependsOn:[0]},
]});
const helpers = () => ({
  api:async url => { const id = new URL(url,'http://local').searchParams.get('id'); if (!records.has(id)) throw new Error('Not accessible'); return structuredClone(records.get(id)); },
  escape,icon:name=>`<i data-icon="${name}"></i>`,badge:s=>`<span>${escape(s)}</span>`,
  action:(label,action,id)=>`<button data-action="${action}" data-id="${escape(id)}">${label}</button>`,
  time:t=>`Recorded ${t}`,state:{user:{org:'org0'}}
});
function names() {
  setDisplayContext({organization:{id:'org0',name:'Relief North'},geography:{places:[{id:'b41',use:'shelter',node:'n41'}]}});
  registerDisplayRecords('need',need);
  registerDisplayRecords('resource',stock);
}

test('coverage uses exact typed actions and subtracts aid already received or in transit',()=>{
  const p=proposal(), original=structuredClone(p), rows=decisionCoverage(p,records);
  assert.equal(rows[0].quantity,380);
  assert.equal(rows[0].outstanding,550);
  assert.equal(rows[0].residual,170);
  assert.deepEqual(p,original);
  const mismatched = new Map(records); mismatched.set(stock.id,record('resource',{...stock,unit:'kg'}));
  assert.deepEqual(decisionCoverage(p,mismatched),[],'incompatible units must not create a false coverage claim');
  const missing = new Map(records); missing.delete(stock.id);
  assert.deepEqual(decisionCoverage(p,missing),[],'unavailable stock cannot establish a native-unit coverage claim');
});

test('readiness reflects unavailable evidence and explicitly recorded checks without a confidence score',()=>{
  const p=proposal(); p.references.push('missing');
  p.conditions=[{id:'check-1',satisfied:false,description:'Current field confirmation required'}];
  p.checkedConstraints=[{type:'route',state:'checked',index:0},{type:'owner',state:'requires_partner_authorization',index:1}];
  const result=decisionReadiness(p,records);
  assert.equal(result.evidenceAvailable,4); assert.equal(result.evidenceTotal,5);
  assert.equal(result.pending.length,1); assert.equal(result.completedChecks.length,1);
  assert.equal(result.authorized,false); assert.equal('confidence' in result,false);
});

test('operator review makes human-friendly typed steps primary and preserves decision hooks',async()=>{
  names(); const p=proposal(), ui=createDecisionExperience(helpers());
  const html=await ui.renderProposal(p,{canReview:true});
  assert.match(html,/Sakura Shelter/);
  assert.match(html,/300 L · Drinking water/);
  assert.match(html,/80 L · Drinking water/);
  assert.match(html,/After step 1/);
  assert.match(html,/Why your approval matters/);
  assert.match(html,/commits 2 vehicles/);
  assert.match(html,/id="reviewnote"/);
  assert.doesNotMatch(html,/id="allowconditional"/);
  assert.doesNotMatch(html,/900 L/,'generated prose cannot replace the exact typed commitment');
  assert.ok(html.indexOf('What you are authorizing')<html.indexOf('Exact action record'));
  assert.match(html,/Exact action record · version 1/);
  p.conditions=[{id:'c',satisfied:false,description:'Confirm &lt;current&gt; source'}];
  assert.match(await ui.renderProposal(p,{canReview:true}),/id="allowconditional"/);
  assert.doesNotMatch(await ui.renderProposal(p,{canReview:false}),/id="reviewnote"|id="allowconditional"/);
});

test('executed response never subtracts its old planned load from a newly received remaining need',async()=>{
  names(); const p=proposal(); p.state='executing';
  const html=await createDecisionExperience(helpers()).renderProposal(p,{canReview:true});
  assert.doesNotMatch(html,/Still to find/);
  assert.doesNotMatch(html,/id="reviewnote"/);
});

test('evidence renders quantities, provenance and uncertainty with original text escaped and raw data secondary',async()=>{
  names();
  const h=helpers(), view=createEvidenceExperience(h), report={kind:'report',record:{id:'report-1',authorName:'Mika Sato',location:'b41',text:'Need water <script>unsafe</script>',quantity:600,unit:'L',observedAt:100,receivedAt:200,uncertainty:'Quantity is an estimate.',references:[stock.id]}};
  const html=await view.render(report);
  assert.equal(evidenceTitle(report),'Mika Sato · Sakura Shelter');
  assert.match(html,/Reported by/); assert.match(html,/Mika Sato/);
  assert.match(html,/600 L/); assert.match(html,/Quantity is an estimate/);
  assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>unsafe/);
  assert.ok(html.indexOf('Reported by')<html.indexOf('Original identifiers & technical record'));
});
