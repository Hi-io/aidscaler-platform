import {
  createHarness,
  scriptedReview,
  buildFingerprint,
  evaluatorFingerprint,
} from "../evaluation/harness.mjs";
import {
  receivedAllocationPlan,
  validateAllocationOffers,
} from "../src/received-allocation.mjs";
import { ModelBudgetPool } from "../src/budget-pool.mjs";
import { configureResponsePolicy } from "../src/response-policy.mjs";
import { evaluate } from "../../disaster-response-simulator/evaluation/metrics.mjs";
import { createResource } from "../../disaster-response-simulator/engine/ledger.mjs";
import { hash } from "../src/store.mjs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
const o = Object.fromEntries(
    process.argv.slice(2).map((s) => s.replace(/^--/, "").split("=")),
  ),
  seeds = Number(o.seeds ?? 1),
  budget = Number(o.budget ?? 0.6),
  cap = Number(o["episode-budget"] ?? 0.15),
  count = Number(o.needs ?? 100),
  rounds = Number(o.rounds ?? 3),
  arms = (o.arms ?? "B5,B6,B7").split(","),
  folder = "reports/physical-load/" + Date.now();
if (
  !Number.isSafeInteger(seeds) ||
  seeds < 1 ||
  seeds > 10 ||
  !Number.isSafeInteger(count) ||
  count < 10 ||
  count > 1000 ||
  !Number.isSafeInteger(rounds) ||
  rounds < 1 ||
  rounds > 8 ||
  !arms.every((a) => ["B5", "B6", "B7"].includes(a)) ||
  new Set(arms).size !== arms.length ||
  !(cap > 0 && cap <= budget && budget <= 5)
)
  throw Error("Invalid finite physical-load protocol");
const protocol = {
  at: new Date().toISOString(),
  seeds,
  count,
  arms,
  rounds,
  budgetUsd: budget,
  episodeBudgetUsd: cap,
  candidateFingerprint: await buildFingerprint(),
  evaluatorFingerprint: await evaluatorFingerprint(),
  scorerFingerprint: hash(await readFile(new URL(import.meta.url), "utf8")),
  nativeTypes: ["water", "food", "blankets"],
  organizations: 4,
  world:
    "Procedural 13 by 13 road nodes over 10 km; seeded deadlines/priorities, finite protected stock and fleets. Evaluator adds the same recorded demands/resources to every arm before initial HTTP observations.",
  operator: "Scripted finite owner review, not human UX",
  clock:
    "declared modeled tool/review/model/physical delays, not x1 inference latency",
  interpretation:
    "Hundred concurrent needs compete physically. The number of inputs is not the number served; backlog, pending stock, losses and failures remain visible. Semantic quality is evaluated separately.",
  sourceScope:
    "Received official observations plus 10 social-format publications per added need, with public repost lineage. No truth labels, future events or evaluator stock objects are sent to the candidate.",
};
await mkdir(folder, { recursive: true });
await writeFile(folder + "/protocol.json", JSON.stringify(protocol, null, 2));
const rows = [];
let charged = 0,
  stoppedReason = null;
