import { check } from "./errors.mjs";
import { validateUnloadingAction, unloadingPlan, unloadingCheckpoint } from "./unloading.mjs";
import { compareNeeds, outstanding } from "./response-policy.mjs";
import { assessmentCurrent } from "./assessment-receipts.mjs";
import { receivedStaffCapacity, receivedStaffCalendar } from "./staff-capacity.mjs";
import { receivedVehicleWeight } from "./received-vehicle-weight.mjs";
import { receivedVehicleCalendar } from "./received-vehicle-calendar.mjs";
import { receivedCargoProfile, receivedCargoCapacity, assertReceivedCargoCapacity, assertReceivedPassengerCapacity } from "./received-cargo.mjs";
import { receivedUsableQuantity, lotStatus, receivedSourceNow, nominalServiceAt } from "./lot-capacity.mjs";
import {
  dispatchReservationEstimate,
  receivedExecutionPolicy,
  validateDispatchTtl,
} from "./reservation-policy.mjs";
function staffTripEnd(now, pickup, delivery, execution, setupRequired = false) {
  const timing = execution?.delivery,
    setupMs = setupRequired ? execution?.service?.setupMs : 0;
  if (![now, pickup?.seconds, delivery?.seconds, timing?.loadMs,
    timing?.unloadMs, timing?.commandNominalLatencyMs, setupMs]
    .every(value => Number.isFinite(value) && value >= 0)) return null;
  return now + Math.ceil((pickup.seconds + delivery.seconds) * 1000) +
    timing.loadMs + timing.unloadMs + timing.commandNominalLatencyMs + setupMs;
}
export function shortestRoute(map, from, to, vehicle = {}, observed = {}) {
  if (from === to)
    return { nodes: [from], distanceM: 0, seconds: 0, unknownEdges: [] };
  const edges = Array.isArray(map?.roads)
      ? map.roads
      : Object.values(map?.edges ?? {}),
    adj = new Map();
  for (const e of edges) {
    const state = observed[e.id] ?? e;
    if (
      state.open === false ||
      (state.waterDepth ?? 0) > (vehicle.maxWaterDepth ?? Infinity) ||
      (e.maxWeight ?? Infinity) < (vehicle.weightKg ?? 0)
    )
      continue;
    const a = adj.get(e.from) ?? [];
    a.push({ ...e, ...state });
    adj.set(e.from, a);
  }
  const q = [
      { id: from, cost: 0, nodes: [from], distanceM: 0, unknownEdges: [] },
    ],
    seen = new Set();
  while (q.length) {
    q.sort((a, b) => a.cost - b.cost);
    const current = q.shift();
    if (current.id === to)
      return {
        nodes: current.nodes,
        distanceM: current.distanceM,
        seconds: current.cost,
        unknownEdges: current.unknownEdges,
      };
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    for (const e of adj.get(current.id) ?? []) {
      const unknown = observed[e.id]?.open == null && e.open == null;
      const seconds =
        Math.ceil(((e.lengthM ?? 100) /
          (Math.min(e.speedMps ?? 8, vehicle.speedMps ?? 15) || 1)) * 1000) / 1000 +
        (Number.isFinite(e.congestionMs) && e.congestionMs > 0 ? e.congestionMs / 1000 : 0);
      q.push({
        id: e.to,
        cost: current.cost + seconds,
        nodes: [...current.nodes, e.to],
        distanceM: current.distanceM + (e.lengthM ?? 100),
        unknownEdges: [...current.unknownEdges, ...(unknown ? [e.id] : [])],
      });
    }
  }
  return null;
}
export function allocationPlan({
  needs,
  resources,
  vehicles,
  operations = [],
  now = 0,
  map,
  observedRoads = {},
  executionPolicy = null,
  policy = { order: "priority_then_deadline" },
}) {
  const ownedKey = (record) => JSON.stringify([record.owner, record.id]);
  const terminal = new Set([
      "failed",
      "cancelled",
      "completed",
      "received",
      "service",
    ]),
    activeVehicles = new Set(
      operations
        .filter(
          (o) => o.vehicle && (o.owner ?? o.org) && !terminal.has(o.state),
        )
        .map((o) => ownedKey({ owner: o.owner ?? o.org, id: o.vehicle })),
    ),
    hasMap = Boolean(map && (Array.isArray(map.roads) || map.edges)),
    routes = new Map(),
    calendarRefusals = [],
    staffCalendarRefusals = [],
    refusedStaffCalendars = new Set(),
    driverRefusals = [],
    refusedDrivers = new Set(),
    refusedCalendars = new Set();
  // This is a travel estimate from received topology/observations, never a
  // promise of service or knowledge of future traffic, loading or owner review.
  const routeFor = (vehicle, from, to, weightKg = vehicle.weightKg) => {
    if (typeof from !== "string" || typeof to !== "string") return null;
    const key = JSON.stringify([ownedKey(vehicle), from, to, weightKg]);
    if (!routes.has(key))
      routes.set(
        key,
        shortestRoute(map, from, to, { ...vehicle, weightKg }, observedRoads),
      );
    return routes.get(key);
  };
  const travelFor = (resource, vehicle, need, quantity) => {
    if (vehicle.driverAvailable === false) {
      const key = JSON.stringify([need.id, vehicle.owner, vehicle.id]);
      if (!refusedDrivers.has(key) && driverRefusals.length < 20) {
        refusedDrivers.add(key);
        driverRefusals.push({ need: need.id, owner: vehicle.owner,
          vehicle: vehicle.id, quantity, code: "VEHICLE_DRIVER",
          reason: "No driver available in the received vehicle report" });
      }
      return false;
    }
    const staffWindow = (pickup, delivery) => {
      if (resource.type !== "staff") return true;
      const useAt = staffTripEnd(now, pickup, delivery, executionPolicy),
        humanWindow = receivedStaffCalendar(resource, { now, workAt: useAt, useAt });
      if (!humanWindow.usable) {
        const key = JSON.stringify([need.id, resource.owner, resource.id, humanWindow.reason]);
        if (!refusedStaffCalendars.has(key) && staffCalendarRefusals.length < 20) {
          refusedStaffCalendars.add(key);
          staffCalendarRefusals.push({ need: need.id, owner: resource.owner,
            resource: resource.id, quantity, code: "STAFF_CALENDAR",
            reason: humanWindow.reason, humanWindow });
        }
        return false;
      }
      return quantity <= receivedStaffCapacity(resource, [], 0, { now, workAt: useAt, useAt });
    };
    if (!hasMap) return staffWindow(null, null) ? null : false;
    const destination =
        need.node ?? map.places?.find((p) => p.id === need.building)?.node,
      pickup = routeFor(vehicle, vehicle.node, resource.node),
      delivery = routeFor(
        vehicle,
        resource.node,
        destination,
        (vehicle.weightKg ?? 0) +
          quantity * receivedCargoProfile(resource, executionPolicy).massKgPerUnit,
      );
    if (!pickup || !delivery) return false;
    if (!staffWindow(pickup, delivery)) return false;
    const nextNode = vehicle.calendar?.nextCommitment?.node,
      returnRoute = nextNode ? routeFor(vehicle, destination, nextNode) : null,
      calendar = receivedVehicleCalendar(vehicle, {
        now, pickup, delivery, returnRoute, executionPolicy,
      });
    if (!calendar.usable) {
      const refusalKey = JSON.stringify([need.id, vehicle.owner, vehicle.id, quantity, calendar.reason]);
      if (!refusedCalendars.has(refusalKey) && calendarRefusals.length < 20) {
        refusedCalendars.add(refusalKey);
        calendarRefusals.push({ need: need.id, owner: vehicle.owner, vehicle: vehicle.id,
          quantity, code: "VEHICLE_CALENDAR", reason: calendar.reason,
          calendarVersion: vehicle.calendar?.version ?? null,
          availableAfter: vehicle.calendar?.availableAfter ?? null,
          availableUntil: vehicle.calendar?.availableUntil ?? null,
          nextCommitment: vehicle.calendar?.nextCommitment ?? null });
      }
      return false;
    }
    const seconds = pickup.seconds + delivery.seconds,
      distanceM = pickup.distanceM + delivery.distanceM,
      occupiedDistanceM = distanceM + (returnRoute?.distanceM ?? 0),
      fuelMl = Number.isFinite(vehicle.fuelMlPerKm)
        ? (occupiedDistanceM / 1000) * vehicle.fuelMlPerKm
        : null;
    if (
      (fuelMl !== null &&
        Number.isFinite(vehicle.fuel) &&
        fuelMl > vehicle.fuel) ||
      (Number.isFinite(vehicle.shiftEnd) &&
        now + seconds * 1000 > vehicle.shiftEnd)
    )
      return false;
    return {
      pickup,
      delivery,
      ...(calendar.declared ? { calendar, returnRoute, occupiedDistanceM } : {}),
      seconds,
      distanceM,
      fuelMl,
      at: now,
      unknownEdges: [
        ...new Set([...pickup.unknownEdges, ...delivery.unknownEdges]),
      ],
    };
  };
  const stock = new Map(
      resources.map((r) => [
        ownedKey(r),
        receivedUsableQuantity(r, now),
      ]),
    ),
    usedVehicles = new Set(),
    allocations = [],
    unserved = [];
  for (const need of [...needs].sort((a, b) => compareNeeds(a, b, policy))) {
    let remaining = outstanding(need, operations);
    if (!remaining) continue;
    while (remaining > 0) {
      const candidates = resources
        .filter((r) => r.type === need.type && stock.get(ownedKey(r)) > 0)
        .flatMap((resource) =>
          vehicles
            .filter(
              (v) =>
                v.owner === resource.owner &&
                !usedVehicles.has(ownedKey(v)) &&
                !activeVehicles.has(ownedKey(v)) &&
                ["idle", "arrived"].includes(v.state),
            )
            .map((vehicle) => {
              const quantity = Math.floor(
                Math.min(
                  remaining,
                  stock.get(ownedKey(resource)),
                  receivedCargoCapacity(vehicle, resource, executionPolicy),
                ),
              );
              return {
                resource,
                vehicle,
                quantity,
                travel:
                  quantity > 0
                    ? travelFor(resource, vehicle, need, quantity)
                    : false,
              };
            }),
        )
        .map((candidate) => ({
          ...candidate,
          reservationEstimate: dispatchReservationEstimate(
            candidate.travel?.pickup,
            executionPolicy,
          ),
        }))
        .filter(
          (candidate) =>
            candidate.travel !== false &&
            (!candidate.vehicle.calendar || Boolean(candidate.travel)) &&
            lotStatus(candidate.resource, now, candidate.travel ? now +
              Math.ceil(candidate.travel.seconds * 1000) + (executionPolicy?.delivery?.loadMs ?? 0) +
              (executionPolicy?.delivery?.unloadMs ?? 0) + (executionPolicy?.delivery?.commandNominalLatencyMs ?? 0) : now).usable &&
            candidate.reservationEstimate.recommendedTtlMs <=
              candidate.reservationEstimate.maxTtlMs,
        );
      if (hasMap)
        candidates.sort(
          (a, b) =>
            a.travel.seconds - b.travel.seconds ||
            ownedKey(a.resource).localeCompare(ownedKey(b.resource)) ||
            ownedKey(a.vehicle).localeCompare(ownedKey(b.vehicle)),
        );
      if (!candidates.length) break;
      const { resource, vehicle, quantity, travel, reservationEstimate } =
        candidates[0];
      allocations.push({
        need: need.id,
        resource: resource.id,
        vehicle: vehicle.id,
        quantity,
        owner: resource.owner,
        needsRouteCheck: true,
        ttlMs: reservationEstimate.recommendedTtlMs,
        reservationEstimate,
        ...(travel ? { travelEstimate: travel } : {}),
      });
      stock.set(ownedKey(resource), stock.get(ownedKey(resource)) - quantity);
      usedVehicles.add(ownedKey(vehicle));
      remaining -= quantity;
      if (!remaining) break;
    }
    if (remaining)
      unserved.push({
        need: need.id,
        remaining,
        unit: need.unit,
        reason: "No uncommitted eligible capacity in this planning round",
        ...([...calendarRefusals, ...driverRefusals, ...staffCalendarRefusals].some(r => r.need === need.id)
          ? { blockingReasons: [...calendarRefusals, ...driverRefusals, ...staffCalendarRefusals].filter(r => r.need === need.id) } : {}),
      });
  }
  // Admission above preserves the approved need order and exact native-unit
  // quantities. Improve only this concurrent batch's fleet assignment: greedy
  // nearest-first choices can send the second truck on a long avoidable detour.
  // No unreceived need, future availability or observer road state enters here.
  const assignment = {
    swaps: 0,
    cycles: 0,
    beforeSeconds: allocations.reduce(
      (n, a) => n + (a.travelEstimate?.seconds ?? 0),
      0,
    ),
    afterSeconds: null,
    objective:
      "shorter concurrent received travel, unchanged priority admission and quantities",
  };
  if (hasMap) {
    const needById = new Map(needs.map((n) => [n.id, n])),
      resourceByKey = new Map(resources.map((r) => [ownedKey(r), r])),
      vehicleByKey = new Map(vehicles.map((v) => [ownedKey(v), v]));
    const changed = (allocation, supply) => {
      const resource = resourceByKey.get(
          ownedKey({ owner: supply.owner, id: supply.resource }),
        ),
        vehicle = vehicleByKey.get(
          ownedKey({ owner: supply.owner, id: supply.vehicle }),
        ),
        need = needById.get(allocation.need),
        quantity = allocation.quantity;
      if (
        !resource ||
        !vehicle ||
        resource.type !== need.type ||
        quantity > receivedCargoCapacity(vehicle, resource, executionPolicy)
      )
        return null;
      const travel = travelFor(resource, vehicle, need, quantity);
      if (!travel) return null;
      if (!lotStatus(resource, now, nominalServiceAt(now, travel.pickup, travel.delivery,
        executionPolicy)).usable) return null;
      const reservationEstimate = dispatchReservationEstimate(
        travel.pickup,
        executionPolicy,
      );
      if (reservationEstimate.recommendedTtlMs > reservationEstimate.maxTtlMs)
        return null;
      // Do not introduce or increase a known missed useful window to shorten
      // another trip. Unknown windows remain unknown, never invented deadlines.
      if (Number.isFinite(need.deadline)) {
        if (![now, executionPolicy?.delivery?.loadMs,
          executionPolicy?.delivery?.unloadMs,
          executionPolicy?.delivery?.commandNominalLatencyMs]
          .every(value => Number.isFinite(value) && value >= 0)) return null;
        const serviceMs = (t) =>
          now +
          t.seconds * 1000 +
          (executionPolicy?.delivery?.loadMs ?? 0) +
          (executionPolicy?.delivery?.unloadMs ?? 0) +
          (executionPolicy?.delivery?.commandNominalLatencyMs ?? 0);
        if (
          Math.max(0, serviceMs(travel) - need.deadline) >
          Math.max(0, serviceMs(allocation.travelEstimate) - need.deadline)
        )
          return null;
      }
      return {
        ...allocation,
        owner: supply.owner,
        resource: supply.resource,
        vehicle: supply.vehicle,
        travelEstimate: travel,
        reservationEstimate,
        ttlMs: reservationEstimate.recommendedTtlMs,
      };
    };
    for (let pass = 0; pass < allocations.length; pass++) {
      let improved = false;
      for (let i = 0; i < allocations.length; i++)
        for (let j = i + 1; j < allocations.length; j++) {
          const a = allocations[i],
            b = allocations[j],
            ra = ownedKey({ owner: a.owner, id: a.resource }),
            rb = ownedKey({ owner: b.owner, id: b.resource }),
            na = changed(a, b),
            nb = changed(b, a);
          if (
            !na ||
            !nb ||
            na.travelEstimate.seconds + nb.travelEstimate.seconds >=
              a.travelEstimate.seconds + b.travelEstimate.seconds - 1e-8
          )
            continue;
          if (
            ra !== rb &&
            ((stock.get(ra) ?? 0) + a.quantity - b.quantity < 0 ||
              (stock.get(rb) ?? 0) + b.quantity - a.quantity < 0)
          )
            continue;
          if (ra !== rb) {
            stock.set(ra, stock.get(ra) + a.quantity - b.quantity);
            stock.set(rb, stock.get(rb) + b.quantity - a.quantity);
          }
          allocations[i] = na;
          allocations[j] = nb;
          assignment.swaps++;
          improved = true;
        }
      // Pair swaps can stop at a local minimum even when three already-admitted
      // deliveries can use less travel. Explore bounded three-way rotations,
      // preserving every admitted need/quantity and each owner's stock ledger.
      // This common deterministic compiler is also used by all reference arms.
      if (!improved && pass < 4) {
        const limit = Math.min(allocations.length, 24);
        for (let i = 0; i < limit; i++)
          for (let j = i + 1; j < limit; j++)
            for (let k = j + 1; k < limit; k++) {
              const positions = [i, j, k], before = positions.map(n => allocations[n]);
              for (const rotation of [[1, 2, 0], [2, 0, 1]]) {
                const after = before.map((a, n) => changed(a, before[rotation[n]]));
                if (after.some(a => !a) ||
                    after.reduce((n,a) => n + a.travelEstimate.seconds, 0) >=
                    before.reduce((n,a) => n + a.travelEstimate.seconds, 0) - 1e-8) continue;
                const delta = new Map();
                for (let n = 0; n < before.length; n++) {
                  const oldKey = ownedKey({owner: before[n].owner, id: before[n].resource}),
                    newKey = ownedKey({owner: after[n].owner, id: after[n].resource});
                  delta.set(oldKey, (delta.get(oldKey) ?? 0) + before[n].quantity);
                  delta.set(newKey, (delta.get(newKey) ?? 0) - after[n].quantity);
                }
                if ([...delta].some(([key, change]) => (stock.get(key) ?? 0) + change < 0)) continue;
                for (const [key, change] of delta) stock.set(key, stock.get(key) + change);
                positions.forEach((position,n) => allocations[position] = after[n]);
                assignment.cycles++;
                improved = true;
                break;
              }
            }
      }
      if (!improved) break;
    }
  }
  assignment.afterSeconds = allocations.reduce(
    (n, a) => n + (a.travelEstimate?.seconds ?? 0),
    0,
  );
  return {
    allocations,
    unserved,
    algorithm:
      "deterministic priority admission with bounded received fleet assignment",
    assignment,
    ...(calendarRefusals.length ? { calendarRefusals } : {}),
    ...(driverRefusals.length ? { driverRefusals } : {}),
    ...(staffCalendarRefusals.length ? { staffCalendarRefusals } : {}),
    routing: hasMap
      ? "received pickup and delivery travel estimates"
      : "no received map; no travel estimate",
    doesNotDispatch: true,
  };
}
export const SERVICE_RECIPES = {
  shelter: {
    requirements: [
      "safety_inspection",
      "owner_permission",
      "water",
      "sanitation",
      "staff",
      "energy",
      "transport",
    ],
  },
  water_plant: {
    requirements: [
      "safety_inspection",
      "owner_permission",
      "compatible_energy",
      "qualified_staff",
      "raw_water",
      "distribution",
    ],
  },
};
export function composeService({ service, offers, inspection, permit }) {
  const recipe = SERVICE_RECIPES[service];
  check(recipe, "SERVICE", "Unknown service recipe.");
  const fulfilled = new Map();
  if (inspection?.state === "completed" && inspection.result?.safe === true)
    fulfilled.set("safety_inspection", inspection);
  if (permit?.authorizedBy) fulfilled.set("owner_permission", permit);
  for (const offer of offers.filter(
    (o) => o.available > 0 && o.expiresAt > Date.now() && o.active !== false,
  )) {
    const purpose =
      offer.type === "energy" && offer.compatibility?.powerKw >= 10
        ? "compatible_energy"
        : offer.type;
    fulfilled.set(purpose, offer);
  }
  return {
    service,
    requirements: recipe.requirements.map((type) => ({
      type,
      fulfilled: fulfilled.has(type),
      evidence: fulfilled.get(type)?.id ?? null,
      owner: fulfilled.get(type)?.owner ?? null,
    })),
    ready: recipe.requirements.every((r) => fulfilled.has(r)),
    note: "A composed proposal is not a physical operating service.",
  };
}
export async function validateConditions(store, org, conditions) {
  const sourceNow = (await store.get(org, "source", "simulator", false))
    ?.simulatedAt;
  return Promise.all(
    conditions.map(async (c) => {
      let satisfied = false,
        evidenceId = null;
      if (c.type === "inspection") {
        const v = await store.get(org, "verification", c.id, false);
        satisfied = v?.state === "completed" && v.result?.safe !== false;
        if (v?.target === "building") {
          const facility = await store.get(org, "facility", v.entity, false);
          if (
            v.purpose === "facility_safety" ||
            ["shelter", "plant"].includes(facility?.use)
          )
            satisfied = assessmentCurrent(v, facility, sourceNow);
        }
        evidenceId = v?.id;
      }
      if (c.type === "resource") {
        const r = await store.get(org, "resource", c.id, false);
        check(
          r || !(await store.get(org, "vehicle", c.id, false)),
          "CONDITION_KIND",
          "A vehicle is not a stock resource. Use the vehicle condition type, or use prepare_allocation to reuse the already checked plan.",
        );
        satisfied =
          !!r &&
          (c.version === undefined || r.version === c.version) &&
          r.quantity - r.reserved - r.floor > 0;
        evidenceId = r?.id;
      }
      if (c.type === "vehicle") {
        const v = await store.get(org, "vehicle", c.id, false);
        satisfied =
          !!v &&
          v.driverAvailable !== false &&
          ["idle", "arrived"].includes(v.state) &&
          (c.version === undefined || v.version === c.version);
        evidenceId = v?.id;
      }
      if (c.type === "commitment") {
        const v = await store.get(org, "commitment", c.id, false);
        satisfied = v?.state === "confirmed" && v.expiresAt > Date.now();
        evidenceId = v?.id;
      }
      if (c.type === "approval") {
        const p = await store.get(org, "proposal", c.id, false);
        check(
          p,
          "APPROVAL_REFERENCE",
          "An approval condition must reference an existing received proposal. Do not invent an owner approval ID: each action owner already reviews its part through the partner workflow.",
        );
        satisfied = p?.state === "authorized" && !!p.authorization;
        evidenceId = p?.id;
      }
      if (c.type === "time")
        satisfied = c.expiresAt !== undefined && c.expiresAt > Date.now();
      if (c.type === "evidence") {
        const claim = await store.get(org, "claim", c.id, false);
        satisfied =
          claim?.state === "confirmed" &&
          (!claim.validUntil || claim.validUntil > Date.now());
        evidenceId = claim?.id;
      }
      // Owner consent and technical compatibility require an explicit verified check, not a model boolean.
      if (["owner", "compatibility"].includes(c.type)) {
        const v = await store.get(org, "verification", c.id, false);
        satisfied = v?.state === "completed" && v.result?.approved === true;
        evidenceId = v?.id;
      }
      return { ...c, satisfied: !!satisfied, evidenceId: evidenceId ?? null };
    }),
  );
}
export async function validatePlan(store, org, proposal) {
  if (proposal.unloadingOperation && proposal.unloadingPlanCheckpoint) {
    const current = await unloadingPlan(store, org, proposal.unloadingOperation, { excludeProposal: proposal.id });
    check(current.readyToDraft && unloadingCheckpoint(current) === proposal.unloadingPlanCheckpoint,
      "UNLOAD_CHANGED", "The received unloading continuation or recovery scope changed before owner review.", 409);
  }
  const checks = [],
    usedStock = new Map(),
    usedVehicles = new Set(),
    externalVehicles = new Set(),
    usedPlaces = new Map(),
    usedPeople = new Map();
  const active = (await store.list(org, "proposal", 2000)).filter(
    (p) =>
      p.id !== proposal.id &&
      ["authorized", "executing", "awaiting_partner"].includes(p.state),
  );
  for (const p of active)
    for (const [index, a] of p.actions.entries()) {
      if (
        a.owner !== org ||
        !["dispatch", "evacuate", "verify"].includes(a.type) ||
        p.executionResults?.some((r) => r.index === index && r.result)
      )
        continue;
      if (a.type === "verify") {
        usedStock.set(a.params.staff, (usedStock.get(a.params.staff) ?? 0) + 1);
        usedVehicles.add(a.params.vehicle); externalVehicles.add(a.params.vehicle);
        continue;
      }
      if (a.type === "evacuate") {
        usedPlaces.set(
          a.params.to,
          (usedPlaces.get(a.params.to) ?? 0) + a.params.quantity,
        );
        usedPeople.set(
          a.params.from,
          (usedPeople.get(a.params.from) ?? 0) + a.params.quantity,
        );
        usedVehicles.add(a.params.vehicle);
        externalVehicles.add(a.params.vehicle);
        continue;
      }
      usedStock.set(
        a.params.resource,
        (usedStock.get(a.params.resource) ?? 0) + (a.params.quantity ?? 0),
      );
      usedVehicles.add(a.params.vehicle);
      externalVehicles.add(a.params.vehicle);
    }
  for (const [index, a] of proposal.actions.entries()) {
    if (a.owner !== org) {
      checks.push({
        index,
        type: "owner",
        state: "requires_partner_authorization",
        owner: a.owner,
      });
      continue;
    }
    if (a.type === "unload") {
      checks.push({ index, ...await validateUnloadingAction(store, org, a, {
        excludeProposal: proposal.id ?? null,
        held: proposal.actions.slice(0, index).filter(previous => previous.owner === org &&
          (previous.type === "unload" && previous.params.staff === a.params.staff ||
           previous.type === "verify" && previous.params.staff === a.params.staff ||
           previous.type === "dispatch" && previous.params.resource === a.params.staff))
          .reduce((n, previous) => n + (previous.type === "verify" ? 1 : previous.params.quantity ?? 0), 0),
      }) });
      usedStock.set(a.params.staff, (usedStock.get(a.params.staff) ?? 0) + a.params.quantity);
    }
    if (a.type === "reroute") {
      const vehicle = await store.get(org, "vehicle", a.params.vehicle, false),
        operation = (await store.list(org, "operation", 10000)).find(
          (o) =>
            o.vehicle === a.params.vehicle &&
            o.confirmedBySource &&
            ![
              "failed",
              "cancelled",
              "received",
              "completed",
              "service",
            ].includes(o.state),
        ),
        map = (await store.get(org, "context", "geography", false))?.map,
        need = a.params.need
          ? await store.get(org, "need", a.params.need, false)
          : null,
        facility = a.params.building
          ? await store.get(org, "facility", a.params.building, false)
          : null;
      check(
        vehicle?.owner === org,
        "RESOURCE_OWNER",
        "Only a received vehicle's owner may authorize rerouting.",
        403,
      );
      check(vehicle.driverAvailable !== false, "VEHICLE_DRIVER",
        "The received vehicle report has no driver available. Refresh the owner's transport report before reviewing a new route.", 409);
      check(
        operation,
        "ACTIVE_OPERATION",
        "Rerouting requires a current source-confirmed trip, not a new stock allocation.",
        409,
      );
      check(
        map?.nodes?.some((n) => n.id === a.params.destination),
        "DESTINATION_LOCATION",
        "A reroute needs a received road node.",
      );
      check(
        !active.some((p) =>
          p.actions.some(
            (other) =>
              other.owner === org &&
              other.type === "reroute" &&
              other.params.vehicle === vehicle.id,
          ),
        ),
        "VEHICLE_CONFLICT",
        "Another reviewed reroute for this vehicle is still active.",
        409,
      );
      if (["inspection", "repair"].includes(operation.type)) {
        check(!need && !facility && a.params.destination === operation.destination,
          "DESTINATION", "An assessment or repair reroute must preserve its exact approved work site.", 409);
      } else if (["delivery", "transfer"].includes(operation.type) && operation.phase === "pickup") {
        const resource = await store.get(org, "resource", operation.resource, false);
        check(resource?.owner === org && resource.node && !need && !facility &&
          a.params.destination === resource.node &&
          (!vehicle.destination || vehicle.destination === resource.node),
          "DESTINATION", "An empty cargo pickup reroute must preserve the received stock location and the original aid destination.", 409);
      } else if (operation.type === "evacuation" && operation.phase === "pickup") {
        check(
          !need && !facility && a.params.destination === operation.destination,
          "DESTINATION",
          "An empty pickup reroute must preserve its assigned pickup and shelter.",
        );
      } else if (operation.type === "evacuation") {
        const ownReservation =
          operation.building === facility?.id ? operation.quantity : 0;
        check(
          facility?.state === "operating" &&
            facility.safe === true &&
            facility.node === a.params.destination &&
            facility.capacity -
              (facility.occupancy ?? 0) -
              (facility.reservedPlaces ?? 0) +
              ownReservation >=
              operation.quantity,
          "SHELTER_CAPACITY",
          "An evacuation reroute needs a safe operating shelter with available places.",
        );
      } else {
        check(
          a.params.destination === operation.destination ||
            (need &&
              need.type === operation.resourceType &&
              (need.node ??
                map.places?.find((b) => b.id === need.building)?.node) ===
                a.params.destination) ||
            (facility?.node === a.params.destination && facility.safe === true),
          "DESTINATION",
          "Changing a loaded delivery's destination requires matching received need or assessed facility evidence.",
        );
      }
      const roads = Object.fromEntries(
        (await store.list(org, "road", 5000)).map((e) => [e.id, e]),
      );
      const cargoResource = operation.resource
        ? await store.get(org, "resource", operation.resource, false) : null;
      const grossMass = receivedVehicleWeight(vehicle, operation, cargoResource);
      if (Number.isSafeInteger(vehicle.crewQuantity) && vehicle.crewQuantity > 0)
        assertReceivedPassengerCapacity(vehicle, vehicle.crewQuantity);
      if (["delivery", "transfer", "recovery", "evacuation"].includes(operation.type)) {
        const cargo = operation.type === "evacuation" ? { type: "staff" }
          : cargoResource ?? { type: operation.resourceType };
        if (receivedCargoProfile(cargo) && Number.isSafeInteger(operation.quantity) && operation.quantity > 0 &&
            !(operation.received >= operation.quantity))
          operation.type === "evacuation"
            ? assertReceivedPassengerCapacity(vehicle, operation.quantity - Math.max(0, operation.received ?? 0))
            : assertReceivedCargoCapacity(vehicle, cargo, operation.quantity - Math.max(0, operation.received ?? 0));
      }
      const route = shortestRoute(
        map,
        vehicle.node,
        a.params.destination,
        { ...vehicle, weightKg: grossMass.weightKg },
        roads,
      );
      check(
        route,
        "NO_KNOWN_ROUTE",
        "No received accessible route supports this reroute.",
        409,
      );
      let calendar = null;
      if (vehicle.calendar) {
        const executionPolicy = await receivedExecutionPolicy(store, org),
          sourceNow = await receivedSourceNow(store, org),
          pickupPhase = operation.phase === "pickup",
          supported = ["delivery", "transfer", "evacuation"].includes(operation.type);
        check(supported, "VEHICLE_CALENDAR", "Receive the remaining work and return timing before reviewing this vehicle's constrained reroute.", 409);
        let pickup = { seconds: 0, distanceM: 0 }, delivery = route,
          finalNode = a.params.destination;
        if (pickupPhase) {
          check(Number.isSafeInteger(operation.quantity) && operation.quantity > 0,
            "VEHICLE_LOAD_UNKNOWN", "Receive the assigned cargo or passenger quantity before checking the rest of this pickup trip.", 409);
          pickup = route;
          finalNode = operation.type === "evacuation"
            ? (await store.get(org, "facility", operation.building, false))?.node
            : operation.destination;
          const fullProfile = receivedCargoProfile(operation.type === "evacuation" ? { type: "staff" }
            : cargoResource ?? { type: operation.resourceType });
          check(fullProfile, "CARGO_PROFILE", "Receive the planned load's transport unit profile before checking this pickup reroute.", 409);
          const fullWeight = (vehicle.weightKg ?? 0) + operation.quantity * fullProfile.massKgPerUnit;
          delivery = finalNode ? shortestRoute(map, a.params.destination, finalNode,
            { ...vehicle, weightKg: fullWeight }, roads) : null;
        }
        const returnRoute = vehicle.calendar.nextCommitment?.node && finalNode
          ? shortestRoute(map, finalNode, vehicle.calendar.nextCommitment.node, vehicle, roads) : null,
          remainingExecution = executionPolicy ? { ...executionPolicy,
            delivery: { ...executionPolicy.delivery, ...(pickupPhase ? {} : { loadMs: 0 }) } } : null;
        calendar = receivedVehicleCalendar(vehicle, { now: sourceNow, pickup, delivery,
          returnRoute, executionPolicy: remainingExecution });
        check(calendar.usable, "VEHICLE_CALENDAR", "The remaining received trip and return cannot preserve this vehicle's availability window or next commitment.", 409);
        const requiredDistance = pickup.distanceM + delivery.distanceM + (returnRoute?.distanceM ?? 0);
        check((vehicle.fuel ?? Infinity) >= requiredDistance / 1000 * (vehicle.fuelMlPerKm ?? 0),
          "FUEL", "Fuel is insufficient for the remaining checked trip and return.", 409);
      }
      checks.push({
        index,
        type: "reroute",
        state: "checked",
        sourceOperation: operation.id,
        vehicleVersion: vehicle.version,
        operationVersion: operation.version,
        grossMass,
        ...(calendar ? { calendar } : {}),
        ...route,
      });
    }
    if (a.type === "verify") {
      const r = await store.get(org, "resource", a.params.staff, false),
        v = await store.get(org, "vehicle", a.params.vehicle, false),
        site = await store.get(org, "facility", a.params.id, false);
      check(r?.owner === org && v?.owner === org, "ASSESSOR_OWNER", "Only the crew owner can authorize its staff and vehicle.", 403);
      check(v.driverAvailable !== false, "VEHICLE_DRIVER", "The received assessment vehicle has no driver available.", 409);
      const assessmentCargo = assertReceivedPassengerCapacity(v, 1);
      const sourceNow = await receivedSourceNow(store, org),
        execution = await receivedExecutionPolicy(store, org),
        map = (await store.get(org, "context", "geography", false))?.map,
        roads = Object.fromEntries((await store.list(org, "road", 5000)).map(e => [e.id, e])),
        siteNode = site?.node ?? map?.places?.find(p => p.id === a.params.id)?.node,
        pickup = map && v.node && r.node ? shortestRoute(map, v.node, r.node, v, roads) : null,
        fieldTrip = map && r.node && siteNode ? shortestRoute(map, r.node, siteNode,
          { ...v, weightKg: (v.weightKg ?? 0) + assessmentCargo.massKgPerUnit }, roads) : null,
        fieldTiming = execution?.fieldAssessment,
        workAt = [sourceNow, pickup?.seconds, fieldTrip?.seconds,
          fieldTiming?.commandNominalLatencyMs].every(value => Number.isFinite(value) && value >= 0)
          ? sourceNow + Math.ceil((pickup.seconds + fieldTrip.seconds) * 1000) +
            fieldTiming.commandNominalLatencyMs : null,
        useAt = Number.isFinite(workAt) && Number.isFinite(fieldTiming?.inspectionMs) && fieldTiming.inspectionMs >= 0
          ? workAt + fieldTiming.inspectionMs : null,
        humanWindow = receivedStaffCalendar(r, { now: sourceNow, workAt, useAt });
      check(humanWindow.usable, "STAFF_CALENDAR", "The received crew's shift or rest window cannot cover this trip and field assessment. Receive current timing or choose another crew.", 409);
      check(receivedStaffCapacity(r, ["field_assessment"], usedStock.get(r.id) ?? 0, { now: sourceNow, workAt, useAt }) >= 1,
        "STAFF_QUALIFICATIONS", "The received mobile assessor is reserved, protected or insufficiently qualified.", 409);
      check(["idle", "arrived"].includes(v.state) && !usedVehicles.has(v.id),
        "VEHICLE_CONFLICT", "The assessment vehicle is already busy or assigned to concurrent work.", 409);
      // A delegated owner can approve the received exact target-version request
      // without possessing the coordinator's private site record. If this owner
      // does have newer metadata, do not ignore the conflict. The source still
      // checks the requested version before travel and again before completion.
      check(!site || site.sourceVersion === a.params.targetVersion, "ASSESSMENT_VERSION", "The site's received version changed before crew approval.", 409);
      usedStock.set(r.id, (usedStock.get(r.id) ?? 0) + 1); usedVehicles.add(v.id);
      checks.push({ index, type: "qualified_field_crew", resource: r.id, vehicle: v.id, targetVersion: a.params.targetVersion,
        ...(humanWindow.declared ? { humanWindow, nominalWorkStartsAt: workAt, nominalWorkEndsAt: useAt } : {}) });
    }
    if (a.type === "dispatch") {
      const r = await store.get(org, "resource", a.params.resource, false),
        v = await store.get(org, "vehicle", a.params.vehicle, false),
        n = await store.get(org, "need", a.params.need, false);
      const q = a.params.quantity;
      check(
        Number.isSafeInteger(q) && q > 0,
        "QUANTITY",
        "Dispatch quantity must be a positive integer.",
      );
      check(
        a.params.need || a.params.destination,
        "DESTINATION",
        "Dispatch must specify an existing need ID or a destination road node. A title is not a destination.",
      );
      check(
        !a.params.need || n,
        "NEED_ID",
        "The need ID is not in the observed operational records. Do not use a building ID as a need ID.",
      );
      check(
        r && v,
        "UNVERIFIED_CAPACITY",
        "Inventory and vehicle must be known before approval.",
      );
      check(
        r.owner === org && v.owner === org,
        "RESOURCE_OWNER",
        "Only the owner can authorize this resource and vehicle.",
        403,
      );
      check(v.driverAvailable !== false, "VEHICLE_DRIVER",
        "The received vehicle report has no driver available. Capacity alone does not make it executable.", 409);
      const lotClock = await receivedSourceNow(store, org),
        priorHeldStock = usedStock.get(r.id) ?? 0;
      check(lotStatus(r, lotClock).usable, "SUPPLY_EXPIRED", "The received lot is expired, damaged or has no valid source clock for its use-by date.", 409);
      check(
        q + priorHeldStock <=
          receivedUsableQuantity(r, lotClock),
        "INSUFFICIENT_RESOURCE",
        "The requested stock is already allocated, reserved or protected.",
        409,
      );
      check(
        q <= v.capacity,
        "VEHICLE_CAPACITY",
        "Vehicle capacity is insufficient.",
      );
      if (a.params.staffSkills !== undefined) {
        check(r.type === "staff", "STAFF_SELECTOR", "A staff qualification selector cannot be applied to other cargo.");
      }
      const { massKgPerUnit: massPerUnit } = assertReceivedCargoCapacity(v, r, q);
      check(
        !externalVehicles.has(v.id) &&
          (!usedVehicles.has(v.id) ||
            a.dependsOn.some(
              (j) =>
                proposal.actions[j]?.params.vehicle === v.id &&
                ["dispatch", "evacuate", "reroute"].includes(
                  proposal.actions[j]?.type,
                ),
            )),
        "VEHICLE_CONFLICT",
        "A vehicle is already assigned to another concurrent operation.",
        409,
      );
      check(
        ["idle", "arrived"].includes(v.state) ||
          a.dependsOn.some(
            (j) =>
              proposal.actions[j]?.params.vehicle === v.id &&
              ["dispatch", "evacuate", "reroute"].includes(
                proposal.actions[j]?.type,
              ),
          ),
        "VEHICLE_BUSY",
        "A busy vehicle requires a checked dependency before it can be reused.",
        409,
      );
      check(
        !n || r.type === n.type,
        "RESOURCE_TYPE",
        "Resource does not satisfy the need.",
      );
      usedStock.set(r.id, priorHeldStock + q);
      usedVehicles.add(v.id);
      const map = (await store.get(org, "context", "geography", false))?.map;
      let pickup = null, staffUseAt = null, staffWorkAt = null;
      if (map?.roads) {
        const roads = Object.fromEntries(
          (await store.list(org, "road", 5000)).map((e) => [e.id, e]),
        );
        const destination =
          a.params.destination ??
          n?.node ??
          map.places?.find((b) => b.id === (n?.building ?? a.params.building))
            ?.node;
        check(
          destination,
          "DESTINATION_LOCATION",
          "Query the destination location before checking a route.",
        );
        pickup = shortestRoute(map, v.node, r.node, v, roads);
        const route = shortestRoute(
          map,
          r.node,
          destination,
          { ...v, weightKg: (v.weightKg ?? 0) + q * massPerUnit },
          roads,
        );
        check(
          pickup && route,
          "NO_KNOWN_ROUTE",
          "No accessible known route can carry this vehicle to the destination.",
          409,
        );
        const executionPolicy = await receivedExecutionPolicy(store, org),
          returnRoute = v.calendar?.nextCommitment?.node
            ? shortestRoute(map, destination, v.calendar.nextCommitment.node, v, roads)
            : null,
          calendar = receivedVehicleCalendar(v, {
            now: lotClock, pickup, delivery: route, returnRoute, executionPolicy,
          });
        staffWorkAt = staffTripEnd(lotClock, pickup, route, executionPolicy);
        staffUseAt = staffTripEnd(lotClock, pickup, route, executionPolicy, Boolean(a.params.building));
        check(calendar.usable, "VEHICLE_CALENDAR", "The received vehicle window, return route or next commitment cannot accommodate this trip. Refresh the owner's calendar or select another vehicle.", 409);
        check(lotStatus(r, lotClock, nominalServiceAt(lotClock, pickup, route,
          executionPolicy)).usable,
          "SUPPLY_EXPIRED", "The received nominal pickup, travel and handling exceed the lot's use-by time. Select another usable lot.", 409);
        check(
          (v.fuel ?? Infinity) >=
            ((pickup.distanceM + route.distanceM + (returnRoute?.distanceM ?? 0)) / 1000) *
              (v.fuelMlPerKm ?? 0),
          "FUEL",
          "Fuel is insufficient for this checked route.",
        );
        checks.push({
          index,
          type: "route",
          state: "checked",
          ...route,
          pickup,
          ...(calendar.declared ? { calendar, returnRoute } : {}),
        });
      }
      if (r.type === "staff") {
        const humanWindow = receivedStaffCalendar(r, { now: lotClock, workAt: staffWorkAt, useAt: staffUseAt });
        check(humanWindow.usable, "STAFF_CALENDAR", "The received staff shift or rest window cannot cover transport, handling and the declared service setup. Receive current timing or choose eligible staff.", 409);
        check(q <= receivedStaffCapacity(r, a.params.staffSkills ?? [], priorHeldStock,
          { now: lotClock, workAt: staffWorkAt, useAt: staffUseAt }), "STAFF_QUALIFICATIONS", "The selected received staff are reserved, protected or insufficient for the planned work.", 409);
        if (humanWindow.declared) checks.push({ index, type: "staff_calendar", state: "checked", humanWindow, nominalWorkStartsAt: staffWorkAt, nominalWorkEndsAt: staffUseAt });
      }
      check(!v.calendar || map?.roads, "VEHICLE_CALENDAR", "A declared vehicle calendar requires received route evidence before owner review.", 409);
      const reservation = await validateDispatchReservation(
        store,
        org,
        a.params,
        { pickup },
      );
      checks.push({
        index,
        type: "dispatch_reservation",
        state: "checked",
        ...reservation,
      });
      checks.push({
        index,
        type: "quantity_capacity",
        state: "checked",
        resourceVersion: r.version,
        vehicleVersion: v.version,
        quantity: q,
      });
    }
    if (a.type === "evacuate") {
      const v = await store.get(org, "vehicle", a.params.vehicle, false),
        to = await store.get(org, "facility", a.params.to, false),
        n = (await store.list(org, "need", 2000)).find(
          (n) => n.building === a.params.from && n.type === "shelter",
        );
      check(
        v && v.owner === org,
        "RESOURCE_OWNER",
        "Only the vehicle owner can authorize an evacuation.",
        403,
      );
      check(v.driverAvailable !== false, "VEHICLE_DRIVER", "The received evacuation vehicle has no driver available.", 409);
      check(
        n && to,
        "EVACUATION_OBSERVATION",
        "Pickup demand and receiving shelter must be observed before review.",
      );
      check(
        a.params.quantity <= v.seats,
        "SEATS",
        "Not enough observed passenger seats.",
      );
      const passengerProfile = assertReceivedPassengerCapacity(v, a.params.quantity);
      const activation = a.dependsOn.some(
        (j) =>
          proposal.actions[j]?.type === "activate" &&
          proposal.actions[j]?.params.building === to.id,
      );
      check(
        to.state === "operating" || (activation && to.safe === true),
        "SHELTER",
        "The shelter must be operating, or depend on a current safety-checked activation.",
      );
      check(
        a.params.quantity + (usedPlaces.get(to.id) ?? 0) <=
          (to.capacity ?? 0) - (to.occupancy ?? 0) - (to.reservedPlaces ?? 0),
        "SHELTER_CAPACITY",
        "Receiving shelter places are already occupied or committed.",
        409,
      );
      check(
        a.params.quantity + (usedPeople.get(n.building) ?? 0) <=
          n.quantity - (n.served ?? 0) - (n.inTransit ?? 0),
        "POPULATION",
        "The observed group is already served or assigned.",
        409,
      );
      const previous = a.dependsOn.some(
        (j) =>
          proposal.actions[j]?.params.vehicle === v.id &&
          ["dispatch", "evacuate", "reroute"].includes(
            proposal.actions[j]?.type,
          ),
      );
      check(
        !externalVehicles.has(v.id) && (!usedVehicles.has(v.id) || previous),
        "VEHICLE_CONFLICT",
        "A vehicle is assigned to another concurrent operation.",
        409,
      );
      check(
        ["idle", "arrived"].includes(v.state) || previous,
        "VEHICLE_BUSY",
        "Reusing a busy vehicle requires a checked physical dependency.",
        409,
      );
      const map = (await store.get(org, "context", "geography", false))?.map;
      if (map?.roads) {
        const roads = Object.fromEntries(
            (await store.list(org, "road", 5000)).map((e) => [e.id, e]),
          ),
          from = map.places.find((b) => b.id === a.params.from)?.node;
        check(
          from && to.node,
          "EVACUATION_LOCATION",
          "Query both shelter and pickup locations.",
        );
        const pickup = shortestRoute(map, v.node, from, v, roads),
          dropoff = shortestRoute(map, from, to.node,
            { ...v, weightKg: (v.weightKg ?? 0) + a.params.quantity * passengerProfile.massKgPerUnit }, roads);
        check(
          pickup && dropoff,
          "NO_KNOWN_ROUTE",
          "No accessible pickup and evacuation route is known.",
          409,
        );
        checks.push({
          index,
          type: "evacuation_route",
          state: "checked",
          pickup,
          dropoff,
        });
      }
      usedVehicles.add(v.id);
      usedPlaces.set(to.id, (usedPlaces.get(to.id) ?? 0) + a.params.quantity);
      usedPeople.set(
        n.building,
        (usedPeople.get(n.building) ?? 0) + a.params.quantity,
      );
      checks.push({
        index,
        type: "passenger_capacity",
        state: "checked",
        quantity: a.params.quantity,
        vehicleVersion: v.version,
        facilityVersion: to.version,
        needVersion: n.version,
      });
    }
    if (a.type === "activate") {
      const f = await store.get(org, "facility", a.params.building, false);
      check(
        ["shelter", "plant"].includes(f?.use) && f.capacity > 0,
        "FACILITY_PURPOSE",
        "Activation requires an assessed service facility with positive useful capacity, not merely a safe demand location.",
      );
      const sourceNow = (await store.get(org, "source", "simulator", false))
          ?.simulatedAt,
        assessment = (await store.list(org, "verification", 2000)).find((v) =>
          assessmentCurrent(v, f, sourceNow),
        );
      check(
        f?.safe === true && assessment,
        "SAFETY_INSPECTION",
        "A received current competent field safety assessment is required before activation; clarification alone is not safety evidence.",
      );
      check(
        a.params.permit === true,
        "OWNER_PERMISSION",
        "Explicit responsible owner permission is required for activation.",
      );
      checks.push({
        index,
        type: "facility_safety",
        state: "checked",
        facilityVersion: f.version,
        assessment: assessment.id,
        sourceTargetVersion: assessment.result.version,
        sourceEvaluatedAt: sourceNow,
      });
    }
  }
  return checks;
}

