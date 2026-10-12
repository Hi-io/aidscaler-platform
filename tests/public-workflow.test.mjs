import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { EvidenceStore } from "../src/evidence.mjs";
import { PublicEvidence } from "../src/public-evidence.mjs";
import { createPlatform } from "../server.mjs";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY8sAAAAASUVORK5CYII=",
  "base64",
);
test("public receipt photos stay private until publication, only derived bytes are exposed, and corrections/withdrawal preserve history", async (t) => {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  const evidenceDir = await mkdtemp(
    path.join(os.tmpdir(), "nexo-public-proof-"),
  );
  const config = { evidenceDir, org: "org0" },
    domain = new Domain(store, config),
    evidence = new EvidenceStore(store, config);
  // A decoder stub tests publication semantics, not actual privacy detection.
  const proofs = new PublicEvidence(
    store,
    evidence,
    config,
    async (_, input) => {
      await writeFile(input.output, png);
      return { metadataStripped: true, width: 1, height: 1 };
    },
  );
  const field = { org: "org0", id: "field-test", role: "field" },
    publisher = { org: "org0", id: "publisher-test", role: "publisher" };
  const original = await evidence.save(
    field,
    {
      contentBase64: Buffer.from("private original fixture").toString("base64"),
      mime: "image/png",
      title: "delivery",
      source: "test fixture",
      observedAt: 1,
    },
    "upload",
  );
  await store.put(
    "org0",
    "operation",
    "receipt",
    { state: "completed", confirmedBySource: true, received: 300 },
    0,
  );
  const input = {
    mediaId: original.id,
    operationId: "receipt",
    caption: "Delivered water containers",
    privacyReviewed: true,
  };
  await assert.rejects(
    proofs.approve(publisher, { ...input, privacyReviewed: false }, "reject"),
    (e) => e.code === "PUBLIC_PRIVACY_REVIEW",
  );
  await assert.rejects(
    proofs.approve(field, input, "reject-role"),
    (e) => e.code === "FORBIDDEN",
  );
  const proof = await proofs.approve(publisher, input, "proof");
  assert.equal((await proofs.approve(publisher, input, "proof")).id, proof.id);
  assert.equal(await proofs.publiclyVisible("org0", proof.id), null);
  assert.equal(
    (await evidence.read("org0", original.id)).bytes.toString(),
    "private original fixture",
  );
  const draft = await domain.draftPublication(
    publisher,
    {
      title: "Water received",
      text: "300 litres received by the team",
      area: "District",
      status: "received",
      operationIds: ["receipt"],
      proofIds: [proof.id],
    },
    "draft",
  );
  assert.equal(await proofs.publiclyVisible("org0", proof.id), null);
  const live = await domain.publish(
    publisher,
    draft.id,
    { version: draft.version },
    "publish",
  );
  assert.deepEqual((await proofs.publiclyVisible("org0", proof.id)).bytes, png);
  const correction = await domain.draftPublication(
    publisher,
    {
      title: "Corrected public progress",
      text: "The confirmed receipt is 300 litres, not a completed regional response",
      area: "District",
      status: "received",
      operationIds: ["receipt"],
      proofIds: [proof.id],
      corrects: live.id,
      correctsVersion: live.version,
    },
    "correction",
  );
  assert.equal(
    (await store.get("org0", "publication", live.id)).state,
    "published",
  );
  const corrected = await domain.publish(
    publisher,
    correction.id,
    { version: correction.version },
    "publish-correction",
  );
  assert.equal(
    (await store.get("org0", "publication", live.id)).state,
    "superseded",
  );
  await assert.rejects(
    domain.retractPublication(
      publisher,
      {
        id: corrected.id,
        version: corrected.version,
        reason: "password is secret",
      },
      "bad-notice",
    ),
    (e) => e.code === "PUBLIC_DATA",
  );
  await domain.retractPublication(
    publisher,
    {
      id: corrected.id,
      version: corrected.version,
      reason: "This update was withdrawn pending clarification.",
    },
    "retract",
  );
  assert.equal(await proofs.publiclyVisible("org0", proof.id), null);
  assert.equal(
    (await store.get("org0", "publication", live.id)).text,
    "300 litres received by the team",
  );
  assert.ok(
    (
      await store.query("SELECT action FROM audit WHERE org=$1", ["org0"])
    ).rows.some((r) => r.action === "publication.retracted"),
  );
});
test("publication gates reject premature progress, foreign evidence and restricted disclosure in every public text field", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  await s.organization("org1");
  const d = new Domain(s, {}),
    actor = { org: "org0", id: "pub", role: "publisher" };
  await s.put(
    "org0",
    "operation",
    "ordered",
    { state: "ordered", confirmedBySource: true },
    0,
  );
  await s.put(
    "org1",
    "operation",
    "foreign",
    { state: "completed", confirmedBySource: true },
    0,
  );
  for (const [key, overrides] of [
    ["receipt", { status: "received", operationIds: ["ordered"] }],
    ["transit", { status: "en_route", operationIds: ["ordered"] }],
    ["foreign", { status: "received", operationIds: ["foreign"] }],
    ["title", { title: "api key must stay hidden" }],
    ["area", { area: "password in a location" }],
  ]) {
    const p = await d.draftPublication(
      actor,
      {
        title: "Progress",
        text: "Support is still needed.",
        area: "Region",
        ...overrides,
      },
      "draft-" + key,
    );
    await assert.rejects(
      d.publish(actor, p.id, { version: p.version }, "publish-" + key),
    );
    assert.equal((await s.get("org0", "publication", p.id)).state, "draft");
  }
});
test("HTTP anonymous photo upload is idempotent, private and blocked from inference until moderation", async (t) => {
  const s = await Store.open(),
    evidenceDir = await mkdtemp(path.join(os.tmpdir(), "nexo-community-"));
  const app = await createPlatform({
    port: 0,
    org: "org0",
    store: s,
    evidenceDir,
    autoIngest: false,
    startWorker: false,
    writeAccessFile: false,
    bootstrapPassword: "local-test-12345678",
  });
  t.after(async () => {
    await app.close();
    await s.close();
  });
  const input = {
    clientId: "photo-http-1",
    observedAt: 1,
    location: "District",
    attachment: { mime: "image/png", contentBase64: png.toString("base64") },
  };
  const post = () =>
    fetch(app.url + "/api/community/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  const first = await post();
  assert.equal(first.status, 201);
  const submitted = await first.json();
  assert.equal((await (await post()).json()).id, submitted.id);
  assert.equal((await s.list("org0", "report")).length, 1);
  assert.equal((await s.list("org0", "signal")).length, 0);
  const media = (await s.list("org0", "media"))[0];
  assert.equal(media.moderationRequired, true);
  assert.equal(
    (await fetch(app.url + "/api/media?id=" + media.id)).status,
    401,
  );
  assert.equal(
    (await fetch(app.url + "/api/public/media?id=" + media.id)).status,
    404,
  );
  const login = await fetch(app.url + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "analyst@org0.nexo.local",
      password: "local-test-12345678",
    }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0],
    { csrf } = await login.json();
  const headers = {
    cookie,
    "X-CSRF-Token": csrf,
    "Content-Type": "application/json",
    "Idempotency-Key": "premature-analysis",
  };
  const blocked = await fetch(app.url + "/api/media/analyze", {
    method: "POST",
    headers,
    body: JSON.stringify({ id: media.id }),
  });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error, "MEDIA_MODERATION");
  assert.equal((await s.query("SELECT * FROM usage")).rows.length, 0);
  const report = await s.get("org0", "report", submitted.id);
  const moderated = await fetch(app.url + "/api/report/moderate", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "moderate-http" },
    body: JSON.stringify({
      id: report.id,
      version: report.version,
      decision: "accept",
      reason: "Reviewed source attachment and approximate location",
    }),
  });
  assert.equal(moderated.status, 200);
  assert.equal((await s.get("org0", "report", submitted.id)).state, "observed");
  assert.equal((await s.list("org0", "signal")).length, 1);
  assert.deepEqual(
    await readFile(path.join(evidenceDir, "org0", media.contentHash)),
    png,
  );
});
