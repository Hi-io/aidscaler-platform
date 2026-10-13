// Display only. Server/source planning and authorization remain authoritative.
export function simulationClock(at) {
  if (!Number.isFinite(at) || at < 0) return 'source time unknown';
  return `Simulation +${Math.floor(at / 3600000)}:${String(Math.floor(at / 60000) % 60).padStart(2, '0')}`;
}
export function sourceExpiryLabel(at, sourceNow) {
  if (!Number.isFinite(at) || !Number.isFinite(sourceNow)) return 'Expiry needs a current source clock';
  const remaining = at - sourceNow;
  return remaining <= 0 ? `Expired at ${simulationClock(at)}`
    : `Expires in ${Math.ceil(remaining / 60000)} min · ${simulationClock(at)}`;
}
export function staffAvailabilityState(resource, sourceNow) {
  const c = resource?.staffCalendar ?? resource?.staffCapacity?.staffCalendar;
  if (c === undefined) return { declared: false, usable: true, state: 'unknown', label: 'Shift unknown', endAt: null, nextAt: null };
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  if (!c || !integer(c.version) || c.version === 0 || !integer(c.observedAt) || !integer(c.epochAt) ||
    !integer(c.shiftMs) || c.shiftMs === 0 || c.shiftMs > 86400000 || !integer(c.restMs) || c.restMs > 86400000 ||
    !Number.isFinite(sourceNow) || sourceNow < c.observedAt)
    return { declared: true, usable: false, state: 'requires_review', label: 'Refresh shift calendar', endAt: null, nextAt: null };
  if (sourceNow < c.epochAt) return { declared: true, usable: false, state: 'requires_review', label: 'Off shift', endAt: null, nextAt: c.epochAt };
  if (c.restMs === 0) return { declared: true, usable: true, state: 'connected', label: 'On shift', endAt: null, nextAt: null };
  const cycle = c.shiftMs + c.restMs, start = c.epochAt + Math.floor((sourceNow - c.epochAt) / cycle) * cycle, endAt = start + c.shiftMs;
  return sourceNow < endAt
    ? { declared: true, usable: true, state: 'connected', label: 'On shift', endAt, nextAt: start + cycle }
    : { declared: true, usable: false, state: 'requires_review', label: 'Resting', endAt: null, nextAt: start + cycle };
}
export function staffAvailabilityBadge(resource, sourceNow, { escape, time }) {
  const s = staffAvailabilityState(resource, sourceNow);
  return `<span class="badge ${s.state}">${s.label}</span>${s.endAt != null ? `<small>Until ${escape(time(s.endAt))}</small>` : s.nextAt != null ? `<small>Next shift ${escape(time(s.nextAt))}</small>` : ''}`;
}
