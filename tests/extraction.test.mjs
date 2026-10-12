import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExtraction } from "../src/extraction.mjs";
import { allocationPlan } from "../src/planning.mjs";
test("structured extraction changes a partial planning quantity without erasing official demand or granting authority", () => {
  const row = {
    text: "People ask for 7 litres",
    kind: "need",
    sourceIds: ["post"],
    location: "b",
    resourceType: "water",
    quantity: 7,
  };
  const known = [
    { id: "n", building: "b", type: "water", quantity: 100, served: 0 },
  ];
  const extracted = normalizeExtraction(
    JSON.stringify({ observations: [row] }),
    [{ id: "post" }],
    known,
  );
  const args = {
    resources: [
      { id: "r", owner: "org0", type: "water", quantity: 100, floor: 0 },
    ],
    vehicles: [{ id: "v", owner: "org0", state: "idle", capacity: 20 }],
  };
  assert.equal(
    allocationPlan({ ...args, needs: known }).allocations[0].quantity,
    20,
  );
  assert.equal(
    allocationPlan({ ...args, needs: extracted.needs }).allocations[0].quantity,
    7,
  );
  assert.equal(known[0].quantity, 100);
  assert.equal(extracted.state, "unverified");
  const corrected = normalizeExtraction(
    JSON.stringify({
      observations: [{ ...row, kind: "correction", quantity: null }],
    }),
    [{ id: "post" }],
    known,
  );
  assert.equal(corrected.needs[0].quantity, 100);
  assert.throws(
    () =>
      normalizeExtraction(
        JSON.stringify({ observations: [{ ...row, sourceIds: ["secret"] }] }),
        [{ id: "post" }],
        known,
      ),
    /outside its actual input/,
  );
});
