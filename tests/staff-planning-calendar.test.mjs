import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { allocationPlan, validatePlan } from "../src/planning.mjs";

const calendar = {
  version: 1,
  observedAt: 1000,
  epochAt: 0,
  shiftMs: 60000,
  restMs: 60000,
};
const crew = {
  id: "crew",
  owner: "org0",
  type: "staff",
  quantity: 2,
  reserved: 0,
  floor: 0,
  node: "a",
  qualifications: ["field_assessment", "shelter_support"],
  staffCalendar: calendar,
};
const vehicle = {
  id: "truck",
  owner: "org0",
  node: "a",
  state: "idle",
  capacity: 10,
  weightKg: 2000,
  maxCargoKg: 150,
  volumeM3: 0.15,
  seats: 2,
  speedMps: 10,
  driverAvailable: true,
};
const need = { id: "need", type: "staff", quantity: 1, served: 0, node: "b" };
const map = {
  nodes: [{ id: "a" }, { id: "b" }],
  places: [{ id: "site", node: "b" }],
  roads: [
    {
      id: "ab",
      from: "a",
      to: "b",
      lengthM: 100,
      speedMps: 10,
      maxWeight: 10000,
      open: true,
    },
  ],
};
const execution = {
  reservation: { defaultTtlMs: 900000, maxTtlMs: 86400000 },
  delivery: { loadMs: 10000, unloadMs: 10000, commandNominalLatencyMs: 1000 },
  service: { setupMs: 10000 },
  fieldAssessment: { inspectionMs: 20000, commandNominalLatencyMs: 1000 },
};
const dispatch = {
  type: "dispatch",
  owner: "org0",
  dependsOn: [],
  params: {
    vehicle: "truck",
    resource: "crew",
    need: "need",
    quantity: 1,
    staffSkills: ["shelter_support"],
  },
};
const inspect = {
  type: "verify",
  owner: "org0",
  dependsOn: [],
  params: {
    target: "building",
    id: "site",
    targetVersion: 1,
    staff: "crew",
    vehicle: "truck",
    method: "field",
    purpose: "facility_safety",
  },
};

async function fixture(t) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.put("org0", "source", "simulator", { simulatedAt: 1000 }, 0);
  await store.put("org0", "context", "geography", { map }, 0);
  await store.put(
    "org0",
    "context",
    "operational",
    {
      snapshot: {
        now: 1000,
        queries: [
          {
            id: "policy",
            target: "policy",
            state: "ready",
            completedAt: 1000,
            result: { version: 1, observedAt: 1000, execution },
          },
        ],
      },
    },
    0,
  );
  await store.put("org0", "resource", "crew", crew, 0);
  await store.put("org0", "vehicle", "truck", vehicle, 0);
  await store.put("org0", "need", "need", need, 0);
  await store.put(
    "org0",
    "facility",
    "site",
    { node: "b", use: "shelter", sourceVersion: 1 },
    0,
  );
  return store;
}

test("common staff allocations carry received shift refusals instead of silently counting resting or late-arriving staff", () => {
  const run = (r, policy = execution, topology = map) =>
    allocationPlan({
      now: 1000,
      needs: [need],
      resources: [r],
      vehicles: [vehicle],
      map: topology,
      executionPolicy: policy,
    });
  assert.equal(run(crew).allocations.length, 1);
  for (const [r, timing, topology] of [
    [
      { ...crew, staffCalendar: { ...calendar, shiftMs: 20000 } },
      execution,
      map,
    ],
    [crew, null, map],
    [crew, execution, null],
  ]) {
    const result = run(r, timing, topology);
    assert.equal(result.allocations.length, 0);
    assert.equal(result.unserved[0].remaining, 1);
    assert.equal(result.unserved[0].blockingReasons[0].code, "STAFF_CALENDAR");
    assert.equal(result.unserved[0].blockingReasons[0].resource, "crew");
  }
});

test("field assessment ends inside the received crew shift and does not invent work timing or trust old shift observations", async (t) => {
  const store = await fixture(t),
    accepted = await validatePlan(store, "org0", { actions: [inspect] }),
    timing = accepted.find((c) => c.type === "qualified_field_crew");
  assert.equal(timing.nominalWorkStartsAt, 12000);
  assert.equal(timing.nominalWorkEndsAt, 32000);
  await store.upsert("org0", "resource", "crew", {
    staffCalendar: { ...calendar, version: 2, shiftMs: 30000 },
  });
  await assert.rejects(validatePlan(store, "org0", { actions: [inspect] }), {
    code: "STAFF_CALENDAR",
  });
  await store.upsert("org0", "resource", "crew", { staffCalendar: calendar });
  await store.upsert("org0", "context", "operational", {
    snapshot: { now: 1000, queries: [] },
  });
  await assert.rejects(validatePlan(store, "org0", { actions: [inspect] }), {
    code: "STAFF_CALENDAR",
  });
  assert.equal((await store.get("org0", "resource", "crew")).reserved, 0);
  assert.equal((await store.list("org0", "proposal")).length, 0);
});

test("staff shipment and service setup use their received completion times, preserving stock and authority on shift refusal", async (t) => {
  const store = await fixture(t),
    received = await validatePlan(store, "org0", { actions: [dispatch] }),
    timing = received.find((c) => c.type === "staff_calendar");
  assert.equal(timing.nominalWorkStartsAt, 32000);
  assert.equal(timing.nominalWorkEndsAt, 32000);
  const provisioning = {
    ...dispatch,
    params: {
      vehicle: "truck",
      resource: "crew",
      building: "site",
      destination: "b",
      quantity: 1,
      staffSkills: ["shelter_support"],
    },
  };
  const service = await validatePlan(store, "org0", {
    actions: [provisioning],
  });
  assert.equal(
    service.find((c) => c.type === "staff_calendar").nominalWorkEndsAt,
    42000,
  );
  await store.upsert("org0", "resource", "crew", {
    staffCalendar: { ...calendar, shiftMs: 40000, version: 2 },
  });
  await assert.rejects(
    validatePlan(store, "org0", { actions: [provisioning] }),
    { code: "STAFF_CALENDAR" },
  );
  assert.equal(
    (await validatePlan(store, "org0", { actions: [dispatch] })).find(
      (c) => c.type === "staff_calendar",
    ).nominalWorkEndsAt,
    32000,
  );
  assert.equal((await store.get("org0", "resource", "crew")).quantity, 2);
  assert.equal((await store.get("org0", "resource", "crew")).reserved, 0);
  assert.equal(
    (await store.query("SELECT COUNT(*) AS n FROM jobs")).rows[0].n,
    0,
  );
});
