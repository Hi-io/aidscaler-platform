import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Network } from "../src/network.mjs";

const proposal = {
  id: "owner-work",
  originPartner: "org0",
  originProposal: "collective",
  originStep: 2,
  version: 3,
  actions: [
    {
      owner: "org1",
      type: "dispatch",
      params: { resource: "r", vehicle: "v", need: "n", quantity: 100 },
      dependsOn: [],
    },
  ],
  authorization: {
    by: "owner-1",
    at: 10,
    expiresAt: 100000,
    planHash: "approved-scope",
  },
};
const operation = {
  id: "physical-1",
  org: "org1",
  type: "delivery",
  need: "n",
  vehicle: "v",
  resource: "r",
  quantity: 100,
  received: 0,
  unit: "L",
  state: "en_route",
  times: { requested: 10, departed: 20 },
  observedAt: 30,
  confirmedBySource: true,
};
async function setup(t) {
  const store = await Store.open();
  await store.organization("org1");
  t.after(() => store.close());
  return {
    store,
    network: new Network(store, { org: "org1", peers: [] }),
    jobs: async () =>
      (
        await store.query(
          "SELECT * FROM jobs WHERE org='org1' AND kind='peer_send' ORDER BY created_at,id",
        )
      ).rows,
  };
}

test("repeated source polls retain one durable status receipt, then exactly one physical completion", async (t) => {
  const { store, network, jobs } = await setup(t);
  for (let i = 0; i < 20; i++)
    await network.response(
      { ...proposal, version: proposal.version + i },
      "in_transit",
      { ...operation, observedAt: 30 + i },
    );
  let rows = await jobs();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.message.projection.operation.observedAt, 30);
  assert.equal(rows[0].payload.message.version, proposal.version);
  await store.query("UPDATE jobs SET state='completed' WHERE id=$1", [
    rows[0].id,
  ]);
  await network.response({ ...proposal, version: 99 }, "in_transit", {
    ...operation,
    observedAt: 100,
  });
  assert.equal(
    (await jobs()).length,
    1,
    "completed receipt is not recreated by a poll",
  );
  const terminal = {
    ...operation,
    received: 100,
    state: "received",
    times: { ...operation.times, received: 110, service: 110 },
    observedAt: 110,
  };
  await network.response({ ...proposal, version: 100 }, "completed", terminal);
  await network.response({ ...proposal, version: 101 }, "completed", {
    ...terminal,
    observedAt: 120,
  });
  rows = await jobs();
  assert.equal(rows.length, 2);
  const receipt = rows.find(
    (r) => r.payload.message.projection.state === "completed",
  );
  assert.equal(receipt.payload.message.projection.operation.received, 100);
  assert.equal(receipt.payload.message.projection.operation.times.service, 110);
  assert.equal(receipt.payload.message.projection.operation.observedAt, 110);
});

test("physical progress, source times, scope and renewed authority remain distinct receipt events", async (t) => {
  const { network, jobs } = await setup(t);
  await network.response(proposal, "in_transit", operation);
  for (const changed of [
    {
      ...operation,
      state: "unloading",
      times: { ...operation.times, arrived: 40 },
    },
    {
      ...operation,
      received: 50,
      times: { ...operation.times, service: 50 },
      observedAt: 50,
    },
    { ...operation, times: { ...operation.times, departed: 25 } },
  ])
    await network.response(proposal, "in_transit", changed);
  await network.response(
    { ...proposal, authorization: { ...proposal.authorization, at: 11 } },
    "in_transit",
    operation,
  );
  await network.response(
    {
      ...proposal,
      authorization: { ...proposal.authorization, delegationVersion: 2 },
    },
    "in_transit",
    operation,
  );
  await network.response(
    {
      ...proposal,
      authorization: {
        ...proposal.authorization,
        evidenceHash: "corrected-source",
      },
    },
    "in_transit",
    operation,
  );
  await network.response(
    {
      ...proposal,
      actions: [
        {
          ...proposal.actions[0],
          params: { ...proposal.actions[0].params, quantity: 90 },
        },
      ],
    },
    "in_transit",
    operation,
  );
  assert.equal((await jobs()).length, 8);
});

test("a delayed dispatch snapshot or activation poll does not manufacture another source event", async (t) => {
  const { network, jobs } = await setup(t);
  for (const type of ["dispatch", "activate"]) {
    const scope = {
      ...proposal,
      id: "pending-" + type,
      actions: [{ ...proposal.actions[0], type }],
    };
    for (let i = 0; i < 20; i++)
      await network.response(scope, "in_transit", {
        id: "source-" + type,
        type,
        org: "org1",
        state: "pending",
        confirmedBySource: false,
        observedAt: 30 + i,
      });
  }
  assert.equal((await jobs()).length, 2);
});

test("assessment observation, validity, version and qualified source evidence are never removed from identity", async (t) => {
  const { network, jobs } = await setup(t);
  const assessmentProposal = {
    ...proposal,
    actions: [
      {
        owner: "org1",
        type: "verify",
        params: { target: "building", id: "shelter", method: "field" },
        dependsOn: [],
      },
    ],
  };
  const source = {
    id: "assessment-1",
    target: "building",
    entity: "shelter",
    org: "org1",
    method: "field",
    purpose: "facility_safety",
    state: "completed",
    observedAt: 100,
    completedAt: 105,
    confirmedBySource: true,
    result: {
      safe: true,
      version: 2,
      assessment: {
        observedAt: 100,
        validUntil: 1000,
        targetVersion: 2,
        qualifications: ["field_assessment"],
      },
    },
  };
  await network.response(assessmentProposal, "completed", source);
  for (const changed of [
    { ...source, observedAt: 101 },
    { ...source, completedAt: 106 },
    {
      ...source,
      result: {
        ...source.result,
        assessment: { ...source.result.assessment, validUntil: 900 },
      },
    },
    {
      ...source,
      result: {
        ...source.result,
        version: 3,
        assessment: { ...source.result.assessment, targetVersion: 3 },
      },
    },
  ])
    await network.response(assessmentProposal, "completed", changed);
  assert.equal((await jobs()).length, 5);
});
