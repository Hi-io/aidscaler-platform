import { entityLabel, humanLabel } from "./labels.mjs";
export function createOrganizationControls(h) {
  const { api, escape: e, action, state, modal, toast, render, close } = h;
  let profile;
  let responsePolicy;
  let following;
  const manages = () => ["admin", "commander"].includes(state.user.role);
  async function summary() {
    const p = await api("/api/organization"),
      { policy } = await api("/api/automation");
    state.organizationProfile = p;
    return `<section class="card" style="margin-top:22px"><div class="cardheader"><h2>Organization readiness</h2>${manages() ? `<div class="actions">${action("Public page appearance", "organization-portal", "")}${action("Configure response", "organization-edit", "", "accent")}</div>` : ""}</div><p class="sub">${e(p.name)} · ${e(p.response)}</p><details class="collapse"><summary>Responsibilities, coverage & processing policy</summary><p class="small">Coordinator: ${e(p.coordinator)}<br>Coverage: ${e(p.zones.join(" · ") || "Not specified")}<br>Retention review period: ${p.retentionDays} days.<br>Automatic intake: ${policy.enabled ? "enabled" : "paused"} · ${policy.maxSignals} signals per batch · ${policy.hourlyCallLimit} model calls/hour · $${policy.hourlyBudgetUsd}/hour maximum.</p>${manages() ? action("Edit processing limits", "organization-policy", "") : ""}${state.user.role === "commander" ? action("Set response priorities", "response-policy", "") : ""}</details></section>`;
  }
  async function run(name, id) {
    if (name === "report-followup") {
      following = await api("/api/report/followup?id=" + encodeURIComponent(id));
      const operations = await api("/api/records?kind=operation");
      modal("Reply to a community report", `<p class="sub">${e(following.report.text)}</p><form id="report-followup" class="fieldform"><label>Update for the person who reported this<textarea name="note" minlength="3" maxlength="1000" required placeholder="What has the team checked? What happens next?">${e(following.followup?.note ?? "")}</textarea></label><details class="collapse"><summary>Link an actual response · optional</summary><label>Source-confirmed operation<select name="operation"><option value="">No operation linked</option>${operations.filter(o => o.confirmedBySource === true).map(o => `<option value="${e(o.id)}" ${following.followup?.operation === o.id ? "selected" : ""}>${e(humanLabel(o.type ?? "Response"))} · ${e(o.quantity ?? "")} ${e(o.unit ?? "")} · ${e(entityLabel(o.need ?? o.building ?? o.destination ?? o.vehicle ?? "Team response"))} · ${e(humanLabel(o.state))}</option>`).join("")}</select></label><p class="note">Link only a response that serves this report. Travel and receipt states come from the received operational source, never from this note.</p></details><p class="note">The holder of the private tracking reference will see this update. Omit personal details and sensitive locations.</p><button class="primary">Send progress update</button></form>`);
      return true;
    }
    if (name === "organization-portal") {
      profile = await api("/api/organization");
      const p = profile.portal;
      modal("Your organization's public pages", `<form id="organization-portal" class="fieldform"><p class="note">Your organization leads these pages. AidScaler appears only as the supporting platform.</p><label>Organization name<input name="name" required minlength="3" maxlength="120" value="${e(profile.name)}"></label><label>Public page title<input name="title" required minlength="3" maxlength="100" value="${e(p.title)}"></label><label>Public page introduction<textarea name="description" minlength="3" maxlength="400" required>${e(p.description)}</textarea></label><details class="collapse"><summary>Report page wording</summary><label>Report page title<input name="communityTitle" required minlength="3" maxlength="100" value="${e(p.communityTitle)}"></label><label>Report page introduction<textarea name="communityDescription" required minlength="3" maxlength="400">${e(p.communityDescription)}</textarea></label></details><label>Accent color<input name="accent" type="color" value="${e(p.accent)}"></label><label>Banner image · optional<input name="banner" type="file" accept="image/png,image/jpeg"></label><p class="note">PNG or JPEG, up to 300 KB. Choose an image safe for public display; remove identifying people, private details and metadata before uploading.</p><label>Banner description<input name="bannerAlt" maxlength="160" value="${e(p.bannerAlt)}"></label>${p.bannerDataUrl ? '<label class="checkbox"><input type="checkbox" name="removeBanner">Remove uploaded banner</label>' : ""}<button class="primary">Save public pages</button><a href="/public" target="_blank" rel="noopener">Preview public page ↗</a></form>`);
      return true;
    }
    if (name === "response-policy") {
      responsePolicy = await api("/api/response-policy");
      modal("Set response priorities", `<form id="response-policy" class="fieldform"><label>Order of unmet needs<select name="order"><option value="deadline_then_priority" ${responsePolicy.order === "deadline_then_priority" ? "selected" : ""}>Useful window first, then declared priority</option><option value="priority_then_deadline" ${responsePolicy.order === "priority_then_deadline" ? "selected" : ""}>Declared priority first, then useful window</option></select></label><details class="collapse"><summary>Protected need types</summary><p class="note">Select only when your operational mandate explicitly gives these needs precedence.</p>${["water", "food", "medicine", "shelter", "rescue", "blankets", "transport", "communication"].map((type) => `<label class="checkbox"><input name="protectedTypes" type="checkbox" value="${type}" ${responsePolicy.protectedTypes.includes(type) ? "checked" : ""}>${e(type)}</label>`).join("")}</details><label>Maximum open reviews<input name="maxOpenReviews" type="number" min="1" max="100" value="${responsePolicy.maxOpenReviews}" required></label><label>Minimum time before a changed case is reconsidered · seconds<input name="cooldown" type="number" min="1" max="3600" value="${responsePolicy.investigationCooldownMs / 1000}" required></label><label>Reason and operational mandate<textarea name="reason" minlength="5" maxlength="500" required>${e(responsePolicy.reason)}</textarea></label><p class="note">Quantities remain in their own units. This policy guides inquiry and finite resources; it does not authorize a delivery or turn an unknown area into zero demand.</p><button class="primary">Approve this policy version</button></form>`);
      return true;
    }
    if (name === "organization-edit") {
      profile = await api("/api/organization");
      modal(
        "Configure your response",
        `<form id="organization-profile" class="fieldform"><label>Organization name<input name="name" required minlength="3" maxlength="120" value="${e(profile.name)}"></label><label>Active emergency or response<input name="response" required minlength="3" maxlength="160" value="${e(profile.response)}"></label><label>Responsible coordinator<input name="coordinator" required minlength="3" maxlength="120" value="${e(profile.coordinator)}"></label><label>Coverage areas · one per line<textarea name="zones">${e(profile.zones.join("\n"))}</textarea></label><details class="collapse"><summary>Retention review policy</summary><label>Days between evidence-retention reviews<input name="retentionDays" type="number" min="1" max="3650" value="${profile.retentionDays}" required></label><p class="note">Review includes source access, licenses and private copies. This setting records the review interval; it does not claim complete automatic erasure of derived records or backups.</p></details><button class="primary">Save versioned configuration</button></form><p class="note">Your progress is saved on this instance. Connect sources and scoped operational tools on the External connections page, then inspect actual received data before enabling automatic intake.</p>`,
      );
      return true;
    }
    if (name === "organization-policy") {
      const { policy: p } = await api("/api/automation");
      modal(
        "Set finite processing limits",
        `<form id="organization-policy" class="fieldform"><label class="checkbox"><input name="enabled" type="checkbox" ${p.enabled ? "checked" : ""}>Enable automatic processing of received sources</label><label class="checkbox"><input name="discoveryMode" type="checkbox" ${p.discoveryMode ? "checked" : ""}>Use source discovery: interpret signals, request checks and prepare verified responses</label><details class="collapse"><summary>Investigator workflow</summary><label class="checkbox"><input name="interpretSources" type="checkbox" ${p.interpretSources ? "checked" : ""}>Create sourced interpretations before a full investigation</label><p class="note">Source discovery uses a bounded interpretation pass. Already structured responses use deterministic checks; complex service composition and repair remain separate investigations.</p></details><label>Signals per batch<input name="maxSignals" type="number" min="1" max="35" value="${p.maxSignals}" required></label><label>Source groups per batch<input name="maxGroups" type="number" min="1" max="35" value="${p.maxGroups}" required></label><label>Model calls per organization/hour<input name="hourlyCallLimit" type="number" min="1" value="${p.hourlyCallLimit}" required></label><label>USD budget per organization/hour<input name="hourlyBudgetUsd" type="number" min="0.001" step="0.001" value="${p.hourlyBudgetUsd}" required></label><p class="note">These may lower the server's maximum, never raise it. The default is three source groups; increase it within the 35-signal batch limit when appropriate. Unknown-cost calls keep their conservative reservation. Every action still requires its owner's review.</p><button class="primary">Apply audited policy</button></form>`,
      );
      return true;
    }
    if (name === "organization-export") {
      modal(
        "Export private organizational records",
        `<form id="organization-export" class="fieldform"><label>Record type<select name="kind">${["audit", "signal", "claim", "proposal", "operation", "resource", "report", "publication", "commitment", "task"].map((k) => `<option>${k}</option>`).join("")}</select></label><label>Page offset<input name="offset" type="number" min="0" max="10000000" value="0" required></label><p class="note">Up to 200 records per page. Exports contain private operational information. Keep them outside public repositories; each export is audited.</p><button class="primary">Download selected page</button></form>`,
      );
      return true;
    }
    return false;
  }
  function bind(root) {
    const on = (selector, fn) =>
      root.querySelector(selector)?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const button = ev.target.querySelector("button");
        button.disabled = true;
        try {
          await fn(new FormData(ev.target));
          await close();
          await render();
        } catch (err) {
          toast(err.message);
          button.disabled = false;
        }
      });
    on("#organization-profile", (d) =>
      api("/api/organization", {
        name: d.get("name"),
        response: d.get("response"),
        coordinator: d.get("coordinator"),
        zones: String(d.get("zones"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        retentionDays: Number(d.get("retentionDays")),
        version: profile.version,
      }),
    );
    on("#organization-portal", async d => {
      let bannerDataUrl = d.get("removeBanner") === "on" ? "" : profile.portal.bannerDataUrl;
      const file = d.get("banner");
      if (file?.size) {
        if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 300000) throw new Error("Choose a PNG or JPEG banner up to 300 KB.");
        bannerDataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Could not read the banner.")); reader.readAsDataURL(file); });
      }
      await api("/api/organization", { name: d.get("name"), response: profile.response, coordinator: profile.coordinator, zones: profile.zones, retentionDays: profile.retentionDays, version: profile.version, portal: { title: d.get("title"), description: d.get("description"), communityTitle: d.get("communityTitle"), communityDescription: d.get("communityDescription"), accent: d.get("accent"), bannerDataUrl, bannerAlt: d.get("bannerAlt") } });
      toast("Your organization's public pages are updated.");
    });
    on("#report-followup", d => api("/api/report/followup", { id: following.report.id, version: following.followup?.version ?? 0, note: d.get("note"), operation: d.get("operation") || null }));
    on("#response-policy", (d) => api("/api/response-policy", { version: responsePolicy.version, order: d.get("order"), maxOpenReviews: Number(d.get("maxOpenReviews")), investigationCooldownMs: Number(d.get("cooldown")) * 1000, protectedTypes: d.getAll("protectedTypes"), reason: d.get("reason") }));
    on("#organization-policy", (d) =>
      api("/api/automation", {
        enabled: d.get("enabled") === "on",
        discoveryMode: d.get("discoveryMode") === "on",
        interpretSources: d.get("interpretSources") === "on",
        ...Object.fromEntries(
          ["maxSignals", "maxGroups", "hourlyCallLimit", "hourlyBudgetUsd"].map(
            (k) => [k, Number(d.get(k))],
          ),
        ),
      }),
    );
    on("#organization-export", async (d) => {
      const result = await api(
          "/api/export?" +
            new URLSearchParams({
              kind: d.get("kind"),
              offset: d.get("offset"),
            }),
        ),
        link = document.createElement("a"),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(result, null, 2)], {
            type: "application/json",
          }),
        );
      link.href = url;
      link.download = `aidscaler-private-${result.organization}-${result.kind}-${result.offset}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(
        result.nextOffset == null
          ? "Export page downloaded. No further page."
          : `Export page downloaded. Continue at offset ${result.nextOffset}.`,
      );
    });
  }
  return { summary, run, bind };
}
