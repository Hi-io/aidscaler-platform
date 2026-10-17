import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationRefresh } from '../ui/operation-live.mjs';
import { operationSummary } from '../ui/operation-view.mjs';
const wait = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve }; };
const initial = { version: 1, state: 'reserved', quantity: 200, received: 0, confirmedBySource: true, resourceType: 'water', times: { reserved: 1 } };
const received = { ...initial, version: 2, state: 'completed', received: 200, times: { reserved: 1, dispatched: 2, arrived: 3, received: 4, service: 4 } };

test('open operation updates from a received scoped record while slow reads stay single-flight', async () => {
  const waiting = wait(); let reads = 0, shown;
  const refresh = createOperationRefresh({ initial, load: () => { reads++; return waiting.promise; }, apply: row => { shown = operationSummary(row); } });
  const first = refresh.poll();
  assert.equal(await refresh.poll(), false); assert.equal(reads, 1);
  waiting.resolve(received); assert.equal(await first, true);
  assert.equal(shown.confirmation, 'Receipt recorded'); assert.equal(shown.received, 200);
  assert.equal(await refresh.poll(), false, 'the same version never replaces the view repeatedly');
});

test('hidden or replaced dialogs never fetch or receive a late result, and close aborts an admitted read', async () => {
  let visible = false, reads = 0, writes = 0;
  const pending = wait();
  const refresh = createOperationRefresh({ initial, current: () => visible, load: () => { reads++; return pending.promise; }, apply: () => { writes++; } });
  assert.equal(await refresh.poll(), false); assert.equal(reads, 0);
  visible = true; const admitted = refresh.poll(); visible = false; pending.resolve(received);
  assert.equal(await admitted, false); assert.equal(writes, 0);
  let aborted = false;
  const closing = createOperationRefresh({ initial, load: signal => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('closed', 'AbortError')); })), apply: () => { writes++; } });
  const flight = closing.poll(); closing.stop();
  assert.equal(await flight, false); assert.equal(aborted, true); assert.equal(writes, 0);
});

test('focused details can postpone a changed record without losing it or resetting their contents', async () => {
  let focused = true, attempts = 0, displayed = initial;
  const untouchedForm = { note: 'Keep this draft', quantity: '75' };
  const refresh = createOperationRefresh({ initial, load: async () => received, apply: row => { attempts++; if (focused) return false; displayed = row; return true; } });
  assert.equal(await refresh.poll(), false); assert.equal(displayed, initial);
  focused = false; assert.equal(await refresh.poll(), true); assert.equal(displayed, received);
  assert.equal(attempts, 2); assert.deepEqual(untouchedForm, { note: 'Keep this draft', quantity: '75' });
});

test('automatic reads wait five seconds after completion and stop without accumulating timers', async () => {
  const timers = []; let reads = 0, cleared = false;
  const refresh = createOperationRefresh({ initial, load: async () => { reads++; return received; }, apply: () => true,
    schedule: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, unschedule: () => { cleared = true; } });
  refresh.start(); assert.equal(reads, 0); assert.equal(timers[0].delay, 5000);
  await timers[0].fn(); assert.equal(reads, 1); assert.equal(timers.length, 2);
  refresh.stop(); assert.equal(cleared, true); await timers[1].fn(); assert.equal(reads, 1); assert.equal(timers.length, 2);
});
