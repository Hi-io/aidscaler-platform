import { entityLabel, humanLabel, readableText, registerDisplayRecords, resourceLabel, vehicleDisplayIdentity } from './labels.mjs';

const quantity = (value) => Number(value ?? 0).toLocaleString('en-US');
const received = (r) => r.sourceSnapshot ?? r;
const names = { need: 'Reported need', resource: 'Supply inventory', vehicle: 'Response vehicle', facility: 'Response site', report: 'Field report', verification: 'Verification', claim: 'Sourced interpretation', query: 'Source query', road: 'Road update', operation: 'Response operation', peer_offer: 'Partner offer', evidence_group: 'Related sources', external: 'Connected source', unloading_request: 'Delivery unloading request' };
const icons = { need: 'heart-handshake', resource: 'package', vehicle: 'truck', facility: 'building-2', report: 'file-text', verification: 'shield-check', claim: 'message-square', query: 'radio', road: 'map-pin', operation: 'truck', peer_offer: 'network', evidence_group: 'network' };

export function evidenceTitle(found) {
  const r = found?.record;
  if (!r) return 'Source unavailable';
  const at = entityLabel(r.building ?? r.location ?? r.node);
  if (found.kind === 'need') return `${humanLabel(r.type)} · ${at || 'Location not confirmed'}`;
  if (found.kind === 'resource') return `${resourceLabel(r)}${r.owner ? ' · ' + entityLabel(r.owner) : ''}`;
  if (found.kind === 'vehicle') return vehicleDisplayIdentity(r).label;
  if (found.kind === 'facility') return r.name || r.label || entityLabel(r.id);
  if (found.kind === 'signal') return r.authorName ? `Post by ${r.authorName}` : 'Public post';
  if (found.kind === 'report') return `${r.authorName || r.reporterName || 'Field report'}${at ? ' · ' + at : ''}`;
  if (found.kind === 'verification') return `${humanLabel(r.target || 'Source')} check${r.entity ? ' · ' + entityLabel(r.entity) : ''}`;
  if (found.kind === 'peer_offer') return `${entityLabel(r.from)} · ${humanLabel(r.kind || 'Offer')}`;
  return r.title || r.name || r.label || names[found.kind] || humanLabel(found.kind);
}

export function evidenceSubtitle(found) {
  const r = found?.record;
  if (!r) return 'This source could not be loaded. Review the saved decision snapshot.';
  if (found.kind === 'need') return `${quantity(r.quantity)} ${r.unit || 'units'} requested · ${quantity(r.served)} received${Number(r.inTransit) > 0 ? ` · ${quantity(r.inTransit)} in transit` : ''}`;
  if (found.kind === 'resource') return `${quantity(r.quantity)} ${r.unit || 'units'} recorded · ${quantity(Math.max(0, Number(r.quantity ?? 0) - Number(r.reserved ?? 0) - Number(r.floor ?? 0)))} available after reservations and protected stock`;
  if (found.kind === 'vehicle') return `${humanLabel(r.state || 'Status not recorded')}${r.capacity != null ? ' · Capacity ' + quantity(r.capacity) : ''}`;
  if (found.kind === 'facility') return r.safe === true ? 'Recorded as safe · Review assessment validity' : r.safe === false ? 'Recorded as unsafe' : 'Safety is not confirmed';
  if (found.kind === 'verification') return r.state === 'completed' ? 'Check completed · Open the result and its limitations' : humanLabel(r.state || 'Result not confirmed');
  if (found.kind === 'road') return r.open === true ? 'Last received report: open' : r.open === false ? 'Last received report: blocked' : 'Access is not confirmed';
  return String(r.text ?? r.description ?? r.reason ?? names[found.kind] ?? 'Recorded evidence').slice(0, 180);
}

