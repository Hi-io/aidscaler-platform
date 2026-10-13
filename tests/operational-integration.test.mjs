import test from "node:test";
import assert from "node:assert/strict";
import { createLabServers } from "../../disaster-response-simulator/sources/server.mjs";
import { createPlatform } from "../server.mjs";
import { Store } from "../src/store.mjs";
import { sign } from "../src/network.mjs";
import { effectiveNeed } from "../src/response-receipts.mjs";

async function laboratory(t, organizations = 1) {
  const lab = await createLabServers({
    observerPort: 0,
    sourcePort: 0,
    persistCredentials: false,
    config: {
      scenario: "S23",
      seed: "nexo-live-demo-001",
      policy: "none",
      mode: "modeled",
      grid: 5,
      extentKm: 2,
      hazard: "none",
      backgroundTraffic: 0,
      postsPerHour: 0,
      networkLatencyMs: 1000,
      queryLatencyMs: 1000,
      reviewMs: 1000,
      loadMs: 1000,
      unloadMs: 1000,
      inspectionMs: 1000,
      packetLoss: 0,
      durationMs: 14400000,
    },
  });
  const apps = [],
    stores = [];
  t.after(async () => {
    for (const app of apps) await app.close();
    for (const store of stores) await store.close();
    await lab.close();
  });
  for (let i = 0; i < organizations; i++) {
    const org = "org" + i,
      agentKey = Object.entries(lab.actorKeys).find(
        ([, a]) => a.org === org,
      )[0],
      humanKey = "integration-human-" + i;
    lab.actorKeys[humanKey] = {
      org,
      id: "responsible-" + org,
      role: "commander",
    };
    const store = await Store.open();
    stores.push(store);
    const app = await createPlatform({
      store,
      port: 0,
      org,
      sourceUrl: `http://127.0.0.1:${lab.sourcePort}`,
      sourceAgentKey: agentKey,
      sourceHumanKey: humanKey,
      autoIngest: false,
      startWorker: false,
      writeAccessFile: false,
      bootstrapPassword: "integration-password",
      peers: [],
    });
    apps.push(app);
  }
  for (const app of apps)
    app.config.peers = apps
      .filter((p) => p !== app)
      .map((p) => ({
        org: p.config.org,
        url: `http://127.0.0.1:${p.server.address().port}`,
        key: "integration-shared-hmac",
      }));
  lab.world.advance(60000);
  for (const app of apps) {
    for (const target of ["inventory", "vehicles", "map", "policy"])
      await app.connector.action("query", { target }, `integration-bootstrap-${app.config.org}-${target}`);
  }
  lab.world.advance(lab.world.now + 5000);
  for (const app of apps) await app.ingestion.sync();
  const clock = async (play) => {
    const r = await fetch(`http://127.0.0.1:${lab.observerPort}/api/control`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lab.observerKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ play, rate: 1000 }),
    });
    assert.equal(r.ok, true);
  };
  const operator = async (app) =>
    (
      await app.store.query(
        "SELECT id,org,name,role FROM users WHERE org=$1 AND role='commander'",
        [app.config.org],
      )
    ).rows[0];
  return { lab, apps, clock, operator };
}

