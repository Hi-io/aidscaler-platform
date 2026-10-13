import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { Store } from "../src/store.mjs";
import { Integrations } from "../src/integrations.mjs";
import { Retention } from "../src/retention.mjs";

const records = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `post-${i}`,
    text: `Unverified public post number ${i}`,
  }));
async function fixture(t, data, config = {}, durable = false) {
  const base = fileURLToPath(new URL("../.local/", import.meta.url));
  await mkdir(base, { recursive: true });
  const temp = durable
    ? await mkdtemp(path.join(base, "integration-pages-"))
    : null;
  if (temp)
    assert.ok(path.resolve(temp).startsWith(path.resolve(base) + path.sep));
  const result = { requests: 0, data };
  result.server = http.createServer(async (req, res) => {
    result.requests++;
    if (result.beforeResponse) await result.beforeResponse();
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result.data));
  });
  await new Promise((resolve) => result.server.listen(0, "127.0.0.1", resolve));
  result.origin = `http://127.0.0.1:${result.server.address().port}`;
  result.store = await Store.open(
    temp ? { dataDir: path.join(temp, "pgdata") } : {},
  );
  result.config = { org: "a", ...config };
  result.integration = new Integrations(result.store, result.config);
  result.actor = { org: "a", id: "admin", role: "admin" };
  result.definition = {
    id: "public-source",
    name: "Authorized public posts",
    type: "http_json",
    url: result.origin + "/data",
    allowedOrigin: result.origin,
    purpose: "Read scoped synthetic evidence",
    license: "Synthetic fixture",
    enabled: true,
  };
  await result.store.organization("a");
  await result.store.organization("b");
  await result.integration.configure(
    result.actor,
    result.definition,
    "initial-config",
  );
  result.restart = async () => {
    await result.store.close();
    result.store = await Store.open({ dataDir: path.join(temp, "pgdata") });
    result.integration = new Integrations(result.store, result.config);
  };
  t.after(async () => {
    await new Promise((resolve) => result.server.close(resolve));
    await result.store.close();
    if (temp) await rm(temp, { recursive: true, force: true });
  });
  return result;
}
const count = async (store, kind, org = "a") =>
  Number(
    (
      await store.query(
        "SELECT COUNT(*) AS n FROM entities WHERE org=$1 AND kind=$2",
        [org, kind],
      )
    ).rows[0].n,
  );

test(
  "205 received HTTP records remain bounded, durable and accessible across restart; rereading unchanged records creates no versions",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { results: records(205) }, {}, true);
    const first = await f.integration.read("a", "public-source");
    assert.equal(first.processing.offset, 100);
    assert.equal(first.processing.remaining, 105);
    assert.equal(first.processing.state, "pending");
    assert.equal(
      (await f.store.get("a", "integration", "public-source")).state,
      "backlog",
    );
    assert.equal(await count(f.store, "signal"), 100);
    await f.restart();
    const second = await f.integration.read("a", "public-source");
    assert.equal(second.processing.offset, 200);
    const third = await f.integration.pollDue();
    assert.equal(third.pages, 1);
    const completed = await f.store.get("a", "external", first.id);
    assert.equal(completed.processing.acceptedVersions, 205);
    assert.equal(completed.processing.remaining, 0);
    assert.equal(completed.processing.state, "registered_unverified");
    assert.equal(
      f.requests,
      1,
      "Continuation consumes the received snapshot, never a new source response",
    );
    for (const kind of ["signal", "source_version", "intake"])
      assert.equal(await count(f.store, kind), 205);
    for (const kind of ["need", "proposal", "operation"])
      assert.equal(await count(f.store, kind), 0);
    assert.ok(
      (await f.store.list("a", "signal", 1000)).every(
        (row) => row.state === "unverified" && row.sourceVersion === 1,
      ),
    );
    assert.equal(
      (await f.store.get("a", "integration", "public-source")).backlogRecords,
      0,
    );
    await f.integration.read("a", "public-source");
    await f.integration.continue("a", "public-source");
    const repeat = await f.integration.continue("a", "public-source");
    assert.equal(repeat.processing.unchanged, 205);
    assert.equal(repeat.processing.acceptedVersions, 0);
    assert.equal(await count(f.store, "source_version"), 205);
    assert.equal(await count(f.store, "intake"), 205);
    assert.equal(f.requests, 2);
    await assert.rejects(f.integration.read("b", "public-source"), {
      code: "NOT_FOUND",
    });
  },
);

