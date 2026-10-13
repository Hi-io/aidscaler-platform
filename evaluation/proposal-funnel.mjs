// Scorer-only export. Never used by a controller, model context or policy.
const finite = x => typeof x === "number" && Number.isFinite(x);
const n = x => finite(x) ? x : null;
const ownerOf = x => x.owner ?? x.org;
const key = (owner, id) => JSON.stringify([owner, id]);
const localReview = new Set(["proposal.approve", "proposal.reject", "proposal.clarify"]);
const physicalType = { dispatch: ["delivery"], evacuate: ["evacuation"], reroute: ["delivery", "evacuation"], repair: ["repair"] };

function resolvedParams(action, results) {
  const missing = [];
  const params = Object.fromEntries(Object.entries(action.params ?? {}).map(([name, value]) => {
    if (typeof value !== "string" || !/^@step:\d+$/.test(value)) return [name, value];
    const result = results.find(r => r.index === Number(value.slice(6)));
    const id = result?.result?.id ?? result?.partnerResult?.id;
    if (!id) missing.push(name);
    return [name, id ?? null];
  }));
  return { params, missing };
}

function operationScope(action, params, operation, sourceNeeds) {
  const reasons = [];
  if (ownerOf(operation) !== action.owner) reasons.push("different_operation_owner");
  if (physicalType[action.type] && !physicalType[action.type].includes(operation.type)) reasons.push("different_operation_type");
  if (params.vehicle && operation.vehicle !== params.vehicle) reasons.push("different_vehicle");
  if (["dispatch", "evacuate"].includes(action.type) && operation.quantity !== params.quantity) reasons.push("different_authorized_quantity");
  if (action.type === "dispatch") {
    if (operation.resource !== params.resource) reasons.push("different_resource");
    if ((params.need ?? null) !== (operation.need ?? null)) reasons.push("different_need");
    if (params.building && operation.building !== params.building) reasons.push("different_building");
    if (params.destination && operation.destination !== params.destination) reasons.push("different_destination");
  }
  if (action.type === "evacuate") {
    if (operation.building !== params.to) reasons.push("different_receiving_shelter");
    const need = sourceNeeds.find(x => x.id === operation.need);
    if (!need || need.building !== params.from || need.type !== "shelter") reasons.push("different_pickup_need");
  }
  if (action.type === "repair" && (operation.target !== params.target || operation.entity !== params.id)) reasons.push("different_repair_target");
  return reasons;
}

function publicOperation(operation) {
  return { id: operation.id, owner: ownerOf(operation), type: operation.type ?? null, state: operation.state ?? null,
    need: operation.need ?? null, building: operation.building ?? null, resource: operation.resource ?? null,
    resourceType: operation.resourceType ?? null, quantity: n(operation.quantity), received: n(operation.received),
    createdAtSourceClock: n(operation.createdAt), times: { ...operation.times }, failure: operation.failure ?? null };
}

