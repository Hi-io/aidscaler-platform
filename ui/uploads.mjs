export async function readAttachment(file, limit = 2_000_000) {
  if (!file?.size) return null;
  if (file.size > limit)
    throw new Error(`Choose a file under ${limit / 1_000_000} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 16384)
    binary += String.fromCharCode(...bytes.subarray(at, at + 16384));
  return { mime: file.type, contentBase64: btoa(binary) };
}

export function actionBrief(a) {
  const p = a.params;
  if (a.type === "dispatch")
    return `Deliver ${p.quantity} of ${p.resource} to ${p.need ?? p.building ?? p.destination} using ${p.vehicle}`;
  if (a.type === "evacuate")
    return `Move ${p.quantity} people from ${p.from} to ${p.to} using ${p.vehicle}`;
  if (a.type === "activate")
    return `Activate ${p.service ?? "service"} at ${p.building}`;
  if (a.type === "purchase")
    return `Purchase ${p.quantity} of ${p.type}; unit price ${p.price}, lead time ${p.leadMs} ms`;
  if (a.type === "reroute") return `Change the received route of ${p.vehicle}`;
  if (a.type === "repair") return `Repair access ${p.edge}`;
  if (a.type === "cancel") return `Cancel future work for ${p.id}`;
  return `${a.type} · ${Object.entries(p)
    .filter(([, v]) => ["string", "number"].includes(typeof v))
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ")}`;
}
