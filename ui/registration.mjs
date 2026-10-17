import { entityLabel } from "./labels.mjs";

const types = new Set([
  "water",
  "food",
  "energy",
  "sanitation",
  "medicine",
  "staff",
  "shelter",
  "blankets",
  "fuel",
  "rescue",
]);

/** Received geometry supplies valid identifiers; names are presentation only. */
export function receivedLocations(geography = {}) {
  const nodes = new Map(
    (geography?.nodes ?? []).map((node) => [node.id, node]),
  );
  const choices = new Map();
  for (const place of geography?.places ?? []) {
    if (!nodes.has(place.node)) continue;
    if (!choices.has(place.node))
      choices.set(place.node, {
        id: place.node,
        label: place.name || place.label || entityLabel(place.id),
      });
  }
  for (const node of nodes.values())
    if (!choices.has(node.id))
      choices.set(node.id, {
        id: node.id,
        label: node.name || node.label || entityLabel(node.id),
      });
  return [...choices.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "en", { numeric: true }),
  );
}

export function localResourceInput(data, locations = []) {
  const label = String(data.label ?? "").trim(),
    unit = String(data.unit ?? "").trim();
  const node = String(data.node ?? "").trim(),
    type = String(data.type ?? "");
  if (label.length < 2 || label.length > 120)
    throw new Error("Give the resource a name between 2 and 120 characters.");
  if (!types.has(type)) throw new Error("Choose a supported resource type.");
  if (!String(data.quantity ?? "").trim() || !String(data.floor ?? "").trim())
    throw new Error(
      "Enter a quantity and a protected reserve. Use zero when appropriate.",
    );
  const quantity = Number(data.quantity),
    floor = Number(data.floor);
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 0 ||
    !Number.isSafeInteger(floor) ||
    floor < 0 ||
    floor > quantity
  )
    throw new Error(
      "Quantity and protected reserve must be whole, nonnegative numbers. The reserve cannot exceed the quantity.",
    );
  if (!unit || unit.length > 60)
    throw new Error(
      "Enter a unit, such as litres, kits or people, up to 60 characters.",
    );
  if (node && !locations.some((location) => location.id === node))
    throw new Error(
      "Choose a location from the received map, or leave it unconfirmed.",
    );
  return { label, type, quantity, floor, unit, ...(node ? { node } : {}) };
}

export function localResourceForm(locations, { escape: e }) {
  return `<p class="sub">A workspace inventory record. Physical stock and dispatch permissions stay with the connected source.</p><form id="resourceform" class="fieldform"><label>Resource name<input name="label" required minlength="2" maxlength="120" placeholder="e.g. Emergency drinking-water reserve"></label><label>Resource type<select name="type">${[...types].map((type) => `<option value="${type}">${type === "medicine" ? "Medical supplies" : type[0].toUpperCase() + type.slice(1)}</option>`).join("")}</select></label><div class="detailgrid"><label>Quantity<input name="quantity" type="number" min="0" step="1" required></label><label>Protected reserve<input name="floor" type="number" min="0" step="1" value="0" required></label></div><label>Unit<input name="unit" required maxlength="60" placeholder="e.g. litres, kits or people"></label><label>Location<select name="node"><option value="">Location not confirmed</option>${locations.map((location) => `<option value="${e(location.id)}">${e(location.label)}</option>`).join("")}</select></label>${locations.length ? "" : '<p class="small">No map has been received yet. Request maps in Sources & access to choose a known place.</p>'}<button class="primary" type="submit">Save local resource</button></form>`;
}

export function registrationGuide({ icon, action, role }) {
  const mayRecord = ["admin", "commander", "dispatcher"].includes(role);
  const mayObserve = ["commander", "dispatcher", "analyst", "field"].includes(
    role,
  );
  const mayQuery = ["admin", "commander", "dispatcher", "analyst"].includes(
    role,
  );
  return `<p class="sub">Start with the type of record. AidScaler keeps an operator's entry separate from a source-confirmed physical asset.</p><div class="listrow"><div class="rowicon">${icon("package")}</div><div class="grow"><h3>Inventory you record</h3><p>Save a named local resource and its received-map location. This does not add stock to a connected warehouse.</p></div>${mayRecord ? action("Record inventory", "addresource", "", "primary") : ""}</div><div class="listrow"><div class="rowicon">${icon("map-pin")}</div><div class="grow"><h3>A new place, vehicle or situation</h3><p>Send a field observation for checking. Include the name, location and what you know. It remains an observation until verified.</p></div>${mayObserve ? action("Add an observation", "navigate", "field") : ""}</div><div class="listrow"><div class="rowicon">${icon("plug")}</div><div class="grow"><h3>Vehicles, facilities and source inventory</h3><p>Register or update physical assets in the connected operational system. Then request their latest records here.</p><div class="actions">${mayQuery ? action("Get vehicles", "lookup", "vehicles") + action("Get inventory", "lookup", "inventory") + action("Get map & places", "lookup", "map") : ""}</div></div></div><details class="collapse"><summary>Connect a different system</summary><p class="small">An administrator can register a permitted JSON or MCP read connector. Read results enter as evidence; operational actions still use the source that owns the asset.</p>${role === "admin" ? action("External connections", "navigate", "connections") : `<p class="small">Ask your administrator to configure the source.</p>`}</details>`;
}