function traceStep(proposal, org, index, operations, source, asOfSourceClock) {
  const action = proposal.actions[index], results = proposal.executionResults ?? [], issued = results.filter(r => r.index === index),
    scope = resolvedParams(action, results), linked = operations.filter(o => o.proposalId === proposal.id && o.step === index && ownerOf(o) === action.owner);
  const issuedIds = issued.flatMap(r => {
    if (r.owner && r.owner !== action.owner) return [];
    const result = r.owner && r.owner !== org ? r.partnerResult : r.result;
    return result?.operation ?? result?.id ? [result.operation ?? result.id] : [];
  });
  const rowIds = linked.map(o => o.sourceId ?? o.sourceSnapshot?.id ?? o.id),
    ids = [...new Set([...issuedIds, ...rowIds])], missing = [...scope.missing.map(x => "unresolved_step_parameter:" + x)];
  if (ids.length > 1) missing.push("conflicting_operation_ids");
  const sourceId = ids.length === 1 ? ids[0] : null;
  const sourceRows = source.operations.filter(o => o.id === sourceId && ownerOf(o) === action.owner);
  if (sourceRows.length > 1) missing.push("duplicate_authoritative_operation");
  const operation = sourceRows.length === 1 ? sourceRows[0] : null;
  if (operation) missing.push(...operationScope(action, scope.params, operation, source.needs));
  else if (["dispatch", "evacuate", "reroute", "repair"].includes(action.type) && sourceId) missing.push("authoritative_operation_not_found");
  const correctlyLinked = Boolean(operation) && missing.length === 0;
  const received = correctlyLinked ? n(operation.received) : null, serviceAt = correctlyLinked ? n(operation.times?.service) : null;
  const validReceiptTime = serviceAt != null && finite(asOfSourceClock) && serviceAt >= 0 && serviceAt <= asOfSourceClock &&
    finite(operation.createdAt) && operation.createdAt >= 0 && serviceAt >= operation.createdAt;
  const validQuantity = received != null && received > 0 && finite(operation.quantity) && received <= operation.quantity;
  const useful = correctlyLinked && ["dispatch", "evacuate"].includes(action.type) && Boolean(operation.need) && validReceiptTime && validQuantity;
  const receipt = correctlyLinked ? publicOperation(operation) : null;
  const partial = useful ? received < operation.quantity : null;
  const receivedByPlatform = correctlyLinked && linked.some(o => o.confirmedBySource === true &&
    (o.sourceId ?? o.sourceSnapshot?.id ?? o.id) === operation.id &&
    finite(o.received) && o.received > 0 && finite(o.times?.service) && o.times.service === serviceAt);
  const nonService = !["dispatch", "evacuate"].includes(action.type) ?
    action.type === "purchase" ? "financial_order_not_service" : action.type === "verify" ? "assessment_not_service" :
      action.type === "activate" ? "activation_not_occupied_service" : "supporting_action_not_new_service" :
    operation && !operation.need ? "provisioning_not_direct_service" : null;
  return { index, type: action.type, owner: action.owner, params: scope.params, dependsOn: [...(action.dependsOn ?? [])],
    issued: issued.length > 0 || linked.length > 0, issuedResultCount: issued.length,
    pendingPartner: issued.some(r => r.state === "awaiting_partner" && !r.partnerResult),
    sourceId, correctlyLinked, missing, sourceReceipt: receipt, positivePhysicalService: useful,
    usefulPhysicalService: useful, // Deprecated alias: positive linked receipt, not deficit reduction.
    partialUsefulService: partial, receivedByPlatform, nonServiceReason: nonService,
    receiptKey: useful ? key(action.owner, operation.id) : null,
    financialReceipt: action.type === "purchase" && sourceId ? source.purchases.find(p => p.id === sourceId && p.org === action.owner) ?? null : null,
    assessmentReceipt: action.type === "verify" && sourceId ? source.inspections.find(p => p.id === sourceId && p.org === action.owner) ?? null : null,
    note: "A positive linked physical receipt requires the exact owner/action/operation and an independent positive service receipt. It may be redundant supply; this funnel does not compute marginal deficit reduction. Issued IDs, proposal completion, assessment, payment, provisioning or arrival alone do not qualify." };
}

