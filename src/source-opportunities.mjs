import { check } from "./errors.mjs";
import { hash } from "./store.mjs";
import { scopedReceivedEntities } from "./received-entities.mjs";
import { checkedRepairPlan } from "./response-repair.mjs";
import { validatePlan } from "./planning.mjs";
import { requestReceivedInquiry } from "./received-inquiries.mjs";
import { responseQueue } from "./response-policy.mjs";

// Admission uses only operational records already received by this owner.
// Retained uncertainty is not a verdict of falsehood, safety or no demand.
export function opportunityAdmission(observation, { needs = [], operations = [], proposals = [], vehicles = [], resources = [], map = {} } = {}) {
  const { target, entity, kind, resourceType, quantity } = observation;
  const activeOperations = operations.filter(o => !["completed", "received", "service", "failed", "cancelled"].includes(o.state));
  const activeProposals = proposals.filter(p => ["awaiting_review", "authorized", "executing", "awaiting_partner", "requires_review"].includes(p.state));
  const currentNeeds = needs.filter(n => n.quantity > (n.served ?? 0));
  const road = (map.roads ?? []).find(r => r.id === entity);
  const actionMatches = a => a.params?.[target] === entity ||
    target === "building" && [a.params?.building, a.params?.destination].includes(entity);
  const operationMatches = o => o[target] === entity ||
    target === "building" && [o.building, o.destination, needs.find(n => n.id === o.need)?.building].includes(entity) ||
    target === "road" && ((o.route ?? o.path ?? []).includes(entity) ||
      (vehicles.find(v => v.id === o.vehicle)?.route ?? []).includes(entity) ||
      // Direct received endpoints are useful when a blocked receipt omitted
      // its route. This does not consult the physical/future road state.
      road && ["blocked", "requires_review"].includes(o.state) &&
      [road.from, road.to].includes(vehicles.find(v => v.id === o.vehicle)?.node) &&
      [road.from, road.to].includes(o.destination));
  if (["restriction", "correction"].includes(kind) &&
    (activeOperations.some(operationMatches) || activeProposals.some(p => p.actions?.some(actionMatches)) ||
      target === "building" && currentNeeds.some(n => n.building === entity)))
    return { requestClass: "foreground", reason: "A received restriction or correction affects current owned work or demand" };
  const type = resourceType ?? (target === "resource" ? resources.find(r => r.id === entity)?.type : null);
  if (kind === "capacity" && currentNeeds.some(n => n.type === type && (n.planningOutstanding ?? n.quantity - (n.served ?? 0)) > 0) &&
    (["resource", "vehicle"].includes(target) || Number.isFinite(quantity) && quantity > 0))
    return { requestClass: "foreground", reason: "A concrete received capacity hypothesis could support current demand; availability and consent remain unverified" };
  return { requestClass: "background", reason: "No current operational dependency is established; retain the hypothesis for bounded background inquiry or later reactivation" };
}

