import { allocationPlan } from "./planning.mjs";
import { check } from "./errors.mjs";

const key = (owner, id) => JSON.stringify([owner, id]);

/** Compile only owned observations and explicitly consented, current peer
 * projections. A projection grants visibility, never permission to dispatch. */
export async function receivedAllocationPlan(store, config) {
  const org = config.org,
    peers = new Set((config.peers ?? []).map((p) => p.org)),
    offers = (await store.list(org, "peer_offer", 2000)).filter(
      (o) => o.active && o.expiresAt > Date.now() && peers.has(o.from),
    );
  const project = (kind) =>
    offers
      .filter((o) => o.kind === kind)
      .map((o) => ({
        ...o.projection,
        owner: o.from,
        // available already excludes protected/reserved stock at the owner.
        ...(kind === "resource"
          ? {
              quantity: Math.max(0, o.projection.available ?? 0),
              reserved: 0,
              floor: 0,
            }
          : {}),
        evidence: o.id,
        offerVersion: o.version,
        permissionVersion: o.permissionVersion,
      }));
  const resources = [
    ...(await store.list(org, "resource", 2000)).filter((r) => r.owner === org),
    ...project("resource"),
  ];
  const vehicles = [
    ...(await store.list(org, "vehicle", 2000)).filter((v) => v.owner === org),
    ...project("vehicle"),
  ];
  const resourceIndex = new Map(resources.map((r) => [key(r.owner, r.id), r])),
    vehicleIndex = new Map(vehicles.map((v) => [key(v.owner, v.id), v])),
    plan = allocationPlan({
      needs: await store.list(org, "need", 2000),
      resources,
      vehicles,
      operations: await store.list(org, "operation", 2000),
    });
  plan.allocations = plan.allocations.map((a) => {
    const records = [
      resourceIndex.get(key(a.owner, a.resource)),
      vehicleIndex.get(key(a.owner, a.vehicle)),
    ];
    return {
      ...a,
      evidenceIds: [a.need, ...records.map((r) => r.evidence ?? r.id)],
      offerVersions: records
        .filter((r) => r.evidence)
        .map((r) => ({
          id: r.evidence,
          version: r.offerVersion,
          permissionVersion: r.permissionVersion,
        })),
    };
  });
  plan.actions = plan.allocations.map((a) => ({
    type: "dispatch",
    owner: a.owner,
    params: {
      vehicle: a.vehicle,
      resource: a.resource,
      need: a.need,
      quantity: a.quantity,
    },
    dependsOn: [],
  }));
  plan.evidenceIds = [
    ...new Set(plan.allocations.flatMap((a) => a.evidenceIds)),
  ];
  plan.ownerApprovals = [...new Set(plan.allocations.map((a) => a.owner))];
  plan.nextTool = "prepare_allocation";
  plan.note =
    "Only received owned data and consented current peer projections. Each owner must approve its exact steps; sharing is not authorization. Owner routes/stock/versions are rechecked before execution. Do not invent an approval condition for this built-in owner review.";
  return plan;
}

export async function validateAllocationOffers(store, config, allocations) {
  const peers = new Set((config.peers ?? []).map((p) => p.org));
  for (const a of allocations)
    for (const ref of a.offerVersions) {
      const offer = await store.get(config.org, "peer_offer", ref.id, false);
      check(
        offer?.active &&
          offer.expiresAt > Date.now() &&
          peers.has(offer.from) &&
          offer.version === ref.version &&
          offer.permissionVersion === ref.permissionVersion,
        "SHARED_CAPACITY_CHANGED",
        "A shared capacity changed, expired or was withdrawn. Run plan_allocations again; partner review is still required.",
        409,
      );
    }
}
