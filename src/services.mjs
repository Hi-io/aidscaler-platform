import { check } from "./errors.mjs";

/** Build a checked dependency draft from RECEIVED inspections and consented
 * owner projections. This is a formal feasibility aid, not LLM discovery and
 * never activation or authorization. Other owners still approve their steps. */
export async function servicePlan(store, org, building) {
  const facility = await store.get(org, "facility", building, false);
  check(
    facility,
    "FACILITY",
    "Read the facility location and request its inspection first.",
  );
  const inspections = (await store.list(org, "verification", 2000)).filter(
    (v) =>
      v.target === "building" &&
      v.entity === building &&
      v.state === "completed",
  );
  const assessment = inspections.sort(
    (a, b) =>
      (b.completedAt ?? b.observedAt ?? b.at ?? 0) -
      (a.completedAt ?? a.observedAt ?? a.at ?? 0),
  )[0];
  const safe =
    facility.safe === true &&
    assessment?.result?.safe === true &&
    assessment.result.version === facility.sourceVersion;
  const dependencies =
    facility.dependencies ?? assessment?.result?.dependencies;
  check(
    dependencies && facility.node,
    "FACILITY_UNCHECKED",
    "A received assessment must describe dependencies and location.",
  );
  const offers = (await store.list(org, "peer_offer", 2000)).filter(
    (o) => o.active && o.expiresAt > Date.now(),
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
  ].filter((v) => ["idle", "arrived"].includes(v.state));
  const actions = [],
    missing = [],
    references = new Set([building]);
  if (assessment) references.add(assessment.id);
  const usedStock = new Map(),
    lastVehicle = new Map();
  for (const [type, required] of Object.entries(dependencies)) {
    let remaining = Math.max(0, required - (facility.provisioned?.[type] ?? 0));
    for (const r of resources.filter((r) => r.type === type)) {
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
            r.available - (usedStock.get(r.id) ?? 0),
            v.capacity ?? 0,
          ),
        );
        if (quantity <= 0) continue;
        const previous = lastVehicle.get(v.id),
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
        usedStock.set(r.id, (usedStock.get(r.id) ?? 0) + quantity);
        lastVehicle.set(v.id, index);
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
    const activation = actions.length;
    actions.push({
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
      const needs = (await store.list(org, "need", 2000)).filter(
        (n) =>
          n.type === "shelter" &&
          n.building !== building &&
          n.quantity > (n.served ?? 0),
      );
      for (const n of needs) {
        let remaining = Math.min(
          places,
          n.quantity - (n.served ?? 0) - (n.inTransit ?? 0),
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
              previous = lastVehicle.get(v.id),
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
                  activation,
                  ...(previous === undefined ? [] : [previous]),
                ]),
              ],
            });
            lastVehicle.set(v.id, index);
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
    readyToDraft: !missing.length,
    actions,
    references: [...references],
    missing,
    requirements: dependencies,
    ownerApprovals: [...new Set(actions.map((a) => a.owner))],
    note: "Quantities and compatible equipment are sourced. Routes and each owner authorization are checked before execution. Operating service requires physical delivery and a received facility status.",
  };
}
