import test from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../evaluation/harness.mjs";
import { ReplayProvider } from "../src/provider.mjs";
const tool = (name, args) => ({ role: "assistant", tool_calls: [{ id: name + args.target, type: "function",
  function: { name, arguments: JSON.stringify(args) } }] });

test("investigator reads delayed actor-scoped communication and published bulletins without other teams' connectivity", async t => {
  const provider = new ReplayProvider([
    tool("lookup", { target: "communication" }),
    tool("lookup", { target: "bulletins" }),
    tool("finish_without_proposal", { reason: "Communication information remains observational; no dispatch authority was granted." }),
  ]);
  const h = await createHarness({ provider }), app = h.apps[0];
  t.after(() => h.close());
  h.lab.world.advance(60000);
  h.lab.world.state.observations.org0.lastContact = { ownContact: 123 };
  h.lab.world.state.observations.org1.lastContact = { privatePeerContact: 456 };
  h.lab.world.state.bulletins.push({ id: "issued", availableAt: h.lab.world.now, text: "Published operational bulletin" },
    { id: "not-yet-issued", availableAt: h.lab.world.config.durationMs + 1, text: "Hidden future bulletin" });
  const activity = await app.investigator.run({}, "communication-contract");
  assert.equal(activity.state, "inconclusive", JSON.stringify(activity.steps));
  const queries = await app.store.list("org0", "query", 20);
  const communication = queries.find(q => q.target === "communication"), bulletins = queries.find(q => q.target === "bulletins");
  assert.ok(communication, JSON.stringify(activity.steps));
  assert.equal(communication.state, "ready");
  assert.deepEqual(communication.result.lastContact, { ownContact: 123 });
  assert.ok(communication.sourceCompletedAt >= communication.sourceCreatedAt + h.lab.world.config.queryLatencyMs);
  assert.equal(JSON.stringify(communication).includes("privatePeerContact"), false);
  assert.equal(JSON.stringify(communication).includes("sectors"), false);
  assert.equal(bulletins.result.some(b => b.id === "issued"), true);
  assert.equal(bulletins.result.some(b => b.id === "not-yet-issued"), false);
  assert.equal((await app.store.list("org0", "proposal", 20)).length, 0);
});
