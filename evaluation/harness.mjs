import { createLabServers } from "../../disaster-response-simulator/sources/server.mjs";
import { evaluate } from "../../disaster-response-simulator/evaluation/metrics.mjs";
import { createPlatform } from "../server.mjs";
import { Store } from "../src/store.mjs";
import { SimulatorConnector } from "../src/connector.mjs";
import { hash } from "../src/store.mjs";
import { check } from "../src/errors.mjs";
import { collectProposalServiceFunnel } from "./proposal-funnel.mjs";
import {
  checkFinalBuilds,
  requireLoadedSimulatorBuild,
} from "./simulator-build.mjs";
import { readFile } from "node:fs/promises";
import { allocationPlan } from "../src/planning.mjs";
import { createLocalEvaluationDatabases } from "./local-postgres.mjs";
import { servicePlan } from "../src/services.mjs";
import {
  responsePolicy,
  responseQueue,
  configureResponsePolicy,
} from "../src/response-policy.mjs";
import { receivedAllocationPlan } from "../src/received-allocation.mjs";
import { receivedExecutionPolicy } from "../src/reservation-policy.mjs";
import { ModelBudgetPool } from "../src/budget-pool.mjs";
import { readdir } from "node:fs/promises";
import {
  normalizeExtraction,
  EXTRACTION_INSTRUCTIONS,
} from "../src/extraction.mjs";
export async function buildFingerprint() {
  const files = (await readdir(new URL("../src/", import.meta.url)))
    .filter((n) => n.endsWith(".mjs"))
    .sort();
  return hash(
    await Promise.all(
      [
        "server.mjs",
        "package.json",
        "pnpm-lock.yaml",
        "src/schema.sql",
        "scripts/media_worker.py",
        "requirements-media.txt",
        ...files.map((f) => "src/" + f),
        ...(await readdir(new URL("../ui/", import.meta.url)))
          .filter((f) => /\.(mjs|js|css|html)$/.test(f))
          .sort()
          .map((f) => "ui/" + f),
      ].map(async (f) => [
        f,
        await readFile(new URL("../" + f, import.meta.url), "utf8"),
      ]),
    ),
  );
}
export async function evaluatorFingerprint() {
  return hash(
    await Promise.all(
      [
        "evaluation/harness.mjs",
        "scripts/evaluate.mjs",
        "scripts/campaign.mjs",
        "scripts/parallel-campaign.mjs",
        "scripts/research-ablation.mjs",
        "scripts/semantic-load.mjs",
        "scripts/pdf-byte-continuation.mjs",
        "scripts/source-recovery.mjs",
        "evaluation/blocked-repair.mjs",
        "evaluation/route-context.mjs",
        "scripts/blocked-repair.mjs",
        "evaluation/campaign-summary.mjs",
        "src/evaluation.mjs",
        "evaluation/discovery-benchmark.mjs",
        "evaluation/human-capacity-benchmark.mjs",
        "evaluation/physical-trace.mjs",
        "evaluation/proposal-funnel.mjs",
        "evaluation/conventional-source.mjs",
        "evaluation/simulator-build.mjs",
        "evaluation/local-postgres.mjs",
        "scripts/discovery-benchmark.mjs",
        "scripts/human-capacity-campaign.mjs",
      ].map(async (f) => [
        f,
        await readFile(new URL("../" + f, import.meta.url), "utf8"),
      ]),
    ),
  );
}
export const PILOT_CONFIG = {
  policy: "none",
  mode: "modeled",
  clockLatency: "modeled",
  grid: 5,
  extentKm: 2,
  topology: "grid",
  hazard: "none",
  backgroundTraffic: 0,
  postsPerHour: 0,
  packetLoss: 0,
  networkLatencyMs: 1000,
  queryLatencyMs: 1000,
  reviewMs: 30000,
  inspectionMs: 60000,
  loadMs: 60000,
  unloadMs: 60000,
  setupMs: 60000,
  durationMs: 14400000,
  modelLatencyMs: 15000,
  sourceRequestLimit: 100000,
};
/** The evaluator controls time. The candidate receives ONLY HTTP source data.
 * SQL/CPU scheduling is charged as measured wall time but zero modeled time.
 * Source queries, field inspections, human review and model calls consume the
 * same declared simulated delay in EVERY arm. Never multiply wall CPU by x1000.
 */