function denoms(records) {
  const reviews = records.flatMap(p => p.reviews), positive = new Map();
  for (const p of records) for (const s of p.steps) if (s.receiptKey) positive.set(s.receiptKey, s.sourceReceipt);
  return { proposals: records.length, reviewedProposals: records.filter(p => p.reviews.length > 0).length,
    reviewedVersions: new Set(records.flatMap(p => p.reviews.map(r => key(p.org, [p.id, r.version])))).size,
    reviewDecisions: reviews.length, approvalDecisions: reviews.filter(r => r.decision === "approve").length,
    rejectionDecisions: reviews.filter(r => r.decision === "reject").length, clarificationDecisions: reviews.filter(r => r.decision === "clarify").length,
    approvedProposals: records.filter(p => p.reviews.some(r => r.decision === "approve")).length,
    sourceReviewedProposals: records.filter(p => p.sourceReview?.reviewedAtSourceClock != null).length,
    sourceAuthorizedProposals: records.filter(p => p.sourceReview?.state === "authorized").length,
    issuedProposals: records.filter(p => p.steps.some(s => s.issued)).length,
    physicallyReceivedProposals: records.filter(p => p.steps.some(s => s.correctlyLinked && s.sourceReceipt?.received > 0 && finite(s.sourceReceipt.times?.received))).length,
    usefulServiceProposals: records.filter(p => p.steps.some(s => s.usefulPhysicalService)).length,
    partialUsefulServiceProposals: records.filter(p => p.steps.some(s => s.partialUsefulService)).length,
    completedWithoutDirectUsefulService: records.filter(p => p.state === "completed" && !p.steps.some(s => s.usefulPhysicalService)).length,
    rejectedProposals: records.filter(p => p.state === "rejected" || p.reviews.some(r => r.decision === "reject")).length,
    pendingOrFailedProposals: records.filter(p => p.state !== "completed" && !p.steps.some(s => s.usefulPhysicalService)).length,
    proposalsWithMissingLinks: records.filter(p => p.steps.some(s => s.missing.length)).length,
    positivePhysicalServiceProposals: records.filter(p => p.steps.some(s => s.positivePhysicalService)).length,
    uniquePositivePhysicalSourceOperations: positive.size,
    uniqueUsefulSourceOperations: positive.size, // Deprecated positive-receipt alias, not marginal benefit.
    nativePositiveReceipts: [...positive.values()].map(o => ({ owner: o.owner, id: o.id, need: o.need, type: o.resourceType ?? o.type,
      received: o.received, serviceAtSourceClock: o.times.service })),
    usefulPerReviewedProposal: records.some(p => p.reviews.length) ?
      records.filter(p => p.reviews.length && p.steps.some(s => s.usefulPhysicalService)).length / records.filter(p => p.reviews.length).length : null };
}

/** Pure offline projection. source is authoritative post-execution evidence,
 * not a planner input or a receipt certified by an LLM. */