export async function validateDispatchReservation(
  store,
  org,
  params,
  { pickup } = {},
) {
  if (pickup === undefined) {
    const r = await store.get(org, "resource", params.resource, false),
      v = await store.get(org, "vehicle", params.vehicle, false),
      map = (await store.get(org, "context", "geography", false))?.map,
      roads = Object.fromEntries(
        (await store.list(org, "road", 5000)).map((e) => [e.id, e]),
      );
    pickup =
      map && r && v ? shortestRoute(map, v.node, r.node, v, roads) : null;
    check(
      !map || !r || !v || pickup,
      "NO_KNOWN_ROUTE",
      "No received pickup route supports this dispatch reservation.",
      409,
    );
  }
  const estimate = dispatchReservationEstimate(
    pickup,
    await receivedExecutionPolicy(store, org),
  );
  if (params.commitment || params.transfer) {
    check(
      params.ttlMs === undefined,
      "RESERVATION_SCOPE",
      "A dispatch cannot extend an existing commitment or transfer. Review that reservation separately.",
    );
    const state = (await store.get(org, "context", "operational", false))
        ?.snapshot,
      row = (params.commitment ? state?.commitments : state?.transfers)?.find(
        (c) => c.id === (params.commitment ?? params.transfer),
      );
    if (row && estimate.timingKnown && Number.isFinite(row.expiresAt))
      check(
        Number.isFinite(state.now) &&
          row.expiresAt - state.now >= estimate.minimumTtlMs,
        "RESERVATION_TOO_SHORT",
        "The existing received reservation expires before pickup and loading. Obtain a new owner-reviewed reservation; its expiry cannot be extended by dispatch.",
        409,
      );
    return {
      ...estimate,
      existingReservation: params.commitment ?? params.transfer,
      ttlMs: null,
    };
  }
  return {
    ...estimate,
    ttlMs: validateDispatchTtl(params.ttlMs, estimate),
    existingReservation: null,
  };
}
