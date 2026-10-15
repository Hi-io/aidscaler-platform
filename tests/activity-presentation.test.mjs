import test from "node:test";
import assert from "node:assert/strict";
import { activitySummary, createActivityView } from "../ui/activity.mjs";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const view = createActivityView({
  escape,
  icon: (name) => `<svg data-icon="${escape(name)}" aria-hidden="true"></svg>`,
  action: (label, action, id, className = "") =>
    `<button class="${className}" data-action="${action}" data-id="${escape(id)}">${label}</button>`,
  time: (at) => `time:${at}`,
  labelModel: (model) =>
    model === "google/gemma-4-31b-it"
      ? "Gemma 4"
      : model || "Model not connected",
});

test("activity presentation preserves complete operational trace data and nested evidence without mutating its payload", () => {
  const activity = {
    id: "run-original-12345678",
    state: "checking",
    model: "google/gemma-4-31b-it",
    startedAt: 1000,
    steps: [
      {
        type: "tool",
        tool: "read_context",
        label: "Read the received road reports",
        state: "completed",
        at: 2000,
        params: { kind: "road", limit: 12, detail: true },
        result: {
          records: [
            {
              id: "road-1",
              version: 7,
              title: "Bridge access",
              open: false,
              references: ["report-1"],
              extraReceivedField: { preserved: "Full typed payload" },
            },
          ],
          totalAvailable: 1,
          nextOffset: null,
        },
      },
    ],
  };
  const original = JSON.stringify(activity),
    summary = activitySummary(activity, { now: 4000 }),
    html = view.detail(activity, { now: 4000 });
  assert.deepEqual(
    summary.references.map((reference) => reference.id),
    ["road-1", "report-1"],
  );
  assert.match(html, /data-action="evidence" data-id="road-1"/);
  assert.match(html, /data-action="evidence" data-id="report-1"/);
  assert.match(html, /Technical details/);
  assert.match(html, /Full typed payload/);
  assert.match(html, /&quot;limit&quot;: 12/);
  assert.match(html, /&quot;version&quot;: 7/);
  assert.equal(JSON.stringify(activity), original);
  assert.match(html, /Gemma 4/);
  assert.doesNotMatch(html, /Gemini/);
  assert.match(html, /1 records returned/);
  const lookup = structuredClone(activity);
  lookup.steps[0].result = { results: activity.steps[0].result.records };
  assert.deepEqual(
    activitySummary(lookup).references.map((reference) => reference.id),
    ["road-1", "report-1"],
  );
});

test("private reasoning and credentials never appear in the card, history, or technical details", () => {
  const providerCredential = "sk-or-v1-" + "a".repeat(64);
  const activity = {
    id: "run-safe",
    state: "failed",
    reason: "A field check is still needed.",
    steps: [
      {
        type: "tool",
        tool: "external_lookup",
        state: "failed",
        label: "A check needs attention",
        params: {
          id: "connector-1",
          api_key: "secret-api",
          headers: { Authorization: "secret-auth", Cookie: "secret-cookie" },
        },
        result: {
          public: "Keep the received quantity of 300 L",
          nested: [
            {
              reasoning_content: "private-cot",
              thinking: "private-thought",
              password: "secret-password",
            },
          ],
          nestedJson:
            '{"reasoning_details":"private-json-cot","token":"secret-json-token","location":"shelter-1"}',
          url: "https://secret-user:secret-url-password@example.com/evidence?token=secret-url-token&id=report-1",
          text: "Bearer secret-bearer and api_key=secret-inline <think>private-tagged</think>",
          partial: "<think>private-unclosed",
          providerToken: providerCredential,
          error: "ACCESS_DENIED",
        },
      },
      {
        type: "summary",
        label: "No response was prepared",
        detail: "unstructured-private-provider-output",
      },
    ],
  };
  const before = JSON.stringify(activity);
  for (const html of [
    view.card(activity),
    view.detail(activity),
    view.row(activity),
  ]) {
    for (const hidden of [
      "secret-api",
      "secret-auth",
      "secret-cookie",
      "private-cot",
      "private-thought",
      "secret-password",
      "private-json-cot",
      "secret-json-token",
      "secret-user",
      "secret-url-password",
      "secret-url-token",
      "secret-bearer",
      "secret-inline",
      "private-tagged",
      "private-unclosed",
      providerCredential.slice(0, 16),
      "unstructured-private-provider-output",
    ])
      assert.ok(
        !html.includes(hidden),
        `Private value was rendered: ${hidden}`,
      );
  }
  const details = view.detail(activity);
  assert.match(details, /Keep the received quantity of 300 L/);
  assert.match(details, /shelter-1/);
  assert.match(details, /A field check is still needed/);
  assert.match(details, /ACCESS_DENIED/);
  assert.match(details, /Private reasoning omitted/);
  assert.equal(JSON.stringify(activity), before);
});

test("a completed tool request with a pending source result is displayed as returned, never as completed verification", () => {
  const activity = {
    id: "verification-run",
    state: "waiting_evidence",
    steps: [
      {
        type: "tool",
        tool: "verify",
        label: "Requested a road check",
        state: "completed",
        params: { target: "road", method: "radio", id: "road-2" },
        result: { id: "inspection-1", state: "pending" },
      },
    ],
  };
  const summary = activitySummary(activity),
    html = view.card(activity, { role: "commander" });
  assert.equal(summary.busy, false);
  assert.equal(summary.stoppable, true);
  assert.match(html, /Returned/);
  assert.match(html, /Result: pending/);
  assert.match(html, /Waiting for field confirmation/);
  assert.match(html, /data-busy="false"/);
  assert.doesNotMatch(html, /Verification complete|Physically confirmed/);
  assert.match(html, /data-action="stop-inquiry"/);
});

