import test from "node:test";
import assert from "node:assert/strict";
import { Store, hash } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { Investigator } from "../src/investigation.mjs";
import {
  effectiveNeed,
  recordResponseReceipt,
} from "../src/response-receipts.mjs";
import { responseQueue } from "../src/response-policy.mjs";

const org = "org0";
const need = {
  id: "need-shelter",
  type: "shelter",
  building: "pickup",
  quantity: 50,
  served: 0,
  at: 0,
  unit: "place",
  deadline: 3600000,
};
const source = (extra = {}) => ({
  id: "operation-first",
  type: "evacuation",
  org,
  vehicle: "bus",
  need: need.id,
  building: "shelter",
  quantity: 20,
  received: 20,
  state: "completed",
  times: { received: 1000, service: 1000 },
  observedAt: 1100,
  confirmedBySource: true,
  ...extra,
});

async function fixture(t, peer = false, received = 20) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization(org);
  await store.upsert(org, "response_policy", "active", {
    approved: true,
    order: "deadline_then_priority",
    protectedTypes: [],
    maxOpenReviews: 8,
  });
  await store.upsert(org, "need", need.id, need);
  const proposal = await store.upsert(org, "proposal", "serial-evacuations", {
    state: "executing",
    actions: [20, 20, 10].map((quantity, index) => ({
      type: "evacuate",
      owner: peer ? "org1" : org,
      params: { from: "pickup", to: "shelter", vehicle: "bus", quantity },
      dependsOn: index ? [index - 1] : [],
    })),
  });
  if (peer) {
    await recordResponseReceipt(
      store,
      org,
      "org1",
      proposal,
      0,
      "completed",
      source({ org: "org1", received }),
    );
    await recordResponseReceipt(
      store,
      org,
      "org1",
      proposal,
      1,
      "in_transit",
      source({
        id: "operation-second",
        org: "org1",
        state: "traveling",
        received: 0,
        times: { dispatched: 1200 },
        observedAt: 1300,
      }),
    );
  } else {
    await store.upsert(org, "operation", "operation-first", {
      ...source({ received }),
      proposalId: proposal.id,
      step: 0,
    });
    await store.upsert(org, "operation", "operation-second", {
      ...source(),
      id: "operation-second",
      state: "traveling",
      received: 0,
      times: { dispatched: 1200 },
      observedAt: 1300,
      proposalId: proposal.id,
      step: 1,
    });
  }
  const version = ["request", 1, "observed"];
  await store.upsert(org, "signal", "request", {
    text: "Families need shelter.",
    location: "pickup",
    sourceVersion: 1,
    state: "observed",
    publishedAt: 0,
  });
  await store.upsert(org, "context", "last_investigated_sources", {
    signature: hash([[version], []]),
    sourceVersions: [version],
    reportSignature: hash([]),
  });
  let calls = 0;
  const config = {
    org,
    peers: [],
    modelId: "recorded-evacuation-contract",
    maxCalls: 1,
  };
  const provider = {
    complete: async () => {
      calls++;
      return {
        usage: { providerCost: 0 },
        message: {
          role: "assistant",
          tool_calls: [
            {
              id: "preserve-request",
              type: "function",
              function: {
                name: "finish_without_proposal",
                arguments: JSON.stringify({
                  reason:
                    "Keep the new hazard available for independent verification.",
                }),
              },
            },
          ],
        },
      };
    },
  };
  const investigator = new Investigator({
    store,
    config,
    provider,
    domain: new Domain(store, config),
  });
  return { store, proposal, investigator, calls: () => calls };
}

for (const peer of [false, true])
  test(`${peer ? "peer" : "own"} physical evacuation receipts close a serial plan over a stale need without a paid poll`, async (t) => {
    const f = await fixture(t, peer);
    const queue = await responseQueue(f.store, org);
    assert.equal(queue.rows.length, 1);
    const row = queue.rows[0];
    assert.equal(row.served, 20);
    assert.equal(
      row.outstanding,
      10,
      "Twenty received and twenty in transit leave ten unmet places",
    );
    assert.equal(row.draftHeldQuantity, 10);
    assert.equal(row.planningOutstanding, 0);
    assert.deepEqual(row.pendingProposals, [f.proposal.id]);
    assert.equal(
      (await f.store.get(org, "need", need.id)).served,
      0,
      "The source snapshot is preserved; derived receipts are not written into it",
    );
    const waiting = await f.investigator.run({}, `serial-wait-${peer}`);
    assert.equal(waiting.state, "waiting_receipt");
    assert.equal(waiting.calls, 0);
    assert.equal(f.calls(), 0);
    await f.store.upsert(org, "signal", "request", {
      text: "The receiving shelter is now unsafe.",
      sourceVersion: 2,
    });
    await f.investigator.run({}, `changed-hazard-${peer}`);
    assert.equal(
      f.calls(),
      1,
      "New hazard remains available even while trips are assigned",
    );
  });

test("evacuation receipts use actual passengers, owner identity and physical time, not authorized quantity or late progress", async (t) => {
  const f = await fixture(t, true, 17);
  const first = source({ org: "org1", received: 17 });
  await recordResponseReceipt(
    f.store,
    org,
    "org1",
    f.proposal,
    0,
    "completed",
    first,
  );
  await recordResponseReceipt(
    f.store,
    org,
    "org1",
    f.proposal,
    0,
    "completed",
    { ...first, observedAt: 1400 },
  );
  const duplicate = {
    ...first,
    owner: "org1",
    sourceId: first.id,
    id: `owner-copy:${first.id}`,
  };
  const ops = await f.store.list(org, "operation");
  assert.equal(
    effectiveNeed(need, [...ops, duplicate]).served,
    17,
    "A receipt shown through two channels counts once by owner and source operation",
  );
  assert.equal(
    effectiveNeed(
      { ...need, sourceSnapshot: { ...need, served: 17, at: 1000 } },
      ops,
    ).served,
    17,
    "A newer need snapshot already includes service at its timestamp",
  );
  const stale = await recordResponseReceipt(
    f.store,
    org,
    "org1",
    f.proposal,
    0,
    "in_transit",
    { ...first, state: "traveling", received: 0, times: {}, observedAt: 1500 },
  );
  assert.equal(stale.stale, true);
  assert.equal(
    (await f.store.get(org, "operation", `peer:org1:${first.id}`)).received,
    17,
  );
  await assert.rejects(
    recordResponseReceipt(f.store, org, "org1", f.proposal, 0, "completed", {
      ...first,
      received: undefined,
    }),
    (e) => e.code === "PEER_RECEIPT",
  );
  await assert.rejects(
    recordResponseReceipt(f.store, org, "org1", f.proposal, 0, "completed", {
      ...first,
      building: "different-shelter",
    }),
    (e) => e.code === "PEER_RECEIPT",
  );
  assert.equal(
    effectiveNeed(need, [source({ received: undefined })]).served,
    0,
    "A completed boolean with no actual passenger receipt cannot assert service",
  );
});
