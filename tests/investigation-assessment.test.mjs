import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Domain } from "../src/domain.mjs";
import { Investigator } from "../src/investigation.mjs";
import { ReplayProvider } from "../src/provider.mjs";

const message = (name, args) => ({ role: "assistant", tool_calls: [{
  id: name, type: "function", function: { name, arguments: JSON.stringify(args) },
}] });
async function fixture(t, { changeAfterPlan = false } = {}) {
  const store = await Store.open();
  t.after(() => store.close());
  await store.organization("org0");
  await store.upsert("org0", "source", "simulator", { simulatedAt: 2000 });
  await store.upsert("org0", "facility", "site", {
    use: "shelter", capacity: 100, sourceVersion: 7, node: "node-a",
    safe: false, dependencies: { water: 100 },
  });
  await store.upsert("org0", "resource", "staff", {
    owner: "org0", type: "staff", quantity: 2, floor: 0, reserved: 0,
    qualifications: ["field_assessment"],
  });
  await store.upsert("org0", "vehicle", "crew", {
    owner: "org0", state: "idle", node: "node-b", capacity: 100, seats: 1,
  });
  const replay = new ReplayProvider([
    message("plan_assessment", { building: "site" }),
    message("prepare_assessment", {
      title: "Assess the candidate shelter", rationale: "A qualified crew must inspect the current site.",
      benefit: "Receive a physical assessment before considering activation",
    }),
    message("finish_without_proposal", { reason: "The site changed; preserve uncertainty and request a fresh assessment." }),
  ]);
  let calls = 0;
  const provider = { complete: async (input) => {
    calls++;
    if (calls === 2 && changeAfterPlan)
      await store.upsert("org0", "facility", "site", { sourceVersion: 8 });
    return replay.complete(input);
  } };
  const config = { org: "org0", peers: [], modelId: "recorded-contract-fixture", maxCalls: 3 };
  let physicalActions = 0;
  const connector = { startModel: async () => ({ id: "timing" }), finishModel: async () => {},
    state: async () => ({}), action: async () => { physicalActions++; throw Error("Planning must not send a field team"); } };
  const investigator = new Investigator({ store, domain: new Domain(store, config), provider, connector, config });
  return { store, investigator, physicalActions: () => physicalActions };
}

test("investigator prepares a sourced field-assessment request without dispatching, certifying or activating", async (t) => {
  const f = await fixture(t);
  const activity = await f.investigator.run({ facilityId: "site" }, "assess-request");
  assert.equal(activity.state, "ready", JSON.stringify(activity.steps));
  const p = await f.store.get("org0", "proposal", activity.proposalId);
  assert.equal(p.state, "awaiting_review");
  assert.equal(p.authorization, null);
  assert.deepEqual(p.actions.map(a => a.type), ["verify"]);
  assert.equal(p.actions[0].params.method, "field");
  assert.equal(p.actions[0].params.purpose, "facility_safety");
  assert.equal(p.actions[0].params.targetVersion, 7);
  assert.equal(f.physicalActions(), 0);
  assert.equal((await f.store.list("org0", "verification")).length, 0);
  assert.equal((await f.store.list("org0", "operation")).length, 0);
  assert.deepEqual(p.references.sort(), ["crew", "site", "staff"]);
});

test("site changes between model planning and preparation invalidate its assessment draft", async (t) => {
  const f = await fixture(t, { changeAfterPlan: true });
  const activity = await f.investigator.run({ facilityId: "site" }, "assess-changed");
  assert.equal(activity.state, "inconclusive");
  assert.ok(activity.steps.some(s => s.result?.error === "ASSESSMENT_CHANGED"), JSON.stringify(activity.steps));
  assert.equal((await f.store.list("org0", "proposal")).length, 0);
  assert.equal(f.physicalActions(), 0);
});
