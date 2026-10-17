import { entityLabel, humanLabel, readableText, registerDisplayRecords, resourceLabel, vehicleDisplayIdentity, vehicleReferenceLabel } from './labels.mjs';
import { actionBrief } from './uploads.mjs';
import { createEvidenceExperience } from './evidence.mjs';

const number = (n) => Number(n ?? 0).toLocaleString('en-US');
const reviewStates = ['awaiting_review', 'requires_review', 'needs_clarification'];
/** A failed availability check is not a loss of the human owner's authority.
 * Retrying approval still performs every current server-side check. */
export function proposalReviewActions(p, canReview) {
  if (!canReview || !reviewStates.includes(p.state)) return [
    { label: 'Follow operations', action: 'navigate', id: 'operations', style: 'primary' },
    { label: 'Close', action: 'close' },
  ];
  const pending = (p.conditions ?? []).some(c => !c.satisfied);
  return [
    ...(p.state === 'requires_review' || p.reviewBlocked ? [{ label: 'Investigate a repair', action: 'repair', id: p.id }] : []),
    ...(!p.executionResults?.length ? [{ label: 'Edit draft', action: 'edit-response', id: p.id }] : []),
    { label: 'Ask for clarification', action: 'reviewclarify', id: p.id },
    { label: 'Reject', action: 'reviewreject', id: p.id, style: 'danger' },
    { label: pending ? 'Authorize conditionally' : p.reviewBlocked ? 'Recheck & authorize' : 'Authorize response', action: 'reviewapprove', id: p.id, style: 'primary' },
  ];
}
const get = (records, id) => records.get(id)?.record;
const destination = (p, records) => {
  const n = get(records, p.need);
  return entityLabel(n?.building ?? n?.node ?? p.building ?? p.destination ?? p.need) || 'Destination not recorded';
};

/** Quantities are derived from typed actions and received records, never model prose. */
function actionResource(proposal, action, records) {
  const direct = records.get(action.params?.resource);
  if (direct?.kind === 'resource' && (!direct.record?.owner || direct.record.owner === action.owner)) return direct.record;
  // Consent exposes a projection, not a partner's private inventory record.
  // Keep its exact owner/entity binding; expired offers still describe the
  // units of a saved plan, without claiming that its stock remains available.
  for (const ref of proposal.references ?? []) {
    const found = records.get(ref), offer = found?.record;
    if (found?.kind === 'peer_offer' && offer.kind === 'resource' && offer.from === action.owner &&
      offer.entityId === action.params?.resource && offer.projection?.id === offer.entityId && offer.projection.owner === action.owner)
      return offer.projection;
  }
  return null;
}
export function decisionCoverage(proposal, records = new Map()) {
  const totals = new Map();
  for (const a of proposal.actions ?? []) {
    const p = a.params ?? {}, need = get(records, p.need), resource = actionResource(proposal, a, records);
    if (a.type !== 'dispatch' || !need || !resource || !Number.isFinite(p.quantity)) continue;
    // Records with different native units cannot be combined into a coverage claim.
    if (resource?.unit && need.unit && resource.unit !== need.unit) continue;
    const row = totals.get(need.id) ?? { need, type: need.type, unit: need.unit || resource?.unit || 'units', quantity: 0 };
    row.quantity += p.quantity;
    totals.set(need.id, row);
  }
  return [...totals.values()].map(row => {
    const outstanding = Math.max(0, Number(row.need.quantity ?? 0) - Number(row.need.served ?? 0) - Number(row.need.inTransit ?? 0));
    return { ...row, outstanding, residual: Math.max(0, outstanding - row.quantity), percent: outstanding ? Math.min(100, row.quantity / outstanding * 100) : 0 };
  });
}

export function decisionReadiness(p, records = new Map()) {
  const references = p.references ?? [], pending = (p.conditions ?? []).filter(c => !c.satisfied), checks = p.checkedConstraints ?? [];
  return {
    evidenceAvailable: references.filter(id => records.get(id)?.record).length,
    evidenceTotal: references.length,
    pending,
    completedChecks: checks.filter(c => c.state === 'checked'),
    authorized: !!p.authorization,
    // Condition satisfaction is recorded state, not confidence that the world is correct.
    conditionsSatisfied: (p.conditions ?? []).length - pending.length,
  };
}

