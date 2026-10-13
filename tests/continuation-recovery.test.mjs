import test from "node:test";
import assert from "node:assert/strict";
import { Store, hash } from "../src/store.mjs";
import { Worker } from "../src/worker.mjs";

async function fixture(t) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  const actions = [
    {
      type: "dispatch",
      owner: "org0",
      params: {
        need: "water",
        resource: "stock",
        vehicle: "truck",
        quantity: 50,
      },
      dependsOn: [],
    },
  ];
  await store.put(
    "org0",
    "proposal",
    "response",
    {
      state: "authorized",
      actions,
      references: [],
      conditions: [],
      simId: "source-plan",
      authorization: {
        by: "owner",
        expiresAt: Date.now() + 3600000,
        planHash: hash(actions),
      },
    },
    0,
  );
  const source = {
    now: 1000,
    organization: { id: "org0" },
    proposals: [
      {
        id: "source-plan",
        state: "authorized",
        plan: { actions: structuredClone(actions) },
      },
    ],
    operations: [],
    known: { buildings: {} },
    inspections: [],
  };
  let commands = 0;
  const connector = {
    state: async () => source,
    action: async (type) => {
      assert.equal(type, "dispatch");
      commands++;
      source.operations.push({
        id: "delivery",
        state: "loading",
        quantity: 50,
        received: 0,
      });
      return { id: "delivery", state: "loading" };
    },
  };
  const worker = () =>
    new Worker({ store, config: { org: "org0" }, connector });
  const jobs = async () =>
    (await store.query("SELECT * FROM jobs WHERE kind='continue_proposal'"))
      .rows;
  const ready = async (id) =>
    store.query("UPDATE jobs SET due_at=0,created_at=0 WHERE id=$1", [id]);
  return { store, source, worker, jobs, ready, commands: () => commands };
}

test("twenty direct progress polls preserve one continuation and issue physical work once", async (t) => {
  const f = await fixture(t),
    worker = f.worker();
  for (let i = 0; i < 20; i++) {
    f.source.now += 1000;
    assert.equal((await worker.execute("response")).complete, false);
  }
  const jobs = await f.jobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].state, "queued");
  assert.equal(f.commands(), 1);
  assert.equal(f.source.operations.length, 1);
  assert.equal(
    (await f.store.get("org0", "proposal", "response")).executionResults.length,
    1,
  );
});

test("successful polling rearms the same lease, survives a new worker and finishes on physical receipt", async (t) => {
  const f = await fixture(t);
  await f.worker().execute("response");
  const id = (await f.jobs())[0].id;
  await f.ready(id);
  assert.equal(await f.worker().once(), true);
  let job = (await f.jobs())[0];
  assert.equal(job.id, id);
  assert.equal(job.state, "queued");
  assert.equal(job.attempts, 0);
  assert.equal(job.lease_token, null);
  assert.equal(job.result.complete, false);
  assert.ok(Number(job.due_at) > Date.now() - 1000);
  assert.equal((await f.worker().drain()).processed, 0);
  f.source.operations[0].state = "received";
  f.source.operations[0].received = 50;
  await f.ready(id);
  assert.equal(await f.worker().once(), true);
  job = (await f.jobs())[0];
  assert.equal(job.state, "completed");
  assert.equal(job.result.complete, true);
  assert.equal(
    (await f.store.get("org0", "proposal", "response")).state,
    "completed",
  );
  assert.equal((await f.worker().drain()).processed, 0);
  assert.equal(f.commands(), 1);
  assert.equal(f.source.operations[0].received, 50);
});

test("enqueue and terminal observations cannot steal a running lease; stale rescheduling is fenced", async (t) => {
  const f = await fixture(t);
  const id = await f.store.enqueueContinuation("org0", "response", { due: 0 });
  const first = await f.store.lease("org0");
  for (let i = 0; i < 20; i++)
    await f.store.enqueueContinuation("org0", "response", { due: 0 });
  await f.store.completeContinuation("org0", "response", { complete: true });
  let job = (await f.jobs())[0];
  assert.equal(job.state, "running");
  assert.equal(job.lease_token, first.lease_token);
  await f.store.query("UPDATE jobs SET leased_until=0 WHERE id=$1", [id]);
  const reclaimed = await f.store.lease("org0");
  assert.notEqual(reclaimed.lease_token, first.lease_token);
  await assert.rejects(f.store.rescheduleJob(first), {
    code: "JOB_LEASE_LOST",
  });
  job = (await f.jobs())[0];
  assert.equal(job.lease_token, reclaimed.lease_token);
  await f.store.rescheduleJob(reclaimed, { result: { complete: false } });
  assert.equal((await f.jobs())[0].state, "queued");
});

test("coalescing preserves retry backoff and stops after five actual failures", async (t) => {
  const f = await fixture(t);
  const id = await f.store.enqueueContinuation("org0", "response", { due: 0 });
  for (let attempt = 1; attempt <= 5; attempt++) {
    await f.ready(id);
    const lease = await f.store.lease("org0");
    assert.equal(lease.attempts, attempt);
    await f.store.failJob(
      lease,
      Object.assign(new Error("Source temporarily unavailable"), {
        code: "SOURCE_DOWN",
      }),
    );
    const before = (await f.jobs())[0];
    for (let i = 0; i < 20; i++)
      await f.store.enqueueContinuation("org0", "response", { due: 0 });
    const after = (await f.jobs())[0];
    assert.equal(after.attempts, attempt);
    assert.equal(after.due_at, before.due_at);
    assert.equal(after.state, attempt === 5 ? "failed" : "retry");
    assert.match(after.last_error, /SOURCE_DOWN/);
  }
  assert.equal((await f.jobs()).length, 1);
  assert.equal(await f.store.lease("org0"), null);
});

