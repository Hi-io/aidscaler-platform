import { boundedContext } from "./model-context.mjs";
import { check } from "./errors.mjs";

// These are RECEIVED organization records. No observer, accounts, sessions,
// credentials, payments or arbitrary database kinds are exposed to the model.
export const CONTEXT_KINDS = [
  "need",
  "resource",
  "vehicle",
  "facility",
  "operation",
  "signal",
  "claim",
  "report",
  "peer_offer",
  "evidence_group",
  "verification",
  "road",
  "query",
  "location",
];
const common = [
  "id",
  "version",
  "sourceVersion",
  "state",
  "source",
  "owner",
  "observedAt",
  "receivedAt",
  "updatedAt",
  "expiresAt",
  "references",
  "originalReferences",
  "evidence",
  "dependencies",
  "uncertainty",
  "conditions",
  "validUntil",
  "ownerConfirmation",
  "name",
  "description",
  "notes",
  "purpose",
  "tags",
  "contradicts",
  "sourceRelations",
];
const fields = {
  road: [
    "from",
    "to",
    "open",
    "waterDepth",
    "maxWeight",
    "speedMps",
    "lengthM",
    "restriction",
    "reason",
  ],
  query: ["target", "result", "requestedAt", "completedAt"],
  need: [
    "type",
    "unit",
    "quantity",
    "served",
    "inTransit",
    "building",
    "node",
    "priority",
    "deadline",
    "confidence",
    "withdrawn",
  ],
  resource: [
    "type",
    "unit",
    "quantity",
    "reserved",
    "floor",
    "available",
    "node",
    "compatibility",
    "capabilities",
    "qualifications",
  ],
  vehicle: [
    "name",
    "node",
    "capacity",
    "maxCargoKg",
    "weightKg",
    "speedMps",
    "fuel",
    "fuelCapacity",
    "shiftEnd",
    "maxWaterDepth",
    "compatibility",
    "capabilities",
    "destination",
    "route",
    "operation",
    "order",
    "receivedOrderVersion",
  ],
  facility: [
    "name",
    "use",
    "node",
    "safe",
    "capacity",
    "occupied",
    "occupancy",
    "provisioned",
    "requiredPower",
    "requiredStaffSkills",
    "permission",
    "operating",
    "service",
  ],
  operation: [
    "type",
    "phase",
    "need",
    "resource",
    "vehicle",
    "quantity",
    "unit",
    "building",
    "destination",
    "proposal",
    "proposalId",
    "sourceOperation",
    "sourceId",
    "expectedArrival",
    "arrivedAt",
    "receivedAt",
    "reason",
    "error",
  ],
  signal: [
    "text",
    "location",
    "publishedAt",
    "attachments",
    "group",
    "sourceGroup",
    "deleted",
  ],
  claim: [
    "text",
    "location",
    "kind",
    "confidence",
    "contradictions",
    "correction",
    "supersedes",
    "uncertainty",
  ],
  report: [
    "kind",
    "text",
    "location",
    "quantity",
    "unit",
    "attachments",
    "authorization",
    "correction",
    "supersedes",
  ],
  peer_offer: ["from", "kind", "entity", "projection", "active", "conditions"],
  evidence_group: [
    "label",
    "members",
    "reason",
    "independentSources",
    "contradictions",
    "changedBy",
    "snapshots",
    "classifiedBy",
    "classifiedAt",
  ],
  verification: ["target", "entity", "result", "completedAt", "reason"],
  location: ["name", "use", "node", "x", "y", "capacity"],
};
const privateField =
  /^(api[_-]?key|.*password.*|.*secret.*|.*token.*|credentials|headers|cookie|session)$/i;
function redact(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, v]) =>
          !privateField.test(key) &&
          !(
            key.toLowerCase() === "authorization" &&
            typeof v === "string" &&
            /^(Bearer|Basic) /i.test(v)
          ),
      )
      .map(([key, v]) => [key, redact(v)]),
  );
}
export function recordPreview(kind, record, { detail = false } = {}) {
  if (!record) return null;
  const selected = detail
    ? record
    : Object.fromEntries(
        [...new Set([...common, ...(fields[kind] ?? [])])]
          .filter((key) => record[key] !== undefined)
          .map((key) => [key, record[key]]),
      );
  return boundedContext(redact(selected), {
    arrayLimit: detail ? 100 : 40,
    stringLimit: detail ? 12000 : 3500,
  });
}
const values = (value) =>
  Array.isArray(value) ? value : Object.values(value ?? {});
