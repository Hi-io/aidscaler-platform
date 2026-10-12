import test from "node:test";
import assert from "node:assert/strict";
import { runDiscoveryEpisode } from "../evaluation/discovery-benchmark.mjs";

test(
  "the general-agent reference reads raw received posts, chooses normal verification tools and obtains owner-reviewed physical service without semantic preprocessing",
  { timeout: 120000 },
  async () => {
    let calls = 0,
      sourceLocation = null;
    const requests = [];
    const provider = {
      complete: async (request) => {
        calls++;
        requests.push(request);
        assert.notEqual(request.task, "perception");
        assert.match(
          request.messages[0].content,
          /experienced disaster-response planner/,
        );
        const input = JSON.parse(
          request.messages.find((m) => m.role === "user").content,
        );
        assert.equal(input.focusMode, "manual");
        assert.equal(input.organization, "org0");
        assert.equal(input.responsePolicy.approved, true);
        assert.ok(
          input.signals.some((s) =>
            s.text.includes("ten-litre water containers"),
          ),
        );
        assert.doesNotMatch(
          JSON.stringify(input),
          /"(?:gold|responseBenchmark|truthCategory|scorerOnlyPhysical)"/,
        );
        for (const tool of [
          "read_context",
          "lookup",
          "verify",
          "plan_allocations",
          "prepare_allocation",
          "plan_service",
          "compare_responses",
        ])
          assert.ok(
            request.tools.some((t) => t.function.name === tool),
            tool + " remains available",
          );
        sourceLocation ??= input.signals
          .find((s) => s.text.includes("ten-litre water containers"))
          .text.match(/\bb\d+\b/)[0];
        const tool =
          calls === 1
            ? {
                name: "verify",
                arguments: JSON.stringify({
                  target: "building",
                  id: sourceLocation,
                  method: "clarification",
                }),
              }
            : calls <= 6
              ? {
                  name: "lookup",
                  arguments: JSON.stringify({
                    target: [
                      "inventory",
                      "vehicles",
                      "roads",
                      "policy",
                      "sources",
                    ][calls - 2],
                  }),
                }
              : calls === 7
                ? {
                    name: "plan_allocations",
                    arguments: "{}",
                  }
                : {
                    name: "prepare_allocation",
                    arguments: JSON.stringify({
                      indices: [0],
                      title: "Reviewed aid for the observed water shortfall",
                      benefit:
                        "Deliver the currently observed outstanding drinking water",
                      rationale:
                        "The public post supplied a lead. The source confirmation and checked allocation establish a feasible proposal, subject to each owner's approval.",
                    }),
                  };
        return {
          model: "recorded-general-reference",
          usage: { providerCost: 0 },
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "general-reference-tool-" + calls,
                type: "function",
                function: tool,
              },
            ],
          },
        };
      },
    };
    // This fixed fixture has a contextual untagged water post. The recorded
    // provider resolves ONLY its presented text, never the evaluator gold.
    const report = await runDiscoveryEpisode({
      arm: "B9",
      seed: "general-reference-5",
      count: 1,
      noise: 0,
      reposts: 0,
      extentKm: 2,
      grid: 5,
      horizonMs: 7200000,
      formalDelayMs: 1800000,
      maxModelCalls: 8,
      provider,
    });
    assert.equal(report.status, "completed", JSON.stringify(report.errors));
    assert.equal(calls, 8);
    assert.equal(report.sourceCoverage.semanticBatches, 0);
    assert.equal(report.sourceCoverage.generalAgentBatches, 1);
    const activity = report.activities.find(
      (a) => a.stage === "general-agent-discovery",
    );
    assert.equal(activity.inputSnapshot.policy, "general");
    assert.equal(activity.inputSnapshot.focusMode, "manual");
    assert.equal(activity.perceptionReceipt, undefined);
    assert.equal(activity.state, "ready");
    assert.ok(
      activity.proposalId,
      "general-agent drafts enter the normal owner review workflow",
    );
    assert.ok(
      activity.steps.some(
        (s) => s.tool === "prepare_allocation" && s.state === "completed",
      ),
    );
    const verification = activity.steps.find((s) => s.tool === "verify");
    assert.equal(verification.params.id, sourceLocation);
    assert.equal(verification.params.method, "clarification");
    assert.equal(verification.state, "completed");
    assert.equal(verification.result.state, "pending");
    assert.equal(report.timeToSufficientService.completed, 1);
    assert.ok(
      report.outcomes[0].completedAt < 1800000,
      "physical aid follows the requested check before the formal channel",
    );
    assert.ok(
      report.operationalDiagnostics.scorerOnlyPhysical.operations.some(
        (o) =>
          o.type === "delivery" &&
          o.times.authorized != null &&
          o.times.service != null,
      ),
    );
    assert.deepEqual(report.invariants, []);
    assert.equal(report.candidateChanged, false);
    assert.equal(report.evaluatorChanged, false);
    assert.equal(report.simulatorChanged, false);
    assert.equal(
      report.usage.length,
      0,
      "recorded provider fixture makes no billed call",
    );
  },
);
