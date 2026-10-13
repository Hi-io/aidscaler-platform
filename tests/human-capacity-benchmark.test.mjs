import test from 'node:test';
import assert from 'node:assert/strict';
import { completedHumanReceipt, sourceFromHumanResult, manualSourceOwner, materialDemandKey, planningMaterialSignature, receivedHumanWakeAt, receivedManualPeerOperation, nativeHumanWorkParams, actionableManualLead, relevantManualHandoffs, finalizeEpisodeIntegrity,
  reconcileUsage, nativeServiceSummary, summarizeHumanCapacity } from '../evaluation/human-capacity-benchmark.mjs';
import { campaignPlan, validateHumanCampaignGate } from '../scripts/human-capacity-campaign.mjs';
import { validateParameters } from '../../disaster-response-simulator/contracts/parameters.mjs';

const ref={kind:'post',id:'public-current',version:2};
const receipt={id:'human-read-1',org:'org1',stage:'read',state:'completed',createdAt:1000,startedAt:2000,completedAt:32000,
  result:{source:ref,snapshot:{id:'public-current',version:2,text:'We still need drinking water at public-building.'},sourceObservedAt:0}};

test('native read and decide omit transport-only fields while relay retains real network parameters',()=>{
  for(const stage of ['read','decide']){
    const p=nativeHumanWorkParams(stage,ref,[],'org0',1800000);
    assert.equal('ttlMs' in p,false);assert.equal('recipient' in p,false);assert.equal('channel' in p,false);
    assert.doesNotThrow(()=>validateParameters('human_work',p));
    assert.throws(()=>validateParameters('human_work',{...p,ttlMs:1800000}),e=>e.code==='HUMAN_SCHEMA');
  }
  assert.doesNotThrow(()=>validateParameters('human_work',nativeHumanWorkParams('relay',{kind:'work',id:'human-read-1'},['human-read-1'],'org0',1800000)));
});

test('completed reading triages irrelevant noise without manufacturing decision work or discarding ambiguous actionable needs',()=>{
  assert.equal(actionableManualLead([]),false);
  assert.equal(actionableManualLead([{kind:'need',location:'site',timeStatus:'historical'}]),false);
  assert.equal(actionableManualLead([{kind:'need',quantity:30,location:null}]),false);
  assert.equal(actionableManualLead([{kind:'need',location:'site',timeStatus:'uncertain',quantity:null}]),true);
});

test('manual handoff waits only for capacity owners actually selected by the competent received allocator',()=>{
  const actions=[{owner:'org0',params:{need:'n1'}},{owner:'org2',params:{need:'n1'}},{owner:'org2',params:{need:'n1'}},{owner:'org3',params:{need:'n2'}}];
  assert.deepEqual(relevantManualHandoffs(actions,'org0','n1'),['org2']);
  assert.deepEqual(relevantManualHandoffs(actions,'org0','n2'),['org3']);
  assert.deepEqual(relevantManualHandoffs(actions,'org0','owned-only'),[]);
});

test('final build integrity cannot erase runtime failures, recovered errors or censored wall limits',()=>{
  const error={phase:'episode',code:'HUMAN_SCHEMA'};
  assert.deepEqual(finalizeEpisodeIntegrity({status:'failed',errors:[error]},{errors:[],invalidStatus:null}).errors,[error]);
  assert.equal(finalizeEpisodeIntegrity({status:'wall_limit',errors:[{code:'WALL_LIMIT'}]},{errors:[],invalidStatus:null}).status,'wall_limit');
  const buildError={code:'SIMULATOR_CHANGED_DURING_RUN'};
  const r=finalizeEpisodeIntegrity({status:'failed',errors:[error]},{errors:[buildError],invalidStatus:'invalid_simulator_changed'});
  assert.equal(r.status,'invalid_simulator_changed');assert.deepEqual(r.errors,[error,buildError]);
});