export function proposalServiceFunnel({ owners = [], source = {}, asOfSourceClock = null } = {}) {
  const physical = { operations: source.operations ?? [], proposals: source.proposals ?? [], needs: source.needs ?? [],
    inspections: source.inspections ?? [], purchases: source.purchases ?? [] };
  const records = [], seen = new Set(), duplicateProposals = [];
  for (const owner of owners) for (const proposal of owner.proposals ?? []) {
    const identity = key(owner.org, proposal.id);
    if (seen.has(identity)) { duplicateProposals.push({ org: owner.org, id: proposal.id }); continue; }
    seen.add(identity);
    const audit = (owner.audit ?? []).filter(a => a.org === owner.org && a.entity === proposal.id),
      reviews = audit.filter(a => localReview.has(a.action)).map(a => ({ sequence: String(a.sequence), decision: a.action.slice(9),
        version: a.detail?.version ?? null, actor: a.actor ?? null, atWallClock: n(Number(a.occurred_at)),
        note: a.detail?.note ?? "", pendingConditions: a.detail?.conditions ?? [], evidenceHash: a.detail?.evidenceHash ?? null })),
      sourceProposal = physical.proposals.find(p => p.id === proposal.simId && p.org === owner.org);
    const steps = (proposal.actions ?? []).map((_, i) => traceStep(proposal, owner.org, i, owner.operations ?? [], physical, asOfSourceClock));
    records.push({ org: owner.org, id: proposal.id, version: proposal.version ?? null, state: proposal.state ?? "unknown",
      createdAtWallClock: n(proposal.createdAt), sourceProposalId: proposal.simId ?? null,
      originPartner: proposal.originPartner ?? null, originProposal: proposal.originProposal ?? null, originStep: proposal.originStep ?? null,
      localAuthorization: proposal.authorization ? { by: proposal.authorization.by, proposalVersion: proposal.authorization.proposalVersion ?? null,
        atWallClock: n(proposal.authorization.at), expiresAtWallClock: n(proposal.authorization.expiresAt),
        conditional: proposal.authorization.conditional === true, planHash: proposal.authorization.planHash ?? null } : null,
      reviews, reviewHistoryMissing: reviews.length === 0 && Boolean(proposal.authorization || proposal.state === "rejected"),
      sourceReview: sourceProposal ? { state: sourceProposal.state, version: sourceProposal.version, reviewedAtSourceClock: n(sourceProposal.reviewedAt),
        queuedAtSourceClock: n(sourceProposal.reviewQueuedAt), authorizedBy: sourceProposal.authorizedBy ?? null,
        receivedState: proposal.sourceReview?.state ?? null, receivedAtSourceClock: n(proposal.sourceReview?.observedAtSourceClock) } : null,
      validation: { checkedConstraintCount: proposal.checkedConstraints?.length ?? null,
        failures: audit.filter(a => ["proposal.command_rejected", "proposal.source_review_required", "proposal.physical_failure"].includes(a.action))
          .map(a => ({ action: a.action, sequence: String(a.sequence), detail: a.detail, atWallClock: n(Number(a.occurred_at)) })),
        currentRejection: proposal.commandRejection ?? null, changedReason: proposal.changedReason ?? null },
      steps });
  }
  return { schema: "proposal-service-funnel-v1", scope: "observer_post_execution_only", asOfSourceClock: n(asOfSourceClock),
    denominators: denoms(records), perOwner: owners.map(o => ({ org: o.org, denominators: denoms(records.filter(p => p.org === o.org)) })),
    records, duplicateProposals,
    warnings: { unknownReviewHistory: records.filter(p => p.reviewHistoryMissing).map(p => ({ org: p.org, id: p.id })),
      missingPhysicalLinks: records.flatMap(p => p.steps.filter(s => s.missing.length).map(s => ({ org: p.org, proposal: p.id, step: s.index, reasons: s.missing }))) },
    definitions: { time: "Local review/audit wall-clock timestamps and source physical clocks are separate; never subtract or sum them.",
      denominator: "All stored owner-scoped proposals and exact historical local review decisions; not only successful/completed plans. Delegated copies remain identified separately.",
      service: "Positive independently recorded physical receipt of the exact issued delivery/evacuation. Receipt positivity is not marginal deficit reduction: redundant delivered supply can satisfy this contract. Payment, provision, assessment and activation alone get no positive-receipt credit.",
      legacyAliases: "Deprecated usefulPhysicalService, usefulServiceProposals, partialUsefulServiceProposals, uniqueUsefulSourceOperations, completedWithoutDirectUsefulService and usefulPerReviewedProposal mean positive linked receipt presence/quantity, not aid benefit or deficit reduction. Use positivePhysicalService / uniquePositivePhysicalSourceOperations for receipt counts and native deficit/outcome metrics for benefit; no quantity is silently clamped here.",
      duplicates: "A source operation may support coordinator and delegated review scopes. Unique owner+sourceID physical receipts are reported separately and never summed twice.",
      limits: "Internal scripted review and post-execution attribution are mechanisms; these ratios do not measure human comprehension, correctness of unseen semantic claims or field effectiveness." } };
}

// Read local stores only after the controller has ended. No query, tool,
// authorization, publication or simulation clock is advanced by this collector.
export async function collectProposalServiceFunnel(apps, world) {
  const owners = await Promise.all(apps.map(async app => {
    const org = app.config.org;
    const [entities, audit] = await Promise.all([
      app.store.query("SELECT kind,id,version,data,created_at,updated_at FROM entities WHERE org=$1 AND kind IN ('proposal','operation') ORDER BY kind,id", [org]),
      app.store.query("SELECT sequence,org,actor,action,entity,detail,occurred_at FROM audit WHERE org=$1 AND action LIKE 'proposal.%' ORDER BY sequence", [org]),
    ]);
    const records = entities.rows.map(r => ({ ...r.data, id: r.id, version: r.version, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) }));
    return { org, proposals: records.filter((_, i) => entities.rows[i].kind === "proposal"),
      operations: records.filter((_, i) => entities.rows[i].kind === "operation"), audit: audit.rows };
  }));
  return proposalServiceFunnel({ owners, asOfSourceClock: world.now,
    source: { operations: world.state.operations, proposals: world.state.proposals, needs: world.state.needs,
      inspections: world.state.inspections, purchases: world.state.purchases } });
}
