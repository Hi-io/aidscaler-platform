import { offlineQueue } from "./offline.mjs";
import { icons } from "./icons.mjs";
import { operationalMap, bindMap } from "./map.mjs";
import { createExtras } from "./extras.mjs";
import { createOperationalDraft } from "./operational.mjs";
import { createFinanceControls, publicProcurement } from "./finance.mjs";
import { createWorkforceControls } from "./workforce.mjs";
import { readAttachment, actionBrief } from "./uploads.mjs";
import { createPublicationControls } from "./publications.mjs";
import { createCaseControls } from "./casework.mjs";
import { createOrganizationControls } from "./organization.mjs";
import { createResponseControls } from "./response.mjs";
import { createCoverageControls } from "./coverage.mjs";
import { createUnloadingControls } from "./unloading.mjs";
import { driverAvailabilityBadge } from "./fleet.mjs";
import { staffAvailabilityState, staffAvailabilityBadge, simulationClock, sourceExpiryLabel } from "./staff.mjs";
const app = document.querySelector("#app");
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${icons[name] ?? ""}</svg>`;
const badge = (s) =>
  `<span class="badge ${escape(s)}">${escape(String(s ?? "unknown").replaceAll("_", " "))}</span>`;
const number = (n) => Number(n ?? 0).toLocaleString("en-US");
const money = (c) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(c ?? 0) / 100,
  );
const time = (t) =>
  t != null && Number(t) < 946684800000
    ? `Lab +${Math.floor(Number(t) / 3600000)}h ${Math.floor(Number(t) / 60000) % 60}m`
    : t != null
      ? new Date(Number(t)).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Not confirmed";
const ago = (t) =>
  t
    ? `${Math.max(0, Math.round((Date.now() - Number(t)) / 60000))} min ago`
    : "Not yet";
const nav = [
  ["overview", "layout-dashboard", "Response overview", "Respond"],
  ["map", "map-pin", "Operational map"],
  ["signals", "radio", "Signals & evidence"],
  ["media", "image", "Source media"],
  ["moderation", "message-square", "Community reports"],
  ["investigations", "sparkles", "Investigations"],
  ["review", "clipboard-check", "Decision queue"],
  ["operations", "truck", "Operations"],
  ["resources", "package", "Resources & facilities", "Coordinate"],
  ["network", "network", "Partner network"],
  ["publications", "globe", "Public updates", "Communicate"],
  ["finance", "wallet", "Pooled funds"],
  ["field", "map-pin", "Field workspace"],
  ["coordination", "users", "People & handovers"],
  ["settings", "settings", "Sources & access", "Manage"],
  ["connections", "plug", "External connections"],
  ["audit", "shield-check", "Decision history"],
];
let state = {
    user: null,
    csrf: null,
    model: null,
    page: location.hash.slice(1) || "overview",
    data: null,
    filter: "",
    signalPage: 0,
    offline: !navigator.onLine,
  },
  polling = false,
  dialog = null,
  renderVersion = 0;
const pageRoles = {
  field: ["field", "media"],
  publisher: ["publications", "media", "overview"],
  finance: ["finance", "overview"],
  auditor: [
    "overview",
    "finance",
    "audit",
    "operations",
    "signals",
    "review",
    "network",
    "resources",
  ],
  admin: ["overview", "settings", "connections", "audit", "signals", "media"],
  analyst: [
    "overview",
    "map",
    "signals",
    "media",
    "moderation",
    "investigations",
    "review",
    "operations",
    "resources",
    "network",
    "field",
    "coordination",
    "settings",
    "connections",
  ],
  dispatcher: [
    "overview",
    "map",
    "signals",
    "media",
    "moderation",
    "investigations",
    "review",
    "operations",
    "resources",
    "network",
    "field",
    "coordination",
    "settings",
    "connections",
  ],
};
const visibleNav = () =>
  nav.filter(
    (n) =>
      !pageRoles[state.user?.role] || pageRoles[state.user.role].includes(n[0]),
  );
function cacheSession() {
  sessionStorage.setItem(
    "nexo-workspace",
    JSON.stringify({
      user: state.user,
      model: state.model,
      expiresAt: Number(state.user.expiresAt) || Date.now() + 8 * 3600000,
    }),
  );
}
function toast(s) {
  const el = document.querySelector("#toast");
  el.textContent = s;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 5000);
}
async function api(url, body) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body
      ? {
          "Content-Type": "application/json",
          "X-CSRF-Token": state.csrf,
          "Idempotency-Key":
            body.idempotencyKey ?? body.clientId ?? crypto.randomUUID(),
        }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    const e = new Error(result.message ?? "The request failed.");
    e.code = result.error;
    throw e;
  }
  return result;
}
const record = (kind, id) =>
  api("/api/records?" + new URLSearchParams({ kind, ...(id ? { id } : {}) }));
const empty = (text, name = "inbox") =>
  `<div class="empty">${icon(name)}${escape(text)}</div>`;
const extras = createExtras({
  api,
  record,
  escape,
  icon,
  badge,
  title,
  action,
  table,
  empty,
  state,
  modal,
  render,
  toast,
});
const operational = createOperationalDraft({
  api,
  record,
  escape,
  state,
  modal,
  toast,
  render,
});
const financeControls = createFinanceControls({
  api,
  escape,
  state,
  table,
  toast,
  render,
});
const workforceControls = createWorkforceControls({
  api,
  record,
  escape,
  action,
  badge,
  empty,
  title,
  state,
  modal,
  toast,
  render,
  offlineQueue,
  flush,
  close: () => runAction("close", ""),
});
const publicationControls = createPublicationControls({
  api,
  record,
  escape,
  action,
  badge,
  empty,
  title,
  state,
  modal,
  toast,
  render,
  close: () => runAction("close", ""),
});
const caseControls = createCaseControls({
  api,
  record,
  escape,
  action,
  state,
  modal,
  toast,
  render,
  close: () => runAction("close", ""),
});
const organizationControls = createOrganizationControls({
  api,
  escape,
  action,
  state,
  modal,
  toast,
  render,
  close: () => runAction("close", ""),
});
const responseControls = createResponseControls({ api, escape, action, state, modal, toast });
const coverageControls = createCoverageControls({ api, escape, action, state, modal, toast, render, time });
const unloadingControls = createUnloadingControls({ api, escape, state, toast, render });
function title(text, sub, actions = "") {
  return `<div class="pagetitle"><div><h1>${text}</h1><p class="sub">${sub}</p></div><div class="actions">${actions}</div></div>`;
}
function table(headers, rows) {
  return `<div class="tablewrap"><table class="table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function action(label, act, id = "", cls = "") {
  const permissions = {
    sync: ["admin", "analyst", "commander", "dispatcher"],
    investigate: ["analyst", "commander", "dispatcher"],
    investigatesignal: ["analyst", "commander", "dispatcher"],
    "discover-page": ["analyst", "commander", "dispatcher"],
    "investigate-facility": ["analyst", "commander", "dispatcher"],
    "stop-inquiry": ["analyst", "commander", "dispatcher"],
    automation: ["admin", "commander"],
    "operational-draft": ["analyst", "commander", "dispatcher"],
    repair: ["analyst", "commander", "dispatcher"],
    verifyneed: ["analyst", "commander", "dispatcher"],
    verifyform: ["analyst", "commander", "dispatcher"],
    lookup: ["admin", "analyst", "commander", "dispatcher"],
    addresource: ["admin", "commander", "dispatcher"],
    reserve: ["commander", "dispatcher"],
    share: ["commander", "dispatcher"],
    revoke: ["commander", "dispatcher"],
    withdraw: ["commander", "dispatcher"],
    confirmcommitment: ["commander", "dispatcher"],
    draftpublication: ["publisher", "commander"],
    publish: ["publisher", "commander"],
    publishconfirm: ["publisher", "commander"],
    users: ["admin"],
  };
  if (permissions[act] && !permissions[act].includes(state.user?.role))
    return "";
  return `<button class="${cls}" data-action="${act}" data-id="${escape(id)}">${label}</button>`;
}
function login(error = "") {
  app.innerHTML = `<div class="login"><div class="loginaside"><div class="brand"><img src="/mark.svg" alt="">nexo.</div><div><span class="eyebrow">DISASTER RESPONSE · LOCAL WORKSPACE</span><h1>Scattered signals.<br>A response that<br><span class="gradient">comes together.</span></h1><p>A shared operational picture for the people coordinating help when every minute matters.</p></div><div class="loginbottom small">Model-assisted investigation. Human-owned decisions.</div></div><div class="loginform"><form id="loginform"><h2>Your response workspace</h2><p>Sign in with your organization's account.<br>Roles and authorizations stay separate.</p><label>Email<input type="email" name="email" required autocomplete="username" placeholder="commander@org0.nexo.local"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label>${error ? `<div role="alert" class="error">${escape(error)}</div>` : ""}<button class="primary" type="submit">Enter workspace ${icon("arrow-right")}</button><div class="loginlinks"><a href="/public">Public response portal</a><a href="/community">Report a need</a></div><div class="footnote">Local prototype. Test payments collect no money. Access credentials are provisioned by your administrator.</div></form></div></div>`;
  document.querySelector("#loginform").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api("/api/login", b);
      state.user = r.user;
      state.csrf = r.csrf;
      const me = await api("/api/me");
      state.delegatedReviews = me.delegatedReviews;
      state.model = me.model;
      cacheSession();
      await render();
    } catch (e) {
      login(e.message);
    }
  };
}
function shell(content) {
  const active = nav.find((n) => n[0] === state.page);
  app.innerHTML = `<div class="app"><aside class="sidebar"><div class="brand"><img src="/mark.svg" alt="">nexo.</div><div class="org"><span>RESPONSE WORKSPACE</span>${escape(state.user.org)} · Disaster operations</div><nav aria-label="Workspace">${visibleNav()
    .map(
      ([id, i, label, group]) =>
        `${group ? `<div class="navlabel">${group}</div>` : ""}<button class="navitem ${state.page === id ? "active" : ""}" data-page="${id}" ${state.page === id ? 'aria-current="page"' : ""}>${icon(i)}${label}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebarfooter"><strong>${escape(state.user.name)}</strong>${escape(state.user.role)} · ${escape(state.user.org)}<br>${action("Sign out", "logout", "", "quiet")}</div></aside><div class="workspace"><header class="topbar"><div class="crumb">Disaster response <span> / </span><b>${active?.[2] ?? "Workspace"}</b></div><div class="topstatus"><span><i class="statusdot ${state.offline ? "offline" : ""}"></i>${state.offline ? "Offline · saved work available" : "Local workspace connected"}</span><a href="/public" target="_blank" rel="noopener">Public portal ${icon("external-link")}</a><span class="avatar" aria-label="${escape(state.user.name)}">${escape(state.user.name.slice(0, 1))}</span></div><select class="mobile-nav" aria-label="Workspace page">${visibleNav()
    .map(
      ([id, , label]) =>
        `<option value="${id}" ${id === state.page ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select></header><main id="main">${content}<div class="footnote">NEXO local prototype · ${escape(state.model ?? "Model not connected")} · Sources and simulation results remain distinct from real-world outcomes.</div></main></div></div>`;
  bind();
}
function activityCard(a) {
  const active = ["reading", "checking", "queued"].includes(a?.state);
  const waitLabels = { waiting_evidence: "Waiting for field confirmation", waiting_context: "Unverified context awaits a relevant need or review", waiting_capacity: "Waiting for eligible response capacity", waiting_review: "Waiting for owner review", waiting_receipt: "Waiting for physical delivery" };
  const waiting = Object.hasOwn(waitLabels, a?.state ?? ""), stoppable = active || waiting;
  if (!a)
    return `<div class="card soft"><div class="activityhead"><span class="spark">✦</span><div><h3 class="gradient">Ready to investigate</h3><p class="sub">Select a case. The model checks what could unlock useful help.</p></div></div><p class="small">No inference is running. Every tool call and result will appear here.</p></div>`;
  return `<div class="card soft ${active ? "processing" : ""}"><div class="activityhead"><span class="spark">✦</span><div><h3 class="gradient">${escape(active ? "Gemma is " + { reading: "reading the evidence", checking: "checking a possibility", queued: "queued for investigation" }[a.state] : waiting ? waitLabels[a.state] : a.state === "cancelled" ? "Inquiry stopped" : a.state === "ready" ? (a.kind === "source_interpretation" ? "Sourced interpretations are ready to review" : "A response is ready to review") : a.state === "failed" ? "Investigation needs attention" : "Evidence remains incomplete")}</h3><p class="small">${escape(a.model ?? state.model)} · ${badge(a.state)}</p></div></div>${
    a.steps
      ?.slice(-2)
      .map(
        (s) =>
          `<div class="activitystep">${icon(s.state === "failed" ? "circle-alert" : "check")} ${escape(s.label ?? s.tool)}<small>${escape(s.state)} · ${time(s.at)}</small></div>`,
      )
      .join("") ?? ""
  }${a.cancelRequested ? `<p class="small">${a.state === "cancelled" ? "Stopped. Previously completed calls remain recorded." : "Stop requested. Waiting for the current call to finish."}</p>` : a.reason ? `<p class="small">${escape(a.reason)}</p>` : ""}<div class="toolbar">${action("Open activity & evidence", "activity", a.id, "quiet")}${a.proposalId ? action("Review response", "proposal", a.proposalId, "accent") : ""}${stoppable && !a.cancelRequested && ["analyst", "commander", "dispatcher"].includes(state.user.role) ? action("Stop inquiry", "stop-inquiry", a.id) : ""}</div></div>`;
}
async function overview() {
  const d = await api("/api/dashboard");
  state.data = d;
  const queue = d.proposal.filter((p) =>
    ["awaiting_review", "requires_review", "needs_clarification"].includes(
      p.state,
    ),
  );
  const unresolved = d.need.filter((n) => n.quantity > n.served);
  return (
    title(
      "A clearer picture. A faster response.",
      "Prioritize urgent needs, review useful options and keep track of what actually reached people.",
      action(`${icon("refresh-cw")} Sync sources`, "sync") +
        action(
          `${icon("sparkles")} Investigate signals`,
          "investigate",
          "",
          "primary",
        ),
    ) +
    `<div class="metricrow">${[
      [
        "Active needs",
        d.activeNeedCount,
        "Known needs, not total affected population",
      ],
      ["Decisions waiting", d.decisionCount, "Human authorization required"],
      [
        "Signals collected",
        d.signalCount,
        "Versioned public & authorized sources",
      ],
      [
        "Operations in progress",
        d.activeOperationCount,
        "Dispatch is separate from confirmed receipt",
      ],
    ]
      .map(
        ([label, n, note]) =>
          `<div class="metric"><span class="label">${label}</span><strong>${number(n)}</strong><span>${note}</span></div>`,
      )
      .join(
        "",
      )}</div><div class="grid split"><section class="card"><div class="cardheader"><h2>What needs your attention</h2>${badge("urgent")}</div>${
      queue.length
        ? queue
            .slice(0, 4)
            .map(
              (p) =>
                `<div class="listrow"><div class="rowicon coral">${icon("clipboard-check")}</div><div class="grow"><h3>${escape(p.title)}</h3><p>${escape(p.benefit)}</p>${badge(p.state)} <span class="small">${p.conditions.filter((c) => !c.satisfied).length} conditions pending</span></div>${action("Review", "proposal", p.id)}</div>`,
            )
            .join("")
        : unresolved.length
          ? unresolved
              .slice(0, 5)
              .map(
                (n) =>
                  `<div class="listrow"><div class="rowicon coral">${icon("circle-alert")}</div><div class="grow"><h3>${escape(n.type)} needed · ${escape(n.building)}</h3><p>${number(n.quantity - n.served)} ${escape(n.unit)} still needed. Confirm the situation before committing resources.</p></div>${action("Case", "need", n.id)}</div>`,
              )
              .join("")
          : empty(
              "No verified priorities yet. Connect sources or request a field assessment. Unknown areas remain unknown.",
            )
    }<div class="toolbar">${action("Open decision queue →", "navigate", "review", "quiet")}</div></section><div class="grid">${activityCard(d.activity[0])}${await coverageControls.card()}<section class="card"><div class="cardheader"><h3>Source health</h3>${action("Manage", "navigate", "settings", "quiet")}</div>${d.source.length ? d.source.map((s) => `<div class="listrow"><div class="rowicon">${icon("radio")}</div><div class="grow"><h3>Signal network & operational systems</h3><p>${s.changed ?? 0} new or revised signals · ${s.lastSuccessAt ? ago(s.lastSuccessAt) : "No successful sync"}</p></div>${badge(s.state)}</div>`).join("") : empty("No source is connected yet. Public feeds are ingested automatically when configured.", "radio")}<p class="small">A gap in reports does not mean a gap in needs.</p></section></div></div>`
  );
}
async function signals() {
  const rows = (await record("signal")).filter((s) => s.state !== "erased");
  state.signalRows = rows;
  const filtered = rows.filter((s) =>
      `${s.text} ${s.source} ${s.location}`
        .toLowerCase()
        .includes(state.filter.toLowerCase()),
    ),
    start = state.signalPage * 12;
  return (
    title(
      "The world speaks in fragments.",
      "Public posts, media and authorized reports arrive automatically. Keep the original evidence and its uncertainty.",
      action(`${icon("refresh-cw")} Sync`, "sync") +
        action("Discover a response", "discover-page", "", "primary") + action("Interpret only", "interpret-page", "", "accent"),
    ) +
    `<div class="filterbar"><input id="signalfilter" aria-label="Search collected signals" placeholder="Search a place, need or phrase" value="${escape(state.filter)}"><span class="badge">${filtered.length} collected signals</span></div><div class="card">${
      filtered
        .slice(start, start + 12)
        .map(
          (s) =>
            `<article class="listrow"><div class="socialavatar">${escape((s.authorName ?? s.source ?? "S").slice(0, 1))}</div><div class="grow"><div class="cardheader"><div class="sourceavatars"><strong>${escape(s.authorName ?? s.source)}</strong><span>${escape(s.source)} · v${s.sourceVersion ?? 1}</span></div>${badge(s.state)}</div><p class="signaltext">${escape(s.text)}</p>${s.attachments?.map((m) => `<div class="media">${icon(m.kind === "video" ? "video" : m.kind === "audio" ? "audio-lines" : "image")}<div><strong>${escape(m.kind)} attachment</strong><br>${escape(m.description)}<br><span class="small">Synthetic description · not a verified real-world recording</span></div></div>`).join("") ?? ""}<div class="sourceavatars">${icon("map-pin")}${escape(s.location ?? "Location not confirmed")} · ${ago(s.receivedAt)} ${action("Inspect source", "signal", s.id, "quiet")}</div></div></article>`,
        )
        .join("") ||
      empty(
        "No signals match. Sources will appear here after the first sync.",
        "radio",
      )
    }</div><div class="pagination">${start > 0 ? action("← Previous", "signalprev") : ""}${start + 12 < filtered.length ? action("More signals →", "signalnext") : ""}</div>`
  );
}
async function investigations() {
  const rows = await record("activity"),
    intake = await api("/api/automation");
  return (
    title(
      "Investigate what could unlock help.",
      "See real model activity, checked constraints and useful unanswered questions.",
      action(
        `${icon("sparkles")} Start investigation`,
        "investigate",
        "",
        "primary",
      ),
    ) +
    `<div class="toolbar"><span class="small">Automatic intake ${intake.policy.enabled ? "enabled" : "paused"} · ${intake.counts.pending ?? 0} source groups pending · ${intake.policy.hourlyCallLimit} calls / hour limit</span>${["admin", "commander"].includes(state.user.role) ? action(intake.policy.enabled ? "Pause automatic intake" : "Enable automatic intake", "automation", String(!intake.policy.enabled), "quiet") : ""}</div>${activityCard(rows[0])}<section class="card" style="margin-top:22px"><h2>Recent investigations</h2>${
      rows
        .slice(1, 7)
        .map(
          (a) =>
            `<div class="listrow"><div class="grow"><strong>${escape(a.state === "ready" ? "Response prepared" : a.state.replaceAll("_", " "))}</strong><p>${escape(a.reason ?? a.steps?.at(-1)?.label ?? "Recorded activity")}</p></div>${badge(a.state)}${action("Inspect", "activity", a.id)}</div>`,
        )
        .join("") || '<p class="sub">Earlier work will appear here.</p>'
    }<p class="note">A processing state describes model activity, never physical help or confirmed truth.</p></section>`
  );
}
async function review() {
  let page = state.reviewPage ?? 0,
    queue = await api("/api/decision-queue?offset=" + page * 12);
  if (page && queue.offset >= queue.total) {
    page = Math.max(0, Math.ceil(queue.total / 12) - 1);
    queue = await api("/api/decision-queue?offset=" + page * 12);
  }
  state.reviewPage = page;
  const rows = queue.rows,
    history = await api(
      "/api/decision-queue?history=true&offset=" +
        (state.historyPage ?? 0) * 12,
    ),
    total = queue.total;
  return (
    title(
      "The decision belongs to you.",
      "Understand the benefit, evidence and conditions before authorizing a response.",
    ) +
    `<section class="card">${table(
      ["Proposed response", "Priority", "State", "Pending conditions", ""],
      rows.map(
        (p) =>
          `<tr><td><strong>${escape(p.title)}</strong><small>${escape(p.benefit)}</small></td><td>${badge(p.priority)}</td><td>${badge(p.state)}</td><td>${p.conditions.filter((c) => !c.satisfied).length}</td><td>${action("Review", "proposal", p.id)}</td></tr>`,
      ),
    )}${!rows.length ? empty("No response is awaiting a decision. An investigation can produce a sourced proposal.", "clipboard-check") : ""}${total > 12 ? `<div class="toolbar"><span class="small">${page * 12 + 1}–${Math.min(total, page * 12 + 12)} of ${total} actionable responses</span>${page ? action("Previous", "review-page", String(page - 1), "quiet") : ""}${(page + 1) * 12 < total ? action("Next", "review-page", String(page + 1), "quiet") : ""}</div>` : ""}<details class="collapse" ${state.historyOpen ? "open" : ""}><summary>Decision & execution history · ${history.total} responses</summary>${history.rows.map((p) => `<div class="listrow"><div class="grow"><strong>${escape(p.title)}</strong>${badge(p.state)}</div>${action("Inspect", "proposal", p.id)}</div>`).join("")}${history.offset ? action("Earlier page", "history-page", String((state.historyPage ?? 0) - 1), "quiet") : ""}${history.offset + 12 < history.total ? action("Next history page", "history-page", String((state.historyPage ?? 0) + 1), "quiet") : ""}</details></section>`
  );
}
async function operations() {
  const rows = await record("operation");
  return (
    title(
      "From an order to useful help.",
      "Follow acknowledgements, travel and receipt. Arrival is not the same as service.",
      action(
        "Prepare an operational action",
        "operational-draft",
        "",
        "accent",
      ),
    ) +
    (await unloadingControls.view()) + `<section class="card">${table(
      ["Operation", "State", "Authorized by", "Latest confirmation", ""],
      rows.map(
        (o) =>
          `<tr><td><strong>${escape(o.type ?? o.kind ?? "Delivery")} · ${escape(o.id.slice(-8))}</strong><small>${number(o.quantity)} ${escape(o.unit ?? "units")} ${o.need ? "· need " + escape(o.need) : ""}</small></td><td>${badge(o.state)}${o.requiresRepair ? " " + badge("requires_review") : ""}</td><td>${escape(o.authorizedBy ?? "Source authority")}</td><td>${o.confirmedBySource ? "Operational source confirmed" : "Awaiting source acknowledgement"}</td><td>${action("Follow", "operation", o.id)}</td></tr>`,
      ),
    )}${!rows.length ? empty("No authorized physical operations yet. Draft proposals do not count as deliveries.", "truck") : ""}</section>`
  );
}
async function resources() {
  const [items, facilities, vehicles, dashboard] = await Promise.all(
    ["resource", "facility", "vehicle"].map((k) => record(k)).concat([api("/api/dashboard")]),
  );
  const usable = r => !["expired", "damaged", "quarantined"].includes(r.condition) &&
    (r.useByAt === undefined || Number.isFinite(dashboard.simulatedAt) && r.useByAt > dashboard.simulatedAt) &&
    (r.type !== "staff" || staffAvailabilityState(r, dashboard.simulatedAt).usable),
    available = r => usable(r) ? Math.max(0, Math.min(r.quantity - (r.reserved ?? 0) - (r.floor ?? 0), r.usableQuantity ?? Infinity)) : 0;
  return (
    title(
      "Know what can be committed.",
      "Availability includes reserve floors, existing commitments and owner permission.",
      action("Add a local resource", "addresource", "", "primary"),
    ) +
    `<section class="card"><div class="cardheader"><h2>Inventory & operational capacity</h2><span class="small">Source versions remain visible</span></div>${table(
      ["Resource", "Type", "Available", "Reserved", "Version", ""],
      items.map(
        (r) =>
          `<tr><td><strong>${escape(r.label ?? r.id)}</strong><small>${escape(r.owner)} · ${escape(r.node ?? "Location unknown")}${r.lotId ? " · Lot " + escape(r.lotId) : ""}${r.useByAt !== undefined ? " · " + escape(sourceExpiryLabel(r.useByAt, dashboard.simulatedAt)) : ""}</small></td><td>${escape(r.type)}</td><td>${number(available(r))} ${escape(r.unit ?? "units")}${r.type === "staff" ? " " + staffAvailabilityBadge(r, dashboard.simulatedAt, { escape, time: simulationClock }) : usable(r) ? "" : " " + badge(r.condition ?? "expired")}</td><td>${number(r.reserved)} <small>Protected floor: ${number(r.floor)}</small></td><td>v${r.version} ${r.sourceVersion ? "· source v" + r.sourceVersion : ""}</td><td>${usable(r) ? action("Reserve", "reserve", r.id) : ""} ${action("Share", "share", r.id)}</td></tr>`,
      ),
    )}${!items.length ? empty("Query inventory or sync your operational systems.", "package") : ""}</section><div class="grid cols2" style="margin-top:22px"><section class="card"><div class="cardheader"><h2>Facilities</h2>${action("Request facility check", "verifyform", "", "quiet")}</div>${
      facilities
        .slice(0, 8)
        .map(
          (f) =>
            `<div class="listrow"><div class="rowicon">${icon("building-2")}</div><div class="grow"><h3>${escape(f.id)} · ${escape(f.use ?? "Facility")}</h3><p>${f.safe === true ? "Safety inspection confirmed" : f.safe === false ? "Not safe for use" : "Safety has not been confirmed"} · ${escape(f.state ?? "Unknown operating state")}</p></div>${action("Investigate", "investigate-facility", f.id)}${badge(f.state ?? "unknown")}</div>`,
        )
        .join("") ||
      empty(
        "Facilities require a relevant assessment before activation.",
        "building-2",
      )
    }</section><section class="card"><h2>Transport</h2>${
      vehicles
        .slice(0, 8)
        .map(
          (v) =>
            `<div class="listrow"><div class="rowicon">${icon("truck")}</div><div class="grow"><h3>${escape(v.id)}</h3><p>Capacity ${number(v.capacity)} · ${escape(v.owner)} · position may be delayed</p>${driverAvailabilityBadge(v)}</div>${badge(v.state)}</div>`,
        )
        .join("") ||
      empty("No observed vehicles. Query your transport system.", "truck")
    }</section></div>`
  );
}
async function network() {
  const [offers, commitments, permissions] = await Promise.all(
    ["peer_offer", "commitment", "permission"].map((k) => record(k)),
  );
  return (
    title(
      "Independent teams. A connected response.",
      "Each organization controls its data, resources and authorizations. Connecting does not grant access to everything.",
    ) +
    `<div class="grid cols2"><section class="card"><div class="cardheader"><h2>Partner capabilities</h2>${badge("permissioned")}</div>${
      offers
        .filter((o) => o.active)
        .map(
          (o) =>
            `<div class="listrow"><div class="rowicon">${icon("network")}</div><div class="grow"><h3>${escape(o.projection?.type ?? o.kind)} · ${escape(o.from)}</h3><p>${o.projection?.available != null ? number(o.projection.available) + " available · " : ""}Shared v${o.sourceVersion}. An offer is not a confirmed commitment.</p></div>${badge(o.expiresAt < Date.now() ? "expired" : "shared")}</div>`,
        )
        .join("") ||
      empty(
        "No partner capabilities have been explicitly shared yet. A single instance remains usable.",
        "network",
      )
    }</section><section class="card"><div class="cardheader"><h2>Owner commitments</h2></div>${commitments.map((c) => `<div class="listrow"><div class="grow"><h3>${number(c.quantity)} · ${escape(c.resource)}</h3><p>For ${escape(c.requester)} · expires ${time(c.expiresAt)}<br>${c.conditions.length} conditions · authorized by ${escape(c.authorizedBy)}</p>${badge(c.state)}</div>${["reserved", "confirmed"].includes(c.state) ? action("Manage", "commitment", c.id) : ""}</div>`).join("") || empty("No reservations yet. Concurrent requests are checked transactionally.", "lock-keyhole")}</section></div><section class="card" style="margin-top:22px"><h2>What your organization shares</h2>${table(
      ["Record", "Partner", "Permission", ""],
      permissions.map(
        (p) =>
          `<tr><td>${escape(p.kind)} · ${escape(p.recordId)}</td><td>${escape(p.to)}</td><td>${badge(p.active ? "shared" : "withdrawn")}</td><td>${p.active ? action("Revoke", "revoke", p.id) : ""}</td></tr>`,
      ),
    )}${!permissions.length ? empty("Nothing is shared by default.", "shield-check") : ""}</section>`
  );
}
async function publications() {
  const rows = await record("publication");
  return (
    title(
      "Transparency that earns trust.",
      "Publish approved, understandable progress without exposing people or promising unconfirmed delivery.",
      action("Prepare an update", "draftpublication", "", "primary"),
    ) +
    `<div class="grid cols2">${rows.map((p) => `<article class="card"><div class="cardheader">${badge(p.state)}${badge(p.status)}</div><h2>${escape(p.title)}</h2><p class="sub">${escape(p.text)}</p><div class="note">${escape(p.area)} · ${p.publishedAt ? "Published " + time(p.publishedAt) : "Not visible to the public"}</div><div class="toolbar">${p.state === "draft" ? action("Review & publish", "publish", p.id, "primary") : ""}</div></article>`).join("") || `<section class="card">${empty("No update has been published. Drafts stay internal until a responsible person approves them.", "globe")}</section>`}</div>`
  );
}
async function finance() {
  const data = await api("/api/public"),
    usage = await api("/api/usage");
  const controls = await financeControls.view();
  return (
    title(
      "Shared support. Clear accounting.",
      "Pooled funds belong to the organization. Contributions are not promises to deliver one specific item.",
    ) +
    `<div class="metricrow">${[
      [
        "Settled support",
        money(data.finance.receivedCents),
        "Test-mode funds only",
      ],
      [
        "Allocated",
        money(data.finance.allocatedCents),
        "Recorded organizational allocations",
      ],
      [
        "Refunded",
        money(data.finance.refundedCents),
        "Reconciled provider events",
      ],
      [
        "Available",
        money(data.finance.availableCents),
        "Settled less refunds and allocations",
      ],
    ]
      .map(
        ([l, n, s]) =>
          `<div class="metric"><span class="label">${l}</span><strong>${n}</strong><span>${s}</span></div>`,
      )
      .join(
        "",
      )}</div>${controls}<section class="card"><div class="cardheader"><h2>Real model usage</h2><span class="small">Provider receipts, including failed attempts</span></div>${table(
      ["Episode", "Model", "State", "Tokens in / out", "Cost", "Wall time"],
      usage
        .slice(0, 15)
        .map(
          (u) =>
            `<tr><td>${escape(u.episode.slice(-10))}</td><td>${escape(u.model)}</td><td>${badge(u.state)}</td><td>${number(u.input_tokens)} / ${number(u.output_tokens)}</td><td>${u.cost_usd == null ? "Not reported" : "$" + Number(u.cost_usd).toFixed(6)}</td><td>${u.wall_ms == null ? "Pending" : (u.wall_ms / 1000).toFixed(1) + " s"}</td></tr>`,
        ),
    )}${!usage.length ? empty("No model call has been recorded.", "sparkles") : ""}</section><p class="note">The local payment provider exercises signatures, retries and refunds. External payment-provider onboarding is a separate integration.</p>`
  );
}
async function field() {
  const queue = (await offlineQueue("all")).filter(
    (r) => r.queueOrg === state.user.org && r.queueActor === state.user.id,
  );
  return (
    title(
      "Report from the field.",
      "Capture a need, restriction or receipt. Offline reports remain queued until the server acknowledges them.",
    ) +
    (await workforceControls.field()) +
    `<div class="grid split"><section class="card"><form id="fieldform" class="fieldform"><label>Report type<select name="kind"><option value="need">A need or situation</option><option value="receipt">Aid received</option><option value="road">Access restriction</option><option value="facility">Facility assessment</option><option value="correction">A correction</option><option value="voice">Voice note transcript</option></select></label><label>Location<input name="location" placeholder="Place name or known location ID" required></label><label>What did you observe?<textarea name="text" placeholder="Describe what you saw. Include quantities and uncertainty when known." required></textarea></label><label>When did it happen?<input name="observedAt" type="datetime-local" required value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></label><button class="primary" type="submit">${icon("send")} Save & send report</button></form></section><section class="card"><div class="cardheader"><h2>Delivery status</h2>${badge(state.offline ? "offline" : "connected")}</div><div id="fieldqueue">${queue.map((q) => `<div class="listrow"><div class="rowicon">${icon(q.lastError ? "circle-alert" : "clock")}</div><div class="grow"><h3>${escape(q.location)}</h3><p>${escape(String(q.text ?? "").slice(0, 150))}</p>${badge(q.lastError ? "requires_review" : "queued")} <span class="small">${q.lastError ? escape(q.lastError) : "Saved on this device. Not yet received."}</span>${q.lastError ? action("Resolve pending update", "queue-conflict", q.clientId, "accent") : ""}</div></div>`).join("") || empty("Your queued reports will appear here. Server confirmation is required before a report is marked received.", "check")}</div>${queue.length ? action("Retry queued reports", "flush", "", "accent") : ""}</section></div>`
  );
}
async function settings() {
  const sources = await record("source");
  const readiness = await organizationControls.summary();
  return (
    title(
      "Sources, permissions & continuity.",
      "Automatic ingestion is the default. Configure access once; operators should not copy every post manually.",
    ) +
    `<div class="grid cols2"><section class="card"><div class="cardheader"><h2>Connected sources</h2>${action("Sync now", "sync", "", "accent")}</div>${sources.map((s) => `<div class="listrow"><div class="rowicon">${icon("radio")}</div><div class="grow"><h3>Signal & operational gateway</h3><p>Last success ${s.lastSuccessAt ? ago(s.lastSuccessAt) : "not yet"}<br>Scoped organization data. No observer access.</p></div>${badge(s.state)}</div>`).join("") || empty("Start the local lab to provision the scoped source connector.", "radio")}<details class="collapse"><summary>What can be ingested?</summary><p class="sub">Public social posts and their revisions, images and voice-note descriptions, authorized field channels, official bulletins, operational inventory, vehicles, roads, facilities, staff, commitments and receipts. Real media tests are kept separate from synthetic descriptions.</p></details><div class="actions">${action("Query inventory", "lookup", "inventory")}${action("Query vehicles", "lookup", "vehicles")}${action("Query personnel", "lookup", "personnel")}${action("Query maps", "lookup", "map")}</div></section><section class="card"><h2>Roles & authority</h2><p class="sub">Analysts investigate. Commanders and dispatchers authorize operations. Publishers approve public updates. Field teams submit observations. Auditors inspect history.</p><details class="collapse"><summary>How does the model get permission?</summary><p class="sub">It does not inherit a human role. Model tools can query, verify and draft. Server checks remain authoritative regardless of source text or model output.</p></details>${state.user.role === "admin" ? action("Manage users", "users", "", "accent") : ""}<div class="warning">The model is ${escape(state.model)}. These results do not demonstrate Gemini performance; that requires a new evaluation.</div></section></div>` +
    readiness
  );
}
async function audit() {
  const rows = await api("/api/audit");
  return (
    title(
      "Every decision has an owner.",
      "The evidence snapshot and authorization history survive corrections and restarts.",
      ["admin", "commander", "auditor"].includes(state.user.role)
        ? action("Export records", "organization-export", "", "accent")
        : "",
    ) +
    `<section class="card">${table(
      ["Time", "Action", "Responsible actor", "Record", ""],
      rows.map(
        (r) =>
          `<tr><td>${time(r.occurred_at)}</td><td>${escape(r.action)}</td><td>${escape(r.actor)}</td><td>${escape(r.entity?.slice(-15) ?? "—")}</td><td>${action("Inspect", "auditdetail", String(r.sequence))}</td></tr>`,
      ),
    )}${!rows.length ? empty("No audited decisions yet.", "shield-check") : ""}</section>`
  );
}
const views = {
  media: extras.media,
  connections: extras.connections,
  moderation: extras.moderation,
  map: async () => {
    const data = await api("/api/map");
    return (
      title(
        "A map of what your team knows.",
        "Received needs and operating conditions. The map does not show hidden simulator truth.",
        action("Query maps", "lookup", "map") + action("Sync updates", "sync"),
      ) +
      operationalMap(data) +
      `<section class="card" style="margin-top:22px"><h2>Accessible list of unmet needs</h2>${
        data.needs
          .filter((n) => n.quantity > (n.served ?? 0))
          .slice(0, 30)
          .map(
            (n) =>
              `<div class="listrow"><div class="grow"><h3>${escape(n.type)} · ${escape(n.building)}</h3><p>${number(n.quantity - (n.served ?? 0))} ${escape(n.unit)} pending</p></div>${action("Review need", "need", n.id)}</div>`,
          )
          .join("") || empty("No unmet needs have reached your team.")
      }</section>`
    );
  },
  overview,
  signals,
  investigations,
  review,
  operations,
  resources,
  network,
  publications: publicationControls.view,
  finance,
  field,
  coordination: workforceControls.coordination,
  settings,
  audit,
};
async function render() {
  const version = ++renderVersion;
  const focused = document.activeElement,
    focusKey = focused?.dataset?.action
      ? { action: focused.dataset.action, id: focused.dataset.id ?? "" }
      : null;
  try {
    if (!visibleNav().some((n) => n[0] === state.page))
      state.page =
        state.user?.role === "field"
          ? "field"
          : (visibleNav()[0]?.[0] ?? "field");
    const page = state.page;
    const content = await (views[page] ?? overview)();
    // Navigation, sign-out or another refresh may finish before this request.
    // Never put stale content under the new page's navigation and heading.
    if (version !== renderVersion || page !== state.page || !state.user) return;
    shell(content);
    bindMap();
    if (focusKey)
      app
        .querySelector(
          `[data-action="${CSS.escape(focusKey.action)}"][data-id="${CSS.escape(focusKey.id)}"]`,
        )
        ?.focus({ preventScroll: true });
  } catch (e) {
    if (version !== renderVersion || !state.user) return;
    if (e.code === "AUTHENTICATION") {
      state.user = null;
      login();
    } else {
      shell(
        title(
          "Your workspace is retained.",
          "Something needs attention before this view can be loaded.",
        ) + `<div class="warning">${escape(e.message)}</div>`,
      );
    }
  }
}
function modal(name, content, footer = "") {
  document.querySelector("dialog")?.remove();
  dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.innerHTML = `<header class="dialoghead"><h2>${name}</h2><button class="iconbutton" aria-label="Close dialog" data-action="close">${icon("x")}</button></header><div class="dialogbody">${content}</div>${footer ? `<footer class="dialogfoot">${footer}</footer>` : ""}`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.onclose = () => {
    dialog.remove();
    dialog = null;
  };
  bind(dialog);
}
async function proposal(id) {
  state.delegatedReviews = (await api("/api/me")).delegatedReviews;
  const p = await record("proposal", id),
    canReview =
      ["commander", "dispatcher"].includes(state.user.role) ||
      state.delegatedReviews?.includes(id),
    pending = p.conditions.filter((c) => !c.satisfied);
  modal(
    "Review a response",
    `<div class="cardheader">${badge(p.state)}${badge(p.priority)}</div><h2>${escape(p.title)}</h2><div class="detailgrid" style="margin:22px 0"><div class="decision"><span class="eyebrow">What can we do?</span><p>${escape(p.summary)}</p></div><div class="decision"><span class="eyebrow">Who benefits?</span><p>${escape(p.benefit)}</p></div><div class="decision"><span class="eyebrow">Why is this viable?</span><p>${escape(p.rationale)}</p></div><div class="decision"><span class="eyebrow">What still needs checking?</span>${pending.length ? `<ul class="conditions">${pending.map((c) => `<li>${icon("circle-alert")}<span>${escape(c.description)}</span></li>`).join("")}</ul>` : "<p>No declared pending conditions. Verify the evidence before approving.</p>"}</div></div>${p.changedReason ? `<div class="warning">Changed: ${escape(p.changedReason)}. Previous authorization no longer applies.</div>` : ""}<details class="collapse"><summary>${p.references.length} evidence references</summary>${p.references.map((r) => `<div class="listrow"><code>${escape(r)}</code>${action("Open evidence", "evidence", r)}</div>`).join("")}</details><details class="collapse"><summary>Planned actions & responsible organizations</summary>${table(
      ["Step", "Action", "Owner", "Dependencies"],
      p.actions.map(
        (a, i) =>
          `<tr><td>${i + 1}</td><td>${escape(a.type)}</td><td>${escape(a.owner)}</td><td>${a.dependsOn.map((i) => i + 1).join(", ") || "None"}</td></tr>`,
      ),
    )}<pre class="trace">${escape(JSON.stringify(p.actions, null, 2))}</pre></details>${p.alternatives.length ? `<details class="collapse"><summary>Alternatives considered</summary>${p.alternatives.map((a) => `<p class="sub"><strong>${escape(a.title)}</strong><br>${escape(a.reason)}</p>`).join("")}</details>` : ""}${p.authorization ? `<p class="note">Authorized by ${escape(p.authorization.name)} at ${time(p.authorization.at)}. Evidence snapshot: ${escape(p.authorization.evidenceHash.slice(0, 16))}.</p>` : ""}${canReview && ["awaiting_review", "requires_review", "needs_clarification"].includes(p.state) ? `<label>Decision note<textarea id="reviewnote" placeholder="Record constraints, clarification or the reason for your decision."></textarea></label>${pending.length ? `<label class="checkbox"><input type="checkbox" id="allowconditional">Authorize a conditional reservation only. Physical execution remains blocked until conditions are checked and a new authorization is given.</label>` : ""}` : ""}`,
    canReview &&
      ["awaiting_review", "requires_review", "needs_clarification"].includes(
        p.state,
      )
      ? `${p.state === "requires_review" ? action("Investigate a repair", "repair", id) : ""}${!p.executionResults?.length ? action("Edit draft", "edit-response", id) : ""}${action("Ask for clarification", "reviewclarify", id)}${action("Reject", "reviewreject", id, "danger")}${action(pending.length ? "Authorize conditionally" : "Authorize response", "reviewapprove", id, "primary")}`
      : action("Close", "close"),
  );
  state.currentProposal = p;
  if (p.sourceReview?.state === "pending") {
    const sourceReview = document.createElement("p");
    sourceReview.className = "note";
    sourceReview.textContent = "Locally authorized · waiting for operational owner review.";
    dialog.querySelector(".dialogbody").insertBefore(sourceReview, dialog.querySelector(".detailgrid"));
  }
  const scope = document.createElement("section");
  scope.className = "decision";
  scope.innerHTML = `<span class="eyebrow">EXACT CURRENT COMMITMENT · VERSION ${p.version}</span><ul class="conditions">${p.actions
    .slice(0, 3)
    .map(
      (a) =>
        `<li><span><strong>${escape(a.owner)}</strong> · ${escape(actionBrief(a))}</span></li>`,
    )
    .join(
      "",
    )}</ul>${p.actions.length > 3 ? `<p class="small">${p.actions.length - 3} additional steps are in the action table. Review every owner and dependency before authorizing.</p>` : ""}<p class="note">These current typed actions define the authorization; a descriptive summary cannot override them.</p>`;
  dialog
    .querySelector(".dialogbody")
    .insertBefore(scope, dialog.querySelector(".detailgrid"));
  if (p.repairOf) {
    const summary = document.createElement("details");
    summary.className = "collapse";
    summary.innerHTML = `<summary>Repair of an earlier response · ${(p.inheritedWork ?? []).length} physical steps preserved</summary><p class="sub">${escape(p.repairReason)}. Completed work remains historical; the new decision authorizes only prospective actions.</p>${(p.inheritedWork ?? []).map((w) => `<p class="small">${escape(w.action.type)} · ${escape(w.state.replaceAll("_", " "))} · source receipt ${escape(w.operationId ?? w.receipt?.id ?? "partner confirmation")}</p>`).join("")}`;
    const body = dialog.querySelector(".dialogbody");
    body.insertBefore(
      summary,
      body.querySelector("#reviewnote")?.closest("label") ?? null,
    );
  }
}
async function sourceDetail(id) {
  const s = await record("signal", id);
  const context = await caseControls.context(id);
  modal(
    "Original source & context",
    `<div class="sourceavatars"><div class="socialavatar">${escape((s.authorName ?? "S")[0])}</div><strong>${escape(s.authorName ?? s.source)}</strong>${badge(s.state)}</div><hr class="divider"><p class="signaltext">${escape(s.text)}</p><div class="detailgrid"><div class="decision"><span class="eyebrow">Publication</span><p>Simulation timestamp: ${number(s.publishedAt)} ms<br>Collected ${time(s.receivedAt)}</p></div><div class="decision"><span class="eyebrow">Location & version</span><p>${escape(s.location ?? "Not confirmed")}<br>Source version ${s.sourceVersion}</p></div></div><p class="note">A collected post is not a verified fact. Its original references are kept to detect repeated or dependent reports.</p><pre class="trace">${escape(JSON.stringify({ references: s.originalReferences ?? s.references, attachments: s.attachments, contentHash: s.contentHash }, null, 2))}</pre>`,
    action("Investigate this signal", "investigatesignal", id, "primary") + (["admin", "commander"].includes(state.user.role) ? action("Review local erasure", "erase-source", id) : ""),
  );
  const review = document.createElement("div");
  review.innerHTML = context;
  document.querySelector(".dialogbody").append(review);
  bind(review);
}
async function activityDetail(id) {
  const a = await record("activity", id);
  modal(
    "Observed investigation activity",
    `<div class="cardheader">${badge(a.state)}<span class="small">${escape(a.model)} · ${a.calls ?? "…"} calls</span></div><p class="sub">These are tool requests, returned results and a short decision rationale. They are not a private chain of thought.</p>${a.steps.map((s) => `<details class="collapse"><summary>${escape(s.label ?? s.tool)} · ${escape(s.state)}</summary><pre class="trace">${escape(JSON.stringify({ parameters: s.params, result: s.result }, null, 2))}</pre></details>`).join("")}${a.reason ? `<div class="warning">${escape(a.reason)}</div>` : ""}`,
    a.proposalId
      ? action("Review response", "proposal", a.proposalId, "primary")
      : a.semanticReceipt ? action("Inspect interpretations", "semantic-receipt", a.semanticReceipt, "primary") : action("Close", "close"),
  );
}
async function operationDetail(id) {
  const o = await record("operation", id);
  const stages = [
      "ordered",
      "acknowledged",
      "loading",
      "dispatched",
      "arrived",
      "received",
      "service",
    ],
    times = o.times ?? {},
    last = Math.max(-1, ...stages.map((s, i) => (times[s] != null ? i : -1)));
  modal(
    "Follow the operation",
    `<div class="cardheader"><h2>${escape(o.type ?? "Aid delivery")}</h2>${badge(o.state)}</div><div class="stepper">${stages.map((s, i) => `<div class="step ${i <= last ? "done" : ""} ${i === last ? "active" : ""}">${s.replace("dispatched", "In transit").replace("acknowledged", "Accepted")}</div>`).join("")}</div><div class="detailgrid"><div class="decision"><span class="eyebrow">What is confirmed?</span><p>${o.times?.received != null ? "Receipt recorded by the operational source." : o.times?.arrived != null ? "Vehicle has arrived. Receipt is still pending." : "The operation has not yet reached confirmed receipt."}</p></div><div class="decision"><span class="eyebrow">Responsible owner</span><p>${escape(o.authorizedBy ?? "Source authority")}<br>${escape(o.owner ?? state.user.org)}</p></div></div>${o.requiresRepair ? `<div class="warning" style="margin-top:20px">${escape(o.changedReason ?? "A dependency changed. Review the affected plan.")}</div>` : ""}<details class="collapse"><summary>Operational record & timestamps</summary><pre class="trace">${escape(JSON.stringify(o, null, 2))}</pre></details>`,
    (["commander", "dispatcher"].includes(state.user.role)
      ? action("Assign field task", "task-assign", o.id, "accent")
      : "") +
      (o.proposalId
        ? action(
            "Re-investigate affected plan",
            "repair",
            o.proposalId,
            "accent",
          )
        : action("Close", "close")),
  );
}
async function flush() {
  if (!navigator.onLine) return;
  try {
    const me = await api("/api/me");
    state.user = me.user;
    state.csrf = me.user.csrf;
    state.model = me.model;
    cacheSession();
  } catch (e) {
    toast(
      "Sign in again before sending saved reports. Your queued observations remain on this device.",
    );
    return;
  }
  const q = await offlineQueue("all");
  let sent = 0;
  for (const item of q) {
    if (item.queueOrg !== state.user.org || item.queueActor !== state.user.id)
      continue;
    try {
      const {
        queueOrg,
        queueActor,
        queueKind,
        taskPayload,
        lastError,
        errorCode,
        ...payload
      } = item;
      await api(
        queueKind === "task" ? "/api/task/update" : "/api/report",
        queueKind === "task"
          ? { ...taskPayload, idempotencyKey: item.clientId }
          : payload,
      );
      await offlineQueue("delete", item.clientId);
      sent++;
    } catch (e) {
      if (!navigator.onLine) break;
      await offlineQueue("put", {
        ...item,
        lastError: e.message,
        errorCode: e.code,
      });
      toast(e.message);
      break;
    }
  }
  if (sent)
    toast(
      `${sent} field update${sent === 1 ? "" : "s"} received by the server.`,
    );
  if (state.page === "field") await render();
}
async function runAction(name, id) {
  if (await responseControls.run(name, id)) return;
  if (await coverageControls.run(name, id)) return;
  if (await organizationControls.run(name, id)) return;
  if (await caseControls.run(name, id)) return;
  if (await publicationControls.run(name, id)) return;
  if (name === "queue-conflict") {
    const item = (await offlineQueue("all")).find(
      (r) =>
        r.clientId === id &&
        r.queueActor === state.user.id &&
        r.queueOrg === state.user.org,
    );
    if (!item) return;
    state.queueConflict = item;
    let current;
    if (item.queueKind === "task" && navigator.onLine)
      current = (await api("/api/tasks")).find(
        (t) => t.id === item.taskPayload.id,
      );
    modal(
      "Resolve a pending update",
      `<p class="warning">${escape(item.lastError)}</p><h3>Your saved observation</h3><p>${escape(item.text)}</p>${current ? `<p class="sub">Current acknowledged task: ${escape(current.state.replaceAll("_", " "))}, version ${current.version}. The saved update used version ${item.taskPayload.version}.</p>` : ""}<p class="note">No newer instruction will be overwritten automatically. You can preserve this as a field observation, then open the current task to choose the correct next stage.</p>`,
      `${action("Keep as a field observation", "queue-as-observation", id, "primary")}${action("Close", "close")}`,
    );
    return;
  }
  if (name === "queue-as-observation") {
    const item = state.queueConflict;
    if (!item || item.clientId !== id) return;
    const observation = {
      clientId: crypto.randomUUID(),
      queueOrg: state.user.org,
      queueActor: state.user.id,
      kind: "correction",
      location: item.location,
      text: `Offline update could not be reconciled automatically: ${item.text}. ${item.lastError}. This is an observation, not a confirmation of physical receipt.`,
      observedAt: Date.now(),
      references: [],
    };
    await offlineQueue("put", observation);
    await offlineQueue("delete", item.clientId);
    dialog.close();
    await flush();
    await render();
    return;
  }
  if (await workforceControls.run(name, id)) return;
  if (await extras.run(name, id)) return;
  if (name === "operational-draft") {
    await operational.open();
    return;
  }
  if (name === "review-page") {
    state.reviewPage = Math.max(0, Number(id) || 0);
    await render();
    document.querySelector("#main h1")?.focus();
    return;
  }
  if (name === "history-page") {
    state.historyPage = Math.max(0, Number(id) || 0);
    state.historyOpen = true;
    await render();
    return;
  }
  if (name === "close") {
    dialog?.close();
    return;
  }
  if (name === "navigate") {
    state.page = id;
    location.hash = id;
    await render();
    return;
  }
  if (name === "logout") {
    await api("/api/logout", {});
    sessionStorage.removeItem("nexo-workspace");
    state.user = null;
    login();
    return;
  }
  if (name === "sync") {
    await api("/api/sync", {});
    toast("Source sync queued. Original reports arrive automatically.");
    return;
  }
  if (name === "automation") {
    await api("/api/automation", { enabled: id === "true" });
    toast(
      id === "true"
        ? "Automatic, budgeted inquiry enabled. Human decisions remain required."
        : "Automatic intake paused. Current inquiries can be stopped individually.",
    );
    await render();
    return;
  }
  if (name === "stop-inquiry") {
    await api("/api/investigation/stop", { id });
    toast("Stop requested. Completed reads and costs remain recorded.");
    await render();
    return;
  }
  if (name === "investigate-facility") {
    await api("/api/investigate", { facilityId: id });
    state.page = "investigations";
    location.hash = state.page;
    await render();
    return;
  }
  if (["investigate", "investigatesignal", "repair"].includes(name)) {
    await api("/api/investigate", {
      ids: name === "investigatesignal" ? [id] : [],
      repairOf: name === "repair" ? id : null,
    });
    toast("Investigation queued. The model will check evidence and options.");
    dialog?.close();
    state.page = "investigations";
    location.hash = state.page;
    await render();
    return;
  }
  if (name === "proposal") return proposal(id);
  if (name === "signal") return sourceDetail(id);
  if (name === "activity") return activityDetail(id);
  if (name === "operation") return operationDetail(id);
  if (name === "evidence") {
    try {
      const found = await api("/api/evidence?" + new URLSearchParams({ id })),
        r = found.record;
      if (found.kind === "signal") return sourceDetail(id);
      if (found.kind === "media" || found.kind === "media_analysis")
        return extras.run(
          "media-open",
          found.kind === "media" ? id : r.mediaId,
        );
      modal(
        "Evidence record",
        `<pre class="trace">${escape(JSON.stringify(r, null, 2))}</pre>`,
      );
      return;
    } catch {}
    toast(
      "Source is no longer accessible. Its decision snapshot remains in the audit record.",
    );
    return;
  }
  if (name.startsWith("review")) {
    const p = state.currentProposal;
    const decision = {
      reviewapprove: "approve",
      reviewreject: "reject",
      reviewclarify: "clarify",
    }[name];
    await api("/api/review", {
      id: p.id,
      version: p.version,
      decision,
      note: document.querySelector("#reviewnote")?.value ?? "",
      allowConditional:
        document.querySelector("#allowconditional")?.checked ?? false,
    });
    dialog?.close();
    toast(
      decision === "approve"
        ? "Authorization recorded. Execution still requires valid conditions."
        : "Decision recorded.",
    );
    await render();
    return;
  }
  if (name === "lookup") {
    await api("/api/query", { target: id });
    toast("Operational query sent. Its result will arrive through the source.");
    return;
  }
  if (name === "signalnext" || name === "signalprev") {
    state.signalPage += name === "signalnext" ? 1 : -1;
    await render();
    return;
  }
  if (name === "need") return extras.run("case", id);
  if (name === "legacyneed") {
    const n = await record("need", id);
    modal(
      "Known need",
      `<h2>${escape(n.type)} · ${escape(n.building)}</h2><div class="metric"><span>Still needed</span><strong>${number(n.quantity - n.served)} ${escape(n.unit)}</strong></div><p class="note">Observed data can be delayed. A need is not an authorization to consume resources.</p>`,
      action("Request field verification", "verifyneed", id, "accent") +
        action("Investigate options", "investigate", "", "primary"),
    );
    return;
  }
  if (name === "verifyneed") {
    await api("/api/verify", { target: "need", id });
    toast("Verification requested. It may return late or inconclusive.");
    return;
  }
  if (name === "verifyform") {
    modal(
      "Request a verification",
      `<form id="verifyform"><label>Target<select name="target"><option value="building">Facility safety / suitability</option><option value="road">Road access</option><option value="resource">Resource availability</option><option value="need">Current need</option></select></label><label>Known ID<input name="id" required></label><button class="primary">Request check</button></form>`,
    );
    document.querySelector("#verifyform").onsubmit = async (e) => {
      e.preventDefault();
      await api("/api/verify", Object.fromEntries(new FormData(e.target)));
      dialog.close();
      toast("Verification requested.");
    };
    return;
  }
  if (name === "addresource") {
    modal(
      "Add a local resource",
      `<form id="resourceform"><label>Resource type<select name="type"><option>water</option><option>food</option><option>energy</option><option>sanitation</option><option>medical</option><option>staff</option><option>shelter</option></select></label><div class="detailgrid"><label>Quantity<input name="quantity" type="number" min="0" required></label><label>Protected reserve floor<input name="floor" type="number" min="0" value="0"></label></div><label>Unit<input name="unit" required placeholder="L, kits, kW, staff hours…"></label><label>Location / node<input name="node" placeholder="Known location ID"></label><button class="primary">Save resource</button></form>`,
    );
    document.querySelector("#resourceform").onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      await api("/api/resource", {
        ...d,
        quantity: Number(d.quantity),
        floor: Number(d.floor),
      });
      dialog.close();
      toast("Local resource recorded.");
      await render();
    };
    return;
  }
  if (name === "reserve") {
    const r = await record("resource", id);
    modal(
      "Reserve with an owner",
      `<p class="sub">${escape(r.id)} · ${number(r.quantity - r.reserved - r.floor)} ${escape(r.unit)} available. Reserving does not mean an item has been dispatched.</p><form id="reserveform"><label>Quantity<input name="quantity" type="number" min="1" max="${r.quantity - r.reserved - r.floor}" required></label><label>Receiving organization<input name="requester" value="${escape(state.user.org)}" required></label><label>Validity in minutes<input name="minutes" type="number" min="1" max="1440" value="15"></label><button class="primary">Confirm reservation</button></form>`,
    );
    document.querySelector("#reserveform").onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      await api("/api/reserve", {
        resource: r.id,
        version: r.version,
        quantity: Number(d.quantity),
        requester: d.requester,
        ttlMs: Number(d.minutes) * 60000,
      });
      dialog.close();
      toast("Reservation recorded with expiry and ownership.");
      await render();
    };
    return;
  }
  if (name === "share") {
    const r = await record("resource", id);
    modal(
      "Share a capability",
      `<p class="sub">Only availability, type, location, compatibility and owner are shared. Private documents remain in your instance.</p><form id="shareform"><label>Partner organization ID<input name="to" required placeholder="org1"></label><button class="primary">Share capability</button></form>`,
    );
    document.querySelector("#shareform").onsubmit = async (e) => {
      e.preventDefault();
      await api("/api/share", {
        kind: "resource",
        id: r.id,
        version: r.version,
        to: new FormData(e.target).get("to"),
      });
      dialog.close();
      toast("Signed partner update queued.");
    };
    return;
  }
  if (name === "revoke") {
    const p = await record("permission", id),
      r = await record(p.kind, p.recordId);
    await api("/api/share", {
      kind: p.kind,
      id: p.recordId,
      version: r.version,
      to: p.to,
      revoke: true,
    });
    toast("Revocation queued. Dependent partner responses will need review.");
    await render();
    return;
  }
  if (name === "commitment") {
    const c = await record("commitment", id);
    modal(
      "Owner commitment",
      `<p class="sub">${number(c.quantity)} units of ${escape(c.resource)} for ${escape(c.requester)}.</p><div class="note">${badge(c.state)} · expires ${time(c.expiresAt)}</div><pre class="trace">${escape(JSON.stringify(c.conditions, null, 2))}</pre>`,
      action("Withdraw", "withdraw", id, "danger") +
        action("Confirm conditions", "confirmcommitment", id, "primary"),
    );
    state.currentCommitment = c;
    return;
  }
  if (name === "withdraw" || name === "confirmcommitment") {
    const c = state.currentCommitment;
    await api("/api/commitment", {
      id: c.id,
      version: c.version,
      action: name === "withdraw" ? "withdraw" : "confirm",
    });
    dialog.close();
    toast("Commitment updated. Affected dependencies are reviewed.");
    await render();
    return;
  }
  if (name === "draftpublication") {
    modal(
      "Prepare a public update",
      `<form id="publicationform"><label>Title<input name="title" required maxlength="140" placeholder="Water support for East District"></label><label>Public area<input name="area" required placeholder="East District · approximate area"></label><label>Confirmed status<select name="status"><option value="support_needed">Support needed</option><option value="en_route">On the way</option><option value="received">Received</option></select></label><label>Public explanation<textarea name="text" required placeholder="Explain what is needed, what is confirmed and what remains pending. No personal details."></textarea></label><button class="primary">Save internal draft</button></form>`,
    );
    document.querySelector("#publicationform").onsubmit = async (e) => {
      e.preventDefault();
      await api(
        "/api/publication/draft",
        Object.fromEntries(new FormData(e.target)),
      );
      dialog.close();
      toast("Draft saved. It is not public yet.");
      await render();
    };
    return;
  }
  if (name === "publish") {
    const p = await record("publication", id);
    modal(
      "Approve the public update",
      `<h2>${escape(p.title)}</h2><p class="sub">${escape(p.text)}</p><div class="warning">You are approving this aggregate public update. Check accuracy, privacy and the difference between dispatch and receipt.</div>`,
      action("Publish approved update", "publishconfirm", id, "primary"),
    );
    state.currentPublication = p;
    return;
  }
  if (name === "publishconfirm") {
    const p = state.currentPublication;
    await api("/api/publication/publish", { id: p.id, version: p.version });
    dialog.close();
    toast("Approved update published to the public portal.");
    await render();
    return;
  }
  if (name === "flush") return flush();
  if (name === "auditdetail") {
    const r = (await api("/api/audit")).find((a) => String(a.sequence) === id);
    modal(
      "Decision history",
      `<pre class="trace">${escape(JSON.stringify(r, null, 2))}</pre>`,
    );
    return;
  }
  if (name === "users") {
    const users = await api("/api/users");
    modal(
      "Organization access",
      table(
        ["User", "Role", "Status"],
        users.map(
          (u) =>
            `<tr><td>${escape(u.email)}</td><td>${escape(u.role)}</td><td>${u.active ? `Active ${u.id !== state.user.id ? action("Revoke access", "user-revoke", u.id, "quiet") : ""}` : "Revoked"}</td></tr>`,
        ),
      ) +
        `<details class="collapse"><summary>Add an organization account</summary><form id="newuserform" class="fieldform"><label>Name<input name="name" required maxlength="120"></label><label>Email<input name="email" type="email" required></label><label>Role<select name="role">${["field", "analyst", "dispatcher", "commander", "publisher", "finance", "auditor", "admin"].map((r) => `<option>${r}</option>`).join("")}</select></label><label>Initial local password<input name="password" type="password" minlength="12" required autocomplete="new-password"></label><p class="note">Technical administration does not authorize operational decisions. Assign the smallest suitable role.</p><button class="primary">Create account</button></form></details>`,
    );
    document.querySelector("#newuserform").onsubmit = async (ev) => {
      ev.preventDefault();
      await api("/api/users", Object.fromEntries(new FormData(ev.target)));
      toast("Account created within this organization.");
      await runAction("users", "");
    };
    return;
  }
  if (name === "user-revoke") {
    await api("/api/users", { revoke: id });
    toast("Access revoked. Existing sessions are no longer valid.");
    await runAction("users", "");
    return;
  }
}
function bind(root = app) {
  unloadingControls.bind(root);
  organizationControls.bind(root);
  caseControls.bind(root);
  publicationControls.bind(root);
  workforceControls.bind(root);
  financeControls.bind(root);
  extras.bind(root);
  root.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        state.page = b.dataset.page;
        location.hash = state.page;
        render();
      }),
  );
  root.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await runAction(b.dataset.action, b.dataset.id);
        } catch (e) {
          toast(e.message);
        } finally {
          b.disabled = false;
        }
      }),
  );
  root.querySelector(".mobile-nav")?.addEventListener("change", (e) => {
    state.page = e.target.value;
    location.hash = state.page;
    render();
  });
  root.querySelector("#signalfilter")?.addEventListener("input", (e) => {
    state.filter = e.target.value;
    state.signalPage = 0;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      const pos = e.target.selectionStart;
      await render();
      const i = document.querySelector("#signalfilter");
      i?.focus();
      i?.setSelectionRange(pos, pos);
    }, 350);
  });
  root.querySelector("#fieldform")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await offlineQueue("put", {
      ...d,
      clientId: crypto.randomUUID(),
      observedAt: new Date(d.observedAt).getTime(),
      references: [],
      queueOrg: state.user.org,
      queueActor: state.user.id,
    });
    toast("Report saved on this device.");
    if (navigator.onLine) await flush();
    else await render();
  });
}
async function publicView() {
  const d = await api("/api/public");
  app.innerHTML = `<div class="publicshell"><header class="publicnav"><div class="brand"><img src="/mark.svg" alt="">nexo.</div><span class="small">${escape(d.organization.name)} · Approved response updates</span><a href="/">Team sign in ${icon("arrow-up-right")}</a></header><main class="publicmain" id="main"><div class="publichero"><span class="eyebrow">A PUBLIC WINDOW INTO DISASTER RESPONSE</span><h1>Know what's needed.<br><span class="gradient">See help moving forward.</span></h1><p>Support the organization and follow shared progress. Clear status, useful evidence and honest uncertainty build informed trust.</p></div><div class="grid cols3">${d.updates.map((p) => `<article class="card publiccard ${escape(p.status)}"><div class="topicon">${icon(p.status === "support_needed" ? "heart-handshake" : p.status === "en_route" ? "truck" : p.status === "retracted" ? "circle-alert" : "package-check")}</div>${badge(p.status)}<h2 style="margin-top:18px">${escape(p.title)}</h2><p>${escape(p.text)}</p><div class="note">${escape(p.area)} · ${p.status === "retracted" ? "withdrawn" : "approved"} ${time(p.publishedAt)}${p.corrected ? " · corrected update" : ""}</div>${(p.proofs ?? []).map((f) => `<figure class="publicproof"><img src="${escape(f.url)}" alt="${escape(f.caption)}" loading="lazy"><figcaption>${escape(f.caption)} · reviewed delivery evidence</figcaption></figure>`).join("")}</article>`).join("") || `<section class="card">${empty("The organization has not published an approved update yet. Unverified reports stay in its internal workspace.", "globe")}</section>`}</div><div class="grid cols2" style="margin-top:28px"><section class="card"><span class="eyebrow">POOLED ORGANIZATIONAL SUPPORT</span><h2>Support the next useful response.</h2><p class="sub">Funds support what the organization needs most at the time. Your contribution is not tied to a particular medicine, truck or individual item.</p><form id="contributeform"><label>Test contribution in USD<input name="amount" type="number" min="1" max="100000" value="25" required></label><button class="primary">Try test contribution ${icon("arrow-right")}</button></form><p class="note">Local sandbox · No money is collected.</p></section><section class="card soft"><span class="eyebrow">AGGREGATE TRANSPARENCY · TEST FUNDS</span><div class="fundnumber">${money(d.finance.receivedCents)}</div><p class="sub">Settled organizational support</p><hr class="divider"><div class="cardheader"><span class="small">Allocated</span><strong>${money(d.finance.allocatedCents)}</strong></div><div class="cardheader"><span class="small">Refunded</span><strong>${money(d.finance.refundedCents)}</strong></div><div class="cardheader"><span class="small">Available</span><strong>${money(d.finance.availableCents)}</strong></div><p class="note">An approved update is not a guarantee of future outcomes. Dispatch, arrival, receipt and actual help remain different stages.</p></section></div>${publicProcurement(d.financeReview, escape, time)}<details class="collapse" style="margin-top:32px"><summary>How should I read these updates?</summary><p class="sub">Support needed means the response still has an unmet requirement. On the way means an authorized operation is travelling; it has not yet been received. Received means the organization has recorded a receipt. The organization approves every public update. Personal details and sensitive locations are omitted.</p></details><div class="footnote">NEXO · Local prototype · Test payments only · ${escape(d.privacy)}</div></main></div>`;
  document.querySelector("#contributeform").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const amountCents = Math.round(
        Number(new FormData(e.target).get("amount")) * 100,
      );
      const r = await api("/api/contribute", { amountCents });
      modal(
        "Test contribution created",
        `<div class="success">${money(r.amountCents)} · pending test payment</div><p class="sub">No money was collected. A signed provider confirmation is required before these funds count as settled.</p>`,
      );
    } catch (e) {
      toast(e.message);
    }
  };
}
async function communityView() {
  app.innerHTML = `<div class="publicshell"><header class="publicnav"><div class="brand"><img src="/mark.svg" alt="">nexo.</div><a href="/public">Response updates</a></header><main class="publicmain" id="main"><div class="publichero"><span class="eyebrow">COMMUNITY ACCESS</span><h1>Make a need visible.</h1><p>Tell the response team what is happening. Public reports enter a review queue; reporting does not guarantee an immediate dispatch.</p></div><section class="card"><form id="communityform" class="fieldform"><label>Location<input name="location" required placeholder="An approximate place or district"></label><label>Photo or audio recording<input name="attachment" type="file" accept="image/png,image/jpeg,audio/wav,audio/mpeg"></label><p class="note">Optional · up to 2 MB. You can send source media without writing a description. Avoid identifiable people and sensitive details.</p><label>What is needed? <span class="small">Optional when attaching media</span><textarea name="text" maxlength="6000" placeholder="Describe the situation and quantities, if known."></textarea></label><button class="primary">Submit for review</button></form><p class="note">No account required. This channel needs an internet connection and is not guaranteed to be monitored continuously. Reports and attachments stay private until the organization reviews them.</p></section></main></div>`;
  let pendingSubmission;
  document.querySelector("#communityform").onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    try {
      const attachment = await readAttachment(data.get("attachment"));
      if (!attachment && !String(data.get("text")).trim())
        throw new Error("Add a short description or a photo/audio recording.");
      const signature = JSON.stringify({
        location: data.get("location"),
        text: data.get("text"),
        attachment,
      });
      if (pendingSubmission?.signature !== signature)
        pendingSubmission = {
          signature,
          clientId: crypto.randomUUID(),
          observedAt: Date.now(),
        };
      const r = await api("/api/community/report", {
        location: String(data.get("location")),
        text: String(data.get("text")),
        attachment,
        clientId: pendingSubmission.clientId,
        kind: "need",
        observedAt: pendingSubmission.observedAt,
        references: [],
      });
      modal(
        "Report received for review",
        `<div class="success">${escape(r.notice)}</div>`,
      );
      pendingSubmission = null;
      e.target.reset();
    } catch (e) {
      toast(e.message);
    }
  };
}
window.addEventListener("online", () => {
  state.offline = false;
  toast("Connection restored. Queued field reports can be retried.");
  if (state.user) flush();
});
window.addEventListener("offline", () => {
  state.offline = true;
  toast("Offline. Field reports will be saved on this device.");
});
window.addEventListener("hashchange", () => {
  if (!state.user) return;
  state.page = location.hash.slice(1) || "overview";
  if (!dialog) render();
});
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
if (location.pathname === "/public") await publicView();
else if (location.pathname === "/community") await communityView();
else
  try {
    const me = await api("/api/me");
    state.user = me.user;
    state.csrf = me.user.csrf;
    state.model = me.model;
    cacheSession();
    if (location.pathname === "/field") state.page = "field";
    await render();
  } catch {
    let cached;
    try {
      cached = JSON.parse(sessionStorage.getItem("nexo-workspace"));
    } catch {}
    if (!navigator.onLine && cached?.expiresAt > Date.now()) {
      state.user = cached.user;
      state.model = cached.model;
      state.page = "field";
      state.offline = true;
      await render();
    } else login();
  }
setInterval(async () => {
  if (
    polling ||
    !state.user ||
    dialog ||
    !navigator.onLine ||
    !["overview", "investigations", "operations"].includes(state.page) ||
    document.activeElement?.matches("input,textarea,select")
  )
    return;
  polling = true;
  const scroll = window.scrollY;
  try {
    await render();
    window.scrollTo(0, scroll);
  } finally {
    polling = false;
  }
}, 4500);