function typedTitle(actions, coverage, records) {
  if (coverage.length === 1) return `${humanLabel(coverage[0].type)} for ${entityLabel(coverage[0].need.building ?? coverage[0].need.node)}`;
  if (coverage.length > 1) return `Respond to ${coverage.length} reported needs`;
  if (actions.length === 1 && actions[0].type === 'dispatch') return `Delivery to ${destination(actions[0].params, records)}`;
  if (actions.length && actions.every(a => a.type === 'dispatch')) return `Coordinate ${actions.length} deliveries`;
  const site = actions.find(a => a.type === 'activate');
  if (site) return `Prepare ${entityLabel(site.params.building)}`;
  if (actions.length && actions.every(a => a.type === 'evacuate')) return 'Coordinate evacuation support';
  if (actions.length === 1 && actions[0].type === 'verify') return `Assess ${entityLabel(actions[0].params.id)}`;
  return `Coordinate ${actions.length} response step${actions.length === 1 ? '' : 's'}`;
}

/** One presentation for the queue, overview and review, based on exact action scope. */
export function proposalPresentation(p, records = new Map()) {
  const actions = p.actions ?? [], coverage = decisionCoverage(p, records),
    needs = [...new Set(actions.map(a => a.params?.need).filter(Boolean))].map(id => get(records, id)).filter(Boolean),
    types = [...new Set(needs.map(n => n.type))],
    title = needs.length === 1
      ? `${humanLabel(needs[0].type)} for ${entityLabel(needs[0].building ?? needs[0].node)}`
      : needs.length > 1
        ? `${types.length === 1 ? humanLabel(types[0]) : 'Aid'} for ${needs.length} locations`
        : typedTitle(actions, coverage, records),
    quantities = new Map();
  for (const c of coverage) quantities.set(c.unit, (quantities.get(c.unit) ?? 0) + c.quantity);
  const deliveries = actions.filter(a => a.type === 'dispatch').length,
    summary = [
      ...[...quantities].map(([unit, amount]) => `${number(amount)} ${unit} proposed`),
      deliveries ? `${deliveries} deliver${deliveries === 1 ? 'y' : 'ies'}` : `${actions.length} planned step${actions.length === 1 ? '' : 's'}`,
    ].join(' · ');
  return { title, summary, coverage, needIds: needs.map(n => n.id) };
}

const RECHECK_CODES = new Set(['VEHICLE_BUSY', 'VEHICLE_CONFLICT', 'VEHICLE_CALENDAR', 'VEHICLE_DRIVER', 'INSUFFICIENT_RESOURCE', 'STAFF_CALENDAR', 'STAFF_QUALIFICATIONS', 'NO_KNOWN_ROUTE', 'FUEL', 'SUPPLY_EXPIRED', 'ACTIVE_OPERATION', 'REPAIR_UNADDRESSED']);

/** Approval failure is not evidence that an approval request was sent. */
export function approvalFeedback(error, proposal = {}) {
  const code = error?.code ?? 'REQUEST_FAILED', automaticRecheck = Boolean(proposal.reviewBlocked?.code === code),
    busy = ['VEHICLE_BUSY', 'VEHICLE_CONFLICT', 'VEHICLE_CALENDAR', 'VEHICLE_DRIVER'].includes(code),
    stale = ['VERSION_CONFLICT', 'PROPOSAL_STATE'].includes(code),
    title = busy ? 'The vehicle plan needs an update' : stale ? 'This response has changed' : RECHECK_CODES.has(code) ? 'The plan needs another check' : 'This approval was not completed',
    next = automaticRecheck
      ? 'Marked for the agent’s next planning check. You can also edit the draft, request a repair, or recheck current availability before authorizing. Issued work stays recorded.'
      : stale ? 'The latest recorded state is shown below. Review it before making another decision.'
        : proposal.state === 'requires_review' ? 'Investigate a repair to update future work. Existing trips and completed deliveries stay recorded.'
          : 'Check the current vehicle, stock and route evidence before trying again.';
  const detail = {
    VEHICLE_BUSY: 'A selected vehicle is already working on another trip. Reusing it now would double-book that vehicle.',
    VEHICLE_CONFLICT: 'A selected vehicle is already assigned to another response. Its current work must be preserved.',
    VEHICLE_CALENDAR: 'The trip no longer fits the vehicle’s available time or its next commitment.',
    VEHICLE_DRIVER: 'A driver is not currently available for a selected vehicle.',
    INSUFFICIENT_RESOURCE: 'The requested supplies are already reserved, protected or no longer available in the required quantity.',
    NO_KNOWN_ROUTE: 'The latest received road information does not confirm a usable route for this vehicle.',
  }[code] || error?.message || 'The server could not complete this approval.';
  return { code, title, detail, next,
    outbound: 'This attempt did not authorize new work or send a new partner approval request. Any earlier requests and issued work remain recorded.',
    automaticRecheck, canRepair: proposal.state === 'requires_review', stale };
}