test(
  "a page write fault rolls back intake, versions and cursor together; retry consumes the same received batch once",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, records(105));
    const stage = f.integration.intake.stage.bind(f.integration.intake);
    let calls = 0;
    f.integration.intake.stage = async (...args) => {
      await stage(...args);
      if (++calls === 52)
        throw Object.assign(new Error("Injected page storage fault"), {
          code: "ENOSPC",
        });
    };
    await assert.rejects(f.integration.read("a", "public-source"), {
      code: "ENOSPC",
    });
    let c = await f.store.get("a", "integration", "public-source");
    assert.equal(c.pending.offset, 0);
    assert.equal(c.backlogRecords, 105);
    assert.equal(c.state, "degraded");
    for (const kind of ["signal", "source_version", "intake"])
      assert.equal(await count(f.store, kind), 0);
    assert.equal(
      (await f.store.get("a", "external", c.pending.observation)).processing
        .acceptedVersions,
      0,
    );
    f.integration.intake.stage = stage;
    await f.integration.read("a", "public-source");
    await f.integration.continue("a", "public-source");
    c = await f.store.get("a", "integration", "public-source");
    assert.equal(c.state, "connected");
    for (const kind of ["signal", "source_version", "intake"])
      assert.equal(await count(f.store, kind), 105);
    assert.equal(f.requests, 1);
  },
);

test(
  "a final-page downstream failure survives restart and retries without skipping intake or making another HTTP request",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, records(105), {}, true);
    await f.integration.read("a", "public-source");
    let notifications = 0;
    f.integration.afterRead = async (rows) => {
      notifications++;
      assert.equal(rows.length, 5);
      throw Object.assign(new Error("Injected downstream outage"), {
        code: "DOWNSTREAM_UNAVAILABLE",
      });
    };
    await assert.rejects(f.integration.continue("a", "public-source"), {
      code: "DOWNSTREAM_UNAVAILABLE",
    });
    const pending = await f.store.get("a", "integration", "public-source");
    assert.equal(pending.pending, null);
    assert.equal(pending.backlogRecords, 0);
    assert.equal(pending.notifyPending.versions.length, 5);
    assert.equal(pending.downstreamState, "pending_retry");
    assert.equal(pending.state, "degraded");
    assert.equal(pending.lastDownstreamError, "DOWNSTREAM_UNAVAILABLE");
    assert.equal(
      await count(f.store, "intake"),
      105,
      "Downstream input was committed atomically before notification",
    );
    await f.restart();
    f.integration.afterRead = async (rows) => {
      notifications++;
      for (const row of rows)
        await f.store.enqueue(
          "a",
          "fixture-notified",
          { source: row.id },
          `notified_${row.id}_${row.sourceVersion}`,
        );
    };
    const retried = await f.integration.read("a", "public-source");
    assert.equal(retried.id, pending.notifyPending.observation);
    const done = await f.store.get("a", "integration", "public-source");
    assert.equal(done.notifyPending, null);
    assert.equal(done.downstreamState, "durable_intake");
    assert.equal(done.state, "connected");
    assert.equal(done.error, null);
    assert.equal(f.requests, 1);
    assert.equal(notifications, 2);
    assert.equal(
      Number(
        (
          await f.store.query(
            "SELECT COUNT(*) AS n FROM jobs WHERE kind='fixture-notified'",
          )
        ).rows[0].n,
      ),
      5,
    );
    assert.equal(await count(f.store, "source_version"), 105);
  },
);

test(
  "permissions and connector scope pause a retained batch; continuation consumes neither another tenant nor a newly approved origin",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, records(105));
    await f.integration.read("a", "public-source");
    await assert.rejects(
      f.integration.configure(
        { ...f.actor, role: "analyst" },
        f.definition,
        "unauthorized",
      ),
      { code: "FORBIDDEN" },
    );
    await f.integration.configure(
      f.actor,
      { ...f.definition, enabled: false },
      "disable",
    );
    await assert.rejects(f.integration.continue("a", "public-source"), {
      code: "CONNECTOR_DISABLED",
    });
    assert.equal(await count(f.store, "signal"), 100);
    await f.integration.configure(
      f.actor,
      { ...f.definition, url: f.origin + "/other" },
      "change-scope",
    );
    await assert.rejects(f.integration.continue("a", "public-source"), {
      code: "CONNECTOR_CHANGED",
    });
    assert.equal(
      (await f.store.get("a", "integration", "public-source")).pending.offset,
      100,
    );
    await f.integration.configure(f.actor, f.definition, "restore-scope");
    await f.integration.continue("a", "public-source");
    assert.equal(await count(f.store, "signal"), 105);
    assert.equal(await count(f.store, "signal", "b"), 0);
    assert.equal(f.requests, 1);
  },
);

