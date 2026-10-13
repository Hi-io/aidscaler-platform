import { createPlatform } from "../../server.mjs";
import { Store } from "../../src/store.mjs";

// Source credentials arrive over stdin, never argv, environment or output.
let input = "";
for await (const part of process.stdin) input += part;
const config = JSON.parse(input);
let app, store;
const send = (message) =>
  new Promise((resolve) => process.send(message, resolve));
const hold = () => new Promise(() => {});
const tick = () => new Promise((resolve) => process.once("message", resolve));
try {
  store = await Store.open({ dataDir: config.dataDir });
  app = await createPlatform({
    ...config,
    port: 0,
    org: "org0",
    store,
    apiKey: undefined,
    autoIngest: false,
    autoInvestigate: false,
    startWorker: false,
    writeAccessFile: false,
    bootstrapPassword: "process-crash-fixture-password",
    provider: {
      complete: async () => {
        throw new Error("MODEL_FORBIDDEN");
      },
    },
  });
  for (const target of ["map", "inventory", "vehicles", "policy"])
    await app.connector.action(
      "query",
      { target },
      "crash-bootstrap-" + target,
    );
  await app.ingestion.sync();
  let proposal = (await store.list("org0", "proposal", 20))[0];
  if (!proposal) {
    proposal = await app.domain.propose(
      { org: "org0", id: "crash-fixture-agent", role: "agent" },
      {
        title: "Deliver one authorized water load",
        summary:
          "One 300 litre cargo, one vehicle and one current owner approval",
        benefit: "Useful water reaches the observed shelter",
        references: ["need-water-main"],
        conditions: [],
        rationale:
          "Received demand and owned capacity; source checks remain authoritative",
        actions: [
          {
            type: "dispatch",
            owner: "org0",
            params: {
              need: "need-water-main",
              resource: "r-org0-water",
              vehicle: "v-org0-0",
              quantity: 300,
              ttlMs: 900000,
            },
            dependsOn: [],
          },
        ],
      },
      "crash-one-proposal",
    );
    const actor = (
      await store.query(
        "SELECT id,org,name,role FROM users WHERE org='org0' AND role='commander'",
      )
    ).rows[0];
    await app.domain.review(
      actor,
      proposal.id,
      {
        version: proposal.version,
        decision: "approve",
        note: "Exact one-load crash integrity fixture",
      },
      "crash-one-approval",
    );
  }
  const checkpoint = async (phase) => {
    const current = await store.get("org0", "proposal", proposal.id);
    await send({
      phase,
      proposalId: proposal.id,
      simId: current.simId,
      state: current.state,
      planHash: current.authorization?.planHash,
      executionResults: current.executionResults?.length ?? 0,
    });
    await hold();
  };
  const action = app.connector.action.bind(app.connector);
  app.connector.action = async (type, ...args) => {
    if (type === "dispatch" && config.crashAt === "before_dispatch")
      await checkpoint("before_dispatch");
    const result = await action(type, ...args);
    if (type === "dispatch" && config.crashAt === "after_dispatch_ack")
      await checkpoint("after_dispatch_ack");
    return result;
  };
  const issued = app.worker.recordIssuedResults.bind(app.worker);
  app.worker.recordIssuedResults = async (p, results, state) => {
    const result = await issued(p, results, state);
    if (
      config.crashAt === "after_local_receipt" &&
      results.some((r) => r.result?.id)
    )
      await checkpoint("after_local_receipt");
    return result;
  };
  let done = false;
  for (let turn = 0; turn < 60; turn++) {
    await app.ingestion.sync({ sources: false });
    const result = await app.worker.execute(proposal.id);
    if (result.complete || (result.skipped && result.state === "completed")) {
      done = true;
      break;
    }
    if (result.requiresReview || result.authorityChanged)
      throw Object.assign(new Error("RECOVERY_REQUIRES_REVIEW"), {
        code: "RECOVERY_REQUIRES_REVIEW",
      });
    await send({ phase: "tick", turn });
    await tick();
  }
  if (!done)
    throw Object.assign(new Error("RECOVERY_LIMIT"), {
      code: "RECOVERY_LIMIT",
    });
  const current = await store.get("org0", "proposal", proposal.id);
  const operations = await store.list("org0", "operation", 20);
  const usage = (await store.query("SELECT COUNT(*)::int AS n FROM usage"))
    .rows[0].n;
  await send({
    phase: "completed",
    proposalId: proposal.id,
    state: current.state,
    planHash: current.authorization?.planHash,
    executionResults: current.executionResults,
    operations: operations.map((o) => ({
      id: o.id,
      state: o.state,
      received: o.received,
      proposalId: o.proposalId,
    })),
    usage,
  });
  await app.close();
  await store.close();
  process.exit(0);
} catch (error) {
  // Keep credentials and connector error bodies out of test diagnostics.
  if (process.connected)
    await send({ phase: "error", code: error.code ?? error.name });
  if (app) await app.close().catch(() => {});
  if (store) await store.close().catch(() => {});
  process.exit(1);
}
