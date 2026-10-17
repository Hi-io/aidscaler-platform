import { entityLabel, resourceLabel } from './labels.mjs';

export function incomingResources(rows, org, demo = false) {
  const types = demo ? ['water', 'food'] : ['water', 'food', 'energy', 'sanitation', 'medicine', 'blankets', 'fuel'];
  return rows.filter(r => r.owner === org && (r.sourceSnapshot || r.sourceVersion !== undefined) && types.includes(r.type) &&
    (!demo || r.id === `r-${org}-${r.type}`));
}
export function incomingReceiptInput(data, rows, { demo = false } = {}) {
  const resource = rows.find(r => r.id === data.resource), quantity = Number(data.quantity);
  if (!resource) throw Error('Choose inventory owned by your team from the connected warehouse.');
  const max = demo ? resource.type === 'water' ? 600 : 120 : 1000000000;
  if (!String(data.quantity ?? '').trim() || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > max)
    throw Error(`Enter a whole quantity from 1 to ${max.toLocaleString('en-US')} ${resource.unit || 'units'}.`);
  const receiptReference = String(data.receiptReference ?? '').trim(), note = String(data.note ?? '').trim();
  if (receiptReference.length < 3 || receiptReference.length > 80 || /[<>\x00-\x1f\x7f]/.test(receiptReference))
    throw Error('Enter the delivery reference, between 3 and 80 characters. Reuse it when retrying the same shipment.');
  if (note.length > 240 || /[<>\x00-\x1f\x7f]/.test(note)) throw Error('Keep the delivery note to one readable line, within 240 characters.');
  if (!data.confirmedReceived) throw Error('Confirm that the supplies have physically arrived at your warehouse.');
  return { resource: resource.id, quantity, receiptReference, note, confirmedReceived: true };
}
export function incomingReceiptForm(rows, { escape: e, demo = false } = {}) {
  return `<p class="sub">Record supplies that have arrived at your warehouse. The connected inventory system confirms the receipt before AidScaler marks it received.</p><form id="incomingreceiptform" class="fieldform"><label>Warehouse inventory<select name="resource" required>${rows.map(r => `<option value="${e(r.id)}" data-unit="${e(r.unit || 'units')}" data-max="${demo ? r.type === 'water' ? 600 : 120 : 1000000000}">${e(resourceLabel(r))} · ${e(r.unit || 'units')}${r.node ? ` · ${e(entityLabel(r.node))}` : ''}</option>`).join('')}</select></label><div class="detailgrid"><label>Quantity received<input name="quantity" type="number" min="1" step="1" max="${demo ? rows[0]?.type === 'water' ? 600 : 120 : 1000000000}" required><span class="small" data-receipt-unit>${e(rows[0]?.unit || 'units')}</span></label><label>Delivery reference<input name="receiptReference" minlength="3" maxlength="80" required placeholder="e.g. DELIVERY-1042"><span class="small">A unique reference prevents counting the same shipment twice.</span></label></div><details class="collapse"><summary>Add a delivery note</summary><label>Note<textarea name="note" maxlength="240" rows="2" placeholder="Supplier, handover or relevant delivery detail"></textarea></label></details><label class="checkbox"><input type="checkbox" name="confirmedReceived" required> I confirm these supplies were received at our warehouse.</label>${demo ? '<p class="note">Demo deliveries: up to 600 L of water or 120 food portions, once per 30 simulated minutes. Depot limits are 1,200 L and 300 portions; reserved stock stays protected.</p>' : ''}<button class="primary" type="submit">Record received supplies</button><p class="small" role="status" data-receipt-status></p></form>`;
}
export function incomingReceiptHistory(rows, { escape: e, time, badge }) {
  if (!rows.length) return '';
  const ordered = [...rows].sort((a, b) => b.requestedAt - a.requestedAt).slice(0, 5);
  return `<details class="secondary-disclosure" data-ui-key="resources:incoming"><summary>Incoming warehouse supplies <span>${rows.length} records</span></summary><p class="small">Warehouse arrivals. Deliveries to communities appear in Operations.</p>${ordered.map(r => `<div class="listrow"><div class="grow"><h3>${e(r.receiptReference)}</h3><p>${e(r.quantity)} ${e(r.receipt?.unit || 'units')} · ${e(entityLabel(r.resource))}</p><small>${r.state === 'confirmed' ? `Warehouse confirmed · ${e(time(r.receipt.at))}` : 'Waiting for warehouse acknowledgement. Retry the same reference to recover a missing reply.'}</small></div>${badge(r.state)}</div>`).join('')}</details>`;
}
