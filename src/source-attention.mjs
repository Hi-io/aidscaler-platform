// Attention is attributed only through complete references to sources actually
// presented in this immutable receipt. Unknown/missing references affect the
// whole batch. Reading acknowledgment is not independent semantic accuracy.
export function semanticSourceAttention(receipt, sourceId) {
  if (receipt.coverage?.truncatedSources?.includes(sourceId))
    return { requiresReview: true, reason: "truncated", rejectedIndices: [] };
  const rejected = receipt.coverage?.rejectedObservations ?? [];
  const presented = new Set((receipt.sources ?? []).map((s) => s.id));
  const complete = (r) =>
    r.attributionComplete === true &&
    Array.isArray(r.sourceIds) &&
    r.sourceIds.length > 0 &&
    r.sourceIds.every((id) => typeof id === "string" && presented.has(id)) &&
    (r.unknownReferenceCount ?? 0) === 0;
  const unattributed = rejected.filter((r) => !complete(r));
  if (
    unattributed.length ||
    (receipt.state === "partially_interpreted_unverified" && !rejected.length)
  )
    return {
      requiresReview: true,
      reason: "unattributed_rejection",
      rejectedIndices: unattributed.map((r) => r.index),
    };
  const own = rejected.filter((r) => r.sourceIds.includes(sourceId));
  if (own.length)
    return {
      requiresReview: true,
      reason: "attributed_rejection",
      rejectedIndices: own.map((r) => r.index),
    };
  const acceptedState = [
    "interpreted_unverified",
    "partially_interpreted_unverified",
    "reconciled_progress_unverified",
    "routine_commentary_unverified",
  ].includes(receipt.state);
  return {
    requiresReview: !acceptedState,
    reason: acceptedState ? "valid_reading_receipt" : "receipt_state_pending",
    rejectedIndices: [],
  };
}
