import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Network, sign } from "../src/network.mjs";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
