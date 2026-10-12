import { responseQueue } from "./response-policy.mjs";
import { receivedAllocationPlan } from "./received-allocation.mjs";
import { servicePlan } from "./services.mjs";

/** Formal options from received records. LLM interpretation/discovery happens
 * separately. No world truth, free verification, reservation or authority. */
export async function responseOptions(store, config, { needId, excludeProposal } = {}) {
  const queue = await responseQueue(store, config.org, { excludeProposal, limit: 100 });
  const focus = needId ? queue.rows.find((n) => n.id === needId) : queue.rows.find((n) => !n.pendingProposals.length);
  const allocation = await receivedAllocationPlan(store, config, { ...(focus ? { needIds: [focus.id] } : {}), excludeProposal });
  const geography = await store.get(config.org, "context", "geography", false),
    use = focus?.type === "shelter" ? "shelter" : focus?.type === "water" ? "plant" : null,
    candidates = use ? (geography?.map?.places ?? []).filter((p) => p.use === use) : [],
    services = [];
  for (const place of candidates.slice(0, 5)) {
    try {
      const plan = await servicePlan(store, config.org, place.id, { needId: focus?.id, peers: config.peers });
      services.push({ building: place.id, readyToDraft: plan.readyToDraft, requirements: plan.requirements,
        missing: plan.missing, owners: plan.ownerApprovals, actions: plan.actions.length,
        seats: plan.actions.filter((a) => a.type === "evacuate").reduce((sum, a) => sum + a.params.quantity, 0),
        source: "received_facility_assessment", nextCheck: plan.readyToDraft ? "plan_service" : "verify_or_lookup_missing_dependency" });
    } catch (error) {
      services.push({ building: place.id, readyToDraft: false, source: "received_directory_only", nextCheck: "verify_building", reason: error.code });
    }
  }
  const vehicles = new Set(allocation.allocations.map((a) => JSON.stringify([a.owner, a.vehicle]))),
    otherNeeds = queue.rows.filter((n) => n.id !== focus?.id).slice(0, 4).map((n) => ({ id: n.id, type: n.type, outstanding: n.outstanding, unit: n.unit, deadline: n.deadline, priority: n.priority, pendingProposals: n.pendingProposals }));
  return {
    policy: queue.policy, focusNeed: focus ?? null, knownConcurrentNeeds: queue.total,
    immediateSupply: { quantities: allocation.allocations.map((a) => ({ need: a.need, quantity: a.quantity, owner: a.owner })), finiteVehicles: vehicles.size, unmet: allocation.unserved },
    serviceAlternatives: services, omittedCandidateSites: Math.max(0, candidates.length - 5),
    otherNeeds,
    tradeoff: "A vehicle used for this response cannot simultaneously supply another need or provision a facility. Compare deadlines in the approved policy, keep native units separate and disclose postponed needs. An unknown inspection is an inquiry, not a feasible service.",
    suggestedNextTool: services.some((s) => s.readyToDraft && s.seats > 0) ? "plan_service" : allocation.allocations.length ? "plan_allocations" : services.length ? "verify" : "lookup_or_finish_without_proposal",
  };
}
