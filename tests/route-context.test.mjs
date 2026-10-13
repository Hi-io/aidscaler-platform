import test from "node:test";
import assert from "node:assert/strict";
import { routeContextEpisode, finiteSourceReviews, sufficientOwnedReceipt } from "../evaluation/route-context.mjs";

test("finite source reading uses parallel slots and free metadata deduplication, never a batch-wide barrier", () => {
  const jobs = finiteSourceReviews([
    { id: "a", text: "Current Pine access" },
    { id: "a-copy", repostOf: "a", text: "Current Pine access" },
    { id: "b", text: "Quarry is blocked" },
    { id: "c", text: "Market access" },
  ], 1000, 30000, 2);
  assert.deepEqual(jobs.map(j => [j.source.id, j.startedAt, j.availableAt]),
    [["a", 1000, 31000], ["b", 1000, 31000], ["c", 31000, 61000]]);
  assert.deepEqual(finiteSourceReviews(jobs.map(j => j.source), 1000, 0, 2).map(j => j.availableAt), [1000, 1000, 1000]);
});

test("controller completion requires a sufficient authentic receipt of the exact owned operation", () => {
  const scope = { owner: "org0", id: "original", quantity: 300 },
    receipt = { id: "original", org: "org0", confirmedBySource: true, state: "completed", received: 300, times: { service: 1234 } };
  assert.equal(sufficientOwnedReceipt(receipt, scope), true);
  for (const patch of [{ id: "other" }, { org: "org1" }, { confirmedBySource: false }, { state: "arrived" }, { received: 299 }, { times: { received: 1234 } }])
    assert.equal(sufficientOwnedReceipt({ ...receipt, ...patch }, scope), false, JSON.stringify(patch));
});

function recordedProvider({ general = false, historical = false } = {}) {
  let calls = 0,
    entity;
  return {
    calls: () => calls,
    complete: async ({ messages, task }) => {
      calls++;
      const input = JSON.parse(messages.find((m) => m.role === "user").content);
      const sources = input.sources ?? input.signals;
      const source = historical
        ? sources.find((s) => /Archive from last year/i.test(s.text))
        : sources.find((s) => /barrier was removed/i.test(s.text));
      entity ??= input.knownEntities.find(
        (e) => e.kind === "road" && source.text.includes(e.name),
      );
      assert.ok(
        entity,
        "Fixture resolves an exact entity only from the model's received named directory",
      );
      if (!general) {
        assert.equal(task, "perception");
        return {
          model: "recorded-contextual-road",
          usage: { providerCost: 0 },
          message: {
            content: JSON.stringify({
              observations: [
                {
                  text: source.text.slice(0, 600),
                  kind: "correction",
                  sourceIds: [source.reference],
                  entity: { kind: "road", id: entity.id },
                  location: null,
                  resourceType: "transport",
                  quantity: null,
                  timeStatus: historical ? "historical" : "current",
                },
              ],
            }),
          },
        };
      }
      assert.notEqual(task, "perception");
      const name =
        calls === 1 ? "verify" : calls === 2 ? "plan_repair" : "prepare_repair";
      return {
        model: "recorded-general-road",
        usage: { providerCost: 0 },
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "route-call-" + calls,
              type: "function",
              function: {
                name,
                arguments: JSON.stringify(
                  calls === 1
                    ? {
                        target: "road",
                        id: entity.id,
                        method: "clarification",
                        reason: "Check the current public access hypothesis",
                      }
                    : calls === 2
                      ? {}
                      : {
                          title: "Recover the checked existing cargo",
                          rationale:
                            "A current received road check supports rerouting the original owned vehicle",
                          benefit:
                            "Deliver the same water without allocating stock again",
                        },
                ),
              },
            },
          ],
        },
      };
    },
  };
}

for (const arm of ["B5", "B6", "B8", "B9"])
  test(
    `${arm}: public contextual access information can repair the same physical cargo before the official road bulletin`,
    { timeout: 120000 },
    async () => {
      const provider = recordedProvider({ general: arm === "B9" });
      const report = await routeContextEpisode({ arm, provider });
      assert.equal(
        report.status,
        "completed",
        JSON.stringify(report.error ?? report.errors),
      );
      assert.equal(report.after.delivered, 300);
      assert.equal(report.after.deliveryOperationCount, 1);
      assert.equal(report.after.operationId, report.before.operationId);
      assert.equal(report.after.stock, report.before.stock);
      assert.equal(report.after.previousProposalState, "repaired");
      assert.equal(report.after.beforeOfficialBulletin, true);
      assert.equal(report.after.receiptStopSatisfied, true);
      assert.equal(report.after.metrics.censored, false);
      assert.equal(report.candidateChanged, false);
      assert.equal(report.evaluatorChanged, false);
      assert.equal(report.simulatorChanged, false);
      assert.deepEqual(report.invariants, []);
      const received = report.after.funnel.verifications.filter(
        (v) => v.state === "completed",
      );
      assert.ok(received.length > 0);
      for (const v of received)
        assert.ok(
          v.receivedAtSourceClock >= v.sourceCompletedAt &&
            v.sourceCompletedAt >= v.requestedAt,
        );
      if (["B5", "B8"].includes(arm)) assert.equal(provider.calls(), 0);
      if (arm === "B6") assert.equal(provider.calls(), 1, "A pending check resumes its persisted perception without inference again");
      if (arm === "B5") {
        const attention = report.after.attention, lastReady = Math.max(...attention.map(j => j.availableAt));
        assert.ok(received.some(v => v.requestedAt < lastReady), "Useful checks start before every source finishes reading");
        assert.ok(received.every(v => attention.some(j => j.availableAt <= v.requestedAt)), "No source is interpreted before its reader slot completes");
      }
    },
  );

test(
  "a false reopening hypothesis never authorizes a reroute or marks the original cargo delivered",
  { timeout: 120000 },
  async () => {
    const provider = recordedProvider();
    const report = await routeContextEpisode({
      arm: "B6",
      provider,
      variant: "false_reopening",
    });
    assert.equal(report.status, "completed", JSON.stringify(report.error));
    assert.equal(report.after.delivered, 0);
    assert.deepEqual(report.after.repairProposalIds, []);
    assert.equal(report.after.loaded, 300);
    assert.equal(report.after.stock, report.before.stock);
    assert.equal(report.after.deliveryOperationCount, 1);
    assert.deepEqual(report.invariants, []);
    assert.equal(report.after.funnel.verifications[0].state, "completed");
  },
);
