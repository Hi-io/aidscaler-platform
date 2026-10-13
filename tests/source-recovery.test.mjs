import test from 'node:test';
import assert from 'node:assert/strict';
import { sealSourceCohort, sourceRecoveryDisposition, runSourceRecovery, selectSourceRetries } from '../scripts/source-recovery.mjs';

const source = { id: 'public-post', sourceVersion: 2, publishedAt: 1000, text: 'Families need water.', location: null, attachments: [] };
const receipt = { id: 'read-2', state: 'interpreted_unverified', sources: [{ id: source.id, version: 2 }],
  coverage: { truncatedSources: [], rejectedObservations: [] } };

test('source recovery seals received versions and requires durable original plus provenance receipt', () => {
  const item = sealSourceCohort([source])[0];
  assert.equal(sourceRecoveryDisposition(item, { current: source, receipts: [receipt] }).disposition, 'missing_durable_version');
  assert.equal(sourceRecoveryDisposition(item, { current: source, retainedVersion: true }).disposition, 'pending');
  const read = sourceRecoveryDisposition(item, { current: source, retainedVersion: true, receipts: [receipt] });
  assert.equal(read.closed, true);
  assert.equal(read.disposition, 'valid_semantic_receipt_unverified');
  const before = item.contentHash;
  item.source.text = 'fixture edit';
  assert.equal(item.contentHash, before);
  assert.equal(source.text, 'Families need water.');
});

test('deleted, revised and silent content changes cannot be closed by a stale receipt or free parser', () => {
  const item = sealSourceCohort([source])[0];
  for (const current of [{ ...source, sourceVersion: 3 }, { ...source, text: 'Withdrawn.' }, { ...source, deleted: true }]) {
    const result = sourceRecoveryDisposition(item, { current, retainedVersion: true, receipts: [receipt],
      freeDisposition: { disposition: 'explicit_free_unverified' } });
    assert.equal(result.closed, false);
    assert.equal(result.disposition, 'source_revision_pending');
  }
});

test('truncated or rejected reading retains attention; a valid later exact-version receipt may acknowledge recovery', () => {
  const item = sealSourceCohort([source])[0];
  const truncated = { ...receipt, id: 'truncated', coverage: { truncatedSources: [source.id] } };
  const rejected = { ...receipt, id: 'rejected', coverage: { rejectedObservations: [{ index: 0 }] } };
  for (const bad of [truncated, rejected, { ...receipt, sources: [{ id: source.id, version: 1 }] }])
    assert.equal(sourceRecoveryDisposition(item, { current: source, retainedVersion: true, receipts: [bad] }).closed, false);
  assert.equal(sourceRecoveryDisposition(item, { current: source, retainedVersion: true, receipts: [rejected, receipt] }).closed, true);
});

test('source retries are exact-version, bounded, cooled down and never close missing or revised sources', () => {
  const cohort = sealSourceCohort([source, { ...source, id: 'different' }]);
  const attempts = new Map(cohort.map(s => [s.key, { count: 1, availableAt: 1000 }]));
  const dispositions = cohort.map(s => ({ key: s.key, closed: false, disposition: 'rejected_pending_review' }));
  assert.deepEqual(selectSourceRetries(cohort, dispositions, attempts, 2000), []);
  assert.deepEqual(selectSourceRetries(cohort, dispositions, attempts, 61000, { batchSize: 1 }).map(s => s.key), [cohort[0].key]);
  attempts.set(cohort[0].key, { count: 2, availableAt: 1000 });
  assert.deepEqual(selectSourceRetries(cohort, dispositions, attempts, 61000).map(s => s.key), [cohort[1].key]);
  for (const state of ['source_revision_pending', 'missing_durable_version'])
    assert.deepEqual(selectSourceRetries(cohort, dispositions.map(s => ({ ...s, disposition: state })), attempts, 61000), []);
  assert.deepEqual(selectSourceRetries(cohort, dispositions.map(s => ({ ...s, closed: true })), attempts, 61000), []);
});

test('no-paid HTTP recovery fixture retains the fixed cohort, finite physical checks and truthful queue censoring', { timeout: 180000 }, async () => {
  const report = await runSourceRecovery({ mode: 'parser', seed: 'source-recovery-fixture-01', count: 2, noise: 4,
    reposts: 1, grid: 5, extentKm: 2, horizonMs: 3600000, formalDelayMs: 1800000,
    wallLimitMs: 120000, writeReport: false });
  assert.equal(report.paidCalls, 0);
  assert.equal(report.http.blockedExternal, 0);
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.invariants, []);
  assert.ok(report.results.eligible >= 8);
  assert.equal(report.results.eligible, report.cohort.length);
  assert.equal(report.dispositions.length, report.cohort.length);
  assert.equal(report.results.closed + report.results.retainedAttention, report.results.eligible);
  assert.ok(report.results.durable.every(r => r.cohortVersionRows === report.cohort.length));
  assert.ok(report.http.calls > 0);
  assert.ok(report.providerCalls.length > 0);
  assert.ok(report.confirmations.length > 0);
  assert.ok(report.sourceReviewReceipts.length > 0);
  assert.ok(report.sourceReviewReceipts.every(r => r.reviewedAt == null || r.reviewedAt >= r.createdAt));
  assert.equal(report.finalBuilds.invalidStatus, null);
  assert.ok(report.results.physicalSufficient >= 1);
  if (report.status === 'recovered') {
    assert.equal(report.results.retainedAttention, 0);
    assert.equal(report.localState.openJobs, 0);
    assert.equal(report.localState.openProposals, 0);
    assert.equal(report.localState.uncoveredReceivedNeeds, 0);
    assert.equal(report.recoveryCensored, false);
  } else {
    assert.ok(['incomplete_horizon', 'incomplete_wall_limit', 'incomplete_source_attention'].includes(report.status), report.status);
    assert.equal(report.recoveryCensored, true);
  }
});
