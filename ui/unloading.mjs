export function createUnloadingControls({ api, escape: e, state, toast, render }) {
  let visibleCount = 12;
  const open = new Set(), plans = new Map();
  const material = r => JSON.stringify([r.sourceRunId, r.sourceVersion, r.sourceOperationVersion,
    r.targetVersion, r.state, r.received, r.deliveryQuantity, r.staffQuantity, r.requiredSkills, r.workMs]);
  const planMarkup = (operation, plan) => `<p class="sub">${e(plan.note)}</p>${plan.readyToDraft ? `<button class="primary unloading-prepare" data-operation="${e(operation)}">Prepare ${plan.stage === "transport_crew" ? "crew trip" : plan.stage === "recover_crew_vehicle" ? "cargo recovery" : "unloading work"} for owner review</button>` : `<p class="note">${e(plan.missing?.map(m => m.type.replaceAll("_", " ")).join(" · ") || "Current work pending")}</p>`}`;
  async function view() {
    const rows = await api("/api/unloading"), all = rows.filter(r => r.receiverOrg === state.user?.org && r.state !== "cancelled")
      .sort((a, b) => Number(a.state === "completed") - Number(b.state === "completed")),
      own = all.slice(0, visibleCount), pendingCount = all.filter(r => r.state !== "completed").length;
    const editable = ["analyst", "commander", "dispatcher"].includes(state.user?.role);
    for (const [operation, cached] of plans) {
      const r = all.find(r => r.operation === operation);
      if (!r || cached.material !== material(r)) plans.delete(operation);
    }
    return own.length ? `<section class="card unloading-panel"><span class="eyebrow">${pendingCount ? "ARRIVED · NOT YET RECEIVED" : "RECEIVED · SOURCE CONFIRMED"}</span><h2>${pendingCount ? "Finish the delivery" : "Delivery receipts"}</h2><p class="sub">${pendingCount} pending · ${all.length} received requests. Arrival is not a receipt.</p>${own.map(r => `<details class="collapse" data-unloading="${e(r.operation)}" ${open.has(r.operation) ? "open" : ""}><summary>${e(r.building)} · ${e(r.received)} / ${e(r.deliveryQuantity)} received · ${e(r.state.replaceAll("_", " "))}</summary><p class="note">${e(r.staffQuantity)} qualified crew · ${e(r.requiredSkills.join(", ") || "general handling")} · ${e(Math.ceil(r.workMs / 60000))} minutes of work. The original cargo stays with delivery ${e(r.operation)}.</p>${editable && ["waiting_for_crew", "inconclusive"].includes(r.state) ? `<button class="secondary unloading-plan" data-operation="${e(r.operation)}">Check receiver crew</button><div class="unloading-result" data-operation="${e(r.operation)}" aria-live="polite">${plans.has(r.operation) ? planMarkup(r.operation, plans.get(r.operation).plan) : ""}</div>` : `<p class="note">${r.state === "completed" ? "The operational source confirms reception after the crew's finite work." : "Await the current owner's review or physical work receipt."}</p>`}</details>`).join("")}${own.length < all.length ? `<p class="note">Showing ${own.length} of ${all.length}; pending requests appear first.</p><button class="secondary unloading-more">Show 12 more requests</button>` : ""}${rows.length >= 100 ? `<p class="note">This panel includes up to 100 received requests. Use the operations table below to inspect delivery history.</p>` : ""}</section>` : "";
  }
  function bindPrepare(root) {
    for (const button of root.querySelectorAll(".unloading-prepare")) {
      if (button.dataset.bound) continue; button.dataset.bound = "true";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const operation = button.dataset.operation, cached = plans.get(operation);
          if (!cached) throw Error("Check the current receiver crew before preparation.");
          await api("/api/unloading/prepare", { operation, checkpoint: cached.plan.checkpoint });
          plans.delete(operation); toast("Prepared for owner review. No physical receipt has been assumed."); await render();
        } catch (error) { toast(error.message); } finally { button.disabled = false; }
      });
    }
  }
  function bind(root) {
    for (const detail of root.querySelectorAll("[data-unloading]")) detail.addEventListener("toggle", () => {
      if (detail.open) open.add(detail.dataset.unloading); else open.delete(detail.dataset.unloading);
    });
    root.querySelector(".unloading-more")?.addEventListener("click", async () => { visibleCount += 12; await render(); });
    for (const button of root.querySelectorAll(".unloading-plan")) button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const operation = button.dataset.operation, plan = await api("/api/unloading/plan", { operation }),
          rows = await api("/api/unloading"), row = rows.find(r => r.operation === operation),
          target = [...root.querySelectorAll(".unloading-result")].find(x => x.dataset.operation === operation);
        if (!row || !target?.isConnected) { await render(); return; }
        plans.set(operation, { plan, material: material(row) });
        target.innerHTML = planMarkup(operation, plan); bindPrepare(root);
      } catch (error) { toast(error.message); } finally { button.disabled = false; }
    });
    bindPrepare(root);
  }
  return { view, bind };
}

