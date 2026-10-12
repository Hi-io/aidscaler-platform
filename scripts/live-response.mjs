import { createLabServers } from "../../disaster-response-simulator/sources/server.mjs";
import { evaluate } from "../../disaster-response-simulator/evaluation/metrics.mjs";
import { createPlatform } from "../server.mjs";
import { Store } from "../src/store.mjs";
import { buildFingerprint, scriptedReview } from "../evaluation/harness.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const fingerprint = await buildFingerprint(),
  started = performance.now(),
  lab = await createLabServers({
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
    config: {
      scenario: "S23",
      seed: "live-response-2026-01",
      mode: "live",
      clockLatency: "wall",
      policy: "none",
      organizations: 4,
      grid: 3,
      extentKm: 1,
      hazard: "none",
      backgroundTraffic: 0,
      postsPerHour: 0,
      packetLoss: 0,
      networkLatencyMs: 50,
      queryLatencyMs: 50,
      reviewMs: 1000,
      inspectionMs: 1000,
      loadMs: 1000,
      unloadMs: 1000,
      setupMs: 1000,
      durationMs: 600000,
      healthReports: false,
      sourceRequestLimit: 120,
    },
  });
const key = Object.entries(lab.actorKeys).find(([, v]) => v.org === "org0")[0],
  humanKey = "live-scripted-owner";
lab.actorKeys[humanKey] = {
  id: "live-scripted-commander",
  org: "org0",
  role: "commander",
};
const store = await Store.open(),
  app = await createPlatform({
    org: "org0",
    store,
    port: 0,
    sourceUrl: `http://127.0.0.1:${lab.sourcePort}`,
    sourceAgentKey: key,
    sourceHumanKey: humanKey,
    autoIngest: false,
    startWorker: false,
    writeAccessFile: false,
    bootstrapPassword: "live-evaluation-password",
    maxCalls: 8,
  }),
  episode = "live-response-" + Date.now();
let activity, error, proposal, finalSourceState, stoppedReason;
try {
  const control = await fetch(
    `http://127.0.0.1:${lab.observerPort}/api/control`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lab.observerKey}`,
      },
      body: JSON.stringify({ play: true, rate: 1 }),
    },
  );
  if (!control.ok) throw Error("Live clock could not start.");
  for (const target of ["inventory", "vehicles", "map"])
    await app.connector.action("query", { target }, "live-" + target);
  const initialDeadline = Date.now() + 30000;
  while (Date.now() < initialDeadline) {
    await app.ingestion.sync();
    if (
      (await store.list("org0", "need")).length &&
      (await store.get("org0", "context", "geography", false))
    )
      break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const need = (await store.list("org0", "need")).find(
    (n) => n.type === "water",
  );
  if (!need)
    throw Error(
      "No actor-visible need arrived within the initial live window.",
    );
  activity = await app.investigator.run({ needId: need.id }, episode);
  if (activity.proposalId) {
    proposal = await store.get("org0", "proposal", activity.proposalId);
    await scriptedReview(app, proposal);
    // This is a ten-minute physical observation window, not a promise that
    // every shipment finishes in four minutes. Keep late/failed trips visible.
    const deadline = Date.now() + 610000;
    while (Date.now() < deadline) {
      await app.ingestion.sync({ sources: false });
      await app.worker.drain(4);
      proposal = await store.get("org0", "proposal", proposal.id);
      if (["completed", "requires_review"].includes(proposal.state)) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (proposal.state === "executing")
      stoppedReason = "observation_window_elapsed";
  }
} catch (e) {
  error = { code: e.code ?? e.name, message: e.message.slice(0, 300) };
}
try {
  finalSourceState = await app.connector.state().catch(() => null);
  const usage = (
      await store.query(
        "SELECT episode,model,state,wall_ms,input_tokens,output_tokens,cost_usd,provider_id FROM usage",
      )
    ).rows,
    result = {
      at: new Date().toISOString(),
      episode,
      measurementMode: "live",
      rate: 1,
      clockPolicy:
        "World progresses at actual elapsed wall time, including actual provider and HTTP latency; no accelerated advance.",
      operator: "scripted finite source review, not human UX",
      candidateFingerprint: fingerprint,
      candidateChanged: fingerprint !== (await buildFingerprint()),
      manifest: lab.world.manifest,
      activity,
      proposal,
      error,
      stoppedReason,
      finalSourceState,
      wallMs: performance.now() - started,
      usage,
      costUsd: usage.reduce((s, u) => s + Number(u.cost_usd ?? 0), 0),
      metrics: evaluate(lab.world),
      invariants: lab.world.invariants(),
    };
  await mkdir("reports/runs", { recursive: true });
  await writeFile(
    "reports/runs/" + episode + ".json",
    JSON.stringify(result, null, 2),
  );
  await writeFile(
    "reports/live-response-latest.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      mode: "live x1",
      proposalState: proposal?.state,
      error,
      wallSeconds: Math.round(result.wallMs / 1000),
      simulatedSeconds: Math.round(lab.world.now / 1000),
      calls: usage.length,
      costUsd: result.costUsd,
      services: result.metrics.services,
      violations: result.invariants.length,
    }),
  );
  if (
    error ||
    result.candidateChanged ||
    result.invariants.length ||
    proposal?.state !== "completed"
  )
    process.exitCode = 1;
} finally {
  await app.close();
  await store.close();
  await lab.close();
}
