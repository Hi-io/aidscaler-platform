import { check } from "./errors.mjs";

/** A received operational site assessment is not structural certification.
 * Its source clock, method, competent crew and target version are required;
 * a clarification ACK or signed boolean cannot certify a safe facility. */
export function assessmentCurrent(verification, facility, sourceNow) {
  const v = verification, r = v?.result, a = r?.assessment;
  return !!(facility && Number.isFinite(sourceNow) && v?.target === "building" &&
    v.entity === facility.id && v.state === "completed" && v.confirmedBySource === true &&
    v.method === "field" && v.purpose === "facility_safety" && r?.safe === true &&
    r.version === (facility.sourceVersion ?? facility.version) &&
    (v.targetVersion === undefined || v.targetVersion === r.version) &&
    a?.method === "field" && a.purpose === "facility_safety" && a.competent === true &&
    a.targetVersion === r.version && a.qualifications?.includes("field_assessment") &&
    typeof a.inspectorOrg === "string" && a.inspectorOrg === (v.sourceOwner ?? v.org) &&
    typeof a.staffResource === "string" && typeof a.vehicle === "string" && typeof a.operation === "string" &&
    Number.isFinite(a.observedAt) && a.observedAt >= 0 && a.observedAt <= sourceNow &&
    Number.isFinite(a.validUntil) && a.validUntil > sourceNow && a.validUntil > a.observedAt &&
    Number.isFinite(v.completedAt) && v.completedAt >= a.observedAt && v.completedAt <= sourceNow);
}

export async function recordAssessmentReceipt(tx, org, from, proposal, index, state, source) {
  const action = proposal.actions[index];
  if (action?.type !== "verify") return null;
  if (state !== "completed") return null;
  const p = action.params, r = source?.result, a = r?.assessment;
  check(source?.confirmedBySource === true && source.state === "completed" &&
    source.org === from && action.owner === from && source.target === p.target && source.entity === p.id &&
    source.method === p.method && source.purpose === p.purpose && source.reportTo === org &&
    source.targetVersion === p.targetVersion && source.requestProposal === proposal.simId &&
    source.requestStep === index && typeof source.id === "string" && source.id.length > 0 && source.id.length <= 240 &&
    Number.isFinite(source.observedAt) && Number.isFinite(source.completedAt) &&
    a?.targetVersion === r.version && a.inspectorOrg === from && a.staffResource === p.staff && a.vehicle === p.vehicle,
    "PEER_ASSESSMENT", "The source assessment does not match the exact independently approved request.");
  const facility = await tx.get(org, "facility", p.id, false);
  check(facility && assessmentCurrent(source, facility, source.completedAt),
    "PEER_ASSESSMENT", "A completed field assessment requires current target version, competence and valid source evidence.");
  const id = `peer:${from}:${source.id}`, old = await tx.get(org, "verification", id, false);
  check(!old || old.proposalId === proposal.id && old.step === index,
    "PEER_ASSESSMENT", "One source assessment cannot satisfy two different authorizations.", 409);
  if (old && old.completedAt > source.completedAt) return { stale: true, id };
  await tx.upsert(org, "verification", id, {
    ...source, sourceId: source.id, sourceOwner: from, proposalId: proposal.id, step: index,
    receiptOrigin: "authenticated_owner_source_report",
  });
  return { id, stale: false };
}
