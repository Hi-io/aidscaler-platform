import { check } from "./errors.mjs";
import { hash } from "./store.mjs";
import { responseQueue } from "./response-policy.mjs";
import { receivedSourceNow, receivedUsableQuantity, lotStatus } from "./lot-capacity.mjs";
import { receivedStaffCapacity, receivedStaffCalendar } from "./staff-capacity.mjs";
import { receivedExecutionPolicy, dispatchReservationEstimate } from "./reservation-policy.mjs";
import { receivedCargoCapacity, receivedCargoProfile } from "./received-cargo.mjs";
import { receivedVehicleCalendar } from "./received-vehicle-calendar.mjs";
import { shortestRoute, validatePlan } from "./planning.mjs";

const ACTIVE = new Set(["awaiting_review", "needs_clarification", "conditionally_authorized", "authorized", "executing", "awaiting_partner"]);
const REQUEST_STATES = new Set(["waiting_for_crew", "queued", "working", "completed", "inconclusive", "cancelled"]);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const rawRequest = row => row?.sourceSnapshot ?? row;

/** Delivered actor state is the only source. Absence does not cancel a request,
 * and an older snapshot delivered later cannot erase progress. */
export async function persistReceivedUnloadingRequests(store, org, state) {
  check(state.organization?.id === org, "UNLOAD_OWNER", "The received source snapshot belongs to another organization.", 403);
  for (const source of state.unloadingRequests ?? []) {
    check(source && typeof source.id === "string" && typeof source.operation === "string" &&
      (source.org === org || source.receiverOrg === org), "UNLOAD_OWNER", "An unloading request is outside this organization's received scope.", 403);
    check(REQUEST_STATES.has(source.state) && integer(source.version) && integer(source.operationVersion) &&
      integer(source.targetVersion) && integer(source.observedAt) && integer(source.deliveryQuantity) && source.deliveryQuantity > 0 &&
      integer(source.received) && source.received <= source.deliveryQuantity && integer(source.staffQuantity) && source.staffQuantity > 0 &&
      integer(source.workMs) && Array.isArray(source.requiredSkills) && source.requiredSkills.length <= 32 &&
      source.requiredSkills.every(s => typeof s === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(s)) &&
      new Set(source.requiredSkills).size === source.requiredSkills.length,
    "UNLOAD_RECEIPT", "The source unloading request has invalid quantities, versions or requirements.", 409);
    const prior = await store.get(org, "unloading_request", source.id, false), old = rawRequest(prior);
    check(!prior?.sourceRunId || typeof state.runId === "string", "UNLOAD_RUN_SCOPE", "A previously scoped cargo receipt requires a current source run identity.", 409);
    if (prior && prior.sourceRunId === (state.runId ?? null) && (old.version > source.version || old.operationVersion > source.operationVersion ||
      hash(old) === hash(source))) continue;
    await store.put(org, "unloading_request", source.id, { ...source, sourceSnapshot: source,
      sourceVersion: source.version, sourceOperationVersion: source.operationVersion,
      confirmedBySource: true, receivedAtSourceClock: state.now, sourceRunId: state.runId ?? null }, prior?.version ?? 0);
  }
}

export async function currentUnloadingRequests(store, org) {
  const runId = (await store.get(org, "source", "simulator", false))?.runId ??
    (await store.get(org, "context", "operational", false))?.snapshot?.runId;
  return (await store.list(org, "unloading_request", 2000)).filter(r => r.confirmedBySource === true &&
    (r.sourceRunId ? r.sourceRunId === runId : !runId));
}
async function requestFor(store, org, operation) {
  return (await currentUnloadingRequests(store, org)).filter(r => r.operation === operation)
    .sort((a,b) => (b.sourceVersion ?? 0) - (a.sourceVersion ?? 0))[0] ?? null;
}
const material = p => [p.actions, p.references, p.versions];
export const unloadingCheckpoint = p => hash(material(p));

/** Common, deterministic received-state compiler. It does not approve either a
 * crew trip or the subsequent finite unloading job, and never redispatches aid. */
