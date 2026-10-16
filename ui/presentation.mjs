import { entityLabel, resourceLabel, humanLabel, readableText } from "./labels.mjs";

/** Presentation only. Inputs, permissions and operational calculations remain owned by the app. */
export function displayModel(id) {
  if (!id) return "Model not connected";
  if (/gemma-4/i.test(id)) return "Gemma 4";
  if (/gemini/i.test(id)) return String(id).split("/").at(-1).replaceAll("-", " ");
  return String(id).split("/").at(-1);
}

const remembered = new Map();
const detailKey = (element, index) => element.dataset.uiKey || element.dataset.activityHistory || element.dataset.activityTechnical || element.id ||
  `${element.querySelector(':scope > summary')?.textContent.trim() ?? "details"}:${index}`;

export function rememberPresentation(root, scope) {
  const page = root.querySelector("main[data-view]")?.dataset.view;
  if (!page) return;
  const focused = document.activeElement;
  const disclosure = focused?.tagName === "SUMMARY" ? focused.parentElement : null;
  const details = [...root.querySelectorAll("details")];
  const active = root.contains(focused) ? {
    id: focused.id,
    action: focused.dataset.action,
    record: focused.dataset.id ?? "",
    page: focused.dataset.page,
    summary: disclosure ? detailKey(disclosure, details.indexOf(disclosure)) : null,
  } : null;
  remembered.set(`${scope}:${page}`, {
    details: new Map(details.map((element, index) => [detailKey(element, index), element.open])),
    active,
    sidebarScroll: root.querySelector(".sidebar nav")?.scrollTop ?? 0,
  });
}

export function restorePresentation(root, scope, page, { restoreFocus = true } = {}) {
  const previous = remembered.get(`${scope}:${page}`);
  if (!previous) return;
  const details = [...root.querySelectorAll("details")];
  details.forEach((element, index) => {
    const key = detailKey(element, index);
    if (previous.details.has(key)) element.open = previous.details.get(key);
  });
  const nav = root.querySelector(".sidebar nav");
  if (nav) nav.scrollTop = previous.sidebarScroll;
  const f = restoreFocus ? previous.active : null;
  if (!f) return;
  let target;
  if (f.id) target = root.querySelector(`#${CSS.escape(f.id)}`);
  else if (f.action) target = root.querySelector(`[data-action="${CSS.escape(f.action)}"][data-id="${CSS.escape(f.record)}"]`);
  else if (f.page) target = root.querySelector(`[data-page="${CSS.escape(f.page)}"]`);
  else if (f.summary) target = details.find((element, index) => detailKey(element, index) === f.summary)?.querySelector(':scope > summary');
  target?.focus({ preventScroll: true });
}

