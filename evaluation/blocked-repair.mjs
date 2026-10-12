import { createHarness, scriptedReview, buildFingerprint, evaluatorFingerprint } from "./harness.mjs";
import { evaluate } from "../../disaster-response-simulator/evaluation/metrics.mjs";

/** An evaluator-only disruption. The candidate sees HTTP reports, not the
 * selected road IDs or physical state. The same owned, reviewed prelude is
 * used in both repair treatments; its service is not credited to the model. */
export async function blockedRepairEpisode({ seed = "blocked-transfer-01", provider, strategy = "selective", budgetUsd = .15 } = {}) {
  if (!["selective", "full_refresh"].includes(strategy)) throw Error("Unknown repair treatment");
  const started = performance.now(), fingerprint = await buildFingerprint(), evaluatorBuild = await evaluatorFingerprint(),
    episode = "blocked-repair-" + Date.now() + "-" + strategy,
    h = await createHarness({ seed, scenario: "S23", organizations: 1, provider, budgetUsd, maxCalls: 8,
      config: { healthReports: false, recurringNeeds: false, reviewMs: 1000, loadMs: 1000, unloadMs: 1000, modelLatencyMs: 15000 },
      platformConfig: { modelScopePrefix: episode, modelScopeCalls: 8 } });
  const app = h.apps[0], org = app.config.org;
  let status = "completed", error = null, activity = null, before = null, after = null, proposal = null;
  try {
    h.lab.world.advance(60000);
    for (const target of ["inventory", "vehicles", "map", "roads"]) await app.connector.action("query", { target }, episode + "-initial-" + target);
    await app.ingestion.sync();
    const need = (await app.store.list(org, "need")).find(n => n.id === "need-water-main");
    const old = await app.domain.propose({ org, id: "prelude-planner", role: "agent" }, {
      title: "Reviewed prelude: 300 L water delivery", summary: "Common initial physical work, not a model result.", benefit: "300 L at the received need",
      references: [need.id], rationale: "Same bounded prelude in both repair treatments.", conditions: [],
      actions: [{ type: "dispatch", owner: org, params: { resource: "r-org0-water", vehicle: "v-org0-0", need: need.id, quantity: 300 }, dependsOn: [] }],
    }, episode + "-prelude");
    if (!await scriptedReview(app, old)) throw Object.assign(Error("Prelude was not approvable"), { code: "PRELUDE_REVIEW" });
    await app.worker.execute(old.id);
    const vehicle = h.lab.world.vehicle("v-org0-0"),
      exits = h.lab.world.state.map.edges.filter(e => e.from === vehicle.node);
    for (const edge of exits) { edge.open = false; edge.version++; }
    h.advanceUntil(() => vehicle.state === "blocked", 300000);
    if (vehicle.state !== "blocked" || vehicle.load !== 300) throw Object.assign(Error("Disruption did not block the loaded vehicle"), { code: "PRELUDE_BLOCK" });
    h.lab.world.advance(h.lab.world.now + 10000);
    await app.ingestion.sync({ sources: false });
    await app.worker.execute(old.id);
    const stale = await app.store.get(org, "proposal", old.id);
    if (stale.state !== "requires_review") throw Object.assign(Error("The blocked receipt did not trigger repair review"), { code: "BLOCK_NOT_REVIEWED" });
    // Reopen one real outgoing road after a finite modeled interval. This is a
    // field observation, not an instruction specifying the replacement plan.
    h.lab.world.advance(h.lab.world.now + 30000);
    exits.at(-1).open = true; exits.at(-1).version++;
    for (const edge of exits) h.lab.world.reportRoad(edge, org);
    h.lab.world.advance(h.lab.world.now + 10000);
    await app.ingestion.sync({ sources: false });
    before = { loaded: vehicle.load, stock: h.lab.world.resource("r-org0-water").quantity,
      operationId: vehicle.operation, operationState: h.lab.world.state.operations.find(o => o.id === vehicle.operation)?.state,
      delivered: h.lab.world.need(need.id).served, sourceReports: (await app.store.list(org, "road")).length };
    const repairStart = performance.now(), simulatedStart = h.lab.world.now, refreshTargets = strategy === "full_refresh" ? ["inventory", "vehicles", "roads", "map"] : [];
    for (const target of refreshTargets) await app.connector.action("query", { target }, episode + "-refresh-" + target);
    if (refreshTargets.length) await app.ingestion.sync({ sources: false });
    activity = await app.investigator.run({ repairOf: old.id }, episode);
    const repairDelay = { draftWallMs: performance.now() - repairStart, draftModeledMs: h.lab.world.now - simulatedStart, refreshTargets };
    if (!activity.proposalId) throw Object.assign(Error("The investigator did not produce a repair"), { code: "NO_REPAIR_DRAFT" });
    proposal = await app.store.get(org, "proposal", activity.proposalId);
    if (!await scriptedReview(app, proposal)) throw Object.assign(Error("The repair was rejected by current feasibility"), { code: "REPAIR_REVIEW" });
    await app.worker.execute(proposal.id);
    for (let i = 0; i < 120 && h.lab.world.need(need.id).served < 300; i++) {
      h.lab.world.advance(Math.min(h.lab.world.config.durationMs, h.lab.world.now + 30000));
      await app.ingestion.sync({ sources: false });
      const current = await app.store.get(org, "proposal", proposal.id);
      if (["authorized", "executing"].includes(current.state)) await app.worker.execute(proposal.id);
    }
    await app.ingestion.sync({ sources: false });
    const final = await app.store.get(org, "proposal", proposal.id), physical = h.lab.world.state.operations.find(o => o.id === before.operationId);
    after = { ...repairDelay, delivered: h.lab.world.need(need.id).served, loaded: vehicle.load,
      stock: h.lab.world.resource("r-org0-water").quantity, operationId: physical.id, operationState: physical.state,
      deliveryOperationCount: h.lab.world.state.operations.filter(o => o.type === "delivery").length,
      rerouteReceived: h.lab.world.log.some(e => e.type === "reroute_received"), proposalState: final.state,
      inheritedWork: proposal.inheritedWork, repairOf: proposal.repairOf, previousProposalState: (await app.store.get(org, "proposal", old.id)).state };
    if (after.delivered !== 300 || after.deliveryOperationCount !== 1 || after.operationId !== before.operationId || after.proposalState !== "completed")
      throw Object.assign(Error("Repair did not preserve and complete the original physical delivery"), { code: "REPAIR_OUTCOME" });
  } catch (e) { status = "failed"; error = { code: e.code ?? e.name, message: e.message.slice(0, 250) }; }
  h.lab.world.advance(h.lab.world.config.durationMs, { maxEvents: 1000000 });
  const usage = (await app.store.query("SELECT episode,model,state,wall_ms,input_tokens,output_tokens,cost_usd,reserved_usd,error FROM usage")).rows,
    report = { episode, seed, strategy, status, error, candidateFingerprint: fingerprint, candidateChanged: fingerprint !== await buildFingerprint(),
      evaluatorFingerprint: evaluatorBuild, episodeBudgetUsd: budgetUsd, measurementMode: "modeled", responseOrder: "common reviewed prelude; preserve existing cargo",
      wallMs: performance.now() - started, manifest: h.lab.world.manifest, before, after, activity, proposal,
      metrics: evaluate(h.lab.world), invariants: h.lab.world.invariants(), usage, costUsd: usage.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
      chargedBudgetUsd: usage.reduce((s, r) => s + Number(r.cost_usd ?? r.reserved_usd ?? 0), 0),
      scope: "Internal actual physical perturbation and repair. Shared scripted prelude is not autonomous model discovery; no independent professional or field claim." };
  await h.close(); return report;
}
