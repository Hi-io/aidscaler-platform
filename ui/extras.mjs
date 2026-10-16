import { entityLabel, humanLabel, readableText } from "./labels.mjs";
import { actionBrief } from "./uploads.mjs";
/** Progressive disclosure for evidence, connector setup and manual fallbacks. */
export function createExtras(h) {
  const {
    api,
    record,
    escape: e,
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
  } = h;
  let editing = null;
  const options = (rows, label) =>
    rows
      .map((r) => `<option value="${e(r.id)}">${e(label(r))}</option>`)
      .join("");
  const allowed = (roles) => roles.includes(state.user?.role);
  async function media() {
    const rows = (await record("media")).filter((m) => m.state !== "erased"),
      canUpload = allowed(["field", "analyst", "commander", "dispatcher"]);
    return (
      title(
        "Source media",
        "Original image, video, audio and document bytes stay with their source. Interpretation remains unverified.",
      ) +
      `<section class="card" aria-labelledby="recent-media-heading"><div class="cardheader section-heading"><div><h2 id="recent-media-heading">Recent source media</h2><p class="small">Inspect the original file, its source and processing state.</p></div><span class="badge">${rows.length} ${rows.length === 1 ? "source file" : "source files"}</span></div>${
        rows
          .slice(0, 12)
          .map(
            (m) =>
              `<div class="listrow"><div class="rowicon">${icon(m.mime.startsWith("audio") ? "volume-2" : m.mime.startsWith("video") ? "play" : m.mime.includes("pdf") ? "file-text" : "image")}</div><div class="grow"><h3>${e(m.title)}</h3><p>${e(m.source)} · ${Math.round(m.size / 1024)} KB</p>${badge(m.state)}</div>${action("Inspect", "media-open", m.id)}</div>`,
          )
          .join("") || empty("No source files are available yet. Received attachments appear here." + (canUpload ? " You can also add an original file below." : ""), "image")
      }${rows.length > 12 ? `<p class="note">Showing the 12 most recent of ${rows.length} source files.</p>` : ""}</section>${canUpload ? `<details id="media-intake" class="card collapse secondary-disclosure media-intake" ${state.user.role === "field" ? "open" : ""}><summary>Add an attachment</summary><p class="sub">Add an original file from an authorized source when it is not already available through a connected channel.</p><form id="mediaform" class="fieldform"><label>Source file<input type="file" name="file" accept="image/png,image/jpeg,video/mp4,audio/wav,audio/mpeg,application/pdf,text/plain" required></label><label>Source or owner<input name="source" placeholder="Authorized field team or source URL" required></label><label>Short description<input name="title" placeholder="What does this source represent?" required maxlength="150"></label><button class="primary" type="submit">${icon("upload")} Preserve original evidence</button><p class="note">Up to 10 MB. Processing keeps the original available.</p><details class="form-disclosure"><summary>Supported analysis & limits</summary><p class="small">Audio uses local speech recognition. Images and sampled video frames use the configured model. Scanned PDFs may require OCR. Interpretation still needs verification.</p></details></form></details>` : ""}`
    );
  }
  async function mediaOpen(id) {
    const m = await record("media", id),
      a = await record("media_analysis", id).catch(() => null),
      src = "/api/media?id=" + encodeURIComponent(id);
    const preview = m.mime.startsWith("image")
      ? `<img class="evidence-preview" src="${src}" alt="${e(m.title)}">`
      : m.mime.startsWith("audio")
        ? `<audio controls src="${src}" aria-label="Original audio"></audio>`
        : m.mime.startsWith("video")
          ? `<video class="evidence-preview" controls src="${src}" aria-label="Original video"></video>`
          : `<a href="${src}" target="_blank" rel="noopener">Open original document ↗</a>`;
    const result = a?.result;
    const summary =
      result?.text ??
      result?.observations?.summary ??
      result?.observations?.observations
        ?.map((o) => (typeof o === "string" ? o : o.description))
        .join("\n") ??
      "";
    modal(
      "Inspect original evidence",
      `<h2>${e(m.title)}</h2><p class="sub">${e(m.source)} · ${badge(m.state)}</p>${preview}<p class="note">Original hash: ${e(m.contentHash.slice(0, 20))}</p>${a ? `<section class="decision"><span class="eyebrow">INTERPRETED · NEEDS VERIFICATION</span><p class="preserve-lines">${e(summary || "Decoded source available in details below.")}</p></section><details class="collapse"><summary>Transcript, observations & processing receipt</summary><pre class="trace">${e(JSON.stringify(result, null, 2))}</pre></details>` : ["queued", "processing"].includes(m.state) ? '<div class="card processing"><span class="spark">✦</span> Processing source bytes. The original stays available.</div>' : `<p class="sub">${m.state === "failed" ? "Processing failed. You can retry; the failure and any provider costs remain recorded." : "No interpretation has completed yet. The original remains available."}</p>`}`,
      `${result?.pendingPageNumbers?.length && !["queued", "processing"].includes(m.state) && allowed(["field", "analyst", "commander", "dispatcher"]) ? action(`Read next ${Math.min(4, result.pendingPageNumbers.length)} pending pages`, "media-continue", id, "primary") : !a && !["queued", "processing"].includes(m.state) && allowed(["field", "analyst", "commander", "dispatcher"]) ? action(m.state === "failed" ? "Retry source analysis" : "Analyze source bytes", "media-analyze", id, "primary") : ""}${allowed(["admin", "commander"]) ? action("Review local erasure", "erase-media", id) : ""}${action("Close", "close")}`,
    );
  }
  async function connections() {
    const rows = await record("integration");
    return (
      title(
        "External connections",
        "Read existing services through scoped JSON or MCP connectors. External data remains evidence, not operational authority.",
      ) +
      `<section class="card"><div class="cardheader section-heading"><h2>Approved connections</h2>${allowed(["admin"]) ? action("Add a read connector", "integration-new", "", "accent") : ""}</div>${rows.map((c) => `<div class="listrow"><div class="rowicon">${icon("plug")}</div><div class="grow"><h3>${e(c.name)}</h3><p>${e(c.purpose)}</p><small>${e(c.type)} · ${e(new URL(c.url).origin)}</small></div>${badge(c.state)}${allowed(["admin", "analyst", "commander", "dispatcher"]) ? action("Read source", "integration-read", c.id) : ""}</div>`).join("") || empty("Register a permitted source once. No need to paste every report manually.", "plug")}<details class="collapse secondary-disclosure"><summary>What happens to an external result?</summary><p class="sub">AidScaler preserves its origin, collection time, license and hash. Received records enter the evidence queue as unverified. Credentials stay on the server. MCP permissions are explicit and this instance exposes a separate read-only MCP endpoint.</p></details></section>`
    );
  }
  function integrationNew() {
    modal(
      "Register a permitted source",
      `<form id="integrationform" class="fieldform"><label>Connection ID<input name="id" required pattern="[a-zA-Z0-9_-]{2,80}"></label><label>Name<input name="name" required></label><label>Connector type<select name="type"><option value="http_json">Read-only JSON API</option><option value="mcp">Read-only MCP</option></select></label><label>Exact source URL<input name="url" type="url" required></label><label>Why may we access this source?<textarea name="purpose" required minlength="5"></textarea></label><label>Permission or license<input name="license" required></label><label>Automatic JSON read interval<select name="pollMs"><option value="">Manual read</option><option value="30000">Every 30 seconds</option><option value="60000">Every minute</option><option value="300000">Every 5 minutes</option></select></label><p class="note">Automatic reads preserve new versions and feed budgeted investigations. MCP reads require explicit tool arguments.</p><details class="collapse"><summary>MCP scope & dedicated credential</summary><label>Permitted MCP tools<input name="allowedTools" placeholder="aidscaler_signals, aidscaler_evidence"></label><label>Server environment variable<input name="credentialsEnv" placeholder="AIDSCALER_CONNECTOR_PARTNER" pattern="AIDSCALER_CONNECTOR_[A-Z0-9_]+"></label><p class="note">Enter a dedicated variable name. Never paste a token into this form.</p></details><button type="submit" class="primary">Register connector</button></form>`,
    );
  }
  async function caseOpen(id) {
    const n = await record("need", id),
      [proposals, operations, claims] = await Promise.all(
        ["proposal", "operation", "claim"].map((k) => record(k)),
      );
    const related = proposals.filter(
        (p) =>
          p.references.includes(id) ||
          p.actions.some((a) => a.params.need === id),
      ),
      ops = operations.filter((o) => o.need === id),
      incoming = ops
        .filter(
          (o) =>
            !["failed", "cancelled", "completed", "received"].includes(o.state),
        )
        .reduce((s, o) => s + (o.quantity ?? 0), 0);
    modal(
      "Response case",
      `<span class="eyebrow">RECEIVED OPERATIONAL NEED</span><h2>${e(humanLabel(n.type))} · ${e(entityLabel(n.building ?? n.node))}</h2><div class="stats cols3 case-stats"><div class="stat"><span>Still needed</span><strong>${Math.max(0, n.quantity - (n.served ?? 0))}</strong><small>${e(n.unit)}</small></div><div class="stat"><span>Received</span><strong>${n.served ?? 0}</strong><small>${e(n.unit)} · source confirmed</small></div><div class="stat"><span>In progress</span><strong>${incoming}</strong><small>${e(n.unit)} · receipt pending</small></div></div>${n.population ? `<p class="case-population">${n.population} people reported at this location</p>` : ""}<section class="decision"><h3>Responses and responsible owners</h3>${related.filter(p => !["rejected", "cancelled"].includes(p.state)).map((p) => `<div class="listrow"><div class="grow"><strong>${e(readableText(p.title))}</strong><p>${e(readableText(p.benefit))}</p>${badge(p.state)}</div>${action("Review", "proposal", p.id)}</div>`).join("") || "<p>No response has been prepared yet. The agent checks received information as it arrives.</p>"}</section>${related.some(p => ["rejected", "cancelled"].includes(p.state)) ? `<details class="collapse"><summary>Previous responses · ${related.filter(p => ["rejected", "cancelled"].includes(p.state)).length}</summary>${related.filter(p => ["rejected", "cancelled"].includes(p.state)).map(p => `<div class="listrow"><div class="grow"><strong>${e(readableText(p.title))}</strong>${badge(p.state)}</div>${action("Review", "proposal", p.id)}</div>`).join("")}</details>` : ""}<details class="collapse"><summary>Request an additional check</summary><p class="note">The agent processes received information automatically. Ask for another check when you have new context.</p>${allowed(["analyst", "commander", "dispatcher"]) ? action("Request another investigation", "investigatecase", id) + action("Compare competing needs", "response-options", id) + action("Prepare a manual response", "manual-response", id) : ""}</details><details class="collapse"><summary>Source observations & current record</summary><pre class="trace">${e(JSON.stringify(n, null, 2))}</pre></details>`,
      action("Close", "close"),
    );
  }
  async function manual(id) {
    const [needs, resources, vehicles] = await Promise.all(
      ["need", "resource", "vehicle"].map((k) => record(k)),
    );
    modal(
      "Prepare a manual response",
      `<p class="sub">The same constraints and human review apply when a model or connector is unavailable.</p><form id="manualform" class="fieldform"><label>Need<select name="need">${options(needs, (n) => humanLabel(n.type) + " · " + entityLabel(n.building ?? n.node))}</select></label><label>Owned inventory<select name="resource">${options(
        resources.filter((r) => r.owner === state.user.org),
        (r) =>
          r.type +
          " · " +
          Math.max(0, r.quantity - r.reserved - r.floor) +
          " available",
      )}</select></label><label>Owned vehicle<select name="vehicle">${options(
        vehicles.filter((v) => v.owner === state.user.org),
        (v) => entityLabel(v.id) + " · " + v.state,
      )}</select></label><label>Quantity in the resource's native unit<input name="quantity" type="number" min="1" step="1" required></label><label>Why is this response appropriate?<textarea name="rationale" required></textarea></label><button class="primary" type="submit">Prepare for review</button></form>`,
    );
    if (id) document.querySelector('#manualform [name="need"]').value = id;
  }
  async function edit(id) {
    editing = await record("proposal", id);
    modal(
      "Revise before authorization",
      `<form id="editform" class="fieldform"><label>Response title<input name="title" value="${e(editing.title)}" required></label><label>Benefit<input name="benefit" value="${e(editing.benefit)}" required></label>${editing.actions
        .map(
          (a, i) =>
            `<details class="collapse" ${i === 0 ? "open" : ""}><summary>Step ${i + 1} · ${e(a.type)} · ${e(a.owner)}</summary>${Object.entries(
              a.params,
            )
              .filter(([, v]) =>
                ["string", "number", "boolean"].includes(typeof v),
              )
              .map(
                ([key, v]) =>
                  `<label>${e(key.replaceAll("_", " "))}<input data-step="${i}" data-param="${e(key)}" data-kind="${typeof v}" ${typeof v === "number" ? 'type="number" step="1"' : ""} value="${e(v)}"></label>`,
              )
              .join("")}</details>`,
        )
        .join(
          "",
        )}<label>What changed and why?<textarea name="note" required></textarea></label><p class="note">Previous authorization is invalidated. Issued physical work cannot be erased by editing. Evidence and declared conditions remain attached.</p><button class="primary" type="submit">Save revision for review</button></form>`,
    );
  }
  async function moderation() {
    const all = (await record("report")).filter(r => r.origin === "community-public"),
      reviewed = all.filter(r => r.state !== "pending_moderation");
    const rows = all.filter(
      (r) => r.state === "pending_moderation",
    );
    return (
      title(
        "Community reports",
        "Keep legitimate requests visible while checking origin, place, time and duplicates.",
      ) +
      `<section class="card"><div class="cardheader section-heading"><h2>Awaiting review</h2><span class="badge">${rows.length} ${rows.length === 1 ? "report" : "reports"}</span></div><p class="note">Accepting a report preserves an observation; it does not confirm it or dispatch aid.</p>${
        rows
          .slice(0, 16)
          .map(
            (r) =>
              `<article class="listrow"><div class="rowicon coral">${icon("message-square")}</div><div class="grow"><h3>${e(r.location ?? "Unconfirmed location")}</h3><p>${e(r.text)}</p>${badge("pending_moderation")}<small>Observed ${new Date(r.observedAt).toLocaleString()}</small>${r.references?.map((ref) => action("Inspect attachment", "media-open", ref, "quiet")).join("") ?? ""}</div><div class="actions">${action("Keep for investigation", "report-accept", r.id, "accent")}${action("Reject with reason", "report-reject", r.id)}</div></article>`,
          )
          .join("") ||
        empty("No community reports are awaiting moderation.", "check")
      }${rows.length > 16 ? `<p class="note">Showing 16 of ${rows.length} reports awaiting moderation.</p>` : ""}</section>${reviewed.length ? `<section class="card"><div class="cardheader"><h2>Keep people informed</h2><span class="badge">${reviewed.length} reviewed</span></div><p class="note">Share a short update with the person who sent a report, or link a source-confirmed response.</p>${reviewed.slice(0, 12).map(r => `<article class="listrow"><div class="rowicon">${icon("message-square")}</div><div class="grow"><h3>${e(r.location || "Community report")}</h3><p>${e(r.text.length > 180 ? r.text.slice(0, 180) + "…" : r.text)}</p>${badge(r.state)}</div>${allowed(["analyst", "commander", "dispatcher"]) ? action("Send update", "report-followup", r.id) : ""}</article>`).join("")}</section>` : ""}`
    );
  }
  async function run(name, id) {
    if (name === "media-continue") {
      const a = await record("media_analysis", id);
      await api("/api/media/analyze", { id, pages: a.result.pendingPageNumbers.slice(0, 4) });
      toast("Next page batch queued. Existing transcriptions stay available.");
      return true;
    }
    if (name === "media-open") {
      await mediaOpen(id);
      return true;
    }
    if (name === "media-analyze") {
      await api("/api/media/analyze", { id });
      toast("Source processing queued. Original evidence remains unverified.");
      return true;
    }
    if (name === "integration-new") {
      integrationNew();
      return true;
    }
    if (name === "integration-read") {
      const c = await record("integration", id);
      if (c.type === "mcp") {
        modal(
          "Choose a permitted read",
          `<form id="mcpread"><input name="id" type="hidden" value="${e(id)}"><label>Permitted read tool<select name="tool">${c.allowedTools.map((t) => `<option>${e(t)}</option>`).join("")}</select></label><button class="primary">Read source</button></form>`,
        );
      } else {
        await api("/api/integration/read", { id });
        toast("Source received as unverified evidence.");
        await render();
      }
      return true;
    }
    if (name === "case") {
      await caseOpen(id);
      return true;
    }
    if (name === "manual-response") {
      await manual(id);
      return true;
    }
    if (name === "edit-response") {
      await edit(id);
      return true;
    }
    if (name === "investigatecase") {
      await api("/api/investigate", { ids: [], needId: id });
      dialogClose();
      state.page = "investigations";
      location.hash = "investigations";
      await render();
      return true;
    }
    if (name.startsWith("report-")) {
      const r = await record("report", id);
      modal(
        "Review community observation",
        `<form id="moderateform" class="fieldform"><input name="id" type="hidden" value="${e(id)}"><input name="version" type="hidden" value="${r.version}"><input name="decision" type="hidden" value="${name === "report-accept" ? "accept" : "reject"}"><label>Reason or verification still required<textarea name="reason" required></textarea></label><button class="primary">Record review</button></form>`,
      );
      return true;
    }
    return false;
  }
  const dialogClose = () => document.querySelector("dialog")?.close();
  function bind(root) {
    const on = (id, fn) =>
      root.querySelector(id)?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const button = ev.target.querySelector('button[type="submit"],button');
        if (button) button.disabled = true;
        try {
          await fn(ev.target);
        } catch (err) {
          toast(err.message);
        } finally {
          if (button) button.disabled = false;
        }
      });
    on("#mediaform", async (form) => {
      const file = form.file.files[0];
      if (file.size > 10000000) throw new Error("Choose a source up to 10 MB.");
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const result = await api("/api/media/upload", {
        mime: file.type === "audio/x-wav" ? "audio/wav" : file.type,
        contentBase64: base64,
        title: form.elements.namedItem("title").value,
        source: form.source.value,
        observedAt: Date.now(),
      });
      toast("Original source preserved.");
      await render();
      await mediaOpen(result.id);
    });
    on("#integrationform", async (form) => {
      const data = Object.fromEntries(new FormData(form));
      data.allowedOrigin = new URL(data.url).origin;
      data.allowedTools = data.allowedTools
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!data.credentialsEnv) delete data.credentialsEnv;
      if (data.pollMs && data.type === "http_json")
        data.pollMs = Number(data.pollMs);
      else delete data.pollMs;
      await api("/api/integration/configure", data);
      dialogClose();
      await render();
    });
    on("#mcpread", async (form) => {
      await api("/api/integration/read", {
        ...Object.fromEntries(new FormData(form)),
        arguments: {},
      });
      dialogClose();
      toast("Permitted source data received.");
      await render();
    });
    on("#manualform", async (form) => {
      const data = Object.fromEntries(new FormData(form));
      const r = await api("/api/propose", {
        title: "Manual response for observed " + data.need,
        summary: "Deliver " + data.quantity + " units with an owned vehicle.",
        benefit: "Proportionate help for an observed need",
        rationale: data.rationale,
        references: [data.need, data.resource, data.vehicle],
        conditions: [],
        actions: [
          {
            type: "dispatch",
            owner: state.user.org,
            params: {
              need: data.need,
              resource: data.resource,
              vehicle: data.vehicle,
              quantity: Number(data.quantity),
            },
            dependsOn: [],
          },
        ],
      });
      dialogClose();
      toast("Draft response prepared. Authorization is still required.");
      state.page = "review";
      location.hash = "review";
      await render();
    });
    on("#editform", async (form) => {
      const data = Object.fromEntries(new FormData(form)),
        p = editing;
      const actions = structuredClone(p.actions);
      for (const input of form.querySelectorAll("[data-param]"))
        actions[Number(input.dataset.step)].params[input.dataset.param] =
          input.dataset.kind === "number"
            ? Number(input.value)
            : input.dataset.kind === "boolean"
              ? input.value === "true"
              : input.value;
      await api("/api/proposal/revise", {
        id: p.id,
        version: p.version,
        title: data.title,
        benefit: data.benefit,
        note: data.note,
        summary: actions.map(actionBrief).join("; ").slice(0, 1200),
        references: p.references,
        conditions: p.conditions,
        priority: p.priority,
        alternatives: p.alternatives,
        rationale: p.rationale,
        actions,
      });
      dialogClose();
      toast("Revision saved. A new authorization is required.");
      await render();
    });
    on("#moderateform", async (form) => {
      const b = Object.fromEntries(new FormData(form));
      await api("/api/report/moderate", { ...b, version: Number(b.version) });
      dialogClose();
      await render();
    });
  }
  return { media, connections, moderation, run, bind };
}
