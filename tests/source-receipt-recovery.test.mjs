import test from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../evaluation/harness.mjs";

test(
  "a failed remote acceptance receipt resumes from durable exact source versions without reingesting or inferring",
  { timeout: 90000 },
  async (t) => {
    const h = await createHarness();
    t.after(() => h.close());
    const app = h.apps[0];
    h.lab.world.advance(60000);
    const base = app.connector.ackBatch.bind(app.connector);
    let refused = false,
      recovered = 0;
    app.connector.ackBatch = async (posts, stage) => {
      if (stage === "accepted" && posts.length && !refused) {
        refused = true;
        throw Object.assign(Error("Temporary source receipt outage"), {
          code: "SOURCE_TEMPORARY",
          status: 502,
        });
      }
      if (stage === "accepted" && posts.length && refused)
        recovered += posts.length;
      return base(posts, stage);
    };
    await app.ingestion.sync();
    const queued = (
      await app.store.query(
        "SELECT * FROM jobs WHERE org=$1 AND kind='source_accept' AND state='queued'",
        [app.config.org],
      )
    ).rows;
    assert.equal(queued.length, 1);
    assert.ok(queued[0].payload.versions.length > 0);
    const ref = queued[0].payload.versions[0],
      before = await app.store.get(app.config.org, "signal", ref.id);
    assert.ok(before);
    assert.equal(before.sourceVersion, ref.version);
    assert.equal(
      JSON.stringify(queued[0].payload).includes(before.text),
      false,
    );
    await app.worker.drain();
    const done = (
      await app.store.query("SELECT * FROM jobs WHERE id=$1", [queued[0].id])
    ).rows[0];
    assert.equal(done.state, "completed");
    assert.ok(done.result.accepted > 0);
    assert.ok(recovered > 0);
    assert.equal(
      (await app.store.get(app.config.org, "signal", ref.id)).version,
      before.version,
    );
    assert.equal(
      (await app.store.query("SELECT COUNT(*) AS n FROM usage")).rows[0].n,
      0,
    );
  },
);

test(
  "erasure between HTTP download and page commit cannot resurrect a source or its stored version",
  { timeout: 90000 },
  async (t) => {
    const h = await createHarness();
    t.after(() => h.close());
    const app = h.apps[0];
    h.lab.world.advance(60000);
    const base = app.connector.ackBatch.bind(app.connector);
    let erased = null;
    app.connector.ackBatch = async (posts, stage) => {
      if (stage === "downloaded" && posts.length && !erased) {
        erased = posts[0];
        await app.store.put(
          app.config.org,
          "erased_source",
          erased.id,
          {
            reason: "Authorized test erasure during download",
            versionWithdrawn: erased.version,
          },
          0,
        );
      }
      return base(posts, stage);
    };
    await app.ingestion.sync();
    assert.ok(erased);
    assert.equal(
      await app.store.get(app.config.org, "signal", erased.id, false),
      null,
    );
    assert.equal(
      await app.store.get(
        app.config.org,
        "source_version",
        `${erased.id}_${erased.version}`,
        false,
      ),
      null,
    );
  },
);
