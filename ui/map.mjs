import { entityLabel, humanLabel, setDisplayContext } from "./labels.mjs";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function operationalMap(data) {
  const geo = data.geography;
  setDisplayContext({ geography: geo });
  if (!geo?.nodes?.length)
    return '<div class="empty">No map has arrived from an authorized source. Query maps, then sync after the source response arrives. Unknown geography is not a cleared route.</div>';
  const nodes = new Map(geo.nodes.map((n) => [n.id, n])),
    places = new Map(geo.places?.map((b) => [b.id, b]) ?? []),
    roads = new Map(data.roads.map((r) => [r.id, r]));
  const maxX = Math.max(...geo.nodes.map((n) => n.x), 1),
    maxZ = Math.max(...geo.nodes.map((n) => n.z), 1),
    point = (n) =>
      n ? { x: 40 + (n.x / maxX) * 840, y: 30 + (n.z / maxZ) * 420 } : null;
  const lines = geo.roads
    .map((e) => {
      const a = point(nodes.get(e.from)),
        b = point(nodes.get(e.to));
      if (!a || !b) return "";
      const s = roads.get(e.id);
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="maproad ${s?.open === false ? "closed" : s?.open === true ? "known" : ""}"><title>${esc(e.id)} · ${s?.open === false ? "Reported closed" : s?.open === true ? "Reported open" : "No current condition report"}</title></line>`;
    })
    .join("");
  const buildings = [...places.values()]
    .map((b) => {
      const p = point(nodes.get(b.node));
      return p
        ? `<rect x="${p.x - 3}" y="${p.y - 3}" width="6" height="6" rx="1" class="mapbuilding"/>`
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
  return `<div class="operationalmap"><div class="maplegend"><span><i class="mapdot need"></i>Observed unmet need</span><span><i class="mapdot vehicle"></i>Last vehicle report</span><span><i class="mapdot road"></i>Reported closed road</span></div><svg id="responsemap" viewBox="0 0 920 480" role="img" aria-label="Map of received needs, vehicle observations and road reports"><rect width="920" height="480" fill="#f5f5fc"/>${lines}${buildings}${vehicles}${needs}</svg><div class="mapfooter"><span>Geography is public. Operating conditions are received observations. Unreported areas remain uncertain.</span><div><button data-map="in" aria-label="Zoom in">+</button><button data-map="out" aria-label="Zoom out">−</button><button data-map="reset">Reset view</button></div></div></div>`;
}
export function bindMap() {
  const svg = document.querySelector("#responsemap");
  if (!svg) return;
  let box = [0, 0, 920, 480],
    drag;
  const draw = () => svg.setAttribute("viewBox", box.join(" "));
  for (const button of document.querySelectorAll("[data-map]"))
    button.onclick = () => {
      const op = button.dataset.map;
      if (op === "reset") box = [0, 0, 920, 480];
      else {
        const f = op === "in" ? 0.8 : 1.25;
        box = [
          box[0] + (box[2] * (1 - f)) / 2,
          box[1] + (box[3] * (1 - f)) / 2,
          Math.max(50, Math.min(3680, box[2] * f)),
          Math.max(26, Math.min(1920, box[3] * f)),
        ];
      }
      draw();
    };
  svg.onpointerdown = (e) => {
    if (e.target.closest("[data-action]")) return;
    drag = { x: e.clientX, y: e.clientY, box: [...box] };
    svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove = (e) => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    box = [
      drag.box[0] - ((e.clientX - drag.x) / r.width) * drag.box[2],
      drag.box[1] - ((e.clientY - drag.y) / r.height) * drag.box[3],
      drag.box[2],
      drag.box[3],
    ];
    draw();
  };
  svg.onpointerup = () => (drag = null);
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
