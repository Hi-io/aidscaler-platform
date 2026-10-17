import test from "node:test";
import assert from "node:assert/strict";
import { createWorkforceControls } from "../ui/workforce.mjs";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(run, { save, flush, refresh } = {}) {
  const originals = new Map(["navigator", "localStorage", "FormData"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem() {}, getItem() { return null; } } });
  Object.defineProperty(globalThis, "FormData", { configurable: true, value: class { constructor(form) { return new Map(Object.entries(form.elements).map(([key, element]) => [key, element.value])); } } });
  const stageListeners = {}, listeners = {}, button = { disabled: false }, received = { hidden: true };
  const form = {
    isConnected: true,
    elements: { stage: { value: "acknowledged", addEventListener: (event, fn) => { stageListeners[event] = fn; } }, note: { value: "Ready to travel", required: false }, quantity: { value: "37", required: false } },
    querySelector: selector => selector === "[data-task-received]" ? received : button,
    addEventListener: (event, fn) => { listeners[event] = fn; },
  };
  const calls = { queued: [], flush: 0, refresh: 0, close: 0, render: 0, toasts: [] };
  const task = { id: "task-operation-one", version: 3, assignee: "taylor", state: "assigned", title: "Delivery to Sakura Shelter", destination: "n41", destinationName: "Sakura Shelter", quantity: 300, unit: "L" };
  const controls = createWorkforceControls({
    state: { user: { id: "taylor", org: "org0", role: "field" } }, escape: value => String(value ?? ""),
    api: async path => path === "/api/tasks" ? [task] : [], badge: value => String(value), action: () => "", modal() {},
    offlineQueue: async (operation, item) => { assert.equal(operation, "put"); calls.queued.push(structuredClone(item)); return save?.(item, calls.queued.length); },
    flush: async () => { calls.flush++; await flush?.(); },
    refreshFieldOutbox: async () => { calls.refresh++; await refresh?.(); },
    close: async () => { calls.close++; }, render: async () => { calls.render++; }, toast: text => calls.toasts.push(text),
  });
  try {
    await controls.field(); await controls.run("task-open", task.id);
    controls.bind({ querySelector: selector => selector === "#taskupdateform" ? form : null });
    await run({ calls, form, button, received, change: value => { form.elements.stage.value = value; stageListeners.change(); }, submit: () => listeners.submit({ target: form, preventDefault() {} }) });
  } finally {
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}

test("double task submit queues one update and refreshes only the outbox, retaining the background composer", async () => {
  const saved = deferred();
  await fixture(async ({ calls, button, submit }) => {
    const first = submit(), second = submit();
    assert.equal(calls.queued.length, 1); assert.equal(button.disabled, true);
    saved.resolve(); await Promise.all([first, second]);
    assert.equal(calls.flush, 1); assert.equal(calls.refresh, 1); assert.equal(calls.close, 1);
    assert.equal(calls.render, 0, "a field task update must not replace the unsent observation composer");
    assert.equal("quantity" in calls.queued[0].taskPayload, false, "an old quantity entry is irrelevant outside the receipt stage");
    assert.equal(calls.queued[0].location, "Sakura Shelter");
  }, { save: () => saved.promise });
});

test("a saved task update stays duplicate-safe if network delivery or outbox refresh fails", async () => {
  await fixture(async ({ calls, button, submit }) => {
    await submit(); await submit();
    assert.equal(calls.queued.length, 1); assert.equal(button.disabled, true);
    assert.equal(calls.close, 1); assert.equal(calls.refresh, 1); assert.equal(calls.render, 0);
    assert.ok(calls.toasts.some(text => /saved/i.test(text)));
  }, { flush: async () => { throw Error("Network unavailable"); }, refresh: async () => { throw Error("View unavailable"); } });
});

test("a failed local save retains the form and enables an explicit retry without closing or rendering", async () => {
  await fixture(async ({ calls, form, button, submit }) => {
    await submit();
    assert.equal(button.disabled, false); assert.equal(form.elements.note.value, "Ready to travel");
    assert.equal(calls.close, 0); assert.equal(calls.flush, 0); assert.equal(calls.refresh, 0); assert.equal(calls.render, 0);
    await submit();
    assert.equal(calls.queued.length, 2); assert.equal(calls.flush, 1); assert.equal(calls.refresh, 1);
    assert.equal(calls.queued[0].taskPayload.id, calls.queued[1].taskPayload.id);
  }, { save: async (_, attempt) => { if (attempt === 1) throw Error("Device storage is full"); } });
});

test("receipt quantity and note are required only at receipt, and other stages omit stale quantity", async () => {
  await fixture(async ({ form, received, change, calls, submit }) => {
    assert.equal(received.hidden, true); assert.equal(form.elements.quantity.required, false); assert.equal(form.elements.note.required, false);
    change("receipt_reported");
    assert.equal(received.hidden, false); assert.equal(form.elements.quantity.required, true); assert.equal(form.elements.note.required, true);
    change("problem");
    assert.equal(received.hidden, true); assert.equal(form.elements.quantity.required, false); assert.equal(form.elements.note.required, false);
    change("receipt_reported"); form.elements.quantity.value = "120"; form.elements.note.value = "Counted 120 L at the shelter.";
    await submit();
    assert.equal(calls.queued[0].taskPayload.quantity, 120); assert.equal(calls.queued[0].taskPayload.stage, "receipt_reported");
    assert.equal(calls.render, 0);
  });
});