async function sharedRuleProposal(app, episode) {
  const plan = await receivedAllocationPlan(app.store, app.config),
    selected = plan.allocations.slice(0, 30);
  if (!selected.length)
    return {
      state: "inconclusive",
      reason: "No currently executable shared capacity",
      steps: [],
    };
  await validateAllocationOffers(app.store, app.config, selected);
  const p = await app.domain.propose(
    {
      org: app.config.org,
      id: "conventional-physical-reference",
      role: "agent",
    },
    {
      title: "Coordinate current native-unit demand",
      summary:
        "Conventional constrained allocation with the same approved priorities and consented owner capacity.",
      benefit: "Proportionate useful aid",
      rationale:
        "Formal quantities, deadlines, protected stock and vehicle constraints; no model inference.",
      actions: plan.actions.slice(0, 30),
      references: [...new Set(selected.flatMap((a) => a.evidenceIds))],
      conditions: [],
      alternatives: [],
    },
    episode,
  );
  return {
    state: "ready",
    proposalId: p.id,
    steps: [
      {
        tool: "shared-constrained-allocation",
        state: "completed",
        result: plan,
      },
    ],
  };
}
for (let index = 1; index <= seeds && !stoppedReason; index++)
  for (const arm of arms) {
    if (charged + cap > budget) {
      stoppedReason = "budget_cap";
      break;
    }
    if (
      protocol.candidateFingerprint !== (await buildFingerprint()) ||
      protocol.evaluatorFingerprint !== (await evaluatorFingerprint())
    ) {
      stoppedReason = "source_changed";
      break;
    }
    const seed = "physical-scale-" + String(index).padStart(2, "0"),
      episode = "physical-scale-" + seed + "-" + arm + "-" + Date.now(),
      started = performance.now(),
      h = await createHarness({
        scenario: "S23",
        seed,
        organizations: 4,
        budgetUsd: cap,
        maxCalls: 8,
        config: {
          grid: 13,
          extentKm: 10,
          healthReports: false,
          recurringNeeds: false,
          postsPerHour: 0,
          durationMs: 14400000,
        },
        platformConfig: {
          modelScopePrefix: episode,
          modelScopeCalls: 8 * rounds,
          modelBudgetPool: new ModelBudgetPool({
            budgetUsd: cap,
            calls: 8 * rounds,
          }),
        },
      });
    let status = "completed",
      error = null;
    const activities = [];
    console.log(
      JSON.stringify({ running: { arm, seed, concurrentNeeds: count + 1 } }),
    );
    try {
      const w = h.lab.world,
        locations = w.state.map.buildings.filter(
          (b) => b.use === "residential",
        ),
        types = protocol.nativeTypes;
      for (const org of w.state.map.organizations)
        for (const type of ["food", "blankets"])
          w.state.resources.push(
            createResource(
              `load-${org.id}-${type}`,
              org.id,
              org.node,
              type,
              600,
              100,
              {
                availableAt: 0,
                unit: type === "food" ? "portions" : "blankets",
              },
            ),
          );
      for (let i = 0; i < count; i++) {
        const b = locations[i % locations.length],
          type = types[i % 3],
          unit =
            type === "water" ? "L" : type === "food" ? "portions" : "blankets",
          n = w.addNeed({
            id: "load-need-" + i,
            building: b.id,
            node: b.node,
            type,
            unit,
            quantity: 20 + (i % 4),
            deadline: (30 + (i % 90)) * 60000,
            priority: 1 + (i % 7),
          });
        for (const org of w.state.map.organizations) w.observeNeed(org.id, n);
        const post = w.generateSignal("P01", {
          building: b.id,
          causeEvent: seed + "-need-" + i,
          text: `At ${b.id}, ${n.quantity} ${unit} of ${type} are needed in the current emergency.`,
          type: "tweet",
        });
        for (let j = 0; j < 9; j++)
          w.generateSignal("P17", {
            building: b.id,
            causeEvent: seed + "-copy-" + i + "-" + j,
            text: post.public.text,
            type: "tweet",
            repostOf: post.public.id,
            references: [post.public.id],
          });
      }
      w.advance(60000);
      for (const app of h.apps) {
        for (const target of ["inventory", "vehicles", "map", "policy"])
          await app.connector.action(
            "query",
            { target },
            episode + "-" + app.config.org + "-" + target,
          );
        await app.ingestion.sync();
        const owner = (
          await app.store.query(
            "SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",
            [app.config.org],
          )
        ).rows[0];
        await configureResponsePolicy(
          app.store,
          owner,
          {
            version: 0,
            order: "deadline_then_priority",
            reason:
              "Predeclared common owner policy for concurrent native-unit needs",
            maxOpenReviews: 8,
            investigationCooldownMs: 60000,
          },
          episode + "-policy-" + app.config.org,
        );
        if (app.config.org !== "org0") {
          for (const kind of ["resource", "vehicle"])
            for (const record of (
              await app.store.list(app.config.org, kind, 1000)
            ).filter((r) => r.owner === app.config.org))
              await app.network.share(
                owner,
                { kind, id: record.id, version: record.version, to: "org0" },
                episode + "-share-" + record.id,
              );
          await app.worker.drain();
        }
      }
      for (let round = 0; round < rounds; round++) {
        const coordinator = h.apps[0],
          id = episode + "-round-" + round;
        await coordinator.ingestion.sync();
        const activity =
          arm === "B5"
            ? await sharedRuleProposal(coordinator, id)
            : await coordinator.investigator.run(
                { policy: arm === "B7" ? "general" : "nexo" },
                id,
              );
        activities.push({ round, atSim: w.now, ...activity });
        if (activity.proposalId) {
          const p = await coordinator.store.get(
            "org0",
            "proposal",
            activity.proposalId,
          );
          if (await scriptedReview(coordinator, p))
            await coordinator.worker.execute(p.id);
        }
        for (let tick = 0; tick < 24; tick++) {
          w.advance(Math.min(w.config.durationMs, w.now + 60000));
          for (const app of h.apps) {
            await app.ingestion.sync({ sources: false });
            for (const row of await app.store.list(
              app.config.org,
              "proposal",
              2000,
            )) {
              if (row.originPartner && row.state === "awaiting_review")
                await scriptedReview(app, row);
              const p = await app.store.get(app.config.org, "proposal", row.id);
              if (
                ["authorized", "executing", "awaiting_partner"].includes(
                  p.state,
                )
              )
                await app.worker.execute(p.id);
            }
            await app.network.refresh();
            await app.worker.drain();
          }
        }
      }
    } catch (e) {
      status = "failed";
      error = { code: e.code ?? e.name, message: e.message.slice(0, 250) };
    }
    h.lab.world.advance(h.lab.world.config.durationMs, { maxEvents: 1000000 });
    const usage = (
        await Promise.all(
          h.apps.map((a) =>
            a.store.query(
              "SELECT model,state,cost_usd,reserved_usd,wall_ms,input_tokens,output_tokens,error FROM usage",
            ),
          ),
        )
      ).flatMap((r) => r.rows),
      report = {
        arm,
        seed,
        status,
        error,
        episode,
        candidateFingerprint: protocol.candidateFingerprint,
        evaluatorFingerprint: protocol.evaluatorFingerprint,
        scorerFingerprint: protocol.scorerFingerprint,
        candidateChanged:
          protocol.candidateFingerprint !== (await buildFingerprint()),
        episodeBudgetUsd: cap,
        planningRounds: rounds,
        responseOrder: "deadline_then_priority",
        measurementMode: "modeled",
        manifest: h.lab.world.manifest,
        metrics: evaluate(h.lab.world),
        activities,
        usage,
        invariants: h.lab.world.invariants(),
        sourcePublications: h.lab.world.state.posts.length,
        concurrentNeeds: h.lab.world.state.needs.length,
        receivedNeeds: await Promise.all(
          h.apps.map(async (a) => ({
            org: a.config.org,
            count: (await a.store.list(a.config.org, "need", 10000)).length,
          })),
        ),
        outcomes: h.lab.world.state.needs.map((n) => ({
          id: n.id,
          type: n.type,
          unit: n.unit,
          demand: n.quantity,
          served: n.served,
          inTransit: n.inTransit ?? 0,
          deadline: n.deadline,
        })),
        costUsd: usage.reduce((s, u) => s + Number(u.cost_usd ?? 0), 0),
        chargedBudgetUsd: usage.reduce(
          (s, u) => s + Number(u.cost_usd ?? u.reserved_usd ?? 0),
          0,
        ),
        wallMs: performance.now() - started,
      };
    charged += report.chargedBudgetUsd;
    rows.push(report);
    await writeFile(
      `${folder}/${seed}-${arm}.json`,
      JSON.stringify(report, null, 2),
    );
    await h.close();
    console.log(
      JSON.stringify({
        arm,
        seed,
        status,
        error,
        servedNeeds: report.outcomes.filter((n) => n.served >= n.demand).length,
        totalNeeds: report.concurrentNeeds,
        costUsd: report.costUsd,
        violations: report.invariants.length,
      }),
    );
  }
