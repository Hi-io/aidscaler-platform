import { z } from "zod";
import { check, role } from "./errors.mjs";
import { hash } from "./store.mjs";
import { effectiveNeed } from "./response-receipts.mjs";
import { receivedStaffCalendar } from "./staff-capacity.mjs";
import { receivedSourceNow } from "./lot-capacity.mjs";

// Reopen an inquiry when eligibility changes, not when an identical poll
// advances its timestamp. Only received, already permission-scoped metadata
// enters this signature; private roster/assignment fields never do.
function receivedAvailabilityMaterial(record, sourceNow) {
  const calendar = record?.calendar,
    staff = record?.staffCalendar ?? record?.staffCapacity?.staffCalendar,
    humanWindow = record?.type === "staff" ? receivedStaffCalendar(record, { now: sourceNow }) : null,
    before = value => Number.isFinite(sourceNow) && Number.isFinite(value) ? sourceNow < value : null;
  return {
    driverAvailable: typeof record?.driverAvailable === "boolean" ? record.driverAvailable : null,
    calendar: calendar === undefined ? null : {
      availableAfter: calendar?.availableAfter ?? null,
      availableUntil: calendar?.availableUntil ?? null,
      nextCommitment: calendar?.nextCommitment && {
        startsAt: calendar.nextCommitment.startsAt ?? null,
        node: calendar.nextCommitment.node ?? null,
      },
      plannedReturn: calendar?.plannedReturn && {
        departureAt: calendar.plannedReturn.departureAt ?? null,
        destination: calendar.plannedReturn.destination ?? null,
        cargo: calendar.plannedReturn.cargo ?? null,
      },
      notYetAvailable: before(calendar?.availableAfter),
      windowOpen: before(calendar?.availableUntil),
      nextCommitmentPending: before(calendar?.nextCommitment?.startsAt),
    },
    staffCalendar: staff === undefined ? null : {
      epochAt: staff?.epochAt ?? null, shiftMs: staff?.shiftMs ?? null, restMs: staff?.restMs ?? null,
      window: { usable: humanWindow?.usable ?? false, reason: humanWindow?.reason ?? null,
        currentShiftEnd: humanWindow?.currentShiftEnd ?? null,
        nextAvailableAt: humanWindow?.nextAvailableAt ?? null },
    },
  };
}
const staffCapacityMaterial = capacity => capacity === undefined ? null : {
  quantity: capacity?.quantity ?? null, reserved: capacity?.reserved ?? null, floor: capacity?.floor ?? null,
  qualifications: capacity?.qualifications ?? null, qualificationCounts: capacity?.qualificationCounts ?? null,
  qualificationProfiles: capacity?.qualificationProfiles ?? null,
};

const schema = z
  .object({
    version: z.number().int().nonnegative(),
    order: z.enum(["deadline_then_priority", "priority_then_deadline"]),
    protectedTypes: z.array(z.string().min(1).max(80)).max(20).default([]),
    maxOpenReviews: z.number().int().min(1).max(100).default(8),
    investigationCooldownMs: z
      .number()
      .int()
      .min(1000)
      .max(3600000)
      .default(60000),
    reason: z.string().min(5).max(500),
  })
  .strict();
