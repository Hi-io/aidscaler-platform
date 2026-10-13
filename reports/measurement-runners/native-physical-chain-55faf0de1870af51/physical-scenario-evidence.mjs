import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateProbeGate, exactPhysicalClock, archiveProbe, sha256, finite, exists, acquireProbeLock } from './evidence-probe-guards.mjs';

// No core imports or world construction until explicit --run authorization.
export const PHYSICAL_PLAN = {
  schema: 'source-s03-s05-physical-chain-v1', state: 'prepared_not_launched',
  seed: 'local-native-physical-chain-2026-01', scenarios: ['S03', 'S05'], variants: ['standard', 'adverse', 'infeasible'],
  worlds: ['S03', 'S05'].flatMap(scenario => ['standard', 'adverse', 'infeasible'].map(variant => ({ scenario, variant,
    compositionVariant: variant === 'infeasible' ? 'insufficient_staff' : 'standard',
    declaredLabel: variant === 'standard' ? 'nominal_attempt_not_presumed_favorable' : variant + '_attempt' }))),
  common: { organizations: 1, nativeOrganizations: 4, grid: 9, extentKm: 2, topology: 'grid',
    horizonMs: 10800000, cadenceMs: 60000, wallLimitMs: 900000, packetLoss: 0,
    observationRate: 1, networkLatencyMs: 1000, queryLatencyMs: 1000, reviewMs: 30000,
    inspectionMs: 60000, loadMs: 60000, unloadMs: 60000, setupMs: 60000, clarificationWorkers: 2,
    maxDraftsPerWorld: 40, maxHazardInquiryLocations: 20, producedWaterBatchMinL: 100 },
  providerPaidCapUsd: 0, modelCallsAllowed: 0, stopFile: '.local/STOP_PHYSICAL_CHAIN_CURRENT',
  lockFile: '.local/PAID_RESEARCH_STUDY.lock', gate: 'ROOT_GO_PHYSICAL_CHAIN + unchanged three hashes/full-suite/UI seal; root schedules after current primary.',
  controller: 'Competent received-data compiled planner; exact independent owner review, physical assessment/provisioning/travel/work, regular source queries. No observer object enters controller.',
  S03: 'Select the plant from received public directory; clarification is not safety; field assessment and separate owner-approved provisioning/activation; select only received usable water stock at the plant node for distribution. Score production-resource receipts only after final source audit.',
  S05: 'Native fire begins at minute5 and evolves without controller knowledge. Received damage/access text is a lead, not verified evacuation demand. Finite human-approved clarification/radio inquiries; servicePlan and checkedRepairPlan act only on received current needs, safety and roads. No fabricated displaced cohort or substitute shelter.',
  stopping: 'No gold served/occupancy stopping. Fixed source horizon, operator stop or wall allowance. All planned/missing outcomes retained; no model or extra resource gift.',
  outcomes: ['plant opened', 'actual raw stock consumed and water produced', 'produced water physically used against outstanding native water demand',
    'hazard lead source ID/version/received clock', 'shelter need received via completed source inquiry', 'owner review + actual evacuation admission',
    'all rejected/inconclusive/pending plans', 'source invariants', 'all owner proposals/reviews/K16', 'three hashes and zero provider usage'],
  limitations: ['Not an advantage comparison, a Gemini demonstration or lives saved.',
    'Native fire can cut Internet30min, isolate pickup nodes and damage the only shelter. Nominal is not labeled successful in advance.',
    'Infeasible removes water stock/deadline via existing native variant plus water_operations/shelter_support qualifications via existing compositionVariant before observations.',
    'The no-model controller uses ordinary public text keywords for a bounded verification lead, not semantic certification.',
    'Capacity1000L/hour, finite raw10000 and generator runtime120min do not imply unlimited production.',
    'One owner platform with four native organizations does not prove federation gains or same-dotation single/network effects.']
};

