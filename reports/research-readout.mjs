import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pairedBootstrap } from '../src/evaluation.mjs';

const folder = resolve(process.argv[2] ?? '');
const protocol = JSON.parse(await readFile(resolve(folder, 'protocol.json'), 'utf8'));
if (!['repair', 'inquiry'].includes(protocol.kind)) throw Error('Expected a declared research ablation folder.');
const rows = [], missing = [];
for (const scenario of protocol.scenarios)
  for (let i = 1; i <= protocol.seeds; i++)
    for (const treatment of protocol.treatments) {
      const seed = 'research-ablation-' + String(i).padStart(2, '0'),
        file = `${scenario}-${seed}-${treatment}.json`;
      let r;
      try { r = JSON.parse(await readFile(resolve(folder, file), 'utf8')); }
      catch (e) { if (e.code === 'ENOENT') { missing.push(file); continue; } throw e; }
      const usages = r.usage ?? [], knownWall = usages.filter(u => Number.isFinite(u.wall_ms));
      rows.push({ scenario, seed, treatment, file, raw: r, status: r.status,
        errors: r.errors ?? (r.error ? [r.error] : []), candidateChanged: r.candidateChanged ?? false,
        metrics: { services: r.metrics.services, collective: r.metrics.collective,
          response: r.metrics.response, perCommunity: r.metrics.perCommunity,
          queries: r.metrics.queries, toolCost: r.metrics.cost,
          physical: r.metrics.physical, operatorReviewMs: r.metrics.operatorReviewMs,
          ledgerValid: r.metrics.ledgerValid, invalidActions: r.metrics.invalidActions },
        before: r.before ?? null, after: r.after ?? null,
        physicalRepairSucceeded: r.before == null ? null : r.after?.delivered === r.before.loaded
          && r.after?.operationId === r.before.operationId && r.after?.deliveryOperationCount === 1
          && r.after?.rerouteReceived === true && r.after?.proposalState === 'completed'
          && r.invariants.length === 0,
        usage: { calls: usages.length, knownProviderWallMs: knownWall.reduce((s,u) => s+u.wall_ms,0),
          providerWallRecordsMissing: usages.length - knownWall.length,
          failedCalls: usages.filter(u => u.state === 'failed').length,
          costUsd: r.costUsd, chargedBudgetUsd: r.chargedBudgetUsd,
          unknownCostCalls: usages.filter(u => u.cost_usd == null).length },
        totalWallMs: r.wallMs,
        researchAttempts: (r.activities ?? (r.activity ? [r.activity] : [])).map(a => ({
          round: a.round, state: a.state, calls: a.calls, atSim: a.atSim,
          wallMs: a.wallMs, researchAblation: a.researchAblation,
          errors: a.error ?? null,
        })),
        invariants: r.invariants,
      });
    }
const contrasts = [];
for (const scenario of protocol.scenarios) {
  const baseline = rows.filter(r => r.scenario === scenario && r.treatment === protocol.treatments[0]);
  const candidate = rows.filter(r => r.scenario === scenario && r.treatment === protocol.treatments[1]);
  if (baseline.length !== protocol.seeds || candidate.length !== protocol.seeds
    || [...baseline, ...candidate].some(r => r.candidateChanged)) {
    contrasts.push({ scenario, comparisonRejected: true,
      reason: 'Incomplete declared pairs or candidate changed; no partial-world improvement estimate.' });
    continue;
  }
  for (const resource of new Set([...baseline, ...candidate].flatMap(r => Object.keys(r.raw.metrics.services)))) {
    try {
      contrasts.push({ scenario, resource, ...pairedBootstrap(baseline.map(r => r.raw),
        candidate.map(r => r.raw), { resource }) });
    } catch (e) { contrasts.push({ scenario, resource, comparisonRejected: true, reason: e.code ?? e.name }); }
  }
}
const unexpectedFiles = (await readdir(folder)).filter(f => /^S\d\d-research-ablation-\d\d-.*\.json$/.test(f)
  && !rows.some(r => r.file === f) && !missing.includes(f));
const result = { at: new Date().toISOString(), protocol: 'protocol.json', complete: missing.length === 0,
  missing, unexpectedFiles, internalAblationOnly: true,
  note: 'Preserve failure outcomes and per-resource tradeoffs. Fewer queries or a repair draft alone do not demonstrate executed useful service. One/two seeds do not support general claims.',
  rows: rows.map(({ raw, ...r }) => r), contrasts,
  costUsd: rows.reduce((s, r) => s + r.usage.costUsd, 0),
  chargedBudgetUsd: rows.reduce((s, r) => s + r.usage.chargedBudgetUsd, 0),
  unknownCostCalls: rows.reduce((s, r) => s + r.usage.unknownCostCalls, 0) };
await writeFile(resolve(folder, 'research-readout.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ complete: result.complete, missing, unexpectedFiles,
  rows: result.rows.map(r => ({ scenario: r.scenario, seed: r.seed, treatment: r.treatment,
    status: r.status, physicalRepairSucceeded: r.physicalRepairSucceeded,
    queries: r.metrics.queries, tools: r.metrics.toolCost, calls: r.usage.calls,
    costUsd: r.usage.costUsd, unknownCostCalls: r.usage.unknownCostCalls,
    providerWallMs: r.usage.knownProviderWallMs, errors: r.errors, invariants: r.invariants.length })), contrasts,
}, null, 2));