/** Human-readable presentation of organization-scoped records; no new truth is inferred. */
export function createEvidenceExperience({ api, escape: e, icon, badge, action, time }) {
  const fact = (label, value) => value != null && value !== '' ? `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>` : '';
  const link = (id, label) => action(label || 'Open source', 'evidence', id, 'quiet');
  const field = (r, key) => r[key] ?? received(r)[key];
  async function resolve(ids = []) {
    const results = await Promise.allSettled([...new Set(ids.filter(Boolean))].map(id => api('/api/evidence?' + new URLSearchParams({ id }))));
    return new Map([...new Set(ids.filter(Boolean))].map((id, i) => [id, results[i].status === 'fulfilled' ? results[i].value : null]));
  }
  function reference(found, id) {
    return `<div class="evidence-reference"><div class="decision-step-icon">${icon(icons[found?.kind] || 'file-text')}</div><div class="grow"><strong>${e(evidenceTitle(found))}</strong><p>${e(evidenceSubtitle(found))}</p></div>${link(id, 'View')}</div>`;
  }
  async function render(found) {
    const { kind, record: r } = found;
    registerDisplayRecords(kind, r);
    const refs = [...new Set([...(r.references ?? []), ...(r.originalReferences ?? [])].filter(x => typeof x === 'string'))],
      resolved = refs.length ? await resolve(refs.slice(0, 6)) : new Map(),
      reporter = r.authorName || r.reporterName || r.reportedByName || r.createdByName,
      at = entityLabel(r.building ?? r.location ?? r.node ?? r.entity),
      text = r.text ?? r.description ?? r.summary ?? r.reason,
      facts = [],
      add = (name, value) => facts.push(fact(name, value)),
      status = r.state ? badge(r.state) : '';
    add('Location', at || 'Not confirmed');
    add('Reported by', reporter || (r.source ? readableText(r.source) : r.owner ? entityLabel(r.owner) : 'Not named in this record'));
    add('Observed', r.observedAt != null ? time(r.observedAt) : null);
    add('Received', r.receivedAt != null ? time(r.receivedAt) : r.updatedAt != null ? time(r.updatedAt) : null);
    if (kind === 'need') {
      add('Requested', `${quantity(r.quantity)} ${r.unit || 'units'}`);
      add('Received by the community', `${quantity(r.served)} ${r.unit || 'units'}`);
      add('In transit', `${quantity(r.inTransit)} ${r.unit || 'units'}`);
      add('Still uncovered', `${quantity(Math.max(0, Number(r.quantity ?? 0) - Number(r.served ?? 0) - Number(r.inTransit ?? 0)))} ${r.unit || 'units'}`);
      add('Deadline', r.deadline != null ? time(r.deadline) : 'Not recorded');
    } else if (kind === 'resource') {
      add('Recorded stock', `${quantity(r.quantity)} ${r.unit || 'units'}`);
      add('Already reserved', `${quantity(r.reserved)} ${r.unit || 'units'}`);
      add('Protected stock', `${quantity(r.floor)} ${r.unit || 'units'}`);
      add('Available', `${quantity(Math.max(0, Number(r.quantity ?? 0) - Number(r.reserved ?? 0) - Number(r.floor ?? 0)))} ${r.unit || 'units'}`);
      if (r.compatibility) add('Compatible with', Array.isArray(r.compatibility) ? r.compatibility.map(humanLabel).join(', ') : humanLabel(r.compatibility));
    } else if (kind === 'vehicle') {
      const identity = vehicleDisplayIdentity(r);
      add(identity.registrationLabel, identity.plate || null);
      add('Capacity', r.capacity != null ? quantity(r.capacity) : 'Not recorded');
      add('Cargo limit', r.maxCargoKg != null ? `${quantity(r.maxCargoKg)} kg` : null);
      add('Going to', r.destination ? entityLabel(r.destination) : null);
    } else if (kind === 'facility') {
      add('Purpose', humanLabel(r.use || 'Not recorded'));
      add('Safety', r.safe === true ? 'Recorded as safe' : r.safe === false ? 'Recorded as unsafe' : 'Not confirmed');
      add('Capacity', r.capacity != null ? `${quantity(r.capacity)} places` : null);
      add('Occupied', r.occupied != null || r.occupancy != null ? quantity(r.occupied ?? r.occupancy) : null);
    } else if (kind === 'road') {
      add('From', r.from ? entityLabel(r.from) : null);
      add('To', r.to ? entityLabel(r.to) : null);
      add('Access', r.open === true ? 'Reported open' : r.open === false ? 'Reported blocked' : 'Not confirmed');
      add('Restriction', r.restriction ? readableText(r.restriction) : null);
    } else if (kind === 'verification') {
      add('Method', humanLabel(r.method || 'Not recorded'));
      add('Finished', r.completedAt != null ? time(r.completedAt) : 'Not yet recorded');
      add('Source confirmation', r.confirmedBySource ? 'Received from the operational source' : 'Not recorded');
    } else if (r.quantity != null) add('Reported quantity', `${quantity(r.quantity)} ${r.unit || 'units'}`);
    const uncertainty = r.uncertainty ?? r.result?.uncertainty;
    const limitation = uncertainty ? (typeof uncertainty === 'string' ? uncertainty : JSON.stringify(uncertainty)) : null;
    const result = kind === 'verification' ? r.result : null;
    const resultText = result?.text || result?.summary || result?.reason || result?.assessment?.reason;
    return `<article class="friendly-evidence"><div class="cardheader"><span class="eyebrow">${e(names[kind] || humanLabel(kind))}</span>${status}</div><h2>${e(evidenceTitle(found))}</h2><p class="evidence-lead">${e(evidenceSubtitle(found))}</p>${text ? `<blockquote class="evidence-original">${e(text)}</blockquote>` : ''}${resultText ? `<p class="evidence-original">${e(resultText)}</p>` : ''}<dl class="evidence-facts">${facts.join('')}</dl>${limitation ? `<div class="decision-note attention">${icon('circle-alert')}<p><strong>Uncertainty recorded</strong><br>${e(limitation)}</p></div>` : ''}${refs.length ? `<details class="collapse" open><summary>Who or what supports this record? · ${refs.length} sources</summary>${refs.slice(0, 6).map(id => reference(resolved.get(id), id)).join('')}${refs.length > 6 ? `<details class="collapse"><summary>${refs.length - 6} more references</summary>${refs.slice(6).map(id => `<div class="listrow"><span>${e(entityLabel(id))}</span>${link(id)}</div>`).join('')}</details>` : ''}</details>` : `<p class="note">No linked source is recorded here. This operational record alone does not establish independent verification.</p>`}<details class="collapse"><summary>Original identifiers & technical record</summary><dl class="evidence-facts">${fact('Record ID', r.id)}${fact('Version', r.version)}${fact('Source version', field(r, 'sourceVersion'))}</dl><pre class="trace">${e(JSON.stringify(r, null, 2))}</pre></details></article>`;
  }
  return { resolve, reference, render };
}
