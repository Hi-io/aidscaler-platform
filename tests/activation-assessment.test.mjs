import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { validatePlan, validateConditions } from "../src/planning.mjs";

const org = "org0";
const facility = {
  id: "site",
  use: "shelter",
  capacity: 100,
  safe: true,
  sourceVersion: 7,
};
const assessment = {
  method: "field",
  purpose: "facility_safety",
  competent: true,
  qualifications: ["field_assessment"],
  targetVersion: 7,
  inspectorOrg: org,
  staffResource: "staff",
  vehicle: "crew",
  operation: "assessment-trip",
  observedAt: 1000,
  validUntil: 5000,
};
const verification = {
  id: "inspection",
  org,
  target: "building",
  entity: "site",
  method: "field",
  purpose: "facility_safety",
  targetVersion: 7,
  state: "completed",
  confirmedBySource: true,
  completedAt: 1100,
  result: { safe: true, version: 7, assessment },
};
const plan = {
  id: "activation",
  actions: [
    {
      type: "activate",
      owner: org,
      params: { building: "site", permit: true },
      dependsOn: [],
    },
  ],
};

async function fixture(t) {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization(org);
  await s.upsert(org, "source", "simulator", { simulatedAt: 2000 });
  await s.upsert(org, "facility", "site", facility);
  return s;
}

test("safe facility flags and clarification acknowledgments cannot authorize activation", async (t) => {
  const s = await fixture(t);
  await assert.rejects(
    validatePlan(s, org, plan),
    (e) => e.code === "SAFETY_INSPECTION",
  );
  await s.upsert(org, "verification", "inspection", {
    ...verification,
    method: "clarification",
  });
  await assert.rejects(
    validatePlan(s, org, plan),
    (e) => e.code === "SAFETY_INSPECTION",
  );
  const [condition] = await validateConditions(s, org, [
    { type: "inspection", id: "inspection" },
  ]);
  assert.equal(condition.satisfied, false);
});

test("activation rechecks physical competence, expiry and current source version", async (t) => {
  const s = await fixture(t);
  await s.upsert(org, "verification", "inspection", verification);
  const checked = await validatePlan(s, org, plan);
  assert.equal(checked[0].assessment, "inspection");
  assert.equal(checked[0].sourceTargetVersion, 7);
  const [condition] = await validateConditions(s, org, [
    { type: "inspection", id: "inspection" },
  ]);
  assert.equal(condition.satisfied, true);
  for (const patch of [
    { confirmedBySource: false },
    { entity: "another-site" },
    { result: { ...verification.result, version: 6 } },
    {
      result: {
        ...verification.result,
        assessment: { ...assessment, validUntil: 2000 },
      },
    },
    {
      result: {
        ...verification.result,
        assessment: { ...assessment, qualifications: ["shelter_support"] },
      },
    },
    {
      result: {
        ...verification.result,
        assessment: { ...assessment, inspectorOrg: "unauthenticated-owner" },
      },
    },
  ]) {
    await s.upsert(org, "verification", "inspection", {
      ...verification,
      ...patch,
    });
    await assert.rejects(
      validatePlan(s, org, plan),
      (e) => e.code === "SAFETY_INSPECTION",
    );
  }
  await s.upsert(org, "verification", "inspection", verification);
  await s.upsert(org, "facility", "site", { sourceVersion: 8 });
  await assert.rejects(
    validatePlan(s, org, plan),
    (e) => e.code === "SAFETY_INSPECTION",
  );
});

test("generic completed demand inspection remains an information condition without certifying a facility", async (t) => {
  const s = await fixture(t);
  await s.upsert(org, "verification", "need-check", {
    target: "need",
    entity: "n",
    method: "clarification",
    state: "completed",
    result: { quantity: 10 },
  });
  const [condition] = await validateConditions(s, org, [
    { type: "inspection", id: "need-check" },
  ]);
  assert.equal(condition.satisfied, true);
  await assert.rejects(
    validatePlan(s, org, plan),
    (e) => e.code === "SAFETY_INSPECTION",
  );
});
