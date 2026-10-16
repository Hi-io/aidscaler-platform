import test from "node:test";
import assert from "node:assert/strict";
import { agentMonitor } from "../ui/autonomy.mjs";
import { createPresentation } from "../ui/presentation.mjs";
const e=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;");
const h={escape:e, icon:n=>`<svg data-name="${n}"></svg>`, number:n=>String(n??0),time:String,
  action:(label,act,id)=>`<button data-action="${act}" data-id="${id}">${label}</button>`,
  badge:e,empty:e,state:{user:{org:"org0"}},table:()=>""};
test("agent status describes real waiting, active, disabled and budget-limited states",()=>{
  const render=(state,active,queued,enabled=true)=>agentMonitor({policy:{enabled},runtime:{state,active,queued}},{...h,model:"google/gemma-4-31b-it"});
  assert.match(render("queued",0,2),/2 investigations queued/);
  assert.match(render("processing",1,3),/1 active workflow/);
  assert.match(render("processing",1,3),/3 queued/);
  assert.match(render("paused",0,0,false),/Automatic investigation is paused/);
  assert.match(render("budget_limit",0,0),/Model budget reached/);
  assert.doesNotMatch(render("monitoring",0,0),/investigations running/);
});
test("overview connects a proposed response to its need without duplicating the proposal",()=>{
  const view=createPresentation(h);
  const html=view.overview({data:{source:[]},queue:[{id:"plan",title:"Deliver water",state:"awaiting_review",conditions:[],actions:[{params:{need:"need1"}}]}],
    unresolved:[{id:"need1",type:"water",building:"Shelter",quantity:600,served:0,unit:"L"}],activity:"",coverage:"",sourceStatus:"connected"});
  assert.equal(html.match(/Deliver water/g).length,1);
  assert.match(html,/600 L/); assert.match(html,/Proposed response/);
  assert.doesNotMatch(html,/Other decisions to review/);
});
