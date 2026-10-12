import { check } from "./errors.mjs";

const FINISHED = new Set(["completed", "received", "service"]);
const ownerOf = (operation) => operation.owner ?? operation.org;
const keyOf = (operation) =>
  JSON.stringify([ownerOf(operation), operation.sourceId ?? operation.id]);

// A source snapshot already includes all service observed at its timestamp.
// Add only newer physical receipts, never planned quantities or transport ACKs.
// Keep the original need untouched so a newer authoritative snapshot replaces
// this projection without counting the same cargo a second time.
export function effectiveNeed(need, operations = []) {
  const snapshot = need.sourceSnapshot ?? need,
    at = snapshot.at ?? snapshot.observedAt,
    baseline = Number(snapshot.served ?? need.served ?? 0);
  if (!Number.isFinite(at)) return { ...need };
  const receipts = new Map();
  for (const operation of operations) {
    const serviceAt = operation.times?.service;
    if (
      operation.need !== need.id ||
      operation.confirmedBySource !== true ||
      !FINISHED.has(operation.state) ||
      !Number.isFinite(serviceAt) ||
      serviceAt <= at ||
      !Number.isFinite(operation.received) ||
      operation.received < 0
    )
      continue;
    const key = keyOf(operation),
      prior = receipts.get(key);
    if (
      !prior ||
      (operation.sourceObservedAt ?? operation.observedAt ?? 0) >=
        (prior.sourceObservedAt ?? prior.observedAt ?? 0)
    )
      receipts.set(key, operation);
  }
  const additional = [...receipts.values()].reduce(
    (sum, operation) => sum + operation.received,
    0,
  );
  return {
    ...need,
    served: baseline + additional,
    receiptServed: additional,
    receiptOperationIds: [...receipts.values()].map(
      (operation) => operation.id,
    ),
  };
}

// The signed owner channel supplies a source-observed operation, tied to the
// exact independently authorized step. A boolean "completed" alone is not a
// physical receipt. This is an authenticated owner report, not independent
// verification of an adversarial owner's external source.
export async function recordResponseReceipt(
  tx,
  org,
  from,
  proposal,
  index,
  state,
  source,
) {
  const action = proposal.actions[index];
  if (!action || !["dispatch", "evacuate"].includes(action.type)) return null;
  if (source?.confirmedBySource !== true) {
    check(
      state !== "completed",
      "PEER_RECEIPT",
      "Completion requires an observed physical owner receipt.",
    );
    return null;
  }
  const p = action.params,
    expectedType = action.type === "dispatch" ? "delivery" : "evacuation";
  check(
    typeof source.id === "string" &&
      source.id.length > 0 &&
      source.id.length <= 240 &&
      source.org === from &&
      action.owner === from &&
      source.type === expectedType &&
      source.vehicle === p.vehicle &&
      source.quantity === p.quantity &&
      Number.isFinite(source.observedAt) &&
      source.observedAt >= 0,
    "PEER_RECEIPT",
    "The physical owner receipt does not match the authorized action.",
  );
  let needId;
  if (action.type === "dispatch") {
    needId = p.need;
    check(
      source.resource === p.resource &&
        (needId ? source.need === needId : !source.need) &&
        (!p.building || source.building === p.building) &&
        (!p.destination || source.destination === p.destination),
      "PEER_RECEIPT",
      "The physical receipt has a different resource or need.",
    );
  } else {
    const needs = await tx.list(org, "need", 10000),
      need = needs.find((n) => n.type === "shelter" && n.building === p.from);
    needId = need?.id;
    check(
      needId && source.need === needId && source.building === p.to,
      "PEER_RECEIPT",
      "The evacuation receipt has a different pickup need or receiving shelter.",
    );
  }
  const physicalAt = needId ? source.times?.service : source.times?.received;
  if (state === "failed")
    check(
      ["failed", "cancelled", "blocked"].includes(source.state),
      "PEER_RECEIPT",
      "A physical failure receipt needs the interrupted source operation, not a status boolean.",
    );
  if (state === "completed" || FINISHED.has(source.state))
    check(
      FINISHED.has(source.state) &&
        Number.isFinite(physicalAt) &&
        physicalAt <= source.observedAt &&
        physicalAt >= 0 &&
        Number.isFinite(source.received) &&
        source.received >= 0 &&
        source.received <= p.quantity,
      "PEER_RECEIPT",
      "Completion needs a physical service timestamp and received quantity.",
    );
  const id = `peer:${from}:${source.id}`,
    old = await tx.get(org, "operation", id, false);
  if (
    old &&
    ((old.sourceObservedAt ?? -1) > source.observedAt ||
      (FINISHED.has(old.state) && !FINISHED.has(source.state)))
  )
    return { stale: true, id };
  check(
    !old || (old.proposalId === proposal.id && old.step === index),
    "PEER_RECEIPT",
    "A source operation cannot satisfy two independent authorizations.",
    409,
  );
  await tx.upsert(org, "operation", id, {
    sourceId: source.id,
    owner: from,
    org: from,
    peerOwner: from,
    sourceObservedAt: source.observedAt,
    sourceSnapshot: source,
    proposalId: proposal.id,
    step: index,
    need: needId ?? null,
    vehicle: source.vehicle,
    resource: source.resource ?? null,
    resourceType: source.resourceType ?? null,
    type: source.type,
    quantity: source.quantity,
    received: source.received ?? 0,
    failure: source.failure ?? null,
    commitment: source.commitment ?? null,
    phase: source.phase ?? null,
    times: source.times ?? {},
    state: source.state,
    confirmedBySource: true,
    receiptOrigin: "authenticated_owner_source_report",
  });
  return { id, stale: false };
}
