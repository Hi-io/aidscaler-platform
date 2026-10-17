import { check } from './errors.mjs';
import { hash } from './store.mjs';

const archivedTables = new Map([
  ['entities', 'kind,id'], ['entity_fragments', 'digest'], ['jobs', 'id'], ['idempotency', 'key'],
]);

/** Explicit host maintenance for the four AUTOMATED demonstration teams only.
 * An earlier response is archived intact, never rebound or executed. Call only
 * before creating any gateway/app workers, with a verified current demo frame.
 * Visitors, audit chains, billing, users, replay receipts and money are untouched.
 */
export async function archiveDemoBaseResponse({ store, enabled = false, workersStopped = false, organization, frame } = {}) {
  if (!enabled) return { archived: false, reason: 'not_enabled' };
  check(workersStopped === true, 'DEMO_ARCHIVE_WRITERS', 'Stop all platform writers before archiving a base response.', 409);
  check(frame?.continuousDemo === true && frame?.spectatorOnly === true && typeof frame.episodeId === 'string' && frame.episodeId.length >= 16 &&
    typeof frame.runId === 'string', 'DEMO_ARCHIVE_SOURCE', 'A current continuous-demo source identity is required.', 409);
  const base = frame.organizations?.find(o => o.id === organization);
  check(/^org[0-3]$/.test(organization ?? '') && base && base.automated === true && !base.demoVisitor,
    'DEMO_ARCHIVE_BASE_ONLY', 'Only the four automated demonstration base teams can use this maintenance operation.', 403);
  await store.exec(`CREATE TABLE IF NOT EXISTS demo_response_archives(
    id text PRIMARY KEY,org text NOT NULL,retired_at bigint NOT NULL,digest text NOT NULL,payload jsonb NOT NULL)`);
  const result = await store.transaction(async tx => {
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [organization]);
    const connection = await tx.get(organization, 'source_connection', 'simulator', false);
    if (connection?.state !== 'requires_new_response') return { archived: false, reason: 'no_fenced_response' };
    check(connection.runId === frame.runId, 'DEMO_ARCHIVE_RUN', 'This maintenance allowance does not cross a scenario boundary.', 409);
    const payload = { format: 'aidscaler-demo-base-response-archive-v1', readOnly: true, organization,
      previousConnection: connection, nextSource: { instance: frame.episodeId, runId: frame.runId },
      retiredAt: Date.now(), tables: {} };
    for (const [table, order] of archivedTables)
      payload.tables[table] = (await tx.query(`SELECT * FROM ${table} WHERE org=$1 ORDER BY ${order}`, [organization])).rows;
    const id = 'base-response-' + hash([organization, connection, frame.episodeId]).slice(0, 40), digest = hash(payload);
    check(!(await tx.query('SELECT id FROM demo_response_archives WHERE id=$1', [id])).rows.length,
      'DEMO_ARCHIVE_CONFLICT', 'An archive for this response already exists. Preserve both records for inspection.', 409);
    await tx.query('INSERT INTO demo_response_archives(id,org,retired_at,digest,payload) VALUES($1,$2,$3,$4,$5)',
      [id, organization, payload.retiredAt, digest, JSON.stringify(payload)]);
    const saved = (await tx.query('SELECT digest,payload FROM demo_response_archives WHERE id=$1', [id])).rows[0];
    check(saved.digest === digest && hash(saved.payload) === digest, 'DEMO_ARCHIVE_HASH', 'The complete response archive could not be verified.', 500);
    // Deletion from the active partition is committed only with the verified
    // archive. No archived authorization/job is admitted into the fresh context.
    for (const table of ['jobs', 'idempotency', 'entities', 'entity_fragments'])
      await tx.query(`DELETE FROM ${table} WHERE org=$1`, [organization]);
    const counts = Object.fromEntries(Object.entries(payload.tables).map(([table, rows]) => [table, rows.length]));
    await tx.audit(organization, 'demo-host-maintenance', 'demo.base_response_archived', id,
      { archive: id, digest, counts, previousSourceInstance: connection.sourceInstance, nextSourceInstance: frame.episodeId,
        runId: frame.runId, historicJobsAdmitted: false, visitorsUnchanged: true, auditAndUsageRetained: true });
    return { archived: true, id, organization, digest, counts };
  });
  if (result.archived) for (const key of store.fragmentCache.keys()) if (key.startsWith(organization + '/')) store.fragmentCache.delete(key);
  return result;
}
