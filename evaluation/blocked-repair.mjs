import { createHarness, scriptedReview, buildFingerprint, evaluatorFingerprint } from "./harness.mjs";
import { evaluate } from "../../disaster-response-simulator/evaluation/metrics.mjs";
import { checkFinalBuilds, requireLoadedSimulatorBuild } from "./simulator-build.mjs";

/** Evaluator-only stages. A timestamp is observed service only when the exact
 * original source operation reports real received cargo; otherwise the same
 * fixed horizon right-censors the missing stage, including failed model runs. */
export function repairTiming({ changeAccessibleAt = null, alternativeAccessibleAt = null, repairStartAt = null,
  draftAt = null, authorizedAt = null, issuedAt = null, rerouteReceivedAt = null,
  horizonAt, operationId = null, owner = null, need = null, loaded = null, sourceOperation = null } = {}) {
  const finite = x => Number.isFinite(x) && x >= 0;
  if (!finite(horizonAt)) throw Error("Repair timing needs its finite fixed horizon.");
  const observed = x => finite(x) && x <= horizonAt ? x : null,
    start = observed(changeAccessibleAt),
    matching = sourceOperation?.id === operationId && (sourceOperation?.org ?? sourceOperation?.owner) === owner &&
      sourceOperation?.need === need && sourceOperation?.type === "delivery" && sourceOperation?.state === "completed",
    service = matching && Number(sourceOperation.received) > 0 && finite(sourceOperation.times?.service) &&
      start !== null && sourceOperation.times.service >= start ? observed(sourceOperation.times.service) : null,
    sufficient = service !== null && finite(loaded) && loaded > 0 && Number(sourceOperation.received) >= loaded ? service : null,
    validDraft = start !== null && observed(draftAt) !== null && draftAt >= start ? draftAt : null;
  return { changeAccessibleAt: start, alternativeAccessibleAt: observed(alternativeAccessibleAt), repairStartAt: observed(repairStartAt),
    draftAt: validDraft, authorizedAt: observed(authorizedAt), issuedAt: observed(issuedAt), rerouteReceivedAt: observed(rerouteReceivedAt),
    originalOperationId: operationId, originalOperationReceived: matching && finite(sourceOperation.received) ? sourceOperation.received : null,
    originalOperationServiceAt: service, originalCargoRecoveredAt: sufficient, horizonAt,
    draftRightCensored: validDraft === null, serviceRightCensored: service === null, sufficientRightCensored: sufficient === null,
    draftObservedMs: start === null ? null : (validDraft ?? horizonAt) - start,
    firstUsefulServiceObservedMs: start === null ? null : (service ?? horizonAt) - start,
    sufficientServiceObservedMs: start === null ? null : (sufficient ?? horizonAt) - start,
    observationClock: "Change accessibility is actual platform receipt. Service is the exact original physical source operation, never arrival or a proposal. Missing stages remain censored." };
}

/** An evaluator-only disruption. The candidate sees HTTP reports, not the
 * selected road IDs or physical state. The same owned, reviewed prelude is
 * used in both repair treatments; its service is not credited to the model. */