const summary = {
  protocol,
  stoppedReason,
  completed: rows.length,
  planned: seeds * arms.length,
  chargedBudgetUsd: charged,
  costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
  cases: rows.map((r) => ({
    arm: r.arm,
    seed: r.seed,
    status: r.status,
    error: r.error,
    services: r.metrics.services,
    servedNeeds: r.outcomes.filter((n) => n.served >= n.demand).length,
    totalNeeds: r.concurrentNeeds,
    receivedNeeds: r.receivedNeeds,
    candidateChanged: r.candidateChanged,
    violations: r.invariants.length,
    modelCalls: r.usage.length,
    costUsd: r.costUsd,
  })),
  limitations: [
    "Internal synthetic physical competition, not independently authored disaster calibration",
    "Added demand, stock and publications are identical by seed for every arm and received through the same HTTP/consent paths",
    "The number of available or acknowledged sources is not semantic accuracy",
    "Completed native-unit service, attention limits and pending unmet needs are reported separately; no lives-saved claim",
  ],
};
await writeFile(folder + "/summary.json", JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify({
    folder,
    completed: rows.length,
    costUsd: summary.costUsd,
    stoppedReason,
  }),
);
if (
  stoppedReason ||
  rows.length !== seeds * arms.length ||
  rows.some(
    (r) =>
      r.status !== "completed" || r.candidateChanged || r.invariants.length,
  )
)
  process.exitCode = 1;
