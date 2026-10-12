import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { MediaProcessor } from "../src/media.mjs";
import { EvidenceStore } from "../src/evidence.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("unavailable, descriptive and foreign media never create phantom uploads or invoke the provider", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  for (const org of ["org0", "org1"]) await store.organization(org);
  const evidence = new EvidenceStore(store, {
    evidenceDir: ".local/not-read-by-this-test",
  });
  let attempted = 0;
  const processor = new MediaProcessor({
    store,
    config: {},
    evidence,
    provider: {
      complete() {
        attempted++;
        throw Error("Provider must not receive missing bytes");
      },
    },
  });
  await store.put(
    "org0",
    "signal",
    "video-description",
    { text: "A described simulated video, no file attached" },
    0,
  );
  await store.put(
    "org0",
    "media",
    "incomplete",
    { mime: "image/png", state: "unverified" },
    0,
  );
  await store.put(
    "org1",
    "media",
    "foreign",
    { mime: "image/png", contentHash: "a".repeat(64), size: 12 },
    0,
  );
  const before = await store.get("org0", "media", "incomplete");
  for (const id of ["missing", "video-description", "incomplete", "foreign"]) {
    await assert.rejects(
      processor.analyze("org0", id),
      (e) => e.code === "MEDIA_BYTES_UNAVAILABLE",
    );
    await assert.rejects(
      evidence.read("org0", id),
      (e) => e.code === "MEDIA_BYTES_UNAVAILABLE",
    );
  }
  assert.equal(attempted, 0);
  assert.equal(
    await store.get("org0", "media", "video-description", false),
    null,
  );
  assert.equal(await store.get("org0", "media", "foreign", false), null);
  assert.deepEqual(await store.get("org0", "media", "incomplete"), before);
  assert.equal((await store.list("org0", "media_analysis")).length, 0);
});

test("changed media bytes fail integrity validation instead of becoming new model or public evidence", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "nexo-evidence-test-"),
  );
  const store = await Store.open();
  t.after(async () => {
    await store.close();
    assert.ok(
      path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await rm(directory, { recursive: true, force: true });
  });
  await store.organization("org0");
  const evidence = new EvidenceStore(store, { evidenceDir: directory });
  const bytes = Buffer.from("original source text");
  const media = await evidence.save(
    { org: "org0", id: "field-owner", role: "field" },
    {
      contentBase64: bytes.toString("base64"),
      mime: "text/plain",
      title: "Integrity fixture",
      source: "test",
      observedAt: 1,
    },
    "integrity-upload",
  );
  assert.deepEqual((await evidence.read("org0", media.id)).bytes, bytes);
  await writeFile(
    path.join(directory, "org0", media.contentHash),
    Buffer.from("altered source text"),
  );
  await assert.rejects(
    evidence.read("org0", media.id),
    (e) => e.code === "MEDIA_INTEGRITY",
  );
  assert.equal(
    (await store.get("org0", "media", media.id)).contentHash,
    media.contentHash,
  );
});
