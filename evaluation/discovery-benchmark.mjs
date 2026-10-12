import {
  createHarness,
  scriptedReview,
  buildFingerprint,
  evaluatorFingerprint,
} from "./harness.mjs";
import { checkFinalBuilds, requireLoadedSimulatorBuild } from "./simulator-build.mjs";
import { installResponseBenchmark } from "../../disaster-response-simulator/generators/response-benchmark.mjs";
import { evaluate } from "../../disaster-response-simulator/evaluation/metrics.mjs";
import {
  selectOriginalSources,
  parseExplicitCurrentRequest,
  conventionalInterpret,
  keywordCandidates,
} from "./conventional-source.mjs";
import { draftReceivedResponse } from "../src/discovery-response.mjs";
import { configureResponsePolicy } from "../src/response-policy.mjs";
import { hash } from "../src/store.mjs";
import { percentile, pairedBootstrap } from "../src/evaluation.mjs";
import { ModelBudgetPool } from "../src/budget-pool.mjs";
import { receivedProgressReference, routinePublicCommentary } from "../src/source-relevance.mjs";
import {
  capturePhysicalDepartures,
  operationTrace,
} from "./physical-trace.mjs";

export const DISCOVERY_PROTOCOL = {
  version: "public-discovery-physical-response-v2",
  hypothesis:
    "Earlier interpretation of public information can reduce time until useful physical aid, compared with competent finite conventional review.",
  fairness:
    "Same raw public bytes, metadata, directory, formal-report delay, consented stock, fleet, field checks, dispatch reviews and physical world. Neither controller receives evaluator gold. Explicit structured requests and repost grouping are free in all arms.",
  references: {
    B5: "Conventional shared planner with free structured parsing plus finite human source review",
    B6: "Real configured model perception, targeted confirmations and deterministic batching",
    B8: "Stronger free broad keyword/location discovery, then the same targeted confirmations and batching",
    B9: "Same configured model as a general tool-using disaster-response investigator: raw source batches, no specialized semantic preprocessor, same operational tools and reviewed physical response",
    B0: "Extraction disconnected: formal observations only, same competent allocator",
  },
  clocks:
    "World travel/communication/review delays are modeled. Model availability is charged at max(declared latency, actual measured provider time). Human attention duration/workers are sensitivity parameters, not measured field productivity. SQL/HTTP wall overhead is separately reported, not sped up with the simulation clock.",
  negatives:
    "Zero human-reading delay, immediate formal reports, failures, unserved needs and no advantage against a stronger keyword baseline must remain visible.",
  verification:
    "Requests return a pending receipt. The same finite field queue progresses while owners review and trucks move; no controller must wait synchronously for all inquiries before acting on an already received need.",
  generalAgentScope:
    "B9 is this explicit finite general-agent reference implementation, not all possible agents. It receives the same public sources, free structured parsing, approved policy, deterministic planner, owners, model configuration and total call/cost cap. The general agent chooses its own queries and drafts; no observer facts or specialized perception receipt are supplied.",
};

