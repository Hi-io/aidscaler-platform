import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Intake } from "../src/intake.mjs";
import { OpenRouterProvider } from "../src/provider.mjs";
import { Investigator } from "../src/investigation.mjs";
const org = "org0";
test("automatic source batching coalesces routine posts but urgent hints are checked promptly", async t => {
  const s=await setup(t), intake=new Intake(s,{org,autoInvestigate:true,autoBatchWaitMs:15000,autoBatchMinSignals:8});
  await intake.stage(org,{id:"routine",text:"Thinking of the response team",group:"routine",sourceVersion:1});
  assert.equal((await intake.kick()).batching,true);
  assert.equal(Number((await s.query("SELECT COUNT(*) AS n FROM jobs")).rows[0].n),0);
  await intake.stage(org,{id:"urgent",text:"Urgent: people trapped",group:"urgent",sourceVersion:1});
  assert.equal((await intake.kick()).queued,true);
});
async function setup(t) {
  const s = await Store.open();
  await s.organization(org);
  t.after(() => s.close());
  return s;
}

test("discovery automation batches distinct source groups without thirty-five separate model jobs", async t => {
  const s = await setup(t), intake = new Intake(s, { org, autoInvestigate: true, modelId: "fixture" });
  await intake.configure({ org, id: "owner", role: "commander" }, { enabled: true, discoveryMode: true }, "discover-mode");
  for (let i = 0; i < 40; i++) await intake.stage(org, { id: "post-" + i, sourceVersion: 1, group: "origin-" + i });
  const first = await intake.kick();
  assert.equal(first.signals, 35);
  assert.equal(first.groups, 35);
  const job = (await s.query("SELECT * FROM jobs WHERE id=$1", [first.id])).rows[0];
  assert.equal(job.kind, "discover_response");
  assert.equal(job.payload.ids.length, 35);
  assert.equal((await intake.kick()).busy, true);
  await s.finishJob(first.id, {});
  await intake.complete(job.payload, { state: "inconclusive" });
  assert.equal((await intake.kick()).signals, 5);
});
test("automatic intake consumes bounded batches without claiming unseen source versions were interpreted", async (t) => {
  const s = await setup(t),
    intake = new Intake(s, { org, autoInvestigate: true, modelId: "fixture" });
  for (let i = 0; i < 40; i++)
    await intake.stage(org, {
      id: "p" + i,
      sourceVersion: 1,
      group: "lineage",
      location: "n0",
    });
  const first = await intake.kick();
  assert.equal(first.signals, 35);
  assert.equal((await intake.kick()).busy, true);
  const job = (await s.query("SELECT * FROM jobs WHERE id=$1", [first.id]))
    .rows[0];
  await s.finishJob(job.id, {});
  await intake.complete(job.payload, { state: "inconclusive" });
  const row = await s.get(org, "intake", "group_lineage");
  assert.equal(Object.keys(row.processed).length, 35);
  assert.equal(row.state, "pending");
  const second = await intake.kick();
  assert.equal(second.signals, 5);
  const next = (await s.query("SELECT * FROM jobs WHERE id=$1", [second.id]))
    .rows[0];
  await s.finishJob(next.id, {});
  await intake.complete(next.payload, { state: "ready" });
  assert.equal((await intake.summary()).counts.investigated, 1);
  await intake.stage(org, { id: "p0", sourceVersion: 2, group: "lineage" });
  assert.equal((await s.get(org, "intake", "group_lineage")).state, "pending");
  assert.equal((await intake.kick()).signals, 1);
});
test("material changes during an inquiry remain pending; pause and hourly budget prevent new work", async (t) => {
  const s = await setup(t),
    intake = new Intake(s, {
      org,
      autoInvestigate: true,
      hourlyCallLimit: 1,
      hourlyBudgetUsd: 0.1,
    });
  await intake.stage(org, { id: "p", sourceVersion: 1, group: "g" });
  const first = await intake.kick(),
    job = (await s.query("SELECT * FROM jobs WHERE id=$1", [first.id])).rows[0];
  await intake.stage(org, { id: "p", sourceVersion: 2, group: "g" });
  await s.finishJob(job.id, {});
  await intake.complete(job.payload, { state: "ready" });
  assert.equal((await s.get(org, "intake", "group_g")).state, "pending");
  await intake.configure(
    { org, id: "owner", role: "commander" },
    { enabled: false },
    "pause",
  );
  assert.equal((await intake.kick()).paused, true);
  await intake.configure(
    { org, id: "owner", role: "commander" },
    { enabled: true },
    "resume",
  );
  await s.query(
    "INSERT INTO usage(id,org,episode,model,request_hash,state,started_at,reserved_usd) VALUES('spent',$1,'fixture','fixture','hash','failed',$2,.2)",
    [org, Date.now()],
  );
  assert.equal((await intake.kick()).limited, true);
});
test("unknown provider cost retains a conservative reservation in the hourly gate", async (t) => {
  const s = await setup(t);
  await s.query(
    "INSERT INTO usage(id,org,episode,model,request_hash,state,started_at,reserved_usd) VALUES('spent',$1,'fixture','fixture','hash','failed',$2,.2)",
    [org, Date.now()],
  );
  let calls = 0;
  const provider = new OpenRouterProvider(
    s,
    {
      apiKey: "local-fixture-key",
      modelId: "fixture",
      budgetUsd: 1,
      maxCalls: 8,
      hourlyBudgetUsd: 0.1,
      hourlyCallLimit: 40,
    },
    async () => {
      calls++;
      throw Error("must not contact provider");
    },
  );
  provider.pricing = { rates: { prompt: 0, completion: 0 } };
  await assert.rejects(
    () => provider.complete({ org, episode: "next", messages: [] }),
    (e) => e.code === "ORGANIZATION_MODEL_BUDGET",
  );
  assert.equal(calls, 0);
});
test("a queued operator stop is preserved and prevents model or tool calls", async (t) => {
  const s = await setup(t);
  await s.put(
    org,
    "activity",
    "stop",
    { state: "queued", cancelRequested: true },
    0,
  );
  let calls = 0;
  const investigator = new Investigator({
    store: s,
    config: { org, modelId: "fixture", maxCalls: 8 },
    provider: {
      complete: async () => {
        calls++;
        throw Error("must not call");
      },
    },
  });
  const result = await investigator.run({}, "stop");
  assert.equal(result.state, "cancelled");
  assert.equal(calls, 0);
  assert.equal(result.proposalId, null);
});
test("targeted intake can investigate an older signal outside the latest 500; deleting one copy preserves other reports", async (t) => {
  const s = await setup(t);
  for (let i = 0; i < 520; i++)
    await s.put(
      org,
      "signal",
      "s" + i,
      {
        text: "Source " + i,
        sourceVersion: 1,
        attachments: [],
        originalReferences: [],
      },
      0,
    );
  let seen;
  const investigator = new Investigator({
    store: s,
    domain: {},
    config: { org, modelId: "fixture", maxCalls: 1 },
    connector: {
      startModel: async () => ({ id: "m" }),
      finishModel: async () => {},
      ack: async () => {},
    },
    provider: {
      complete: async ({ messages }) => {
        seen = JSON.parse(messages[1].content).signals;
        return {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "finish",
                function: {
                  name: "finish_without_proposal",
                  arguments: '{"reason":"Evidence incomplete"}',
                },
              },
            ],
          },
          usage: {},
        };
      },
    },
  });
  await investigator.run({ ids: ["s0"] }, "target-old");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, "s0");
  const intake = new Intake(s, { org });
  await intake.stage(org, {
    id: "original",
    group: "copies",
    sourceVersion: 1,
  });
  await intake.stage(org, { id: "copy", group: "copies", sourceVersion: 1 });
  await intake.stage(org, {
    id: "copy",
    group: "copies",
    sourceVersion: 2,
    deleted: true,
  });
  assert.equal((await s.get(org, "intake", "group_copies")).state, "pending");
});
