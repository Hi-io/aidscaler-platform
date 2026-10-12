import { z } from "zod";
import { check, role } from "./errors.mjs";
import { hash } from "./store.mjs";

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
    needs = await store.list(org, "need", 10000),
    operations = await store.list(org, "operation", 10000),
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
    covered = new Map();
  for (const p of proposals)
    for (const a of p.actions) {
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
    }
  const eligible = needs
    .filter((n) => outstanding(n, operations) > 0)
    .sort((a, b) => compareNeeds(a, b, policy));
  const rows = eligible.slice(0, limit).map((n) => ({
    ...n,
    outstanding: outstanding(n, operations),
    pendingProposals: [...new Set(covered.get(n.id) ?? [])],
    selectionReason:
      policy.order === "deadline_then_priority"
        ? "Earliest declared useful window, then source priority"
        : "Source priority, then declared useful window",
    policyVersion: policy.version,
  }));
  // Ignore changing wall time/telemetry; only changed material observations may
  // restart the same inquiry. Versions and busy/available resources matter.
  const material = [
    policy.version,
    rows.map((n) => [
      n.id,
      n.type,
      n.deadline,
      n.priority,
      n.outstanding,
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
            r.projection && {
              id: r.projection.id,
              type: r.projection.type,
              state: r.projection.state,
              node: r.projection.node,
              available: r.projection.available,
              compatibility: r.projection.compatibility,
              qualifications: r.projection.qualifications,
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