const byId = (a, b) => String(a.id ?? "").localeCompare(String(b.id ?? ""));
const terminal = new Set([
  "completed",
  "received",
  "failed",
  "cancelled",
  "rejected",
]);

/** A deterministic relevance preview, NOT a factual filter. Omitted records
 * remain in the store, counts are explicit, and read_context is paginated. */
export function caseContext(input) {
  const locations = new Set(
    [
      ...input.signals.map((s) => s.location),
      input.focusNeed?.building,
      input.focusNeed?.node,
      input.focusFacility?.id,
    ].filter(Boolean),
  );
  const sourceIds = new Set(input.signals.map((s) => s.id));
  const related = (r) =>
    locations.has(r.location) ||
    locations.has(r.building) ||
    locations.has(r.node) ||
    locations.has(r.id) ||
    [...(r.references ?? []), ...(r.members ?? [])].some((id) =>
      sourceIds.has(typeof id === "string" ? id : id.id),
    );
  const rankedNeeds = values(input.known?.needs).sort(
    (a, b) =>
      Number(b.id === input.focusNeed?.id) -
        Number(a.id === input.focusNeed?.id) ||
      Number(related(b)) - Number(related(a)) ||
      (b.priority ?? 0) - (a.priority ?? 0) ||
      (a.deadline ?? Infinity) - (b.deadline ?? Infinity) ||
      byId(a, b),
  );
  const types = new Set(rankedNeeds.slice(0, 12).map((n) => n.type));
  if (types.has("shelter"))
    ["water", "energy", "staff", "sanitation", "food"].forEach((t) =>
      types.add(t),
    );
  const ranked = (records) =>
    values(records).sort(
      (a, b) =>
        Number(related(b)) - Number(related(a)) ||
        Number(types.has(b.type ?? b.projection?.type)) -
          Number(types.has(a.type ?? a.projection?.type)) ||
        (b.updatedAt ?? b.publishedAt ?? 0) -
          (a.updatedAt ?? a.publishedAt ?? 0) ||
        byId(a, b),
    );
  const counts = {},
    omitted = {};
  const preview = (kind, records, limit) => {
    const rows = values(records);
    counts[kind] = rows.length;
    omitted[kind] = Math.max(0, rows.length - limit);
    return rows.slice(0, limit).map((r) => recordPreview(kind, r));
  };
  const needs = preview("need", rankedNeeds, 12);
  const needIds = new Set(needs.map((n) => n.id));
  const operations = values(input.operations).sort(
    (a, b) =>
      Number(needIds.has(b.need) || related(b)) -
        Number(needIds.has(a.need) || related(a)) ||
      Number(!terminal.has(b.state)) - Number(!terminal.has(a.state)) ||
      (b.updatedAt ?? b.at ?? 0) - (a.updatedAt ?? a.at ?? 0) ||
      byId(a, b),
  );
  const result = {
    organization: input.organization,
    simulatedAt: input.simulatedAt,
    focusNeed: recordPreview("need", input.focusNeed),
    focusFacility: input.focusFacility,
    responsePolicy: input.responsePolicy,
    competingNeeds: input.competingNeeds,
    signals: preview("signal", input.signals, 35),
    fieldReports: preview("report", ranked(input.fieldReports), 8),
    currentInterpretations: preview(
      "claim",
      ranked(input.currentInterpretations),
      8,
    ),
    humanEvidenceGroups: preview(
      "evidence_group",
      ranked(input.humanEvidenceGroups),
      8,
    ),
    known: {
      needs,
      resources: preview("resource", ranked(input.known?.resources), 16),
      vehicles: preview("vehicle", ranked(input.known?.vehicles), 12),
      buildings: preview("facility", ranked(input.known?.buildings), 10),
    },
    operations: preview("operation", operations, 12),
    sharedOffers: preview("peer_offer", ranked(input.sharedOffers), 20),
    repair: input.repair ? boundedContext(redact(input.repair)) : null,
    knownLocations: preview("location", ranked(input.knownLocations), 12),
    media: input.media,
    integrations: input.integrations,
    coverage: {
      recordsInReceivedSnapshot: counts,
      omittedFromInitialPreview: omitted,
      resourceTypesObserved: [
        ...new Set(values(input.known?.resources).map((r) => r.type)),
      ],
      note: "A preview is not exhaustive. Missing from this preview does NOT mean absent, false, zero demand or unavailable. Read omitted records with read_context; refresh external state with lookup/verify. No hidden world state is supplied.",
    },
  };
  return result;
}

