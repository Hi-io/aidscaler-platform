const time = (value) => Number.isSafeInteger(value) && value >= 0;

/** A received calendar is an owner's declared constraint, never a prediction
 * that a busy vehicle will become free. Callers still require current idle or
 * arrived telemetry and ordinary owner approval. No clock or route is read
 * from the simulator observer. */
export function receivedVehicleCalendar(
  vehicle,
  { now, pickup, delivery, returnRoute = null, executionPolicy = null } = {},
) {
  const calendar = vehicle?.calendar;
  if (calendar == null) return { usable: true, declared: false, reason: null };
  const fail = (reason) => ({ usable: false, declared: true, reason });
  if (
    !calendar ||
    typeof calendar !== "object" ||
    Array.isArray(calendar) ||
    !Number.isSafeInteger(calendar.version) ||
    calendar.version < 1 ||
    !time(calendar.observedAt) ||
    !time(now) ||
    calendar.observedAt > now ||
    (calendar.availableAfter !== undefined && !time(calendar.availableAfter)) ||
    (calendar.availableUntil !== undefined && !time(calendar.availableUntil)) ||
    (calendar.availableAfter !== undefined &&
      calendar.availableUntil !== undefined &&
      calendar.availableUntil <= calendar.availableAfter)
  )
    return fail("calendar_evidence");
  const next = calendar.nextCommitment;
  if (
    next !== undefined &&
    (!next ||
      typeof next.id !== "string" ||
      !next.id ||
      !time(next.startsAt) ||
      typeof next.node !== "string" ||
      !next.node)
  )
    return fail("calendar_evidence");
  if (calendar.availableAfter !== undefined && now < calendar.availableAfter)
    return fail("calendar_not_available");
  const timing = executionPolicy?.delivery;
  if (
    ![
      pickup?.seconds,
      delivery?.seconds,
      timing?.loadMs,
      timing?.unloadMs,
      timing?.commandNominalLatencyMs,
    ].every((n) => Number.isFinite(n) && n >= 0)
  )
    return fail("calendar_timing_unknown");
  const serviceAt =
    now +
    Math.ceil((pickup.seconds + delivery.seconds) * 1000) +
    timing.loadMs +
    timing.unloadMs +
    timing.commandNominalLatencyMs;
  let nextReturnAt = serviceAt;
  if (next) {
    if (
      !returnRoute ||
      !Number.isFinite(returnRoute.seconds) ||
      returnRoute.seconds < 0
    )
      return fail("calendar_return_route");
    nextReturnAt += Math.ceil(returnRoute.seconds * 1000);
    if (nextReturnAt > next.startsAt) return fail("calendar_next_commitment");
  }
  if (
    calendar.availableUntil !== undefined &&
    nextReturnAt >= calendar.availableUntil
  )
    return fail("calendar_window");
  return {
    usable: true,
    declared: true,
    reason: null,
    version: calendar.version,
    observedAt: calendar.observedAt,
    availableAfter: calendar.availableAfter ?? null,
    availableUntil: calendar.availableUntil ?? null,
    nextCommitment: next ?? null,
    serviceAt,
    nextReturnAt,
    returnRoute: next ? returnRoute : null,
    note: "Nominal received travel and handling; a changed window or delayed command is rechecked by the owner source. Busy telemetry does not authorize future work.",
  };
}
