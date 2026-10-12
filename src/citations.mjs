// Resolve only records visible to this organization. A citation never grants access.
export const EVIDENCE_KINDS = [
  "media",
  "media_analysis",
  "external",
  "signal",
  "report",
  "claim",
  "verification",
  "query",
  "need",
  "resource",
  "vehicle",
  "facility",
  "road",
  "operation",
  "peer_offer",
  "evidence_group",
];
export async function resolveEvidence(store, org, id) {
  for (const kind of EVIDENCE_KINDS) {
    const record = await store.get(org, kind, id, false);
    if (record) return { kind, record };
  }
  return null;
}
