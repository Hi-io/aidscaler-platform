/** Decision options and explicit source erasure use progressive disclosure. */
export function createResponseControls({ api, escape: e, action, state, modal, toast }) {
  async function run(name, id) {
    if (name === "interpret-page") {
      const ids = state.signalRows.filter((s) => s.state !== "erased").slice(0, 35).map((s) => s.id);
      if (!ids.length) { toast("No received sources are available."); return true; }
      await api("/api/interpret-sources", { ids });
      location.hash = "investigations"; state.page = "investigations";
      toast("Received-source batch queued. Interpretations remain unverified.");
      return true;
    }
    if (name === "semantic-receipt") {
      const d = await api("/api/records?kind=semantic_receipt&id=" + encodeURIComponent(id));
      modal("Sourced interpretations", `<h2>${d.observations.length} interpretations</h2><p class="sub">${d.coverage.presentedSources} sources presented to ${e(d.model)}. Every observation remains an inference for review.</p>${d.coverage.rejectedObservations?.length ? `<p class="note">${d.coverage.rejectedObservations.length} observations failed validation and were not accepted. Their original sources remain available for manual review.</p>` : ""}${d.coverage.truncatedSources?.length ? `<p class="note">${d.coverage.truncatedSources.length} long sources were excerpted; unshown content was not interpreted.</p>` : ""}${d.observations.slice(0, 12).map((o) => `<section class="decision"><span class="eyebrow">${e(o.kind)} · ${e(o.timeStatus ?? "unknown time")}</span><p>${e(o.text)}</p><details class="collapse"><summary>Original references</summary><p class="small">${o.sourceIds.map(e).join(" · ")}</p></details></section>`).join("")}<p class="note">${e(d.note)}</p>`);
      return true;
    }
    if (name === "response-options") {
      const d = await api("/api/response-options?needId=" + encodeURIComponent(id)), n = d.focusNeed;
      modal("Compare useful responses", `${n ? `<span class="eyebrow">CURRENT FOCUS · ${e(d.policy.order.replaceAll("_", " "))}</span><h2>${e(n.type)} · ${n.outstanding} ${e(n.unit)} outstanding</h2>` : "<h2>No uncovered received need</h2>"}<p class="note">${d.policy.approved ? "Coordinator-approved priorities" : "Priorities have not yet been approved"}. Options use received observations; they do not reserve or dispatch.</p><section class="decision"><h3>Available delivery</h3><p>${d.immediateSupply.quantities.length ? d.immediateSupply.quantities.map((a) => `${a.quantity} ${e(n?.unit ?? "native units")} · ${e(a.owner)}`).join("<br>") : "No currently executable stock and vehicle combination."}</p><p class="small">${d.immediateSupply.finiteVehicles} finite vehicles used.</p></section>${d.serviceAlternatives.length ? `<details class="collapse"><summary>${d.serviceAlternatives.length} candidate service sites</summary>${d.serviceAlternatives.map((s) => `<div class="listrow"><div class="grow"><h3>${e(s.building)}</h3><p>${s.readyToDraft ? `${s.seats} proposed places · ${s.owners.length} responsible owners` : e(s.missing?.map((m) => m.type + " pending").join(" · ") || "Current inspection required")}</p></div></div>`).join("")}</details>` : ""}<details class="collapse"><summary>Other communities affected by these choices</summary>${d.otherNeeds.map((o) => `<p class="small"><strong>${e(o.type)} · ${o.outstanding} ${e(o.unit)}</strong><br>${e(o.id)}${o.pendingProposals.length ? " · review already pending" : " · response still needed"}</p>`).join("")}<p class="note">A vehicle committed here cannot simultaneously serve another community. Units are never combined into an invented score.</p></details>`, `${n ? action("Investigate this need", "investigatecase", n.id, "primary") : ""}${action("Close", "close")}`);
      return true;
    }
    if (name === "erase-source" || name === "erase-media") {
      if (!["admin", "commander"].includes(state.user.role)) return false;
      const kind = name === "erase-media" ? "media" : "signal",
        plan = await api("/api/retention-preview?" + new URLSearchParams({ kind, id }));
      modal("Review source erasure", `<h2>${plan.records.length} linked records</h2><p class="sub">Remove the original and its derived local text. Physical commands and decision owners remain.</p><p class="note">${e(plan.processingEffect)}</p><details class="collapse"><summary>Scope and external obligations</summary><p class="small">${plan.files.length} original or derived files.<br>${plan.limitations.map(e).join("<br>")}</p><ul>${plan.records.slice(0, 20).map((r) => `<li>${e(r.kind)} · ${e(r.id)}</li>`).join("")}</ul></details><form id="source-erasure" class="fieldform"><label>Privacy or source-policy basis<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><label class="checkbox"><input name="confirmed" type="checkbox" required>I reviewed the scope and separate external obligations.</label><button class="primary">Erase reviewed local source</button></form>`);
      const form = document.querySelector("#source-erasure");
      form.onsubmit = async (ev) => {
        ev.preventDefault(); const button = form.querySelector("button"); button.disabled = true;
        try {
          const receipt = await api("/api/retention-erase", { kind, id, version: plan.version, planHash: plan.planHash, reason: new FormData(form).get("reason") });
          modal("Erasure recorded", `<h2>Source content removed</h2><p class="sub">File cleanup is durably queued. Automatic investigation is paused until an authorized operator reviews and resumes it.</p><p class="note">Receipt ${e(receipt.id)} · ${e(receipt.state.replaceAll("_", " "))}. Provider copies and prior backups require their own deletion procedure.</p>`);
        } catch (err) { toast(err.message); button.disabled = false; }
      };
      return true;
    }
    return false;
  }
  return { run };
}