export function selectPublicFacility(map, use) {
  return [...(map?.places ?? [])].filter(p => p.use === use).sort((a,b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}
export function hazardLeads(signals, map) {
  const places = new Set((map?.places ?? []).map(p => p.id));
  return signals.filter(s => !s.deleted && s.state !== 'withdrawn' && places.has(s.location) &&
    /\b(fire|smoke|visible damage|families are outside|building has fallen|access is interrupted)\b/i.test(s.text ?? ''))
    .sort((a,b) => (a.receivedAtSourceClock ?? Infinity) - (b.receivedAtSourceClock ?? Infinity) || String(a.id).localeCompare(String(b.id)));
}
export function draftMaterialKey(label,plan,records=[]) {
  return sha256(JSON.stringify([label,plan.actions,plan.references,plan.offerVersions??[],records.map(({kind,record})=>({
    kind,id:record.id,owner:record.owner,sourceVersion:record.sourceVersion??record.sourceSnapshot?.version,
    quantity:record.quantity,served:record.served,reserved:record.reserved,floor:record.floor,node:record.node,state:record.state,
    permissionVersion:record.permissionVersion,
  }))]));
}

// Post-execution only; controller never receives these world records.
export function physicalChainReadout(report) {
  const horizon = report.protocol?.common?.horizonMs, source = report.scorerOnlySource ?? {}, operations = source.operations ?? [],
    needs = source.needs ?? [], links = report.proposalFunnel?.records?.flatMap(p => p.steps ?? []) ?? [],
    verified = operation => links.some(s => s.sourceId === operation.id && s.owner === (operation.org ?? operation.owner) &&
      s.correctlyLinked === true && s.usefulPhysicalService === true),
    positive = operation => operations.filter(o=>o.id===operation.id&&(o.org??o.owner)===(operation.org??operation.owner)).length===1 &&
      ['completed','received','service'].includes(operation.state) && operation.received > 0 &&
      exactPhysicalClock(operation, horizon) && verified(operation),
    plant = source.facilities?.find(b => b.id === report.selectedFacility?.id),
    production = source.resources?.find(r => r.id === 'production-' + report.selectedFacility?.id),
    raw = source.resources?.find(r => r.id === 'raw-' + report.selectedFacility?.id),
    ownProduced = operations.filter(o => o.type === 'delivery' && o.resource === production?.id && o.org === production?.owner),
    creditedProduction = finite(production?.produced) && production.produced > 0 && finite(raw?.consumed) && raw.consumed > 0 &&
      finite(plant?.openAt) ? ownProduced.filter(positive) : [],
    hazard = report.receivedHazardLeads ?? [],
    evacuations = operations.filter(o => o.type === 'evacuation'),
    creditedEvacuations = evacuations.filter(o => positive(o) && needs.some(n => n.id === o.need && n.type === 'shelter') &&
      (report.receivedNeedSnapshots ?? []).some(n => n.id === o.need && n.type === 'shelter' && n.quantity > 0 &&
        finite(n.firstReadAtSourceClock) && n.firstReadAtSourceClock <= o.createdAt) &&
      hazard.some(s => finite(s.receivedAtSourceClock) && s.receivedAtSourceClock <= o.createdAt &&
        finite(s.firstReadAtSourceClock) && s.firstReadAtSourceClock <= o.createdAt &&
        s.location === needs.find(n => n.id === o.need)?.building));
  const usefulQuantity = rows => {
    const delivered = new Map(); let useful = 0;
    const wanted = new Set(rows.map(r => JSON.stringify([r.org ?? r.owner, r.id])));
    for (const op of [...operations].filter(o => positive(o)).sort((a,b) => a.times.service - b.times.service || String(a.id).localeCompare(String(b.id)))) {
      const n = needs.find(n => n.id === op.need); if (!n || !finite(n.quantity)) continue;
      const before = delivered.get(n.id) ?? 0, contribution = Math.max(0, Math.min(op.received, n.quantity - before));
      delivered.set(n.id, before + op.received);
      if (wanted.has(JSON.stringify([op.org ?? op.owner, op.id]))) useful += contribution;
    }
    return useful;
  };
  return { scenario: report.scenario, variant: report.variant, status: report.status, errors: report.errors ?? [],
    validForPhysicalClaim: report.status==='completed' && Array.isArray(report.invariants) && report.invariants.length===0 &&
      !(report.errors?.length) && Array.isArray(report.usage) && report.usage.length===0 &&
      ['candidateChanged','evaluatorChanged','simulatorChanged'].every(k=>report.finalBuilds?.[k]===false),
    completedSourceHorizon: report.sourceStoppedAt === horizon, controllerStoppedAt: report.controllerStoppedAt ?? null,
    physicalChain: report.scenario === 'S03' ? { opened: finite(plant?.openAt), openedAt: plant?.openAt ?? null,
      waterProducedL: finite(production?.produced) ? production.produced : null,
      rawConsumedL: finite(raw?.consumed) ? raw.consumed : null,
      usefulProducedWaterL: usefulQuantity(creditedProduction), exactPositiveReceipts: creditedProduction.map(o => ({ owner:o.org, id:o.id,
        resource:o.resource, need:o.need, receivedL:o.received, serviceAtSourceClock:o.times.service })),
      proved: usefulQuantity(creditedProduction) > 0 } : { receivedHazardLeads: hazard,
      usefulAdmissionPlaces: usefulQuantity(creditedEvacuations), exactPositiveReceipts: creditedEvacuations.map(o => ({ owner:o.org, id:o.id,
        need:o.need, shelter:o.building, receivedPlaces:o.received, serviceAtSourceClock:o.times.service })),
      proved: usefulQuantity(creditedEvacuations) > 0 },
    failedOrIncomplete: operations.filter(o => !positive(o)).map(o => ({ id:o.id, type:o.type, owner:o.org, state:o.state,
      received:o.received ?? null, failure:o.failure ?? null })),
    nativeNeeds: needs.map(n => ({ id:n.id, type:n.type, unit:n.unit, quantity:n.quantity, served:n.served,
      firstUsefulAt:n.firstServiceAt ?? null, sufficientAt:n.completedAt ?? null,
      rightCensored: !finite(n.completedAt) || n.completedAt > horizon })),
    invariants: report.invariants ?? null, proposalFunnel: report.proposalFunnel ?? null,
    providerUsage: report.usage ?? null, providerCalls: Array.isArray(report.usage) ? report.usage.length : null,
    GenAIAttribution: false, comparisonBenefit: null,
    note: 'Exact received proposal linkage and positive physical service required; arrivals, provision, activation and zero receipts get no direct-service credit. Native L and places remain separate. Final demand corrections can affect descriptive contribution caps; no causal treatment effect is estimated.' };
}

export async function archivePhysicalProbe() {
  return archiveProbe({ names: ['physical-scenario-evidence.mjs','evidence-probe-guards.mjs','physical-scenario-evidence.test.mjs',
    'evidence-probe-guards.test.mjs','physical-scenario-evidence-guide.md'], tag:'native-physical-chain', plan:PHYSICAL_PLAN });
}

async function runWorld(recipe, deps, shouldStop) {
  const c = PHYSICAL_PLAN.common, h = await deps.createHarness({ scenario:recipe.scenario,seed:PHYSICAL_PLAN.seed,
    organizations:c.organizations,awaitReviews:false,awaitVerifications:false,provider:{complete:async()=>{ throw Error('MODEL_FORBIDDEN_ZERO_PAID_PROBE'); }},
    config:{ organizations:c.nativeOrganizations,grid:c.grid,extentKm:c.extentKm,topology:c.topology,variant:recipe.variant,
      compositionVariant:recipe.compositionVariant,durationMs:c.horizonMs,observationRate:c.observationRate,
      clarificationWorkers:c.clarificationWorkers,postsPerHour:0,healthReports:false,recurringNeeds:false,
      policy:'none',hazard:'none',mode:'modeled',clockLatency:'modeled',backgroundTraffic:0,packetLoss:c.packetLoss,
      networkLatencyMs:c.networkLatencyMs,queryLatencyMs:c.queryLatencyMs,reviewMs:c.reviewMs,inspectionMs:c.inspectionMs,
      loadMs:c.loadMs,unloadMs:c.unloadMs,setupMs:c.setupMs },
    platformConfig:{autoInvestigate:false} }), app = h.apps[0], org = app.config.org,
    report = { protocol:PHYSICAL_PLAN, ...recipe,manifest:h.lab.world.manifest,activities:[], receivedHazardLeads:[], receivedNeedSnapshots:[], errors:[], status:'running' },
    began = performance.now(), materialDrafts = new Set();
  // Controller has no h/lab/world reference. Its only time is the received
  // source clock. The outer observer advances time and audits after it ends.
  const controller = {
    app, selectedFacility:null, drafts:0, inquiryLocations:new Set(), leadIds:new Set(), needVersions:new Set(),
    async bootstrap() {
      for (const target of ['map','inventory','vehicles','roads','policy']) await app.connector.action('query',{target},'chain-bootstrap-'+target);
      await app.ingestion.sync({sources:true});
      const map=(await app.store.get(org,'context','geography',false))?.map;
      this.selectedFacility=selectPublicFacility(map,recipe.scenario==='S03'?'plant':'shelter');
      if(!this.selectedFacility)throw Error('Received public directory has no eligible facility.');
      report.selectedFacility=this.selectedFacility;
      await app.connector.action('verify',{target:'building',id:this.selectedFacility.id,method:'clarification'},'chain-facility-metadata');
      this.actor=(await app.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",[org])).rows[0];
      if(recipe.scenario==='S05') {
        const summary=await app.coverage.summary();
        await app.coverage.configure(this.actor,{version:0,placeIds:summary.directory.map(p=>p.id),staleAfterMs:3600000,cooldownMs:600000,
          maxWaitMs:3600000,maxActive:2,maxPerBatch:2,allowedMethods:['clarification','radio'],reason:'Finite verification of received hazard leads, not inferred evacuation authority.'},'chain-coverage-policy');
      }
    },
    async draft(plan,label) {
      if(!plan.readyToDraft || !plan.actions?.length || this.drafts>=c.maxDraftsPerWorld)return;
      const records=(await Promise.all(plan.references.map(id=>deps.resolveEvidence(app.store,org,id)))).filter(Boolean),
        key=draftMaterialKey(label,plan,records);
      if(materialDrafts.has(key))return;materialDrafts.add(key);
      const now=(await app.store.get(org,'source','simulator',false))?.simulatedAt;
      const proposal=await app.domain.propose({id:'received-compiled-controller',org,role:'agent'},{title:label,
        summary:'Compile only received current evidence and capacities.',benefit:'Actual native service after separate owner review.',
        rationale:'Competent no-model mechanism control: source safety, skills, calendar, payload, route and ownership checks remain required.',
        actions:plan.actions,references:plan.references,conditions:[],alternatives:[]},'chain-draft-'+key,
        plan.proposalId?{repairOf:plan.proposalId}:{});
      this.drafts++;report.activities.push({stage:'draft',label,proposal:proposal.id,sourceClock:now,actions:plan.actions,references:plan.references});
    },
    async pump() {
      await app.ingestion.sync({sources:true});await app.coverage.sync();
      for(const p of await app.store.list(org,'proposal',1000)) {
        if(p.state==='awaiting_review')await deps.scriptedReview(app,p);
        const current=await app.store.get(org,'proposal',p.id);
        if(['authorized','executing','awaiting_partner'].includes(current.state))await app.worker.execute(current.id);
        if(current.state==='requires_review') {
          try{await this.draft(await deps.checkedRepairPlan(app.store,app.config,{proposalId:current.id}),'Repair received blocked work');}
          catch(e){report.activities.push({stage:'repair_pending',proposal:p.id,code:e.code??e.name,message:e.message.slice(0,240)});}
        }
      }
      await app.worker.drain();
      const sourceNow=(await app.store.get(org,'source','simulator',false))?.simulatedAt;
      for(const n of await app.store.list(org,'need',2000)) {
        const key=JSON.stringify([n.id,n.sourceVersion]);
        if(!this.needVersions.has(key)) {this.needVersions.add(key);report.receivedNeedSnapshots.push({id:n.id,building:n.building,type:n.type,
          quantity:n.quantity,unit:n.unit,sourceVersion:n.sourceVersion,sourceObservedAt:n.sourceSnapshot?.at??n.at??null,firstReadAtSourceClock:sourceNow});}
      }
      if(recipe.scenario==='S05') {
        const map=(await app.store.get(org,'context','geography',false))?.map, leads=hazardLeads(await app.store.list(org,'signal',2000),map);
        for(const lead of leads)if(!this.leadIds.has(lead.id)) {
          this.leadIds.add(lead.id);report.receivedHazardLeads.push({id:lead.id,version:lead.sourceVersion,location:lead.location,
            receivedAtSourceClock:lead.receivedAtSourceClock,firstReadAtSourceClock:sourceNow,text:lead.text});
        }
        const summary=await app.coverage.summary(), target=leads.find(lead=>!this.inquiryLocations.has(lead.location));
        if(target && this.inquiryLocations.size<c.maxHazardInquiryLocations && !summary.requests.some(r=>r.checks.some(k=>['queued','checking'].includes(k.state)))) {
          // Clarification uses the existing bounded queue. Internet outages
          // stay honest; no observer-informed channel or field shortcut.
          await app.coverage.request(this.actor,{policyVersion:summary.policy.version,coverageVersion:summary.version,
            checks:[{building:target.location,method:'clarification'}]},'chain-hazard-inquiry-'+target.id);
          this.inquiryLocations.add(target.location);report.activities.push({stage:'hazard_inquiry',source:target.id,location:target.location,sourceClock:sourceNow});
        }
      }
      const assessment=await deps.assessmentPlan(app.store,org,this.selectedFacility.id);
      if(!assessment.satisfied)await this.draft(assessment,'Assess current facility safety');
      else {
        const plan=await deps.servicePlan(app.store,org,this.selectedFacility.id);
        if(plan.refreshRequest)await app.connector.action('query',{target:'facility',id:this.selectedFacility.id},'chain-facility-refresh-'+sourceNow);
        await this.draft(plan,recipe.scenario==='S03'?'Restore the water plant':'Open shelter and evacuate received demand');
        report.activities.push({stage:'service_plan',sourceClock:sourceNow,ready:plan.readyToDraft,pending:plan.pending??[],missing:plan.missing??[],waitReceipt:plan.waitReceipt??false});
      }
      if(recipe.scenario==='S03') {
        const queue=await deps.responseQueue(app.store,org,{limit:2000}), candidates=queue.rows.filter(n=>n.type==='water' && n.planningOutstanding>0),
          resources=(await app.store.list(org,'resource',2000)).filter(r=>r.owner===org && r.type==='water' && r.node===this.selectedFacility.node),
          available=resources.reduce((n,r)=>n+Math.max(0,r.quantity-(r.reserved??0)-(r.floor??0)),0);
        if(candidates.length && available>=Math.min(c.producedWaterBatchMinL,candidates[0].planningOutstanding)) {
          const scopedStore=new Proxy(app.store,{get:(object,property)=>property==='list' ? async(scope,kind,...rest)=>{
            const rows=await object.list(scope,kind,...rest);return kind==='resource'?rows.filter(r=>r.type==='water'&&r.node===controller.selectedFacility.node):rows;
          }:typeof object[property]==='function'?object[property].bind(object):object[property]});
          const allocation=await deps.receivedAllocationPlan(scopedStore,app.config,{needIds:candidates.map(n=>n.id)});
          const selected=allocation.allocations.slice(0,30), actions=selected.map(a=>({type:'dispatch',owner:a.owner,
            params:{need:a.need,resource:a.resource,vehicle:a.vehicle,quantity:a.quantity,ttlMs:a.ttlMs},dependsOn:[]}));
          await this.draft({readyToDraft:actions.length>0,actions,references:[...new Set(selected.flatMap(a=>[a.need,a.resource,a.vehicle]))]},'Deliver received plant-node water');
        }
      }
    }
  };
  try {
    await controller.bootstrap();
    while(h.lab.world.now<c.horizonMs) {
      if(await shouldStop()){report.status='operator_stopped';break;}
      if(performance.now()-began>c.wallLimitMs){report.status='wall_limit';break;}
      await controller.pump();
      h.lab.world.advance(Math.min(c.horizonMs,h.lab.world.now+c.cadenceMs),{maxEvents:1000000});
    }
    if(report.status==='running')report.status='completed';
  } catch(e) { report.status='failed';report.errors.push({code:e.code??e.name,message:e.message.slice(0,500)}); }
  finally {
    report.controllerStoppedAt=(await app.store.get(org,'source','simulator',false))?.simulatedAt??null;
    // Fixed-horizon scorer closure does not expose outcomes to controller.
    h.lab.world.advance(c.horizonMs,{maxEvents:1000000});report.sourceStoppedAt=h.lab.world.now;
    report.scorerOnlySource=structuredClone({operations:h.lab.world.state.operations,needs:h.lab.world.state.needs,
      resources:h.lab.world.state.resources,facilities:h.lab.world.state.map.buildings,
      sourceProposals:h.lab.world.state.proposals,inspections:h.lab.world.state.inspections,events:Array.from(h.lab.world.log)});
    report.proposalFunnel=await deps.collectProposalServiceFunnel(h.apps,h.lab.world);
    report.usage=(await app.store.query('SELECT model,state,cost_usd,reserved_usd,wall_ms,error FROM usage')).rows;
    report.invariants=h.lab.world.invariants();report.wallMs=performance.now()-began;
    await h.close();
  }
  return report;
}

async function main() {
  const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const m=/^--([a-z-]+)(?:=(.*))?$/.exec(arg);if(!m)throw Error('Named arguments required');return[m[1],m[2]??true];}));
  if(args.plan){console.log(JSON.stringify(PHYSICAL_PLAN,null,2));return;}
  if(args.archive){console.log(JSON.stringify(await archivePhysicalProbe()));return;}
  if(!args.freeze)throw Error('Use --plan/--archive or provide current verified freeze. No world starts during preparation.');
  const freeze=JSON.parse(await readFile(resolve(args.freeze),'utf8')),
    deps={...await import('../evaluation/harness.mjs'),...await import('../src/services.mjs'),...await import('../src/response-policy.mjs'),
      ...await import('../src/received-allocation.mjs'),...await import('../src/response-repair.mjs'),...await import('../src/citations.mjs'),...await import('../evaluation/proposal-funnel.mjs')},
    builds=await import('../evaluation/simulator-build.mjs'),
    current={candidateFingerprint:await deps.buildFingerprint(),evaluatorFingerprint:await deps.evaluatorFingerprint(),simulatorBuild:await builds.requireLoadedSimulatorBuild()};
  validateProbeGate(freeze,current);
  if(args.run!=='ROOT_GO_PHYSICAL_CHAIN'){console.log(JSON.stringify({state:'dry_verified_no_world',current,plan:PHYSICAL_PLAN}));return;}
  const stop=resolve(PHYSICAL_PLAN.stopFile);if(await exists(stop))throw Error('Existing stop marker must remain preserved.');
  let interrupted=false;process.on('SIGINT',()=>{interrupted=true;});process.on('SIGTERM',()=>{interrupted=true;});
  const shouldStop=async()=>interrupted || await exists(stop), archive=await archivePhysicalProbe(),
    release=await acquireProbeLock(resolve(PHYSICAL_PLAN.lockFile),{nonce:randomUUID(),study:'zero_paid_physical_chain',pid:process.pid,current}),
    folder=resolve('reports/physical-chain/native-current-'+Date.now()), rows=[];
  await mkdir(folder,{recursive:true});
  const protocol={...PHYSICAL_PLAN,at:new Date().toISOString(),...current,freezePath:resolve(args.freeze),archive};
  const checkpoint=()=>writeFile(resolve(folder,'index.json'),JSON.stringify({protocol,cases:rows,
    notAttempted:PHYSICAL_PLAN.worlds.filter(w=>!rows.some(r=>r.scenario===w.scenario&&r.variant===w.variant)).map(w=>({...w,state:'not_attempted',providerCalls:0}))},null,2));
  try {
    await writeFile(resolve(folder,'protocol.json'),JSON.stringify(protocol,null,2));await checkpoint();
    for(const recipe of PHYSICAL_PLAN.worlds) {
      if(await shouldStop())break;
      const before=await builds.checkFinalBuilds({candidate:current.candidateFingerprint,evaluator:current.evaluatorFingerprint,simulator:current.simulatorBuild},
        {candidate:deps.buildFingerprint,evaluator:deps.evaluatorFingerprint});if(before.invalidStatus)break;
      const report=await runWorld(recipe,deps,shouldStop);
      report.finalBuilds=await builds.checkFinalBuilds({candidate:current.candidateFingerprint,evaluator:current.evaluatorFingerprint,simulator:current.simulatorBuild},
        {candidate:deps.buildFingerprint,evaluator:deps.evaluatorFingerprint});
      Object.assign(report,current);if(report.finalBuilds.invalidStatus)report.status=report.finalBuilds.invalidStatus;
      const file=resolve(folder,recipe.scenario+'-'+recipe.variant+'.json');await writeFile(file,JSON.stringify(report,null,2));
      rows.push({...recipe,file,sha256:sha256(await readFile(file)),readout:physicalChainReadout(report)});await checkpoint();
      console.log(JSON.stringify({folder,scenario:recipe.scenario,variant:recipe.variant,status:report.status,readout:rows.at(-1).readout.physicalChain,providerCalls:report.usage.length}));
      if(report.finalBuilds.invalidStatus || report.usage.length)break;
    }
  } finally {await checkpoint();await release();}
  console.log(JSON.stringify({folder,prepared:6,completed:rows.length,positiveMechanisms:rows.filter(r=>r.readout.physicalChain.proved).length,
    comparisonBenefit:null,providerCalls:rows.reduce((n,r)=>n+(r.readout.providerCalls??0),0)}));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
