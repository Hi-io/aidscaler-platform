import { readableText } from "./labels.mjs";
// Presentation only: activity records describe observed requests and returned
// results. They never confer authority or prove that physical aid was delivered.
const RUNNING = new Set(["queued", "reading", "checking"]);
const STOPPABLE = new Set([
  ...RUNNING,
  "waiting_evidence",
  "waiting_capacity",
  "waiting_review",
  "waiting_receipt",
]);
const STATUS = {
  queued: "Queued for investigation",
  reading: "Reading received sources",
  checking: "Checking a response",
  waiting_evidence: "Waiting for field confirmation",
  waiting_context: "Context needs review",
  waiting_capacity: "Waiting for response capacity",
  waiting_review: "Waiting for owner review",
  waiting_receipt: "Waiting for a delivery receipt",
  ready: "Checks recorded",
  inconclusive: "More evidence is needed",
  failed: "This investigation needs attention",
  cancelled: "Investigation stopped",
};
const PRIVATE_FIELDS =
  /^(reasoning.*|privatereasoning.*|chainofthought.*|cot|thinking.*|thoughts|thoughtprocess|analysis|internalanalysis|scratchpad|systemprompt|messages)$/;
const SECRET_FIELDS =
  /^(password|passphrase|secret|clientsecret|apikey|accesskey|privatekey|signingkey|encryptionkey|token|accesstoken|refreshtoken|idtoken|authorization|proxyauthorization|cookie|setcookie|csrf|csrftoken|credentials|session|sessionkey|sessionid|signature|sig|xamzcredential|xamzsignature|xgoogcredential|xgoogsignature)$/;
const normalizedKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (value) => (typeof value === "string" ? value : "");
const finite = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const timestamp = (value) => finite(value) && value <= 8_640_000_000_000_000;
const humanize = (value) => text(value).replaceAll("_", " ");
const brief = (value, length = 220) =>
  value.length > length ? value.slice(0, length - 1) + "…" : value;

function redactText(value) {
  let clean = value
    .replace(
      /<(?:think|thinking|analysis)\b[^>]*>[\s\S]*?<\/(?:think|thinking|analysis)>/gi,
      "[Private reasoning omitted]",
    )
    .replace(
      /<(?:think|thinking|analysis)\b[^>]*>[\s\S]*$/gi,
      "[Private reasoning omitted]",
    )
    .replace(/\bBearer\s+[^\s,;"'<>]+/gi, "Bearer [Redacted]")
    .replace(
      /\b(?:sk-or-v1-|sk-proj-|sk-|gsk_)[a-z0-9_-]{16,}/gi,
      "[Redacted credential]",
    )
    .replace(/\bAIza[a-z0-9_-]{25,}/g, "[Redacted credential]")
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[Redacted private key]",
    );
  clean = clean.replace(/https?:\/\/[^\s<>"']+/g, (candidate) => {
    try {
      const url = new URL(candidate);
      if (url.username || url.password) {
        url.username = "redacted";
        url.password = "redacted";
      }
      for (const key of [...url.searchParams.keys()])
        if (SECRET_FIELDS.test(normalizedKey(key)))
          url.searchParams.set(key, "[Redacted]");
      return url.href;
    } catch {
      return candidate;
    }
  });
  clean = clean.replace(
    /\b(password|passphrase|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1=[Redacted]",
  );
  // Some tools return JSON in a string. Redact its nested fields as well.
  if (/^\s*[\[{]/.test(clean)) {
    try {
      return JSON.stringify(project(JSON.parse(clean)));
    } catch {}
  }
  return clean;
}

function project(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactText(value);
  if (value == null || typeof value === "number" || typeof value === "boolean")
    return value;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Repeated reference]";
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((item) => project(item, seen))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          PRIVATE_FIELDS.test(normalizedKey(key))
            ? "[Private reasoning omitted]"
            : SECRET_FIELDS.test(normalizedKey(key))
              ? "[Redacted]"
              : project(item, seen),
        ]),
      );
  seen.delete(value);
  return result;
}

