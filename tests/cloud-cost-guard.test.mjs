import { test } from 'node:test';
import assert from 'node:assert/strict';
import { infrastructureBudgetEvent } from '../src/cloud/cost-guard.mjs';
test('infrastructure cutoff excludes other budgets, rejects stale months and stops before USD 100', () => {
  const now = Date.UTC(2026, 9, 18);
  const event = { budgetDisplayName: 'AidScaler infrastructure USD 100', currencyCode: 'USD',
    costIntervalStart: '2026-10-01T00:00:00Z', costAmount: 55 };
  assert.equal(infrastructureBudgetEvent(event, now).pause, false);
  assert.equal(infrastructureBudgetEvent({ ...event, costAmount: 70 }, now).pause, true);
  assert.equal(infrastructureBudgetEvent({ ...event, forecastThresholdExceeded: 1 }, now).pause, true);
  assert.deepEqual(infrastructureBudgetEvent({ ...event, costIntervalStart: '2026-09-01T00:00:00Z' }, now), { stale: true });
  assert.throws(() => infrastructureBudgetEvent({ ...event, budgetDisplayName: 'Gemini tokens' }, now), /SCOPE/);
});

test('THB deployment preserves the conservative local-currency cutoff and rejects USD messages', () => {
  const now = Date.UTC(2026, 9, 18), policy = { currency: 'THB', units: 3000, pause: 2100 };
  const event = { budgetDisplayName: 'AidScaler infrastructure THB 3000', currencyCode: 'THB',
    costIntervalStart: '2026-10-01T00:00:00Z', costAmount: 1650 };
  assert.equal(infrastructureBudgetEvent(event, now, policy).pause, false);
  assert.equal(infrastructureBudgetEvent({ ...event, costAmount: 2100 }, now, policy).pause, true);
  assert.equal(infrastructureBudgetEvent({ ...event, forecastThresholdExceeded: 1 }, now, policy).pause, true);
  assert.throws(() => infrastructureBudgetEvent({ ...event, currencyCode: 'USD' }, now, policy), /SCOPE/);
});
