import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Network, sign } from "../src/network.mjs";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
test("partner changes stop uncovered future work while retaining deliveries already requested or completed", async (t) => {
  const store = await Store.open();
  await store.organization("org0");
  t.after(() => store.close());
  const n = new Network(store, {
      org: "org0",
      peers: [{ org: "org1", key: "changes-key", url: "http://localhost" }],
    }),
    offer = "org1_resource_r";
  const message = {
    id: "first",
    from: "org1",
    to: "org0",
    kind: "resource",
    entityId: "r",
    version: 1,
    permissionVersion: 1,
    at: Date.now(),
    expiresAt: Date.now() + 60000,
    projection: { id: "r", type: "water", available: 10 },
  };
  const send = async (m) => {
    const e = { message: m, sentAt: Date.now() };
    return n.receive("org1", sign("changes-key", e), e);
  };
  await send(message);
  const action = {
    owner: "org1",
    type: "dispatch",
    params: { resource: "r", vehicle: "v", need: "n", quantity: 10 },
    dependsOn: [],
  };
  for (const [id, state, results] of [
    ["future", "authorized", []],
    ["issued", "awaiting_partner", [{ index: 0, requestId: "work-issued" }]],
    ["historical", "completed", [{ index: 0, state: "completed" }]],
  ])
    await store.put(
      "org0",
      "proposal",
      id,
      {
        state,
        actions: [action],
        dependencies: [offer],
        authorization: { by: "owner" },
        executionResults: results,
      },
      0,
    );
  await send({
    ...message,
    id: "lower",
    version: 2,
    projection: { ...message.projection, available: 5 },
  });
  assert.equal(
    (await store.get("org0", "proposal", "future")).state,
    "requires_review",
  );
  assert.equal(
    (await store.get("org0", "proposal", "future")).previousAuthorization.by,
    "owner",
  );
  assert.equal(
    (await store.get("org0", "proposal", "issued")).state,
    "awaiting_partner",
  );
  await send({
    ...message,
    id: "withdrawn",
    version: 3,
    permissionVersion: 2,
    revoke: true,
    projection: null,
  });
  assert.equal(
    (await store.get("org0", "proposal", "issued")).state,
    "requires_review",
  );
  assert.equal(
    (await store.get("org0", "proposal", "historical")).state,
    "completed",
  );
  assert.equal(
    (await store.get("org0", "proposal", "historical")).executionResults[0]
      .state,
    "completed",
  );
});
test("signed network updates deduplicate, preserve revisions, revoke and cannot leak an unshared document", async (t) => {
  const store = await Store.open();
  await store.organization("org0");
  t.after(() => store.close());
  const config = {
    org: "org0",
    peers: [
      { org: "org1", key: "shared-network-key", url: "http://localhost" },
    ],
  };
  const n = new Network(store, config),
    base = {
      id: "message-1",
      from: "org1",
      to: "org0",
      kind: "resource",
      entityId: "water",
      version: 2,
      permissionVersion: 1,
      expiresAt: Date.now() + 10000,
      projection: { type: "water", available: 100 },
      at: Date.now(),
    };
  const send = async (message) => {
    const env = { message, sentAt: Date.now() };
    return n.receive("org1", sign("shared-network-key", env), env);
  };
  assert.equal((await send(base)).accepted, true);
  assert.equal((await send(base)).duplicate, true);
  assert.equal(
    (await send({ ...base, id: "old-message", version: 1 })).stale,
    true,
  );
  assert.equal(
    (await store.get("org0", "peer_offer", "org1_resource_water"))
      .sourceVersion,
    2,
  );
  await send({
    ...base,
    id: "revoke-message",
    permissionVersion: 2,
    revoke: true,
    projection: null,
  });
  assert.equal(
    (await store.get("org0", "peer_offer", "org1_resource_water")).active,
    false,
  );
  await send({ ...base, id: "delayed-original" });
  assert.equal(
    (await store.get("org0", "peer_offer", "org1_resource_water")).active,
    false,
  );
  await assert.rejects(
    () => n.receive("org1", "invalid", { message: base, sentAt: Date.now() }),
    /authentication/,
  );
});
test("PostgreSQL persistence retains authorization, idempotency and expired worker leases after a restart", async () => {
  const base = path.resolve(".local", "recovery-tests");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, "run-"));
  let s = await Store.open({ dataDir: directory });
  try {
    await s.organization("org0");
    await s.command("org0", "record-once", { n: 1 }, async (tx) => {
      await tx.put(
        "org0",
        "proposal",
        "p",
        {
          authorization: { by: "owner", evidenceHash: "snapshot" },
          state: "authorized",
        },
        0,
      );
      await tx.enqueue("org0", "ingest", {}, "resume-job");
      return { id: "p" };
    });
    const job = await s.lease("org0", 1);
    assert.equal(job.id, "resume-job");
    await s.close();
    s = await Store.open({ dataDir: directory });
    const p = await s.get("org0", "proposal", "p");
    assert.equal(p.authorization.by, "owner");
    assert.equal(
      (
        await s.command("org0", "record-once", { n: 1 }, () => {
          throw Error("must not reapply");
        })
      ).id,
      "p",
    );
    assert.equal((await s.lease("org0")).id, "resume-job");
  } finally {
    await s.close(); /* Retain the isolated local database for inspection; ignored by Git. */
  }
});
