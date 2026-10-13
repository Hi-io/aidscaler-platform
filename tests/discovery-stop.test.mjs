import test from 'node:test';
import assert from 'node:assert/strict';
import { runDiscoveryEpisode } from '../evaluation/discovery-benchmark.mjs';

test('asynchronous stop policy is awaited, with prior work and censoring retained', async () => {
  let boundaries = 0;
  const result = await runDiscoveryEpisode({ arm: 'B5', seed: 'async-stop-finite-01', count: 4, noise: 0, reposts: 0,
    horizonMs: 1800000, humanReadMs: 30000, formalDelayMs: 0,
    shouldStop: async () => ++boundaries > 3,
    provider: { complete: async () => { throw Error('This control must not call a model'); } } });
  assert.equal(boundaries, 4);
  assert.equal(result.status, 'aborted');
  assert.ok(result.operationalDiagnostics.planningTurns > 0);
  assert.equal(result.errors.filter(e => e.code === 'CAMPAIGN_INTERRUPTED').length, 1);
  assert.equal(result.usage.length, 0);
  assert.equal(result.chargedBudgetUsd, 0);
  assert.equal(result.invariants.length, 0);
  assert.equal(result.outcomes.length, 4);
  assert.equal(result.candidateChanged, false);
  assert.equal(result.evaluatorChanged, false);
  assert.equal(result.simulatorChanged, false);
});