export async function unloadingPlan(store, org, operation, { excludeProposal = null } = {}) {
  const row = await requestFor(store, org, operation), request = rawRequest(row), now = await receivedSourceNow(store, org),
    base = { operation, readyToDraft: false, actions: [], references: row ? [row.id] : [], pending: [], missing: [], sourceNow: now };
  if (!request) return { ...base, missing: [{ type: "received_unloading_request" }], note: "Receive the unloading request through the ordinary source channel. A delivery ETA is not a crew requirement or receipt." };
  const versions = { request: row.id, sourceRunId: row.sourceRunId ?? null, requestVersion: request.version, operationVersion: request.operationVersion,
    targetVersion: request.targetVersion, deliveryQuantity: request.deliveryQuantity };
  if (request.receiverOrg !== org) return { ...base, versions, missing: [{ type: "receiver_owner_review", owner: request.receiverOrg }],
    note: "The receiver controls its own crew. The donor cannot reserve receiver staff or treat arrival as receipt." };
  if (request.state === "completed") return { ...base, versions, satisfied: request.received === request.deliveryQuantity,
    received: request.received, note: "The received source request reports completion of the original delivery." };
  const proposals = (await store.list(org, "proposal", 2000)).filter(p => p.id !== excludeProposal && ACTIVE.has(p.state) &&
    p.actions?.some(a => a.type === "unload" && a.params.operation === operation ||
      p.unloadingOperation === operation));
  if (["queued", "working"].includes(request.state) || proposals.length)
    return { ...base, versions, pending: [{ request: row.id, operation, state: request.state },
      ...proposals.map(p => ({ proposal: p.id, operation, state: p.state }))], waitReceipt: true,
      note: "Current crew work or its owner review is pending. Preserve the original cargo and wait for its physical receipt." };
  if (!["waiting_for_crew", "inconclusive"].includes(request.state)) return { ...base, versions,
    missing: [{ type: "current_unloading_request", state: request.state }], note: "Receive a current request after inconclusive or cancelled work before preparing another crew job." };
  const site = await store.get(org, "facility", request.building, false);
  if (!site || (site.ownerOrg ?? request.receiverOrg) !== org || site.sourceVersion !== request.targetVersion || site.node !== request.node)
    return { ...base, versions, missing: [{ type: "current_receiver_site", building: request.building }],
      note: "Receive this receiver's current site/version before assigning a crew." };
  const queue = await responseQueue(store, org, { excludeProposal, limit: 2000 }),
    execution = await receivedExecutionPolicy(store, org), command = execution?.delivery?.commandNominalLatencyMs,
    workAt = Number.isFinite(now) && integer(command) ? now + command : null,
    useAt = workAt === null ? null : workAt + request.workMs,
    staff = (await store.list(org, "resource", 2000)).filter(r => r.owner === org && r.type === "staff"),
    held = r => queue.planningHolds.filter(h => h.owner === org && h.resource === r.id).reduce((n,h) => n + h.quantity, 0),
    onsite = staff.find(r => r.node === request.node && lotStatus(r, now, useAt).usable &&
      receivedStaffCapacity(r, request.requiredSkills, held(r), { now, workAt, useAt }) >= request.staffQuantity);
  if (!integer(command)) return { ...base, versions, missing: [{ type: "received_execution_policy" }],
    note: "Receive nominal command timing before checking the crew's finite working window." };
  if (onsite) return { ...base, versions: { ...versions, staff: onsite.id, staffVersion: onsite.version, siteVersion: site.version },
    readyToDraft: true, stage: "unload", references: [row.id, site.id, onsite.id],
    actions: [{ type: "unload", owner: org, dependsOn: [], params: { operation, staff: onsite.id,
      quantity: request.staffQuantity, targetVersion: request.targetVersion, requestVersion: request.version,
      sourceVersion: request.operationVersion, deliveryQuantity: request.deliveryQuantity } }],
    note: "Approve finite work by this receiver's qualified onsite crew. Only a later source receipt completes the original delivery." };
  const map = (await store.get(org, "context", "geography", false))?.map,
    roads = Object.fromEntries((await store.list(org, "road", 5000)).map(r => [r.id, r])),
    operations = await store.list(org, "operation", 10000),
    allFleet = (await store.list(org, "vehicle", 2000)).filter(v => v.owner === org),
    fleet = allFleet.filter(v => v.driverAvailable !== false &&
      ["idle", "arrived"].includes(v.state) && !v.operation &&
      !operations.some(o => (o.owner ?? o.org) === org && o.vehicle === v.id && o.confirmedBySource === true &&
        !["completed", "received", "service", "failed", "cancelled"].includes(o.state)) &&
      !queue.planningHolds.some(h => h.owner === org && h.vehicle === v.id));
  const trips = [];
  for (const r of staff.filter(r => r.node !== request.node && receivedUsableQuantity(r, now) >= request.staffQuantity))
    for (const v of fleet) {
      if (receivedCargoCapacity(v, r, execution) < request.staffQuantity || !map?.roads) continue;
      const pickup = shortestRoute(map, v.node, r.node, v, roads), delivery = shortestRoute(map, r.node, request.node,
        { ...v, weightKg: (v.weightKg ?? 0) + request.staffQuantity * receivedCargoProfile(r, execution).massKgPerUnit }, roads);
      if (!pickup || !delivery || ![command, execution?.delivery?.loadMs, execution?.delivery?.unloadMs].every(integer)) continue;
      const arrival = now + Math.ceil((pickup.seconds + delivery.seconds) * 1000) + command + execution.delivery.loadMs + execution.delivery.unloadMs;
      if (!lotStatus(r, now, arrival + command + request.workMs).usable ||
        receivedStaffCapacity(r, request.requiredSkills, held(r), { now, workAt: arrival + command, useAt: arrival + command + request.workMs }) < request.staffQuantity) continue;
      const returnRoute = v.calendar?.nextCommitment?.node ? shortestRoute(map, request.node, v.calendar.nextCommitment.node, v, roads) : null;
      if (!receivedVehicleCalendar(v, { now, pickup, delivery, returnRoute, executionPolicy: execution }).usable) continue;
      const fuel = (pickup.distanceM + delivery.distanceM + (returnRoute?.distanceM ?? 0)) / 1000 * (v.fuelMlPerKm ?? 0);
      if (fuel > (v.fuel ?? Infinity)) continue;
      const ttl = dispatchReservationEstimate(pickup, execution);
      if (ttl.minimumTtlMs !== null && ttl.minimumTtlMs > ttl.maxTtlMs) continue;
      trips.push({ r, v, pickup, delivery, ttl, arrival });
    }
  trips.sort((a,b) => a.arrival - b.arrival || a.v.id.localeCompare(b.v.id));
  if (trips.length) {
    const { r, v, ttl } = trips[0];
    return { ...base, versions: { ...versions, staff: r.id, staffVersion: r.version, vehicle: v.id, vehicleVersion: v.version, siteVersion: site.version },
      readyToDraft: true, stage: "transport_crew", references: [row.id, site.id, r.id, v.id],
      actions: [{ type: "dispatch", owner: org, dependsOn: [], params: { vehicle: v.id, resource: r.id,
        quantity: request.staffQuantity, destination: request.node, staffSkills: request.requiredSkills,
        ttlMs: Math.max(ttl.defaultTtlMs, ttl.minimumTtlMs ?? 0) } }],
      note: "Approve a real crew trip first. After its receipt, refresh this request and separately approve unloading the existing cargo." };
  }
  // A finite receiver crew can be stranded behind its own arrived cargo. A
  // recovery proposal may return ONE additional own delivery; it never
  // cancels the original target, commandeers a partner truck or assumes that
  // cancelling makes transport immediately available.
  const qualified = staff.some(r => r.node !== request.node && lotStatus(r, now).usable &&
    receivedStaffCapacity(r, request.requiredSkills, held(r), { now }) >= request.staffQuantity),
    requests = await store.list(org, "unloading_request", 2000);
  if (qualified && !fleet.length) {
    const extra = operations.find(o => o.id !== operation && (o.owner ?? o.org) === org && o.confirmedBySource === true &&
      o.type === "delivery" && o.state === "waiting_to_unload" && (o.received ?? 0) === 0 && o.building === request.building &&
      requests.some(other => { const r = rawRequest(other); return other.confirmedBySource === true &&
        other.sourceRunId === row.sourceRunId && r.operation === o.id &&
        r.org === org && r.receiverOrg === org && r.state === "waiting_for_crew" && r.received === 0; }) &&
      allFleet.some(v => v.id === o.vehicle && v.driverAvailable !== false && receivedCargoCapacity(v, staff.find(r =>
        r.node !== request.node && lotStatus(r, now).usable && receivedStaffCapacity(r, request.requiredSkills, held(r), { now }) >= request.staffQuantity), execution) >= request.staffQuantity));
    const need = extra?.need ? await store.get(org, "need", extra.need, false) : null;
    if (extra && need && need.building === request.building && need.type === extra.resourceType && need.quantity > (need.served ?? 0))
      return { ...base, versions: { ...versions, recoveryOperation: extra.id,
        recoveryVersion: extra.sourceSnapshot?.version ?? extra.version, needVersion: need.version },
        readyToDraft: true, stage: "recover_crew_vehicle", references: [row.id, extra.id, need.id],
        actions: [{ type: "cancel", owner: org, dependsOn: [], params: { id: extra.id } }],
        note: "All receiver trucks are held by arrived cargo. Review returning one additional own delivery, preserving the original target cargo. Wait for actual returned stock and idle transport before planning a crew trip; remaining demand stays visible." };
  }
  return { ...base, versions, missing: [{ type: "available_qualified_receiver_crew", quantity: request.staffQuantity,
    requiredSkills: request.requiredSkills }], note: "No currently received eligible onsite crew or feasible qualified crew trip. Preserve arrived cargo; arrival does not certify delivery." };
}

