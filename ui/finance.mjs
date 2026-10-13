const dollars = c => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(c) / 100);

// Only the deliberately approved aggregate enters the public page. No source
// purchase IDs, suppliers, locations or automatically refreshed receipts do.
export function publicProcurement(review, e, time) {
  if (!review) return "";
  const s = review.snapshot;
  return `<section class="card" style="margin-top:28px"><span class="eyebrow">HUMAN-REVIEWED PROCUREMENT · SANDBOX</span><h2>What support has made possible</h2><p class="sub">${dollars(s.spentCents)} recorded against approved organizational budgets.</p>${(s.procurement ?? []).map(p => `<div class="cardheader"><span>${e(p.type)} · ${e(p.unit)}</span><strong>${e(p.receivedQuantity)} / ${e(p.orderedQuantity)} received by the organization</strong></div><p class="note">${e(p.pendingQuantity)} pending${p.receiptUnknownOrders ? ` · ${e(p.receiptUnknownOrders)} order(s) awaiting a quantity receipt` : ""}</p>`).join("") || `<p class="sub">No reconciled purchase receipts were included in this review.</p>`}<p class="note">Reviewed ${time(review.approvedAt)}. Stock receipt is not delivery to people. Later receipts need a new human review. Test funds only.</p></section>`;
}

