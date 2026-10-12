export function createOrganizationControls(h) {
  const { api, escape: e, action, state, modal, toast, render, close } = h;
  let profile;
  const manages = () => ["admin", "commander"].includes(state.user.role);
  async function summary() {
    const p = await api("/api/organization"),
      { policy } = await api("/api/automation");
    state.organizationProfile = p;
    return `<section class="card" style="margin-top:22px"><div class="cardheader"><h2>Organization readiness</h2>${manages() ? action("Configure response", "organization-edit", "", "accent") : ""}</div><p class="sub">${e(p.name)} · ${e(p.response)}</p><details class="collapse"><summary>Responsibilities, coverage & processing policy</summary><p class="small">Coordinator: ${e(p.coordinator)}<br>Coverage: ${e(p.zones.join(" · ") || "Not specified")}<br>Retention review period: ${p.retentionDays} days. This is a documented review policy; data is not silently deleted.<br>Automatic intake: ${policy.enabled ? "enabled" : "paused"} · ${policy.maxSignals} signals per batch · ${policy.hourlyCallLimit} model calls/hour · $${policy.hourlyBudgetUsd}/hour maximum.</p>${manages() ? action("Edit processing limits", "organization-policy", "") : ""}</details></section>`;
  }
  async function run(name) {
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
        `<form id="organization-policy" class="fieldform"><label class="checkbox"><input name="enabled" type="checkbox" ${p.enabled ? "checked" : ""}>Enable automatic investigation of received sources</label><label>Signals per batch<input name="maxSignals" type="number" min="1" max="35" value="${p.maxSignals}" required></label><label>Source groups per batch<input name="maxGroups" type="number" min="1" max="3" value="${p.maxGroups}" required></label><label>Model calls per organization/hour<input name="hourlyCallLimit" type="number" min="1" value="${p.hourlyCallLimit}" required></label><label>USD budget per organization/hour<input name="hourlyBudgetUsd" type="number" min="0.001" step="0.001" value="${p.hourlyBudgetUsd}" required></label><p class="note">These may lower the server's maximum, never raise it. Unknown-cost calls keep their conservative reservation. The model never receives dispatch authority.</p><button class="primary">Apply audited policy</button></form>`,
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
    on("#organization-policy", (d) =>
      api("/api/automation", {
        enabled: d.get("enabled") === "on",
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
      link.download = `nexo-private-${result.organization}-${result.kind}-${result.offset}.json`;
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