/** Operational progress is derived only from persisted request/receipt records. */
export function executionProgress(p) {
  const rows = [];
  if (p.authorization && !p.sourceReview && !p.executionResults?.length)
    rows.push({ state: 'queued', title: 'Authorization recorded', detail: 'The execution worker is preparing the operational owner review.' });
  if (p.sourceReview?.state === 'pending' && p.sourceReview.sourceProposal)
    rows.push({ state: 'pending', title: 'Operational owner review requested', detail: 'Your authorization is recorded. Waiting for the operational source to acknowledge the exact plan; no delivery is confirmed yet.' });
  for (const r of p.executionResults ?? []) {
    if (r.state === 'awaiting_partner' && r.requestId)
      rows.push({ state: 'pending', title: `${entityLabel(r.owner)} approval request queued`, detail: `Step ${Number(r.index) + 1} has a recorded outgoing request. Waiting for a partner receipt; no dispatch is confirmed yet.` });
    else if (['authorized', 'in_transit'].includes(r.state) && r.requestId && r.partnerResult)
      rows.push({ state: 'issued', title: `${entityLabel(r.owner)} ${r.state === 'authorized' ? 'approved its step' : 'is carrying out its step'}`, detail: `Step ${Number(r.index) + 1} has a recorded partner update. Follow its operation for the final source-confirmed receipt.` });
    else if (['failed', 'rejected'].includes(r.state) && r.requestId && r.partnerResult)
      rows.push({ state: 'blocked', title: `${entityLabel(r.owner)} could not complete its step`, detail: `Step ${Number(r.index) + 1} needs a revised plan. The partner's recorded response is preserved.` });
    else if (r.state === 'completed' && r.partnerResult?.confirmedBySource)
      rows.push({ state: 'complete', title: `${entityLabel(r.owner)} reported completion`, detail: `Step ${Number(r.index) + 1} has an operational source receipt.` });
    else if (r.result?.id || r.result?.operation)
      rows.push({ state: 'issued', title: `Step ${Number(r.index) + 1} sent to its operational source`, detail: 'The command is recorded. Follow the operation for acknowledgement, travel and final receipt.' });
  }
  return rows;
}