/** Scoped, paginated retrieval. A model cannot choose an organization, SQL
 * expression or sensitive kind; even detailed records strip credentials. */
export async function readContext(store, org, args) {
  const {
    kind,
    ids = [],
    location,
    type,
    offset = 0,
    limit = 12,
    detail = false,
  } = args;
  check(
    CONTEXT_KINDS.includes(kind) &&
      Number.isSafeInteger(offset) &&
      offset >= 0 &&
      offset <= 1000000 &&
      Number.isSafeInteger(limit) &&
      limit >= 1 &&
      limit <= 20 &&
      Array.isArray(ids) &&
      ids.length <= 20 &&
      ids.every((id) => typeof id === "string" && id.length <= 200) &&
      (location == null ||
        (typeof location === "string" && location.length <= 200)) &&
      (type == null || (typeof type === "string" && type.length <= 100)) &&
      typeof detail === "boolean",
    "CONTEXT_SCOPE",
    "Select an allowed record kind and a bounded page from this organization's received data.",
    403,
  );
  let records, total;
  if (kind === "location") {
    const rows = (
      (await store.get(org, "context", "geography", false))?.map?.places ?? []
    )
      .filter(
        (r) =>
          (!ids.length || ids.includes(r.id)) &&
          (!location || r.node === location || r.id === location) &&
          (!type || r.use === type),
      )
      .sort(byId);
    total = rows.length;
    records = rows.slice(offset, offset + limit);
  } else {
    const params = [org, kind],
      clauses = ["org=$1", "kind=$2"];
    if (ids.length) {
      params.push(ids);
      clauses.push(`id=ANY($${params.length}::text[])`);
    }
    if (location) {
      params.push(location);
      clauses.push(
        `(data->>'location'=$${params.length} OR data->>'building'=$${params.length} OR data->>'node'=$${params.length})`,
      );
    }
    if (type) {
      params.push(type);
      clauses.push(
        `(data->>'type'=$${params.length} OR data->>'use'=$${params.length} OR data->'projection'->>'type'=$${params.length})`,
      );
    }
    const predicate = clauses.join(" AND ");
    total = Number(
      (
        await store.query(
          `SELECT COUNT(*) AS n FROM entities WHERE ${predicate}`,
          params,
        )
      ).rows[0].n,
    );
    const page = await store.query(
      `SELECT id,version,data,updated_at FROM entities WHERE ${predicate} ORDER BY id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    records = page.rows.map((r) => ({
      ...r.data,
      id: r.id,
      version: r.version,
      updatedAt: Number(r.updated_at),
    }));
  }
  return {
    kind,
    records: records.map((r) => recordPreview(kind, r, { detail })),
    totalAvailable: total,
    offset,
    nextOffset: offset + limit < total ? offset + limit : null,
    source: "organization_received_store",
    refresh:
      "Use lookup/verify for new source observations. This read does not independently verify or authorize anything.",
  };
}

export function toolContext(name, response) {
  if (name === "plan_allocations" && response.allocations) {
    return boundedContext({
      ...response,
      actions: undefined,
      evidenceIds: undefined,
      allocations: response.allocations
        .slice(0, 30)
        .map((a, index) => ({ index, ...a })),
      allocationsTotalAvailable: response.allocations.length,
      unserved: response.unserved.slice(0, 20),
      unservedTotalAvailable: response.unserved.length,
      note: "Actions are compiled server-side. Use prepare_allocation(indices) to copy them exactly; do not transcribe action JSON. Omitted unmet needs remain accessible with read_context.",
    });
  }
  // Full checked service dependencies, errors and conditions are kept. They
  // decide feasibility; saving tokens must not erase a blocking constraint.
  return boundedContext(response);
}
