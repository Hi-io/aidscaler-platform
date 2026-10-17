import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deliverFieldReport,
  validateFieldAttachment,
} from "../ui/field-delivery.mjs";
import { Store } from "../src/store.mjs";
import { createPlatform } from "../server.mjs";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY8sAAAAASUVORK5CYII=";
const observation = (extra = {}) => ({
  clientId: "field-test-001",
  queueOrg: "org0",
  queueActor: "field-user",
  kind: "need",
  location: "Sakura Shelter",
  text: "We need 100 litres of drinking water.",
  observedAt: 123456,
  references: [],
  ...extra,
});
const attachment = () => ({ mime: "image/png", contentBase64: png });
const receipt = (body) => ({ ...body, id: body.clientId, state: "received" });

test("plain observations keep the strict report contract and drop all queue-only fields", async () => {
  const item = observation({
    lastError: "old network error",
    errorCode: "offline",
    queueKind: "report",
    locationEnabled: true,
    attachmentPreview: "local only",
    quantity: 100,
    unit: "L",
    references: ["report-a", "report-a", "report-b"],
  });
  let sent;
  const result = await deliverFieldReport(item, {
    api: async (route, body) => {
      assert.equal(route, "/api/report");
      sent = body;
      return receipt(body);
    },
    actor: { org: "org0", id: "field-user" },
  });
  assert.deepEqual(sent, {
    clientId: item.clientId,
    text: item.text,
    kind: "need",
    location: item.location,
    observedAt: item.observedAt,
    quantity: 100,
    unit: "L",
    references: ["report-a", "report-b"],
  });
  assert.equal(result.state, "received");
  assert.ok(!JSON.stringify(sent).includes("queue"));
  assert.equal(item.attachmentId, undefined);
});

test("an attachment uploads separately and its ID is durably saved before submitting the report", async () => {
  const item = observation({
    attachment: attachment(),
    references: ["other-evidence", "other-evidence"],
  });
  const steps = [];
  let durable, upload, report;
  const result = await deliverFieldReport(item, {
    api: async (route, body) => {
      steps.push(route);
      if (route === "/api/media/upload") {
        upload = body;
        return { id: "media-original" };
      }
      report = body;
      assert.equal(durable.attachmentId, "media-original");
      return receipt(body);
    },
    persist: async (saved) => {
      steps.push("persist");
      durable = structuredClone(saved);
    },
  });
  assert.deepEqual(steps, ["/api/media/upload", "persist", "/api/report"]);
  assert.match(upload.idempotencyKey, /^field-media-[a-f0-9]{64}$/);
  assert.equal(upload.observedAt, item.observedAt);
  assert.equal(upload.source, "Authenticated field report · field-user");
  assert.match(upload.title, /Sakura Shelter/);
  assert.equal(upload.contentBase64, png);
  assert.deepEqual(report.references, ["other-evidence", "media-original"]);
  assert.equal("attachment" in report, false);
  assert.equal("contentBase64" in report, false);
  assert.equal("attachmentId" in report, false);
  assert.equal("idempotencyKey" in report, false);
  assert.equal(
    item.attachmentId,
    "media-original",
    "caller re-saving an error must retain the upload ACK",
  );
  assert.equal(
    durable.attachment.contentBase64,
    png,
    "original bytes remain in the outbox until report ACK",
  );
  assert.equal(result.id, item.clientId);
});

test("a lost upload ACK retries the identical media key, timestamp and original bytes", async () => {
  const item = observation({
      clientId: "長".repeat(180),
      attachment: attachment(),
    }),
    bodies = [];
  let fail = true,
    persisted = 0,
    reports = 0;
  const options = {
    api: async (route, body) => {
      if (route === "/api/media/upload") {
        bodies.push(structuredClone(body));
        if (fail) {
          fail = false;
          throw new Error("ACK connection lost");
        }
        return { id: "same-media" };
      }
      reports++;
      return receipt(body);
    },
    persist: async () => {
      persisted++;
    },
  };
  await assert.rejects(deliverFieldReport(item, options), /connection lost/);
  assert.equal(item.attachmentId, undefined);
  assert.equal(persisted, 0);
  assert.equal(reports, 0);
  await deliverFieldReport(item, options);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.ok(bodies[0].idempotencyKey.length <= 180);
  assert.equal(persisted, 1);
  assert.equal(reports, 1);
});