export async function validateUnloadingAction(store, org, action, { excludeProposal = null, held = 0 } = {}) {
  const p = action.params, row = await requestFor(store, org, p.operation), request = rawRequest(row);
  check(action.owner === org && request?.receiverOrg === org, "UNLOAD_OWNER", "Only the received receiver owner can authorize unloading.", 403);
  check(row?.confirmedBySource === true && ["waiting_for_crew", "inconclusive"].includes(request.state) && request.received === 0,
    "UNLOAD_STATE", "Receive the original delivery's current waiting request before unloading.", 409);
  check(p.requestVersion === request.version && p.sourceVersion === request.operationVersion && p.targetVersion === request.targetVersion &&
    p.deliveryQuantity === request.deliveryQuantity && p.quantity === request.staffQuantity,
    "UNLOAD_CHANGED", "The original delivery, quantity, site or crew request changed. Recheck the exact request.", 409);
  const site = await store.get(org, "facility", request.building, false), r = await store.get(org, "resource", p.staff, false);
  check(site && (site.ownerOrg ?? request.receiverOrg) === org && site.sourceVersion === p.targetVersion && site.node === request.node,
    "UNLOAD_SITE", "The received receiver site or version is no longer current.", 409);
  check(r?.owner === org && r.type === "staff" && r.node === request.node,
    "UNLOAD_CREW_LOCATION", "An owned receiver crew must physically arrive onsite before unloading.", 409);
  const now = await receivedSourceNow(store, org), execution = await receivedExecutionPolicy(store, org),
    command = execution?.delivery?.commandNominalLatencyMs,
    workAt = integer(command) && Number.isFinite(now) ? now + command : null, useAt = workAt === null ? null : workAt + request.workMs,
    queue = await responseQueue(store, org, { excludeProposal, limit: 2000 }),
    reserved = queue.planningHolds.filter(h => h.owner === org && h.resource === r.id).reduce((n,h) => n + h.quantity, 0) + held;
  check(integer(command), "UNLOAD_TIMING", "Receive command timing before reviewing the finite crew work.", 409);
  check(lotStatus(r, now, useAt).usable, "SUPPLY_EXPIRED", "The received crew is unavailable because of a declared condition or expiry.", 409);
  check(receivedStaffCalendar(r, { now, workAt, useAt }).usable,
    "STAFF_CALENDAR", "The received staff window cannot cover this finite unloading work.", 409);
  check(receivedStaffCapacity(r, request.requiredSkills, reserved, { now, workAt, useAt }) >= p.quantity,
    "UNLOAD_CREW_CAPACITY", "The required qualified crew is reserved, protected or unavailable.", 409);
  return { type: "unloading", state: "checked", request: row.id, originalOperation: p.operation,
    requestVersion: p.requestVersion, sourceVersion: p.sourceVersion, targetVersion: p.targetVersion,
    staffVersion: r.version, quantity: p.quantity, deliveryQuantity: p.deliveryQuantity, nominalWorkStartsAt: workAt, nominalWorkEndsAt: useAt };
}

export async function prepareUnloading(domain, store, actor, input, key) {
  const plan = await unloadingPlan(store, actor.org, input.operation);
  check(plan.readyToDraft && input.checkpoint === unloadingCheckpoint(plan), "UNLOAD_CHANGED", "The received crew plan changed or is pending. Refresh it before preparing owner review.", 409);
  const draft = { title: input.title ?? "Finish the arrived delivery with a receiver crew",
    summary: plan.note, benefit: input.benefit ?? "Complete the original delivery after finite qualified unloading work",
    rationale: input.rationale ?? "This plan preserves existing cargo and requires owner review; it does not claim receipt before work finishes.",
    references: plan.references, actions: plan.actions, conditions: [], alternatives: [] };
  await validatePlan(store, actor.org, draft);
  const proposal = await domain.propose(actor, draft, key);
  await store.upsert(actor.org, "proposal", proposal.id, { unloadingOperation: input.operation,
    unloadingPlanCheckpoint: unloadingCheckpoint(plan), unloadingStage: plan.stage });
  return await store.get(actor.org, "proposal", proposal.id);
}
