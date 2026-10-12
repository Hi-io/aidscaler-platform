import test from "node:test";
import assert from "node:assert/strict";
import { blockedRepairEpisode } from "../evaluation/blocked-repair.mjs";

test(
  "the source accepts a newly reviewed reroute and completes the same loaded trip without another stock allocation",
  { timeout: 120000 },
  async () => {
    let calls = 0,
      input;
    const provider = {
      complete: async ({ messages }) => {
        input ??= JSON.parse(messages.find((m) => m.role === "user").content);
        calls++;
        const tool =
          calls === 1
            ? {
                name: "read_action_contract",
                arguments: JSON.stringify({ types: ["reroute"] }),
              }
            : {
                name: "draft_response",
                arguments: JSON.stringify({
                  title: "Resume the loaded delivery with a new route",
                  summary:
                    "Preserve its cargo and destination; do not dispatch again.",
                  rationale:
                    "A received blocked-operation report and current road observations support resuming the same physical work.",
                  benefit: "Complete the existing 300 L shipment",
                  references: ["need-water-main"],
                  conditions: [],
                  actions: [
                    {
                      type: "reroute",
                      owner: "org0",
                      params: { vehicle: "v-org0-0", destination: "n13" },
                      dependsOn: [],
                    },
                  ],
                }),
              };
        return {
          model: "recorded-reroute-contract",
          usage: { providerCost: 0 },
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "repair-call-" + calls, type: "function", function: tool },
            ],
          },
        };
      },
    };
    const report = await blockedRepairEpisode({ provider });
    assert.equal(report.status, "completed", JSON.stringify(report.error));
    assert.equal(calls, 2);
    assert.equal(report.after.delivered, 300);
    assert.equal(report.after.deliveryOperationCount, 1);
    assert.equal(report.after.stock, report.before.stock);
    assert.equal(report.after.proposalState, "completed");
    assert.equal(report.after.rerouteReceived, true);
    assert.equal(report.invariants.length, 0);
    assert.equal(report.after.previousProposalState, "repaired");
  },
);

test(
  "the received-data repair compiler recovers the original trip without a model transcribing physical IDs",
  { timeout: 120000 },
  async () => {
    let calls = 0;
    const provider = {
      complete: async () => {
        calls++;
        const name = calls === 1 ? "plan_repair" : "prepare_repair";
        return {
          model: "recorded-repair-tool-contract",
          usage: { providerCost: 0 },
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "compiled-repair-" + calls,
                type: "function",
                function: {
                  name,
                  arguments: JSON.stringify(
                    calls === 1
                      ? {}
                      : {
                          title: "Recover the same loaded trip",
                          rationale:
                            "Current owner-received road and operation evidence supports resuming this shipment.",
                          benefit:
                            "Deliver the original 300 L without drawing another allocation",
                        },
                  ),
                },
              },
            ],
          },
        };
      },
    };
    const report = await blockedRepairEpisode({ provider });
    assert.equal(report.status, "completed", JSON.stringify(report.error));
    assert.equal(calls, 2);
    assert.equal(report.after.operationId, report.before.operationId);
    assert.equal(report.after.delivered, 300);
    assert.equal(report.after.deliveryOperationCount, 1);
    assert.equal(report.after.stock, report.before.stock);
    assert.equal(report.after.previousProposalState, "repaired");
    assert.equal(report.invariants.length, 0);
  },
);