test('manual interpretation cannot consume queued, unconfirmed, other-owner or stale-version human evidence',()=>{
  const expect={org:'org1',stage:'read',reference:ref};
  assert.equal(completedHumanReceipt({...receipt,state:'working'},expect),null);
  assert.equal(completedHumanReceipt({...receipt,org:'org2'},expect),null);
  assert.equal(completedHumanReceipt({...receipt,completedAt:1500},expect),null);
  assert.equal(completedHumanReceipt({...receipt,startedAt:null},expect),null);
  assert.equal(completedHumanReceipt(receipt,{...expect,reference:{...ref,version:3}}),null);
  assert.deepEqual(completedHumanReceipt(receipt,expect),receipt.result);
  const source=sourceFromHumanResult(receipt.result,{id:ref.id,sourceVersion:2});
  assert.equal(source.text,receipt.result.snapshot.text);
  assert.equal(sourceFromHumanResult(receipt.result,{id:ref.id,sourceVersion:3}),null);
  assert.equal(sourceFromHumanResult({source:{...ref,kind:'need'},snapshot:receipt.result.snapshot},{id:ref.id,sourceVersion:2}),null);
  assert.equal(sourceFromHumanResult({source:ref,snapshot:{id:'another-source'}},{id:ref.id,sourceVersion:2}),null);
});

test('distributed manual routing depends only on stable public ID and keeps every owner usable',()=>{
  const owners=new Set(Array.from({length:100},(_,i)=>manualSourceOwner('public-'+i,4)));
  assert.deepEqual([...owners].sort(),[0,1,2,3]);
  assert.equal(manualSourceOwner('independent-source',4),manualSourceOwner('independent-source',4));
  assert.throws(()=>manualSourceOwner('id',0));
});

test('manual demand reintegration follows substantive demand changes, not polling or served telemetry',()=>{
  const n={id:'need-public',building:'site',type:'water',unit:'L',quantity:100,priority:3,deadline:200000,state:'active',served:0};
  assert.equal(materialDemandKey(n),materialDemandKey({...n,at:9000,version:12,served:60,reserved:40}));
  assert.notEqual(materialDemandKey(n),materialDemandKey({...n,quantity:160}));
  assert.notEqual(materialDemandKey(n),materialDemandKey({...n,state:'erased'}));
  assert.notEqual(materialDemandKey(n),materialDemandKey({...n,building:'other-site'}));
});

test('common planner coalescing ignores poll timestamps but resumes when received material or integrated scope changes',()=>{
  const s={signature:'same-received-material',receivedAt:1000};
  assert.equal(planningMaterialSignature(s,['n2','n1']),planningMaterialSignature({...s,receivedAt:9000},['n1','n2']));
  assert.notEqual(planningMaterialSignature(s,['n1']),planningMaterialSignature(s,['n1','n2']));
  assert.notEqual(planningMaterialSignature(s,undefined),planningMaterialSignature(s,[]));
  assert.notEqual(planningMaterialSignature(s,['n1']),planningMaterialSignature({signature:'actual-receipt-changed'},['n1']));
});

test('all arms may wake at received native work clocks without injecting a full poll delay or reading hidden events',()=>{
  assert.equal(receivedHumanWakeAt(1000,100000,15000,[1000]),1001);
  assert.equal(receivedHumanWakeAt(1000,100000,15000,[3500,12000]),3500);
  assert.equal(receivedHumanWakeAt(1000,100000,15000,[null,undefined,900,Infinity]),16000);
  assert.equal(receivedHumanWakeAt(99000,100000,15000,[130000]),100000);
});

test('unknown fees retain reservation and unknown cost; genuine zero-call reference can be zero',()=>{
  assert.deepEqual(reconcileUsage([], .15),{modelCalls:0,costUsd:0,knownCostUsd:0,unknownCostRows:0,chargedBudgetUsd:0,usageMissing:false});
  const mixed=reconcileUsage([{cost_usd:.005},{cost_usd:null,reserved_usd:.02,state:'failed'}],.15);
  assert.equal(mixed.costUsd,null);assert.equal(mixed.knownCostUsd,.005);assert.equal(mixed.unknownCostRows,1);
  assert.equal(mixed.chargedBudgetUsd,.025);
  assert.equal(reconcileUsage(null,.15).chargedBudgetUsd,.15);
  assert.equal(reconcileUsage(null,.15).modelCalls,null);
});