export function createPresentation({ escape: e, icon, badge, action, table, empty, number, time, state }) {
  const groups = [
    { name: "Respond", ids: ["overview", "signals", "investigations", "review", "operations", "map"], primary: true },
    { name: "Coordinate", ids: ["resources", "network", "field", "coordination"] },
    { name: "Communicate", ids: ["publications", "finance"] },
    { name: "Sources & workspace", ids: ["media", "moderation", "settings", "connections", "audit"] },
  ];
  function navigation(rows, page) {
    return groups.map(group => {
      const items = group.ids.map(id => rows.find(row => row[0] === id)).filter(Boolean);
      if (!items.length) return "";
      const body = items.map(([id, glyph, label]) => `<button class="navitem ${page === id ? "active" : ""}" data-page="${id}" ${page === id ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${e(label)}</span>${id === "investigations" ? '<span class="nav-ai" aria-hidden="true">AI</span>' : ""}</button>`).join("");
      return group.primary ? `<div class="navlabel">${group.name}</div>${body}` : `<details class="nav-group" data-ui-key="nav:${group.name}" ${items.some(row => row[0] === page) ? "open" : ""}><summary>${group.name}${icon("chevron-down")}</summary><div class="nav-group-items">${body}</div></details>`;
    }).join("");
  }

  function overview({ data: d, queue, unresolved, activity, coverage, sourceStatus }) {
    const metrics = [
      ["Active needs", d.activeNeedCount, "Known needs, not total affected population", "circle-alert"],
      ["Decisions waiting", d.decisionCount, "Human authorization required", "clipboard-check"],
      ["Signals collected", d.signalCount, "Versioned public and authorized sources", "radio"],
      ["Operations in progress", d.activeOperationCount, "Dispatch is separate from confirmed receipt", "truck"],
    ];
    const decisions = queue.slice(0, 4).map(p => `<div class="listrow priority-row"><div class="rowicon coral">${icon("clipboard-check")}</div><div class="grow"><h3>${e(readableText(p.title))}</h3><p>${e(readableText(p.benefit))}</p><div class="details-meta">${badge(p.state)}<span>${p.conditions.filter(c => !c.satisfied).length} conditions pending</span></div></div>${action("Review", "proposal", p.id, "accent")}</div>`).join("");
    const needs = unresolved.slice(0, 5).map(n => `<div class="listrow priority-row"><div class="rowicon coral">${icon("circle-alert")}</div><div class="grow"><h3>${e(humanLabel(n.type))} · ${e(entityLabel(n.building))}</h3><p><strong>${number(n.quantity - n.served)} ${e(n.unit)}</strong> still needed</p></div>${action("Open case", "need", n.id)}</div>`).join("");
    return `<div class="overview-metrics metricrow">${metrics.map(([label, count, meaning, glyph]) => `<div class="metric" title="${e(meaning)}"><span class="label">${icon(glyph)} ${label}</span><strong>${number(count)}</strong></div>`).join("")}</div>
      <div class="overview-layout"><section class="card priority-panel"><div class="section-heading"><div><h2>Needs your attention</h2></div><span class="count-badge">${number(queue.length + unresolved.length)}</span></div>
      ${decisions ? `<div class="worklist-heading">Awaiting your decision</div>${decisions}` : ""}
      ${needs ? `<div class="worklist-heading">Unmet needs</div>${needs}<p class="small priority-caption">Confirm the situation before committing resources.</p>` : ""}
      ${!decisions && !needs ? empty("No verified priorities yet. Connect sources or request a field assessment. Unknown areas remain unknown.", "clipboard-check") : ""}
      <div class="panel-footer">${action("Open decision queue →", "navigate", "review", "quiet")}</div></section>
      <aside class="context-rail" aria-label="Investigation and operational context">${activity}${coverage}</aside></div>
      <details class="secondary-disclosure overview-secondary" data-ui-key="overview:source-health"><summary><span>${icon("radio")} Source health</span><span class="details-meta">${e(sourceStatus)}</span></summary><div class="disclosure-content">${d.source.length ? d.source.map(s => `<div class="listrow"><div class="grow"><h3>Signal network & operational systems</h3><p>${s.changed ?? 0} new or revised signals · ${s.lastSuccessAt ? "Last sync " + e(time(s.lastSuccessAt)) : "No successful sync"}</p></div>${badge(s.state)}</div>`).join("") : empty("No source is connected yet. Public feeds are ingested automatically when configured.", "radio")}<div class="toolbar">${action("Manage", "navigate", "settings", "quiet")}<span class="small">A gap in reports does not mean a gap in needs.</span></div></div></details>`;
  }

  function signals(rows) {
    return `<div class="signal-list">${rows.map(s => `<article class="signal-card"><div class="sourceavatars"><div class="socialavatar">${e((s.authorName ?? s.source ?? "S").slice(0, 1))}</div><div class="grow"><strong>${e(s.authorName ?? s.source)}</strong><span class="small">${e(s.source)}</span></div>${badge(s.state)}</div><p class="signaltext signal-excerpt">${e(s.text)}</p>${s.attachments?.length ? `<details class="signal-attachments" data-ui-key="signal:${e(s.id)}:attachments"><summary>${icon(s.attachments[0].kind === "audio" ? "audio-lines" : s.attachments[0].kind === "video" ? "video" : "image")}${s.attachments.length} ${s.attachments.length === 1 ? "attachment" : "attachments"}${icon("chevron-down")}</summary>${s.attachments.map(m => `<div class="media">${icon(m.kind === "video" ? "video" : m.kind === "audio" ? "audio-lines" : "image")}<div><strong>${e(m.kind)} attachment</strong><p>${e(m.description)}</p><span class="small">Synthetic description · not a verified recording</span></div></div>`).join("")}</details>` : ""}<div class="signal-footer"><span class="small">${icon("map-pin")}${e(entityLabel(s.location) || "Location not confirmed")}</span>${action("Inspect source", "signal", s.id, "quiet")}</div></article>`).join("") || `<section class="card">${empty("No signals match. Sources will appear here after the first sync.", "radio")}</section>`}</div>`;
  }

  function resourceTable(rows, { usable, available, staffBadge, expiryLabel }) {
    return table(["Resource", "Available to commit", "Reserved", ""], rows.map(r => `<tr><td><strong>${e(resourceLabel(r))}</strong><small>${e(entityLabel(r.node) || "Location unknown")}${r.owner && r.owner !== state.user.org ? " · " + e(entityLabel(r.owner)) : ""}</small></td><td><strong>${number(available(r))}</strong> ${e(r.unit ?? "units")}${r.type === "staff" ? " " + staffBadge(r) : usable(r) ? "" : " " + badge(r.condition ?? "expired")}${r.useByAt !== undefined ? `<small>${e(expiryLabel(r.useByAt))}</small>` : ""}</td><td>${number(r.reserved)}${r.floor ? `<small>${number(r.floor)} ${e(r.unit ?? "units")} protected</small>` : ""}</td><td><div class="resource-actions">${r.owner === state.user.org && usable(r) ? action("Reserve", "reserve", r.id) : ""} ${r.owner === state.user.org ? action("Share", "share", r.id) : ""}</div><details class="row-details" data-ui-key="resource:${e(r.id)}"><summary>Record details</summary><p class="small">${e(r.id)} · ${e(entityLabel(r.owner))}<br>v${r.version}${r.sourceVersion ? " · source v" + e(r.sourceVersion) : ""}${r.lotId ? " · Lot " + e(r.lotId) : ""}</p></details></td></tr>`));
  }
  return { navigation, overview, signals, resourceTable };
}
