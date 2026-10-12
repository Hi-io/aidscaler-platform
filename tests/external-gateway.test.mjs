import test from "node:test";
import assert from "node:assert/strict";
import { createHarness, scriptedReview } from "../evaluation/harness.mjs";
import { createExternalGateway } from "../src/external-gateway.mjs";
import { SimulatorConnector } from "../src/connector.mjs";
import { Store } from "../src/store.mjs";
import { sign } from "../src/network.mjs";
test("a contractor without NEXO independently approves and physically completes its part over signed HTTP", async (t) => {
  const h = await createHarness({
      scenario: "S01",
      seed: "external-partner-contract",
      organizations: 1,
    }),
    store = await Store.open();
  let gateway;
  t.after(async () => {
    await gateway?.close();
    await store.close();
    await h.close();
  });
  const org = "org1",
    agentKey = Object.entries(h.lab.actorKeys).find(
      ([, v]) => v.org === org,
    )[0],
    humanKey = "test-external-owner";
  h.lab.actorKeys[humanKey] = { id: "external-owner", org, role: "commander" };
  const app = h.apps[0],
    peer = { org: "org0", url: app.url, key: "external-test-hmac" },
    connector = new SimulatorConnector({
      sourceUrl: `http://127.0.0.1:${h.lab.sourcePort}`,
      sourceAgentKey: agentKey,
      sourceHumanKey: humanKey,
      fetcher: app.connector.fetcher,
    });
  const opts = {
    org,
    connector,
    peers: [peer],
    store,
    bootstrapPassword: "external-test-password",
  };
  gateway = await createExternalGateway(opts);
  app.config.peers = [
    { org, url: gateway.url, key: peer.key, kind: "external_gateway" },
  ];
  h.lab.world.advance(60000);
  for (const target of ["inventory", "vehicles", "map"]) {
    await app.connector.action("query", { target }, "origin-" + target);
    await connector.action("query", { target }, "external-" + target);
  }
  await app.ingestion.sync();
  await gateway.observe();
  const owner = (
    await store.query(
      "SELECT id,org,name,role FROM users WHERE org=$1 AND role='commander'",
      [org],
    )
  ).rows[0];
  const resource = (await store.list(org, "resource")).find(
      (r) =>
        r.owner === org &&
        r.type === "water" &&
        r.quantity - r.floor - r.reserved >= 5,
    ),
    vehicle = (await store.list(org, "vehicle")).find(
      (v) => v.owner === org && v.capacity >= 5 && v.state === "idle",
    ),
    need = (await app.store.list("org0", "need")).find(
      (n) => n.type === "water",
    );
  assert.ok(resource && vehicle && need);
  await gateway.share(
    owner,
    { kind: "resource", id: resource.id, to: "org0" },
    "share-external-stock",
  );
  await gateway.share(
    owner,
    { kind: "vehicle", id: vehicle.id, to: "org0" },
    "share-external-vehicle",
  );
  await gateway.drain();
  const offers = await app.store.list("org0", "peer_offer");
  assert.equal(offers.filter((o) => o.from === org).length, 2);
  assert.equal(
    offers.some((o) => o.projection.privateNotes),
    false,
  );
  const p = await app.domain.propose(
    { id: "test-analyst", org: "org0", role: "analyst" },
    {
      title: "Complement owned capacity with an external contractor",
      summary:
        "Request five observed units from a partner that has no NEXO workspace.",
      benefit: "Actual aid with separate owner authority",
      rationale:
        "Current capacity projection and observed demand; contractor decides.",
      references: [need.id, ...offers.map((o) => o.id)],
      conditions: [],
      actions: [
        {
          owner: org,
          type: "dispatch",
          params: {
            need: need.id,
            resource: resource.id,
            vehicle: vehicle.id,
            quantity: 5,
          },
          dependsOn: [],
        },
      ],
    },
    "external-draft",
  );
  await scriptedReview(app, p);
  await app.worker.execute(p.id);
  await app.worker.drain();
  let work = (await store.list(org, "external_work"))[0];
  assert.equal(work.state, "awaiting_review");
  assert.equal(work.authorization, null);
  assert.equal(
    (await connector.state()).operations.length,
    0,
    "A signed request is not authority",
  );
  // Restart the bridge against the same durable database before owner review.
  await gateway.close();
  gateway = await createExternalGateway(opts);
  app.config.peers[0].url = gateway.url;
  work = (await store.list(org, "external_work"))[0];
  assert.equal(work.state, "awaiting_review");
  assert.equal(
    gateway.investigator,
    undefined,
    "No model or NEXO workspace is installed",
  );
  const login = await fetch(gateway.url + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `owner@${org}.partner.local`,
      password: "external-test-password",
    }),
  });
  assert.equal(login.status, 200);
  const session = await login.json(),
    cookie = login.headers.get("set-cookie").split(";")[0];
  const denied = await fetch(gateway.url + "/api/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      id: work.id,
      version: work.version,
      decision: "approve",
      note: "Own delivery is acceptable.",
    }),
  });
  assert.equal(denied.status, 403);
  const approved = await fetch(gateway.url + "/api/decision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": session.csrf,
      "Idempotency-Key": "external-human-approval",
    },
    body: JSON.stringify({
      id: work.id,
      version: work.version,
      decision: "approve",
      note: "Own capacity, route and five units checked.",
    }),
  });
  assert.equal(approved.status, 200, await approved.clone().text());
  await gateway.drain();
  assert.ok((await store.get(org, "external_work", work.id)).issued);
  for (let i = 0; i < 20; i++) {
    h.lab.world.advance(
      Math.min(h.lab.world.config.durationMs, h.lab.world.now + 300000),
    );
    await gateway.drain();
    await gateway.drain();
    await app.ingestion.sync({ sources: false });
    await app.worker.execute(p.id);
    if ((await app.store.get("org0", "proposal", p.id)).state === "completed")
      break;
  }
  assert.equal(
    (await app.store.get("org0", "proposal", p.id)).state,
    "completed",
  );
  assert.equal(
    (await store.get(org, "external_work", work.id)).receipt.confirmedBySource,
    true,
  );
  assert.deepEqual(h.lab.world.invariants(), []);
  const signature = sign(peer.key, { message: {}, sentAt: Date.now() });
  await assert.rejects(
    gateway.receive("org0", signature, {
      message: { from: "org0", to: org },
      sentAt: Date.now(),
    }),
    (e) => e.code === "PEER_AUTH" || e.code === "PEER_WINDOW",
  );
});