export async function runDiscoveryEpisode({
  arm = "B6",
  seed = "discovery-01",
  count = 12,
  noise = 48,
  reposts = 2,
  humanReadMs = 60000,
  humanWorkers = 2,
  clarificationWorkers = 1,
  formalDelayMs = 1800000,
  silentFraction = 0,
  extentKm = 6,
  grid = 9,
  horizonMs = 10800000,
  traffic = 0,
  packetLoss = 0,
  budgetUsd = 0.15,
  maxModelCalls = 16,
  provider,
  candidateFingerprint,
  evaluatorBuild,
  onProgress = () => {},
  shouldStop = () => false,
} = {}) {
  if (
    !["B5", "B6", "B8", "B0", "B9"].includes(arm) ||
    !Number.isSafeInteger(humanReadMs) ||
    humanReadMs < 0 ||
    humanReadMs > 600000 ||
    !Number.isSafeInteger(humanWorkers) ||
    humanWorkers < 1 ||
    humanWorkers > 32
  )
    throw Error("Invalid finite discovery protocol");
  candidateFingerprint ??= await buildFingerprint();
  evaluatorBuild ??= await evaluatorFingerprint();
  await requireLoadedSimulatorBuild();
  const episode = "discovery-" + arm + "-" + seed + "-" + Date.now();
  const start = performance.now(),
    h = await createHarness({
      scenario: "S23",
      seed,
      organizations: 4,
      config: {
        grid,
        extentKm,
        durationMs: horizonMs,
        healthReports: false,
        recurringNeeds: false,
        postsPerHour: 0,
        observationRate: 1,
        sourceIndexMs: 0,
        clarificationWorkers,
        backgroundTraffic: traffic,
        packetLoss,
        toolQuota: 10000,
        sourceRequestLimit: 1000000,
      },
      budgetUsd,
      provider,
      maxCalls: 8,
      platformConfig: {
        modelScopePrefix: episode,
        modelScopeCalls: maxModelCalls,
        hourlyCallLimit: maxModelCalls,
        hourlyBudgetUsd: budgetUsd,
        modelBudgetPool: new ModelBudgetPool({
          budgetUsd,
          calls: maxModelCalls,
        }),
      },
      awaitVerifications: false,
    });
  const w = h.lab.world,
    physicalDepartures = capturePhysicalDepartures(w),
    app = h.apps[0],
    corpus = installResponseBenchmark(w, {
      count,
      noise,
      reposts,
      formalDelayMs,
      silentFraction,
    });
  const activities = [],
    errors = [],
    attention = [],
    checked = new Set(),
    seenSources = new Set(),
    workers = Array(humanWorkers).fill(0);
  let status = "completed",
    planningTurns = 0,
    semanticBatches = 0,
    generalAgentBatches = 0,
    readCosts = 0,
    reconciledProgressSources = 0,
    routineCommentarySources = 0;
  // Provider wall time is retained AND charged to the world: no optimistic
  // fifteen-second assumption when this real call took longer to finish.
  const originalFinish = app.connector.finishModel.bind(app.connector);
  app.connector.finishModel = async (id, usage) => {
    const row = await originalFinish(id, usage);
    const actualAt = Math.ceil(
      row.requestedAt + Math.max(w.config.modelLatencyMs, usage?.wallMs ?? 0),
    );
    w.advance(Math.min(horizonMs, Math.max(w.now, actualAt)), {
      maxEvents: 1000000,
    });
    w.record("benchmark_model_wall_charged", {
      id,
      measuredWallMs: usage?.wallMs ?? 0,
      worldAvailableAt: w.now,
    });
    return row;
  };
  async function actOnObservedDraft(result) {
    if (!result.proposalId) return;
    const p = await app.store.get("org0", "proposal", result.proposalId);
    if (p.state === "awaiting_review" && (await scriptedReview(app, p)))
      await app.worker.execute(p.id);
  }
  async function propagate() {
    // Receipts, consent and independent owner reviews pass through actual HTTP.
    // All controllers receive exactly this execution loop, without a fixed
    // three-round cutoff when vehicles are later available again.
    for (const owner of h.apps) {
      await owner.ingestion.sync({ sources: false });
      for (const row of await owner.store.list(
        owner.config.org,
        "proposal",
        2000,
      )) {
        if (
          (row.originPartner || owner === app) &&
          row.state === "awaiting_review"
        )
          await scriptedReview(owner, row);
        const current = await owner.store.get(
          owner.config.org,
          "proposal",
          row.id,
        );
        if (
          ["authorized", "executing", "awaiting_partner"].includes(
            current.state,
          )
        ) {
          try {
            await owner.worker.execute(current.id);
          } catch (e) {
            errors.push({
              at: w.now,
              phase: "execute",
              org: owner.config.org,
              code: e.code ?? e.name,
            });
          }
        }
      }
      await owner.network.refresh();
      // Don't run model jobs on partners: investigation is explicitly assigned
      // to this coordinator, while every owner retains its own authority.
      await owner.worker.drain(32);
    }
  }
  async function confirmLocations(observations) {
    for (const o of observations) {
      if (
        o.kind !== "need" ||
        !o.location ||
        o.timeStatus === "historical" ||
        checked.has(o.location)
      )
        continue;
      checked.add(o.location);
      const at = w.now;
      const q = await app.connector.action(
        "verify",
        { target: "building", id: o.location, method: "clarification" },
        episode + "-check-" + o.location,
      );
      activities.push({
        stage: "source-directed-confirmation",
        location: o.location,
        references: o.sourceIds,
        requestedAt: at,
        observedAt: w.now,
        inspection: q.id,
      });
    }
    await app.ingestion.sync({ sources: false });
  }
  try {
    // All sources arrive through ordinary HTTP ingestion; gold stays below in
    // the scorer. Startup reads are identical in every arm.
    w.advance(60000);
    for (const owner of h.apps) {
      for (const target of ["map", "inventory", "vehicles", "policy"])
        await owner.connector.action(
          "query",
          { target },
          episode + "-" + owner.config.org + "-" + target,
        );
      await owner.ingestion.sync();
      const actor = (
        await owner.store.query(
          "SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",
          [owner.config.org],
        )
      ).rows[0];
      await configureResponsePolicy(
        owner.store,
        actor,
        {
          version: 0,
          order: "deadline_then_priority",
          maxOpenReviews: 8,
          investigationCooldownMs: 60000,
          reason:
            "Identical finite owner policy for the declared discovery comparison",
        },
        episode + "-policy-" + owner.config.org,
      );
      if (owner !== app) {
        for (const kind of ["resource", "vehicle"])
          for (const r of (
            await owner.store.list(owner.config.org, kind, 2000)
          ).filter((r) => r.owner === owner.config.org))
            await owner.network.share(
              actor,
              { kind, id: r.id, version: r.version, to: "org0" },
              episode + "-share-" + r.id,
            );
        await owner.worker.drain();
      }
    }
    const places = (await app.store.get("org0", "context", "geography")).map
      .places;
    const pendingSources = [];
    let lastSourcePoll = -Infinity;
    async function receiveSourceBatch() {
      await app.ingestion.sync();
      const receivedAt = w.now;
      const originals = selectOriginalSources(
        await app.store.list("org0", "signal", 10000),
      )
        .sort(
          (a, b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id),
        )
        .filter(
          (s) =>
            !seenSources.has(s.id + ":" + (s.sourceVersion ?? s.version ?? 1)),
        );
      const explicitRequests = [],
        keywordRequests = [];
      const operations = await app.store.list('org0', 'operation', 10000);
      for (const source of originals) {
        seenSources.add(
          source.id + ":" + (source.sourceVersion ?? source.version ?? 1),
        );
        if (arm === "B0") continue;
        // The same narrow zero-model progress reconciliation is available to
        // conventional and keyword references. It never suppresses unknown
        // reports, contradictions or additional requests.
        const progress = receivedProgressReference(source, operations);
        if (progress) {
          reconciledProgressSources++;
          activities.push({ stage: 'received-progress-reconciliation', source: source.id, at: receivedAt, ...progress });
          continue;
        }
        const commentary = routinePublicCommentary(source);
        if (commentary) {
          routineCommentarySources++;
          activities.push({stage:'routine-commentary-retained',source:source.id,at:receivedAt,...commentary});
          continue;
        }
        const explicit = parseExplicitCurrentRequest(source, places);
        if (explicit) explicitRequests.push(explicit);
        else if (!/^ARCHIVE\b/i.test(source.text)) {
          pendingSources.push(source);
          if (arm === "B5") {
            const worker = workers.indexOf(Math.min(...workers));
            const at = Math.max(receivedAt, workers[worker]) + humanReadMs;
            workers[worker] = at;
            readCosts += humanReadMs;
            attention.push({ at, worker, source, completed: false });
          } else if (arm === "B8")
            keywordRequests.push(...keywordCandidates(source, places));
        }
      }
      // Human reading is scheduled at HTTP receipt, BEFORE field confirmations
      // for explicit requests. Its finite worker queue progresses in parallel
      // with inquiries, transport and owner review, rather than penalizing B5
      // by making it start only after every other task has finished.
      await confirmLocations(explicitRequests);
      if (arm === "B8") await confirmLocations(keywordRequests);
      lastSourcePoll = receivedAt;
    }
    await receiveSourceBatch();
    let batchOffset = 0;
    while (w.now < horizonMs) {
      if (shouldStop()) {
        status = "aborted";
        errors.push({
          phase: "episode",
          at: w.now,
          code: "CAMPAIGN_INTERRUPTED",
        });
        break;
      }
      if (planningTurns % 10 === 0)
        onProgress({
          arm,
          seed,
          worldMinutes: w.now / 60000,
          planningTurns,
          semanticBatches,
          generalAgentBatches,
          receivedOriginals: seenSources.size,
        });
      if (w.now - lastSourcePoll >= 60000) await receiveSourceBatch();
      await propagate();
      // Review can yield useful partial aid even while other sources await
      // interpretation. Physical trips continue during human/model processing.
      await actOnObservedDraft(
        await draftReceivedResponse(app, episode + "-turn-" + planningTurns++),
      );
      if (["B6", "B9"].includes(arm) && batchOffset < pendingSources.length) {
        const batch = pendingSources.slice(batchOffset, batchOffset + 30);
        const at = w.now;
        const stage = arm === "B9" ? "general-agent-discovery" : "model-discovery";
        let result;
        try {
          result = arm === "B9"
            ? await app.investigator.run({ ids: batch.map(s => s.id), policy: "general", interpretSources: false, focusMode: "manual" }, episode + "-general-batch-" + generalAgentBatches++)
            : await app.discovery.run(
                { ids: batch.map((s) => s.id) },
                episode + "-batch-" + semanticBatches++,
              );
        } catch (error) {
          errors.push({
            phase: stage,
            at: w.now,
            code: error.code ?? error.name,
            sourceCount: batch.length,
          });
          result = {
            state: "failed",
            reason: error.code ?? error.name,
            fallback:
              "Keep sources for review and continue responding to received formal observations",
          };
        }
        batchOffset += batch.length;
        activities.push({
          stage,
          sourceCount: batch.length,
          requestedAt: at,
          availableAt: w.now,
          ...result,
        });
        await actOnObservedDraft(result);
        continue;
      }
      if (arm === "B5") {
        const ready = attention.filter(
          (job) => !job.completed && job.at <= w.now,
        );
        for (const job of ready) {
          job.completed = true;
          const observations = conventionalInterpret(job.source, places);
          activities.push({
            stage: "conventional-source-review",
            source: job.source.id,
            worker: job.worker,
            scheduledAt: job.at,
            processedAt: w.now,
            observations,
          });
          await confirmLocations(observations);
          await actOnObservedDraft(
            await draftReceivedResponse(
              app,
              episode + "-turn-" + planningTurns++,
            ),
          );
        }
        if (ready.length) continue;
      }
      // Stop only when no world tasks remain for the declared horizon. Later
      // formal reports and silent communities are not discarded as failures
      // of the platform to "find a tweet".
      const outstandingPhysical = w.state.needs.some(
        (n) => n.quantity > n.served,
      );
      const activeTrips = w.state.operations.some(
        (o) =>
          !["completed", "received", "failed", "cancelled", "service"].includes(
            o.state,
          ),
      );
      if (!outstandingPhysical && !activeTrips) {
        w.advance(horizonMs, { maxEvents: 1000000 });
        break;
      }
      const nextAttention = attention
        .filter((j) => !j.completed)
        .reduce((at, j) => Math.min(at, j.at), horizonMs);
      const nextAt = Math.max(
        w.now + 1,
        Math.min(horizonMs, w.now + 60000, nextAttention),
      );
      w.advance(nextAt, { maxEvents: 1000000 });
      if (w.now < nextAt && w.modelBarrier())
        throw Object.assign(
          Error(
            "The experiment cannot advance with an unresolved model clock barrier",
          ),
          { code: "MODEL_CLOCK_PENDING" },
        );
    }
  } catch (e) {
    status = "failed";
    errors.push({
      phase: "episode",
      at: w.now,
      code: e.code ?? e.name,
      message: e.message.slice(0, 250),
    });
  }
  // The fixed horizon includes provider failures and unfinished requests.
  w.advance(horizonMs, { maxEvents: 1000000 });
  const metrics = evaluate(w),
    relevant = corpus.gold.map((g) => w.need(g.needId));
  const outcomes = relevant.map((n) => ({
    id: n.id,
    building: n.building,
    type: n.type,
    unit: n.unit,
    quantity: n.quantity,
    served: Math.min(n.quantity, n.served),
    overprovided: Math.max(0, n.served - n.quantity),
    completedAt: n.completedAt,
    firstServiceAt: n.firstServiceAt ?? null,
    timeToFirstUsefulServiceMs:
      n.firstServiceAt == null
        ? horizonMs - n.createdAt
        : n.firstServiceAt - n.createdAt,
    firstUsefulCensored: n.firstServiceAt == null,
    timeToSufficientServiceMs:
      n.completedAt == null
        ? horizonMs - n.createdAt
        : n.completedAt - n.createdAt,
    censored: n.completedAt == null,
    deadline: n.deadline,
    silent: n.silent,
  }));
  const usage = (
    await Promise.all(
      h.apps.map((a) =>
        a.store.query(
          "SELECT model,state,cost_usd,reserved_usd,wall_ms,input_tokens,output_tokens,error FROM usage",
        ),
      ),
    )
  ).flatMap((r) => r.rows);
  const finalBuilds = await checkFinalBuilds({
    candidate: candidateFingerprint,
    evaluator: evaluatorBuild,
    simulator: w.manifest.engineBuild,
  }, { candidate: buildFingerprint, evaluator: evaluatorFingerprint });
  if (finalBuilds.invalidStatus) status = finalBuilds.invalidStatus;
  errors.push(...finalBuilds.errors);
  const report = {
    arm,
    seed,
    status,
    errors,
    candidateFingerprint,
    evaluatorFingerprint: evaluatorBuild,
    candidateChanged: finalBuilds.candidateChanged,
    evaluatorChanged: finalBuilds.evaluatorChanged,
    simulatorChanged: finalBuilds.simulatorChanged,
    finalCandidateFingerprint: finalBuilds.finalCandidateFingerprint,
    finalEvaluatorFingerprint: finalBuilds.finalEvaluatorFingerprint,
    finalEngineBuild: finalBuilds.finalEngineBuild,
    modelConfig: {
      modelId: app.config.modelId,
      maxOutputTokens: app.config.modelMaxOutputTokens,
      reasoningEnabled: app.config.modelReasoning,
      providerSort: app.config.modelProviderSort,
      priceMultiplier: app.config.modelPriceMultiplier,
      maxCallsPerInvestigation: app.config.maxCalls,
      totalEpisodeCalls: maxModelCalls,
      budgetUsd,
    },
    protocol: {
      ...DISCOVERY_PROTOCOL,
      humanReadMs,
      humanWorkers,
      clarificationWorkers,
      extentKm,
      grid,
      horizonMs,
      traffic,
      packetLoss,
      budgetUsd,
      maxModelCalls,
    },
    manifest: w.manifest,
    corpus: { manifest: corpus.manifest, config: corpus.config },
    metrics,
    outcomes,
    timeToSufficientService: {
      eligible: outcomes.length,
      completed: outcomes.filter((n) => !n.censored).length,
      rightCensored: outcomes.filter((n) => n.censored).length,
      medianMs: percentile(
        outcomes.map((n) => n.timeToSufficientServiceMs),
        0.5,
      ),
      p95Ms: percentile(
        outcomes.map((n) => n.timeToSufficientServiceMs),
        0.95,
      ),
      restrictedMeanMs:
        outcomes.reduce((s, n) => s + n.timeToSufficientServiceMs, 0) /
        outcomes.length,
    },
    timeToFirstUsefulService: {
      eligible: outcomes.length,
      reached: outcomes.filter((n) => !n.firstUsefulCensored).length,
      rightCensored: outcomes.filter((n) => n.firstUsefulCensored).length,
      medianMs: percentile(
        outcomes.map((n) => n.timeToFirstUsefulServiceMs),
        0.5,
      ),
      p95Ms: percentile(
        outcomes.map((n) => n.timeToFirstUsefulServiceMs),
        0.95,
      ),
      restrictedMeanMs:
        outcomes.reduce((s, n) => s + n.timeToFirstUsefulServiceMs, 0) /
        outcomes.length,
    },
    sourceCoverage: {
      publications: w.state.posts.length,
      receivedOriginals: seenSources.size,
      queuedHumanReviews: attention.length,
      completedHumanReviews: attention.filter((j) => j.completed).length,
      modeledHumanAttentionMs: readCosts,
      semanticBatches,
      generalAgentBatches,
      reconciledProgressSources,
      routineCommentarySources,
      note: "Source counts and inferred claims are not the number of people or needs physically served.",
    },
    activities,
    operationalDiagnostics: {
      planningTurns,
      proposals: (await app.store.list("org0", "proposal", 10000)).map((p) => ({
        id: p.id,
        state: p.state,
        actions: p.actions.length,
        actionFacts: p.actions.map((a) => ({
          owner: a.owner,
          type: a.type,
          params: a.params,
          dependsOn: a.dependsOn,
        })),
      })),
      fleet: Object.values((await app.connector.state()).known.vehicles).map(
        (v) => ({
          id: v.id,
          owner: v.owner,
          state: v.state,
          at: v.at,
          version: v.version,
        }),
      ),
      operations: (await app.store.list("org0", "operation", 10000)).map(
        operationTrace,
      ),
      scorerOnlyPhysical: {
        scope:
          "Evaluator truth for attribution after execution. These fields were never sent to controllers or model prompts.",
        routeScope:
          "Source-selected route at departure; subsequent reroutes or blocked edge progress are not inferred as completed travel.",
        operations: w.state.operations.map(operationTrace),
        departures: physicalDepartures,
      },
    },
    usage,
    invariants: w.invariants(),
    wallMs: performance.now() - start,
    costUsd: usage.reduce((s, u) => s + Number(u.cost_usd ?? 0), 0),
    chargedBudgetUsd: usage.reduce(
      (s, u) => s + Number(u.cost_usd ?? u.reserved_usd ?? 0),
      0,
    ),
  };
  await h.close();
  return report;
}