test("status, model, timing and stop actions follow recorded fields without fabricated activity or unsupported controls", () => {
  assert.equal(
    activitySummary({ state: "reading", steps: [] }).latest,
    "Reviewing the received sources.",
  );
  assert.equal(
    activitySummary({ state: "checking", steps: [] }).latest,
    "Waiting for the next tool result.",
  );
  for (const state of [
    "queued",
    "reading",
    "checking",
    "waiting_evidence",
    "waiting_context",
    "waiting_capacity",
    "waiting_review",
    "waiting_receipt",
    "ready",
    "inconclusive",
    "failed",
    "cancelled",
    "future_state",
  ]) {
    const activity = { id: "run-status", state, steps: [] },
      summary = activitySummary(activity, { now: 5000 });
    assert.equal(
      summary.busy,
      ["queued", "reading", "checking"].includes(state),
    );
    assert.equal(summary.elapsedMs, null);
    const commander = view.card(activity, { role: "commander" }),
      observer = view.card(activity, { role: "observer" });
    assert.equal(
      commander.includes('data-action="stop-inquiry"'),
      summary.stoppable,
    );
    assert.ok(!observer.includes('data-action="stop-inquiry"'));
    assert.match(commander, /Model not connected/);
    assert.match(commander, /Run time not recorded/);
  }
  assert.equal(
    activitySummary({ state: "reading", startedAt: 1000 }, { now: 4100 })
      .elapsedMs,
    3100,
  );
  assert.equal(
    activitySummary({ state: "ready", startedAt: 1000, finishedAt: 3500 })
      .elapsedMs,
    2500,
  );
  assert.equal(
    activitySummary({ state: "reading", startedAt: 1000, wallMs: 0 }).elapsedMs,
    0,
  );
  assert.equal(
    activitySummary(
      { state: "waiting_receipt", startedAt: 1000 },
      { now: 4100 },
    ).elapsedMs,
    null,
  );
  assert.equal(
    activitySummary({ state: "ready", startedAt: 4000, finishedAt: 1000 })
      .elapsedMs,
    null,
  );
  assert.equal(
    activitySummary({ state: "checking", cancelRequested: true }).stoppable,
    false,
  );
  assert.match(
    view.card({ state: "checking", cancelRequested: true }),
    /Stopping after the current call/,
  );
  assert.match(view.card(null), /data-state="idle" data-busy="false"/);
  assert.doesNotMatch(
    view.card(null),
    /Gemma|Gemini|data-action="stop-inquiry"/,
  );
});

test("review links and provider timing remain separate from authorization, service, and elapsed investigation time", () => {
  const ready = {
    id: "run-ready",
    state: "ready",
    proposalId: "proposal-exact",
    model: "google/gemma-4-31b-it",
    startedAt: 1000,
    finishedAt: 2200,
    wallMs: 700,
    calls: 0,
    modelClockAccounting: { providerWallMs: 100 },
    steps: [],
  };
  const html = view.detail(ready),
    summary = activitySummary(ready);
  assert.equal(summary.elapsedMs, 700);
  assert.equal(summary.providerWallMs, 100);
  assert.equal(summary.calls, 0);
  assert.match(html, /data-action="proposal" data-id="proposal-exact"/);
  assert.match(html, /Review response/);
  assert.match(html, /Recorded run time · 700 ms/);
  assert.match(html, /Recorded provider request time · 100 ms/);
  assert.match(html, /0 calls recorded/);
  assert.match(html, /a draft is not a dispatch or delivery/);
  assert.doesNotMatch(html, /Response authorized|Aid delivered/);
  assert.doesNotMatch(
    view.detail({ state: "ready", steps: [] }),
    /Recorded provider request time/,
  );
  assert.match(
    view.card({ state: "ready", semanticReceipt: "semantic-1", steps: [] }),
    /data-action="semantic-receipt" data-id="semantic-1"/,
  );
});

test("technical history is complete, escaped and expandable, while erased source content stays unavailable", () => {
  const activity = {
    id: 'run-"unsafe',
    state: "checking",
    steps: [
      {
        tool: "search",
        label: '<img src=x onerror="unsafe">',
        state: "completed",
        params: { query: "<script>unsafe</script>" },
        result: {
          posts: [{ id: "source-original", text: "Original received post" }],
        },
      },
    ],
  };
  const html = view.card(activity);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<img /);
  assert.match(html, /<details class="activity-disclosure"/);
  assert.match(html, /<details class="activity-technical"/);
  assert.match(html, /data-activity-history="run-&quot;unsafe"/);
  assert.match(
    view.card(activity, { historyOpen: true }),
    /data-activity-history="run-&quot;unsafe" open/,
  );
  const erased = view.detail({ ...activity, erasure: { id: "erasure-1" } });
  assert.doesNotMatch(
    erased,
    /Original received post|source-original|unsafe&lt;/,
  );
  assert.match(erased, /Source content removed/);
});