export function createFinanceControls({ api, escape: e, state, table, toast, render }) {
  async function view() {
    const editable = ["finance", "commander"].includes(state.user?.role);
    if (!editable && state.user?.role !== "auditor") return "";
    const [ledger, allAllocations, source] = await Promise.all([
      api("/api/finance/ledger"), api("/api/finance/allocations"), api("/api/finance/purchases"),
    ]), review = await api("/api/finance/review-snapshot"), allocations = allAllocations.filter(a => Number(a.remaining) > 0),
      options = allocations.map(a => `<option value="${e(a.id)}">${e(a.reference)} · ${dollars(a.remaining)} unspent</option>`).join("");
    const purchases = source.records.map(r => {
      const p = r.purchase, received = Number.isSafeInteger(p.receivedQuantity) ? `${p.receivedQuantity} / ${p.quantity} ${p.unit ?? "unit"}` : "Receipt quantity not yet confirmed",
        rec = r.reconciliation,
        stateText = rec ? (rec.financialReviewRequired ? "Accounting change needs review" : `Spent · ${dollars(rec.conversion.amountCents)}`) : "Not reconciled";
      return `<details class="collapse"><summary>${e(p.type)} · ${e(stateText)} · ${e(received)}</summary><p class="sub">Financial: ${e(p.cost)} sandbox credits spent by the source. Physical: ${e(p.state)}; ${e(received)} received by your organization. This does not certify delivery to people.</p>${rec ? `<p class="note">Approved conversion: ${e(rec.conversion.sourceAmount)} sandbox credits → ${dollars(rec.conversion.amountCents)}. ${e(rec.reason)}</p>` : editable && allocations.length ? `<form class="fieldform reconcileform" data-purchase="${e(r.id)}" data-version="${e(r.sourceVersion)}" data-cost="${e(p.cost)}"><label>Approved budget<select name="allocationId">${options}</select></label><label>USD test funds to record as spent<input name="amount" type="number" min="0.01" step="0.01" required></label><p class="note">You explicitly approve the accounting equivalence for ${e(p.cost)} sandbox credits. No exchange rate is assumed and no source credit is created.</p><label>Why this conversion and purchase are approved<textarea name="reason" required maxlength="1200"></textarea></label><button class="primary">Review and record spend</button></form>` : `<p class="note">An unspent approved budget and a financial reviewer are required to reconcile this purchase.</p>`}</details>`;
    }).join("");
    return `<section class="card" style="margin-bottom:22px"><h2>Manage settled support</h2><p class="sub">Approved budgets, source spending and physical receipts are separate. USD test funds and sandbox credits never share an automatic exchange rate.</p>${editable ? `<details class="collapse"><summary>Allocate funds</summary><form id="allocateform" class="fieldform"><label>Amount in USD<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Organizational purpose<textarea name="reason" required maxlength="1200"></textarea></label><button class="primary">Record allocation</button></form></details>${allocations.length ? `<details class="collapse"><summary>Release an unused budget</summary><form id="releaseform" class="fieldform"><label>Allocation<select name="allocationId">${options}</select></label><label>Amount to release in USD<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Reason<textarea name="reason" required maxlength="1200"></textarea></label><button class="primary">Record release</button></form></details>` : ""}` : ""}<details class="collapse"><summary>Source purchases and receipts (${source.records.length})</summary><button id="finance-source-refresh" class="secondary">Request current source receipts</button><p class="note">${source.pendingQueries.length ? `${source.pendingQueries.length} query request(s) pending. Reopen this view after the source replies.` : "The latest delivered source query is shown. A request acknowledgment is not a receipt."}</p>${purchases || `<p class="sub">No source-confirmed purchases are available yet.</p>`}</details>${editable ? `<details class="collapse"><summary>Review the public aggregate</summary><p class="sub">${dollars(review.snapshot.spentCents)} recorded as spent. ${review.snapshot.mappedPurchaseCount} reconciled purchase(s); ${review.snapshot.pendingReviewCount} purchase(s) excluded until financial review.</p>${review.snapshot.procurement.map(p => `<p>${e(p.type)}: ${e(p.receivedQuantity)} / ${e(p.orderedQuantity)} ${e(p.unit)} received by the organization; ${e(p.pendingQuantity)} pending.</p>`).join("")}<form id="financepublishform" class="fieldform" data-version="${e(review.reviewVersion)}"><label>Public review reason<textarea name="reason" required maxlength="1200"></textarea></label><p class="note">Only this aggregate is published. Suppliers, purchase IDs and private locations stay internal. Payment is not delivery.</p><button class="primary">Approve public aggregate</button></form></details>` : ""}<details class="collapse"><summary>Append-only financial history</summary>${table(["Type", "Amount", "Reference"], ledger.map(r => `<tr><td>${e(r.type)}</td><td>${dollars(r.amount_cents)}</td><td>${e(r.reference)}</td></tr>`))}</details></section>`;
  }
  function bind(root) {
    function submit(form, action, convert, message) {
      form?.addEventListener("submit", async ev => {
        ev.preventDefault();
        const button = form.querySelector("button"); button.disabled = true;
        try {
          await api("/api/finance/" + action, convert(Object.fromEntries(new FormData(form)), form));
          toast(message); await render();
        } catch (err) { toast(err.message); }
        finally { button.disabled = false; }
      });
    }
    for (const [id, url] of [["allocateform", "allocate"], ["releaseform", "release"]])
      submit(root.querySelector("#" + id), url, d => {
        d.amountCents = Math.round(Number(d.amount) * 100); delete d.amount; return d;
      }, "Budget change recorded with an audit record.");
    for (const form of root.querySelectorAll(".reconcileform"))
      submit(form, "reconcile", (d, f) => ({ allocationId: d.allocationId, purchaseId: f.dataset.purchase,
        sourceVersion: Number(f.dataset.version), reason: d.reason,
        conversion: { sourceUnit: "sandbox_credit", sourceAmount: Number(f.dataset.cost), currency: "USD", amountCents: Math.round(Number(d.amount) * 100) } }),
      "Source spend reconciled. Physical receipts remain a separate state.");
    submit(root.querySelector("#financepublishform"), "publish-summary", (d,f) => ({ reviewVersion: f.dataset.version, reason: d.reason }), "Reviewed aggregate published.");
    root.querySelector("#finance-source-refresh")?.addEventListener("click", async ev => {
      ev.target.disabled = true;
      try { await api("/api/finance/source-refresh", {}); toast("Source query requested. Await its receipt before reviewing."); await render(); }
      catch (err) { toast(err.message); } finally { ev.target.disabled = false; }
    });
  }
  return { view, bind };
}