const REFERENCE_LISTS = new Set([
  "references",
  "originalReferences",
  "evidenceIds",
  "sourceIds",
  "claimIds",
  "evidence",
]);
const RECORD_LISTS = new Set([
  "results",
  "records",
  "posts",
  "sources",
  "claims",
  "verifications",
  "resources",
  "vehicles",
  "facilities",
  "roads",
  "needs",
  "operations",
]);
const REFERENCE_KEYS = new Set([
  "sourceId",
  "evidenceId",
  "mediaId",
  "queryId",
  "verificationId",
  "claimId",
]);
function references(step) {
  const found = new Map();
  const add = (id, label = id) => {
    if (
      typeof id === "string" &&
      id &&
      !/\[(?:Redacted|Private reasoning|Repeated reference)/.test(id)
    )
      found.set(id, { id, label: brief(text(label) || id, 80) });
  };
  const visit = (value, container) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (REFERENCE_LISTS.has(container) && typeof item === "string")
          add(item);
        if (
          item &&
          typeof item === "object" &&
          (RECORD_LISTS.has(container) || REFERENCE_LISTS.has(container))
        )
          add(
            item.id ?? item.sourceId,
            item.title ?? item.name ?? item.id ?? item.sourceId,
          );
        visit(item, container);
      }
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (REFERENCE_KEYS.has(key)) add(item);
        visit(item, key);
      }
    }
  };
  visit(step.params, "params");
  visit(step.result, "result");
  if (
    [
      "verify",
      "lookup",
      "inspect_media",
      "external_lookup",
      "record_claim",
    ].includes(step.tool)
  )
    add(step.result?.id);
  return [...found.values()];
}

function stepFacts(step) {
  const facts = [],
    push = (value, label) => {
      if (Number.isSafeInteger(value) && value >= 0)
        facts.push(`${value} ${label}`);
    };
  if (step.params?.target) facts.push(humanize(step.params.target));
  if (step.params?.method) facts.push(humanize(step.params.method));
  push(step.sourceCount, "sources in batch");
  push(step.presentedSourceCount, "presented for interpretation");
  push(step.observationCount, "interpretations");
  push(step.rejectedCount, "require review");
  push(step.confirmedLocations, "confirmations recorded");
  push(step.pendingLocations, "still pending");
  push(step.allocations, "allocations compiled");
  const records = step.result?.records ?? step.result?.results;
  if (Array.isArray(records)) push(records.length, "records returned");
  if (Array.isArray(step.result?.posts))
    push(step.result.posts.length, "reports returned");
  if (text(step.result?.state))
    facts.push("Result: " + humanize(step.result.state));
  if (text(step.result?.error)) facts.push("Error: " + step.result.error);
  return facts.map((fact) => brief(fact, 120));
}

/** A read-only projection of the actual activity payload, never model thoughts. */
export function activitySummary(activity, { model, now = Date.now() } = {}) {
  if (!activity)
    return {
      empty: true,
      state: "idle",
      busy: false,
      stoppable: false,
      title: "Ready to investigate",
      latest: "Choose a case to see its checks and returned evidence here.",
      steps: [],
      references: [],
    };
  const state = text(activity.state) || "unknown",
    erased = Boolean(activity.erasure);
  const steps = (erased || !Array.isArray(activity.steps) ? [] : activity.steps)
    .filter((step) => step && typeof step === "object")
    .map((step, index) => {
      // A legacy summary.detail is an unstructured model response rather than a
      // tool result. It is not a suitable source of a displayed reasoning trace.
      const safe = project(
          step.type === "summary"
            ? { ...step, detail: "[Unstructured model response omitted]" }
            : step,
        ),
        state = text(safe.state) || "recorded";
      return {
        index,
        title:
          text(safe.label) ||
          humanize(safe.tool) ||
          humanize(safe.type) ||
          "Recorded step",
        state,
        tool: text(safe.tool),
        type: text(safe.type),
        at: timestamp(safe.at) ? safe.at : null,
        facts: stepFacts(safe),
        references: references(safe),
        technical: safe,
      };
    });
  const startedAt = timestamp(activity.startedAt) ? activity.startedAt : null,
    finishedAt = timestamp(activity.finishedAt) ? activity.finishedAt : null,
    elapsedMs = finite(activity.wallMs)
      ? activity.wallMs
      : startedAt !== null && finishedAt !== null && finishedAt >= startedAt
        ? finishedAt - startedAt
        : RUNNING.has(state) &&
            startedAt !== null &&
            finite(now) &&
            now >= startedAt
          ? now - startedAt
          : null;
  const title = erased
    ? "Source content removed"
    : activity.cancelRequested && state !== "cancelled"
      ? "Stopping after the current call"
      : state === "ready" && activity.proposalId
        ? "A response is ready for review"
        : state === "ready" && activity.kind === "source_interpretation"
          ? "Interpretations are ready for review"
          : (STATUS[state] ?? "Activity recorded");
  return {
    empty: false,
    id: text(activity.id),
    state,
    busy: RUNNING.has(state),
    stoppable: STOPPABLE.has(state) && !activity.cancelRequested && !erased,
    title,
    latest: brief(
      steps.at(-1)?.title ??
        {
          queued: "Waiting for an available worker.",
          reading: "Reviewing the received sources.",
          checking: "Waiting for the next tool result.",
          cancelled: "No further checks are running.",
        }[state] ??
        "No additional step has been recorded.",
    ),
    model: text(activity.model) || text(model) || null,
    startedAt,
    finishedAt,
    elapsedMs,
    elapsedLabel:
      finite(activity.wallMs) || finishedAt !== null
        ? "Recorded run time"
        : "Elapsed since start",
    providerWallMs: finite(activity.modelClockAccounting?.providerWallMs)
      ? activity.modelClockAccounting.providerWallMs
      : null,
    calls:
      Number.isSafeInteger(activity.calls) && activity.calls >= 0
        ? activity.calls
        : null,
    reason: erased
      ? "The original source content is no longer available in this activity."
      : redactText(text(activity.reason)),
    error: redactText(text(activity.error)),
    cancelRequested: Boolean(activity.cancelRequested),
    proposalId: text(activity.proposalId),
    semanticReceipt: erased ? "" : text(activity.semanticReceipt),
    steps,
    references: [
      ...new Map(
        steps
          .flatMap((step) => step.references)
          .map((reference) => [reference.id, reference]),
      ).values(),
    ],
  };
}

