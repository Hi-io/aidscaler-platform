import { check } from "./errors.mjs";
import { hash } from "./store.mjs";

const terminal = new Set(["completed", "inconclusive", "timeout", "failed", "cancelled"]);
export const inquiryPending = row => row && !terminal.has(row.state);
const purpose = row => row.purpose ?? "observation";
const exact = (row, org, request) => (!row.org || row.org === org) &&
  row.target === request.target && row.entity === request.id &&
  row.method === request.method && purpose(row) === purpose(request);

/** A received pending request is work, not its future observation. The owner
 * lock and durable source key are shared by every ingestion/controller lane.
 * An ambiguous transport outcome is never retried under a new command key. */
const inFlight = new WeakMap();
export async function requestReceivedInquiry(app, request, options = {}) {
  const key = hash([app.config.org, request.target, request.id, request.method, purpose(request)]);
  let flights = inFlight.get(app.store);
  if (!flights) { flights = new Map(); inFlight.set(app.store, flights); }
  if (flights.has(key)) return { ...await flights.get(key), reused: true };
  const pending = issueReceivedInquiry(app, request, options);
  flights.set(key, pending);
  try { return await pending; } finally { flights.delete(key); }
}
async function issueReceivedInquiry(app, request, {
  assertCurrent = async () => {}, requestClass = "foreground", backgroundMaxActive = 2,
} = {}) {
  const { store, connector, config } = app, org = config.org;
  check(["building", "road", "resource"].includes(request.target) &&
    typeof request.id === "string" && request.id.length > 0 &&
    ["field", "radio", "clarification"].includes(request.method) &&
    ["foreground", "background"].includes(requestClass) &&
    Number.isSafeInteger(backgroundMaxActive) && backgroundMaxActive >= 0 && backgroundMaxActive <= 5,
    "INQUIRY_SCOPE", "Use a bounded, exact received inquiry scope.");
  const outcome = await store.transaction(async tx => {
    await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [org]);
    await assertCurrent(tx);
    const geography = (await tx.get(org, "context", "geography", false))?.map ?? {};
    const resource = request.target === "resource" ? await tx.get(org, "resource", request.id, false) : null;
    const grounded = request.target === "building" ? (geography.places ?? []).some(p => p.id === request.id)
      : request.target === "road" ? (geography.roads ?? []).some(p => p.id === request.id)
      : resource?.owner === org;
    check(grounded, "INQUIRY_GROUNDING", "The exact target must be in this owner's received directory; peer stock requires consented capability lookup.", 409);
    // Fresh actor-scoped metadata prevents a stale caller snapshot from
    // enqueuing the same physical check after another lane just requested it.
    const snapshot = await connector.state(), pending = (snapshot.inspections ?? []).filter(i =>
      (!i.org || i.org === org) && inquiryPending(i));
    const existing = pending.find(i => exact(i, org, request));
    if (existing) {
      if (requestClass === "foreground")
        for (const intent of (await tx.list(org, "received_inquiry", 10000)).filter(r =>
          r.inspection === existing.id && r.requestClass === "background"))
          await tx.upsert(org, "received_inquiry", intent.id, { requestClass: "foreground" });
      return { ...existing, reused: true, admission: "reused_pending" };
    }
    const targetVersion = snapshot.known?.[{ building: "buildings", road: "roads", resource: "resources" }[request.target]]?.[request.id]?.version ?? null;
    const scope = { org, runId: snapshot.runId ?? null, target: request.target, entity: request.id,
      method: request.method, purpose: purpose(request), targetVersion };
    const id = "received-inquiry-" + hash(scope), previous = await tx.get(org, "received_inquiry", id, false);
    if (previous && previous.state !== "issuing") {
      // No automatic resurrection of a failed/ambiguous or completed check.
      // A new target version or explicit owner workflow is a different scope.
      const received = (snapshot.inspections ?? []).find(i => i.id === previous.inspection && exact(i, org, request));
      return { ...(received ?? previous.result ?? { id: previous.inspection }),
        state: received?.state ?? previous.state, reused: true, admission: "durable_scope",
        ...(previous.lastError ? { lastError: previous.lastError } : {}) };
    }
    if (requestClass === "background") {
      const intents = await tx.list(org, "received_inquiry", 10000),
        backgroundIds = new Set(intents.filter(r => r.requestClass === "background" && r.sourceRunId === scope.runId).map(r => r.inspection).filter(Boolean)),
        issuing = intents.filter(r => r.sourceRunId === scope.runId && r.state === "issuing"),
        foregroundPending = pending.some(i => !backgroundIds.has(i.id)) || issuing.some(r => r.requestClass !== "background"),
        backgroundActive = pending.filter(i => backgroundIds.has(i.id)).length + issuing.filter(r => r.requestClass === "background").length;
      if (foregroundPending || backgroundActive >= backgroundMaxActive)
        return { state: "deferred", admission: "deferred", reused: false,
          reason: foregroundPending ? "Explicit need or safety checks are pending in the owner's finite queue" : "The bounded background inquiry slots are occupied" };
    }
    await assertCurrent(tx);
    const intent = { ...scope, sourceRunId: scope.runId, requestClass, state: "issuing", sourceKey: id,
      requestedAtSourceClock: Number.isFinite(snapshot.now) ? snapshot.now : null, inspection: null };
    if (!previous) await tx.put(org, "received_inquiry", id, intent, 0);
    return { issue: true, id, intent };
  });
  if (!outcome.issue) return outcome;
  // Do not hold a local SQL transaction while a remote source is answering:
  // cancellation, erasure and operator writes must remain able to progress.
  // Restart replays this durable key, never a new physical command identity.
  try {
    await store.transaction(async tx => { await assertCurrent(tx); });
    const result = await connector.action("verify", request, outcome.id);
    check(typeof result?.id === "string" && result.id.length > 0,
      "INQUIRY_ACK", "The source did not return an inquiry identifier.", 409);
    await store.transaction(tx => tx.upsert(org, "received_inquiry", outcome.id,
      { state: result.state ?? "pending", inspection: result.id, result }));
    return { ...result, reused: false, admission: "requested" };
  } catch (error) {
    await store.transaction(tx => tx.upsert(org, "received_inquiry", outcome.id,
      { state: "requires_review", lastError: error.code ?? error.name,
        reason: "Inquiry emission or acknowledgment failed; inspect the received source pending work before explicit recovery." }));
    throw error;
  }
}