test("failed durable persistence prevents report submission; retry recovers the same uploaded evidence", async () => {
  const item = observation({ attachment: attachment() }),
    keys = [];
  let persistFails = true,
    reports = 0;
  const options = {
    api: async (route, body) => {
      if (route === "/api/media/upload") {
        keys.push(body.idempotencyKey);
        return { id: "media-ack" };
      }
      reports++;
      return receipt(body);
    },
    persist: async () => {
      if (persistFails) throw new Error("disk unavailable");
    },
  };
  await assert.rejects(deliverFieldReport(item, options), /disk unavailable/);
  assert.equal(reports, 0);
  assert.equal(item.attachmentId, undefined);
  persistFails = false;
  await deliverFieldReport(item, options);
  assert.deepEqual(keys, [keys[0], keys[0]]);
  assert.equal(reports, 1);
});

test("report failure retains the media ACK; retries never upload again and never duplicate references", async () => {
  const item = observation({
    attachment: attachment(),
    references: ["original-reference"],
  });
  let uploads = 0,
    reports = 0,
    persisted;
  const options = {
    api: async (route, body) => {
      if (route === "/api/media/upload") {
        uploads++;
        return { id: "already-preserved" };
      }
      reports++;
      if (reports === 1) throw new Error("report response lost");
      assert.deepEqual(body.references, [
        "original-reference",
        "already-preserved",
      ]);
      return receipt(body);
    },
    persist: async (saved) => {
      persisted = structuredClone(saved);
    },
  };
  await assert.rejects(deliverFieldReport(item, options), /response lost/);
  assert.equal(item.attachmentId, "already-preserved");
  await deliverFieldReport(
    {
      ...persisted,
      references: [...persisted.references, persisted.attachmentId],
    },
    options,
  );
  assert.equal(uploads, 1);
  assert.equal(reports, 2);
  assert.equal(item.attachment.contentBase64, png);
});

test("invalid, oversized and mismatched attachments or scoped records cannot initiate uploads", async () => {
  let requests = 0;
  const options = {
    api: async () => {
      requests++;
    },
    persist: async () => {},
    actor: { org: "org0", id: "field-user" },
  };
  for (const extra of [
    { attachment: { mime: "text/html", contentBase64: png } },
    { attachment: { mime: "image/png", contentBase64: "!!!!" } },
    { attachment: { mime: "image/jpeg", contentBase64: png } },
    {
      attachment: {
        mime: "image/png",
        contentBase64: Buffer.alloc(2_000_001).toString("base64"),
      },
    },
    {
      attachment: attachment(),
      references: Array.from({ length: 20 }, (_, i) => `evidence-${i}`),
    },
    { attachment: attachment(), observedAt: -1 },
    { queueOrg: "org1" },
    { queueActor: "another-field-user" },
    { queueKind: "task" },
    { text: " " },
    { references: ["x".repeat(1_000_000)] },
  ])
    await assert.rejects(deliverFieldReport(observation(extra), options));
  assert.equal(requests, 0);
  for (const [mime, bytes] of [
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xd9]],
    ["audio/wav", [...Buffer.from("RIFF0000WAVEdata")]],
    ["audio/mpeg", [...Buffer.from("ID3sample")]],
    ["audio/mpeg", [0xff, 0xfb, 0x90, 0x00]],
  ])
    assert.equal(
      validateFieldAttachment({
        mime,
        contentBase64: Buffer.from(bytes).toString("base64"),
      }).mime,
      mime,
    );
  assert.throws(() =>
    validateFieldAttachment({
      mime: "audio/wav",
      contentBase64: Buffer.from("not WAVE").toString("base64"),
    }),
  );
});

test("unacknowledged media or report responses never become successful deliveries", async () => {
  const badMedia = observation({ attachment: attachment() });
  let persistence = 0;
  await assert.rejects(
    deliverFieldReport(badMedia, {
      api: async () => ({ queued: true }),
      persist: async () => {
        persistence++;
      },
    }),
    /not acknowledged/,
  );
  assert.equal(persistence, 0);
  assert.equal(badMedia.attachmentId, undefined);
  for (const result of [
    undefined,
    { id: "other", state: "received" },
    { id: "field-test-001", state: "queued" },
  ])
    await assert.rejects(
      deliverFieldReport(observation(), { api: async () => result }),
      /not acknowledged/,
    );
});

