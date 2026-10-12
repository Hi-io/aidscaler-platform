import test from "node:test";
import assert from "node:assert/strict";
import {
  createHarness,
  refreshResearchContext,
  conventionalSharedProposal,
} from "../evaluation/harness.mjs";

test("broad research refresh uses an explicit owner for the real capabilities API", async (t) => {
  const h = await createHarness({ scenario: "S06", organizations: 1 });
  t.after(() => h.close());
  h.lab.world.advance(60000);
  const app = h.apps[0];
  await assert.rejects(
    app.connector.action(
      "query",
      { target: "capabilities" },
      "broken-reference",
    ),
    { code: "NOT_FOUND" },
  );
  await refreshResearchContext(app, "corrected-reference", [
    "inventory",
    "vehicles",
    "roads",
    "documents",
    "map",
    "capabilities",
  ]);
  await app.ingestion.sync({ sources: false });
  assert.equal(h.lab.world.state.queryCount, 7);
  assert.deepEqual(h.lab.world.invariants(), []);
});

test("conventional reference retains a pending unknown facility and still prepares feasible water", async (t) => {
  const h = await createHarness({
    scenario: "S19",
    organizations: 4,
    seed: "reference-unavailable-facility",
    config: { compositionVariant: "distributed" },
  });
  t.after(() => h.close());
  h.lab.world.advance(60000);
  const app = h.apps[0];
  for (const target of ["inventory", "vehicles", "map"])
    await app.connector.action(
      "query",
      { target },
      "reference-initial-" + target,
    );
  await app.ingestion.sync();
  const r = await conventionalSharedProposal(
    app,
    "reference-feasible-fallback",
  );
  assert.equal(r.state, "ready");
  assert.ok(
    r.steps.some(
      (x) => x.state === "infeasible" && x.result.reason === "FACILITY",
    ),
  );
  const p = await app.store.get(app.config.org, "proposal", r.proposalId);
  const deliveries = p.actions.filter((a) => a.type === "dispatch");
  assert.ok(deliveries.length);
  assert.ok(deliveries.every((a) => a.params.need === "need-water-main" && a.params.quantity > 0));
  assert.ok(deliveries.reduce((sum, a) => sum + a.params.quantity, 0) <= 600);
  assert.ok(!p.actions.some((a) => a.type === "activate"));
  assert.deepEqual(h.lab.world.invariants(), []);
});
