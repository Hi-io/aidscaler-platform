import { extractionSchema } from "./extraction.mjs";
import { AppError, check } from "./errors.mjs";

const boundedIssues = error => (error.issues ?? [{ path: [], code: "invalid_json" }]).slice(0, 30)
  .map(i => ({ path: Array.isArray(i.path) ? i.path.slice(0, 6) : [], code: String(i.code ?? "invalid_schema").slice(0, 60) }));
const authorityKeys = new Set(["actions", "proposal", "authorization", "authorized", "approved", "verified", "confirmedBySource", "safe", "dispatch"]);

// The diagnostic contains paths/codes only, not an echoed source/model prompt.
// Repair may reformat a schema failure, never normalize an ungrounded claim.
export function parseSemanticResponse(content, { aliases, sourceIds, locationIds, entityIds }) {
  let raw;
  try { raw = JSON.parse(content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "")); }
  catch { const error = new AppError("EXTRACTION_SCHEMA", "The batch returned no valid observation JSON.");
    error.schemaIssues = [{ path: [], code: "invalid_json" }]; error.schemaRepairAllowed = true; throw error; }
  check(raw && typeof raw === "object" && !Array.isArray(raw), "EXTRACTION_SCHEMA", "The response must be an observation object.");
  const objects = [raw, ...(Array.isArray(raw.observations) ? raw.observations : [])];
  check(!objects.some(o => o && typeof o === "object" && Object.keys(o).some(k => authorityKeys.has(k))),
    "EXTRACTION_AUTHORITY", "Returned authority or action claims are not accepted or automatically repaired.");
  if (Object.keys(raw).length !== 1 || !Array.isArray(raw.observations) || raw.observations.length > 50) {
    const error = new AppError("EXTRACTION_SCHEMA", "The response must contain a finite observation array.");
    error.schemaIssues = [{ path: ["observations"], code: "invalid_shape" }]; error.schemaRepairAllowed = true; throw error;
  }
  const observations = [], rejectedObservations = [];
  for (const [index, candidate] of raw.observations.entries()) {
    try {
      const refs = Array.isArray(candidate?.sourceIds) ? candidate.sourceIds :
        typeof candidate?.sourceIds === "string" ? [candidate.sourceIds] : [];
      check(refs.every(id => typeof id === "string" && sourceIds.has(aliases.get(id) ?? id)),
        "EXTRACTION_REFERENCE", "Every interpretation must cite sources actually presented.");
      check(typeof candidate?.location !== "string" || locationIds.has(candidate.location),
        "EXTRACTION_LOCATION", "Unknown locations remain unresolved; no invented map IDs.");
      check(!candidate?.entity || typeof candidate.entity.id !== "string" ||
        entityIds.has(candidate.entity.kind + ":" + candidate.entity.id),
        "EXTRACTION_ENTITY", "An entity must occur in the received directory actually presented to this batch.");
      const o = extractionSchema.parse({ observations: [candidate] }).observations[0];
      o.sourceIds = [...new Set(o.sourceIds.map(id => aliases.get(id) ?? id))];
      observations.push(o);
    } catch (error) {
      const candidateReferences = Array.isArray(candidate?.sourceIds) ? candidate.sourceIds : [],
        grounded = candidateReferences.map(id => aliases.get(id) ?? id).filter(id => typeof id === "string" && sourceIds.has(id));
      rejectedObservations.push({ index, code: error.code ?? "EXTRACTION_SCHEMA",
        sourceIds: [...new Set(grounded)], attributionComplete: candidateReferences.length > 0 && grounded.length === candidateReferences.length,
        unknownReferenceCount: candidateReferences.length - grounded.length,
        kind: ["need", "capacity", "restriction", "correction", "uncertainty"].includes(candidate?.kind) ? candidate.kind : "untyped",
        ...(error.code ? {} : { issues: boundedIssues(error) }) });
    }
  }
  if (raw.observations.length && !observations.length) {
    const code = rejectedObservations[0]?.code ?? "EXTRACTION_SCHEMA",
      error = new AppError(code, "No returned observations passed provenance and schema checks; original sources remain available for review.");
    error.schemaIssues = rejectedObservations.flatMap(r => r.issues ?? []).slice(0, 30);
    error.schemaRepairAllowed = rejectedObservations.every(r => r.code === "EXTRACTION_SCHEMA");
    error.rejectedObservations = rejectedObservations;
    throw error;
  }
  return { observations, rejectedObservations };
}
