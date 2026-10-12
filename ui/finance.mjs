export function createFinanceControls({
  api,
  escape: e,
  state,
  table,
  toast,
  render,
}) {
  async function view() {
    if (!["finance", "commander"].includes(state.user?.role)) return "";
    const ledger = await api("/api/finance/ledger"),
      fmt = (c) =>
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(Number(c) / 100),
      allocations = ledger
        .filter((r) => r.type === "allocated")
        .map((r) => ({
          ...r,
          remaining:
            Number(r.amount_cents) -
            ledger
              .filter((v) => v.type === "released" && v.reference === r.id)
              .reduce((s, v) => s + Number(v.amount_cents), 0),
        }))
        .filter((r) => r.remaining > 0);
    return `<section class="card" style="margin-bottom:22px"><h2>Manage settled support</h2><p class="sub">Allocate an organizational budget, or release an unused allocation. USD test funds are separate from the simulator's operational funds.</p><details class="collapse"><summary>Allocate funds</summary><form id="allocateform" class="fieldform"><label>Amount in USD<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Organizational purpose<textarea name="reason" required maxlength="1200"></textarea></label><button class="primary">Record allocation</button></form></details>${allocations.length ? `<details class="collapse"><summary>Release an unused allocation</summary><form id="releaseform" class="fieldform"><label>Allocation<select name="allocationId">${allocations.map((r) => `<option value="${e(r.id)}">${e(r.reference)} · ${fmt(r.remaining)} remaining</option>`).join("")}</select></label><label>Amount to release in USD<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Reason<textarea name="reason" required></textarea></label><button class="primary">Record release</button></form></details>` : ""}<details class="collapse"><summary>Append-only financial history</summary>${table(
      ["Type", "Amount", "Reference"],
      ledger.map(
        (r) =>
          `<tr><td>${e(r.type)}</td><td>${fmt(r.amount_cents)}</td><td>${e(r.reference)}</td></tr>`,
      ),
    )}</details></section>`;
  }
  function bind(root) {
    for (const [id, url] of [
      ["allocateform", "allocate"],
      ["releaseform", "release"],
    ])
      root.querySelector("#" + id)?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const form = ev.target,
          button = form.querySelector("button");
        button.disabled = true;
        try {
          const d = Object.fromEntries(new FormData(form));
          d.amountCents = Math.round(Number(d.amount) * 100);
          delete d.amount;
          await api("/api/finance/" + url, d);
          toast(
            "Funds " +
              (url === "release" ? "released" : "allocated") +
              " with an audit record.",
          );
          await render();
        } catch (err) {
          toast(err.message);
        } finally {
          button.disabled = false;
        }
      });
  }
  return { view, bind };
}
