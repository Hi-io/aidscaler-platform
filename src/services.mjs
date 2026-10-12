import { check } from "./errors.mjs";
import { assessmentCurrent } from "./assessment-receipts.mjs";
import { responseQueue } from "./response-policy.mjs";
import { effectiveNeed } from "./response-receipts.mjs";

const ACTIVE_PROPOSALS = new Set(["awaiting_review", "needs_clarification", "conditionally_authorized", "authorized", "executing", "awaiting_partner"]);
const PHYSICAL_COMPLETE = new Set(["completed", "received", "service"]);

// Received receipts are a watermark for requesting fresher service state, not
// permission to treat historically delivered stock as currently available.
function provisioningReceipts(operations, building) {
  const latest = new Map();
  for (const row of operations) {
    const source = row.sourceSnapshot ?? row;
    if (row.confirmedBySource !== true || !PHYSICAL_COMPLETE.has(row.state) ||
      source.type !== "delivery" || source.need || source.building !== building ||
      !Number.isFinite(source.received) || source.received <= 0 ||
      !Number.isFinite(source.times?.received)) continue;
    const key = JSON.stringify([row.owner ?? source.org ?? row.org, row.sourceId ?? source.id ?? row.id]);
    const old = latest.get(key);
    if (!old || (row.sourceObservedAt ?? source.observedAt ?? 0) >=
      (old.sourceObservedAt ?? old.sourceSnapshot?.observedAt ?? old.observedAt ?? 0)) latest.set(key, row);
  }
  return [...latest.values()];
}

/** Prepare only the finite, owner-approved physical assessment. An incomplete
 * assessment cannot be used to draft activation. The same helper is available
 * to a competent conventional planner. */
