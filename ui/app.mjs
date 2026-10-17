import { entityLabel, resourceLabel, humanLabel, readableText, registerDisplayRecords, setDisplayContext, labelHints } from "./labels.mjs";
import { createPortalViews } from "./portal.mjs";
import { agentMonitor } from "./autonomy.mjs";
import { createLiveWorkspace, freshnessNotice } from "./live.mjs";
import { createDecisionExperience } from "./decision.mjs";
import { offlineQueue } from "./offline.mjs";
import { createPresentation, displayModel, rememberPresentation, restorePresentation } from "./presentation.mjs";
import { createActivityView } from "./activity.mjs";
import { icons } from "./icons.mjs";
import { operationalMap, bindMap } from "./map.mjs";
import { createExtras } from "./extras.mjs";
import { createOperationalDraft } from "./operational.mjs";
import { createOperationView } from "./operation-view.mjs";
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
import { receivedLocations, localResourceInput, localResourceForm, registrationGuide } from "./registration.mjs";
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
    "aidscaler-workspace",
    JSON.stringify({
      user: state.user,
      model: state.model,
      organization: state.organization,
      expiresAt: Number(state.user.expiresAt) || Date.now() + 8 * 3600000,
    }),
  );
}
function toast(s) {
  if (dialog?.open) {
    let notice=dialog.querySelector('[data-dialog-message]');
    if(!notice){notice=document.createElement('p');notice.dataset.dialogMessage='true';notice.className='dialog-inline-notice';notice.setAttribute('role','status');dialog.querySelector('.dialogbody').prepend(notice);}
    notice.textContent=s;notice.scrollIntoView({block:'nearest'});return;
  }
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
    e.httpStatus = response.status;
    throw e;
  }
  return result;
}
const record = async (kind, id) => {
  const rows = await api("/api/records?" + new URLSearchParams({ kind, ...(id ? { id } : {}) }));
  registerDisplayRecords(kind, rows);
  return rows;
};
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
const portalViews = createPortalViews({ api, escape, icon, money, time, publicProcurement, readAttachment, toast });
const decisionExperience = createDecisionExperience({ api, escape, icon, badge, action, time, state });
const liveWorkspace = createLiveWorkspace({api, state, escape, icon, renderActivityMetadata:a=>activityView.metadata(a,{model:state.model})});
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
const presentation = createPresentation({ escape, icon, badge, action, table, empty, number, time, state });
const activityView = createActivityView({ escape, icon, action, time, labelModel: displayModel });
const operationView = createOperationView({ escape, badge, action, number });
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
    "interpret-page": ["analyst", "commander", "dispatcher"],
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
  app.innerHTML = `<div class="login"><div class="loginaside"><div class="brand"><img src="/mark.svg" alt="">AidScaler.</div><div><span class="eyebrow">DISASTER RESPONSE · LOCAL WORKSPACE</span><h1>Scattered signals.<br>A response that<br><span class="gradient">comes together.</span></h1><p>A shared operational picture for the people coordinating help when every minute matters.</p></div><div class="loginbottom small">Model-assisted investigation. Human-owned decisions.</div></div><div class="loginform"><form id="loginform"><h2>Your response workspace</h2><p>Sign in with your organization's account.<br>Roles and authorizations stay separate.</p><label>Email<input type="email" name="email" required autocomplete="username" placeholder="you@your-organization.org"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label>${error ? `<div role="alert" class="error">${escape(error)}</div>` : ""}<button class="primary" type="submit">Enter workspace ${icon("arrow-right")}</button><div class="loginlinks"><a href="/public">Public response portal</a><a href="/community">Report a need</a></div><div class="footnote">Local prototype. Test payments collect no money. Access credentials are provisioned by your administrator.</div></form></div></div>`;
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
    state.organization = me.organization;
    setDisplayContext({ organization: me.organization });
    try { setDisplayContext({ geography: (await api("/api/map")).geography }); } catch {}
      cacheSession();
      await render();
    } catch (e) {
      login(e.message);
    }
  };
}
function shell(content) {
  const active = nav.find(n => n[0] === state.page), scope = `${state.user.org}:${state.user.id}`;
  const previousPage = app.querySelector("main[data-view]")?.dataset.view;
  rememberPresentation(app, scope);
  app.innerHTML = `<div class="app"><aside class="sidebar"><div class="brand"><img src="/mark.svg" alt="">AidScaler<span class="brand-dot">.</span></div><div class="org"><span>RESPONSE WORKSPACE</span><strong>${escape(entityLabel(state.user.org))}</strong><span class="org-role">${escape(humanLabel(state.user.role))}</span></div><nav aria-label="Workspace">${presentation.navigation(visibleNav(), state.page)}</nav><div class="sidebarfooter"><div class="profile-label"><span class="avatar">${escape(state.user.name.slice(0, 1))}</span><div><strong>${escape(state.user.name)}</strong><span>${escape(humanLabel(state.user.role))}</span></div></div>${action("Sign out", "logout", "", "quiet")}</div></aside><div class="workspace"><header class="topbar"><div class="crumb">Disaster response <span>/</span> <b>${escape(active?.[2] ?? "Workspace")}</b></div><div class="topstatus"><span class="connection-label"><i class="statusdot ${state.offline ? "offline" : ""}"></i>${state.offline ? "Offline · saved work available" : "Workspace connected"}</span><span class="model-pill" title="Configured model: ${escape(state.model ?? "Not connected")}">${icon("sparkles")}${escape(displayModel(state.model))}</span><a href="/public" target="_blank" rel="noopener" aria-label="Open public portal">Public portal ${icon("external-link")}</a>${action("Sign out", "logout", "", "quiet mobile-signout")}</div><select class="mobile-nav" aria-label="Workspace page">${visibleNav().map(([id, , label]) => `<option value="${id}" ${id === state.page ? "selected" : ""}>${label}</option>`).join("")}</select></header><main id="main" data-view="${escape(state.page)}">${content}<details class="view-footnote" data-ui-key="workspace:details"><summary>Local workspace · Human-owned decisions</summary><p>AidScaler local prototype · ${escape(state.model ?? "Model not connected")}. Sources and simulation results remain distinct from real-world outcomes.</p>${labelHints() ? `<p>${escape(labelHints())}</p>` : ""}</details></main></div></div>`;
  bind();
  if (previousPage !== state.page) window.scrollTo({ top: 0, behavior: "instant" });
  restorePresentation(app, scope, state.page, { restoreFocus: previousPage === state.page });
}
function activityCard(a) {
  return activityView.card(a, { role: state.user.role, model: state.model, now: Date.now() });
}
async function overview() {
  const [d, intake, pulse] = await Promise.all([api("/api/dashboard"), api("/api/automation"), api("/api/workspace-pulse")]);
  liveWorkspace.rememberPolicy(intake);
  state.data = d; state.intake = intake; state.model = d.model ?? state.model; state.overviewVersion=pulse.overviewVersion;
  registerDisplayRecords("need", d.need);
  const queue = d.proposal.filter(p => ["awaiting_review", "requires_review", "needs_clarification"].includes(p.state));
  const descriptions = await decisionExperience.describeProposals(queue);
  const unresolved = d.need.filter(n => n.quantity > (n.served ?? 0));
  return title("Response overview", "See what is needed. Review the response. Put help in motion.") +
    agentMonitor(intake, {escape, icon, model:state.model, pulse}) +
    presentation.overview({ data: d, queue, unresolved, descriptions,
      sourceStatus: d.source.length ? d.source.map(source => source.state).join(" · ") : "Not connected" });
}
async function signals() {
  if (!state.signalSnapshot || app.querySelector('main[data-view]')?.dataset.view !== 'signals')
    state.signalSnapshot = await api('/api/workspace-snapshot?kind=signal');
  const {rows:allRows,pulse} = state.signalSnapshot, rows = allRows.filter(s => s.state !== "erased");
  liveWorkspace.capture('signal',pulse);
  registerDisplayRecords('signal',rows); state.signalRows = rows;
  const filtered = rows.filter(s => `${s.text} ${s.source} ${s.location} ${entityLabel(s.location)}`.toLowerCase().includes(state.filter.toLowerCase()));
  const start = state.signalPage * 12;
  return title("Signals & evidence", "Read collected reports at your own pace. New signals arrive in the background.") +
    freshnessNotice('signal',{icon}) +
    `<div class="filterbar"><input id="signalfilter" aria-label="Search collected signals" placeholder="Search the loaded reports" value="${escape(state.filter)}"><span class="small">${number(pulse.signals.available)} signals collected · ${number(rows.length)} recent reports loaded</span></div><details class="secondary-disclosure" data-ui-key="signals:scope"><summary>Processing & additional checks</summary><p class="small">New source versions enter the processing queue automatically. This list stays in place until you load the latest reports.</p><div class="actions">${action("Recheck received sources", "discover-page", "", "quiet")}${action("Interpret selected context", "interpret-page", "", "quiet")}${action("Refresh sources", "sync", "", "quiet")}</div></details>` +
    presentation.signals(filtered.slice(start, start + 12)) +
    `<div class="pagination"><span class="small">${filtered.length ? start + 1 : 0}–${Math.min(start + 12, filtered.length)} of ${number(filtered.length)} loaded reports</span>${start > 0 ? action("← Previous", "signalprev") : ""}${start + 12 < filtered.length ? action("More signals →", "signalnext") : ""}</div>`;
}
async function investigations() {
  if (!state.activitySnapshot || app.querySelector('main[data-view]')?.dataset.view !== 'investigations')
    state.activitySnapshot = await api('/api/workspace-snapshot?kind=activity');
  const {rows,pulse}=state.activitySnapshot, intake=await api('/api/automation');
  liveWorkspace.rememberPolicy(intake);
  const focus = rows.find(a=>['reading','checking','queued'].includes(a.state)) ?? rows[0];
  const earlier = rows.filter(a => a.id !== focus?.id);
  liveWorkspace.capture('activity',pulse,[focus,...earlier.slice(0,6)].filter(Boolean));
  return title("Agent activity", "Follow a flow without losing your place. Load newer investigations when you are ready.") +
    agentMonitor(intake, {escape, icon, model:state.model, pulse}) +
    freshnessNotice('activity',{icon}) + activityCard(focus) +
    `<section class="card investigation-history"><div class="section-heading"><h2>Investigations in this view</h2><span class="small">${earlier.length} recorded</span></div>${earlier.slice(0, 6).map(a => activityView.row(a, { role: state.user.role, model: state.model })).join("") || empty("Earlier investigations will appear here.", "sparkles")}${earlier.length > 6 ? `<details class="secondary-disclosure" data-ui-key="investigations:earlier"><summary>Earlier investigations · ${earlier.length - 6} more</summary>${earlier.slice(6).map(a => activityView.row(a, { role: state.user.role, model: state.model })).join("")}</details>` : ""}</section>
    <details class="secondary-disclosure" data-ui-key="investigations:automation"><summary>Processing controls & model limits</summary><div class="toolbar"><span class="small">${intake.policy.hourlyCallLimit} calls / hour · $${intake.policy.hourlyBudgetUsd}/hour maximum</span>${["admin", "commander"].includes(state.user.role) ? action(intake.policy.enabled ? "Pause automatic intake" : "Resume automatic intake", "automation", String(!intake.policy.enabled), "quiet") : ""}${action("Request an additional check", "investigate", "", "quiet")}</div><p class="small">Source collection and operational monitoring continue while the model works.</p></details>`;
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
  const descriptions = await decisionExperience.describeProposals([...rows,...history.rows]);
  return (
    title(
      "Decision queue",
      "Understand the benefit, evidence and conditions before authorizing a response.",
    ) +
    `<section class="card ${!rows.length ? "empty-table" : ""}">${table(
      ["Proposed response", "Priority", "State", "Pending conditions", ""],
      rows.map(
        (p) =>
          `<tr><td><strong>${escape(descriptions.get(p.id)?.title ?? p.title)}</strong><small>${escape(descriptions.get(p.id)?.summary ?? readableText(p.benefit))}</small></td><td>${badge(p.priority)}</td><td>${badge(p.state)}</td><td>${p.conditions.filter((c) => !c.satisfied).length}</td><td>${action("Review", "proposal", p.id)}</td></tr>`,
      ),
    )}${!rows.length ? empty("No response is awaiting a decision. An investigation can produce a sourced proposal.", "clipboard-check") : ""}${total > 12 ? `<div class="toolbar"><span class="small">${page * 12 + 1}–${Math.min(total, page * 12 + 12)} of ${total} actionable responses</span>${page ? action("Previous", "review-page", String(page - 1), "quiet") : ""}${(page + 1) * 12 < total ? action("Next", "review-page", String(page + 1), "quiet") : ""}</div>` : ""}<details class="collapse" ${state.historyOpen ? "open" : ""}><summary>Decision & execution history · ${history.total} responses</summary>${history.rows.map((p) => `<div class="listrow"><div class="grow"><strong>${escape(descriptions.get(p.id)?.title ?? p.title)}</strong>${badge(p.state)}</div>${action("Inspect", "proposal", p.id)}</div>`).join("")}${history.offset ? action("Earlier page", "history-page", String((state.historyPage ?? 0) - 1), "quiet") : ""}${history.offset + 12 < history.total ? action("Next history page", "history-page", String((state.historyPage ?? 0) + 1), "quiet") : ""}</details></section>`
  );
}
async function operationContext() {
  const [needs, resources, vehicles, people] = await Promise.all([
    record("need"), record("resource"), record("vehicle"),
    ["commander", "dispatcher"].includes(state.user.role) ? api("/api/people").catch(() => []) : [],
  ]);
  return { needs, resources, vehicles, people, currentUser: state.user, organization: state.user.org };
}
async function operations() {
  const [rows, context] = await Promise.all([record("operation"), operationContext()]);
  return (
    title(
      "Operations",
      "Follow acknowledgements, travel and receipt. Arrival is not the same as service.",
      action(
        "Prepare an operational action",
        "operational-draft",
        "",
        "accent",
      ),
    ) +
    (await unloadingControls.view()) + `<section class="card ${!rows.length ? "empty-table" : ""}">${table(
      ["Operation", "State", "Authorized by", "Latest confirmation", ""],
      rows.map(o => operationView.row(o, context)),
    )}${!rows.length ? empty("No authorized physical operations yet. Draft proposals do not count as deliveries.", "truck") : ""}</section>`
  );
}
async function resources() {
  const [items, facilities, vehicles, dashboard] = await Promise.all(
    ["resource", "facility", "vehicle"].map(k => record(k)).concat([api("/api/dashboard")])
  );
  const usable = r => !["expired", "damaged", "quarantined"].includes(r.condition) &&
    (r.useByAt === undefined || Number.isFinite(dashboard.simulatedAt) && r.useByAt > dashboard.simulatedAt) &&
    (r.type !== "staff" || staffAvailabilityState(r, dashboard.simulatedAt).usable);
  const available = r => usable(r) ? Math.max(0, Math.min(r.quantity - (r.reserved ?? 0) - (r.floor ?? 0), r.usableQuantity ?? Infinity)) : 0;
  const tab = state.resourceTab ?? "inventory";
  const own = items.filter(r => r.owner === state.user.org || !r.owner), peers = items.filter(r => r.owner && r.owner !== state.user.org);
  const inventory = rows => presentation.resourceTable(rows, { usable, available, staffBadge: r => staffAvailabilityBadge(r, dashboard.simulatedAt, { escape, time: simulationClock }), expiryLabel: at => sourceExpiryLabel(at, dashboard.simulatedAt) });
  const fleet = rows => rows.map(v => `<div class="listrow"><div class="rowicon">${icon("truck")}</div><div class="grow"><h3>${escape(v.label || entityLabel(v.id))}</h3><p>Capacity ${number(v.capacity)} · ${escape(entityLabel(v.owner))}</p>${driverAvailabilityBadge(v)}<details class="row-details"><summary>Vehicle record</summary><pre class="trace">${escape(JSON.stringify(v,null,2))}</pre></details></div>${badge(v.state)}</div>`).join("");
  const tabs = [["inventory","Inventory",own.length],["transport","Transport",vehicles.filter(v => v.owner === state.user.org).length],["facilities","Facilities",facilities.length]];
  return title("Resources & facilities", "See what is available before committing it. Partner resources stay under their owner's control.", action("Add or update records", "register-record", "", "primary")) +
    `<div class="view-tabs" role="group" aria-label="Resource category">${tabs.map(([id,name,count]) => `<button data-action="resource-tab" data-id="${id}" aria-pressed="${tab===id}">${name} <span>${count}</span></button>`).join("")}</div>` +
    (tab === "inventory" ? `<section class="card resource-group"><div class="section-heading"><h2>Your inventory</h2><span class="small">Ready to commit, after protected stock</span></div>${own.length ? inventory(own) : empty("No owned resources received. Sync your inventory source.","package")}${peers.length ? `<details class="secondary-disclosure" data-ui-key="resources:partners"><summary>Partner inventory <span>${peers.length} resources</span></summary><p class="small">Observed capacity. A partner must confirm any commitment.</p>${inventory(peers)}</details>` : ""}</section>` :
    tab === "transport" ? `<section class="card"><div class="section-heading"><h2>Your transport</h2><span class="small">Last received vehicle states</span></div>${fleet(vehicles.filter(v => v.owner === state.user.org)) || empty("No owned vehicles have been received.","truck")}<details class="secondary-disclosure"><summary>Partner vehicles <span>${vehicles.filter(v => v.owner !== state.user.org).length} vehicles</span></summary>${fleet(vehicles.filter(v => v.owner !== state.user.org)) || '<p class="small">No partner vehicles received.</p>'}</details></section>` :
    `<section class="card"><div class="section-heading"><h2>Facilities</h2>${action("Request facility check","verifyform","","quiet")}</div>${facilities.map(f => `<div class="listrow"><div class="rowicon">${icon("building-2")}</div><div class="grow"><h3>${escape(entityLabel(f.id))}</h3><p>${f.safe === true ? "Safety inspection confirmed" : f.safe === false ? "Not safe for use" : "Safety has not been confirmed"}</p></div>${badge(f.state ?? "unknown")}${action("Investigate","investigate-facility",f.id)}</div>`).join("") || empty("No assessed facilities received. Request a check before planning their use.","building-2")}</section>`);
}
async function network() {
  const [offers, commitments, permissions] = await Promise.all(
    ["peer_offer", "commitment", "permission"].map((k) => record(k)),
  );
  return (
    title(
      "Partner network",
      "Each organization controls its data, resources and authorizations. Connecting does not grant access to everything.",
    ) +
    `<div class="grid ${commitments.length ? "cols2" : ""}"><section class="card"><div class="cardheader"><h2>Partner capabilities</h2>${badge("permissioned")}</div>${
      offers
        .filter((o) => o.active)
        .map(
          (o) =>
            `<div class="listrow"><div class="rowicon">${icon("network")}</div><div class="grow"><h3>${escape(o.projection?.type ?? o.kind)} · ${escape(entityLabel(o.from))}</h3><p>${o.projection?.available != null ? number(o.projection.available) + " available · " : ""}Shared v${o.sourceVersion}. An offer is not a confirmed commitment.</p></div>${badge(o.expiresAt < Date.now() ? "expired" : "shared")}</div>`,
        )
        .join("") ||
      empty(
        "No partner capabilities have been explicitly shared yet. A single instance remains usable.",
        "network",
      )
    }</section>${commitments.length ? `<section class="card"><div class="cardheader"><h2>Owner commitments</h2></div>${commitments.map((c) => `<div class="listrow"><div class="grow"><h3>${number(c.quantity)} · ${escape(entityLabel(c.resource))}</h3><p>For ${escape(entityLabel(c.requester))} · expires ${time(c.expiresAt)}<br>${c.conditions.length} conditions · authorized by ${escape(c.authorizedBy)}</p>${badge(c.state)}</div>${["reserved", "confirmed"].includes(c.state) ? action("Manage", "commitment", c.id) : ""}</div>`).join("") || empty("No reservations yet. Concurrent requests are checked transactionally.", "lock-keyhole")}</section>` : `<details class="card secondary-disclosure"><summary>Owner commitments <span>No reservations</span></summary><p class="small">Concurrent resource requests are checked transactionally. Confirmed commitments will appear here.</p></details>`}</div><details class="card secondary-disclosure"><summary>What your organization shares <span>${permissions.length} permissions</span></summary>${permissions.length ? table(
      ["Record", "Partner", "Permission", ""],
      permissions.map(
        (p) =>
          `<tr><td>${escape(p.kind)} · ${escape(p.recordId)}</td><td>${escape(entityLabel(p.to))}</td><td>${badge(p.active ? "shared" : "withdrawn")}</td><td>${p.active ? action("Revoke", "revoke", p.id) : ""}</td></tr>`,
      ),
    ) : `<p class="small">Nothing is shared by default. Choose Share on an owned resource to prepare a scoped permission.</p>`}</details>`
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
    `<div class="grid cols2">${rows.map((p) => `<article class="card"><div class="cardheader">${badge(p.state)}${badge(p.status)}</div><h2>${escape(readableText(p.title))}</h2><p class="sub">${escape(p.text)}</p><div class="note">${escape(p.area)} · ${p.publishedAt ? "Published " + time(p.publishedAt) : "Not visible to the public"}</div><div class="toolbar">${p.state === "draft" ? action("Review & publish", "publish", p.id, "primary") : ""}</div></article>`).join("") || `<section class="card">${empty("No update has been published. Drafts stay internal until a responsible person approves them.", "globe")}</section>`}</div>`
  );
}
async function finance() {
  const data = await api("/api/public"),
    usage = await api("/api/usage");
  const controls = await financeControls.view();
  return (
    title(
      "Pooled funds",
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
      )}</div>${controls}<details class="card secondary-disclosure" data-ui-key="finance:model-usage"><summary>Model usage & provider receipts · ${usage.length} records</summary><div class="disclosure-content"><div class="cardheader"><h2>Real model usage</h2><span class="small">Provider receipts, including failed attempts</span></div>${table(
      ["Episode", "Model", "State", "Tokens in / out", "Cost", "Wall time"],
      usage
        .slice(0, 15)
        .map(
          (u) =>
            `<tr><td>${escape(u.episode.slice(-10))}</td><td>${escape(u.model)}</td><td>${badge(u.state)}</td><td>${number(u.input_tokens)} / ${number(u.output_tokens)}</td><td>${u.cost_usd == null ? "Not reported" : "$" + Number(u.cost_usd).toFixed(6)}</td><td>${u.wall_ms == null ? "Pending" : (u.wall_ms / 1000).toFixed(1) + " s"}</td></tr>`,
        ),
    )}${!usage.length ? empty("No model call has been recorded.", "sparkles") : ""}</div></details><p class="note">The local payment provider exercises signatures, retries and refunds. External payment-provider onboarding is a separate integration.</p>`
  );
}
async function field() {
  const queue = (await offlineQueue("all")).filter(
    (r) => r.queueOrg === state.user.org && r.queueActor === state.user.id,
  );
  return (
    title(
      "Field workspace",
      "Capture a need, restriction or receipt. Offline reports remain queued until the server acknowledges them.",
    ) +
    (await workforceControls.field()) +
    `<div class="grid split field-layout"><section class="card"><h2>New observation</h2><form id="fieldform" class="fieldform"><label>Report type<select name="kind"><option value="need">A need or situation</option><option value="receipt">Aid received</option><option value="road">Access restriction</option><option value="facility">Facility assessment</option><option value="correction">A correction</option><option value="voice">Voice note transcript</option></select></label><label>Location<input name="location" placeholder="e.g. Sakura Shelter" required></label><label>What did you observe?<textarea name="text" placeholder="Describe what you saw. Include quantities and uncertainty when known." required></textarea></label><details class="form-disclosure"><summary>Observation time <span>Defaults to now · change for an earlier report</span></summary><label>When did it happen?<input name="observedAt" type="datetime-local" required value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></label></details><button class="primary" type="submit">${icon("send")} Save & send report</button></form></section><section class="card"><div class="cardheader"><h2>Report outbox</h2>${badge(state.offline ? "offline" : "connected")}</div><div id="fieldqueue">${queue.map((q) => `<div class="listrow"><div class="rowicon">${icon(q.lastError ? "circle-alert" : "clock")}</div><div class="grow"><h3>${escape(q.location)}</h3><p>${escape(String(q.text ?? "").slice(0, 150))}</p>${badge(q.lastError ? "requires_review" : "queued")} <span class="small">${q.lastError ? escape(q.lastError) : "Saved on this device. Not yet received."}</span>${q.lastError ? action("Resolve pending update", "queue-conflict", q.clientId, "accent") : ""}</div></div>`).join("") || empty("Your queued reports will appear here. Server confirmation is required before a report is marked received.", "check")}</div>${queue.length ? action("Retry queued reports", "flush", "", "accent") : ""}</section></div>`
  );
}
async function settings() {
  const sources = await record("source");
  const readiness = await organizationControls.summary();
  return (
    title(
      "Sources & access",
      "Automatic ingestion is the default. Configure access once; operators should not copy every post manually.",
      action("Add or update records", "register-record", "", "accent"),
    ) +
    `<div class="grid cols2"><section class="card"><div class="cardheader"><h2>Connected sources</h2>${action("Contact coverage", "coverage-open", "", "quiet")}${action("Sync now", "sync", "", "accent")}</div>${sources.map((s) => `<div class="listrow"><div class="rowicon">${icon("radio")}</div><div class="grow"><h3>Signal & operational gateway</h3><p>Last success ${s.lastSuccessAt ? ago(s.lastSuccessAt) : "not yet"}<br>Scoped organization data. No observer access.</p></div>${badge(s.state)}</div>`).join("") || empty("Start the local lab to provision the scoped source connector.", "radio")}<details class="collapse"><summary>What can be ingested?</summary><p class="sub">Public social posts and their revisions, images and voice-note descriptions, authorized field channels, official bulletins, operational inventory, vehicles, roads, facilities, staff, commitments and receipts. Real media tests are kept separate from synthetic descriptions.</p></details><details class="collapse"><summary>Request specific source data</summary><div class="actions">${action("Query inventory", "lookup", "inventory")}${action("Query vehicles", "lookup", "vehicles")}${action("Query personnel", "lookup", "personnel")}${action("Query maps", "lookup", "map")}</div></details></section><section class="card"><h2>Roles & authority</h2><p class="sub">Analysts investigate. Commanders and dispatchers authorize operations. Publishers approve public updates. Field teams submit observations. Auditors inspect history.</p><details class="collapse"><summary>How does the model get permission?</summary><p class="sub">It does not inherit a human role. Model tools can query, verify and draft. Server checks remain authoritative regardless of source text or model output.</p></details>${state.user.role === "admin" ? action("Manage users", "users", "", "accent") : ""}<details class="collapse"><summary>Configured model · ${escape(displayModel(state.model))}</summary><p class="small">${escape(state.model)}. Results belong to this configured model; Gemini requires its own evaluation.</p></details></section></div>` +
    readiness
  );
}
async function audit() {
  const rows = await api("/api/audit");
  const syncs = rows.filter(r => r.action === "source.synced"), decisions = rows.filter(r => r.action !== "source.synced");
  const page = Math.max(0, Math.min(state.auditPage ?? 0, Math.ceil(decisions.length/12)-1));
  const syncPage = Math.max(0, Math.min(state.syncAuditPage ?? 0, Math.ceil(syncs.length/12)-1));
  const list = records => table(["Time", "Event", "Responsible actor", ""],records.map(r => `<tr><td>${time(r.occurred_at)}</td><td><strong>${escape(humanLabel(r.action.replaceAll("."," ")))}</strong></td><td>${escape(r.actor === state.user.id ? state.user.name : r.actor === "connector" ? "Source connector" : entityLabel(r.actor))}</td><td>${action("Inspect","auditdetail",String(r.sequence))}</td></tr>`));
  const pages = (records, page, act) => records.length > 12 ? `<div class="pagination"><span class="small">${page*12+1}–${Math.min(page*12+12,records.length)} of ${records.length}</span><div class="actions">${page ? action("Previous",act,String(page-1)) : ""}${(page+1)*12 < records.length ? action("Next",act,String(page+1)) : ""}</div></div>` : "";
  return title("Decision history","Review decisions, owners and evidence. Routine source syncs are grouped below.",["admin","commander","auditor"].includes(state.user.role) ? action("Export records","organization-export","","accent") : "") +
    `<section class="card"><div class="section-heading"><h2>Decisions & workspace events</h2><span class="small">${decisions.length} recent records</span></div>${decisions.length ? list(decisions.slice(page*12,page*12+12)) : empty("No decision events in the recent record window. Export records for a complete history.","shield-check")}${pages(decisions,page,"audit-page")}</section><details class="card secondary-disclosure" data-ui-key="audit:syncs"><summary>Routine source syncs <span>${syncs.length} recent records</span></summary><div class="disclosure-content">${list(syncs.slice(syncPage*12,syncPage*12+12))}${pages(syncs,syncPage,"audit-sync-page")}</div></details><p class="note">The recent window contains ${rows.length} events. Export records preserves the full audit trail.</p>`;
}
const views = {
  media: extras.media,
  connections: extras.connections,
  moderation: extras.moderation,
  map: async () => {
    const data = await api("/api/map");
    return (
      title(
        "Operational map",
        "Locate reported needs and open a case. Conditions reflect the latest received reports.",
        action("Query maps", "lookup", "map") + action("Sync updates", "sync"),
      ) +
      operationalMap(data) +
      `<section class="card" style="margin-top:22px"><h2>Accessible list of unmet needs</h2>${
        data.needs
          .filter((n) => n.quantity > (n.served ?? 0))
          .slice(0, 30)
          .map(
            (n) =>
              `<div class="listrow"><div class="grow"><h3>${escape(humanLabel(n.type))} · ${escape(entityLabel(n.building))}</h3><p>${number(n.quantity - (n.served ?? 0))} ${escape(n.unit)} pending</p></div>${action("Review need", "need", n.id)}</div>`,
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
  dialog.setAttribute("aria-label", name);
  dialog.innerHTML = `<header class="dialoghead"><h2>${name}</h2><button class="iconbutton" aria-label="Close dialog" data-action="close">${icon("x")}</button></header><div class="dialogbody">${content}</div>${footer ? `<footer class="dialogfoot">${footer}</footer>` : ""}`;
  document.body.append(dialog);
  dialog.showModal();
  const openedDialog = dialog;
  dialog.onclose = () => {
    openedDialog.remove();
    if (dialog === openedDialog) {
      dialog = null;
      if(openedDialog.dataset.proposal&&state.user&&['overview','review','operations'].includes(state.page))render();
    }
  };
  bind(dialog);
}
function proposalFooter(p, canReview) {
  if(p.reviewBlocked) return action('View agent recheck','navigate','investigations','primary')+action('Close','close');
  if(canReview && ['awaiting_review','requires_review','needs_clarification'].includes(p.state)) {
    const pending=(p.conditions??[]).some(c=>!c.satisfied);
    return `${p.state==='requires_review'?action('Investigate a repair','repair',p.id):''}${!p.executionResults?.length?action('Edit draft','edit-response',p.id):''}${action('Ask for clarification','reviewclarify',p.id)}${action('Reject','reviewreject',p.id,'danger')}${action(pending?'Authorize conditionally':'Authorize response','reviewapprove',p.id,'primary')}`;
  }
  return action('Follow operations','navigate','operations','primary')+action('Close','close');
}
async function proposal(id) {
  state.delegatedReviews=(await api('/api/me')).delegatedReviews;
  const p=await record('proposal',id), canReview=['commander','dispatcher'].includes(state.user.role)||state.delegatedReviews?.includes(id);
  await presentProposal(p,canReview);
}
async function presentProposal(p,canReview,expectedDialog=null) {
  const content=await decisionExperience.renderProposal(p,{canReview});
  // A slow source lookup must not reopen a review the operator closed or left.
  if(expectedDialog&&(dialog!==expectedDialog||!expectedDialog.open))return false;
  modal('Review a response',content,proposalFooter(p,canReview));
  dialog.dataset.proposal=p.id;dialog.dataset.canReview=String(canReview);
  state.currentProposal=p;
  return true;
}
function setDecisionBusy(opened,busy) {
  if(!opened)return;
  opened.setAttribute('aria-busy',String(busy));
  opened.querySelectorAll('[data-action="reviewapprove"],[data-action="reviewreject"],[data-action="reviewclarify"]').forEach(button=>{button.disabled=busy||opened.dataset.outdated==='true';});
}
function requireProposalReload(opened,id,message='Load its latest plan and checks before making a decision.') {
  opened.dataset.outdated='true';
  let notice=opened.querySelector('[data-proposal-outdated]');
  if(!notice){notice=document.createElement('section');notice.dataset.proposalOutdated='true';notice.className='dialog-inline-notice';notice.setAttribute('role','status');notice.tabIndex=-1;opened.querySelector('.dialogbody').prepend(notice);}
  notice.innerHTML=`<strong>Review the latest response.</strong><p>${escape(message)}</p>${action('Load latest response','reload-proposal',id,'primary')}`;
  bind(notice);setDecisionBusy(opened,false);
  return notice;
}
function proposalNotice(opened,heading,message) {
  const notice=document.createElement('section');notice.className='dialog-inline-notice';notice.setAttribute('role','status');notice.tabIndex=-1;
  notice.innerHTML=`<strong>${escape(heading)}</strong><p>${escape(message)}</p>`;
  opened.querySelector('.dialogbody').prepend(notice);notice.focus();
  return notice;
}
async function refreshProposalProgress() {
  const opened=dialog, old=state.currentProposal;
  if(!opened?.open||!opened.dataset.proposal||!old||state.reviewInFlight)return;
  const p=await record('proposal',old.id);
  if(dialog!==opened||state.reviewInFlight||p.version===old.version||opened.dataset.outdated==='true')return;
  const blockChanged=JSON.stringify(p.reviewBlocked??null)!==JSON.stringify(old.reviewBlocked??null),
    materiallyInvalidated=(p.state==='requires_review'&&old.state!=='requires_review')||Boolean(old.authorization&&!p.authorization),
    scopeChanged=JSON.stringify(p.actions)!==JSON.stringify(old.actions)||JSON.stringify(p.conditions)!==JSON.stringify(old.conditions);
  if(scopeChanged||blockChanged||materiallyInvalidated) {
    // A saved blocked banner is no longer current after another reviewer edits,
    // rejects or resolves the draft. Never pair it with a fresh approve button.
    if(blockChanged)opened.querySelectorAll('.approval-feedback').forEach(element=>element.remove());
    requireProposalReload(opened,p.id,blockChanged&&!p.reviewBlocked?'The previous blocker is no longer the latest state. Reload this response to see its current decision and available actions.':p.changedReason??'The plan or its approval checks changed. Load the latest response before making a decision.');
    return;
  }
  state.currentProposal=p;
  const progress=opened.querySelector('[data-response-progress]');if(progress)progress.outerHTML=decisionExperience.renderExecutionProgress(p);
  const cardHeader=opened.querySelector('.response-review > .cardheader');if(cardHeader)cardHeader.innerHTML=badge(p.state)+badge(p.priority);
  if(p.reviewBlocked&&!opened.querySelector('.approval-feedback'))opened.querySelector('.dialogbody').insertAdjacentHTML('afterbegin',decisionExperience.renderApprovalFeedback({code:p.reviewBlocked.code,message:p.reviewBlocked.message},{proposal:p}));
  const footer=opened.querySelector('.dialogfoot');if(footer){footer.innerHTML=proposalFooter(p,opened.dataset.canReview==='true');bind(footer);}
}
async function refreshOverview(pulse) {
  const count=app.querySelector('[data-overview-count="signalCount"]');if(count)count.textContent=number(pulse.signals.available);
  if(pulse.overviewVersion===state.overviewVersion)return;
  const d=await api('/api/dashboard');if(state.page!=='overview'||dialog)return;
  registerDisplayRecords('need',d.need);
  const queue=d.proposal.filter(p=>['awaiting_review','requires_review','needs_clarification'].includes(p.state)), descriptions=await decisionExperience.describeProposals(queue);
  const holder=document.createElement('div');holder.innerHTML=presentation.overview({data:d,queue,descriptions,unresolved:d.need.filter(n=>n.quantity>(n.served??0)),sourceStatus:d.source.map(s=>s.state).join(' · ')});
  for(const selector of ['.overview-metrics','.overview-layout']) { const current=app.querySelector(selector),next=holder.querySelector(selector);if(current&&next){current.replaceWith(next);bind(next);} }
  state.data=d;state.overviewVersion=pulse.overviewVersion;
}
async function sourceDetail(id) {
  const s = await record("signal", id);
  const context = await caseControls.context(id);
  modal(
    "Original source & context",
    `<div class="sourceavatars"><div class="socialavatar">${escape((s.authorName ?? "S")[0])}</div><strong>${escape(s.authorName ?? s.source)}</strong>${badge(s.state)}</div><hr class="divider"><p class="signaltext">${escape(s.text)}</p><div class="detailgrid"><div class="decision"><span class="eyebrow">Publication</span><p>Posted ${time(s.publishedAt)}<br>Collected ${time(s.receivedAt)}</p></div><div class="decision"><span class="eyebrow">Location</span><p>${escape(entityLabel(s.location) || "Not confirmed")}</p></div></div><p class="note">A collected post is not a verified fact. Its original references are kept to detect repeated or dependent reports.</p><details class="collapse"><summary>Source references & attachment records</summary><pre class="trace">${escape(JSON.stringify({ sourceVersion: s.sourceVersion, locationId: s.location, references: s.originalReferences ?? s.references, attachments: s.attachments, contentHash: s.contentHash }, null, 2))}</pre></details>`,
    action("Close", "close") + action("Request another check", "investigatesignal", id, "quiet") + (["admin", "commander"].includes(state.user.role) ? action("Review local erasure", "erase-source", id) : ""),
  );
  const review = document.createElement("div");
  review.innerHTML = context;
  document.querySelector(".dialogbody").append(review);
  bind(review);
}
async function activityDetail(id) {
  const a = await record("activity", id);
  modal("Investigation activity", activityView.detail(a, { role: state.user.role, model: state.model, now: Date.now() }));
}
async function operationDetail(id) {
  const [o, context] = await Promise.all([record("operation", id), operationContext()]);
  modal(
    "Follow the operation",
    operationView.detail(o, context),
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
    state.organization = me.organization;
    setDisplayContext({ organization: me.organization });
    try { setDisplayContext({ geography: (await api("/api/map")).geography }); } catch {}
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
  if (name === "close") { dialog?.close(); return; }
  if (name === "refresh-live") { state.signalSnapshot=null; state.activitySnapshot=null; state.signalPage=0; await render(); return; }
  if (name === "resource-tab") { state.resourceTab = id; await render(); return; }
  if (name === "audit-page" || name === "audit-sync-page") { state[name === "audit-page" ? "auditPage" : "syncAuditPage"] = Number(id); await render(); return; }
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
    dialog?.close();
    state.page = id;
    location.hash = id;
    await render();
    return;
  }
  if (name === "logout") {
    await api("/api/logout", {});
    sessionStorage.removeItem("aidscaler-workspace");
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
    dialog?.close();
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
        await decisionExperience.renderEvidence(found),
        action("Close", "close"),
      );
      return;
    } catch {}
    toast(
      "Source is no longer accessible. Its decision snapshot remains in the audit record.",
    );
    return;
  }
  if (name === "reload-proposal") return proposal(id);
  if (name.startsWith("review")) {
    if(state.reviewInFlight)return;
    const p = state.currentProposal, opened=dialog;
    if (dialog?.dataset.outdated === 'true') return toast('Load the latest response before making a decision.');
    const decision = {reviewapprove:"approve",reviewreject:"reject",reviewclarify:"clarify"}[name];
    if (!decision || !p || !opened?.open) return;
    const note=document.querySelector('#reviewnote')?.value ?? '';
    const canReview=opened.dataset.canReview==='true';
    state.reviewInFlight=true;setDecisionBusy(opened,true);
    let reviewed=null,decisionError=null,latest=null,refreshError=null;
    try {
      // A later GET failure is not a failed decision. Keep the authoritative
      // POST receipt separate, and never retry a decision automatically.
      try {reviewed=await api('/api/review',{id:p.id,version:p.version,decision,note,allowConditional:document.querySelector('#allowconditional')?.checked??false});}
      catch(error){decisionError=error;}
      try {latest=await record('proposal',p.id);}catch(error){refreshError=error;}
      if(dialog!==opened||!opened.open||!state.user) {
        if(state.user){toast(reviewed?'Decision recorded.':decisionError?.httpStatus>=400&&decisionError.httpStatus<500?decisionError.message:'The decision could not be confirmed. Load the response before trying again.');if(!dialog)await render();}
        return;
      }
      const received=latest??reviewed;
      if(received&&!await presentProposal(received,canReview,opened))return;
      if(!dialog?.open||dialog.dataset.proposal!==p.id)return;
      if(reviewed) {
        if(refreshError)proposalNotice(dialog,'Decision recorded. Live progress is temporarily unavailable.','The server confirmed your decision. Load the latest response to follow subsequent owner reviews and operations.');
        else if(decision!=='approve'){dialog.close();await render();}
      } else if(decisionError?.httpStatus>=400&&decisionError.httpStatus<500) {
        if(!dialog.querySelector('.approval-feedback'))dialog.querySelector('.dialogbody').insertAdjacentHTML('afterbegin',decisionExperience.renderApprovalFeedback(decisionError,{proposal:received??p}));
        const field=dialog.querySelector('#reviewnote');if(field)field.value=note;
        dialog.querySelector('.approval-feedback')?.focus();
        if(refreshError)requireProposalReload(dialog,p.id,'The server did not complete this decision, and the latest state could not be loaded. Refresh before trying again.');
      } else {
        // A lost response or HTTP 5xx can follow a committed command. Report
        // uncertainty without claiming that no work was authorized or sent.
        const confirmedAuthorization=received?.authorization??received?.previousAuthorization,
          authorizationKnown=confirmedAuthorization?.proposalVersion===p.version;
        proposalNotice(dialog,authorizationKnown?'The latest record confirms an authorization.':'We could not confirm whether your decision was recorded.',
          authorizationKnown?'The confirmation response was interrupted. Follow the recorded owner reviews and operations below; no decision was automatically repeated.':'The connection ended before a reliable confirmation arrived. No decision was automatically repeated. Load the latest response before trying again.');
        if(!authorizationKnown)requireProposalReload(dialog,p.id,'The decision outcome is unconfirmed. Check the latest saved state before submitting another decision.');
      }
    } finally {state.reviewInFlight=false;if(dialog?.dataset.proposal)setDecisionBusy(dialog,false);}
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
      `<h2>${escape(humanLabel(n.type))} · ${escape(entityLabel(n.building))}</h2><div class="metric"><span>Still needed</span><strong>${number(n.quantity - n.served)} ${escape(n.unit)}</strong></div><p class="note">Observed data can be delayed. A need is not an authorization to consume resources.</p>`,
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
    const map = await api("/api/map"), locations = receivedLocations(map.geography);
    modal("Record local inventory", localResourceForm(locations, {escape}));
    document.querySelector("#resourceform").onsubmit = async (e) => {
      e.preventDefault();
      const button = e.target.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api("/api/resource", localResourceInput(Object.fromEntries(new FormData(e.target)), locations));
        dialog.close();
        toast("Local resource recorded. Connected source stock is unchanged.");
        await render();
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    };
    return;
  }
  if (name === "register-record") {
    modal("Add or update operational records", registrationGuide({icon, action, role: state.user.role}));
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
      `<p class="sub">${number(c.quantity)} units of ${escape(entityLabel(c.resource))} for ${escape(entityLabel(c.requester))}.</p><div class="note">${badge(c.state)} · expires ${time(c.expiresAt)}</div><pre class="trace">${escape(JSON.stringify(c.conditions, null, 2))}</pre>`,
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
      `<h2>${escape(readableText(p.title))}</h2><p class="sub">${escape(p.text)}</p><div class="warning">You are approving this aggregate public update. Check accuracy, privacy and the difference between dispatch and receipt.</div>`,
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
          const decisionControl=['reviewapprove','reviewreject','reviewclarify'].includes(b.dataset.action), owner=b.closest('dialog');
          b.disabled = decisionControl&&(state.reviewInFlight||owner?.dataset.outdated==='true');
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
async function publicView() { await portalViews.publicView(app); }
async function communityView() { await portalViews.communityView(app); }
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
    state.organization = me.organization;
    setDisplayContext({ organization: me.organization });
    try { setDisplayContext({ geography: (await api("/api/map")).geography }); } catch {}
    cacheSession();
    if (location.pathname === "/field") state.page = "field";
    await render();
  } catch {
    let cached;
    try {
      cached = JSON.parse(sessionStorage.getItem("aidscaler-workspace"));
    } catch {}
    if (!navigator.onLine && cached?.expiresAt > Date.now()) {
      state.user = cached.user;
      state.model = cached.model;
      state.organization = cached.organization;
      setDisplayContext({ organization: cached.organization });
      state.page = "field";
      state.offline = true;
      await render();
    } else login();
  }
setInterval(async () => {
  if(polling||!state.user||!navigator.onLine||document.hidden)return;
  polling=true;
  try {
    if(dialog) {await refreshProposalProgress();return;}
    if(['overview','signals','investigations'].includes(state.page)) {
      const pulse=await liveWorkspace.poll(app);
      if(state.page==='overview'&&!dialog)await refreshOverview(pulse);
    } else if(state.page==='operations'&&!document.activeElement?.matches('input,textarea,select')) {
      const scroll=window.scrollY;await render();window.scrollTo(0,scroll);
    }
  } catch(error) {
    if(error.code==='AUTHENTICATION') {state.user=null;login();}
  } finally {polling=false;}
},4000);
