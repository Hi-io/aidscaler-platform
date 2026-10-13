import test from 'node:test';
import assert from 'node:assert/strict';
import { runSourceRecovery } from '../scripts/source-recovery.mjs';

test('a requested source-recovery stop preserves a censored outcome and usage instead of claiming recovery', { timeout: 90000 }, async () => {
  const report = await runSourceRecovery({ mode: 'parser', seed: 'source-recovery-stop', count: 2, noise: 2,
    grid: 5, extentKm: 2, horizonMs: 3600000, formalDelayMs: 1800000,
    wallLimitMs: 60000, writeReport: false, shouldStop: () => true });
  assert.equal(report.status, 'aborted_operator');
  assert.equal(report.recoveryCensored, true);
  assert.equal(report.paidCalls, 0);
  assert.equal(report.paidCostUsd, 0);
  assert.equal(report.usage.length, 0);
  assert.ok(report.cohort.length > 0);
  assert.ok(report.results.retainedAttention > 0);
  assert.equal(report.results.closed + report.results.retainedAttention, report.results.eligible);
  assert.deepEqual(report.invariants, []);
});
