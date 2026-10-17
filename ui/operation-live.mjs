/** Received operation progress only. Slow reads never queue animations/requests;
 * closing, switching views or hiding the document prevents late UI writes. */
export function createOperationRefresh({ load, initial, apply, current = () => true, intervalMs = 5000,
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const key = row => JSON.stringify([row.version, row.state, row.received, row.quantity, row.phase, row.times, row.requiresRepair, row.changedReason]);
  let applied = key(initial), stopped = false, busy = false, timer = null, controller = null;
  const refresh = {
    stop() { stopped = true; if (timer !== null) unschedule(timer); controller?.abort(); },
    async poll() {
      if (busy || stopped || !current()) return false;
      busy = true; controller = new AbortController();
      try {
        const row = await load(controller.signal);
        if (stopped || !current() || key(row) === applied) return false;
        if (await apply(row) === false) return false;
        applied = key(row); return true;
      } catch (error) {
        if (stopped || controller.signal.aborted) return false;
        throw error;
      } finally { busy = false; controller = null; }
    },
    start() {
      const tick = async () => {
        try { await refresh.poll(); } catch { /* A failed read never invents progress. The next bounded read retries. */ }
        if (!stopped) timer = schedule(tick, intervalMs);
      };
      if (!stopped && timer === null) timer = schedule(tick, intervalMs);
      return refresh;
    },
  };
  return refresh;
}
