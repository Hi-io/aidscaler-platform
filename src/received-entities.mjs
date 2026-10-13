// This is a received directory, never a lookup against physical simulator state.
// Aliases are useful only when unambiguous within the directory the actor owns.
export async function scopedReceivedEntities(store, org, sources, limit = 100) {
  const map = (await store.get(org, "context", "geography", false))?.map ?? {};
  const entries = [
    ...(map.places ?? []).map((p) => ({
      kind: "building",
      id: p.id,
      name: p.name,
      aliases: p.aliases ?? [],
    })),
    ...(map.roads ?? []).map((p) => ({
      kind: "road",
      id: p.id,
      name: p.name,
      aliases: p.aliases ?? [],
    })),
    ...(await store.list(org, "resource", 10000)).map((p) => ({
      kind: "resource",
      id: p.id,
      name: p.name,
      aliases: p.aliases ?? [],
    })),
    ...(await store.list(org, "vehicle", 10000)).map((p) => ({
      kind: "vehicle",
      id: p.id,
      name: p.name,
      aliases: p.aliases ?? [],
    })),
  ];
  const text = sources
    .map((s) => (s.text ?? "").slice(0, 2000))
    .join("\n")
    .toLowerCase();
  const tokens = new Set(
    (text.match(/[a-z0-9_.:-]+/g) ?? []).flatMap((t) => [
      t,
      t.replace(/[.:]+$/g, ""),
    ]),
  );
  const locations = new Set(sources.map((s) => s.location));
  const aliases = new Map();
  for (const e of entries)
    for (const a of [e.name, ...e.aliases].filter(
      (a) => typeof a === "string" && a.length >= 4,
    )) {
      const key = a.toLowerCase(),
        ids = aliases.get(key) ?? new Set();
      ids.add(e.kind + ":" + e.id);
      aliases.set(key, ids);
    }
  const matched = entries.filter(
    (e) =>
      tokens.has(e.id.toLowerCase()) ||
      (e.kind === "building" && locations.has(e.id)) ||
      [e.name, ...e.aliases].some(
        (a) =>
          typeof a === "string" &&
          a.length >= 4 &&
          aliases.get(a.toLowerCase())?.size === 1 &&
          text.includes(a.toLowerCase()),
      ),
  );
  const scoped = matched
    .slice(0, limit)
    .map((e) => ({
      ...e,
      aliases: e.aliases.filter(
        (a) => aliases.get(a.toLowerCase())?.size === 1,
      ),
    }));
  return { entities: scoped, omitted: entries.length - scoped.length };
}
