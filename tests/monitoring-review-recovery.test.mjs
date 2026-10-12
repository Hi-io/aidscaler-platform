import test from "node:test";
import assert from "node:assert/strict";
import { Store, hash } from "../src/store.mjs";
import { Worker } from "../src/worker.mjs";
import { Domain } from "../src/domain.mjs";

async function fixture(t) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  const actions = [{ type: "dispatch", owner: "org1", dependsOn: [],
    params: { resource: "water", vehicle: "truck", need: "request", quantity: 50 } }];
  await store.put("org0", "proposal", "response", {
    state: "authorized", actions, references: [], dependencies: [], conditions: [], simId: "source-plan",
    authorization: { by: "owner", expiresAt: Date.now() + 3600000, planHash: hash(actions) },
  }, 0);
  const source = { now: 1000, organization: { id: "org0" },
    proposals: [{ id: "source-plan", state: "authorized" }],
    operations: [], inspections: [], queries: [], known: { buildings: {} } };
  let requests = 0;
  const connector = { state: async () => source,
    action: async () => { throw new Error("This coordinator must not command partner stock"); } };
  const worker = new Worker({ store, config: { org: "org0" }, connector,
    network: { requestStep: async () => { requests++; return { id: "partner-request" }; } } });
  await worker.execute("response");
  const issued = await store.get("org0", "proposal", "response");
  const jobId = "continue_" + hash(["org0", issued.id]);
  connector.state = async () => { throw Object.assign(new Error("Observation transport unavailable"), { code: "SOURCE_DOWN" }); };
  for (let attempt = 1; attempt <= 5; attempt++) {
    await store.query("UPDATE jobs SET due_at=0,created_at=0 WHERE id=$1", [jobId]);
    assert.equal(await worker.once(), true);
  }
  connector.state = async () => source;
  const domain = new Domain(store, { peers: [{ org: "org1" }] });
  const actor = { id: "owner", name: "Response owner", role: "commander", org: "org0" };
  const job = async () => (await store.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0];
  return { store, worker, domain, actor, issued, job, jobId, requests: () => requests };
}

test("a new scoped human approval restores exhausted monitoring without sending another partner order", async (t) => {
  const f = await fixture(t), attention = await f.store.get("org0", "proposal", "response");
  assert.equal(attention.state, "requires_review");
  assert.equal((await f.job()).state, "failed");
  await f.store.enqueueContinuation("org0", "response", { due: 0 });
  assert.equal((await f.job()).state, "failed", "Evidence and polling alone cannot reopen an exhausted job");
  const reviewed = await f.domain.review(f.actor, attention.id,
    { decision: "approve", version: attention.version, note: "Owner confirms issued work remains valid; resume observation" }, "monitor-reapprove");
  assert.equal(reviewed.state, "authorized");
  assert.deepEqual(reviewed.executionResults, f.issued.executionResults);
  assert.deepEqual(reviewed.actions, f.issued.actions);
  assert.equal(reviewed.monitoringFailure.code, "SOURCE_DOWN", "Failure history remains visible");
  const resumed = await f.job();
  assert.equal(resumed.state, "queued");
  assert.equal(resumed.attempts, 0);
  assert.equal(resumed.lease_token, null);
  assert.equal(resumed.last_error, null);
  await f.worker.drain();
  assert.equal(f.requests(), 1);
  assert.equal((await f.store.get("org0", "proposal", "response")).state, "awaiting_partner");
  assert.equal((await f.job()).state, "queued");
  await f.store.upsert("org0", "proposal", "response", {
    executionResults: [{ ...f.issued.executionResults[0], state: "completed", partnerResult: {
      id: "partner-delivery", confirmedBySource: true, state: "received", quantity: 50, received: 50 } }],
  });
  await f.store.query("UPDATE jobs SET due_at=0,created_at=0 WHERE id=$1", [f.jobId]);
  await f.worker.drain();
  assert.equal((await f.store.get("org0", "proposal", "response")).state, "completed");
  assert.equal((await f.job()).state, "completed");
  assert.equal(f.requests(), 1);
  assert.equal((await f.store.query("SELECT COUNT(*) AS n FROM audit WHERE action='proposal.monitoring_resumed'")).rows[0].n, 1);
  await f.domain.review(f.actor, attention.id,
    { decision: "approve", version: attention.version, note: "Owner confirms issued work remains valid; resume observation" }, "monitor-reapprove");
  assert.equal((await f.job()).state, "completed", "An idempotent approval replay cannot reopen final monitoring");
});

test("an invalid role, stale version and nonapproval cannot reset exhausted monitoring", async (t) => {
  const f = await fixture(t), attention = await f.store.get("org0", "proposal", "response");
  await assert.rejects(f.domain.review({ ...f.actor, role: "agent" }, attention.id,
    { decision: "approve", version: attention.version }, "agent-reset"), { code: "ROLE" });
  await assert.rejects(f.domain.review(f.actor, attention.id,
    { decision: "approve", version: attention.version - 1 }, "stale-reset"), { code: "VERSION_CONFLICT" });
  await f.domain.review(f.actor, attention.id, { decision: "clarify", version: attention.version }, "clarify-reset");
  assert.equal((await f.job()).state, "failed");
  assert.equal((await f.job()).attempts, 5);
  assert.equal(f.requests(), 1);
  assert.equal((await f.store.query("SELECT COUNT(*) AS n FROM audit WHERE action='proposal.monitoring_resumed'")).rows[0].n, 0);
});

test("approval feasibility remains mandatory before an exhausted continuation can be recovered", async (t) => {
  const f = await fixture(t), attention = await f.store.get("org0", "proposal", "response");
  await f.store.upsert("org0", "proposal", attention.id, { actions: [{ ...attention.actions[0], owner: "org0" }] });
  const changed = await f.store.get("org0", "proposal", attention.id);
  await assert.rejects(f.domain.review(f.actor, changed.id,
    { decision: "approve", version: changed.version }, "invalid-capacity-reset"), { code: "NEED_ID" });
  assert.equal((await f.job()).state, "failed");
  assert.equal((await f.job()).attempts, 5);
  assert.equal((await f.store.get("org0", "proposal", attention.id)).state, "requires_review");
  assert.equal(f.requests(), 1);
});
