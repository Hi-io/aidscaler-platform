import { check } from "./errors.mjs";
import { hash } from "./store.mjs";
import { resolveEvidence } from "./citations.mjs";

// Private, bounded receipts of a real tool comparison. They are not model
// assertions of feasibility and never grant authority to any option.
function materialOptions(options) {
  const n = options.focusNeed;
  return {
    policy: {
      version: options.policy?.version,
      approved: options.policy?.approved,
      order: options.policy?.order,
      protectedTypes: options.policy?.protectedTypes,
    },
    focus:
      n &&
      Object.fromEntries(
        [
          "id",
          "type",
          "unit",
          "quantity",
          "served",
          "inTransit",
          "outstanding",
          "planningOutstanding",
          "deadline",
          "priority",
          "pendingProposals",
        ].map((key) => [key, n[key]]),
      ),
    immediateSupply: options.immediateSupply,
    serviceAlternatives: options.serviceAlternatives,
    otherNeeds: options.otherNeeds,
    concurrentSupplyOptions: options.concurrentSupplyOptions,
    omittedCandidateSites: options.omittedCandidateSites,
  };
}
function recordVersion(kind, record, id = record?.id) {
  // These receipts are upserted during a read even when their facts are
  // identical. A local DB revision is not a new source assessment or map.
  const refreshedReceipt = ["context", "verification", "operation"].includes(
      kind,
    ),
    material =
      record &&
      Object.fromEntries(
        Object.entries(record).filter(
          ([key]) =>
            ![
              "id",
              "version",
              "createdAt",
              "updatedAt",
              "receivedAt",
              "readAt",
              "generatedAt",
            ].includes(key) && !(kind === "context" && key === "observedAt"),
        ),
      );
  return {
    kind,
    id,
    version:
      (refreshedReceipt
        ? (record?.sourceVersion ?? record?.targetVersion)
        : record?.version) ?? null,
    materialHash: material ? hash(material) : null,
    sourceVersion: record?.sourceVersion ?? null,
    permissionVersion: record?.permissionVersion ?? null,
    expiresAt: record?.expiresAt ?? null,
    assessmentValidUntil: record?.result?.assessment?.validUntil ?? null,
  };
}
export async function captureResponseComparison(
  store,
  org,
  options,
  scope = {},
) {
  const cards = [];
  if (options.immediateSupply?.quantities?.length)
    cards.push({
      id: "delivery:" + (options.focusNeed?.id ?? "concurrent"),
      kind: "delivery",
      title: "Deliver available supplies",
      status: "received_option",
      reason:
        "Received capacity supports a draft; owners must still review it. This is not a completed delivery.",
      quantities: options.immediateSupply.quantities.slice(0, 8),
      omittedQuantities: Math.max(
        0,
        options.immediateSupply.quantities.length - 8,
      ),
      references: (options.immediateSupply.references ?? []).slice(0, 24),
    });
  for (const site of options.serviceAlternatives ?? [])
    cards.push({
      id: "service:" + site.building,
      kind: "service",
      building: site.building,
      title: "Provide a service at " + site.building,
      status: site.readyToDraft ? "received_option" : "pending_checks",
      reason: site.readyToDraft
        ? "Received conditions support a draft; this is not safety certification or owner authorization."
        : "Still needs checks: " +
          ((site.missing ?? [])
            .map((x) =>
              typeof x === "string"
                ? x
                : (x.reason ?? x.type ?? x.kind ?? "dependency"),
            )
            .join(", ") ||
            site.reason ||
            site.nextCheck),
      proposedPlaces: site.seats ?? 0,
      missing: (site.missing ?? []).slice(0, 8),
      references: (site.references ?? []).slice(0, 6),
    });
  const selected = cards.slice(0, 5),
    references = [
      ...new Set(
        [
          options.focusNeed?.id,
          ...selected.flatMap((c) => c.references),
          ...(options.otherNeeds ?? []).map((n) => n.id),
        ].filter(Boolean),
      ),
    ],
    evidence = [];
  for (const id of references) {
    const resolved = await resolveEvidence(store, org, id);
    if (resolved) evidence.push(resolved);
  }
  const sourceVersions = evidence.map(({ kind, record }) =>
    recordVersion(kind, record),
  );
  for (const site of selected.filter((c) => c.kind === "service")) {
    if (
      !sourceVersions.some(
        (v) => v.kind === "facility" && v.id === site.building,
      )
    ) {
      const record = await store.get(org, "facility", site.building, false);
      sourceVersions.push(recordVersion("facility", record, site.building));
    }
  }
  for (const [kind, id] of [
    ["context", "geography"],
    ["response_policy", "active"],
  ]) {
    const record = await store.get(org, kind, id, false);
    sourceVersions.push(recordVersion(kind, record, id));
  }
  check(
    sourceVersions.length <= 60,
    "COMPARISON_LIMIT",
    "Compare a narrower response scope.",
  );
  return {
    org,
    scope,
    signature: hash(materialOptions(options)),
    capturedAt: Date.now(),
    focusNeedId: options.focusNeed?.id ?? null,
    policy: {
      version: options.policy?.version,
      approved: options.policy?.approved,
      order: options.policy?.order,
    },
    sourceVersions,
    references: evidence.map(({ record }) => record.id),
    options: selected,
    omittedOptions: Math.max(0, cards.length - selected.length),
    note: "Bounded options actually returned by compare_responses, including unresolved alternatives. Not an exhaustive search or authorization.",
  };
}
export async function assertComparisonSourcesCurrent(store, org, comparison) {
  if (!comparison) return;
  check(
    comparison.org === org && comparison.sourceVersions?.length <= 60,
    "COMPARISON_SCOPE",
    "The comparison must belong to this operator's organization.",
    403,
  );
  for (const expected of comparison.sourceVersions) {
    const record = await store.get(org, expected.kind, expected.id, false);
    const sourceNow =
      expected.assessmentValidUntil === null
        ? null
        : (await store.get(org, "source", "simulator", false))?.simulatedAt;
    check(
      hash(recordVersion(expected.kind, record, expected.id)) ===
        hash(expected) &&
        (expected.expiresAt === null || expected.expiresAt > Date.now()) &&
        (expected.assessmentValidUntil === null ||
          (Number.isFinite(sourceNow) &&
            sourceNow < expected.assessmentValidUntil)),
      "COMPARISON_CHANGED",
      "An option's evidence, permission or validity changed. Compare the current responses before approval.",
      409,
    );
  }
}
export async function assertComparisonOptionsCurrent(
  store,
  org,
  comparison,
  options,
) {
  await assertComparisonSourcesCurrent(store, org, comparison);
  check(
    comparison.signature === hash(materialOptions(options)),
    "COMPARISON_CHANGED",
    "Response options changed; compare them again before preparing this choice.",
    409,
  );
}
export function consideredAlternatives(comparison, actions) {
  if (!comparison) return [];
  const sites = new Set(
      actions
        .flatMap((a) => [
          a.params?.building,
          a.type === "evacuate" ? a.params?.to : null,
        ])
        .filter(Boolean),
    ),
    deliveries = actions.filter((a) => a.type === "dispatch"),
    repair = actions.some((a) => a.type === "reroute");
  const deliveryCovered = (c) => {
    const required = new Map();
    for (const q of c.quantities) {
      const key = JSON.stringify([q.owner, q.need]);
      required.set(key, (required.get(key) ?? 0) + q.quantity);
    }
    return [...required].every(
      ([key, quantity]) =>
        deliveries
          .filter((a) => JSON.stringify([a.owner, a.params.need]) === key)
          .reduce((sum, a) => sum + a.params.quantity, 0) >= quantity,
    );
  };
  return comparison.options
    .filter((c) =>
      c.kind === "service"
        ? !sites.has(c.building)
        : repair || !deliveryCovered(c),
    )
    .slice(0, 4)
    .map((c) => ({
      title: c.title,
      reason: (
        c.reason +
        (repair && c.kind === "delivery"
          ? " A new delivery does not repair the existing loaded trip."
          : "")
      ).slice(0, 400),
    }));
}
