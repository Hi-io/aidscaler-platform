import test from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../evaluation/harness.mjs";

test("public discovery obtains physical need observations before drafting; model quantities never override them", async (t) => {
  let target,
    calls = 0;
  const h = await createHarness({
    scenario: "S23",
    config: { observationRate: 1, authorshipMs: 0, sourceIndexMs: 0 },
    provider: {
      complete: async (request) => {
        calls++;
        assert.equal(request.task, "perception");
        return {
          model: "contract-test",
          message: {
            content: JSON.stringify({
              observations: [
                {
                  text: "Water is requested",
                  kind: "need",
                  sourceIds: ["S1"],
                  location: target,
                  resourceType: "water",
                  quantity: 9999,
                  unit: "L",
                  timeStatus: "current",
                },
              ],
            }),
          },
          usage: {},
        };
      },
    },
  });
  t.after(() => h.close());
  const app = h.apps[0],
    w = h.lab.world;
  target = w.state.map.buildings.find((b) => b.use === "residential").id;
  const physical = w.addNeed({
    id: "unreported-water",
    building: target,
    type: "water",
    unit: "L",
    quantity: 40,
    population: 10,
    deadline: 3600000,
  });
  const signal = w.generateSignal("P01", {
    building: target,
    causeEvent: "unreported",
    compositionMs: 0,
    text: `Families at ${target} have no drinking water left.`,
  });
  w.advance(60000);
  for (const kind of ["map", "inventory", "vehicles"])
    await app.connector.action("query", { target: kind }, "initial-" + kind);
  await app.ingestion.sync();
  assert.equal(
    (await app.store.list("org0", "need", 100)).some(
      (n) => n.id === physical.id,
    ),
    false,
  );
  const result = await app.discovery.run(
    { ids: [signal.public.id] },
    "public-discovery",
  );
  assert.equal(result.state, "ready");
  const received = await app.store.get("org0", "need", physical.id);
  assert.equal(received.quantity, 40);
  const p = await app.store.get("org0", "proposal", result.proposalId);
  assert.equal(p.state, "awaiting_review");
  assert.equal(
    p.actions
      .filter((a) => a.params.need === physical.id)
      .reduce((s, a) => s + a.params.quantity, 0),
    40,
  );
  assert.equal(w.need(physical.id).served, 0);
  assert.equal(
    w.state.operations.some((o) => o.type === "delivery"),
    false,
  );
  assert.equal(calls, 1);
  assert.equal(
    (await app.discovery.run({}, "public-discovery")).proposalId,
    p.id,
  );
  assert.equal(calls, 1);
  assert.deepEqual(w.invariants(), []);
});

test("unknown or historical source interpretations do not become authoritative needs", async (t) => {
  const h = await createHarness({
    provider: {
      complete: async () => ({
        message: {
          content: JSON.stringify({
            observations: [
              {
                text: "Historical request",
                kind: "need",
                sourceIds: ["S1"],
                location: "unseen",
                resourceType: "water",
                quantity: 10,
                unit: "L",
                timeStatus: "historical",
              },
            ],
          }),
        },
        usage: {},
      }),
    },
  });
  t.after(() => h.close());
  const app = h.apps[0];
  await app.store.put(
    "org0",
    "signal",
    "old",
    { text: "Historical request at unseen in 2023", sourceVersion: 1 },
    0,
  );
  await app.store.put(
    "org0",
    "context",
    "geography",
    { map: { places: [{ id: "unseen", name: "unseen" }] } },
    0,
  );
  const result = await app.discovery.run({ ids: ["old"] }, "old-case");
  assert.equal(result.state, "inconclusive");
  assert.equal(result.verifications.length, 0);
  assert.equal(
    (await app.store.list("org0", "need")).some((n) => n.building === "unseen"),
    false,
  );
  assert.equal((await app.store.list("org0", "proposal")).length, 0);
});