async function executeUntilEmission(lab, app, id, emitted = async result => result.results?.length > 0) {
  for (let i = 0; i < 30; i++) {
    const result = await app.worker.execute(id);
    if (await emitted(result)) return result;
    // Source approval is a pending finite queue entry, not a synchronous
    // return from execute. Progress the real source clock and receive it.
    lab.world.advance(Math.min(lab.world.config.durationMs, lab.world.now + 10000));
    await app.ingestion.sync({ sources: false });
  }
  assert.fail("Owner-approved source work did not emit within the declared observation window: " +
    JSON.stringify({ state: (await app.store.get(app.config.org, "proposal", id)).state }));
}
test("authorization, physical loading/travel, receipt and retry do not create duplicate aid", async (t) => {
  const {
    lab,
    apps: [app],
    clock,
    operator,
  } = await laboratory(t);
  const actor = await operator(app);
  const p = await app.domain.propose(
    { org: "org0", id: "test-agent", role: "agent" },
    {
      title: "Deliver a bounded water shipment",
      summary: "Part of the observed need",
      benefit: "300 L at the shelter",
      references: ["need-water-main"],
      rationale:
        "Received need and owned available stock; protected reserves remain.",
      conditions: [],
      actions: [
        {
          type: "dispatch",
          owner: "org0",
          params: {
            resource: "r-org0-water",
            vehicle: "v-org0-0",
            need: "need-water-main",
            quantity: 300,
          },
          dependsOn: [],
        },
      ],
    },
    "functional-proposal",
  );
  await assert.rejects(() => app.worker.execute(p.id), /authorization/);
  await app.domain.review(
    actor,
    p.id,
    { version: p.version, decision: "approve" },
    "functional-review",
  );
  const first = await executeUntilEmission(lab, app, p.id);
  assert.equal(first.results.length, 1);
  assert.equal(
    lab.world.state.operations.filter((o) => o.type === "delivery").length,
    1,
  );
  lab.world.advance(14400000);
  await app.ingestion.sync({ sources: false });
  const finished = await app.worker.execute(p.id);
  assert.equal(
    finished.complete,
    true,
    JSON.stringify({
      finished,
      source: (await app.connector.state()).operations,
      truth: lab.world.state.operations,
    }),
  );
  assert.equal(lab.world.need("need-water-main").served, 300);
  assert.deepEqual(lab.world.invariants(), []);
  await app.worker.execute(p.id);
  assert.equal(lab.world.need("need-water-main").served, 300);
  assert.equal(
    (await app.store.get("org0", "proposal", p.id)).state,
    "completed",
  );
});
test("two independent databases communicate over signed HTTP and each owner must authorize before a joint response completes", async (t) => {
  const {
    lab,
    apps: [a, b],
    clock,
    operator,
  } = await laboratory(t, 2);
  const ownerA = await operator(a),
    ownerB = await operator(b);
  const p = await a.domain.propose(
    ownerA,
    {
      title: "A partner completes a bounded water response",
      summary: "Request 300 L from a separate organization",
      benefit: "A joint physical delivery",
      references: ["need-water-main"],
      rationale: "The partner owns its stock, transport and final decision.",
      conditions: [],
      actions: [
        {
          type: "dispatch",
          owner: "org1",
          params: {
            resource: "r-org1-water",
            vehicle: "v-org1-0",
            need: "need-water-main",
            quantity: 300,
          },
          dependsOn: [],
        },
      ],
    },
    "joint-plan",
  );
  await a.domain.review(
    ownerA,
    p.id,
    { version: p.version, decision: "approve" },
    "joint-origin-review",
  );
  await executeUntilEmission(lab, a, p.id, async () =>
    (await a.store.query("SELECT id FROM jobs WHERE kind='peer_send' AND state='queued'")).rows.length > 0);
  const outgoing = (
    await a.store.query(
      "SELECT payload FROM jobs WHERE kind='peer_send' AND state='queued'",
    )
  ).rows[0].payload;
  await a.network.send(outgoing);
  await a.network.send(outgoing);
  const partner = (await b.store.list("org1", "proposal"))[0];
  assert.equal(partner.state, "awaiting_review");
  assert.equal(partner.authorization, null);
  assert.equal(lab.world.state.operations.length, 0);
  await b.domain.review(
    ownerB,
    partner.id,
    { version: partner.version, decision: "approve" },
    "joint-owner-review",
  );
  await executeUntilEmission(lab, b, partner.id);
  lab.world.advance(14400000);
  await b.ingestion.sync({ sources: false });
  const complete = await b.worker.execute(partner.id);
  assert.equal(complete.complete, true);
  for (const { payload } of (
    await b.store.query("SELECT payload FROM jobs WHERE kind='peer_send'")
  ).rows)
    await b.network.send(payload);
  const finalized = await a.worker.execute(p.id);
  assert.equal(finalized.complete, true);
  assert.equal(lab.world.need("need-water-main").served, 300);
  const peerOperations = (await a.store.list("org0", "operation")).filter((o) => o.peerOwner === "org1");
  assert.equal(peerOperations.length, 1);
  assert.equal(peerOperations[0].received, 300);
  assert.equal(effectiveNeed(await a.store.get("org0", "need", "need-water-main"), peerOperations).served, 300);
  assert.deepEqual(lab.world.invariants(), []);
  const malicious = {
    message: {
      id: "false-owner",
      from: "org1",
      to: "org0",
      kind: "response_receipt",
      entityId: "work_" + p.id + "_0",
      version: 999,
      permissionVersion: 1,
      expiresAt: Date.now() + 60000,
      projection: {
        originProposal: p.id,
        originStep: 0,
        state: "completed",
        operation: { confirmedBySource: false },
      },
    },
    sentAt: Date.now(),
  };
  await assert.rejects(
    () =>
      a.network.receive(
        "org1",
        sign("integration-shared-hmac", malicious),
        malicious,
      ),
    /receipt/,
  );
});
