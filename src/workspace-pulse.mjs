/** Small, scoped live projection. It exposes recorded work, never model reasoning. */
const inferenceKinds = ["investigate", "discover_response", "compile_response", "interpret_sources", "analyze_media"];
const toolLabels = {
  lookup: "Checking operational data", query: "Requesting current source data",
  verify: "Requesting a field check", inspect_media: "Checking an attachment",
  inspect: "Checking received evidence", read_context: "Reading the case context",
  search: "Finding related reports", search_sources: "Finding related reports",
  record_claim: "Recording a sourced interpretation", draft_response: "Preparing a response",
  compile_response: "Matching needs with available capacity", propose: "Preparing a response for review",
  review_sources: "Cross-checking received reports", external_lookup: "Checking a connected source",
};
const stateLabels = {
  queued: "Investigation queued", reading: "Reading received reports", checking: "Checking response options",
  ready: "Investigation results recorded", waiting_context: "More context needs review",
  waiting_evidence: "Waiting for field confirmation", waiting_capacity: "Waiting for available capacity",
  waiting_review: "A response needs owner review", waiting_receipt: "Waiting for a delivery receipt",
  inconclusive: "Keeping an unanswered case visible", failed: "An investigation needs attention",
  cancelled: "Investigation stopped",
};
export function recordedWorkLabel(activity) {
  if (activity.erasure) return "Source content removed";
  const step = (activity.steps ?? []).at(-1);
  if (step?.tool === "lookup" || step?.tool === "query") {
    const target = step.params?.target ?? step.params?.kind;
    const label = {inventory:"Checking available supplies",resource:"Checking available supplies",vehicles:"Checking vehicle availability",vehicle:"Checking vehicle availability",personnel:"Checking available crews",map:"Checking access routes",roads:"Checking access routes",need:"Checking current needs"}[target];
    if(label)return label;
  }
  if (step?.tool && toolLabels[step.tool]) return toolLabels[step.tool];
  if (["source_interpretation", "source_perception", "perception", "source_batch"].includes(step?.type))
    return "Interpreting a batch of received reports";
  if (["allocation", "allocation_compilation", "compile_response"].includes(step?.type))
    return "Matching needs with available capacity";
  if (activity.state === "ready" && activity.proposalId) return "A response is ready for owner review";
  return stateLabels[activity.state] ?? "Investigation update recorded";
}
export async function workspacePulse(store, org, { now = Date.now() } = {}) {
  const [signals, activityCounts, work, recent, source, overview] = await Promise.all([
    store.query("SELECT COUNT(*) AS received,COUNT(*) FILTER (WHERE COALESCE(data->>'state','')<>'erased') AS available FROM entities WHERE org=$1 AND kind='signal'", [org]),
    store.query("SELECT COUNT(*) AS total,COUNT(*) FILTER (WHERE created_at >= $2) AS hour,COUNT(*) FILTER (WHERE created_at >= $3) AS minute FROM entities WHERE org=$1 AND kind='activity'", [org, now - 3600000, now - 60000]),
    store.query("SELECT state,COUNT(*) AS n FROM jobs WHERE org=$1 AND kind=ANY($2::text[]) AND (state IN ('queued','retry') OR (state='running' AND leased_until>$3)) GROUP BY state", [org, inferenceKinds, now]),
    store.list(org, "activity", 12),
    store.get(org, "context", "operational", false),
    store.query("SELECT kind,COUNT(*) AS n,COALESCE(SUM(version),0) AS revisions FROM entities WHERE org=$1 AND kind IN ('need','proposal','operation') GROUP BY kind ORDER BY kind", [org]),
  ]);
  const jobs = Object.fromEntries(work.rows.map(r => [r.state, Number(r.n)])), counts = activityCounts.rows[0];
  return {
    at: now, runId: source?.snapshot?.runId ?? null, overviewVersion: JSON.stringify(overview.rows),
    signals: { received: Number(signals.rows[0].received), available: Number(signals.rows[0].available) },
    flows: { total: Number(counts.total), lastHour: Number(counts.hour), lastMinute: Number(counts.minute), active: jobs.running ?? 0, queued: (jobs.queued ?? 0) + (jobs.retry ?? 0) },
    recent: recent.map(a => ({ id: a.id, version: a.version, state: a.state, startedAt: a.startedAt ?? a.createdAt,
      updatedAt: a.updatedAt, finishedAt: a.finishedAt ?? null, stepCount: a.erasure ? 0 : (a.steps ?? []).length,
      eventKey: JSON.stringify([a.id,a.state,(a.steps??[]).length,a.steps?.at(-1)?.state,a.steps?.at(-1)?.at]), label: recordedWorkLabel(a) })),
  };
}
