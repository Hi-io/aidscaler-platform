import { readFile, writeFile } from 'node:fs/promises';

const folder = new URL('.', import.meta.url);
const rows = [];
for (const variant of ['distributed', 'delayed']) {
  const file = `S19-delegated-final-2026-${variant}-01-B6.json`;
  const r = JSON.parse(await readFile(new URL(file, folder), 'utf8'));
  const actions = value => (value ?? []).map(a => ({
    type: a.type, owner: a.owner, dependsOn: a.dependsOn,
    params: a.params,
  }));
  const rounds = r.activities.map(a => ({
    round: a.round, org: a.org, atSim: a.atSim, state: a.state,
    calls: a.calls, reason: a.reason ?? null,
    tools: a.steps.filter(s => ['plan_assessment', 'plan_service', 'prepare_service',
      'plan_repair', 'draft_response', 'record_claim'].includes(s.tool)).map(s => ({
      tool: s.tool, state: s.state, error: s.result?.error ?? s.error ?? null,
      message: s.result?.message ?? null, params: s.params,
      result: s.result ? {
        id: s.result.id, state: s.result.state, readyToDraft: s.result.readyToDraft,
        assessment: s.result.assessment, requirements: s.result.requirements,
        missing: s.result.missing, pending: s.result.pending,
        actions: actions(s.result.actions), preserved: s.result.preserved,
        note: s.result.note, repairReason: s.result.repairReason,
        repairOf: s.result.repairOf,
        inheritedWork: s.result.inheritedWork?.map(i => ({
          index: i.index, state: i.state, operationId: i.operationId,
          action: i.action,
          source: { id: i.receipt?.id, confirmedBySource: i.receipt?.confirmedBySource,
            state: i.receipt?.state, destinationStock: i.receipt?.destinationStock,
            received: i.receipt?.received, times: i.receipt?.times },
        })),
      } : null,
    })),
  }));
  rows.push({ file, variant, status: r.status, errors: r.errors,
    hashes: { candidate: r.candidateFingerprint, evaluator: r.evaluatorFingerprint },
    calls: r.usage.length, costUsd: r.costUsd, chargedBudgetUsd: r.chargedBudgetUsd,
    unknownCostCalls: r.unknownCostCalls, wallMs: r.wallMs,
    services: r.metrics.services, collective: r.metrics.collective,
    invariants: r.invariants,
    ownOperations: r.platformEvidence.flatMap(e => e.operations.filter(o =>
      !o.peerOwner && !o.sourceId && (o.org ?? o.owner) === e.org).map(o => ({
        receivedBy: e.org, id: o.id, type: o.type, state: o.state,
        building: o.building, need: o.need ?? null,
        resourceType: o.resourceType, quantity: o.quantity, received: o.received,
        destinationStock: o.destinationStock, times: o.times,
      }))),
    facilities: r.platformEvidence.flatMap(e => e.facilities.map(f => ({
      receivedBy: e.org, id: f.id, node: f.node, state: f.state,
      safe: f.safe, occupancy: f.occupancy, at: f.at,
      statusObservedAt: f.statusObservedAt, provisioned: f.provisioned,
      dependencies: f.dependencies,
    }))),
    rounds,
  });
}
await writeFile(new URL('service-diagnosis.json', folder), JSON.stringify({
  at: new Date().toISOString(),
  scope: 'Diagnostic extraction of both fixed-seed B6 outcomes. No hidden state supplied to the candidate and no source edits.',
  attribution: 'Owner stock resolution and receipt freshness are deterministic product/simulator correctness. Their correction is not a GenAI gain.',
  rows,
}, null, 2));
console.log(JSON.stringify(rows.map(r => ({ variant: r.variant, status: r.status,
  calls: r.calls, costUsd: r.costUsd, shelterServed: r.services.shelter.served,
  shelterDeficitPlaceHours: r.services.shelter.uncoveredUnitMs / 3600000,
  ownerOperations: r.ownOperations.length,
  tools: r.rounds.map(a => ({ round: a.round, calls: a.calls, reason: a.reason,
    tools: a.tools.map(s => ({ tool: s.tool, state: s.state, error: s.error,
      ready: s.result?.readyToDraft, reason: s.result?.repairReason })) })),
})), null, 2));
