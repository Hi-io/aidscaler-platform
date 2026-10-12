import test from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../evaluation/harness.mjs";

test("asynchronous public-source checks retain a finite field queue and do not instantly reveal demand", async (t) => {
  const h = await createHarness({
    scenario: "S23",
    awaitVerifications: false,
    config: { observationRate: 1, postsPerHour: 0, inspectionMs: 60000 },
  });
  t.after(() => h.close());
  const w = h.lab.world,
    app = h.apps[0],
    places = w.state.map.buildings
      .filter((b) => b.use === "residential")
      .slice(0, 2);
  for (const [i, b] of places.entries())
    w.addNeed({
      id: "queued-hidden-" + i,
      building: b.id,
      type: "water",
      unit: "L",
      quantity: 40,
      deadline: 3600000,
    });
  const before = w.now,
    inquiries = [];
  for (const b of places)
    inquiries.push(
      await app.connector.action(
        "verify",
        { target: "building", id: b.id, method: "clarification" },
        "queued-" + b.id,
      ),
    );
  assert.equal(w.now, before);
  assert.equal(
    Object.values((await app.connector.state()).known.needs).some((n) =>
      n.id.startsWith("queued-hidden-"),
    ),
    false,
  );
  w.advance(before + 60000 + w.config.networkLatencyMs * 2);
  assert.equal(
    w.state.inspections.find((i) => i.id === inquiries[0].id).state,
    "completed",
  );
  assert.notEqual(
    w.state.inspections.find((i) => i.id === inquiries[1].id).state,
    "completed",
  );
  w.advance(before + 120000 + w.config.networkLatencyMs * 2);
  const state = await app.connector.state();
  assert.equal(
    Object.values(state.known.needs).filter((n) =>
      n.id.startsWith("queued-hidden-"),
    ).length,
    2,
  );
  assert.deepEqual(w.invariants(), []);
});
