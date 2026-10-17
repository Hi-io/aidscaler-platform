import { z } from 'zod';
import { check, role } from './errors.mjs';
import { hash } from './store.mjs';

const schema = z.object({ resource: z.string().min(1).max(180), quantity: z.number().int().positive().max(1000000000),
  receiptReference: z.string().min(3).max(80), note: z.string().max(240).default(''), confirmedReceived: z.literal(true) }).strict();

/** Human warehouse intake. A local observation never creates physical stock:
 * the connected operational owner records the unique incoming shipment first.
 * Its canonical source command survives a lost reply or platform restart.
 */
export class InventoryReceipts {
  constructor(store, connector) { Object.assign(this, { store, connector }); }
  async record(actor, input) {
    role(actor, ['commander', 'dispatcher']);
    const normalized = { ...input, receiptReference: String(input.receiptReference ?? '').trim().replace(/\s+/g, ' ').toUpperCase() };
    const d = schema.parse(normalized);
    check(!/[<>\x00-\x1f\x7f]/.test(d.receiptReference), 'RECEIPT_REFERENCE', 'Use a delivery reference without markup or control characters.');
    check(!/[<>\x00-\x1f\x7f]/.test(d.note), 'RECEIPT_NOTE', 'Keep the delivery note to one readable line without markup.');
    const id = 'inventory-receipt-' + hash([actor.org, d.receiptReference]).slice(0, 40), sourceKey = id;
    const queued = await this.store.command(actor.org, 'incoming-' + id, d, async tx => {
      const resource = await tx.get(actor.org, 'resource', d.resource);
      check(resource.owner === actor.org, 'RESOURCE_OWNER', 'Only the warehouse owner can record incoming supplies.', 403);
      check(resource.sourceSnapshot || resource.sourceVersion !== undefined, 'SOURCE_INVENTORY',
        'Choose inventory received from the connected warehouse. A local record cannot create external physical stock.', 409);
      const row = await tx.put(actor.org, 'inventory_receipt', id, { ...d, state: 'awaiting_source', sourceKey,
        requestedBy: actor.id, requestedAt: Date.now(), physicalConfirmation: false }, 0);
      await tx.audit(actor.org, actor.id, 'inventory.receipt_requested', id,
        { resource: d.resource, quantity: d.quantity, reference: d.receiptReference, humanDeclaration: true, physicalConfirmation: false });
      return row;
    });
    const current = await this.store.get(actor.org, 'inventory_receipt', queued.id);
    if (current.state === 'confirmed') return current;
    let reply;
    try {
      reply = await this.connector.request('/api/actor/inventory/receipt', { method: 'POST', human: true,
        body: { resource: d.resource, quantity: d.quantity, receiptReference: d.receiptReference, note: d.note, idempotencyKey: sourceKey } });
    } catch (error) {
      if (error.status === 404) error.message = 'The connected warehouse does not support recording incoming inventory here. Register the shipment in that system, then refresh its inventory.';
      throw error;
    }
    const receipt = reply.receipt;
    check(receipt && typeof receipt.id === 'string' && receipt.org === actor.org && receipt.resource === d.resource &&
      receipt.quantity === d.quantity && receipt.reference === d.receiptReference && Number.isFinite(receipt.at),
    'INVENTORY_RECEIPT_ACK', 'The warehouse did not return a matching receipt. Keep the same reference and retry; no local stock was added.', 502);
    const result = await this.store.command(actor.org, 'confirmed-' + id, { sourceKey, receipt }, async tx => {
      const pending = await tx.get(actor.org, 'inventory_receipt', id);
      const confirmed = await tx.put(actor.org, 'inventory_receipt', id,
        { ...pending, state: 'confirmed', receipt, confirmedAt: Date.now(), physicalConfirmation: true }, pending.version);
      await tx.audit(actor.org, actor.id, 'inventory.receipt_confirmed', id,
        { resource: d.resource, quantity: receipt.quantity, sourceReceipt: receipt.id, reference: receipt.reference, sourceAt: receipt.at, physicalConfirmation: true });
      return confirmed;
    });
    // Only ordinary source observations may update the inventory projection.
    await this.connector.action('query', { target: 'inventory' }, 'incoming-refresh-' + id).catch(() => {});
    return result;
  }
}
