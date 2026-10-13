import test from "node:test";
import assert from "node:assert/strict";
import { createHarness, scriptedReview } from "../evaluation/harness.mjs";
import { Worker } from "../src/worker.mjs";

test("finite source reviews queue concurrently and resume exact authorized work after restart", { timeout: 90000 }, async (t) => {
  const h = await createHarness({ awaitReviews: false, config: { operatorCount: 1, reviewMs: 60000, grid: 5, extentKm: 2, loadMs: 1000, unloadMs: 1000 } });
  t.after(() => h.close());
  const w = h.lab.world, app = h.apps[0];
  w.advance(60000); await app.ingestion.sync();
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const p = await app.domain.propose({ org: "org0", id: "test-agent", role: "agent" }, {
      title: "Deliver a bounded observed water requirement", summary: "150 L with its own vehicle", benefit: "Useful water",
      references: ["need-water-main"], conditions: [], rationale: "Received demand and exact scoped owner authorization",
      actions: [{ type: "dispatch", owner: "org0", params: { need: "need-water-main", resource: "r-org0-water", vehicle: "v-org0-" + i, quantity: 150, ttlMs: 900000 }, dependsOn: [] }],
    }, "source-queue-proposal-" + i);
    assert.equal(await scriptedReview(app, p), true); ids.push(p.id);
  }
  const queuedAt = w.now;
  for (const id of ids) {
    const result = await app.worker.execute(id);
    assert.equal(result.pendingReview, true); assert.equal(result.complete, false);
  }
  assert.equal(w.now, queuedAt, "enqueueing source reviews does not advance the clock to their completion");
  assert.equal(w.state.operations.filter(o => o.type === "delivery").length, 0);
  const sourcePlans = w.state.proposals.filter(p => p.reviewPending);
  assert.equal(sourcePlans.length, 2);
  const pendingJobs = (await app.store.query("SELECT * FROM jobs WHERE kind='continue_proposal' AND state='queued'")).rows;
  assert.equal(pendingJobs.length, 2);
  // New worker against the same durable store, while neither source owner has
  // finished reviewing: no resubmission or physical command is possible.
  const restarted = new Worker({ store: app.store, config: app.config, connector: app.connector, network: app.network });
  for (const id of ids) assert.equal((await restarted.execute(id)).pendingReview, true);
  assert.equal(w.state.proposals.length, 2);
  w.advance(queuedAt + 60000);
  for (const id of ids) await restarted.execute(id);
  assert.equal(w.state.operations.filter(o => o.type === "delivery").length, 1);
  w.advance(queuedAt + 120000);
  for (const id of ids) await restarted.execute(id);
  assert.equal(w.state.operations.filter(o => o.type === "delivery").length, 2);
  w.advance(3600000); await app.ingestion.sync({ sources: false });
  for (const id of ids) assert.equal((await restarted.execute(id)).complete, true);
  assert.equal(w.state.operations.filter(o => o.type === "delivery").length, 2);
  assert.equal(w.need("need-water-main").served, 300);
  assert.deepEqual(w.invariants(), []);
  assert.equal((await app.store.query("SELECT COUNT(*) AS n FROM usage")).rows[0].n, 0);
});

test("operational owner rejection or clarification never becomes an automatic physical approval", { timeout: 90000 }, async t => {
  for (const decision of ["reject", "clarify"]) {
    const h = await createHarness({ awaitReviews: false, config: { operatorCount: 1, reviewMs: 60000, grid: 5, extentKm: 2 } });
    t.after(() => h.close());
    const app = h.apps[0], w = h.lab.world;
    w.advance(60000); await app.ingestion.sync();
    const p = await app.domain.propose({ org: "org0", id: "test-agent", role: "agent" }, {
      title: "Observed water requirement", summary: "Await the owner's decision", benefit: "Useful water",
      references: ["need-water-main"], conditions: [], rationale: "Exact received scope",
      actions: [{ type: "dispatch", owner: "org0", params: { need: "need-water-main", resource: "r-org0-water", vehicle: "v-org0-0", quantity: 150, ttlMs: 900000 }, dependsOn: [] }],
    }, "source-review-negative-" + decision);
    assert.equal(await scriptedReview(app, p), true);
    const action = app.connector.action.bind(app.connector);
    app.connector.action = (type, params, ...rest) => action(type, type === "review" ? { ...params, decision } : params, ...rest);
    assert.equal((await app.worker.execute(p.id)).pendingReview, true);
    w.advance(w.now + 60000);
    assert.equal((await app.worker.execute(p.id)).requiresReview, true);
    const current = await app.store.get("org0", "proposal", p.id);
    assert.equal(current.authorization, null); assert.equal(current.state, "requires_review");
    assert.ok(["rejected", "needs_clarification"].includes(current.sourceReview.state));
    assert.equal(w.state.operations.filter(o => o.type === "delivery").length, 0);
    assert.equal((await app.worker.execute(p.id)).skipped, true);
    assert.equal(w.state.proposals.length, 1); assert.deepEqual(w.invariants(), []);
  }
});
