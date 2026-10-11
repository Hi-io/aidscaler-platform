import {check} from './errors.mjs';
export function shortestRoute(map,from,to,vehicle={},observed={}){
  if(from===to)return {nodes:[from],distanceM:0,seconds:0,unknownEdges:[]};
  const edges=Array.isArray(map?.roads)?map.roads:Object.values(map?.edges??{}),adj=new Map();
  for(const e of edges){const state=observed[e.id]??e;if(state.open===false||(e.maxWeight??Infinity)<(vehicle.weightKg??0))continue;const a=adj.get(e.from)??[];a.push({...e,...state});adj.set(e.from,a);}
  const q=[{id:from,cost:0,nodes:[from],distanceM:0,unknownEdges:[]}],seen=new Set();
  while(q.length){q.sort((a,b)=>a.cost-b.cost);const current=q.shift();if(current.id===to)return {nodes:current.nodes,distanceM:current.distanceM,seconds:current.cost,unknownEdges:current.unknownEdges};if(seen.has(current.id))continue;seen.add(current.id);for(const e of adj.get(current.id)??[]){const unknown=observed[e.id]?.open==null&&e.open==null;const seconds=(e.lengthM??100)/(Math.min(e.speedMps??8,vehicle.speedMps??15)||1);q.push({id:e.to,cost:current.cost+seconds,nodes:[...current.nodes,e.to],distanceM:current.distanceM+(e.lengthM??100),unknownEdges:[...current.unknownEdges,...(unknown?[e.id]:[])]});}}
  return null;
}
export function allocationPlan({needs,resources,vehicles,operations=[],now=0}){
  const stock=new Map(resources.map(r=>[r.id,Math.max(0,r.quantity-r.reserved-(r.floor??0))])),usedVehicles=new Set(),allocations=[],unserved=[];
  for(const need of [...needs].sort((a,b)=>(b.priority??0)-(a.priority??0)||(a.deadline??Infinity)-(b.deadline??Infinity)||a.id.localeCompare(b.id))){
    const incoming=operations.filter(o=>o.need===need.id&&!['failed','cancelled','completed'].includes(o.state)).reduce((n,o)=>n+(o.quantity??0),0);let remaining=Math.max(0,need.quantity-(need.served??0)-incoming);
    for(const resource of resources.filter(r=>r.type===need.type)){
      const vehicle=vehicles.find(v=>v.owner===resource.owner&&!usedVehicles.has(v.id)&&['idle','arrived'].includes(v.state));if(!vehicle)continue;
      const quantity=Math.floor(Math.min(remaining,stock.get(resource.id),vehicle.capacity??0,(vehicle.maxCargoKg??Infinity)/(resource.type==='water'?1:resource.type==='energy'?150:1)));if(quantity<=0)continue;
      allocations.push({need:need.id,resource:resource.id,vehicle:vehicle.id,quantity,owner:resource.owner,needsRouteCheck:true});stock.set(resource.id,stock.get(resource.id)-quantity);usedVehicles.add(vehicle.id);remaining-=quantity;if(!remaining)break;
    }
    if(remaining)unserved.push({need:need.id,remaining,unit:need.unit,reason:'No uncommitted eligible capacity in this planning round'});
  }return {allocations,unserved,algorithm:'deterministic constrained greedy reference',doesNotDispatch:true};
}
export const SERVICE_RECIPES={shelter:{requirements:['safety_inspection','owner_permission','water','sanitation','staff','energy','transport']},water_plant:{requirements:['safety_inspection','owner_permission','compatible_energy','qualified_staff','raw_water','distribution']}};
export function composeService({service,offers,inspection,permit}){
  const recipe=SERVICE_RECIPES[service];check(recipe,'SERVICE','Unknown service recipe.');const fulfilled=new Map();if(inspection?.state==='completed'&&inspection.result?.safe===true)fulfilled.set('safety_inspection',inspection);if(permit?.authorizedBy)fulfilled.set('owner_permission',permit);
  for(const offer of offers.filter(o=>o.available>0&&o.expiresAt>Date.now()&&o.active!==false)){const purpose=offer.type==='energy'&&offer.compatibility?.powerKw>=10?'compatible_energy':offer.type;fulfilled.set(purpose,offer);}
  return {service,requirements:recipe.requirements.map(type=>({type,fulfilled:fulfilled.has(type),evidence:fulfilled.get(type)?.id??null,owner:fulfilled.get(type)?.owner??null})),ready:recipe.requirements.every(r=>fulfilled.has(r)),note:'A composed proposal is not a physical operating service.'};
}
export async function validateConditions(store,org,conditions){
  return Promise.all(conditions.map(async c=>{let satisfied=false,evidenceId=null;
    if(c.type==='inspection'){const v=await store.get(org,'verification',c.id,false);satisfied=v?.state==='completed'&&(v.result?.safe!==false);evidenceId=v?.id;}
    if(c.type==='resource'){const r=await store.get(org,'resource',c.id,false);satisfied=!!r&&(c.version===undefined||r.version===c.version)&&r.quantity-r.reserved-r.floor>0;evidenceId=r?.id;}
    if(c.type==='commitment'){const v=await store.get(org,'commitment',c.id,false);satisfied=v?.state==='confirmed'&&v.expiresAt>Date.now();evidenceId=v?.id;}
    if(c.type==='approval'){const p=await store.get(org,'proposal',c.id,false);satisfied=p?.state==='authorized'&&!!p.authorization;evidenceId=p?.id;}
    if(c.type==='time')satisfied=c.expiresAt!==undefined&&c.expiresAt>Date.now();
    if(c.type==='evidence'){const claim=await store.get(org,'claim',c.id,false);satisfied=claim?.state==='confirmed'&&(!claim.validUntil||claim.validUntil>Date.now());evidenceId=claim?.id;}
    // Owner consent and technical compatibility require an explicit verified check, not a model boolean.
    if(['owner','compatibility'].includes(c.type)){const v=await store.get(org,'verification',c.id,false);satisfied=v?.state==='completed'&&v.result?.approved===true;evidenceId=v?.id;}
    return {...c,satisfied:!!satisfied,evidenceId:evidenceId??null};
  }));
}
export async function validatePlan(store,org,proposal){
  const checks=[],usedStock=new Map(),usedVehicles=new Set();
  const active=(await store.list(org,'proposal',2000)).filter(p=>p.id!==proposal.id&&['authorized','executing','awaiting_partner'].includes(p.state));
  for(const p of active)for(const a of p.actions.filter(a=>a.owner===org&&a.type==='dispatch')){usedStock.set(a.params.resource,(usedStock.get(a.params.resource)??0)+(a.params.quantity??0));usedVehicles.add(a.params.vehicle);}
  for(const [index,a] of proposal.actions.entries()){
    if(a.owner!==org){checks.push({index,type:'owner',state:'requires_partner_authorization',owner:a.owner});continue;}
    if(a.type==='dispatch'){const r=await store.get(org,'resource',a.params.resource,false),v=await store.get(org,'vehicle',a.params.vehicle,false),n=await store.get(org,'need',a.params.need,false);const q=a.params.quantity;
      check(Number.isSafeInteger(q)&&q>0,'QUANTITY','Dispatch quantity must be a positive integer.');
      check(a.params.need||a.params.destination,'DESTINATION','Dispatch must specify an existing need ID or a destination road node. A title is not a destination.');
      check(!a.params.need||n,'NEED_ID','The need ID is not in the observed operational records. Do not use a building ID as a need ID.');
      check(r&&v,'UNVERIFIED_CAPACITY','Inventory and vehicle must be known before approval.');
      check(r.owner===org&&v.owner===org,'RESOURCE_OWNER','Only the owner can authorize this resource and vehicle.',403);
      check(q+(usedStock.get(r.id)??0)<=r.quantity-(r.reserved??0)-(r.floor??0),'INSUFFICIENT_RESOURCE','The requested stock is already allocated, reserved or protected.',409);
      check(q<=v.capacity,'VEHICLE_CAPACITY','Vehicle capacity is insufficient.');
      check(!usedVehicles.has(v.id)||a.dependsOn.length,'VEHICLE_CONFLICT','A vehicle is already assigned to another concurrent operation.',409);
      check(['idle','arrived'].includes(v.state)||a.dependsOn.length,'VEHICLE_BUSY','A busy vehicle requires a checked dependency before it can be reused.',409);
      check(!n||r.type===n.type,'RESOURCE_TYPE','Resource does not satisfy the need.');
      usedStock.set(r.id,(usedStock.get(r.id)??0)+q);usedVehicles.add(v.id);
      checks.push({index,type:'quantity_capacity',state:'checked',resourceVersion:r.version,vehicleVersion:v.version,quantity:q});
    }
    if(a.type==='activate'){const f=await store.get(org,'facility',a.params.building,false);check(f?.safe===true,'SAFETY_INSPECTION','A completed safety assessment is required before activation.');checks.push({index,type:'facility_safety',state:'checked',facilityVersion:f.version});}
  }return checks;
}
