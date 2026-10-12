import { check } from "./errors.mjs";
import { compareNeeds, outstanding } from "./response-policy.mjs";
import { assessmentCurrent } from "./assessment-receipts.mjs";
import {
  dispatchReservationEstimate,
  receivedExecutionPolicy,
  validateDispatchTtl,
} from "./reservation-policy.mjs";
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
        (e.lengthM ?? 100) /
        (Math.min(e.speedMps ?? 8, vehicle.speedMps ?? 15) || 1);
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
    routes = new Map();
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
    if (!hasMap) return null;
    const destination =
        need.node ?? map.places?.find((p) => p.id === need.building)?.node,
      pickup = routeFor(vehicle, vehicle.node, resource.node),
      delivery = routeFor(
        vehicle,
        resource.node,
        destination,
        (vehicle.weightKg ?? 0) +
          quantity * (resource.type === "energy" ? 150 : 1),
      );
    if (!pickup || !delivery) return false;
    const seconds = pickup.seconds + delivery.seconds,
      distanceM = pickup.distanceM + delivery.distanceM,
      fuelMl = Number.isFinite(vehicle.fuelMlPerKm)
        ? (distanceM / 1000) * vehicle.fuelMlPerKm
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
        Math.max(0, r.quantity - (r.reserved ?? 0) - (r.floor ?? 0)),
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
                  vehicle.capacity ?? 0,
                  (vehicle.maxCargoKg ?? Infinity) /
                    (resource.type === "water"
                      ? 1
                      : resource.type === "energy"
                        ? 150
                        : 1),
                  (vehicle.volumeM3 ?? Infinity) /
                    (resource.type === "energy" ? 0.2 : 0.001),
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
      });
  }
  // Admission above preserves the approved need order and exact native-unit
  // quantities. Improve only this concurrent batch's fleet assignment: greedy
  // nearest-first choices can send the second truck on a long avoidable detour.
  // No unreceived need, future availability or observer road state enters here.
  const assignment = {
    swaps: 0,
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
        quantity > (vehicle.capacity ?? 0) ||
        quantity * (resource.type === "energy" ? 150 : 1) >
          (vehicle.maxCargoKg ?? Infinity) ||
        quantity * (resource.type === "energy" ? 0.2 : 0.001) >
          (vehicle.volumeM3 ?? Infinity)
      )
        return null;
      const travel = travelFor(resource, vehicle, need, quantity);
      if (!travel) return null;
      const reservationEstimate = dispatchReservationEstimate(
        travel.pickup,
        executionPolicy,
      );
      if (reservationEstimate.recommendedTtlMs > reservationEstimate.maxTtlMs)
        return null;
      // Do not introduce or increase a known missed useful window to shorten
      // another trip. Unknown windows remain unknown, never invented deadlines.
      if (Number.isFinite(need.deadline)) {
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
        !["dispatch", "evacuate"].includes(a.type) ||
        p.executionResults?.some((r) => r.index === index && r.result)
      )
        continue;
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
      if (operation.type === "evacuation" && operation.phase === "pickup") {
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
      const route = shortestRoute(
        map,
        vehicle.node,
        a.params.destination,
        vehicle,
        roads,
      );
      check(
        route,
        "NO_KNOWN_ROUTE",
        "No received accessible route supports this reroute.",
        409,
      );
      checks.push({
        index,
        type: "reroute",
        state: "checked",
        sourceOperation: operation.id,
        vehicleVersion: vehicle.version,
        operationVersion: operation.version,
        ...route,
      });
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
      check(
        q + (usedStock.get(r.id) ?? 0) <=
          r.quantity - (r.reserved ?? 0) - (r.floor ?? 0),
        "INSUFFICIENT_RESOURCE",
        "The requested stock is already allocated, reserved or protected.",
        409,
      );
      check(
        q <= v.capacity,
        "VEHICLE_CAPACITY",
        "Vehicle capacity is insufficient.",
      );
      const massPerUnit = r.type === "energy" ? 150 : 1,
        volumePerUnit = r.type === "energy" ? 0.2 : 0.001;
      check(
        q * massPerUnit <= (v.maxCargoKg ?? Infinity),
        "CARGO_WEIGHT",
        "The vehicle cannot carry this cargo mass.",
      );
      check(
        q * volumePerUnit <= (v.volumeM3 ?? Infinity),
        "CARGO_VOLUME",
        "The vehicle cannot carry this cargo volume.",
      );
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
      usedStock.set(r.id, (usedStock.get(r.id) ?? 0) + q);
      usedVehicles.add(v.id);
      const map = (await store.get(org, "context", "geography", false))?.map;
      let pickup = null;
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
        check(
          (v.fuel ?? Infinity) >=
            ((pickup.distanceM + route.distanceM) / 1000) *
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
        });
      }
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
          dropoff = shortestRoute(map, from, to.node, v, roads);
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
