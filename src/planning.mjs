import { check } from "./errors.mjs";
import { compareNeeds, outstanding } from "./response-policy.mjs";
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
  policy = { order: "priority_then_deadline" },
}) {
  const ownedKey = (record) => JSON.stringify([record.owner, record.id]);
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
    for (const resource of resources.filter((r) => r.type === need.type)) {
      for (const vehicle of vehicles.filter(
        (v) =>
          v.owner === resource.owner &&
          !usedVehicles.has(ownedKey(v)) &&
          ["idle", "arrived"].includes(v.state),
      )) {
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
          ),
        );
        if (quantity <= 0) continue;
        allocations.push({
          need: need.id,
          resource: resource.id,
          vehicle: vehicle.id,
          quantity,
          owner: resource.owner,
          needsRouteCheck: true,
        });
        stock.set(ownedKey(resource), stock.get(ownedKey(resource)) - quantity);
        usedVehicles.add(ownedKey(vehicle));
        remaining -= quantity;
        if (!remaining) break;
      }
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
  return {
    allocations,
    unserved,
    algorithm: "deterministic constrained greedy reference",
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
  return Promise.all(
    conditions.map(async (c) => {
      let satisfied = false,
        evidenceId = null;
      if (c.type === "inspection") {
        const v = await store.get(org, "verification", c.id, false);
        satisfied = v?.state === "completed" && v.result?.safe !== false;
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
        operation = (await store.list(org, "operation", 10000)).find(o => o.vehicle === a.params.vehicle && o.confirmedBySource &&
          !["failed", "cancelled", "received", "completed", "service"].includes(o.state)),
        map = (await store.get(org, "context", "geography", false))?.map,
        need = a.params.need ? await store.get(org, "need", a.params.need, false) : null,
        facility = a.params.building ? await store.get(org, "facility", a.params.building, false) : null;
      check(vehicle?.owner === org, "RESOURCE_OWNER", "Only a received vehicle's owner may authorize rerouting.", 403);
      check(operation, "ACTIVE_OPERATION", "Rerouting requires a current source-confirmed trip, not a new stock allocation.", 409);
      check(map?.nodes?.some(n => n.id === a.params.destination), "DESTINATION_LOCATION", "A reroute needs a received road node.");
      check(!active.some(p => p.actions.some(other => other.owner === org && other.type === "reroute" && other.params.vehicle === vehicle.id)),
        "VEHICLE_CONFLICT", "Another reviewed reroute for this vehicle is still active.", 409);
      if (operation.type === "evacuation" && operation.phase === "pickup") {
        check(!need && !facility && a.params.destination === operation.destination, "DESTINATION", "An empty pickup reroute must preserve its assigned pickup and shelter.");
      } else if (operation.type === "evacuation") {
        const ownReservation = operation.building === facility?.id ? operation.quantity : 0;
        check(facility?.state === "operating" && facility.safe === true && facility.node === a.params.destination &&
          facility.capacity - (facility.occupancy ?? 0) - (facility.reservedPlaces ?? 0) + ownReservation >= operation.quantity,
          "SHELTER_CAPACITY", "An evacuation reroute needs a safe operating shelter with available places.");
      } else {
        check(a.params.destination === operation.destination || need && need.type === operation.resourceType &&
          (need.node ?? map.places?.find(b => b.id === need.building)?.node) === a.params.destination ||
          facility?.node === a.params.destination && facility.safe === true,
          "DESTINATION", "Changing a loaded delivery's destination requires matching received need or assessed facility evidence.");
      }
      const roads = Object.fromEntries((await store.list(org, "road", 5000)).map(e => [e.id, e]));
      const route = shortestRoute(map, vehicle.node, a.params.destination, vehicle, roads);
      check(route, "NO_KNOWN_ROUTE", "No received accessible route supports this reroute.", 409);
      checks.push({ index, type: "reroute", state: "checked", sourceOperation: operation.id, vehicleVersion: vehicle.version,
        operationVersion: operation.version, ...route });
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
        const route = shortestRoute(map, r.node, destination, v, roads);
        check(
          route,
          "NO_KNOWN_ROUTE",
          "No accessible known route can carry this vehicle to the destination.",
          409,
        );
        check(
          (v.fuel ?? Infinity) >=
            (route.distanceM / 1000) * (v.fuelMlPerKm ?? 0),
          "FUEL",
          "Fuel is insufficient for this checked route.",
        );
        checks.push({ index, type: "route", state: "checked", ...route });
      }
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
      check(
        f?.safe === true,
        "SAFETY_INSPECTION",
        "A completed safety assessment is required before activation.",
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
      });
    }
  }
  return checks;
}
