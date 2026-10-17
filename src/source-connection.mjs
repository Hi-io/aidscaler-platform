import { AppError } from './errors.mjs';

export const SOURCE_INSTANCE_HEADER = 'X-AidScaler-Source-Instance';
export const SOURCE_RESPONSE_CHANGED = 'SOURCE_RESPONSE_CHANGED';
export const SOURCE_RESPONSE_MESSAGE = 'The simulator started a different response. This workspace is now read-only so earlier decisions and deliveries cannot affect the new response. Start a fresh response workspace; the previous records are retained.';
export const sourceConnection = (store, org) => (store.currentTransaction?.() ?? store).get(org, 'source_connection', 'simulator', false);
export function assertConnectionRecord(connection) {
  if (connection?.state === 'requires_new_response')
    throw new AppError(SOURCE_RESPONSE_CHANGED, SOURCE_RESPONSE_MESSAGE, 409);
  return connection;
}
export async function assertSourceResponseCurrent(store, org) {
  return assertConnectionRecord(await sourceConnection(store, org));
}
export const publicSourceConnection = connection => ({
  state: connection?.state ?? 'not_bound',
  reason: connection?.reason ?? null,
  message: connection?.state === 'requires_new_response' ? SOURCE_RESPONSE_MESSAGE : null,
});

// A response boundary is independent of the deterministic scenario runId. It
// is durable, has no reset/unlock endpoint, and never deletes historical work.
export async function observeSourceConnection(store, org, { sourceInstance, runId, now, rejected = false, clockIsCurrent } = {}) {
  const active = store.currentTransaction?.(), receipt = { sourceInstance, runId, now, rejected };
  const observe = async tx => {
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [org]);
    const prior = await sourceConnection(tx, org);
    // An HTTP reply can reach this function before a newer transaction-local
    // read, then wait for that transaction's SQL lock. Recheck request order
    // after acquiring the lock; its old clock is not evidence of a reset.
    // Instance/run identity checks below always apply, even to older replies.
    const observedNow = typeof clockIsCurrent === 'function' && !clockIsCurrent() ? undefined : now;
    if (prior?.state === 'requires_new_response') return prior;
    const historical = prior ? null : await tx.get(org, 'source', 'simulator', false),
      baseline = prior ?? (historical?.runId ? { runId: historical.runId, simulatedAt: historical.simulatedAt } : null);
    let reason = rejected ? 'source_rejected_previous_response' : null;
    if (!reason && baseline?.sourceInstance && sourceInstance !== undefined && sourceInstance !== baseline.sourceInstance)
      reason = sourceInstance ? 'source_instance_changed' : 'source_instance_unavailable';
    if (!reason && baseline?.runId && typeof runId === 'string' && runId !== baseline.runId) reason = 'scenario_changed';
    if (!reason && Number.isFinite(baseline?.simulatedAt) && Number.isFinite(observedNow) && observedNow < baseline.simulatedAt)
      reason = 'simulation_clock_rewound';
    if (reason) {
      if (active) {
        const error = new AppError(SOURCE_RESPONSE_CHANGED, SOURCE_RESPONSE_MESSAGE, 409);
        error.sourceBoundary = { org, receipt };
        throw error;
      }
      const blocked = await tx.put(org, 'source_connection', 'simulator', {
        ...baseline, state: 'requires_new_response', reason,
        detectedAt: Date.now(), observedSourceInstance: sourceInstance ?? null,
        observedRunId: runId ?? null, observedSimulatedAt: observedNow ?? null,
      }, prior?.version ?? 0);
      await tx.audit(org, 'source-boundary', 'source.response_changed', 'simulator', { reason, historicalRecordsPreserved: true });
      return blocked;
    }
    // Other endpoints may validate an existing binding, but only an actual
    // organization actor-state receipt may create the initial binding.
    if (!prior && typeof runId !== 'string') return null;
    const next = { ...prior, state: 'connected', sourceInstance: sourceInstance ?? prior?.sourceInstance ?? null,
      runId: runId ?? prior?.runId, simulatedAt: Number.isFinite(observedNow) ? observedNow : prior?.simulatedAt,
      boundAt: prior?.boundAt ?? Date.now(), reason: null };
    if (prior && next.sourceInstance === prior.sourceInstance && next.runId === prior.runId && next.simulatedAt === prior.simulatedAt) return prior;
    return tx.put(org, 'source_connection', 'simulator', next, prior?.version ?? 0);
  };
  const result = active ? await observe(active) : await store.transaction(observe);
  return assertConnectionRecord(result);
}