const terminal = new Set([
  "completed",
  "inconclusive",
  "timeout",
  "failed",
  "cancelled",
]);
// Shared by semantic and conventional controllers. A public observation can
// direct a bounded normal inquiry, but never update a road, stock or authority.
export async function processSourceOpportunities(
  app,
  episode,
  {
    observations = [],
    references = [],
    assertCurrent = async () => {},
    stopRequested = async () => false,
  } = {},
) {
  const { store, config, connector, ingestion } = app,
    org = config.org;
  let saved = await store.get(org, "source_opportunity", episode, false);
  const guard = async (tx = store) => {
    check(
      !(await stopRequested(tx)),
      "DISCOVERY_CANCELLED",
      "Source inquiry was cancelled.",
      409,
    );
    check(
      saved?.state !== "erased" && !saved?.erasure,
      "SOURCE_ERASED",
      "Source opportunity was erased.",
      409,
    );
    await assertCurrent(tx);
    for (const source of saved?.sources ?? []) {
      const current = await tx.get(org, "signal", source.id, false);
      check(
        current &&
          current.state !== "erased" &&
          (current.sourceVersion ?? current.version) === source.version,
        "SEMANTIC_VERSION",
        "Source opportunity changed or was erased; review its current version.",
        409,
      );
    }
  };
  if (!saved) {
    const ids = [...new Set(observations.flatMap((o) => o.sourceIds ?? []))];
    const sources = await Promise.all(
      ids.map((id) => store.get(org, "signal", id)),
    );
    const directory = await scopedReceivedEntities(store, org, sources);
    const known = new Set(directory.entities.map((e) => e.kind + ":" + e.id));
    const opportunities = [],
      unresolved = [];
    for (const o of observations) {
      if (
        !["capacity", "restriction", "correction", "uncertainty"].includes(
          o.kind,
        )
      )
        continue;
      if (o.timeStatus === "historical") {
        unresolved.push({
          ...o,
          reason:
            "Historical context cannot establish current availability or closure",
        });
        continue;
      }
      if (!o.entity || !known.has(o.entity.kind + ":" + o.entity.id)) {
        unresolved.push({
          ...o,
          reason: "No unambiguous entity in the received directory",
        });
        continue;
      }
      const target = o.entity.kind,
        entity = o.entity.id;
      // Preserve every sourced hypothesis, including conflicting reports
      // about the same entity. Only physical inquiries are coalesced below.
      opportunities.push({
          ...o,
          target,
          entity,
          method: "clarification",
          kind: o.kind,
          sourceIds: o.sourceIds,
          state: "unrequested",
      });
    }
    saved = {
      state: "checking",
      sources: sources.map((s) => ({
        id: s.id,
        version: s.sourceVersion ?? s.version,
      })),
      opportunities,
      unresolved,
      proposalIds: [],
      references,
    };
    await guard();
    saved = await store.transaction(async (tx) => {
      await guard(tx);
      return tx.put(org, "source_opportunity", episode, saved, 0);
    });
  }
  await guard();
  const [queue, operations, proposals, vehicles, resources, geography] = await Promise.all([
    responseQueue(store, org, { limit: 2000 }), store.list(org, "operation", 10000), store.list(org, "proposal", 2000),
    store.list(org, "vehicle", 10000), store.list(org, "resource", 10000), store.get(org, "context", "geography", false),
  ]);
  for (const opportunity of saved.opportunities) {
    await guard();
    if (opportunity.id) continue;
    const admission = opportunityAdmission(opportunity, { needs: queue.rows, operations, proposals, vehicles, resources, map: geography?.map });
    opportunity.admissionReason = admission.reason;
    opportunity.requestClass = admission.requestClass;
    const isVehicle = opportunity.target === "vehicle";
    if (isVehicle && admission.requestClass === "background") {
      opportunity.state = "deferred";
      opportunity.reason = "Vehicle context has no current received demand dependency; keep it visible until relevant operational material arrives";
      continue;
    }
    const result =
      isVehicle
        ? await connector.action("query", { target: "vehicles" }, "source-opportunity-vehicles-" + hash([org, opportunity.entity, saved.sources]))
        : await requestReceivedInquiry(app, { target: opportunity.target, id: opportunity.entity, method: opportunity.method },
            { assertCurrent: guard, requestClass: admission.requestClass, backgroundMaxActive: 2 });
    if (result.admission === "deferred") {
      opportunity.state = "deferred";
      opportunity.reason = result.reason;
      continue;
    }
    opportunity.id = result.id;
    opportunity.state = result.state;
    opportunity.reused = Boolean(result.reused);
    opportunity.queryOnly = isVehicle;
    await store.transaction(async (tx) => {
      await guard(tx);
      await tx.upsert(org, "source_opportunity", episode, {
        opportunities: saved.opportunities,
      });
    });
  }
  await guard();
  await ingestion.sync({ sources: false });
  await guard();
  const current = await connector.state();
  for (const o of saved.opportunities) {
    const received = (
      o.queryOnly ? current.queries : current.inspections
    )?.find((i) => i.id === o.id);
    o.state = received?.state ?? o.state;
    o.received = Boolean(
      received && (o.queryOnly ? o.state === "ready" : o.state === "completed"),
    );
  }
  const pending = saved.opportunities.filter(
    (o) => o.id && !terminal.has(o.state) && o.state !== "ready" && o.state !== "requires_review",
  );
  const deferred = saved.opportunities.filter(o => !o.id || o.state === "requires_review");
  const confirmedRoads = [];
  for (const o of saved.opportunities.filter(
    (o) => o.target === "road" && o.received,
  )) {
    const inspection = (current.inspections ?? []).find((i) => i.id === o.id);
    const road = await store.get(org, "road", o.entity, false);
    if (
      road &&
      inspection?.result?.id === road.id &&
      inspection.result.version === road.sourceVersion
    )
      confirmedRoads.push(o);
  }
  const proposalIds = [...saved.proposalIds];
  const repairPending = [];
  // A check with no feasible repair stays visible; it does not fabricate an
  // extra truck or discard the original cargo. Other capacities remain checked
  // records for the common planner, not a promise of a conditional time slot.
  if (confirmedRoads.length)
    for (const prior of await store.list(org, "proposal", 2000)) {
      await guard();
      if (prior.state !== "requires_review") continue;
      const existing = (await store.list(org, "proposal", 2000)).find(
        (p) =>
          p.repairOf === prior.id &&
          ["awaiting_review", "authorized", "executing", "completed"].includes(
            p.state,
          ),
      );
      if (existing) {
        if (!proposalIds.includes(existing.id)) proposalIds.push(existing.id);
        continue;
      }
      const plan = await checkedRepairPlan(store, config, {
        proposalId: prior.id,
      });
      if (!plan.readyToDraft) {
        repairPending.push({ proposalId: prior.id, pending: plan.pending });
        continue;
      }
      const guardedStore = Object.create(store);
      guardedStore.command = (tenant, key, input, fn) =>
        store.command(tenant, key, input, async (tx) => {
          await guard(tx);
          const fresh = await checkedRepairPlan(tx, config, {
            proposalId: prior.id,
          });
          check(
            fresh.planHash === plan.planHash,
            "REPAIR_CHANGED",
            "Received repair dependencies changed; compile again.",
            409,
          );
          for (const o of confirmedRoads) {
            const road = await tx.get(org, "road", o.entity),
              inspection = await tx.get(org, "verification", o.id);
            check(
              inspection.state === "completed" &&
                inspection.result?.version === road.sourceVersion,
              "REPAIR_CHANGED",
              "Road confirmation changed before repair drafting.",
              409,
            );
          }
          await validatePlan(tx, org, input.draft);
          return fn(tx);
        });
      const domain = Object.assign(
        Object.create(Object.getPrototypeOf(app.domain)),
        app.domain,
        { store: guardedStore },
      );
      const draft = await domain.propose(
        { org, id: "received-opportunity-compiler", role: "agent" },
        {
          title: "Restore the existing checked aid delivery",
          summary:
            "Reroute the same loaded vehicle after received road confirmation.",
          benefit: "Preserve cargo and restore useful service",
          rationale:
            "Public observations directed a normal owner inquiry. Only its received road result and deterministic route constraints support this draft; the human owner must authorize it.",
          actions: plan.actions,
          references: [
            ...new Set([
              ...plan.references,
              ...saved.references,
              ...saved.sources.map((s) => s.id),
              ...confirmedRoads.flatMap((o) => [o.id, o.entity]),
            ]),
          ],
          conditions: [],
          alternatives: [],
          priority: "high",
        },
        "source-opportunity-repair-" + hash([prior.id, plan.planHash]),
        { repairOf: prior.id },
      );
      proposalIds.push(draft.id);
    }
  const result = {
    opportunities: saved.opportunities,
    proposalIds: [...new Set(proposalIds)],
    state: pending.length
      ? "waiting_evidence"
      : deferred.length
        ? "waiting_context"
      : proposalIds.length
        ? "ready"
        : "checked",
    pending: pending.map((o) => ({
      target: o.target,
      entity: o.entity,
      id: o.id,
    })),
    deferred: deferred.map(o => ({ target: o.target, entity: o.entity, kind: o.kind, state: o.state,
      reason: o.reason ?? o.admissionReason, sourceIds: o.sourceIds })),
    attentionRequired: saved.unresolved.length > 0 || deferred.length > 0,
    unresolved: [
      ...saved.unresolved,
      ...saved.opportunities
        .filter((o) => terminal.has(o.state) && o.state !== "completed")
        .map((o) => ({
          ...o,
          reason:
            "Inquiry ended without confirmation; explicit retry or another channel required",
        })),
    ],
    repairPending,
    noModelAuthority: true,
    physicalCompletion: false,
  };
  await store.transaction(async (tx) => {
    await guard(tx);
    await tx.upsert(org, "source_opportunity", episode, result);
  });
  return result;
}