export function outstanding(need, operations = []) {
  const incoming = operations
    .filter(
      (o) =>
        o.need === need.id &&
        !["failed", "cancelled", "completed", "received", "service"].includes(
          o.state,
        ),
    )
    .reduce((sum, o) => sum + (o.quantity ?? 0), 0);
  return Math.max(
    0,
    need.quantity -
      (need.served ?? 0) -
      Math.max(incoming, need.inTransit ?? 0),
  );
}
export function compareNeeds(a, b, policy) {
  const deadline = (a.deadline ?? Infinity) - (b.deadline ?? Infinity),
    priority = (b.priority ?? 0) - (a.priority ?? 0);
  const protectedOrder =
    Number(policy.protectedTypes?.includes(b.type) ?? false) -
    Number(policy.protectedTypes?.includes(a.type) ?? false);
  return (
    protectedOrder ||
    (policy.order === "deadline_then_priority"
      ? deadline || priority
      : priority || deadline) ||
    a.id.localeCompare(b.id)
  );
}
export async function responsePolicy(store, org) {
  return (
    (await store.get(org, "response_policy", "active", false)) ?? {
      id: "active",
      version: 0,
      order: "priority_then_deadline",
      protectedTypes: [],
      maxOpenReviews: 8,
      investigationCooldownMs: 60000,
      approved: false,
      reason:
        "Existing source priorities; response policy has not yet been approved by a coordinator.",
    }
  );
}
export async function configureResponsePolicy(store, actor, input, key) {
  // A technical administrator does not acquire distribution authority.
  role(actor, ["commander"]);
  const d = schema.parse(input);
  return store.command(actor.org, key, d, async (tx) => {
    const row = await tx.put(
      actor.org,
      "response_policy",
      "active",
      {
        ...d,
        approved: true,
        approvedBy: actor.id,
        approvedAt: Date.now(),
      },
      d.version,
    );
    await tx.audit(actor.org, actor.id, "response_policy.approved", "active", {
      version: row.version,
      order: row.order,
      reason: row.reason,
    });
    return row;
  });
}
export async function responseQueue(
  store,
  org,
  { excludeProposal = null, limit = 100 } = {},
) {
  check(
    Number.isSafeInteger(limit) && limit > 0 && limit <= 2000,
    "RESPONSE_LIMIT",
    "Use a finite response page.",
  );
  const policy = await responsePolicy(store, org),
    operations = await store.list(org, "operation", 10000),
    needs = (await store.list(org, "need", 10000)).map((need) =>
      effectiveNeed(need, operations),
    ),
    verifications = await store.list(org, "verification", 2000),
    unloadingRunId = (await store.get(org, "source", "simulator", false))?.runId ??
      (await store.get(org, "context", "operational", false))?.snapshot?.runId,
    unloadingRequests = (await store.list(org, "unloading_request", 2000)).filter(r =>
      r.sourceRunId ? r.sourceRunId === unloadingRunId : !unloadingRunId),
    proposals = (await store.list(org, "proposal", 2000)).filter(
      (p) =>
        p.id !== excludeProposal &&
        [
          "awaiting_review",
          "needs_clarification",
          "conditionally_authorized",
          "authorized",
          "executing",
          "awaiting_partner",
        ].includes(p.state),
    ),
    covered = new Map(),
    planningHolds = [];
  for (const p of proposals)
    for (const [index, a] of p.actions.entries()) {
      const needIds = a.params.need
        ? [a.params.need]
        : a.type === "evacuate"
          ? needs
              .filter(
                (n) => n.type === "shelter" && n.building === a.params.from,
              )
              .map((n) => n.id)
          : [];
      for (const id of needIds)
        covered.set(id, [...(covered.get(id) ?? []), p.id]);
      if (a.type === "unload") {
        const received = unloadingRequests.find(r => r.operation === a.params.operation && r.receiverOrg === a.owner && r.confirmedBySource),
          request = received?.sourceSnapshot ?? received;
        if (!received) continue;
        if (request && ["completed", "inconclusive", "cancelled"].includes(request.state)) continue;
        planningHolds.push({ proposal: p.id, step: index, owner: a.owner, resource: a.params.staff,
          building: request?.building ?? null, vehicle: null, needIds: [], kind: "unloading_crew",
          staffSkills: request?.requiredSkills ?? [], operation: a.params.operation,
          // Once source work starts, its received reserved crew already reduces
          // capacity. Prospective holds must not count those people twice.
          quantity: request && ["queued", "working"].includes(request.state) ? 0 : a.params.quantity });
        continue;
      }
      if (!["dispatch", "evacuate", "verify"].includes(a.type)) continue;
      const receipt = p.executionResults?.find((r) => r.index === index),
        inspection = a.type === "verify" ? verifications.find(v =>
          v.proposalId === p.id && v.step === index ||
          [receipt?.result?.id, receipt?.partnerResult?.id].filter(Boolean).some(id => v.id === id || v.sourceId === id) &&
            (v.sourceOwner ?? v.org) === a.owner) : null,
        sourceId = receipt?.result?.operation ?? receipt?.partnerResult?.operation ?? inspection?.operation ??
          receipt?.result?.id ?? receipt?.partnerResult?.id,
        operation = operations.find((o) =>
          o.proposalId === p.id && o.step === index ||
          sourceId && (o.id === sourceId || o.sourceId === sourceId) &&
            (!o.owner || o.owner === a.owner),
        ),
        physicallyComplete = operation &&
          ["completed", "received", "service", "cancelled", "failed"].includes(operation.state);
      if (physicallyComplete || inspection && ["completed", "inconclusive", "timeout", "failed", "cancelled"].includes(inspection.state)) continue;
      // A draft hold only guides subsequent planning. It is not stock reserved
      // at the owner, owner consent, a dispatch or a physical receipt. Once the
      // operation is observed, its incoming quantity is already counted below.
      planningHolds.push({
        proposal: p.id,
        step: index,
        owner: a.owner,
        vehicle: a.params.vehicle,
        resource: a.type === "verify" ? a.params.staff : a.type === "dispatch" ? a.params.resource : null,
        building: a.type === "evacuate" ? a.params.to : a.type === "verify" ? a.params.id : a.params.building ?? null,
        needIds,
        quantity: a.type === "verify" ? inspection?.staff ? 0 : 1 : operation ? 0 : Math.max(0, a.params.quantity ?? 0),
        ...(a.type === "verify" ? { kind: "field_assessment", staffSkills: ["field_assessment"], inspection: inspection?.id ?? null } : {}),
        operation: operation?.id ?? null,
      });
    }
  const eligible = needs
    .filter((n) => outstanding(n, operations) > 0)
    .sort((a, b) => compareNeeds(a, b, policy));
  const rows = eligible.slice(0, limit).map((n) => {
    const missing = outstanding(n, operations),
      draftHeldQuantity = planningHolds
        .filter((h) => h.needIds.includes(n.id))
        .reduce((sum, h) => sum + h.quantity, 0);
    return {
      ...n,
      outstanding: missing,
      draftHeldQuantity,
      planningOutstanding: Math.max(0, missing - draftHeldQuantity),
      pendingProposals: [...new Set(covered.get(n.id) ?? [])],
      selectionReason:
        policy.order === "deadline_then_priority"
          ? "Earliest declared useful window, then source priority"
          : "Source priority, then declared useful window",
      policyVersion: policy.version,
    };
  });
  // Ignore changing wall time/telemetry; only changed material observations may
  // restart the same inquiry. Versions and busy/available resources matter.
  const sourceNow = await receivedSourceNow(store, org),
    material = [
    policy.version,
    rows.map((n) => [
      n.id,
      n.type,
      n.deadline,
      n.priority,
      n.outstanding,
      n.planningOutstanding,
      n.pendingProposals,
    ]),
    ...(await Promise.all(
      [
        "resource",
        "vehicle",
        "facility",
        "peer_offer",
        "verification",
        "road",
      ].map(async (kind) => [
        kind,
        (await store.list(org, kind, 10000))
          .filter(
            (r) =>
              kind !== "peer_offer" || (r.active && r.expiresAt > Date.now()),
          )
          .map((r) => [
            r.id,
            r.state,
            r.active,
            r.node,
            r.quantity,
            r.reserved,
            r.floor,
            r.provisioned,
            r.occupancy,
            r.result,
            r.permissionVersion,
            r.open,
            r.waterDepth,
            r.maxWeight,
            r.compatibility,
            r.qualifications,
            r.qualificationCounts,
            r.qualificationProfiles,
            staffCapacityMaterial(r.staffCapacity),
            receivedAvailabilityMaterial(r, sourceNow),
            r.projection && {
              id: r.projection.id,
              type: r.projection.type,
              state: r.projection.state,
              node: r.projection.node,
              available: r.projection.available,
              compatibility: r.projection.compatibility,
              qualifications: r.projection.qualifications,
              staffCapacity: staffCapacityMaterial(r.projection.staffCapacity),
              availability: receivedAvailabilityMaterial(r.projection, sourceNow),
            },
          ])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ]),
    )),
  ];
  const signature = hash(material),
    deferred = await store.list(org, "response_defer", 10000);
  for (const row of rows) {
    const last = deferred.find(
      (d) => d.id === row.id && d.signature === signature,
    );
    row.investigationDeferred = last
      ? {
          reason: last.reason,
          activityId: last.activityId,
          at: last.at,
          state: "awaiting_changed_evidence_or_manual_retry",
        }
      : null;
  }
  return {
    policy,
    rows,
    planningHolds,
    total: eligible.length,
    openReviews: proposals.filter((p) =>
      [
        "awaiting_review",
        "needs_clarification",
        "conditionally_authorized",
      ].includes(p.state),
    ).length,
    signature,
    nextOffset: eligible.length > limit ? limit : null,
    note: "Native quantities are not combined into a utility score. A pending review is not delivered aid. Expired windows remain visible; they do not end assistance.",
  };
}
