import path from 'node:path';

const paidArms = new Set(['B6', 'B9']);
const armNames = new Set(['B0', 'B5', 'B6', 'B8', 'B9']);
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const requireThat = (condition, message) => { if (!condition) throw Error(message); };
const identity = (profile, seed, arm) => JSON.stringify([profile, seed, arm]);

/** Pure admission only: no provider, application, evaluator or file-system I/O.
 * A failed/unknown paid attempt cannot become a favorable retry under the same
 * declaration. A fresh explicit declaration is required for any later study. */
export function assertStreamPaidAdmission(index, settled, { plan, section } = {}) {
  requireThat(!index.phases?.some(p => p.phase === 'paid') &&
    !index.runs?.some(r => paidArms.has(r.arm)), 'A paid phase or attempt already exists; never reuse this index for a paid retry');
  const phases = (index.phases ?? []).filter(p => p.phase === 'free');
  requireThat(phases.length === 1 && !phases[0].invalid && !phases[0].stopped,
    'Exactly one successfully closed free phase is required');
  requireThat(Array.isArray(index.profiles) && index.profiles.length > 0 && Array.isArray(index.runs),
    'A complete declared free matrix is required');
  if (plan) {
    requireThat(['primary', 'controls'].includes(section), 'Unknown declaration section');
    const declared = section === 'primary' ? [{ ...plan.primary, name: 'primary' }]
      : plan.controls.map(c => ({ ...plan.primary, ...c }));
    requireThat(declared.length === index.profiles.length && declared.every((p, i) =>
      canonical(p) === canonical(index.profiles[i].p) && p.name === index.profiles[i].name),
      'Index profiles differ from the exact hashed plan');
  }
  const expected = new Map(), profileNames = new Set(), folders = new Set();
  for (const profile of index.profiles) {
    const p = profile.p;
    requireThat(typeof profile.name === 'string' && !profileNames.has(profile.name) &&
      typeof profile.folder === 'string' && !folders.has(path.resolve(profile.folder)), 'Duplicate or malformed declared profile');
    profileNames.add(profile.name); folders.add(path.resolve(profile.folder));
    requireThat(p && Number.isSafeInteger(p.seeds) && p.seeds > 0 && typeof p.seedPrefix === 'string' && p.seedPrefix &&
      Array.isArray(p.arms) && p.arms.length > 0 && new Set(p.arms).size === p.arms.length && p.arms.every(a => armNames.has(a)),
      'Invalid declared seed/arm matrix');
    for (let i = 1; i <= p.seeds; i++) for (const arm of p.arms.filter(a => !paidArms.has(a))) {
      const seed = p.seedPrefix + '-' + String(i).padStart(2, '0');
      const key = identity(profile.folder, seed, arm);
      requireThat(!expected.has(key), 'Duplicate declared free task');
      expected.set(key, { seed, arm, file: path.resolve(profile.folder, `${seed}-${arm}.json`) });
    }
  }
  requireThat(expected.size > 0 && index.runs.length === expected.size, 'The declared free matrix has missing or additional attempts');
  const actual = new Map();
  for (const attempt of index.runs) {
    const key = identity(attempt.folder, attempt.seed, attempt.arm), task = expected.get(key);
    requireThat(task && !actual.has(key), 'Duplicate or undeclared free attempt');
    requireThat(attempt.status === 'completed' && typeof attempt.file === 'string' &&
      path.resolve(attempt.file) === task.file, 'A declared free attempt is missing, failed or lacks its exact outcome');
    actual.set(key, attempt);
  }
  requireThat(Array.isArray(settled) && settled.length === expected.size, 'Every declared free outcome must be loaded once');
  const loaded = new Set(), fp = index.fingerprints;
  requireThat(fp?.candidateFingerprint && fp?.evaluatorFingerprint && fp?.simulatorFingerprint, 'Missing frozen source hashes');
  for (const item of settled) {
    requireThat(item && typeof item.file === 'string', 'Missing outcome path');
    const file = path.resolve(item.file), task = [...expected.values()].find(t => t.file === file), r = item.report;
    requireThat(task && !loaded.has(file), 'Duplicate or undeclared outcome file'); loaded.add(file);
    requireThat(r?.arm === task.arm && r.seed === task.seed && r.status === 'completed' &&
      Array.isArray(r.errors) && !r.errors.length && Array.isArray(r.invariants) && !r.invariants.length,
      'Free outcomes must be complete without errors or invariant violations');
    requireThat(r.candidateChanged === false && r.evaluatorChanged === false && r.simulatorChanged === false &&
      r.candidateFingerprint === fp.candidateFingerprint && r.finalCandidateFingerprint === fp.candidateFingerprint &&
      r.evaluatorFingerprint === fp.evaluatorFingerprint && r.finalEvaluatorFingerprint === fp.evaluatorFingerprint &&
      r.manifest?.engineBuild === fp.simulatorFingerprint && r.finalEngineBuild === fp.simulatorFingerprint,
      'Every free outcome must retain all three exact initial/final hashes');
    requireThat(Array.isArray(r.usage) && !r.usage.length && r.costUsd === 0 && r.chargedBudgetUsd === 0,
      'Free controls must retain zero provider calls and zero known or reserved charge');
  }
  return { freeTasks: expected.size, freeOutcomes: loaded.size };
}