export function createDecisionExperience(h) {
  const { escape: e, icon, badge, action, state, time } = h, evidence = createEvidenceExperience(h);
  const technical = value => `<pre class="trace">${e(JSON.stringify(value, null, 2))}</pre>`;
  async function describeProposals(proposals) {
    const ids = proposals.flatMap(p => (p.actions ?? []).flatMap(a => [
      ...['need', 'resource'].map(k => a.params?.[k]).filter(v => typeof v === 'string'),
      ...(p.references ?? []).filter(ref => ref === `${a.owner}_resource_${a.params?.resource}`),
    ])), records = await evidence.resolve(ids);
    for (const found of records.values()) if (found?.record) registerDisplayRecords(found.kind, found.record);
    return new Map(proposals.map(p => [p.id, proposalPresentation(p, records)]));
  }
  function renderApprovalFeedback(error, { proposal = {} } = {}) {
    const f = approvalFeedback(error, proposal);
    return `<section class="approval-feedback" role="alert" tabindex="-1"><span class="decision-step-icon">${icon('circle-alert')}</span><div><h3>${e(f.title)}</h3><p>${e(f.detail)}</p><p class="approval-feedback-next">${e(f.next)}</p><small>${e(f.outbound)}</small>${f.canRepair && !f.automaticRecheck ? `<div class="actions">${action('Investigate a repair', 'repair', proposal.id, 'accent')}</div>` : ''}</div></section>`;
  }
  function renderExecutionProgress(p) {
    const rows = executionProgress(p);
    const item = r => `<div class="response-execution-row">${icon(r.state === 'complete' ? 'check' : r.state === 'issued' ? 'truck' : r.state === 'blocked' ? 'circle-alert' : 'clock')}<div><strong>${e(r.title)}</strong><p>${e(r.detail)}</p></div></div>`;
    return `<div data-response-progress>${rows.length ? `<section class="response-execution-status" role="status" aria-label="Recorded response progress">${rows.slice(0,3).map(item).join('')}${rows.length > 3 ? `<details class="collapse"><summary>${rows.length - 3} more step updates</summary>${rows.slice(3).map(item).join('')}</details>` : ''}</section>` : ''}</div>`;
  }
  function step(a, index, records, proposal) {
    const p = a.params ?? {}, resource = actionResource(proposal, a, records), vehicle = get(records, p.vehicle), owner = entityLabel(a.owner),
      unit = resource?.unit || get(records, p.need)?.unit || 'units',
      cargo = p.quantity != null ? `${number(p.quantity)} ${unit} · ${resource ? resourceLabel(resource) : entityLabel(p.resource)}` : null,
      vehicleName = vehicle ? vehicleDisplayIdentity(vehicle).label : vehicleReferenceLabel(p.vehicle, a.owner) || entityLabel(p.vehicle),
      at = destination(p, records);
    let name = humanLabel(a.type), description = readableText(actionBrief(a)), glyph = 'clipboard-check', trail = null;
    if (a.type === 'dispatch') { name = vehicleName || 'Deliver supplies'; description = cargo; glyph = 'truck'; trail = ['Collect supplies', 'Transport', at]; }
    if (a.type === 'evacuate') { name = `Transport ${number(p.quantity)} people`; description = `${entityLabel(p.from)} → ${entityLabel(p.to)}`; glyph = 'truck'; trail = [vehicleName, 'Collect people', entityLabel(p.to)]; }
    if (a.type === 'activate') { name = `Open ${entityLabel(p.building)}`; description = 'Activate this assessed response site after its dependencies are complete.'; glyph = 'building-2'; }
    if (a.type === 'verify') { name = `Inspect ${entityLabel(p.id)}`; description = 'Field safety assessment before the site can be used.'; glyph = 'shield-check'; trail = [entityLabel(p.staff), vehicleName, 'Report assessment']; }
    if (a.type === 'reroute') { name = `Update ${vehicleName}'s route`; description = `Continue toward ${at} using the updated received route.`; glyph = 'map-pin'; }
    if (a.type === 'repair') { name = 'Restore road access'; description = entityLabel(p.edge); glyph = 'map-pin'; }
    if (a.type === 'purchase') { name = `Buy ${number(p.quantity)} ${humanLabel(p.type).toLowerCase()}`; description = `${p.supplier ? entityLabel(p.supplier) : 'Supplier as recorded'} · ${Math.round(Number(p.leadMs) / 60000)} min lead time`; glyph = 'package'; }
    if (a.type === 'unload') { name = 'Receive and unload supplies'; description = `${number(p.quantity)} crew · ${number(p.deliveryQuantity)} units to unload`; glyph = 'package-check'; }
    if (a.type === 'commitment') { name = `${humanLabel(p.action || 'Review')} resource commitment`; description = p.quantity != null ? `${number(p.quantity)} ${unit} · ${entityLabel(p.resource)}` : 'Manage the recorded owner reservation.'; glyph = 'lock-keyhole'; }
    if (a.type === 'transfer') { name = `${humanLabel(p.action || 'Arrange')} resource transfer`; description = `${p.quantity != null ? `${number(p.quantity)} ${unit} · ` : ''}${entityLabel(p.resource ?? p.id)}${p.to ? ' → ' + entityLabel(p.to) : ''}`; glyph = 'network'; }
    if (a.type === 'publish') { name = 'Publish an approved response update'; description = p.text; glyph = 'globe'; }
    if (a.type === 'cancel') { name = 'Stop future work'; description = 'Cancel the referenced operation; completed physical work remains recorded.'; glyph = 'circle-alert'; }
    const dependencies = a.dependsOn ?? [];
    return `<li class="response-step"><div class="response-step-count">${index + 1}</div><div class="response-step-content"><div class="response-step-title"><span class="decision-step-icon">${icon(glyph)}</span><div><h3>${e(name)}</h3><p>${e(description)}</p></div></div>${trail ? `<ol class="delivery-trail" aria-label="Planned delivery stages">${trail.filter(Boolean).map(t => `<li>${e(t)}</li>`).join('')}</ol>` : ''}<div class="response-step-meta"><span>${e(owner)}</span><span>${dependencies.length ? 'After ' + dependencies.map(i => 'step ' + (i + 1)).join(', ') : 'No earlier step required'}</span></div>${a.type === 'dispatch' ? `<details class="response-step-detail"><summary>Pickup & reservation details</summary><p>${e(p.commitment || p.transfer ? 'Uses an existing owner reservation; its expiry is unchanged.' : `${Math.round((p.ttlMs ?? 900000) / 60000 * 10) / 10}-minute stock reservation for pickup and loading.`)}${p.staffSkills?.length ? ' Required qualifications: ' + e(p.staffSkills.map(humanLabel).join(', ')) + '.' : ''}</p></details>` : ''}</div></li>`;
  }
  async function renderProposal(p, { canReview = false } = {}) {
    const ids = [...(p.references ?? []), ...(p.actions ?? []).flatMap(a => ['need', 'resource', 'vehicle', 'building', 'from', 'to', 'staff', 'id'].map(k => a.params?.[k]).filter(v => typeof v === 'string'))],
      records = await evidence.resolve(ids);
    for (const resolved of records.values()) if (resolved?.record) registerDisplayRecords(resolved.kind, resolved.record);
    const readiness = decisionReadiness(p, records), pending = readiness.pending,
      coverage = decisionCoverage(p, records), actions = p.actions ?? [],
      owners = [...new Set(actions.map(a => a.owner))],
      vehicles = new Set(actions.map(a => a.params?.vehicle).filter(Boolean)),
      partnerOwners = owners.filter(owner => owner !== state.user.org),
      actionable = canReview && reviewStates.includes(p.state),
      title = proposalPresentation(p, records).title;
    return `<article class="response-review"><div class="cardheader">${badge(p.state)}${badge(p.priority)}</div><h2>${e(title)}</h2>${p.reviewBlocked ? renderApprovalFeedback({code:p.reviewBlocked.code,message:p.reviewBlocked.message},{proposal:p}) : ''}${renderExecutionProgress(p)}${p.changedReason && !p.reviewBlocked ? `<div class="warning">${e(readableText(p.changedReason))}. A new owner decision is required.</div>` : ''}
      ${coverage.length && reviewStates.includes(p.state) ? `<section class="response-impact" aria-label="Need and proposed response">${coverage.slice(0, 3).map(c => `<div class="response-impact-row"><div class="response-impact-place">${icon('map-pin')}<strong>${e(entityLabel(c.need.building ?? c.need.node))}</strong></div><div class="response-impact-numbers"><div><span>Still needed</span><strong>${number(c.outstanding)} <small>${e(c.unit)}</small></strong></div><span class="response-impact-arrow">${icon('arrow-right')}</span><div class="proposed"><span>This response</span><strong>${number(c.quantity)} <small>${e(c.unit)}</small></strong></div><div><span>Still to find</span><strong>${number(c.residual)} <small>${e(c.unit)}</small></strong></div></div><div class="response-coverage-track" aria-label="${e(number(c.percent))}% of outstanding demand proposed"><i style="width:${Math.min(100, Math.max(0, c.percent))}%"></i></div><p class="response-coverage-label">Proposed coverage · ${Math.round(c.percent)}% of the reported need</p></div>`).join('')}${coverage.length > 3 ? `<p class="note">Plus ${coverage.length - 3} other needs covered by the steps below.</p>` : ''}</section>` : ''}
      <section class="approval-explanation"><span class="decision-step-icon">${icon('clipboard-check')}</span><div><h3>${p.authorization ? 'A person owns this decision' : 'Why your approval matters'}</h3><p>${p.authorization ? `Authorized by ${e(p.authorization.name)} at ${e(time(p.authorization.at))}.` : `This commits ${vehicles.size ? `${vehicles.size} vehicle${vehicles.size === 1 ? '' : 's'} and ` : ''}operational resources. ${e(entityLabel(state.user.org))} must accept responsibility before execution.`}${partnerOwners.length ? ` ${partnerOwners.map(entityLabel).map(e).join(', ')} must separately approve their own actions.` : ''}</p></div></section>
      <div class="response-readiness" aria-label="Recorded readiness"><span class="${readiness.evidenceAvailable === readiness.evidenceTotal ? 'ready' : 'attention'}">${icon(readiness.evidenceAvailable === readiness.evidenceTotal ? 'check' : 'circle-alert')}${readiness.evidenceAvailable}/${readiness.evidenceTotal} sources available</span><span class="${pending.length ? 'attention' : 'ready'}">${icon(pending.length ? 'clock' : 'check')}${pending.length ? `${pending.length} condition${pending.length === 1 ? '' : 's'} unresolved` : 'No declared pending conditions'}</span>${readiness.completedChecks.length ? `<span class="${p.reviewBlocked ? 'attention' : 'ready'}">${icon('shield-check')}${readiness.completedChecks.length} ${p.reviewBlocked ? 'saved checks · recheck needed' : 'recorded plan checks'}</span>` : ''}</div>
      ${pending.length ? `<div class="decision-note attention">${icon('circle-alert')}<div><strong>Resolve before physical execution</strong><ul>${pending.map(c => `<li>${e(readableText(c.description))}</li>`).join('')}</ul></div></div>` : ''}
      <section class="response-plan"><div class="section-heading"><h3>${p.reviewBlocked ? 'Saved plan · current checks required' : p.authorization ? 'Authorized response steps' : 'What you are authorizing'}</h3><span class="small">${actions.length} planned step${actions.length === 1 ? '' : 's'}</span></div><ol class="response-steps">${actions.slice(0, 3).map((a, i) => step(a, i, records, p)).join('')}</ol>${actions.length > 3 ? `<details class="collapse"><summary>Review ${actions.length - 3} remaining steps</summary><ol class="response-steps" start="4">${actions.slice(3).map((a, i) => step(a, i + 3, records, p)).join('')}</ol></details>` : ''}<p class="note">These exact steps define the commitment. Authorizing a plan does not confirm arrival or receipt.</p></section>
      <details class="collapse"><summary>Evidence behind this response · ${(p.references ?? []).length} records</summary>${(p.references ?? []).map(id => evidence.reference(records.get(id), id)).join('')}</details>
      <details class="collapse"><summary>Why this response?</summary><p class="sub">${e(readableText(p.rationale))}</p>${p.benefit && p.benefit.trim() !== p.summary?.trim() ? `<p class="sub">${e(readableText(p.benefit))}</p>` : ''}${readiness.completedChecks.length ? `<ul class="recorded-checks">${readiness.completedChecks.map(c => `<li>${icon('check')}${e(humanLabel(c.type))} · step ${Number(c.index) + 1}</li>`).join('')}</ul>` : `<p class="note">No completed constraint-check record is attached to this draft. The server checks the current plan again when an owner approves.</p>`}</details>
      ${(p.alternatives ?? []).length ? `<details class="collapse"><summary>Other options considered · ${p.alternatives.length}</summary>${p.alternatives.map(a => `<p class="sub"><strong>${e(readableText(a.title))}</strong><br>${e(readableText(a.reason))}</p>`).join('')}</details>` : ''}
      ${p.repairOf ? `<details class="collapse"><summary>Previous work preserved · ${(p.inheritedWork ?? []).length} steps</summary><p class="sub">${e(readableText(p.repairReason))}. This decision covers the future actions above.</p>${(p.inheritedWork ?? []).map(w => `<p class="small">${e(humanLabel(w.action.type))} · ${e(humanLabel(w.state))}</p>`).join('')}</details>` : ''}
      <details class="collapse"><summary>Exact action record · version ${e(p.version)}</summary>${technical(actions)}${p.authorization ? `<p class="note">Evidence snapshot: ${e(p.authorization.evidenceHash)}.</p>` : ''}</details>
      ${actionable ? `<details class="collapse decision-note-field"><summary>Add a decision note <span class="small">Optional</span></summary><label>Note to the response team<textarea id="reviewnote" placeholder="Constraints, clarification or the reason for your decision."></textarea></label></details>${pending.length ? `<label class="checkbox"><input type="checkbox" id="allowconditional">Authorize a conditional reservation only. Physical execution stays blocked until conditions are checked and a new authorization is given.</label>` : ''}` : ''}</article>`;
  }
  return { renderProposal, describeProposals, renderApprovalFeedback, renderExecutionProgress, renderEvidence: evidence.render, reference: evidence.reference };
}