test('first useful service and sufficient service retain distinct censored physical denominators',()=>{
  const outcomes=[{timeToFirstUsefulServiceMs:10,firstUsefulCensored:false,timeToSufficientServiceMs:60,censored:false},
    {timeToFirstUsefulServiceMs:30,firstUsefulCensored:false,timeToSufficientServiceMs:100,censored:true}];
  assert.deepEqual(nativeServiceSummary(outcomes),{eligible:2,reached:1,rightCensored:1,restrictedMeanMs:80});
  assert.deepEqual(nativeServiceSummary(outcomes,'firstUseful'),{eligible:2,reached:2,rightCensored:0,restrictedMeanMs:20});
  assert.equal(nativeServiceSummary([{timeToSufficientServiceMs:null,censored:true}]).restrictedMeanMs,null);
});

const row=(arm,condition='moderate',mean=50)=>({arm,profile:'moderate',condition,seed:'fixed-seed',status:'completed',errors:[],invariants:[],
  candidateChanged:false,evaluatorChanged:false,simulatorChanged:false,candidateFingerprint:'c'.repeat(64),evaluatorFingerprint:'e'.repeat(64),
  finalCandidateFingerprint:'c'.repeat(64),finalEvaluatorFingerprint:'e'.repeat(64),finalEngineBuild:'a'.repeat(64),
  manifest:{engineBuild:'a'.repeat(64)},protocol:{count:24,condition},corpus:{manifest:'same-input',rawPublicInputHash:'d'.repeat(64),rawPublicInputCount:24},
  timeToSufficientService:{restrictedMeanMs:mean},timeToFirstUsefulService:{restrictedMeanMs:10},
  costUsd:0,knownCostUsd:0,chargedBudgetUsd:0,unknownCostRows:0});

test('summary preserves NEXO loss and recovered errors, rejects altered/unfinished pairs and separates error controls',()=>{
  const rows=[row('B5','moderate',40),row('B6','moderate',60),row('B5','moderate_error_1pct',100),row('B6','moderate_error_1pct',80)];
  const report=summarizeHumanCapacity(rows,[{arm:'B8',condition:'moderate',seed:'fixed-seed'}]);
  const loss=report.comparisons.find(r=>r.reference==='B5'&&r.condition==='moderate');
  assert.equal(loss.comparable,true);assert.equal(loss.physicalTimeGainFraction,-.5);
  const sensitivity=report.comparisons.find(r=>r.reference==='B5'&&r.condition==='moderate_error_1pct');
  assert.equal(sensitivity.physicalTimeGainFraction,.2);
  assert.equal(report.missingRuns.length,1);
  const recovered=summarizeHumanCapacity([rows[0],{...rows[1],errors:[{code:'PROVIDER_FAILURE',fallback:'formal_received_data'}]}]).comparisons.find(r=>r.reference==='B5');
  assert.equal(recovered.comparable,true);assert.equal(recovered.candidateErrorCount,1);assert.equal(recovered.physicalTimeGainFraction,-.5);
  for(const bad of [{...rows[0],candidateFingerprint:'other'},
    {...rows[0],corpus:{manifest:'different-input'}},{...rows[0],status:'aborted'},
    {...rows[0],corpus:{...rows[0].corpus,rawPublicInputHash:null}},
    {...rows[0],finalEngineBuild:null},{...rows[0],simulatorChanged:undefined}]){
    const p=summarizeHumanCapacity([bad,rows[1]]).comparisons.find(r=>r.reference==='B5');
    assert.equal(p.comparable,false);assert.equal(p.physicalTimeGainFraction,null);
  }
});