export async function createHarness({
  scenario = "S23",
  seed = "pilot-2026-01",
  organizations = 1,
  config = {},
  provider,
  maxCalls = 8,
  budgetUsd = 1,
  platformConfig = {},
  awaitVerifications = true,
  awaitReviews = true,
  evaluationDatabaseUrl,
} = {}) {
  const lab = await createLabServers({
      observerPort: 0,
      sourcePort: 0,
      persistCredentials: false,
      config: {
        ...PILOT_CONFIG,
        ...config,
        organizations: config.organizations ?? Math.max(4, organizations),
        scenario,
        seed,
      },
    }),
    apps = [],
    stores = [];
  let databases=null,closePromise;
  const close=()=>closePromise??=(async()=>{
    const errors=[];
    for(const app of [...apps].reverse())try{await app.close();}catch(error){errors.push(error);}
    for(const store of [...stores].reverse())try{await store.close();}catch(error){errors.push(error);}
    try{await lab.close();}catch(error){errors.push(error);}
    try{await databases?.close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Evaluation cleanup did not finish.');
  })();
  const advanceUntil = (predicate, budgetMs = 1800000) => {
    const deadline = Math.min(
      lab.world.config.durationMs,
      lab.world.now + budgetMs,
    );
    let loops = 0;
    while (!predicate() && lab.world.now < deadline && loops++ < 50000) {
      const next = lab.world.queue.toJSON()[0];
      const at = Math.min(deadline, next?.at ?? deadline);
      const progress = lab.world.advance(Math.max(lab.world.now, at), {
        maxEvents: 50000,
      });
      if (progress.blocked) break;
    }
    return predicate();
  };
  const sourceFetcher = async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) return response;
    if (new URL(url).pathname === "/api/actor/action") {
      const request = JSON.parse(options.body),
        result = await response.clone().json();
      if (request.type === "query")
        advanceUntil(
          () =>
            lab.world.state.queries?.find((q) => q.id === result.id)?.state ===
            "ready",
          300000,
        );
      if (request.type === "review" && awaitReviews)
        advanceUntil(
          () =>
            !lab.world.state.proposals.find((p) => p.id === result.id)
              ?.reviewPending,
          300000,
        );
      if (request.type === "verify" && awaitVerifications)
        advanceUntil(
          () =>
            ["completed", "inconclusive", "timeout"].includes(
              lab.world.state.inspections.find((i) => i.id === result.id)
                ?.state,
            ),
          1800000,
        );
    }
    return response;
  };
  const networkFetcher = async (url, options) => {
    // Transport is part of the laboratory, outside the candidate. It may see
    // physical connectivity to delay/fail a delivery, never to reveal a plan.
    const from = options.headers["X-AIDSCALER-From"],
      to =
        apps.find((a) => url.startsWith(a.url + "/"))?.config.org ??
        apps
          .flatMap((a) => a.config.peers)
          .find((p) => url.startsWith(p.url + "/"))?.org,
      orgs = [from, to].map((id) => lab.world.organization(id));
    const lost = orgs.some(
      (o) =>
        !o ||
        o.connected === false ||
        !lab.world.connected(lab.world.sectorForNode(o.node)),
    );
    const progress = lab.world.advance(
      Math.min(
        lab.world.config.durationMs,
        lab.world.now + lab.world.config.networkLatencyMs,
      ),
      { maxEvents: 100000 },
    );
    if (progress.blocked)
      throw Object.assign(
        new Error(
          "Peer delivery is waiting for the laboratory computation barrier.",
        ),
        { code: "MODEL_CLOCK_PENDING" },
      );
    lab.world.record("platform_peer_transport", {
      from,
      to,
      state: lost ? "disconnected" : "delivered",
      bytes: Buffer.byteLength(options.body ?? ""),
      latencyMs: lab.world.config.networkLatencyMs,
    });
    if (lost)
      throw Object.assign(new Error("The partner transport is unavailable."), {
        code: "PEER_DISCONNECTED",
      });
    return fetch(url, options);
  };
  try {
  if(evaluationDatabaseUrl)databases=await createLocalEvaluationDatabases(evaluationDatabaseUrl);
  for (let i = 0; i < organizations; i++) {
    const org = "org" + i,
      agentKey = Object.entries(lab.actorKeys).find(
        ([, a]) => a.org === org,
      )[0],
      humanKey = "test-owner-" + org;
    lab.actorKeys[humanKey] = { id: "scripted-" + org, org, role: "commander" };
    const store = await Store.open(databases?{databaseUrl:await databases.createDatabase()}:{});
    stores.push(store);
    const source = {
      sourceUrl: `http://127.0.0.1:${lab.sourcePort}`,
      sourceAgentKey: agentKey,
      sourceHumanKey: humanKey,
      fetcher: sourceFetcher,
    };
    apps.push(
      await createPlatform({
        port: 0,
        org,
        store,
        ...source,
        connector: new SimulatorConnector(source),
        networkFetcher,
        provider,
        autoIngest: false,
        // The evaluator dispatches its declared planning rounds. Product
        // defaults must not add background inference to controlled arms.
        autoInvestigate: false,
        autoDiscover: false,
        startWorker: false,
        writeAccessFile: false,
        bootstrapPassword: "evaluation-password",
        maxCalls,
        budgetUsd,
        ...platformConfig,
      }),
    );
  }
  for (const app of apps)
    app.config.peers = apps
      .filter((p) => p !== app)
      .map((p) => ({
        org: p.config.org,
        url: p.url,
        key: "isolated-evaluation-hmac",
      }));
  return {
    lab,
    apps,
    advanceUntil,
    storage:databases?.metadata()??{backend:'pglite-memory',isolation:'one in-memory database per application'},
    close,
  };
  } catch(error) {
    try{await close();}catch(cleanupError){error.cleanupError=cleanupError;}
    throw error;
  }
}
export async function scriptedReview(app, p) {
  const actor = (
    await app.store.query(
      "SELECT id,org,name,role FROM users WHERE org=$1 AND role='commander'",
      [app.config.org],
    )
  ).rows[0];
  if (!p.conditions.some((c) => !c.satisfied)) {
    try {
      await app.domain.review(
        actor,
        p.id,
        {
          version: p.version,
          decision: "approve",
          note: "Scripted laboratory operator; not a human UX trial.",
        },
        "lab-approve-" + p.id,
      );
    } catch (e) {
      // A competent scripted owner does not approve or retry an infeasible
      // unchanged request hundreds of times. Retain its explicit rejection;
      // a repaired/new proposal must be separately investigated and reviewed.
      if (![400, 403, 409].includes(e.status)) throw e;
      const current = await app.store.get(app.config.org, "proposal", p.id);
      if (
        !["awaiting_review", "requires_review", "needs_clarification"].includes(
          current.state,
        )
      )
        throw e;
      await app.domain.review(
        actor,
        p.id,
        {
          version: current.version,
          decision: "reject",
          note:
            "Scripted owner declined the current plan because its observed feasibility check failed: " +
            e.code,
        },
        "lab-decline-" + p.id + "-" + current.version,
      );
      if (p.originPartner)
        await app.network.response(p, "rejected", {
          rejectedBy: actor.id,
          reason: "Current owner feasibility check failed: " + e.code,
        });
      return false;
    }
    return true;
  }
  return false;
}
export async function ruleProposal(app, episode, extraction = null) {
  const snapshot = await app.connector.state(),
    org = app.config.org;
  const plan = allocationPlan({
    needs: extraction?.needs ?? Object.values(snapshot.known.needs),
    resources: Object.values(snapshot.known.resources).filter(
      (r) => r.owner === org,
    ),
    vehicles: Object.values(snapshot.known.vehicles).filter(
      (v) => v.owner === org,
    ),
    operations: snapshot.operations,
    now: snapshot.now,
    policy: await responsePolicy(app.store, org),
    map: (await app.store.get(org, "context", "geography", false))?.map,
    observedRoads: Object.fromEntries(
      (await app.store.list(org, "road", 5000)).map((r) => [r.id, r]),
    ),
    executionPolicy: await receivedExecutionPolicy(app.store, org),
  });
  if (!plan.allocations.length)
    return {
      state: "inconclusive",
      reason: "No currently executable owned capacity",
      steps: [],
    };
  const selected = plan.allocations.slice(0, 30),
    references = [
      ...new Set(
        selected.flatMap((a) => [
          a.need,
          a.resource,
          a.vehicle,
          ...(extraction?.references.get(a.need) ?? []),
        ]),
      ),
    ];
  const proposal = await app.domain.propose(
    { org, id: "rules-reference", role: "agent" },
    {
      title: "Allocate observed demand with current capacity",
      summary: "Constrained all-resource allocation",
      benefit: "Proportionate aid with protected reserves",
      references,
      conditions: [],
      actions: selected.map((a) => ({
        owner: a.owner,
        type: "dispatch",
        params: {
          need: a.need,
          resource: a.resource,
          vehicle: a.vehicle,
          quantity: a.quantity,
          ttlMs: a.ttlMs,
        },
        dependsOn: [],
      })),
      rationale:
        "Deterministic global priority allocator. Source commands retain owner, capacity and route checks.",
    },
    episode,
  );
  return {
    state: "ready",
    proposalId: proposal.id,
    steps: [{ tool: "allocationPlan", result: plan, state: "completed" }],
  };
}
/** Same-origin formal refresh; capabilities requires its explicit owner scope. */
export async function refreshResearchContext(app, episode, targets) {
  for (const target of targets)
    await app.connector.action(
      "query",
      { target, ...(target === "capabilities" ? { org: app.config.org } : {}) },
      episode + "-refresh-" + target,
    );
}

