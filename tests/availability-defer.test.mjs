import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { responseQueue } from "../src/response-policy.mjs";

async function fixture(t) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.put("org0", "source", "simulator", { simulatedAt: 1000 }, 0);
  await store.put(
    "org0",
    "need",
    "need",
    { type: "water", quantity: 100, served: 0 },
    0,
  );
  return store;
}
async function defer(store) {
  const queue = await responseQueue(store, "org0");
  await store.upsert("org0", "response_defer", "need", {
    signature: queue.signature,
    reason: "Received capacity cannot currently execute",
    activityId: "inquiry",
    at: Date.now(),
  });
  assert.ok((await responseQueue(store, "org0")).rows[0].investigationDeferred);
  return queue.signature;
}
async function released(store, signature) {
  const queue = await responseQueue(store, "org0");
  assert.notEqual(queue.signature, signature);
  assert.equal(queue.rows[0].investigationDeferred, null);
}

test("own driver/window changes release a deferred inquiry but identical received polls do not", async (t) => {
  const store = await fixture(t);
  await store.put(
    "org0",
    "vehicle",
    "truck",
    {
      owner: "org0",
      state: "idle",
      node: "a",
      driverAvailable: false,
      calendar: {
        version: 1,
        observedAt: 1000,
        availableAfter: 2000,
        availableUntil: 4000,
        nextCommitment: { id: "next", startsAt: 4000, node: "a" },
      },
    },
    0,
  );
  let signature = await defer(store);
  await store.upsert("org0", "source", "simulator", { simulatedAt: 1100 });
  await store.upsert("org0", "vehicle", "truck", {
    at: 1100,
    sourceVersion: 2,
    calendar: {
      version: 2,
      observedAt: 1100,
      availableAfter: 2000,
      availableUntil: 4000,
      nextCommitment: { id: "next", startsAt: 4000, node: "a" },
    },
  });
  assert.equal((await responseQueue(store, "org0")).signature, signature);
  assert.ok((await responseQueue(store, "org0")).rows[0].investigationDeferred);
  await store.upsert("org0", "vehicle", "truck", { driverAvailable: true });
  await released(store, signature);
  signature = await defer(store);
  await store.upsert("org0", "source", "simulator", { simulatedAt: 2000 });
  await released(store, signature);
  signature = await defer(store);
  await store.upsert("org0", "vehicle", "truck", {
    calendar: {
      version: 3,
      observedAt: 2000,
      availableAfter: 2000,
      availableUntil: 10000,
      nextCommitment: { id: "next", startsAt: 10000, node: "b" },
    },
  });
  await released(store, signature);
});

test("consented peer driver and calendar changes reopen the inquiry without accessing the other owner's private data", async (t) => {
  const store = await fixture(t);
  await store.put(
    "org0",
    "peer_offer",
    "shared-truck",
    {
      kind: "vehicle",
      from: "org1",
      active: true,
      expiresAt: Date.now() + 60000,
      permissionVersion: 1,
      projection: {
        id: "truck",
        state: "idle",
        node: "a",
        driverAvailable: false,
        calendar: { version: 1, observedAt: 1000, availableUntil: 2000 },
      },
    },
    0,
  );
  const old = await defer(store);
  await store.organization("org1");
  await store.put(
    "org1",
    "vehicle",
    "truck",
    {
      driverAvailable: true,
      calendar: { availableUntil: 9999999 },
      privateRoster: ["SECRET"],
    },
    0,
  );
  assert.equal((await responseQueue(store, "org0")).signature, old);
  await store.upsert("org0", "peer_offer", "shared-truck", {
    projection: {
      id: "truck",
      state: "idle",
      node: "a",
      driverAvailable: true,
      calendar: { version: 2, observedAt: 1000, availableUntil: 2000 },
    },
  });
  await released(store, old);
  const next = await defer(store);
  await store.upsert("org0", "peer_offer", "shared-truck", {
    projection: {
      id: "truck",
      state: "idle",
      node: "a",
      driverAvailable: true,
      calendar: { version: 3, observedAt: 1000, availableUntil: 20000 },
    },
  });
  await released(store, next);
});

test("received staff rest/shift transitions and consented shift corrections release deferrals exactly when eligibility changes", async (t) => {
  const store = await fixture(t),
    staffCalendar = {
      version: 1,
      observedAt: 1000,
      epochAt: 0,
      shiftMs: 2000,
      restMs: 2000,
    };
  await store.put(
    "org0",
    "resource",
    "crew",
    { type: "staff", quantity: 2, reserved: 0, floor: 0, staffCalendar },
    0,
  );
  let signature = await defer(store);
  await store.upsert("org0", "source", "simulator", { simulatedAt: 1500 });
  await store.upsert("org0", "resource", "crew", {
    staffCalendar: {
      ...staffCalendar,
      version: 2,
      observedAt: 1500,
      privateRoster: ["unshared"],
    },
  });
  assert.equal((await responseQueue(store, "org0")).signature, signature);
  await store.upsert("org0", "source", "simulator", { simulatedAt: 2000 });
  await released(store, signature);
  signature = await defer(store);
  await store.upsert("org0", "source", "simulator", { simulatedAt: 3999 });
  assert.equal((await responseQueue(store, "org0")).signature, signature);
  await store.upsert("org0", "source", "simulator", { simulatedAt: 4000 });
  await released(store, signature);
  await store.put(
    "org0",
    "peer_offer",
    "peer-crew",
    {
      kind: "resource",
      from: "org1",
      active: true,
      expiresAt: Date.now() + 60000,
      permissionVersion: 1,
      projection: {
        id: "peer-staff",
        type: "staff",
        available: 2,
        staffCalendar: { ...staffCalendar, observedAt: 4000, epochAt: 5000 },
      },
    },
    0,
  );
  signature = await defer(store);
  await store.upsert("org0", "peer_offer", "peer-crew", {
    projection: {
      id: "peer-staff",
      type: "staff",
      available: 2,
      staffCalendar: { ...staffCalendar, observedAt: 4000, epochAt: 4000 },
    },
  });
  await released(store, signature);
});
