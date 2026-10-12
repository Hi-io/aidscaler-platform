import { check } from "./errors.mjs";

export const DEFAULT_DISPATCH_TTL_MS = 900000;
export const MAX_DISPATCH_TTL_MS = 86400000;
export const RESERVATION_MARGIN_MS = 120000;

/** Execution timing is an observation from the actor's source query. Never
 * obtain loading or communication latency from the observer's world config. */
export async function receivedExecutionPolicy(store, org) {
  const snapshot = (await store.get(org, "context", "operational", false))
    ?.snapshot;
  const query = snapshot?.queries
    ?.filter(
      (q) =>
        q.target === "policy" && q.state === "ready" && q.result?.execution,
    )
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
    .at(-1);
  if (!query) return null;
  return {
    ...query.result.execution,
    queryId: query.id,
    observedAt: query.result.observedAt ?? query.completedAt,
    sourceVersion: query.result.version,
  };
}

/** The TTL covers waiting for the command, empty pickup and loading. It is
 * not a delivery promise, and does not extend an existing bilateral hold. */
export function dispatchReservationEstimate(pickup, execution = null) {
  const reservation = execution?.reservation,
    delivery = execution?.delivery;
  const defaultTtlMs =
    Number.isSafeInteger(reservation?.defaultTtlMs) &&
    reservation.defaultTtlMs > 0 &&
    reservation.defaultTtlMs <= MAX_DISPATCH_TTL_MS
      ? reservation.defaultTtlMs
      : DEFAULT_DISPATCH_TTL_MS;
  const maxTtlMs =
    Number.isSafeInteger(reservation?.maxTtlMs) &&
    reservation.maxTtlMs >= defaultTtlMs &&
    reservation.maxTtlMs <= MAX_DISPATCH_TTL_MS
      ? reservation.maxTtlMs
      : MAX_DISPATCH_TTL_MS;
  const timingKnown =
    Number.isFinite(pickup?.seconds) &&
    pickup.seconds >= 0 &&
    Number.isFinite(delivery?.loadMs) &&
    delivery.loadMs >= 0 &&
    Number.isFinite(delivery?.commandNominalLatencyMs) &&
    delivery.commandNominalLatencyMs >= 0;
  const minimumTtlMs = timingKnown
    ? Math.ceil(
        pickup.seconds * 1000 +
          delivery.loadMs +
          delivery.commandNominalLatencyMs +
          RESERVATION_MARGIN_MS,
      )
    : null;
  return {
    defaultTtlMs,
    maxTtlMs,
    timingKnown,
    minimumTtlMs,
    recommendedTtlMs: timingKnown
      ? Math.max(defaultTtlMs, Math.ceil(minimumTtlMs / 60000) * 60000)
      : defaultTtlMs,
    pickupMs: Number.isFinite(pickup?.seconds)
      ? Math.ceil(pickup.seconds * 1000)
      : null,
    loadMs: timingKnown ? delivery.loadMs : null,
    commandNominalLatencyMs: timingKnown
      ? delivery.commandNominalLatencyMs
      : null,
    marginMs: RESERVATION_MARGIN_MS,
    sourcePolicyQuery: execution?.queryId ?? null,
    sourcePolicyVersion: execution?.sourceVersion ?? null,
    sourcePolicyObservedAt: execution?.observedAt ?? null,
    note: "Nominal received pickup and loading timing plus a declared two-minute margin; congestion or outages may exceed it. Existing commitments are never extended.",
  };
}

export function validateDispatchTtl(ttlMs, estimate) {
  const ttl = ttlMs ?? estimate.defaultTtlMs;
  check(
    Number.isSafeInteger(ttl) &&
      ttl > 0 &&
      ttl <= estimate.maxTtlMs &&
      ttl <= MAX_DISPATCH_TTL_MS,
    "RESERVATION_TTL",
    "A dispatch reservation must be an integer duration within the source's 24-hour limit.",
  );
  check(
    !estimate.timingKnown || ttl >= estimate.minimumTtlMs,
    "RESERVATION_TOO_SHORT",
    "The approved reservation expires before the received pickup, loading and declared margin. Prepare a new duration for owner review.",
    409,
  );
  return ttl;
}