export async function conventionalSharedProposal(app, episode) {
  const { assessmentPlan } = await import("../src/services.mjs");
  const { unloadingPlan, prepareUnloading, unloadingCheckpoint } = await import("../src/unloading.mjs");
  for (const request of await app.store.list(app.config.org, "unloading_request", 2000)) {
    if (request.receiverOrg !== app.config.org || request.state === "completed") continue;
    const plan = await unloadingPlan(app.store, app.config.org, request.operation);
    if (!plan.readyToDraft) continue;
    const proposal = await prepareUnloading(app.domain, app.store,
      { org: app.config.org, role: "analyst", id: "conventional" },
      { operation: request.operation, checkpoint: unloadingCheckpoint(plan) }, episode + "-unloading-" + request.id);
    return { proposalId: proposal.id, steps: [{ tool: "received-unloading-plan", result: plan }],
      state: "completed", references: plan.references };
  }
  const org = app.config.org,
    steps = [],
    queue = await responseQueue(app.store, org, { limit: 2000 }),
    needs = queue.rows.filter((n) => !n.pendingProposals.length),
    map = (await app.store.get(org, "context", "geography", false))?.map;
  // This conventional reference receives the SAME consented projections and
  // dependency validator. It may open a recognized shelter, not just dispatch
  // each team's stock independently. It still needs every owner to approve.
  if (needs[0]?.type === "shelter") {
    for (const b of map?.places?.filter((b) => b.use === "shelter") ?? []) {
      if (!(await app.store.get(org, "facility", b.id, false)))
        await app.connector.action(
          "verify",
          { target: "building", id: b.id, method: "clarification" },
          episode + "-describe-" + b.id,
        );
      await app.ingestion.sync({ sources: false });
      const assessment = await assessmentPlan(app.store, org, b.id, {
        peers: app.config.peers,
      });
      steps.push({
        tool: "checked-field-assessment",
        state: assessment.satisfied ? "completed" : "pending",
        result: assessment,
      });
      if (assessment.readyToDraft) {
        const p = await app.domain.propose(
          { id: "shared-rules-reference", org, role: "agent" },
          {
            title:
              "Request a competent field assessment from an available crew",
            summary:
              "The site owner and qualified crew owner approve independently before physical travel and work.",
            benefit:
              "A current received assessment, never an assumed safe site",
            rationale:
              "The same conventional rule may use consented peer crew and transport offers. This is not credited to an LLM.",
            actions: assessment.actions,
            references: assessment.references,
            conditions: [],
            alternatives: [],
          },
          episode + "-assessment-" + b.id,
        );
        return { state: "ready", proposalId: p.id, steps };
      }
      if (!assessment.satisfied) continue;
      let service;
      try {
        service = await servicePlan(app.store, org, b.id, {
          needId: needs[0].id,
          peers: app.config.peers,
          refreshFacility: async (request) => {
            const q = await app.connector.action(
              "query",
              { target: request.target, id: request.id },
              episode +
                "-service-status-" +
                b.id +
                "-" +
                request.afterReceiptAt,
            );
            await app.investigator.wait(q.id);
            await app.ingestion.sync({ sources: false });
          },
        });
      } catch (error) {
        if (
          ![
            "FACILITY",
            "FACILITY_UNCHECKED",
            "FACILITY_PURPOSE",
            "FACILITY_UNSAFE",
            "FACILITY_CAPACITY",
            "QUALIFICATION",
            "SERVICE_CAPACITY",
          ].includes(error.code)
        )
          throw error;
        steps.push({
          tool: "checked-service-composition",
          state: "infeasible",
          result: { building: b.id, reason: error.code },
        });
        continue;
      }
      steps.push({
        tool: "checked-service-composition",
        state: "completed",
        result: service,
      });
      if (
        service.readyToDraft &&
        service.actions.some((a) => a.type === "evacuate")
      ) {
        const p = await app.domain.propose(
          { id: "shared-rules-reference", org, role: "agent" },
          {
            title: "Open and use an assessed shelter with shared capabilities",
            summary:
              "Complementary owners provision the known service and transfer an observed displaced group.",
            benefit: "Occupied shelter service with independent approvals",
            rationale:
              "A predefined conventional service rule uses received dependencies, finite stock and compatible transport. This is not credited to an LLM.",
            actions: service.actions,
            references: service.references,
            conditions: [],
            alternatives: [],
          },
          episode,
        );
        return { state: "ready", proposalId: p.id, steps };
      }
    }
  }
  const offers = (await app.store.list(org, "peer_offer", 2000)).filter(
      (o) => o.active && o.expiresAt > Date.now(),
    ),
    resources = [
      ...(await app.store.list(org, "resource", 2000)).filter(
        (r) => r.owner === org,
      ),
      ...offers
        .filter((o) => o.kind === "resource")
        .map((o) => ({
          ...o.projection,
          owner: o.from,
          quantity: o.projection.available,
          reserved: 0,
          floor: 0,
          evidence: o.id,
        })),
    ],
    vehicles = [
      ...(await app.store.list(org, "vehicle", 2000)).filter(
        (v) => v.owner === org,
      ),
      ...offers
        .filter((o) => o.kind === "vehicle")
        .map((o) => ({ ...o.projection, owner: o.from, evidence: o.id })),
    ];
  const plan = await receivedAllocationPlan(app.store, app.config, {
      needIds: needs.map((n) => n.id),
    }),
    selected = plan.allocations.slice(0, 30);
  steps.push({
    tool: "shared-constrained-allocation",
    state: "completed",
    result: plan,
  });
  if (!selected.length)
    return {
      state: "inconclusive",
      reason: "No executable shared capacity",
      steps,
    };
  const refs = [
      ...new Set(
        selected.flatMap((a) => [
          a.need,
          resources.find((r) => r.id === a.resource)?.evidence ?? a.resource,
          vehicles.find((v) => v.id === a.vehicle)?.evidence ?? a.vehicle,
        ]),
      ),
    ],
    p = await app.domain.propose(
      { org, id: "shared-rules-reference", role: "agent" },
      {
        title: "Coordinate known demand across consented owners",
        summary:
          "One conventional shared allocation avoids independent duplicate plans.",
        benefit: "Proportionate shared aid",
        rationale:
          "Same received data, capacity tools and independent owner reviews; no LLM inference.",
        actions: selected.map((a) => ({
          owner: a.owner,
          type: "dispatch",
          params: {
            need: a.need,
            resource: a.resource,
            vehicle: a.vehicle,
            quantity: a.quantity,
            ttlMs: a.ttlMs,
          },
          dependsOn: [],
        })),
        references: refs,
        conditions: [],
        alternatives: [],
      },
      episode,
    );
  return { state: "ready", proposalId: p.id, steps };
}
export async function runEpisode({
  arm = "B4",
  scenario = "S23",
  seed = "pilot-2026-01",
  config = {},
  provider,
  maxCalls = 8,
  replicate = 0,
  episodeBudgetUsd = 0.25,
  planningRounds = 1,
  policyIntervalMs = 600000,
  responseOrder = "deadline_then_priority",
  repairStrategy = "selective",
  inquiryStrategy = "active",
  shouldStop = () => false,
} = {}) {
  if (
    !["selective", "full_refresh"].includes(repairStrategy) ||
    !["active", "broad_refresh"].includes(inquiryStrategy)
  )
    throw Error("Unknown declared research strategy.");
  if (
    !Number.isSafeInteger(planningRounds) ||
    planningRounds < 1 ||
    planningRounds > 24 ||
    !Number.isSafeInteger(policyIntervalMs) ||
    policyIntervalMs < 60000
  )
    throw Error(
      "Use one to twenty-four finite policy rounds with at least a minute between opportunities.",
    );
  const episodePrefix = `pilot-${arm}-${scenario}-${seed}-${replicate}-`;
  await requireLoadedSimulatorBuild();
  const fingerprint = await buildFingerprint(),
    evaluatorBuild = await evaluatorFingerprint(),
    start = performance.now(),
    h = await createHarness({
      scenario,
      seed,
      organizations: ["B5", "B6", "B7"].includes(arm) ? 4 : 1,
      config,
      provider,
      maxCalls,
      budgetUsd: episodeBudgetUsd,
      // Comparative episodes enqueue finite owner review; the common receipt
      // pump below progresses every minute without starting another model call.
      awaitReviews: false,
      platformConfig: {
        modelScopePrefix: episodePrefix,
        modelScopeCalls: maxCalls * planningRounds,
        modelBudgetPool: new ModelBudgetPool({
          budgetUsd: episodeBudgetUsd,
          calls: maxCalls * planningRounds,
        }),
      },
    }),
    activities = [],
    errors = [],
    researchedSources = new Map();
  let status = "completed",
    stopRequestedAt = null;
  let planRound,
    roundsExecuted = 0;
  try {
    h.lab.world.advance(60000);
    for (const app of h.apps) {
      for (const target of ["inventory", "vehicles", "map", "policy"])
        await app.connector.action("query", { target }, `initial-${target}`);
      await app.ingestion.sync();
      const actor = (
        await app.store.query(
          "SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",
          [app.config.org],
        )
      ).rows[0];
      await configureResponsePolicy(
        app.store,
        actor,
        {
          version: 0,
          order: responseOrder,
          maxOpenReviews: 8,
          investigationCooldownMs: 60000,
          protectedTypes: [],
          reason:
            "Predeclared laboratory owner policy, identical for every evaluation arm",
        },
        episodePrefix + "response-policy-" + app.config.org,
      );
    }
    // Public and explicit owner-approved projections travel over signed HTTP.
    if (["B5", "B6", "B7"].includes(arm))
      for (const app of h.apps) {
        const actor = (
          await app.store.query(
            "SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",
            [app.config.org],
          )
        ).rows[0];
        for (const kind of ["resource", "vehicle"])
          for (const r of (
            await app.store.list(app.config.org, kind, 100)
          ).filter((r) => r.owner === app.config.org))
            for (const peer of app.config.peers) {
              await app.network.share(
                actor,
                { kind, id: r.id, version: r.version, to: peer.org },
                `share-${arm}-${r.id}-${peer.org}`,
              );
              await app.worker.drain();
            }
      }
    planRound = async () => {
      const round = roundsExecuted++;
      for (const app of h.apps) {
        // Both shared arms assign this incident's research to one coordinator.
        // Each partner still owns its stock, authority, execution and receipt.
        // This is a declared deployment policy, not distributed leader election.
        if (["B5", "B6", "B7"].includes(arm) && app !== h.apps[0]) continue;
        const episode = `${episodePrefix}${app.config.org}-round${round}`;
        let activity;
        if (arm === "B1") activity = await ruleProposal(app, episode);
        else if (arm === "B5")
          activity = await conventionalSharedProposal(app, episode);
        else if (arm === "B2") {
          // Extraction is a real model call with sources, but does not grant human authority.
          const timing = await app.connector.startModel(app.config.modelId);
          let extraction;
          const callStartedAt = performance.now();
          let timingSubmitted = false;
          try {
            const signals = await app.store.list(app.config.org, "signal", 35),
              snapshot = await app.connector.state();
            const result = await app.provider.complete({
              org: app.config.org,
              episode,
              messages: [
                {
                  role: "system",
                  content: EXTRACTION_INSTRUCTIONS,
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    signals,
                    knownLocations: (
                      await app.store.get(
                        app.config.org,
                        "context",
                        "geography",
                        false,
                      )
                    )?.map?.places,
                  }),
                },
              ],
              tools: [],
            });
            timingSubmitted = true;
            await app.connector.finishModel(timing.id, {
              ...result.usage,
              wallMs: Math.max(
                result.usage?.wallMs ?? 0,
                performance.now() - callStartedAt,
              ),
              ...(result.finishReason === "length" ? { failed: true } : {}),
            });
            check(
              result.finishReason !== "length",
              "SEMANTIC_INCOMPLETE",
              "Extraction output was incomplete.",
              409,
            );
            extraction = normalizeExtraction(
              result.message.content,
              signals,
              Object.values(snapshot.known.needs),
            );
            for (const [index, o] of extraction.observations.entries())
              await app.domain.createClaim(
                {
                  id: "extraction-reference",
                  org: app.config.org,
                  role: "agent",
                },
                {
                  text: o.text,
                  references: o.sourceIds,
                  state: "observed",
                  ...(o.location ? { location: o.location } : {}),
                },
                episode + "-claim-" + index,
              );
            await app.store.upsert(app.config.org, "activity", episode, {
              state: "ready",
              result: {
                observations: extraction.observations,
                unresolved: extraction.unresolved,
              },
              model: result.model,
              steps: [],
              kind: "extraction_only",
            });
          } catch (e) {
            if (!timingSubmitted)
              await app.connector
                .finishModel(timing.id, {
                  failed: true,
                  wallMs: performance.now() - callStartedAt,
                })
                .catch(() => {});
            throw e;
          }
          activity = await ruleProposal(app, episode, extraction);
        } else {
          const repair = (
            await app.store.list(app.config.org, "proposal", 100)
          ).find((p) => p.state === "requires_review");
          const currentQueue = await responseQueue(app.store, app.config.org),
            sourceSignature = hash(
              (await app.store.list(app.config.org, "signal", 10000))
                .map((s) => [s.id, s.sourceVersion, s.state])
                .sort((a, b) => a[0].localeCompare(b[0])),
            );
          if (
            !repair &&
            !currentQueue.total &&
            researchedSources.get(app.config.org) === sourceSignature
          ) {
            activity = {
              state: "idle",
              kind: "unchanged_received_scope",
              calls: 0,
              reason:
                "No uncovered received need, invalidated response or new source version. Existing physical work remains tracked without another model call.",
            };
          } else {
            // Explicit ablations, never credited as competitive references. Both
            // strategies preserve physical receipts and independent owner review.
            // A full refresh reads all operational classes again; selective
            // repair consumes the material invalidation already received.
            const refreshStart = h.lab.world.now,
              refreshWall = performance.now();
            const refreshTargets =
              inquiryStrategy === "broad_refresh"
                ? [
                    "inventory",
                    "vehicles",
                    "roads",
                    "documents",
                    "map",
                    "capabilities",
                  ]
                : repair && repairStrategy === "full_refresh"
                  ? ["inventory", "vehicles", "roads", "map"]
                  : [];
            await refreshResearchContext(app, episode, refreshTargets);
            if (refreshTargets.length)
              await app.ingestion.sync({ sources: false });
            const refreshModelledMs = h.lab.world.now - refreshStart,
              refreshWallMs = performance.now() - refreshWall;
            activity = await app.investigator.run(
              {
                policy: ["B3", "B7"].includes(arm) ? "general" : "aidscaler",
                ...(repair ? { repairOf: repair.id } : {}),
              },
              episode,
            );
            activity = {
              ...activity,
              researchAblation: {
                inquiryStrategy,
                repairStrategy,
                repairOf: repair?.id ?? null,
                refreshTargets,
                refreshModelledMs,
                refreshWallMs,
                modelledDraftMs: h.lab.world.now - refreshStart,
                changedScope: repair?.affectedSteps ?? [],
                preservedSteps: repair?.preservedSteps ?? [],
                physicalHistoryPreserved: true,
              },
            };
            researchedSources.set(app.config.org, sourceSignature);
          }
        }
        activities.push({
          org: app.config.org,
          round,
          atSim: h.lab.world.now,
          ...activity,
        });
        if (activity.proposalId) {
          const p = await app.store.get(
            app.config.org,
            "proposal",
            activity.proposalId,
          );
          if (await scriptedReview(app, p)) {
            try {
              await app.worker.execute(p.id);
            } catch (e) {
              errors.push({
                org: app.config.org,
                phase: "execute",
                code: e.code ?? e.name,
              });
            }
          }
        }
      }
    };
    if (await shouldStop()) {
      status = "aborted";
      stopRequestedAt = h.lab.world.now;
      errors.push({
        phase: "episode",
        code: "CAMPAIGN_INTERRUPTED",
        at: stopRequestedAt,
      });
    } else await planRound();
  } catch (e) {
    status = "failed";
    errors.push({ phase: "episode", code: e.code ?? e.name });
  }
  try {
    // Fixed horizon also applies to failed/inconclusive runs; they are never excluded.
    while (h.lab.world.now < h.lab.world.config.durationMs) {
      // Calls inside a policy round settle before this boundary. Do not kill a
      // provider request or discard its cost just to stop another round.
      if (status === "aborted" || (await shouldStop())) {
        if (status !== "aborted") {
          status = "aborted";
          stopRequestedAt = h.lab.world.now;
          errors.push({
            phase: "episode",
            code: "CAMPAIGN_INTERRUPTED",
            at: stopRequestedAt,
          });
        }
        h.lab.world.advance(h.lab.world.config.durationMs, {
          maxEvents: 1000000,
        });
        break;
      }
      const nextRoundAt = 60000 + roundsExecuted * policyIntervalMs;
      if (
        roundsExecuted < planningRounds &&
        h.lab.world.now >= nextRoundAt &&
        planRound
      ) {
        for (const app of h.apps) await app.ingestion.sync();
        try {
          await planRound();
        } catch (e) {
          status = "failed";
          errors.push({
            phase: "policy_round",
            round: roundsExecuted - 1,
            code: e.code ?? e.name,
          });
        }
      }
      const target = Math.min(
        h.lab.world.config.durationMs,
        h.lab.world.now + 60000,
        planRound && roundsExecuted < planningRounds
          ? Math.max(h.lab.world.now, 60000 + roundsExecuted * policyIntervalMs)
          : Infinity,
      );
      const progress = h.lab.world.advance(target, { maxEvents: 100000 });
      if (progress.blocked) {
        status = "failed";
        errors.push({ phase: "clock", code: "UNRELEASED_MODEL_BARRIER" });
        break;
      }
      let pending = false;
      for (const app of h.apps) {
        await app.ingestion.sync({ sources: false });
        for (const p of await app.store.list(app.config.org, "proposal", 100)) {
          try {
            if (p.originPartner && p.state === "awaiting_review")
              await scriptedReview(app, p);
            const current = await app.store.get(
              app.config.org,
              "proposal",
              p.id,
            );
            if (
              ["authorized", "executing", "awaiting_partner"].includes(
                current.state,
              )
            )
              await app.worker.execute(p.id);
          } catch (e) {
            errors.push({
              org: app.config.org,
              phase: "progress",
              code: e.code ?? e.name,
            });
          }
        }
        await app.worker.drain();
        pending ||= (
          await app.store.list(app.config.org, "proposal", 100)
        ).some((p) =>
          ["authorized", "executing", "awaiting_partner"].includes(p.state),
        );
      }
      if (!pending && (!planRound || roundsExecuted >= planningRounds)) {
        h.lab.world.advance(h.lab.world.config.durationMs, {
          maxEvents: 1000000,
        });
        break;
      }
    }
    for (const app of h.apps) {
      await app.ingestion.sync({ sources: false });
      for (const p of await app.store.list(app.config.org, "proposal", 100))
        if (
          status !== "aborted" &&
          ["executing", "awaiting_partner"].includes(p.state)
        ) {
          try {
            await app.worker.execute(p.id);
          } catch (e) {
            errors.push({
              org: app.config.org,
              phase: "receipt",
              code: e.code ?? e.name,
            });
          }
        }
    }
    const usage = [];
    for (const app of h.apps)
      usage.push(
        ...(
          await app.store.query(
            "SELECT episode,model,state,wall_ms,input_tokens,output_tokens,cost_usd,reserved_usd,provider_id,pricing FROM usage",
          )
        ).rows,
      );
    const finalBuilds = await checkFinalBuilds(
      {
        candidate: fingerprint,
        evaluator: evaluatorBuild,
        simulator: h.lab.world.manifest.engineBuild,
      },
      { candidate: buildFingerprint, evaluator: evaluatorFingerprint },
    );
    if (finalBuilds.invalidStatus) status = finalBuilds.invalidStatus;
    errors.push(...finalBuilds.errors);
    const platformEvidence = [];
    for (const app of h.apps) {
      const counts = (
        await app.store.query(
          "SELECT kind,data->>'state' AS state,COUNT(*) AS n FROM entities WHERE org=$1 GROUP BY kind,data->>'state'",
          [app.config.org],
        )
      ).rows;
      const claims = await app.store.list(app.config.org, "claim", 2000);
      platformEvidence.push({
        org: app.config.org,
        counts: counts.map((r) => ({ ...r, n: Number(r.n) })),
        claimCount: claims.length,
        // Received owner-scoped evidence, separate from evaluator-only truth.
        assessments: (
          await app.store.list(app.config.org, "verification", 2000)
        ).filter((v) => v.purpose === "facility_safety"),
        operations: await app.store.list(app.config.org, "operation", 2000),
        facilities: await app.store.list(app.config.org, "facility", 2000),
        investigatorQueries: activities
          .filter((a) => a.org === app.config.org)
          .flatMap((a) => a.steps ?? [])
          .filter((s) =>
            ["lookup", "verify", "search", "external_lookup"].includes(s.tool),
          )
          .map((s) => ({ tool: s.tool, state: s.state, at: s.at })),
        evidencePrecision: null,
        evidenceRecall: null,
        humanMinutes: null,
        note: "Claim existence, input acknowledgment and model completion do not establish precision or recall. No independently annotated semantic or human study was supplied.",
      });
    }
    const proposalFunnel = await collectProposalServiceFunnel(h.apps, h.lab.world);
    return {
      at: new Date().toISOString(),
      arm,
      scenario,
      seed,
      replicate,
      status,
      errors,
      manifest: h.lab.world.manifest,
      engineBuild: h.lab.world.manifest.engineBuild,
      initialMapHash: h.lab.world.state.map.hash,
      candidateFingerprint: fingerprint,
      evaluatorFingerprint: evaluatorBuild,
      candidateChanged: finalBuilds.candidateChanged,
      evaluatorChanged: finalBuilds.evaluatorChanged,
      simulatorChanged: finalBuilds.simulatorChanged,
      finalCandidateFingerprint: finalBuilds.finalCandidateFingerprint,
      finalEvaluatorFingerprint: finalBuilds.finalEvaluatorFingerprint,
      finalEngineBuild: finalBuilds.finalEngineBuild,
      measurementMode: "modeled",
      clockPolicy: "declared delays; no accelerated wall-time charging",
      operator: "scripted; human comprehension not measured",
      planningRounds,
      responseOrder,
      repairStrategy,
      inquiryStrategy,
      roundsExecuted,
      stopRequestedAt,
      policyIntervalMs,
      episodeBudgetUsd,
      planningTopology: ["B5", "B6", "B7"].includes(arm)
        ? "one_incident_coordinator_independent_owner_review"
        : "one_isolated_instance",
      modelConfig: {
        modelId: h.apps[0].config.modelId,
        maxOutputTokens: h.apps[0].config.modelMaxOutputTokens,
        modelTimeoutMs: h.apps[0].config.modelTimeoutMs,
        investigationTimeoutMs: h.apps[0].config.investigationTimeoutMs,
        reasoningEnabled: h.apps[0].config.modelReasoning,
        providerSort: h.apps[0].config.modelProviderSort,
        priceMultiplier: h.apps[0].config.modelPriceMultiplier,
        maxCallsPerRound: maxCalls,
        totalEpisodeCalls: maxCalls * planningRounds,
        budgetPolicy: "shared_episode_pool_same_total_cap_for_every_arm",
      },
      wallMs: performance.now() - start,
      activities,
      platformEvidence,
      proposalFunnel,
      usage,
      costUsd: usage.reduce((s, u) => s + Number(u.cost_usd ?? 0), 0),
      chargedBudgetUsd: usage.reduce(
        (s, u) => s + Number(u.cost_usd ?? u.reserved_usd ?? 0),
        0,
      ),
      unknownCostCalls: usage.filter((u) => u.cost_usd == null).length,
      metrics: evaluate(h.lab.world),
      invariants: h.lab.world.invariants(),
      claimScope:
        "development pilot; not held-out, calibrated field or UX validation",
    };
  } finally {
    await h.close();
  }
}
