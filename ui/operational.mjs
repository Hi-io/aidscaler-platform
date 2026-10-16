import { entityLabel, resourceLabel, humanLabel } from "./labels.mjs";
export function createOperationalDraft({
  api,
  record,
  escape: e,
  state,
  modal,
  toast,
  render,
}) {
  async function open() {
    const [
      needs,
      resources,
      vehicles,
      facilities,
      roads,
      operations,
      map,
      queries,
    ] = await Promise.all(
      ["need", "resource", "vehicle", "facility", "road", "operation"]
        .map((k) => record(k))
        .concat([api("/api/map"), record("query")]),
    );
    const options = (rows, label) =>
      rows
        .map((r) => `<option value="${e(r.id)}">${e(label(r))}</option>`)
        .join("");
    const select = (name, label, rows, display = (r) => r.label || entityLabel(r.id)) =>
        `<label>${label}<select name="${name}" required>${options(rows, display)}</select></label>`,
      quantity =
        '<label>Quantity in native units<input name="quantity" type="number" min="1" step="1" required></label>',
      owned = (rows) => rows.filter((r) => r.owner === state.user.org);
    const types = {
      dispatch: {
        label: "Deliver observed inventory",
        fields: () =>
          select(
            "need",
            "Observed need",
            needs,
            (n) => humanLabel(n.type) + " · " + entityLabel(n.building ?? n.node),
          ) +
          select(
            "resource",
            "Owned inventory",
            owned(resources),
            (r) => resourceLabel(r),
          ) +
          select("vehicle", "Owned vehicle", owned(vehicles)) +
          quantity,
        refs: (d) => [d.need, d.resource, d.vehicle],
      },
      evacuate: {
        label: "Move people to an operating shelter",
        fields: () =>
          select(
            "from",
            "Pickup place",
            needs
              .filter((n) => n.type === "shelter")
              .map((n) => ({ id: n.building })),
          ) +
          select(
            "to",
            "Receiving shelter",
            facilities.filter((f) => f.state === "operating"),
          ) +
          select(
            "vehicle",
            "Owned passenger vehicle",
            owned(vehicles).filter((v) => v.seats > 0),
          ) +
          quantity,
        refs: (d) => [
          needs.find((n) => n.building === d.from)?.id,
          d.to,
          d.vehicle,
        ],
      },
      reroute: {
        label: "Send a new route instruction",
        fields: () =>
          select("vehicle", "Owned vehicle", owned(vehicles)) +
          select(
            "destination",
            "Observed road node",
            map.geography?.nodes ?? [],
          ),
        refs: (d) => [d.vehicle],
      },
      repair: {
        label: "Request a road repair",
        fields: () =>
          select("edge", "Observed road", roads) +
          `<label class="checkbox"><input name="engineering" type="checkbox" checked>Qualified engineering work requested</label><p class="note">The source checks finite crew, access and time. A model cannot certify engineering safety.</p>`,
        refs: (d) => [d.edge],
      },
      activate: {
        label: "Activate an assessed facility",
        fields: () =>
          select(
            "building",
            "Safety-assessed facility",
            facilities.filter((f) => f.safe === true),
          ) +
          `<label class="checkbox"><input name="permit" type="checkbox" required>I hold the responsible owner's permission. Physical dependencies must still be available.</label>`,
        refs: (d) => [d.building],
      },
      cancel: {
        label: "Cancel an owned operation",
        fields: () =>
          select(
            "id",
            "Owned operation",
            operations.filter(
              (o) =>
                o.org === state.user.org ||
                o.owner === state.user.org ||
                o.authorizedBy,
            ),
          ) +
          `<p class="note">Cancelling never rewinds travel, spent fuel or completed delivery. The instruction must reach the source.</p>`,
        refs: (d) => [d.id],
      },
      purchase: {
        label: "Order stock from a known supplier",
        fields: () =>
          `<label>Resource type<select name="type"><option>water</option><option>food</option><option>medicine</option><option>energy</option><option>sanitation</option></select></label>${quantity}<label>Supplier ID<input name="supplier" required></label><label>Accepted unit price in operational source units<input name="price" type="number" min="0" step="0.01" required></label><label>Accepted lead time in minutes<input name="leadMinutes" type="number" min="0" step="1" required></label><p class="note">Query operational finance and supplier records first. Test USD donations do not automatically fund a simulated order.</p>`,
        refs: () => [
          queries.find((q) => q.target === "finance" && q.state === "ready")
            ?.id,
        ],
      },
      transfer: {
        label: "Offer a resource transfer or loan",
        fields: () =>
          select("resource", "Owned inventory", owned(resources)) +
          quantity +
          `<label>Receiving partner organization ID<input name="to" required></label><label class="checkbox"><input name="loan" type="checkbox">Loan with return obligation</label>`,
        refs: (d) => [d.resource],
      },
    };
    modal(
      "Prepare an operational action",
      `<p class="sub">Prepare one explicit action for human review. The source remains authoritative for capacity, permission and physical progress.</p><form id="operationalform" class="fieldform"><label>Action<select name="actionType">${Object.entries(
        types,
      )
        .map(([k, v]) => `<option value="${k}">${e(v.label)}</option>`)
        .join(
          "",
        )}</select></label><div id="operation-fields"></div><label>Benefit and decision reason<textarea name="rationale" required maxlength="1200"></textarea></label><button class="primary">Prepare for human review</button></form>`,
    );
    const form = document.querySelector("#operationalform"),
      draw = () =>
        (form.querySelector("#operation-fields").innerHTML =
          types[form.elements.namedItem("actionType").value].fields());
    draw();
    form.elements.namedItem("actionType").onchange = draw;
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        const d = Object.fromEntries(new FormData(form)),
          type = d.actionType,
          params = { ...d };
        delete params.actionType;
        delete params.rationale;
        for (const k of ["quantity", "price"])
          if (k in params) params[k] = Number(params[k]);
        for (const k of ["permit", "engineering", "loan"])
          if (form.elements.namedItem(k))
            params[k] = form.elements.namedItem(k).checked;
        if (type === "purchase") {
          params.leadMs = Number(params.leadMinutes) * 60000;
          delete params.leadMinutes;
        }
        if (type === "transfer") params.action = "offer";
        const refs = types[type].refs(d).filter(Boolean);
        if (!refs.length)
          throw new Error(
            "Query and inspect the required evidence before preparing this action.",
          );
        await api("/api/propose", {
          title: types[type].label,
          summary: d.rationale,
          benefit: d.rationale.slice(0, 400),
          rationale: d.rationale,
          references: refs,
          conditions: [],
          actions: [{ owner: state.user.org, type, params, dependsOn: [] }],
        });
        document.querySelector("dialog")?.close();
        state.page = "review";
        location.hash = "review";
        toast("Action drafted. Human authorization is still required.");
        await render();
      } catch (err) {
        toast(err.message);
      } finally {
        button.disabled = false;
      }
    };
  }
  return { open };
}