test(
  "source erasure closes its retained snapshot and cannot restore erased text by rereading the external source",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, records(105));
    await f.integration.read("a", "public-source");
    const original = (await f.store.list("a", "signal", 1000))[0];
    const retention = new Retention(
      f.store,
      { invalidateTx: async () => {} },
      { evidenceDir: ".local/unused-integration-evidence" },
    );
    const preview = await retention.preview(f.actor, {
      kind: "signal",
      id: original.id,
    });
    await retention.erase(
      f.actor,
      {
        kind: "signal",
        id: original.id,
        version: preview.version,
        planHash: preview.planHash,
        reason: "Erase synthetic source under approved policy",
      },
      "erase-source",
    );
    const closed = await f.integration.continue("a", "public-source");
    assert.equal(closed.state, "erased");
    assert.equal(closed.processing.state, "cancelled_erasure");
    assert.equal(closed.processing.remaining, 5);
    assert.equal(
      (await f.store.get("a", "integration", "public-source")).closedBatch
        .unprocessedRecords,
      5,
    );
    const fresh = await f.integration.read("a", "public-source");
    assert.ok(fresh.erasedOffsets.length > 0);
    assert.ok(
      !JSON.stringify(fresh.data).includes(JSON.parse(original.text).text),
    );
    assert.equal(
      (await f.store.get("a", "signal", original.id)).state,
      "erased",
    );
  },
);

test(
  "invalid records are counted explicitly; oversized or null responses fail before being accepted, and read budget never prevents durable continuation",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, [null, 42, "", ...records(105)], {
      integrationReadsPerMinute: 1,
    });
    await f.integration.read("a", "public-source");
    const finished = await f.integration.continue("a", "public-source");
    assert.equal(finished.processing.total, 108);
    assert.equal(finished.processing.rejected, 3);
    assert.equal(finished.processing.acceptedVersions, 105);
    assert.equal(finished.processing.state, "registered_with_attention");
    assert.equal(
      (await f.store.get("a", "integration", "public-source")).state,
      "attention",
    );
    await assert.rejects(f.integration.read("a", "public-source"), {
      code: "CONNECTOR_READ_BUDGET",
      status: 429,
    });
    assert.equal(f.requests, 1);
    assert.equal(
      (await f.store.get("a", "integration_read_budget", "active")).used,
      1,
    );
    f.integration.config.integrationReadsPerMinute = 10;
    f.data = null;
    await assert.rejects(f.integration.read("a", "public-source"), {
      code: "CONNECTOR_SCHEMA",
    });
    assert.equal(
      (await f.store.get("a", "integration", "public-source")).error,
      "CONNECTOR_SCHEMA",
    );
    f.data = records(10001);
    await assert.rejects(f.integration.read("a", "public-source"), {
      code: "CONNECTOR_RECORD_LIMIT",
      status: 413,
    });
    f.data = [{ id: "giant", text: "x".repeat(8_000_001) }];
    await assert.rejects(f.integration.read("a", "public-source"), {
      code: "CONNECTOR_SIZE",
      status: 413,
    });
    assert.equal(await count(f.store, "signal"), 105);
    assert.equal(
      await count(f.store, "external"),
      1,
      "Rejected envelopes are never declared accepted batches",
    );
  },
);

test(
  "concurrent reads are lease bounded; concurrent pages never overwrite an unnotified durable page",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, records(205));
    let release, reached;
    const arrived = new Promise((resolve) => (reached = resolve));
    const blocked = new Promise((resolve) => (release = resolve));
    f.beforeResponse = async () => {
      reached();
      await blocked;
    };
    const reading = f.integration.read("a", "public-source");
    await arrived;
    assert.equal(
      (await f.integration.read("a", "public-source")).state,
      "pending_read",
    );
    release();
    await reading;
    assert.equal(f.requests, 1);
    f.integration.afterRead = async (rows) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      for (const row of rows)
        await f.store.enqueue(
          "a",
          "fixture-notified",
          { source: row.id },
          `notified_${row.id}_${row.sourceVersion}`,
        );
    };
    await Promise.all([
      f.integration.continue("a", "public-source"),
      f.integration.continue("a", "public-source"),
    ]);
    for (
      let i = 0;
      i < 3 && (await f.store.get("a", "integration", "public-source")).pending;
      i++
    )
      await f.integration.continue("a", "public-source");
    assert.equal(await count(f.store, "signal"), 205);
    assert.equal(await count(f.store, "source_version"), 205);
    assert.equal(await count(f.store, "intake"), 205);
    assert.equal(
      Number(
        (
          await f.store.query(
            "SELECT COUNT(*) AS n FROM jobs WHERE kind='fixture-notified'",
          )
        ).rows[0].n,
      ),
      105,
    );
    assert.equal(
      (await f.store.get("a", "integration", "public-source")).notifyPending,
      null,
    );
    assert.equal(f.requests, 1);
  },
);
