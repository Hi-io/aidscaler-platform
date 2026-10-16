/** The operational map combines only this actor's received directory and reports. */
export async function operationalMapData(store, org) {
  const [context, needs, vehicles, facilities] = await Promise.all([
    store.get(org, "context", "geography", false),
    store.list(org, "need", 1000),
    store.list(org, "vehicle", 1000),
    store.list(org, "facility", 1000),
  ]);
  const geography = context?.map ?? null;
  const ids = [...new Set((geography?.roads ?? []).map(road => road.id)
    .filter(id => typeof id === "string" && id.length > 0))];
  const roads = [];
  // Read the exact directory, including reports beyond a generic list limit.
  // Missing reports stay missing; public geometry alone never clears a road.
  for (let offset = 0; offset < ids.length; offset += 10000) {
    const page = ids.slice(offset, offset + 10000);
    const reports = await store.getMany(org, "road", page);
    for (const id of page) if (reports.has(id)) roads.push(reports.get(id));
  }
  return { geography, needs, vehicles, roads, facilities };
}
