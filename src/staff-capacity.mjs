// Capacity is derived only from received anonymous aggregate metadata. Marginal
// skill counts do not describe which people share several qualifications.
const integer = n => Number.isSafeInteger(n) && n >= 0;
const skillList = xs => Array.isArray(xs) && xs.length <= 32 &&
  xs.every(x => typeof x === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(x)) && new Set(xs).size === xs.length;

/** Anonymous owner/source calendar, evaluated on its received clock. A missing
 * calendar preserves legacy capacity; it is never described as a known shift.
 * useAt is the end of the intended work, including known travel/preparation. */
export function receivedStaffCalendar(resource, options = {}) {
  const calendar = resource?.staffCalendar ?? resource?.staffCapacity?.staffCalendar;
  if (calendar === undefined) return { declared: false, usable: true, reason: null,
    sourceNow: Number.isFinite(options.now) ? options.now : null, currentShiftEnd: null, nextAvailableAt: null, version: null, observedAt: null };
  const now = options.now === undefined ? calendar?.observedAt : options.now,
    workAt = options.workAt === undefined ? now : options.workAt,
    useAt = options.useAt === undefined ? workAt : options.useAt,
    base = { declared: true, usable: false, sourceNow: Number.isFinite(now) ? now : null,
      workAt: Number.isFinite(workAt) ? workAt : null,
      version: calendar?.version ?? null, observedAt: calendar?.observedAt ?? null,
      currentShiftEnd: null, nextAvailableAt: null };
  if (!calendar || !integer(calendar.version) || calendar.version === 0 ||
    !integer(calendar.observedAt) || !integer(calendar.epochAt) ||
    !integer(calendar.shiftMs) || calendar.shiftMs === 0 || calendar.shiftMs > 86400000 ||
    !integer(calendar.restMs) || calendar.restMs > 86400000)
    return { ...base, reason: "staff_calendar_invalid" };
  if (!Number.isFinite(now) || now < calendar.observedAt || !Number.isFinite(workAt) || workAt < now || !Number.isFinite(useAt) || useAt < workAt)
    return { ...base, reason: "staff_calendar_clock" };
  if (workAt < calendar.epochAt) return { ...base, reason: "staff_off_shift", nextAvailableAt: calendar.epochAt };
  if (calendar.restMs === 0) return { ...base, usable: true, reason: null, continuous: true };
  const cycle = calendar.shiftMs + calendar.restMs,
    cycleStart = calendar.epochAt + Math.floor((workAt - calendar.epochAt) / cycle) * cycle,
    shiftEnd = cycleStart + calendar.shiftMs;
  if (workAt >= shiftEnd) return { ...base, reason: "staff_resting", nextAvailableAt: cycleStart + cycle };
  if (useAt > shiftEnd) return { ...base, reason: "staff_shift_too_short", currentShiftEnd: shiftEnd,
    nextAvailableAt: calendar.restMs > 0 ? cycleStart + cycle : shiftEnd };
  return { ...base, usable: true, reason: null, currentShiftEnd: shiftEnd,
    nextAvailableAt: calendar.restMs > 0 ? cycleStart + cycle : shiftEnd };
}

export function receivedStaffCapacity(resource, required = [], held = 0, options = {}) {
  if (resource?.type !== "staff" || !skillList(required) || !integer(held)) return 0;
  if (!receivedStaffCalendar(resource, options).usable) return 0;
  const s = resource.staffCapacity ?? resource;
  // Old homogeneous offers explicitly certify every offered person. They do
  // not provide marginal counts, so partial credentials cannot be inferred.
  if (s.quantity === undefined) return integer(resource.available) && skillList(s.qualifications ?? []) &&
    required.every(k => (s.qualifications ?? []).includes(k)) ? Math.max(0, resource.available - held) : 0;
  if (resource.available !== undefined && !integer(resource.available)) return 0;
  if (!skillList(s.qualifications ?? [])) return 0;
  if (!integer(s.quantity) || !integer(s.reserved ?? 0) || !integer(s.floor ?? 0) ||
    (s.reserved ?? 0) + (s.floor ?? 0) > s.quantity) return 0;
  const counts = s.qualificationCounts ?? Object.fromEntries((s.qualifications ?? []).map(k => [k, s.quantity]));
  if (!counts || typeof counts !== "object" || Array.isArray(counts) ||
    !skillList(Object.keys(counts)) || Object.values(counts).some(n => !integer(n) || n > s.quantity)) return 0;
  let joint;
  if (s.qualificationProfiles !== undefined) {
    if (!Array.isArray(s.qualificationProfiles) || s.qualificationProfiles.length > 256 ||
      s.qualificationProfiles.some(g => !integer(g.quantity) || !skillList(g.qualifications)) ||
      s.qualificationProfiles.reduce((n, g) => n + g.quantity, 0) !== s.quantity) return 0;
    const actual = {};
    for (const g of s.qualificationProfiles) for (const k of g.qualifications) actual[k] = (actual[k] ?? 0) + g.quantity;
    if ([...new Set([...Object.keys(counts), ...Object.keys(actual)])].some(k => (counts[k] ?? 0) !== (actual[k] ?? 0))) return 0;
    joint = s.qualificationProfiles.filter(g => required.every(k => g.qualifications.includes(k))).reduce((n, g) => n + g.quantity, 0);
  } else joint = required.length ? Math.max(0,
    required.reduce((n, k) => n + (counts[k] ?? 0), 0) - (required.length - 1) * s.quantity) : s.quantity;
  // Reservations/protected headcount might contain the qualified people. We
  // cannot read the owner's private selection, so subtract their full amount.
  return Math.max(0, Math.min(resource.available ?? Infinity,
    joint - (s.reserved ?? 0) - (s.floor ?? 0)) - held);
}

export function staffCapacityProjection(resource) {
  if (resource.type !== "staff") return {};
  const calendar = resource.staffCalendar ?? resource.staffCapacity?.staffCalendar;
  return { ...(calendar === undefined ? {} : { staffCalendar: Object.fromEntries(Object.entries({
    version: calendar?.version, observedAt: calendar?.observedAt, epochAt: calendar?.epochAt,
    shiftMs: calendar?.shiftMs, restMs: calendar?.restMs,
  }).filter(([, value]) => value !== undefined)) }),
    staffCapacity: structuredClone({ quantity: resource.quantity,
    reserved: resource.reserved ?? 0, floor: resource.floor ?? 0,
    qualifications: resource.qualifications ?? [],
    ...(resource.qualificationCounts === undefined ? {} : { qualificationCounts: resource.qualificationCounts }),
    ...(resource.qualificationProfiles === undefined ? {} : { qualificationProfiles: resource.qualificationProfiles }) }) };
}