test("real HTTP upload/report retries create one scoped media record, one report and citable evidence", async (t) => {
  const store = await Store.open();
  const evidenceDir = await mkdtemp(
    path.join(os.tmpdir(), "aidscaler-field-delivery-"),
  );
  const app = await createPlatform({
    store,
    evidenceDir,
    port: 0,
    org: "org0",
    startWorker: false,
    autoIngest: false,
    writeAccessFile: false,
    bootstrapPassword: "field-delivery-test-password",
    provider: {
      complete() {
        throw new Error("No inference is permitted in this test");
      },
    },
  });
  t.after(async () => {
    await app.close();
    await store.close();
  });
  const login = await fetch(app.url + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "field@org0.aidscaler.local",
      password: "field-delivery-test-password",
    }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0],
    session = await login.json();
  const user = await (
    await fetch(app.url + "/api/me", { headers: { cookie } })
  ).json();
  let loseUploadAck = true,
    loseReportAck = true,
    uploads = 0;
  const api = async (route, body) => {
    const response = await fetch(app.url + route, {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf,
        "Idempotency-Key": body.idempotencyKey ?? body.clientId,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(result.message), { code: result.error });
    if (route === "/api/media/upload") {
      uploads++;
      if (loseUploadAck) {
        loseUploadAck = false;
        throw new Error("upload ACK lost after commit");
      }
    } else if (loseReportAck) {
      loseReportAck = false;
      throw new Error("report ACK lost after commit");
    }
    return result;
  };
  // A 2 MB source exceeds the report endpoint's 1 MB transport cap and must
  // therefore use the separate upload endpoint, even when replaying its ACK.
  const largePng = Buffer.alloc(2_000_000);
  Buffer.from(png, "base64").copy(largePng);
  const item = observation({
    queueActor: user.user.id,
    attachment: {
      mime: "image/png",
      contentBase64: largePng.toString("base64"),
    },
  });
  let durable;
  const options = {
    api,
    persist: async (saved) => {
      durable = structuredClone(saved);
    },
    actor: user.user,
  };
  await assert.rejects(deliverFieldReport(item, options), /upload ACK lost/);
  assert.equal((await store.list("org0", "media")).length, 1);
  assert.equal((await store.list("org0", "report")).length, 0);
  await assert.rejects(deliverFieldReport(item, options), /report ACK lost/);
  assert.ok(durable.attachmentId);
  assert.equal((await store.list("org0", "report")).length, 1);
  const result = await deliverFieldReport(durable, options);
  assert.equal(result.id, item.clientId);
  assert.equal(result.origin, user.user.id);
  assert.equal(
    uploads,
    2,
    "both upload attempts resolve the original committed evidence record",
  );
  const media = await store.list("org0", "media"),
    reports = await store.list("org0", "report");
  assert.equal(media.length, 1);
  assert.equal(reports.length, 1);
  assert.equal(media[0].uploadedBy, user.user.id);
  assert.deepEqual(reports[0].references, [media[0].id]);
  assert.equal(reports[0].observedAt, item.observedAt);
  assert.equal(reports[0].attachment, undefined);
  const reviewLogin = await fetch(app.url + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "analyst@org0.aidscaler.local",
      password: "field-delivery-test-password",
    }),
  });
  assert.equal(reviewLogin.status, 200);
  const reviewCookie = reviewLogin.headers.get("set-cookie").split(";")[0];
  const cited = await fetch(
    app.url + "/api/evidence?id=" + encodeURIComponent(media[0].id),
    { headers: { cookie: reviewCookie } },
  );
  assert.equal(cited.status, 200);
  assert.equal((await cited.json()).record.id, media[0].id);
  await store.organization("org1");
  await store.put(
    "org1",
    "media",
    "private-other-org",
    { mime: "image/png", state: "unverified" },
    0,
  );
  await assert.rejects(
    deliverFieldReport(
      observation({
        clientId: "foreign-reference",
        queueActor: user.user.id,
        references: ["private-other-org"],
      }),
      options,
    ),
    (error) => error.code === "EVIDENCE",
  );
  assert.equal((await store.list("org0", "report")).length, 1);
});