function duration(ms) {
  if (!finite(ms)) return "Not recorded";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  if (ms < 3_600_000)
    return `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor(ms / 60_000) % 60}m`;
}

/** Uses only existing data-action handlers; this module issues no requests. */
export function createActivityView({
  escape: e,
  icon = () => "",
  action,
  time = (at) => new Date(at).toLocaleTimeString(),
  labelModel = (model) => model || "Model not connected",
}) {
  const stateLabel = (step) =>
    step.state === "completed"
      ? step.tool
        ? "Returned"
        : "Recorded"
      : humanize(step.state);
  const mark = (step) =>
    icon(
      step.state === "failed"
        ? "circle-alert"
        : step.state === "running"
          ? "loader-circle"
          : step.state === "completed"
            ? "check"
            : "clock",
    );
  const evidence = (rows) =>
    rows.length
      ? `<div class="activity-evidence" aria-label="Evidence references">${rows.map((reference) => action(e(readableText(reference.label)), "evidence", reference.id, "quiet")).join("")}</div>`
      : "";
  const meta = (a) =>
    `<div class="activity-meta"><span>${e(labelModel(a.model))}</span>${a.elapsedMs !== null ? `<span>${e(a.elapsedLabel)} · ${e(duration(a.elapsedMs))}</span>` : "<span>Run time not recorded</span>"}${a.calls !== null ? `<span>${a.calls} ${a.calls === 1 ? "call" : "calls"} recorded</span>` : ""}${a.id ? `<span title="${e(a.id)}">Run ${e(a.id.slice(-8))}</span>` : ""}</div>`;
  const controls = (a, { role } = {}, details = false) =>
    `<div class="activity-actions">${a.proposalId ? action("Review response", "proposal", a.proposalId, "primary") : a.semanticReceipt ? action("Review interpretations", "semantic-receipt", a.semanticReceipt, "accent") : ""}${!details && a.id ? action("View activity", "activity", a.id, "quiet") : ""}${a.stoppable && ["analyst", "commander", "dispatcher"].includes(role) ? action("Stop inquiry", "stop-inquiry", a.id, "quiet") : ""}</div>`;
  const context = (a, compact = false) =>
    `${a.reason ? `<p class="activity-context">${e(compact ? brief(a.reason, 280) : a.reason)}</p>` : ""}${a.error ? `<p class="activity-context warning">Recorded error · ${e(a.error)}</p>` : ""}${a.cancelRequested ? `<p class="activity-context">${a.state === "cancelled" ? "Stopped. Previously completed calls remain recorded." : "Stop requested. The current call may still finish."}</p>` : ""}`;
  const history = (a, opened = false) =>
    a.steps.length
      ? `<details class="activity-disclosure" data-activity-history="${e(a.id)}"${opened ? " open" : ""}><summary>${a.steps.length} recorded ${a.steps.length === 1 ? "step" : "steps"}<span>Tools & evidence</span></summary><ol class="activity-timeline">${a.steps.map((step) => `<li class="activity-event" data-state="${e(step.state)}"><span class="activity-event-mark" aria-hidden="true">${mark(step)}</span><div class="activity-event-body"><div class="activity-event-meta"><span>${e(stateLabel(step))}</span>${step.tool ? `<span>${e(humanize(step.tool))}</span>` : ""}${step.at !== null ? `<time datetime="${e(new Date(step.at).toISOString())}">${e(time(step.at))}</time>` : ""}</div><h3>${e(step.title)}</h3>${step.facts.length ? `<p class="small">${step.facts.map(e).join(" · ")}</p>` : ""}${evidence(step.references)}<details class="activity-technical" data-activity-technical="${e(a.id)}:${step.index}"><summary>Technical details</summary><pre class="trace">${e(JSON.stringify(step.technical, null, 2))}</pre></details></div></li>`).join("")}</ol></details>`
      : `<p class="activity-context">No tool result has been recorded yet.</p>`;
  function card(activity, options = {}) {
    const a = activitySummary(activity, options);
    if (a.empty)
      return `<section class="card activity-console activity-empty" data-state="idle" data-busy="false" aria-label="Investigation activity"><div class="activity-topline"><span class="activity-presence" aria-hidden="true">${icon("sparkles")}</span><span>Activity</span><span class="activity-status">Idle</span></div><h2 class="activity-focus">${e(a.title)}</h2><p class="activity-context">${e(a.latest)}</p></section>`;
    return `<section class="card activity-console" data-live-activity="${e(a.id)}" data-state="${e(a.state)}" data-busy="${a.busy}" aria-label="Investigation activity"><div class="activity-topline"><span class="activity-presence" aria-hidden="true">${icon("sparkles")}</span><span>Activity</span><span class="activity-status" data-live-activity-state role="status" aria-live="polite">${e(a.title)}</span></div><h2 class="activity-focus">${e(a.latest)}</h2>${meta(a)}<p class="activity-live-progress" data-live-activity-progress>${a.steps.length} recorded steps</p>${context(a, true)}${history(a, options.historyOpen === true)}${controls(a, options)}</section>`;
  }
  function detail(activity, options = {}) {
    const a = activitySummary(activity, options);
    if (a.empty) return card(activity, options);
    return `<section class="activity-console activity-detail" data-state="${e(a.state)}" data-busy="${a.busy}" aria-label="Recorded investigation"><div class="activity-topline"><span class="activity-presence" aria-hidden="true">${icon("sparkles")}</span><span class="activity-status">${e(a.title)}</span></div><h2 class="activity-focus">${e(a.latest)}</h2>${meta(a)}${a.startedAt !== null ? `<p class="small">Started ${e(time(a.startedAt))}${a.finishedAt !== null ? " · last run ended " + e(time(a.finishedAt)) : ""}</p>` : ""}${a.providerWallMs !== null ? `<p class="small">Recorded provider request time · ${e(duration(a.providerWallMs))}</p>` : ""}${context(a)}${history(a, true)}${controls(a, options, true)}<p class="note">This is the recorded activity and returned evidence. Interpretations require review; a draft is not a dispatch or delivery.</p></section>`;
  }
  function row(activity, options = {}) {
    const a = activitySummary(activity, options);
    if (a.empty) return "";
    return `<div class="activity-record" data-live-activity="${e(a.id)}" data-state="${e(a.state)}"><span class="activity-event-mark" aria-hidden="true">${icon(a.state === "failed" ? "circle-alert" : "clock")}</span><div class="grow"><p class="activity-event-meta" data-live-activity-state>${e(a.title)}</p><h3>${e(a.latest)}</h3>${meta(a)}<span class="activity-live-progress" data-live-activity-progress>${a.steps.length} recorded steps</span></div>${action("View activity", "activity", a.id, "quiet")}</div>`;
  }
  return { card, detail, row, metadata: (activity, options = {}) => meta(activitySummary(activity, options)) };
}
