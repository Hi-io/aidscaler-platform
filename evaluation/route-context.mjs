import {
  createHarness,
  scriptedReview,
  buildFingerprint,
  evaluatorFingerprint,
} from "./harness.mjs";
import {
  checkFinalBuilds,
  requireLoadedSimulatorBuild,
} from "./simulator-build.mjs";
import { processSourceOpportunities } from "../src/source-opportunities.mjs";
import { conventionalSourceOpportunities } from "../src/conventional-opportunities.mjs";
import { hash } from "../src/store.mjs";
import { checkedRepairPlan } from "../src/response-repair.mjs";
import { selectOriginalSources } from "./conventional-source.mjs";

export function finiteSourceReviews(sources, receivedAt, readMs, workers = 2) {
  if (![receivedAt, readMs, workers].every(Number.isSafeInteger) || receivedAt < 0 || readMs < 0 || workers < 1 || workers > 32)
    throw Error("Invalid finite source attention policy");
  const slots = Array(workers).fill(receivedAt);
  return selectOriginalSources(sources).map(source => {
    const slot = slots.indexOf(Math.min(...slots)), startedAt = slots[slot];
    slots[slot] += readMs;
    return { source, slot, startedAt, availableAt: slots[slot] };
  });
}

export function sufficientOwnedReceipt(operation, { owner, id, quantity }) {
  return Boolean(operation && operation.id === id && (operation.owner ?? operation.org) === owner &&
    operation.confirmedBySource === true && ["received", "completed", "service"].includes(operation.state) &&
    operation.received >= quantity && Number.isFinite(operation.times?.service));
}

/** A source-information gap, not a hidden routing advantage. All controllers
 * get the same public corpus, received map, road checks, compiler, human owner
 * review and physical cargo. Only the evaluator schedules the actual reopening
 * and delayed official bulletin. No selected road ID is handed to the model.
 * B5: competent directory-driven inquiries with declared reading cost;
 * B8: the same strong broad entity detector without human/model latency;
 * B6: sourced semantic interpretation and normal typed inquiries;
 * B9: ordinary investigator, raw sources and the same verify/repair tools.
 * This bounded implementation is not a claim about all conventional planners.
 */
