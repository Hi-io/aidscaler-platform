// Use only supplied lot metadata and a received source clock. A missing expiry
// is unknown metadata, not permission to invent a date or a cold-chain model.
export function lotStatus(resource, sourceNow, serviceAt = sourceNow) {
  if (!resource || ['expired', 'damaged', 'quarantined'].includes(resource.condition))
    return { usable: false, reason: 'expiry' };
  if (resource.useByAt !== undefined && (!Number.isSafeInteger(resource.useByAt) ||
    !Number.isFinite(sourceNow) || !Number.isFinite(serviceAt) || resource.useByAt <= sourceNow ||
    resource.useByAt <= serviceAt)) return { usable: false, reason: 'expiry' };
  return { usable: true, reason: null };
}
export function receivedUsableQuantity(resource, sourceNow, serviceAt = sourceNow) {
  if (!lotStatus(resource, sourceNow, serviceAt).usable) return 0;
  const physicalAvailable = Number.isFinite(resource?.quantity)
    ? resource.quantity - (resource.reserved ?? 0) - (resource.floor ?? 0)
    : resource?.available ?? 0;
  return Math.max(0, Math.min(physicalAvailable,
    Number.isFinite(resource?.usableQuantity) ? resource.usableQuantity : Infinity));
}
export function lotProjection(resource) {
  return Object.fromEntries(Object.entries({ lotId: resource.lotId,
    lotOrigin: resource.lotOrigin, useByAt: resource.useByAt, condition: resource.condition })
    .filter(([, value]) => value !== undefined));
}
export async function receivedSourceNow(store, org) {
  return (await store.get(org, 'source', 'simulator', false))?.simulatedAt ??
    (await store.get(org, 'context', 'operational', false))?.snapshot?.now;
}
export function nominalServiceAt(sourceNow, pickup, delivery, execution) {
  if (!Number.isFinite(sourceNow)) return null;
  if (!pickup || !delivery) return sourceNow;
  const d = execution?.delivery;
  return sourceNow + Math.ceil((pickup.seconds + delivery.seconds) * 1000) +
    (d?.loadMs ?? 0) + (d?.unloadMs ?? 0) + (d?.commandNominalLatencyMs ?? 0);
}