export async function blockedRepairEpisode({ seed = "blocked-transfer-01", provider, strategy = "selective", budgetUsd = .15 } = {}) {
  if (!["selective", "full_refresh"].includes(strategy)) throw Error("Unknown repair treatment");
  await requireLoadedSimulatorBuild();
  const started = performance.now(), fingerprint = await buildFingerprint(), evaluatorBuild = await evaluatorFingerprint(),
    episode = "blocked-repair-" + Date.now() + "-" + strategy,
    h = await createHarness({ seed, scenario: "S23", organizations: 1, provider, budgetUsd, maxCalls: 8,
      config: { healthReports: false, recurringNeeds: false, reviewMs: 1000, loadMs: 1000, unloadMs: 1000, modelLatencyMs: 15000 },
      platformConfig: { modelScopePrefix: episode, modelScopeCalls: 8 } });
  const app = h.apps[0], org = app.config.org;
  let status = "completed", error = null, activity = null, before = null, after = null, proposal = null,
    changeAccessibleAt = null, alternativeAccessibleAt = null, repairStartAt = null, draftAt = null, authorizedAt = null, issuedAt = null;
  try {
    h.lab.world.advance(60000);
    for (const target of ["inventory", "vehicles", "map", "roads", "policy"]) await app.connector.action("query", { target }, episode + "-initial-" + target);
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
    changeAccessibleAt = h.lab.world.now;
    // Reopen one real outgoing road after a finite modeled interval. This is a
    // field observation, not an instruction specifying the replacement plan.
    h.lab.world.advance(h.lab.world.now + 30000);
    exits.at(-1).open = true; exits.at(-1).version++;
    for (const edge of exits) h.lab.world.reportRoad(edge, org);
    h.lab.world.advance(h.lab.world.now + 10000);
    await app.ingestion.sync({ sources: false });
    alternativeAccessibleAt = h.lab.world.now;
    before = { loaded: vehicle.load, stock: h.lab.world.resource("r-org0-water").quantity,
      needId: need.id, vehicleId: vehicle.id, owner: org,
      operationId: vehicle.operation, operationState: h.lab.world.state.operations.find(o => o.id === vehicle.operation)?.state,
      delivered: h.lab.world.need(need.id).served, sourceReports: (await app.store.list(org, "road")).length };
    const repairStart = performance.now(), simulatedStart = h.lab.world.now, refreshTargets = strategy === "full_refresh" ? ["inventory", "vehicles", "roads", "map"] : [];
    repairStartAt = simulatedStart;
    for (const target of refreshTargets) await app.connector.action("query", { target }, episode + "-refresh-" + target);
    if (refreshTargets.length) await app.ingestion.sync({ sources: false });
    activity = await app.investigator.run({ repairOf: old.id }, episode);
    const repairDelay = { draftWallMs: performance.now() - repairStart, draftModeledMs: h.lab.world.now - simulatedStart, refreshTargets };
    if (!activity.proposalId) throw Object.assign(Error("The investigator did not produce a repair"), { code: "NO_REPAIR_DRAFT" });
    draftAt = h.lab.world.now;
    proposal = await app.store.get(org, "proposal", activity.proposalId);
    if (!await scriptedReview(app, proposal)) throw Object.assign(Error("The repair was rejected by current feasibility"), { code: "REPAIR_REVIEW" });
    authorizedAt = h.lab.world.now;
    await app.worker.execute(proposal.id);
    issuedAt = h.lab.world.now;
    for (let i = 0; i < 120; i++) {
      const receivedProposal = await app.store.get(org, "proposal", proposal.id),
        receivedOperation = await app.store.get(org, "operation", before.operationId, false);
      if (receivedProposal.state === "completed" && receivedOperation?.confirmedBySource === true &&
        receivedOperation.state === "completed" && Number(receivedOperation.received) >= before.loaded &&
        Number.isFinite(receivedOperation.times?.service)) break;
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
  const sourceOperation = h.lab.world.state.operations.find(o => o.id === before?.operationId),
    rerouteEvent = h.lab.world.log.find(e => e.type === "reroute_received" && e.entity === before?.vehicleId &&
      e.data?.accepted === true && Number.isFinite(changeAccessibleAt) && e.at >= changeAccessibleAt),
    timing = repairTiming({ changeAccessibleAt, alternativeAccessibleAt, repairStartAt, draftAt, authorizedAt, issuedAt,
      rerouteReceivedAt: rerouteEvent?.at ?? null, horizonAt: h.lab.world.now, operationId: before?.operationId ?? null,
      owner: org, need: before?.needId ?? null, loaded: before?.loaded ?? null, sourceOperation }),
    funnel = { disruptionReceived: changeAccessibleAt !== null, alternativeReceived: alternativeAccessibleAt !== null,
      repairStarted: repairStartAt !== null, draft: draftAt !== null, authorized: authorizedAt !== null,
      commandIssued: issuedAt !== null, rerouteReceived: timing.rerouteReceivedAt !== null,
      firstUsefulService: !timing.serviceRightCensored, originalCargoRecovered: !timing.sufficientRightCensored,
      physicalReceipt: sourceOperation ? { id: sourceOperation.id, owner: sourceOperation.org ?? sourceOperation.owner,
        need: sourceOperation.need, state: sourceOperation.state, received: sourceOperation.received ?? null, times: sourceOperation.times } : null };
  const finalBuilds = await checkFinalBuilds({ candidate: fingerprint, evaluator: evaluatorBuild, simulator: h.lab.world.manifest.engineBuild }, { candidate: buildFingerprint, evaluator: evaluatorFingerprint });
  if (finalBuilds.invalidStatus) status = finalBuilds.invalidStatus;
  const usage = (await app.store.query("SELECT episode,model,state,wall_ms,input_tokens,output_tokens,cost_usd,reserved_usd,error FROM usage")).rows,
    report = { episode, seed, strategy, status, error, errors: finalBuilds.errors, candidateFingerprint: fingerprint,
      candidateChanged: finalBuilds.candidateChanged, evaluatorChanged: finalBuilds.evaluatorChanged, simulatorChanged: finalBuilds.simulatorChanged,
      finalCandidateFingerprint: finalBuilds.finalCandidateFingerprint, finalEvaluatorFingerprint: finalBuilds.finalEvaluatorFingerprint, finalEngineBuild: finalBuilds.finalEngineBuild,
      evaluatorFingerprint: evaluatorBuild, episodeBudgetUsd: budgetUsd, measurementMode: "modeled", responseOrder: "common reviewed prelude; preserve existing cargo",
      wallMs: performance.now() - started, manifest: h.lab.world.manifest, before, after, activity, proposal, timing, funnel,
      metrics: evaluate(h.lab.world), invariants: h.lab.world.invariants(), usage, costUsd: usage.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
      chargedBudgetUsd: usage.reduce((s, r) => s + Number(r.cost_usd ?? r.reserved_usd ?? 0), 0),
      scope: "Internal actual physical perturbation and repair. Shared scripted prelude is not autonomous model discovery; no independent professional or field claim." };
  await h.close(); return report;
}
