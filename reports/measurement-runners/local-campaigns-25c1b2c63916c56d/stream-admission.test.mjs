import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStreamPaidAdmission } from './stream-admission.mjs';

function fixture() {
  const p = { name: 'primary', seeds: 2, seedPrefix: 'fair', arms: ['B5', 'B6', 'B8', 'B9'], needs: 24 };
  const fingerprints = { candidateFingerprint: 'candidate', evaluatorFingerprint: 'evaluator', simulatorFingerprint: 'source' };
  const index = { fingerprints, profiles: [{ name: p.name, folder: 'reports/declared/primary', p }],
    phases: [{ phase: 'free', stopped: false, invalid: false }], runs: [] }, settled = [];
  for (let n = 1; n <= 2; n++) for (const arm of ['B5', 'B8']) {
    const seed = `fair-0${n}`, file = `reports/declared/primary/${seed}-${arm}.json`;
    index.runs.push({ folder: 'reports/declared/primary', seed, arm, file, status: 'completed', chargedBudgetUsd: 0 });
    settled.push({ file, report: { seed, arm, status: 'completed', errors: [], invariants: [], usage: [], costUsd: 0,
      chargedBudgetUsd: 0, candidateChanged: false, evaluatorChanged: false, simulatorChanged: false,
      candidateFingerprint: 'candidate', finalCandidateFingerprint: 'candidate', evaluatorFingerprint: 'evaluator',
      finalEvaluatorFingerprint: 'evaluator', manifest: { engineBuild: 'source' }, finalEngineBuild: 'source' } });
  }
  return { index, settled, plan: { primary: { ...p, name: undefined } } };
}
test('complete exact free matrix admits paid once without importing a provider', () => {
  const { index, settled, plan } = fixture();
  assert.deepEqual(assertStreamPaidAdmission(index, settled, { plan, section: 'primary' }), { freeTasks: 4, freeOutcomes: 4 });
});
test('missing or attempted-failed free worlds cannot admit paid', () => {
  for (const mode of ['missing', 'exception', 'missing_file']) {
    const { index, settled } = fixture();
    if (mode === 'missing') { index.runs.pop(); settled.pop(); }
    else if (mode === 'exception') index.runs[0].status = 'missing_after_exception';
    else delete index.runs[0].file;
    assert.throws(() => assertStreamPaidAdmission(index, settled), /matrix|missing|failed|outcome/);
  }
});
test('duplicate attempts or outcomes cannot replace missing declared worlds', () => {
  let f = fixture(); f.index.runs[3] = structuredClone(f.index.runs[0]);
  assert.throws(() => assertStreamPaidAdmission(f.index, f.settled), /Duplicate/);
  f = fixture(); f.settled[3] = structuredClone(f.settled[0]);
  assert.throws(() => assertStreamPaidAdmission(f.index, f.settled), /Duplicate/);
});
test('any prior paid attempt including unknown charge or budget skip blocks rerun', () => {
  for (const arm of ['B6', 'B9']) for (const status of ['missing_after_exception', 'not_launched_budget_cap', 'completed']) {
    const { index, settled } = fixture(); index.runs.push({ arm, status, chargedBudgetUsd: status === 'not_launched_budget_cap' ? 0 : 0.2 });
    assert.throws(() => assertStreamPaidAdmission(index, settled), /paid.*attempt|paid retry/);
  }
  const { index, settled } = fixture(); index.phases.push({ phase: 'paid', stopped: true });
  assert.throws(() => assertStreamPaidAdmission(index, settled), /paid phase|paid retry/);
});
test('free phase must close exactly once without interruption or invalidation', () => {
  for (const phases of [[], [{ phase: 'free', stopped: true }], [{ phase: 'free', invalid: true }],
    [{ phase: 'free' }, { phase: 'free' }]]) {
    const { index, settled } = fixture(); index.phases = phases;
    assert.throws(() => assertStreamPaidAdmission(index, settled), /closed free phase/);
  }
});
test('each report binds seed arm exact file and every initial and final source hash', () => {
  for (const [field, value] of [['arm', 'B9'], ['seed', 'other'], ['finalEngineBuild', 'changed'],
    ['candidateChanged', undefined], ['finalCandidateFingerprint', 'changed'], ['finalEvaluatorFingerprint', 'changed']]) {
    const { index, settled } = fixture(); settled[0].report[field] = value;
    assert.throws(() => assertStreamPaidAdmission(index, settled), /Free outcomes|three exact/);
  }
  const { index, settled } = fixture(); index.runs[0].file = 'reports/old/fair-01-B5.json';
  assert.throws(() => assertStreamPaidAdmission(index, settled), /exact outcome/);
});
test('failed, invariant-breaking and nonfree outcomes never pass admission', () => {
  for (const [field, value] of [['status', 'failed'], ['errors', [{ code: 'SOURCE' }]], ['invariants', ['cargo']],
    ['usage', [{ reserved_usd: 0.1 }]], ['costUsd', 0.01], ['chargedBudgetUsd', 0.1]]) {
    const { index, settled } = fixture(); settled[0].report[field] = value;
    assert.throws(() => assertStreamPaidAdmission(index, settled), /complete|zero provider/);
  }
});
test('index cannot alter the original hashed declaration to omit an arm or seed', () => {
  const { index, settled, plan } = fixture(); index.profiles[0].p.seeds = 1;
  assert.throws(() => assertStreamPaidAdmission(index, settled, { plan, section: 'primary' }), /exact hashed plan/);
});
