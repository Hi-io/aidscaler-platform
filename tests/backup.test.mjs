import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store, hash } from "../src/store.mjs";
import { backupLocal, restoreLocal } from "../scripts/backup.mjs";

test("a private recovery snapshot preserves confirmed commands, pending jobs, audit and evidence without restoring sessions", async (t) => {
  const start = performance.now(),
    dir = await mkdtemp(path.join(os.tmpdir(), "nexo-recovery-")),
    s = await Store.open();
  await s.organization("org0");
  const bytes = Buffer.from("Original field evidence"),
    digest = hash(bytes.toString("base64")),
    evidenceDir = path.join(dir, "evidence");
  await mkdir(path.join(evidenceDir, "org0"), { recursive: true });
  await writeFile(path.join(evidenceDir, "org0", digest), bytes);
  await s.put(
    "org0",
    "media",
    "media1",
    { contentHash: digest, mime: "text/plain" },
    0,
  );
  const cmd = await s.command(
    "org0",
    "dispatch1",
    { quantity: 10 },
    async (tx) => {
      await tx.audit("org0", "owner", "dispatch.confirmed", "operation1", {
        quantity: 10,
      });
      await tx.enqueue("org0", "followup", { id: "operation1" }, "job1");
      return { id: "operation1", quantity: 10 };
    },
  );
  const bundle = await backupLocal(s, { evidenceDir });
  await s.close();
  const restored = await restoreLocal(bundle, path.join(dir, "restored")),
    recovered = await Store.open({ dataDir: restored.dataDir });
  t.after(() => recovered.close());
  let repeated = false;
  const retry = await recovered.command(
    "org0",
    "dispatch1",
    { quantity: 10 },
    async () => {
      repeated = true;
    },
  );
  assert.deepEqual(retry, cmd);
  assert.equal(repeated, false);
  assert.equal(
    (
      await recovered.query(
        "SELECT COUNT(*) AS n FROM jobs WHERE state='queued'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await recovered.query("SELECT COUNT(*) AS n FROM sessions")).rows[0].n,
    0,
  );
  const before = (
    await recovered.query(
      "SELECT * FROM audit WHERE org=$1 ORDER BY sequence",
      ["org0"],
    )
  ).rows;
  assert.equal(before.length, 1);
  await recovered.audit("org0", "owner", "continued", "operation1", {});
  const rows = (
    await recovered.query(
      "SELECT * FROM audit WHERE org=$1 ORDER BY sequence",
      ["org0"],
    )
  ).rows;
  assert.ok(Number(rows[1].sequence) > 1);
  let previous = "";
  for (const r of rows) {
    assert.equal(r.previous_hash, previous);
    assert.equal(
      r.hash,
      hash({
        org: r.org,
        actor: r.actor,
        action: r.action,
        entity: r.entity,
        detail: r.detail,
        at: Number(r.occurred_at),
        previous,
      }),
    );
    previous = r.hash;
  }
  assert.ok(
    performance.now() - start < 300000,
    "Local recovery exceeds the five-minute target on this run",
  );
});

test("recovery rejects changed bundles and never overwrites an existing directory", async () => {
  const s = await Store.open();
  await s.organization("org0");
  const bundle = await backupLocal(s, { evidenceDir: ".local/unused" });
  await s.close();
  await assert.rejects(
    () =>
      restoreLocal(
        { ...bundle, integrity: "tampered" },
        ".local/never-created-by-tampered-backup",
      ),
    /integrity/,
  );
  await assert.rejects(
    () => restoreLocal(bundle, process.cwd()),
    /new directory/,
  );
});