export async function assessmentPlan(store, org, building, { peers, validForMs = 21600000 } = {}) {
  check(Number.isSafeInteger(validForMs) && validForMs >= 1000 && validForMs <= 86400000,
    "ASSESSMENT_TTL", "Assessment validity must be between one second and one day.");
  const facility = await store.get(org, "facility", building, false),
    sourceNow = (await store.get(org, "source", "simulator", false))?.simulatedAt ?? 0,
    inspections = (await store.list(org, "verification", 2000)).filter(v => v.target === "building" && v.entity === building),
    current = inspections.find(v => assessmentCurrent(v, facility, sourceNow));
  const base = { building, purpose: "facility_safety", sourceNow, readyToDraft: false, actions: [], references: facility ? [building] : [], ownerApprovals: [], missing: [], pending: [] };
  if (!facility || !Number.isSafeInteger(facility.sourceVersion))
    return { ...base, missing: [{ type: "facility_metadata", quantity: 1 }],
      note: "Receive the site's current metadata through a clarification first. A location on a public map is not a safety assessment." };
  check(["shelter", "plant"].includes(facility.use) && facility.capacity > 0,
    "FACILITY_PURPOSE", "An assessment needs an eligible service site with useful capacity.");
  if (current) return { ...base, satisfied: true, assessment: current.id,
    references: [building, current.id], note: "A current competent physical assessment has already reached this organization." };
  const pending = inspections.filter(v => !["completed", "inconclusive", "timeout", "failed", "cancelled"].includes(v.state) &&
    v.method === "field" && v.purpose === "facility_safety" &&
    (v.targetVersion === undefined || v.targetVersion === facility.sourceVersion));
  const openProposals = (await store.list(org, "proposal", 2000)).filter(p =>
    ["awaiting_review", "needs_clarification", "conditionally_authorized", "authorized", "executing", "awaiting_partner"].includes(p.state));
  const proposals = openProposals.filter(p =>
    !["completed", "cancelled", "rejected", "requires_review", "repaired"].includes(p.state) &&
    p.actions?.some(a => a.type === "verify" && a.params.id === building && a.params.targetVersion === facility.sourceVersion));
  if (pending.length || proposals.length) return { ...base,
    pending: [...pending.map(v => ({ inspection: v.id, owner: v.sourceOwner ?? v.org, state: v.state })),
      ...proposals.map(p => ({ proposal: p.id, state: p.state }))],
    note: "The current assessment is pending. Do not allocate a second crew or assume a positive result." };
  const queue = await responseQueue(store, org, { limit: 2000 }),
    holds = [...queue.planningHolds];
  for (const p of openProposals) for (const [index, action] of p.actions.entries()) {
    if (action.type !== "verify") continue;
    const receipt = p.executionResults?.find(r => r.index === index),
      i = inspections.find(i => i.id === receipt?.result?.id || i.sourceId === receipt?.partnerResult?.id);
    if (i && ["completed", "inconclusive", "timeout", "failed", "cancelled"].includes(i.state)) continue;
    holds.push({ owner: action.owner, resource: action.params.staff,
      vehicle: action.params.vehicle, quantity: i?.staff ? 0 : 1 });
  }
  const offers = (await store.list(org, "peer_offer", 2000)).filter(o =>
    o.active && o.expiresAt > Date.now() && (!peers || peers.some(p => p.org === o.from))),
    resources = [...(await store.list(org, "resource", 2000)).filter(r => r.owner === org)
      .map(r => ({ ...r, available: Math.max(0, r.quantity - (r.reserved ?? 0) - (r.floor ?? 0)), evidence: r.id })),
      ...offers.filter(o => o.kind === "resource").map(o => ({ ...o.projection, owner: o.from, evidence: o.id }))],
    vehicles = [...(await store.list(org, "vehicle", 2000)).filter(v => v.owner === org).map(v => ({ ...v, evidence: v.id })),
      ...offers.filter(o => o.kind === "vehicle").map(o => ({ ...o.projection, owner: o.from, evidence: o.id }))];
  const choices = resources.filter(r => r.type === "staff" &&
      r.available - holds.filter(h => h.owner === r.owner && h.resource === r.id).reduce((s, h) => s + h.quantity, 0) >= 1 &&
      r.qualifications?.includes("field_assessment"))
    .map(r => ({ resource: r, vehicle: vehicles.find(v => v.owner === r.owner && ["idle", "arrived"].includes(v.state) &&
      !holds.some(h => h.owner === v.owner && h.vehicle === v.id)) }))
    .filter(c => c.vehicle).sort((a, b) => Number(b.resource.owner === org) - Number(a.resource.owner === org) || a.resource.owner.localeCompare(b.resource.owner));
  if (!choices.length) return { ...base, missing: [{ type: "qualified_mobile_field_assessor", quantity: 1 }],
    note: "Receive a consented offer for qualified field staff and an available crew vehicle. Headcount or radio confirmation is insufficient." };
  const { resource, vehicle } = choices[0];
  return { ...base, readyToDraft: true, actions: [{ type: "verify", owner: resource.owner, dependsOn: [], params: {
    target: "building", id: building, method: "field", purpose: "facility_safety", reportTo: org,
    staff: resource.id, vehicle: vehicle.id,
    targetVersion: facility.sourceVersion, validForMs,
  } }], references: [building, resource.evidence, vehicle.evidence], ownerApprovals: [...new Set([org, resource.owner])],
    crew: { owner: resource.owner, resource: resource.id, vehicle: vehicle.id },
    offerVersions: offers.filter(o => [resource.evidence, vehicle.evidence].includes(o.id))
      .map(o => ({ id: o.id, version: o.version, permissionVersion: o.permissionVersion })),
    note: "The responsible organization and crew owner approve independently. The owner source assigns qualified staff, real road travel and field work; activation waits for a current received assessment." };
}

/** Build a checked dependency draft from RECEIVED inspections and consented
 * owner projections. This is a formal feasibility aid, not LLM discovery and
 * never activation or authorization. Other owners still approve their steps. */
