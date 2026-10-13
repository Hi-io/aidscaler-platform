import test from "node:test";
import assert from "node:assert/strict";
import { createHarness, ruleProposal, scriptedReview } from "../evaluation/harness.mjs";

test("a directory-only coverage sweep discovers silent S07 demand and an independently approved delivery serves it", { timeout: 120000 }, async t => {
  const h = await createHarness({ scenario: "S07", seed: "coverage-silent-physical", awaitVerifications: false,
    config: { grid: 3, extentKm: 1, observationRate: 1, clarificationWorkers: 1, inspectionMs: 60000,
      networkLatencyMs: 1000, queryLatencyMs: 1000, reviewMs: 1000, loadMs: 1000, unloadMs: 1000 },
    provider: { complete: async () => { throw Error("No model may be used by a contact check"); } } });
  t.after(() => h.close());
  const app = h.apps[0], org = app.config.org, owner = (await app.store.query(
    "SELECT id,org,role FROM users WHERE org=$1 AND role='commander'", [org])).rows[0];
  for (const target of ["map", "inventory", "vehicles", "policy"])
    await app.connector.action("query", { target }, "coverage-bootstrap-" + target);
  await app.ingestion.sync({ sources: false });
  let d = await app.coverage.summary();
  const targets = d.directory.map(p => p.id).sort();
  assert.ok(targets.length <= 20, "The fixture must remain within an explicitly bounded public-directory sweep");
  assert.equal((await app.store.list(org, "need")).some(n => n.id.startsWith("need-case")), false);
  const policy = await app.coverage.configure(owner, { version: 0, placeIds: targets, staleAfterMs: 3600000,
    maxActive: 2, maxPerBatch: 5, maxWaitMs: 1800000, cooldownMs: 60000,
    allowedMethods: ["clarification"], reason: "Contact every received directory place; no hidden need selects the target" }, "coverage-physical-policy");
  for (let offset = 0; offset < targets.length; offset += 5) {
    d = await app.coverage.summary();
    await app.coverage.request(owner, { policyVersion: policy.version, coverageVersion: d.version,
      checks: targets.slice(offset, offset + 5).map(building => ({ building, method: "clarification" })) }, "coverage-physical-batch-" + offset);
  }
  for (let turn = 0; turn < 30; turn++) {
    await app.coverage.sync();
    const requests = (await app.coverage.summary()).requests;
    if (requests.every(r => r.state === "completed")) break;
    h.lab.world.advance(h.lab.world.now + 60000); await app.ingestion.sync({ sources: false });
  }
  d = await app.coverage.summary();
  assert.equal(d.requests.every(r => r.state === "completed"), true, JSON.stringify(d.requests));
  const silent = (await app.store.list(org, "need")).find(n => n.id.startsWith("need-case"));
  assert.ok(silent, "Only a real received need observation may expose the previously silent request");
  assert.equal(silent.quantity, 200); assert.equal(silent.served, 0);
  const draft = await ruleProposal(app, "coverage-silent-draft", { needs: [silent], references: new Map() });
  assert.equal(draft.state, "ready");
  assert.equal(h.lab.world.state.operations.some(o => o.type === "delivery"), false, "Discovery and drafting must not dispatch aid");
  const proposal = await app.store.get(org, "proposal", draft.proposalId);
  assert.equal(await scriptedReview(app, proposal), true);
  for (let turn = 0; turn < 30; turn++) {
    await app.worker.execute(proposal.id); h.lab.world.advance(h.lab.world.now + 60000); await app.ingestion.sync({ sources: false });
    if (h.lab.world.need(silent.id).served >= 200) break;
  }
  assert.equal(h.lab.world.need(silent.id).served, 200, "Scorer checks physical service only after controller used received observations");
  assert.equal(h.lab.world.state.inspections.length, targets.length, "Each approved contact has one source inquiry");
  assert.equal(h.lab.world.state.inspections.every(i => i.org === org), true);
  assert.equal(h.lab.world.invariants().length, 0);
});
