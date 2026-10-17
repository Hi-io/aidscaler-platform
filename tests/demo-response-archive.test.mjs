import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, hash } from '../src/store.mjs';
import { archiveDemoBaseResponse } from '../src/demo-response-archive.mjs';
import { observeSourceConnection } from '../src/source-connection.mjs';

test('explicit automated-base recovery preserves a verifiable complete response and admits no historic job', async t => {
  const store = await Store.open(), restored = await Store.open();
  t.after(async () => { await store.close(); await restored.close(); });
  const org = 'org0', visitor = 'demo-org-1';
  await store.organization(org, 'Relief North'); await store.organization(visitor, 'Harbor Support');
  await store.put(org, 'resource', 'water', { owner: org, type: 'water', quantity: 90, reserved: 0, floor: 0 }, 0);
  await store.put(org, 'proposal', 'old-authorized-plan', { state: 'authorized', authorization: { by: 'previous-owner' },
    references: ['water'], actions: [{ type: 'dispatch', owner: org, params: { resource: 'water', quantity: 40 } }] }, 0);
  await store.put(org, 'context', 'geography', { map: null }, 0);
  const map = { nodes: [{ id: 'old-node', x: 1, z: 2 }], roads: [] }, digest = hash(map);
  await store.query('INSERT INTO entity_fragments(org,digest,data) VALUES($1,$2,$3)', [org, digest, JSON.stringify(map)]);
  await store.query("UPDATE entities SET data_refs=$2 WHERE org=$1 AND kind='context'", [org, JSON.stringify([{ path: ['map'], digest }])]);
  const beforeStock = await store.get(org, 'resource', 'water'), beforeMap = await store.get(org, 'context', 'geography');
  await store.command(org, 'old-physical-command', {}, async () => ({ operation: 'old-physical-operation' }));
  await store.enqueue(org, 'execute_proposal', { id: 'old-authorized-plan' }, 'old-execution-job');
  await store.audit(org, 'previous-owner', 'proposal.approve', 'old-authorized-plan', { exactVersion: 1 });
  const oldAudit = (await store.query('SELECT * FROM audit WHERE org=$1', [org])).rows;
  await store.query("INSERT INTO usage(id,org,episode,model,request_hash,state,started_at,cost_usd,reserved_usd) VALUES('old-paid-call',$1,'old-response','fixture','digest','completed',1,0.25,0)", [org]);
  await store.query("INSERT INTO inbox(org,message_id,sender,received_at) VALUES($1,'old-signed-message','org1',1)", [org]);
  await store.query("INSERT INTO finance(org,id,type,amount_cents,currency,created_at) VALUES($1,'old-money','credit',100,'USD',1)", [org]);
  await store.put(org, 'source_connection', 'simulator', { state: 'requires_new_response', sourceInstance: 'previous-epoch-000000',
    observedSourceInstance: 'current-epoch-0000000', reason: 'source_rejected_previous_response', runId: 'same-demo-run', simulatedAt: 9000 }, 0);
  await store.put(visitor, 'source_connection', 'simulator', { state: 'requires_new_response', runId: 'same-demo-run' }, 0);
  await store.put(visitor, 'proposal', 'visitor-pending', { state: 'awaiting_review' }, 0);
  const frame = { episodeId: 'current-epoch-0000000', runId: 'same-demo-run', continuousDemo: true, spectatorOnly: true,
    organizations: [{ id: org, automated: true }, { id: visitor, demoVisitor: true, automated: false }] };
  const input = { store, enabled: true, workersStopped: true, organization: org, frame };
  assert.equal((await archiveDemoBaseResponse({ ...input, enabled: false })).archived, false);
  await assert.rejects(archiveDemoBaseResponse({ ...input, workersStopped: false }), { code: 'DEMO_ARCHIVE_WRITERS' });
  await assert.rejects(archiveDemoBaseResponse({ ...input, organization: visitor }), { code: 'DEMO_ARCHIVE_BASE_ONLY' });
  await assert.rejects(archiveDemoBaseResponse({ ...input, frame: { ...frame, runId: 'another-scenario' } }), { code: 'DEMO_ARCHIVE_RUN' });

  // Inject a deletion failure inside the transaction: the active response,
  // jobs and archive must roll back together, rather than leave a partial reset.
  const transaction = store.transaction.bind(store);
  store.transaction = fn => transaction(tx => {
    const query = tx.query.bind(tx);
    tx.query = (sql, values) => { if (sql === 'DELETE FROM entities WHERE org=$1') throw Error('fixture deletion failed'); return query(sql, values); };
    return fn(tx);
  });
  await assert.rejects(archiveDemoBaseResponse(input), /fixture deletion failed/);
  store.transaction = transaction;
  assert.deepEqual(await store.get(org, 'resource', 'water'), beforeStock);
  assert.equal((await store.query('SELECT COUNT(*) AS n FROM demo_response_archives')).rows[0].n, 0);
  assert.equal((await store.query("SELECT COUNT(*) AS n FROM jobs WHERE org=$1", [org])).rows[0].n, 1);

  const result = await archiveDemoBaseResponse(input);
  assert.equal(result.archived, true);
  const archive = (await store.query('SELECT * FROM demo_response_archives WHERE id=$1', [result.id])).rows[0];
  assert.equal(hash(archive.payload), archive.digest); assert.equal(result.digest, archive.digest);
  assert.equal(archive.payload.readOnly, true);
  assert.equal(archive.payload.tables.jobs[0].state, 'queued');
  assert.equal(archive.payload.tables.idempotency[0].result.operation, 'old-physical-operation');
  assert.equal((await store.query('SELECT COUNT(*) AS n FROM jobs WHERE org=$1', [org])).rows[0].n, 0);
  assert.equal(await store.get(org, 'proposal', 'old-authorized-plan', false), null);
  assert.equal((await store.query('SELECT * FROM usage WHERE org=$1', [org])).rows[0].cost_usd, 0.25, 'paid usage never resets');
  assert.equal((await store.query('SELECT * FROM inbox WHERE org=$1', [org])).rows[0].message_id, 'old-signed-message', 'old signed messages cannot replay');
  assert.equal((await store.query('SELECT * FROM finance WHERE org=$1', [org])).rows[0].amount_cents, 100);
  assert.deepEqual((await store.query('SELECT * FROM audit WHERE org=$1 ORDER BY sequence', [org])).rows.slice(0, oldAudit.length), oldAudit, 'the original audit chain is unchanged');
  assert.equal((await store.get(visitor, 'source_connection', 'simulator')).state, 'requires_new_response');
  assert.equal((await store.get(visitor, 'proposal', 'visitor-pending')).state, 'awaiting_review');

  // The archive can reconstruct the exact old, fragmented evidence in a
  // separate offline store. It is never fed to the new operational workers.
  await restored.organization(org);
  for (const row of archive.payload.tables.entity_fragments)
    await restored.query('INSERT INTO entity_fragments(org,digest,data) VALUES($1,$2,$3)', [org, row.digest, JSON.stringify(row.data)]);
  for (const row of archive.payload.tables.entities)
    await restored.query('INSERT INTO entities(org,kind,id,version,data,created_at,updated_at,data_refs) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [org, row.kind, row.id, row.version, JSON.stringify(row.data), row.created_at, row.updated_at, JSON.stringify(row.data_refs)]);
  assert.deepEqual(await restored.get(org, 'resource', 'water'), beforeStock);
  assert.deepEqual(await restored.get(org, 'context', 'geography'), beforeMap);
  assert.equal((await restored.get(org, 'proposal', 'old-authorized-plan')).authorization.by, 'previous-owner');
  const connected = await observeSourceConnection(store, org, { sourceInstance: frame.episodeId, runId: frame.runId, now: 1000 });
  assert.equal(connected.state, 'connected', 'a fresh context binds independently; no old latch or plan was unlocked');
  assert.equal((await archiveDemoBaseResponse(input)).archived, false, 'the explicit maintenance flag is idempotent after a fresh bind');
  assert.equal((await store.query('SELECT COUNT(*) AS n FROM demo_response_archives')).rows[0].n, 1);
});