export async function servicePlan(store, org, building, { needId, peers, excludeProposal = null, refreshFacility } = {}) {
  const facility = await store.get(org, "facility", building, false);
  check(
    facility,
    "FACILITY",
    "Read the facility location and request its inspection first.",
  );
  check(
    ["shelter", "plant"].includes(facility.use) && facility.capacity > 0,
    "FACILITY_PURPOSE",
    "This assessed location is not a usable service facility. A demand location is not automatically a shelter. Find an eligible candidate site in the actor-visible map and inspect it.",
  );
  const inspections = (await store.list(org, "verification", 2000)).filter(
    (v) =>
      v.target === "building" &&
      v.entity === building &&
      v.state === "completed",
  );
  const sourceNow = (await store.get(org, "source", "simulator", false))?.simulatedAt ?? 0;
  const assessment = inspections.filter(v => assessmentCurrent(v, facility, sourceNow)).sort(
    (a, b) =>
      (b.completedAt ?? b.observedAt ?? b.at ?? 0) -
      (a.completedAt ?? a.observedAt ?? a.at ?? 0),
  )[0];
  const safe = facility.safe === true && !!assessment;
  const operations = await store.list(org, "operation", 10000),
    receipts = provisioningReceipts(operations, building),
    statusAt = facility.statusObservedAt ?? facility.sourceSnapshot?.statusObservedAt ??
      facility.at ?? facility.sourceSnapshot?.at ?? -1,
    afterReceiptAt = Math.max(-1, ...receipts.map(r => (r.sourceSnapshot ?? r).times.received)),
    receivedReferences = receipts.map(r => r.id),
    queue = await responseQueue(store, org, { excludeProposal, limit: 2000 }),
    openProposals = (await store.list(org, "proposal", 2000)).filter(p =>
      p.id !== excludeProposal && ACTIVE_PROPOSALS.has(p.state)),
    pendingService = openProposals.filter(p => p.actions?.some(a =>
      a.type === "activate" && a.params.building === building ||
      a.type === "dispatch" && !a.params.need && a.params.building === building)),
    base = { building, service: facility.use, readyToDraft: false, actions: [],
      references: [building, ...receivedReferences, ...(assessment ? [assessment.id] : [])],
      missing: [], pending: [], waitReceipt: false,
      assessment: { current: safe, id: assessment?.id ?? null, sourceNow },
      requirements: facility.dependencies ?? assessment?.result?.dependencies,
      offerVersions: [], ownerApprovals: [], affectedNeeds: [] };
  if (facility.state !== "operating" && pendingService.length)
    return { ...base, waitReceipt: true,
      pending: pendingService.map(p => ({ proposal: p.id, state: p.state, building })),
      note: "This site's provisioning or activation already has an owner-reviewed workflow. Await its physical receipts or a material failure; do not dispatch the same supplies or authorize a second activation." };
  if (afterReceiptAt > statusAt) {
    const refreshRequest = { target: "facility", id: building, afterReceiptAt };
    if (refreshFacility) {
      await refreshFacility(refreshRequest);
      return servicePlan(store, org, building, { needId, peers, excludeProposal });
    }
    return { ...base, waitReceipt: true, refreshRequest,
      pending: [{ type: "current_facility_status", afterReceiptAt, statusAt }],
      note: "New source-confirmed provisioning receipts arrived after this facility snapshot. Request current facility status before reusing stock, activating or compiling replacement work. Ordinary need deliveries are consumed aid, not service provisions." };
  }
  const dependencies =
    facility.dependencies ?? assessment?.result?.dependencies;
  check(
    dependencies && facility.node,
    "FACILITY_UNCHECKED",
    "A received assessment must describe dependencies and location.",
  );
  const offers = (await store.list(org, "peer_offer", 2000)).filter(
    (o) => o.active && o.expiresAt > Date.now() && (!peers || peers.some((p) => p.org === o.from)),
  );
  const resources = [
    ...(await store.list(org, "resource", 2000))
      .filter((r) => r.owner === org)
      .map((r) => ({
        ...r,
        available: Math.max(0, r.quantity - (r.reserved ?? 0) - (r.floor ?? 0)),
        evidence: r.id,
      })),
    ...offers
      .filter((o) => o.kind === "resource")
      .map((o) => ({
        ...o.projection,
        owner: o.from,
        available: o.projection.available ?? 0,
        evidence: o.id,
      })),
  ];
  const vehicles = [
    ...(await store.list(org, "vehicle", 2000))
      .filter((v) => v.owner === org)
      .map((v) => ({ ...v, evidence: v.id })),
    ...offers
      .filter((o) => o.kind === "vehicle")
      .map((o) => ({ ...o.projection, owner: o.from, evidence: o.id })),
  ].filter((v) => ["idle", "arrived"].includes(v.state) &&
    !queue.planningHolds.some(h => h.owner === v.owner && h.vehicle === v.id));
  const actions = [],
    missing = [],
    references = new Set([building, ...receivedReferences]);
  if (assessment) references.add(assessment.id);
  const usedStock = new Map(),
    lastVehicle = new Map();
  const scopedKey = (r) => JSON.stringify([r.owner, r.id]);
  // Startup dependencies do not become a new dispatch merely because an
  // operating shelter has consumed some of its initial water. Replenishment is
  // a separate received demand; the source can also report a closed service.
  for (const [type, required] of Object.entries(facility.state === "operating" ? {} : dependencies)) {
    let remaining = Math.max(0, required - (facility.provisioned?.[type] ?? 0));
    for (const r of resources.filter((r) => r.type === type)) {
      if (type === "staff" && (facility.requiredStaffSkills ?? assessment?.result?.requiredStaffSkills ?? []).some((skill) => !r.qualifications?.includes(skill))) continue;
      const power = facility.requiredPower ?? assessment?.result?.requiredPower;
      if (
        type === "energy" &&
        power &&
        (r.compatibility?.connector !== power.connector ||
          r.compatibility?.powerKw < power.powerKw)
      )
        continue;
      for (const v of vehicles.filter((v) => v.owner === r.owner)) {
        const quantity = Math.floor(
          Math.min(
            remaining,
            r.available - (usedStock.get(scopedKey(r)) ?? 0) - queue.planningHolds
              .filter(h => h.owner === r.owner && h.resource === r.id)
              .reduce((sum, h) => sum + h.quantity, 0),
            v.capacity ?? 0,
          ),
        );
        if (quantity <= 0) continue;
        const previous = lastVehicle.get(scopedKey(v)),
          index = actions.length;
        actions.push({
          type: "dispatch",
          owner: r.owner,
          params: {
            resource: r.id,
            vehicle: v.id,
            quantity,
            building,
            destination: facility.node,
          },
          dependsOn: previous === undefined ? [] : [previous],
        });
        usedStock.set(scopedKey(r), (usedStock.get(scopedKey(r)) ?? 0) + quantity);
        lastVehicle.set(scopedKey(v), index);
        references.add(r.evidence);
        references.add(v.evidence);
        remaining -= quantity;
        if (!remaining) break;
      }
      if (!remaining) break;
    }
    if (remaining) missing.push({ type, quantity: remaining });
  }
  if (!safe) missing.push({ type: "current_safety_assessment", quantity: 1 });
  if (!missing.length) {
    const activation = facility.state === "operating" ? null : actions.length;
    if (activation !== null) actions.push({
      type: "activate",
      owner: facility.ownerOrg ?? org,
      params: { building, permit: true },
      dependsOn: actions.map((_, i) => i),
    });
    if (facility.use === "shelter") {
      let places = Math.max(
        0,
        (facility.capacity ?? 0) - (facility.occupancy ?? 0),
      );
      const needs = (await store.list(org, "need", 2000)).map(n => effectiveNeed(n, operations)).filter(
        (n) =>
          n.type === "shelter" &&
          (!needId || n.id === needId) &&
          n.building !== building &&
          n.quantity > (n.served ?? 0),
      );
      for (const n of needs) {
        let remaining = Math.min(
          places,
          queue.rows.find(row => row.id === n.id)?.planningOutstanding ?? 0,
        );
        for (const v of vehicles.filter(
          (v) => v.owner === org && v.seats > 0,
        )) {
          // Serial trips reuse a finite owned vehicle; later steps are gated by
          // actual passenger receipt, never an assumed instant round trip.
          for (
            let trip = 0;
            trip < 10 && remaining > 0 && actions.length < 30;
            trip++
          ) {
            const quantity = Math.min(remaining, v.seats),
              previous = lastVehicle.get(scopedKey(v)),
              index = actions.length;
            actions.push({
              type: "evacuate",
              owner: org,
              params: {
                from: n.building,
                to: building,
                vehicle: v.id,
                quantity,
              },
              dependsOn: [
                ...new Set([
                  ...(activation === null ? [] : [activation]),
                  ...(previous === undefined ? [] : [previous]),
                ]),
              ],
            });
            lastVehicle.set(scopedKey(v), index);
            references.add(n.id);
            references.add(v.evidence);
            places -= quantity;
            remaining -= quantity;
          }
        }
      }
    }
  }
  return {
    building,
    service: facility.use,
    readyToDraft: !missing.length && actions.length > 0,
    actions,
    references: [...references],
    missing,
    requirements: dependencies,
    affectedNeeds: [...new Set(actions.flatMap((a) => a.params.need ? [a.params.need] :
      a.type === "evacuate" ? queue.rows.filter(n => n.type === "shelter" && n.building === a.params.from).map(n => n.id) : []))],
    pending: queue.planningHolds.filter(h => h.needIds.some(id => queue.rows.find(n => n.id === id)?.type === "shelter")),
    waitReceipt: !actions.length && queue.planningHolds.some(h => h.needIds.some(id => queue.rows.find(n => n.id === id)?.type === "shelter")),
    offerVersions: offers.filter((o) => references.has(o.id)).map((o) => ({ id: o.id, version: o.version, permissionVersion: o.permissionVersion })),
    ownerApprovals: [...new Set(actions.map((a) => a.owner))],
    assessment: { current: safe, id: assessment?.id ?? null, sourceNow,
      ...(safe ? {} : { next: "plan_assessment" }) },
    note: "Quantities and compatible equipment are sourced. Routes and each owner authorization are checked before execution. Operating service requires physical delivery and a received facility status.",
  };
}
