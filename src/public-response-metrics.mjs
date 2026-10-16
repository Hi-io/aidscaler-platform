/** Public progress is limited to operations already linked by a reviewed publication. */
const movingStates = new Set(['travelling', 'en_route', 'in_transit', 'unloading', 'arrived']);
const finiteNonNegative = value => Number.isFinite(value) && value >= 0;
const safeQuantity = value => finiteNonNegative(value) ? value : 0;
const publicUnits = new Set(['L', 'l', 'ml', 'mL', 'kg', 'g', 't', 'units', 'unit', 'items', 'bottles', 'packs', 'boxes', 'kits', 'doses', 'meals', 'rations', 'blankets', 'litres', 'liters', 'litre', 'liter', 'people', 'persons', 'beds']);
const publicKinds = new Map([
  ['water', 'Drinking water'], ['food', 'Food'], ['medicine', 'Medical supplies'],
  ['medical', 'Medical supplies'], ['blanket', 'Blankets'], ['blankets', 'Blankets'],
  ['shelter', 'Shelter supplies'], ['fuel', 'Fuel'], ['hygiene', 'Hygiene supplies'],
]);

export function aggregatePublicResponseProgress(publications, operations, resources = []) {
  const allowed = new Set(publications.filter(p => p.state === 'published').flatMap(p => p.operationIds ?? []));
  const stock = new Map(resources.map(r => [r.id, r]));
  const groups = new Map(), seen = new Set();
  let receivedDeliveries = 0, enRouteDeliveries = 0;
  for (const record of operations) {
    if (!allowed.has(record.id) || record.confirmedBySource !== true) continue;
    const op = record.sourceSnapshot ?? record;
    if (op.type && op.type !== 'delivery') continue;
    // Peer projections and local reads can refer to the same physical operation.
    const key = JSON.stringify([op.org ?? op.owner ?? '', op.id ?? record.sourceId ?? record.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    const resource = stock.get(op.resource), type = op.resourceType ?? resource?.type;
    const unit = op.unit ?? resource?.unit;
    const quantity = safeQuantity(op.quantity);
    const received = Number.isFinite(op.times?.received) || Number.isFinite(op.times?.service)
      ? Math.min(quantity, safeQuantity(op.received)) : 0;
    const moving = movingStates.has(op.state) && Number.isFinite(op.times?.departed);
    const enRoute = moving ? Math.max(0, quantity - received) : 0;
    if (received > 0) receivedDeliveries++;
    if (enRoute > 0) enRouteDeliveries++;
    // A resource label and explicit native unit are necessary for a quantity claim.
    if (!publicKinds.has(type) || !publicUnits.has(unit)) continue;
    if (received <= 0 && enRoute <= 0) continue;
    const groupKey = JSON.stringify([type, unit]);
    const row = groups.get(groupKey) ?? { type, label: publicKinds.get(type), unit, received: 0, enRoute: 0 };
    row.received += received; row.enRoute += enRoute; groups.set(groupKey, row);
  }
  return { receivedDeliveries, enRouteDeliveries, materials: [...groups.values()].sort((a,b) => a.label.localeCompare(b.label) || a.unit.localeCompare(b.unit)),
    notice: 'Source-confirmed operations linked to current, reviewed public updates. Quantities retain their original units.' };
}

export async function publicResponseMetrics(store, org, publications) {
  const ids = [...new Set(publications.filter(p => p.state === 'published').flatMap(p => p.operationIds ?? []))];
  const operations = (await Promise.all(ids.map(id => store.get(org, 'operation', id, false)))).filter(Boolean);
  const resourceIds = [...new Set(operations.map(o => (o.sourceSnapshot ?? o).resource).filter(Boolean))];
  const resources = (await Promise.all(resourceIds.map(id => store.get(org, 'resource', id, false)))).filter(Boolean);
  return aggregatePublicResponseProgress(publications, operations, resources);
}
