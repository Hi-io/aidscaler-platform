/** Contact coverage uses one compact notice; exact scope and costs open on demand. */
export function createCoverageControls({ api, escape: e, action, state, modal, toast, render, time }) {
  const readers = ["admin", "commander", "dispatcher", "analyst", "auditor"];
  const approvers = ["commander", "dispatcher"];
  async function card() {
    if (!readers.includes(state.user.role)) return "";
    const d = await api("/api/coverage"), gaps = d.counts.unknown + d.counts.stale;
    return `<section class="card coverage-card"><div class="cardheader"><h3>Contact coverage</h3>${action("Review coverage", "coverage-open", "", "quiet")}</div><p><strong>${gaps} ${gaps === 1 ? "place needs" : "places need"} a contact check</strong>${d.counts.checking ? ` · ${d.counts.checking} checking` : ""}</p><p class="small">${d.rows.length} places in ${d.policy ? "the owner-selected scope" : "the received directory"}. Missing contact never means a community is safe.</p>${d.sourceError ? `<p class="small">Contact source unavailable · ${e(d.sourceError)}. Existing checks are retained.</p>` : ""}</section>`;
  }
  async function open() {
    const d = await api("/api/coverage"), canApprove = approvers.includes(state.user.role);
    const count = d.rows.length, visible = d.rows.slice(0, 25);
    modal("Check communities we have not heard from", `<p class="sub">Choose an exact place from the received public directory. A check asks what is happening; it does not invent a need or authorize aid.</p>${d.policy ? `<p class="note">Owner-approved scope · ${count} places · at most ${d.policy.maxActive} active checks · ${Math.round(d.policy.maxWaitMs / 60000)} minute wait limit.</p>` : `<p class="note">A coordinator must approve the contact policy before any check can be sent.</p>`}<div class="coverage-list">${visible.map(r => `<div class="listrow"><div class="grow"><h3>${e(r.name)}</h3><p>${e(r.state.replaceAll("_", " "))} · ${r.lastContactAt === null ? "No received contact" : "Last contact " + e(time(r.lastContactAt))}${r.queueState ? " · " + e(r.queueState.replaceAll("_", " ")) : ""}</p>${r.attention ? `<p class="small">${e(r.attention)}</p>` : ""}</div></div>`).join("") || "<p>Receive the public map directory first.</p>"}</div>${count > 25 ? `<p class="small">First 25 of ${count} places. Every scoped place is available in the check selector.</p>` : ""}${canApprove && d.policy ? `<form id="coverage-check-form" class="fieldform"><label>Exact place<select name="building" aria-label="Exact place" required>${d.rows.map(r => `<option value="${e(r.id)}" ${r.state === "checking" ? "disabled" : ""}>${e(r.name)} · ${e(r.state.replaceAll("_", " "))}</option>`).join("")}</select></label><label>Channel<select name="method" aria-label="Channel">${d.policy.allowedMethods.map(m => `<option value="${m}">${m === "clarification" ? "Contact clarification · finite response queue" : "Radio field check · crew and vehicle required"}</option>`).join("")}</select></label><div id="coverage-radio-fields" hidden></div><label class="checkbox"><input name="confirmed" type="checkbox" required>I authorize this exact check and its channel. A missing response stays unknown.</label><button class="primary">Approve one contact check</button></form>` : ""}${state.user.role === "commander" && count ? `<details class="collapse"><summary>${d.policy ? "Change" : "Approve"} contact policy</summary><form id="coverage-policy-form" class="fieldform"><p class="small">Only checked places can be contacted. Changing this policy invalidates queued approvals that have not yet been issued.</p><div class="coverage-list">${d.directory.map(r => `<label class="checkbox"><input type="checkbox" name="place" value="${e(r.id)}" ${!d.policy || d.policy.placeIds.includes(r.id) ? "checked" : ""}>${e(r.name)}</label>`).join("")}</div><label>Contact becomes stale after (minutes)<input name="stale" type="number" min="1" max="1440" value="${Math.round((d.policy?.staleAfterMs ?? 1800000) / 60000)}" required></label><label>Maximum active checks<input name="active" type="number" min="1" max="5" value="${d.policy?.maxActive ?? 2}" required></label><label>Stop waiting after (minutes)<input name="wait" type="number" min="1" max="1440" value="${Math.round((d.policy?.maxWaitMs ?? 3600000) / 60000)}" required></label><label class="checkbox"><input name="radio" type="checkbox" ${d.policy?.allowedMethods.includes("radio") ? "checked" : ""}>Permit a radio field check with an explicitly selected crew and vehicle</label><label>Approval reason<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><button class="primary">Approve contact scope and limits</button></form></details>` : ""}<details class="collapse"><summary>Recent checks and pending source work</summary>${d.requests.slice(0, 15).map(r => `<section class="decision"><p>${r.checks.map(k => `${e(k.building)} · ${e(k.method)} · ${e(k.state.replaceAll("_", " "))}${k.reason ? " · " + e(k.reason) : ""}`).join("<br>")}</p>${canApprove && ["checking", "queued"].includes(r.state) ? action("Stop local follow-up", "coverage-cancel", r.id) : ""}</section>`).join("") || "<p>No checks approved.</p>"}<p class="small">Stopping follow-up preserves source work and observations already emitted.</p></details>`);
    const form = document.querySelector("#coverage-check-form");
    if (form) {
      const radioFields = document.querySelector("#coverage-radio-fields");
      form.elements.namedItem("method").onchange = async () => {
        radioFields.hidden = form.elements.namedItem("method").value !== "radio";
        if (radioFields.hidden) { radioFields.innerHTML = ""; return; }
        const [resources, vehicles] = await Promise.all([api("/api/records?kind=resource"), api("/api/records?kind=vehicle")]);
        radioFields.innerHTML = `<label>Owned crew<select name="staff" aria-label="Owned crew" required>${resources.filter(r => r.type === "staff" && r.owner === state.user.org).map(r => `<option value="${e(r.id)}">${e(r.label ?? r.id)}</option>`).join("")}</select></label><label>Owned vehicle<select name="vehicle" aria-label="Owned vehicle" required>${vehicles.filter(v => v.owner === state.user.org).map(v => `<option value="${e(v.id)}">${e(v.label ?? v.id)} · ${e(v.state)}</option>`).join("")}</select></label>`;
      };
      form.onsubmit = async event => {
        event.preventDefault(); const button = form.querySelector("button"); button.disabled = true;
        try {
          const f = new FormData(form), method = f.get("method");
          await api("/api/coverage/check", { policyVersion: d.policy.version, coverageVersion: d.version,
            checks: [{ building: f.get("building"), method, ...(method === "radio" ? { staff: f.get("staff"), vehicle: f.get("vehicle") } : {}) }] });
          toast("Contact check recorded. Confirmation must arrive from its source."); await open(); await render();
        } catch (error) { toast(error.message); button.disabled = false; }
      };
    }
    const policyForm = document.querySelector("#coverage-policy-form");
    if (policyForm) policyForm.onsubmit = async event => {
      event.preventDefault(); const button = policyForm.querySelector("button"); button.disabled = true;
      try {
        const f = new FormData(policyForm);
        await api("/api/coverage/policy", { version: d.policy?.version ?? 0, placeIds: f.getAll("place"),
          staleAfterMs: Number(f.get("stale")) * 60000, maxWaitMs: Number(f.get("wait")) * 60000,
          maxActive: Number(f.get("active")), maxPerBatch: 5, cooldownMs: 60000,
          allowedMethods: f.get("radio") ? ["clarification", "radio"] : ["clarification"], reason: f.get("reason") });
        toast("Contact scope approved. Select a place before requesting a check."); await open(); await render();
      } catch (error) { toast(error.message); button.disabled = false; }
    };
  }
  async function run(name, id) {
    if (name === "coverage-open") { await open(); return true; }
    if (name === "coverage-cancel") {
      const d = await api("/api/coverage"), r = d.requests.find(r => r.id === id);
      if (r) await api("/api/coverage/cancel", { id, version: r.version });
      toast("Follow-up stopped. Previously issued source work is preserved."); await open(); await render(); return true;
    }
    return false;
  }
  return { card, run };
}