export async function routeContextEpisode({
  seed = "route-context-01",
  arm = "B6",
  provider,
  humanReadMs = 30000,
  humanWorkers = 2,
  budgetUsd = 0.15,
  maxCalls = 12,
  variant = "mixed_context",
} = {}) {
  if (!["B5", "B6", "B8", "B9"].includes(arm))
    throw Error("Unknown route-context arm");
  if (
    !["mixed_context", "false_reopening", "historical_only"].includes(variant)
  )
    throw Error("Unknown route-context variant");
  await requireLoadedSimulatorBuild();
  const fingerprint = await buildFingerprint(),
    evaluatorBuild = await evaluatorFingerprint(),
    started = performance.now();
  const episode = "route-context-" + arm + "-" + Date.now();
  let h;
  const timedProvider = provider && {
    ...provider,
    complete: async (input) => {
      const start = performance.now();
      try {
        return await provider.complete(input);
      } finally {
        if (h)
          h.lab.world.advance(
            Math.min(
              h.lab.world.config.durationMs,
              h.lab.world.now + Math.ceil(performance.now() - start),
            ),
          );
      }
    },
  };
  h = await createHarness({
    seed,
    scenario: "S23",
    organizations: 1,
    provider: timedProvider,
    budgetUsd,
    maxCalls,
    config: {
      healthReports: false,
      recurringNeeds: false,
      reviewMs: 1000,
      loadMs: 1000,
      unloadMs: 1000,
      inspectionMs: 60000,
      postsPerHour: 0,
      sourceIndexMs: 1000,
      authorshipMs: 1000,
      modelLatencyMs: 15000,
      clockLatency: "wall",
      observationRate: 1,
    },
    platformConfig: { modelScopePrefix: episode, modelScopeCalls: maxCalls },
    awaitVerifications: false,
    awaitReviews: false,
  });
  const app = h.apps[0],
    org = app.config.org,
    world = h.lab.world;
  // A synchronous tool wait still observes only the actor's received inquiry.
  // The evaluator advances the same finite source work; it never returns truth.
  app.investigator.wait = async (id, kind = "queries") => {
    const deadline = Math.min(world.config.durationMs, world.now + 1800000);
    while (world.now < deadline) {
      const state = await app.connector.state(), row = state[kind]?.find(r => r.id === id);
      if (row && ["ready", "completed", "inconclusive", "timeout", "failed", "cancelled"].includes(row.state)) return row;
      world.advance(Math.min(deadline, world.now + 10000));
    }
    return { id, state: "pending", note: "The actor has no received confirmation." };
  };
  // The source schedules its wall-clock model receipt at the current logical
  // instant. Drain that due event after HTTP delivery, before connector polling;
  // this adds no virtual delay or gold stopping criterion.
  const fetcher = app.connector.fetcher;
  app.connector.fetcher = async (url, options) => {
    const response = await fetcher(url, options);
    if (new URL(url).pathname === "/api/actor/model/finish" && response.ok)
      world.advance(world.now);
    return response;
  };
  let status = "completed",
    error = null,
    before = null,
    after = null,
    activity = null,
    corpusHash = null;
  try {
    // Static received labels are identical in all arms; they contain no open,
    // damaged or future information. An operational place can have several exits.
    const initialVehicle = world.vehicle("v-org0-0");
    const exits = world.state.map.edges.filter(
      (e) => e.from === initialVehicle.node,
    );
    const labels = [
      "Pine access road",
      "Quarry service road",
      "Reservoir lane",
      "Market bypass",
      "Hill approach",
      "Valley route",
    ];
    exits.forEach((e, i) => {
      e.name = labels[i % labels.length];
      e.aliases = ["sector approach " + (i + 1)];
    });
    world.advance(60000);
    for (const target of ["inventory", "vehicles", "map", "roads", "policy"])
      await app.connector.action(
        "query",
        { target },
        episode + "-initial-" + target,
      );
    await app.ingestion.sync();
    const need = await app.store.get(org, "need", "need-water-main");
    const original = await app.domain.propose(
      { org, id: "common-prelude", role: "agent" },
      {
        title: "Common reviewed water shipment",
        summary: "The same existing shipment in every arm",
        benefit: "300 L at the received need",
        rationale:
          "A source-confirmed need and owned capacity support this common reviewed prelude.",
        references: [need.id],
        conditions: [],
        actions: [
          {
            type: "dispatch",
            owner: org,
            params: {
              resource: "r-org0-water",
              vehicle: "v-org0-0",
              need: need.id,
              quantity: 300,
            },
            dependsOn: [],
          },
        ],
      },
      episode + "-prelude",
    );
    if (!(await scriptedReview(app, original)))
      throw Object.assign(Error("Common prelude rejected"), {
        code: "PRELUDE_REVIEW",
      });
    await app.worker.execute(original.id);
    // The scripted shipment is a common prelude, not model work. Progress its
    // finite owner review until the actor receives an issued operation before
    // injecting the access change. Never infer authorization from future gold.
    const preludeDeadline = world.now + 300000;
    while (!(await app.store.get(org, "proposal", original.id)).executionResults?.some(r => r.result?.id) && world.now < preludeDeadline) {
      world.advance(Math.min(preludeDeadline, world.now + 10000));
      await app.worker.execute(original.id);
    }
    const vehicle = world.vehicle("v-org0-0");
    for (const edge of exits) {
      edge.open = false;
      edge.version++;
    }
    world.record(
      "route_context_closure",
      { recipeVersion: 1, roads: exits.map((e) => e.id) },
      vehicle.id,
    );
    h.advanceUntil(() => vehicle.state === "blocked", 300000);
    // Vehicle contact reports the encountered closure. Other exits are then
    // reported as closed, so subsequent reopening is genuinely new information.
    for (const edge of exits) world.reportRoad(edge, org);
    world.advance(world.now + 10000);
    await app.ingestion.sync({ sources: false });
    await app.worker.execute(original.id);
    if (
      vehicle.state !== "blocked" ||
      vehicle.load !== 300 ||
      (await app.store.get(org, "proposal", original.id)).state !==
        "requires_review"
    )
      throw Object.assign(
        Error(
          "The common physical shipment was not blocked for reviewed repair",
        ),
        { code: "PRELUDE_BLOCK" },
      );
    const selected =
      exits[
        Math.floor(
          world.random("route-context", seed, "reopening") * exits.length,
        )
      ];
    const availableAt = world.now + 30000,
      formalAt = availableAt + 15 * 60000;
    world.on("route_context_reopen", () => {
      if (variant === "mixed_context") {
        selected.open = true;
        selected.version++;
      }
      world.record("route_context_transition", { variant }, selected.id);
      // Public mixed context: obsolete footage, a current field account,
      // assignment chatter, and uncertain alternative accesses remain separate.
      const texts =
        variant === "historical_only"
          ? [
              `Archive from last year: crews passed ${selected.name}. It says nothing about access today.`,
            ]
          : [
              `Yesterday's clip shows ${selected.name} blocked. That footage predates this morning's work.`,
              `Today the crew at ${selected.name} says the barrier was removed and vehicles can pass again. Their report still needs confirmation.`,
              ...exits
                .filter((e) => e.id !== selected.id)
                .map(
                  (e) =>
                    `Latest from ${e.name}: we are waiting for crews. No one can confirm whether vehicles can pass.`,
                ),
              `A forwarded photo from ${selected.name} has no date. Please check before directing trucks there.`,
            ];
      for (const [i, text] of texts.entries())
        world.generateSignal("P13", {
          text,
          type: i === 0 ? "photo" : i === 1 ? "audio" : "text",
          false: variant === "false_reopening" && i === 1,
          building: need.building,
          causeEvent: "route-context-public-" + i,
          compositionMs: 1000,
          mediaDescription:
            "A community access update; time and road conditions require a current check.",
        });
    });
    world.on("route_context_formal", () => {
      for (const edge of exits) world.reportRoad(edge, org);
    });
    world.schedule(
      availableAt,
      "route_context_reopen",
      {},
      2,
      "route-context-reopen",
    );
    world.schedule(
      formalAt,
      "route_context_formal",
      {},
      2,
      "route-context-formal",
    );
    world.advance(availableAt + 10000);
    // Audio uploads have the ordinary source bandwidth/serialization delay.
    world.advance(world.now + 30000);
    await app.ingestion.sync();
    const sources = (await app.store.list(org, "signal", 1000)).filter(
      (s) =>
        s.text.includes("road") ||
        s.text.includes("lane") ||
        s.text.includes("bypass") ||
        s.text.includes("approach") ||
        s.text.includes("route"),
    );
    corpusHash = hash(
      sources
        .map((s) => ({
          id: s.id,
          version: s.sourceVersion,
          text: s.text,
          publishedAt: s.publishedAt,
          attachments: s.attachments,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    before = {
      operationId: vehicle.operation,
      loaded: vehicle.load,
      stock: world.resource("r-org0-water").quantity,
      at: world.now,
      publicSourceIds: sources.map((s) => s.id),
      delivered: world.need(need.id).served,
      officialBulletinAt: formalAt,
    };
    if (!sources.length)
      throw Object.assign(Error("The public corpus was not received"), {
        code: "NO_RECEIVED_CORPUS",
      });
    const orderedSources = [...sources].sort((a,b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id)),
      attention = arm === "B5" ? finiteSourceReviews(orderedSources, before.at, humanReadMs, humanWorkers) : [],
      sourceWork = new Map(), ids = new Set();
    let lastReceivedSignature = null;
    const remember = result => {
      for (const id of [...(result?.proposalIds ?? []), ...(result?.proposalId ? [result.proposalId] : [])]) ids.add(id);
    };
    const checkSource = async (source) => {
      const key = episode + "-source-" + source.id;
      const observations = (await conventionalSourceOpportunities(app.store, org, [source])).filter(o => o.entity.kind === "road");
      const result = await processSourceOpportunities(app, key, { observations });
      sourceWork.set(source.id, { key, observations, result });
      remember(result);
    };
    if (arm === "B6") {
      activity = await app.discovery.run(
        { ids: sources.map((s) => s.id) },
        episode,
      );
      remember(activity);
    } else if (arm === "B9") {
      activity = await app.investigator.run(
        {
          ids: sources.map((s) => s.id),
          policy: "general",
          interpretSources: false,
          focusMode: "manual",
          repairOf: original.id,
        },
        episode,
      );
      remember(activity);
    } else if (arm === "B8") {
      for (const source of selectOriginalSources(orderedSources)) await checkSource(source);
      activity = { state: "waiting_evidence", calls: 0, proposalIds: [] };
    } else {
      activity = { state: "reading", calls: 0, proposalIds: [] };
    }
    const deadline = formalAt + 20 * 60000;
    let receivedOperation = null;
    for (let i = 0; i < 500 && world.now < deadline; i++) {
      await app.ingestion.sync({ sources: false });
      for (const job of attention.filter(j => !j.processed && j.availableAt <= world.now)) {
        await checkSource(job.source);
        job.processed = true;
        job.processedAt = world.now;
      }
      const known = await app.connector.state(), signature = hash([known.inspections, known.known.edges]);
      if (signature !== lastReceivedSignature) {
        if (arm === "B6" && activity.state === "waiting_evidence") {
          activity = await app.discovery.run({}, episode);
          remember(activity);
        }
        for (const work of sourceWork.values()) {
          if (!work.result.pending?.length) continue;
          work.result = await processSourceOpportunities(app, work.key, { observations: work.observations });
          remember(work.result);
        }
        lastReceivedSignature = signature;
        // The formal channel is useful for every arm too. This shared compiler
        // consumes received constraints, never the evaluator's selected exit.
        const prior = await app.store.get(org, "proposal", original.id);
        const activeRepair = (await app.store.list(org, "proposal", 1000)).find(p => p.repairOf === original.id &&
          ["awaiting_review", "authorized", "executing", "completed"].includes(p.state));
        if (activeRepair) ids.add(activeRepair.id);
        else if (prior.state === "requires_review") {
          const plan = await checkedRepairPlan(app.store, app.config, { proposalId: prior.id });
          if (plan.readyToDraft) {
            const p = await app.domain.propose({ org, id: "common-received-repair", role: "agent" }, {
              title: "Restore the received loaded delivery", summary: "Reroute the same owned cargo after current road confirmation",
              benefit: "Useful water without drawing stock again", rationale: "Only received owner road and operation evidence supports this shared deterministic repair.",
              actions: plan.actions, references: plan.references, conditions: [], alternatives: [],
            }, episode + "-received-repair-" + plan.planHash, { repairOf: original.id });
            ids.add(p.id);
          }
        }
      }
      for (const id of ids)
      {
        let p = await app.store.get(org, "proposal", id);
        if (p.state === "awaiting_review") {
          if (!(await scriptedReview(app, p))) throw Object.assign(Error("Repair owner review rejected current feasibility"), { code: "REPAIR_REVIEW" });
          p = await app.store.get(org, "proposal", id);
        }
        if (["authorized", "executing"].includes(p.state)) await app.worker.execute(id);
      }
      await app.ingestion.sync({ sources: false });
      receivedOperation = await app.store.get(org, "operation", before.operationId, false);
      if (sufficientOwnedReceipt(receivedOperation, { owner: org, id: before.operationId, quantity: before.loaded })) break;
      const nextRead = Math.min(Infinity, ...attention.filter(j => !j.processed).map(j => j.availableAt));
      world.advance(Math.min(deadline, world.now + 10000, nextRead > world.now ? nextRead : Infinity));
    }
    await app.ingestion.sync({ sources: false });
    receivedOperation = await app.store.get(org, "operation", before.operationId, false);
    const operation = world.state.operations.find(
      (o) => o.id === before.operationId,
    );
    after = {
      delivered: world.need(need.id).served,
      stock: world.resource("r-org0-water").quantity,
      loaded: vehicle.load,
      operationId: operation.id,
      operationState: operation.state,
      physicalTimes: operation.times,
      deliveryOperationCount: world.state.operations.filter(
        (o) => o.type === "delivery",
      ).length,
      repairProposalIds: [...ids],
      ownedReceipt: receivedOperation,
      receiptStopSatisfied: sufficientOwnedReceipt(receivedOperation, { owner: org, id: before.operationId, quantity: before.loaded }),
      attention: attention.map(({ source, ...job }) => ({ source: source.id, ...job })),
      sourceWork: [...sourceWork.values()].map(w => ({ key: w.key, state: w.result.state, opportunities: w.result.opportunities })),
      receiptAt: operation.times.received ?? null,
      beforeOfficialBulletin: (operation.times.received ?? Infinity) < formalAt,
      inspections: (await app.connector.state()).inspections
        .filter((i) => i.target === "road")
        .map((i) => ({
          id: i.id,
          entity: i.entity,
          state: i.state,
          requestedAt: i.requestedAt ?? i.createdAt,
          completedAt: i.completedAt,
        })),
      previousProposalState: (await app.store.get(org, "proposal", original.id))
        .state,
    };
    const verifications = await app.store.list(org, "verification", 2000);
    const semantic = await app.store.get(
      org,
      "semantic_receipt",
      episode + "-perception",
      false,
    );
    const sourceProposalIds = await Promise.all(
      [...ids].map(async (id) => (await app.store.get(org, "proposal", id)).simId),
    );
    after.funnel = {
      sources: sources.map((s) => ({
        id: s.id,
        version: s.sourceVersion,
        observedAt: s.claimedAt,
        publishedAt: s.publishedAt,
        receivedAtSourceClock: s.receivedAtSourceClock ?? null,
      })),
      interpretedAtSourceClock: semantic?.interpretedAtSourceClock ?? null,
      verifications: verifications
        .filter((v) => v.target === "road")
        .map((v) => ({
          id: v.id,
          entity: v.entity,
          state: v.state,
          requestedAt:
            v.sourceSnapshot?.requestedAt ??
            v.sourceSnapshot?.createdAt ??
            null,
          sourceCompletedAt: v.completedAt ?? null,
          receivedAtSourceClock: v.receivedAtSourceClock ?? null,
        })),
      physicalTimes: operation.times,
      ownerApprovals: world.state.proposals
        .filter((p) => sourceProposalIds.includes(p.id))
        .map((p) => ({
          id: p.id,
          state: p.state,
          reviewedAt: p.reviewedAt ?? null,
        })),
      note: "Receipt times come from delivered actor ingestion; pending request ACKs and source completion are distinct. Missing stages stay null.",
    };
    after.metrics = {
      resource: "water",
      unit: "L",
      required: 300,
      served: Math.min(300, after.delivered),
      complete: after.receiptStopSatisfied,
      censored: !after.receiptStopSatisfied,
      restrictedTimeToSufficientReceiptMs:
        Math.min(after.receiptStopSatisfied ? operation.times.service : deadline, deadline) - before.at,
      timeToSufficientReceiptMs:
        after.receiptStopSatisfied ? operation.times.service - before.at : null,
      responseStart:
        "Received identical public corpus after the shared reviewed shipment was physically blocked",
      cutoff: deadline,
      allCohortDenominator: 1,
    };
    if (
      after.deliveryOperationCount !== 1 ||
      after.operationId !== before.operationId ||
      after.stock !== before.stock
    )
      throw Object.assign(
        Error(
          "Context repair duplicated cargo, stock or the original operation",
        ),
        { code: "CARGO_PRESERVATION" },
      );
  } catch (e) {
    status = "failed";
    error = { code: e.code ?? e.name, message: e.message.slice(0, 300) };
  }
  const final = await checkFinalBuilds(
    {
      candidate: fingerprint,
      evaluator: evaluatorBuild,
      simulator: world.manifest.engineBuild,
    },
    { candidate: buildFingerprint, evaluator: evaluatorFingerprint },
  );
  if (final.invalidStatus) status = final.invalidStatus;
  const usage = (
    await app.store.query(
      "SELECT state,wall_ms,cost_usd,reserved_usd,error FROM usage",
    )
  ).rows;
  const result = {
    seed,
    arm,
    variant,
    status,
    error,
    before,
    after,
    activity,
    corpusHash,
    invariants: world.invariants(),
    usage,
    costUsd: usage.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
    chargedBudgetUsd: usage.reduce(
      (s, r) => s + Number(r.cost_usd ?? r.reserved_usd ?? 0),
      0,
    ),
    wallMs: performance.now() - started,
    candidateFingerprint: fingerprint,
    evaluatorFingerprint: evaluatorBuild,
    engineBuild: world.manifest.engineBuild,
    ...final,
    protocol: {
      fixtureRecipeVersion: 2,
      humanReadMs,
      humanWorkers,
      verificationScheduling: "All source checks use the same finite asynchronous channel; completed received inquiries resume without another interpretation.",
      pumpCadenceMs: 10000,
      controllerStop: "Source-confirmed sufficient receipt of the original owned physical operation, or fixed horizon; never observer need.served.",
      maxCalls,
      budgetUsd,
      observationRate: 1,
      clockLatency: "wall",
      formalBulletinDelayMs: 900000,
      comparison:
        "Same owned reviewed cargo, source corpus, map, verification channels, owner review, physical route engine and repair compiler",
      scope:
        "Internal deterministic source-information family; recorded fixtures validate integration, not model quality or superiority. This bounded single shipment is not a scale or source-recovery benchmark.",
    },
  };
  await h.close();
  return result;
}