test('campaign predeclares common zero-error controls and 1% error sensitivity for every arm',()=>{
  const primary=campaignPlan();assert.equal(primary.worlds.length,12);assert.deepEqual(primary.arms,['C_manual','B5','B8','B6']);
  assert.deepEqual(primary.profiles,['moderate']);assert.equal(new Set(primary.worlds.map(w=>w.seed)).size,3);
  assert.ok(primary.worlds.every(w=>w.seed.startsWith('native-human-capacity-primary-')&&!w.seed.includes('smoke')));
  const p=campaignPlan({family:'sensitivity'});assert.equal(p.worlds.length,40);assert.equal(p.orchestratorWorkers,1);
  for(const c of ['zero','moderate','burst'])for(const w of p.worlds.filter(w=>w.condition===c)){
    assert.equal(w.humanCapacityOverrides.decisionErrorBp,0);assert.equal(w.humanCapacityOverrides.relayErrorBp,0);
  }
  const sensitivity=p.worlds.filter(w=>w.condition==='moderate_error_1pct');assert.equal(sensitivity.length,5);
  for(const w of sensitivity){assert.equal(w.profile,'moderate');assert.equal(w.humanCapacityOverrides.decisionErrorBp,100);}
  for(const w of p.worlds.filter(w=>w.condition==='fast_read_5s'))assert.equal(w.humanCapacityOverrides.readMs,5000);
  for(const w of p.worlds.filter(w=>w.condition==='readers8'))assert.equal(w.humanCapacityOverrides.readers,8);
  for(const w of p.worlds.filter(w=>w.condition==='moderate_96')){assert.equal(w.count,96);assert.equal(w.noise,768);assert.equal(w.maxModelCalls,32);}
  assert.throws(()=>campaignPlan({arms:'B6,B6'}));assert.throws(()=>campaignPlan({profiles:'retune_after_win'}));
});

test('only exact actually delivered own-source peer status may affect common outstanding demand',()=>{
  const inbox={id:'relay-status',from:'org1',to:'org0',source:{kind:'operation',id:'op-own',version:4},
    sourceObservedAt:1000,receivedAt:91000,snapshot:{id:'op-own',org:'org1',version:4,type:'delivery',state:'moving',quantity:80,received:0,need:'need-current',times:{}}};
  const op=receivedManualPeerOperation(inbox,'org0');
  assert.equal(op.sourceId,'op-own');assert.equal(op.owner,'org1');assert.equal(op.confirmedBySource,true);assert.equal(op.received,0);
  for(const invalid of [{...inbox,to:'org2'},{...inbox,source:{...inbox.source,version:3}},
    {...inbox,snapshot:{...inbox.snapshot,org:'org2'}},{...inbox,sourceObservedAt:92000},
    {...inbox,source:{...inbox.source,kind:'proposal'}}])assert.equal(receivedManualPeerOperation(invalid,'org0'),null);
  const positive=receivedManualPeerOperation({...inbox,snapshot:{...inbox.snapshot,state:'completed',received:80,times:{service:80000}}},'org0');
  assert.equal(positive.received,80);assert.equal(positive.times.service,80000);
});

test('new campaign cannot launch from an old or partially passing source/UI seal',()=>{
  const current={candidate:'c',baseEvaluator:'b',simulator:'s'},proof={candidateFingerprint:'c',evaluatorFingerprint:'b',simulatorFingerprint:'s'};
  const tests={tests:1,pass:1,fail:0,cancelled:0};
  const f={...proof,verification:{...proof,passed:true,candidateChanged:false,evaluatorChanged:false,simulatorChanged:false,
    candidateFinalFingerprint:'c',evaluatorFinalFingerprint:'b',simulatorFinalFingerprint:'s',cases:[
      {name:'platform-tests',exitCode:0,signal:null,tests},{name:'simulator-tests',exitCode:0,signal:null,tests}]},
    ui:{...proof,passed:true,unchanged:true,finalFingerprints:proof,cases:[{exitCode:0,signal:null}]}};
  assert.equal(validateHumanCampaignGate(f,current),true);
  assert.throws(()=>validateHumanCampaignGate({...f,ui:{...f.ui,passed:false}},current));
  assert.throws(()=>validateHumanCampaignGate({...f,verification:{...f.verification,candidateFinalFingerprint:'old'}},current));
  assert.throws(()=>validateHumanCampaignGate({...f,evaluatorFingerprint:'old'},current));
});