test("a terminal source observation cancels queued continuation without repeating cargo", async (t) => {
  const f = await fixture(t),
    worker = f.worker();
  await worker.execute("response");
  f.source.operations[0].state = "blocked";
  assert.equal((await worker.execute("response")).requiresReview, true);
  assert.equal((await f.jobs())[0].state, "completed");
  assert.equal((await f.worker().drain()).processed, 0);
  assert.equal(
    (await f.store.get("org0", "proposal", "response")).authorization,
    null,
  );
  assert.equal(f.source.operations[0].quantity, 50);
  assert.equal(f.commands(), 1);
});

test("continuations are organization scoped and completed records revive only explicitly", async (t) => {
  const f = await fixture(t);
  await f.store.organization("org1");
  const one = await f.store.enqueueContinuation("org0", "response", { due: 0 });
  const two = await f.store.enqueueContinuation("org1", "response", { due: 0 });
  assert.notEqual(one, two);
  await f.store.completeContinuation("org0", "response", { complete: true });
  await f.store.enqueueContinuation("org0", "response", { revive: false });
  assert.equal((await f.jobs()).find((j) => j.id === one).state, "completed");
  await f.store.enqueueContinuation("org0", "response", { revive: true });
  assert.equal((await f.jobs()).find((j) => j.id === one).state, "queued");
  assert.equal((await f.jobs()).find((j) => j.id === two).state, "queued");
});

test("five source monitoring errors expose owner review without losing issued cargo or resending commands", async (t) => {
  const f = await fixture(t),
    worker = f.worker();
  await worker.execute("response");
  const original = await f.store.get("org0", "proposal", "response"),
    id = (await f.jobs())[0].id;
  worker.connector.state = async () => {
    throw Object.assign(new Error("Owner source unavailable"), {
      code: "SOURCE_DOWN",
    });
  };
  for (let attempt = 1; attempt <= 5; attempt++) {
    await f.ready(id);
    assert.equal(await worker.once(), true);
    const row = await f.store.get("org0", "proposal", "response");
    assert.equal(row.state, attempt < 5 ? "executing" : "requires_review");
    assert.deepEqual(row.executionResults, original.executionResults);
    assert.deepEqual(row.actions, original.actions);
  }
  const attention = await f.store.get("org0", "proposal", "response");
  assert.equal(attention.authorization, null);
  assert.deepEqual(attention.previousAuthorization, original.authorization);
  assert.equal(attention.monitoringFailure.code, "SOURCE_DOWN");
  assert.equal(attention.monitoringFailure.attempts, 5);
  assert.equal(attention.monitoringFailure.physicalStatus, "unconfirmed");
  assert.equal(attention.monitoringFailure.issuedWorkPreserved, true);
  assert.equal((await f.jobs())[0].state, "failed");
  assert.equal((await worker.drain()).processed, 0);
  assert.equal((await worker.execute("response")).skipped, true);
  assert.equal(f.commands(), 1);
  assert.equal(f.source.operations[0].quantity, 50);
  assert.equal(f.source.operations[0].state, "loading");
  assert.equal(
    (
      await f.store.query(
        "SELECT COUNT(*) AS n FROM audit WHERE action='proposal.monitoring_exhausted'",
      )
    ).rows[0].n,
    1,
  );
});

test("an exhausted obsolete worker cannot mutate owner attention after its lease is reclaimed", async (t) => {
  const f = await fixture(t),
    worker = f.worker();
  await worker.execute("response");
  const id = (await f.jobs())[0].id,
    original = await f.store.get("org0", "proposal", "response");
  await f.ready(id);
  await f.store.query("UPDATE jobs SET attempts=4 WHERE id=$1", [id]);
  let reclaimed;
  worker.connector.state = async () => {
    await f.store.query("UPDATE jobs SET leased_until=0 WHERE id=$1", [id]);
    reclaimed = await f.store.lease("org0");
    throw Object.assign(new Error("An obsolete source poll failed"), {
      code: "SOURCE_DOWN",
    });
  };
  assert.equal(await worker.once(), true);
  const after = await f.store.get("org0", "proposal", "response"),
    job = (await f.jobs())[0];
  assert.equal(after.state, "executing");
  assert.deepEqual(after.authorization, original.authorization);
  assert.deepEqual(after.executionResults, original.executionResults);
  assert.equal(after.monitoringFailure, undefined);
  assert.equal(job.state, "running");
  assert.equal(job.lease_token, reclaimed.lease_token);
  assert.equal(
    (
      await f.store.query(
        "SELECT COUNT(*) AS n FROM audit WHERE action='proposal.monitoring_exhausted'",
      )
    ).rows[0].n,
    0,
  );
  await f.store.finishJob(
    reclaimed.id,
    { recovered: true },
    reclaimed.lease_token,
  );
});
