// Offline descriptive decomposition of recorded receipts. Never controls the world.
const clock = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const mean = xs => xs.length && xs.every(Number.isFinite) ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const keys = ['preAuthorizationMs','pickupTravelMs','loadedTravelMs','arrivalToServiceMs','withoutShipmentTravelMs','totalMs'];

export function responseStages(record) {
  const horizon = record.protocol.horizonMs;
  const rows = (record.outcomes ?? []).map(n => {
    const createdAt = record.metrics?.perCommunity?.find(c=>c.id===n.id)?.createdAt;
    const receipts = (record.observerOnly?.operations ?? [])
      .filter(o=>o.need===n.id && o.received>0 && clock(o.times?.service) && o.times.service<=horizon)
      .sort((a,b)=>a.times.service-b.times.service || a.id.localeCompare(b.id));
    let quantity=0, threshold=null;
    for(const r of receipts) { quantity+=r.received; if(!threshold && quantity>=n.quantity)threshold=r; }
    const t=threshold?.times;
    const issues=[];
    if(!clock(createdAt))issues.push('created_clock_missing');
    if(!n.censored && (!threshold || threshold.times.service!==n.completedAt))issues.push('sufficient_receipt_mismatch');
    if(n.censored && threshold)issues.push('censor_receipt_mismatch');
    let phases=null;
    if(!n.censored && clock(createdAt) && t && ['authorized','dispatched','arrived','service'].every(k=>clock(t[k]))) {
      const pickupPresent=t.pickupDispatched!=null || t.pickupArrived!=null;
      const pickupTravelMs=pickupPresent && clock(t.pickupDispatched) && clock(t.pickupArrived)
        ? t.pickupArrived-t.pickupDispatched : pickupPresent ? null : 0;
      const loadedTravelMs=t.arrived-t.dispatched, totalMs=t.service-createdAt;
      phases={preAuthorizationMs:t.authorized-createdAt,pickupTravelMs,loadedTravelMs,
        arrivalToServiceMs:t.service-t.arrived,
        withoutShipmentTravelMs:pickupTravelMs==null?null:totalMs-pickupTravelMs-loadedTravelMs,totalMs};
      if(Object.values(phases).some(x=>!clock(x))) { issues.push('incomplete_or_nonmonotonic_phases');phases=null; }
    }
    return {id:n.id,type:n.type,unit:n.unit,quantity:n.quantity,served:n.served,censored:n.censored,
      thresholdOperation:threshold?.id??null,receipts:receipts.length,phases,issues};
  });
  const taskById=new Map();
  for(const task of record.observerOnly?.humanWork ?? []) {
    const id=task.org+':'+task.id,prior=taskById.get(id);
    if(!prior || (task.version??0)>(prior.version??0))taskById.set(id,task);
  }
  let workPersonMs=0,workUnknown=Array.isArray(record.observerOnly?.humanWork)?0:1;
  for(const t of taskById.values()) {
    if(t.startedAt==null)continue;
    if(!clock(t.startedAt)||!clock(t.readyAt)||t.readyAt<t.startedAt){workUnknown++;continue;}
    workPersonMs+=Math.max(0,Math.min(horizon,t.readyAt)-t.startedAt);
  }
  const observed=rows.filter(n=>n.phases);
  return {eligible:rows.length,observed:observed.length,censored:rows.filter(n=>n.censored).length,
    means:Object.fromEntries(keys.map(k=>[k,mean(observed.map(n=>n.phases[k]))])),
    complete:observed.length===rows.length && rows.every(n=>!n.issues.length),
    attentionWorkPersonMinutes:workUnknown?null:workPersonMs/60000,workUnknown,
    rows,note:'Phases describe the contribution reaching sufficient quantity. Incomplete/censored needs stay in the primary horizon-limited mean; observed-only phase means must not be advertised as all-needs means. Shipment travel excludes both pickup driving and loaded driving, but includes earlier waiting for fleet capacity.'};
}
