import { entityLabel, humanLabel, setDisplayContext } from "./labels.mjs";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const finitePoint = (node) => node && Number.isFinite(node.x) && Number.isFinite(node.z);
function projectGeography(geo) {
  const extent = geo.extentM ?? geo.geography?.extentM;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const node of geo.nodes) {
    if (!finitePoint(node)) continue;
    minX = Math.min(minX, node.x); minZ = Math.min(minZ, node.z);
    maxX = Math.max(maxX, node.x); maxZ = Math.max(maxZ, node.z);
  }
  if (!Number.isFinite(minX)) return { width: 920, height: 920, point: () => null };
  if (Number.isFinite(extent) && extent > 0) {
    minX = Math.min(0, minX); minZ = Math.min(0, minZ);
    maxX = Math.max(extent, maxX); maxZ = Math.max(extent, maxZ);
  }
  // Both axes use the same scale: geographic distances keep their proportions.
  const width = Math.max(1, maxX - minX), height = Math.max(1, maxZ - minZ);
  const canvasWidth = 920, padding = 20;
  const scale = (canvasWidth - padding * 2) / width;
  const canvasHeight = height * scale + padding * 2;
  return { width: canvasWidth, height: canvasHeight,
    point: (node) => finitePoint(node)
      ? { x: padding + (node.x - minX) * scale, y: padding + (node.z - minZ) * scale }
      : null };
}
export function operationalMap(data) {
  const geo = data.geography;
  setDisplayContext({ geography: geo });
  if (!geo?.nodes?.length)
    return '<div class="empty">No map has arrived from an authorized source. Query maps, then sync after the source response arrives. Unknown geography is not a cleared route.</div>';
  const nodes = new Map(geo.nodes.map((n) => [n.id, n])),
    places = new Map(geo.places?.map((b) => [b.id, b]) ?? []),
    roads = new Map(data.roads.map((r) => [r.id, r]));
  const projection = projectGeography(geo), point = projection.point;
  const source = geo.geography ?? {}, mapName = source.name || "Received source map";
  const extent = geo.extentM ?? source.extentM;
  const description = ["Received geography",
    Number.isFinite(extent) && extent > 0 ? `${extent / 1000} × ${extent / 1000} km` : null,
    source.projection?.northUp === true ? "North up" : null].filter(Boolean).join(" · ");
  const lines = geo.roads
    .map((e) => {
      const a = point(nodes.get(e.from)),
        b = point(nodes.get(e.to));
      if (!a || !b) return "";
      const s = roads.get(e.id);
      const points = e.points?.length > 1 ? e.points.map(point).filter(Boolean) : [a, b];
      return `<polyline points="${points.map(p => `${p.x},${p.y}`).join(" ")}" fill="none" class="maproad ${s?.open === false ? "closed" : s?.open === true ? "known" : ""}"><title>${esc(e.name || e.id)} · ${s?.open === false ? "Reported closed" : s?.open === true ? "Reported open" : "No current condition report"}</title></polyline>`;
    })
    .join("");
  const placeSize = places.size > 1000 ? 1.8 : 6;
  const buildings = [...places.values()]
    .map((b) => {
      const p = point(nodes.get(b.node));
      return p
        ? `<rect x="${p.x - placeSize / 2}" y="${p.y - placeSize / 2}" width="${placeSize}" height="${placeSize}" rx="0.7" class="mapbuilding"/>`
        : "";
    })
    .join("");
  const visibleNeedCount = data.needs.filter(n => n.quantity > (n.served ?? 0)).length;
  const needs = data.needs
    .filter((n) => n.quantity > (n.served ?? 0))
    .map((n) => {
      const p = point(nodes.get(n.node ?? places.get(n.building)?.node));
      return p
        ? `<g class="mapneed" tabindex="0" role="button" aria-label="${esc(humanLabel(n.type))} need at ${esc(entityLabel(n.building))}" data-action="need" data-id="${esc(n.id)}"><rect x="${visibleNeedCount <= 6 && p.x > 700 ? p.x - 180 : p.x - 18}" y="${p.y - 30}" width="${visibleNeedCount <= 6 ? 198 : 36}" height="50" fill="transparent" pointer-events="all"/><circle cx="${p.x}" cy="${p.y}" r="16" class="maphalo"/><circle cx="${p.x}" cy="${p.y}" r="7"/>${visibleNeedCount <= 6 ? `<text x="${p.x > 700 ? p.x - 22 : p.x + 22}" y="${p.y - 12}" text-anchor="${p.x > 700 ? "end" : "start"}" class="map-place-label">${esc(entityLabel(n.building))}</text>` : ""}<title>${esc(n.type)} · ${esc(n.quantity - (n.served ?? 0))} ${esc(n.unit)} pending · ${esc(entityLabel(n.building))}</title></g>`
        : "";
    })
    .join("");
  const vehicles = data.vehicles
    .filter((v) => v.owner)
    .map((v) => {
      const p = point(nodes.get(v.node));
      return p
        ? `<g class="mapvehicle"><rect x="${p.x - 5}" y="${p.y - 4}" rx="2" width="10" height="8"/><title>${esc(entityLabel(v.id))} · ${esc(v.state)} · observed at ${esc(v.at)} simulated ms. This is not a live GPS guarantee.</title></g>`
        : "";
    })
    .join("");
  return `<div class="operationalmap"><div class="mapidentity"><div><strong>${esc(mapName)}</strong><span>${esc(description)}</span></div>${source.attribution ? `<span class="mapcredit">${esc(source.attribution)}</span>` : ""}</div><div class="maplegend"><span><i class="mapdot need"></i>Observed unmet need</span><span><i class="mapdot vehicle"></i>Last vehicle report</span><span><i class="mapdot road"></i>Reported closed road</span></div><svg id="responsemap" width="${projection.width}" height="${projection.height}" viewBox="0 0 ${projection.width} ${projection.height}" role="img" aria-label="${esc(mapName)}: received needs, vehicle observations and road reports"><rect width="100%" height="100%" fill="#f5f5fc"/>${lines}${buildings}${vehicles}${needs}</svg><div class="mapfooter"><span>Geography is public. Operating conditions are received observations. Unreported areas remain uncertain.</span></div></div>`;
}
export function bindMap() {
  const svg = document.querySelector("#responsemap");
  if (!svg) return;
  svg.querySelectorAll("[role=button]").forEach(
    (g) =>
      (g.onkeydown = (e) => {
        if (["Enter", " "].includes(e.key)) {
          e.preventDefault();
          g.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      }),
  );
}
