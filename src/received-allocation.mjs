import { allocationPlan } from "./planning.mjs";
import { check } from "./errors.mjs";
import { responsePolicy, responseQueue } from "./response-policy.mjs";

const key = (owner, id) => JSON.stringify([owner, id]);

/** Compile only owned observations and explicitly consented, current peer
 * projections. A projection grants visibility, never permission to dispatch. */
export async function receivedAllocationPlan(
  store,
  config,
  { needIds, excludeVehicles = [], excludeProposal = null } = {},
) {
  check(
    needIds === undefined ||
      (Array.isArray(needIds) &&
        needIds.length <= 100 &&
        needIds.every((id) => typeof id === "string")),
    "ALLOCATION_SCOPE",
    "Use received need IDs.",
  );
  check(
    Array.isArray(excludeVehicles) &&
      excludeVehicles.length <= 100 &&
      excludeVehicles.every(
        (v) => typeof v.id === "string" && typeof v.owner === "string",
      ),
    "ALLOCATION_SCOPE",
    "Excluded vehicles need an exact owner and ID.",
  );
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
  const queue = await responseQueue(store, org, {
      excludeProposal,
      limit: 2000,
    }),
    policy = await responsePolicy(store, org),
    selectedNeeds = queue.rows
      .filter(
        (n) =>
          n.planningOutstanding > 0 && (!needIds || needIds.includes(n.id)),
      )
      // Keep source records unchanged. Only the internal planning copy removes
      // quantities already included in another unissued draft.
      .map((n) => ({ ...n, quantity: n.quantity - n.draftHeldQuantity })),
    excluded = new Set([
      ...excludeVehicles.map((v) => key(v.owner, v.id)),
      ...queue.planningHolds
        .filter((h) => h.vehicle)
        .map((h) => key(h.owner, h.vehicle)),
    ]);
  for (const r of resources)
    r.quantity -= queue.planningHolds
      .filter(
        (h) => h.resource && key(h.owner, h.resource) === key(r.owner, r.id),
      )
      .reduce((sum, h) => sum + h.quantity, 0);
  const resourceIndex = new Map(resources.map((r) => [key(r.owner, r.id), r])),
    vehicleIndex = new Map(vehicles.map((v) => [key(v.owner, v.id), v])),
    map = (await store.get(org, "context", "geography", false))?.map,
    observedRoads = Object.fromEntries(
      (await store.list(org, "road", 5000)).map((r) => [r.id, r]),
    ),
    now =
      (await store.get(org, "source", "simulator", false))?.simulatedAt ?? 0,
    plan = allocationPlan({
      needs: selectedNeeds,
      resources,
      vehicles: vehicles.filter((v) => !excluded.has(key(v.owner, v.id))),
      operations: await store.list(org, "operation", 2000),
      map,
      observedRoads,
      now,
      policy,
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
  plan.policy = {
    version: policy.version,
    order: policy.order,
    approved: policy.approved,
  };
  plan.deferred = queue.rows
    .filter((n) => n.pendingProposals.length)
    .map((n) => ({
      need: n.id,
      pendingProposals: n.pendingProposals,
      draftHeldQuantity: n.draftHeldQuantity,
      planningOutstanding: n.planningOutstanding,
    }));
  plan.scope = { needIds, excludeVehicles, excludeProposal };
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