export function summarizeDiscovery(rows) {
  const groups = Object.groupBy(rows, (r) => r.arm),
    comparisons = [];
  for (const arm of ["B5", "B8", "B0", "B9"]) {
    const reference = groups[arm] ?? [],
      candidate = groups.B6 ?? [];
    const pairs = reference.map((a) => ({
      a,
      b: candidate.find((b) => b.seed === a.seed),
    }));
    if (!pairs.length || pairs.some((p) => !p.b)) continue;
    for (const { a, b } of pairs) {
      if (
        a.candidateChanged ||
        b.candidateChanged ||
        a.evaluatorChanged ||
        b.evaluatorChanged ||
        a.simulatorChanged ||
        b.simulatorChanged ||
        hash(a.protocol) !== hash(b.protocol) ||
        hash(a.corpus) !== hash(b.corpus) ||
        a.candidateFingerprint !== b.candidateFingerprint ||
        a.evaluatorFingerprint !== b.evaluatorFingerprint ||
        a.manifest.engineBuild !== b.manifest.engineBuild
      )
        throw Error(
          "Discovery comparisons must have matching frozen world, corpus, clocks and controller builds",
        );
    }
    const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const responseClockRows = (xs, kind) => xs.map(r => {
      const value = r[kind]?.restrictedMeanMs;
      if (!Number.isFinite(value) || value < 0) throw Error("Missing censored response-clock outcome");
      return { ...r, metrics: { ...r.metrics, services: { response_clock: { uncoveredUnitMs: value } } } };
    });
    const sufficientEffect = pairedBootstrap(responseClockRows(reference, "timeToSufficientService"), responseClockRows(candidate, "timeToSufficientService"), { resource: "response_clock" }),
      firstUsefulEffect = pairedBootstrap(responseClockRows(reference, "timeToFirstUsefulService"), responseClockRows(candidate, "timeToFirstUsefulService"), { resource: "response_clock" });
    const aTime = mean(
        pairs.map((p) => p.a.timeToSufficientService.restrictedMeanMs),
      ),
      bTime = mean(
        pairs.map((p) => p.b.timeToSufficientService.restrictedMeanMs),
      );
    comparisons.push({
      baseline: arm,
      candidate: "B6",
      independentWorlds: pairs.length,
      restrictedMeanTimeReduction: aTime ? 1 - bTime / aTime : null,
      baselineMinutes: aTime / 60000,
      candidateMinutes: bTime / 60000,
      timeEffects: {
        sufficient: { ...sufficientEffect, unit: "milliseconds until sufficient physical aid; right-censored at the fixed horizon", field: "restrictedMeanMs" },
        firstUseful: { ...firstUsefulEffect, unit: "milliseconds until first useful physical aid; right-censored at the fixed horizon", field: "restrictedMeanMs" },
        note: "Resample independent seed worlds, not individual tweets or deliveries. Small internal pilots do not establish generalizability.",
      },
      nativeDeficitEffects: ["water", "food", "blankets"].map(resource => pairedBootstrap(reference, candidate, { resource })),
      completed: {
        baseline: pairs.reduce(
          (s, p) => s + p.a.timeToSufficientService.completed,
          0,
        ),
        candidate: pairs.reduce(
          (s, p) => s + p.b.timeToSufficientService.completed,
          0,
        ),
        eligible: pairs.reduce((s, p) => s + p.a.outcomes.length, 0),
      },
      perWorld: pairs.map(({ a, b }) => ({
        seed: a.seed,
        baselineMinutes: a.timeToSufficientService.restrictedMeanMs / 60000,
        candidateMinutes: b.timeToSufficientService.restrictedMeanMs / 60000,
        improvement: a.timeToSufficientService.restrictedMeanMs
          ? 1 -
            b.timeToSufficientService.restrictedMeanMs /
              a.timeToSufficientService.restrictedMeanMs
          : null,
      })),
      statement:
        "Internal simulation under the declared source-review assumptions. Not field effectiveness, lives saved or Gemini performance.",
    });
  }
  return {
    runs: rows.length,
    completedRuns: rows.filter((r) => r.status === "completed").length,
    failedRuns: rows.filter((r) => r.status !== "completed").length,
    modelFailures: rows.reduce(
      (s, r) =>
        s + r.errors.filter((e) => ["model-discovery", "general-agent-discovery"].includes(e.phase)).length,
      0,
    ),
    invariantViolations: rows.reduce((s, r) => s + r.invariants.length, 0),
    costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    chargedBudgetUsd: rows.reduce((s, r) => s + r.chargedBudgetUsd, 0),
    comparisons,
  };
}
