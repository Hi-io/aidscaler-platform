import { createLabServers } from "../../disaster-response-simulator/sources/server.mjs";
import { evaluate } from "../../disaster-response-simulator/evaluation/metrics.mjs";
import { createPlatform } from "../server.mjs";
import { Store } from "../src/store.mjs";
import { SimulatorConnector } from "../src/connector.mjs";
import { hash } from "../src/store.mjs";
import { readFile } from "node:fs/promises";
import { allocationPlan } from "../src/planning.mjs";
import { servicePlan } from "../src/services.mjs";
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
        "evaluation/campaign-summary.mjs",
        "src/evaluation.mjs",
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
      if (request.type === "review")
        advanceUntil(
          () =>
            !lab.world.state.proposals.find((p) => p.id === result.id)
              ?.reviewPending,
          300000,
        );
      if (request.type === "verify")
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
    const from = options.headers["X-NEXO-From"],
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
  for (let i = 0; i < organizations; i++) {
    const org = "org" + i,
      agentKey = Object.entries(lab.actorKeys).find(
        ([, a]) => a.org === org,
      )[0],
      humanKey = "test-owner-" + org;
    lab.actorKeys[humanKey] = { id: "scripted-" + org, org, role: "commander" };
    const store = await Store.open();
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
    async close() {
      for (const a of apps) await a.close();
      for (const s of stores) await s.close();
      await lab.close();
    },
  };
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
export async function conventionalSharedProposal(app, episode) {
  const org = app.config.org,
    steps = [],
    needs = await app.store.list(org, "need", 2000),
    map = (await app.store.get(org, "context", "geography", false))?.map;
  // This conventional reference receives the SAME consented projections and
  // dependency validator. It may open a recognized shelter, not just dispatch
  // each team's stock independently. It still needs every owner to approve.
  if (needs.some((n) => n.type === "shelter" && n.quantity > (n.served ?? 0))) {
    for (const b of map?.places?.filter((b) => b.use === "shelter") ?? []) {
      await app.connector.action(
        "verify",
        { target: "building", id: b.id },
        episode + "-inspect-" + b.id,
      );
      await app.ingestion.sync({ sources: false });
      const service = await servicePlan(app.store, org, b.id);
      steps.push({
        tool: "checked-service-composition",
        state: "completed",
        result: service,
      });
      if (service.readyToDraft) {
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
  const plan = allocationPlan({
      needs,
      resources,
      vehicles,
      operations: await app.store.list(org, "operation", 2000),
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
} = {}) {
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
  const fingerprint = await buildFingerprint(),
    evaluatorBuild = await evaluatorFingerprint(),
    start = performance.now(),
    h = await createHarness({
      scenario,
      seed,
      organizations: ["B5", "B6"].includes(arm) ? 4 : 1,
      config,
      provider,
      maxCalls,
      budgetUsd: episodeBudgetUsd,
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
    errors = [];
  let status = "completed";
  let planRound,
    roundsExecuted = 0;
  try {
    h.lab.world.advance(60000);
    for (const app of h.apps) {
      for (const target of ["inventory", "vehicles", "map"])
        await app.connector.action("query", { target }, `initial-${target}`);
      await app.ingestion.sync();
    }
    // Public and explicit owner-approved projections travel over signed HTTP.
    if (["B5", "B6"].includes(arm))
      for (const app of h.apps) {
        const actor = (
          await app.store.query(
            "SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",
            [app.config.org],
          )
        ).rows[0];
        for (const kind of ["resource", "vehicle"])
          for (const r of await app.store.list(app.config.org, kind, 100))
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
        if (["B5", "B6"].includes(arm) && app !== h.apps[0]) continue;
        const episode = `${episodePrefix}${app.config.org}-round${round}`;
        let activity;
        if (arm === "B1") activity = await ruleProposal(app, episode);
        else if (arm === "B5")
          activity = await conventionalSharedProposal(app, episode);
        else if (arm === "B2") {
          // Extraction is a real model call with sources, but does not grant human authority.
          const timing = await app.connector.startModel(app.config.modelId);
          let extraction;
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
            await app.connector.finishModel(timing.id, result.usage);
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
            await app.connector
              .finishModel(timing.id, { failed: true })
              .catch(() => {});
            throw e;
          }
          activity = await ruleProposal(app, episode, extraction);
        } else {
          const repair = (
            await app.store.list(app.config.org, "proposal", 100)
          ).find((p) => p.state === "requires_review");
          activity = await app.investigator.run(
            {
              policy: arm === "B3" ? "general" : "nexo",
              ...(repair ? { repairOf: repair.id } : {}),
            },
            episode,
          );
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
    await planRound();
  } catch (e) {
    status = "failed";
    errors.push({ phase: "episode", code: e.code ?? e.name });
  }
  try {
    // Fixed horizon also applies to failed/inconclusive runs; they are never excluded.
    while (h.lab.world.now < h.lab.world.config.durationMs) {
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
        if (["executing", "awaiting_partner"].includes(p.state)) {
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
    const changed = fingerprint !== (await buildFingerprint());
    if (changed) {
      status = "invalid_candidate_changed";
      errors.push({ phase: "manifest", code: "CANDIDATE_CHANGED_DURING_RUN" });
    }
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
      measurementMode: "modeled",
      clockPolicy: "declared delays; no accelerated wall-time charging",
      operator: "scripted; human comprehension not measured",
      planningRounds,
      roundsExecuted,
      policyIntervalMs,
      episodeBudgetUsd,
      planningTopology: ["B5", "B6"].includes(arm)
        ? "one_incident_coordinator_independent_owner_review"
        : "one_isolated_instance",
      modelConfig: {
        modelId: h.apps[0].config.modelId,
        maxOutputTokens: h.apps[0].config.modelMaxOutputTokens,
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
