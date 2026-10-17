import { check } from "./errors.mjs";

const validDigest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validPath = (path) =>
  Array.isArray(path) &&
  path.length > 0 &&
  path.length <= 8 &&
  path.every(
    (key) =>
      typeof key === "string" &&
      key.length > 0 &&
      !["__proto__", "constructor", "prototype"].includes(key),
  );

// References are a storage column, never a field or sentinel in received JSON.
// An arbitrary source document cannot impersonate a reference.
export function entityReferences(row) {
  const refs = row.data_refs ?? [];
  check(
    Array.isArray(refs) &&
      refs.every((ref) => validDigest(ref.digest) && validPath(ref.path)),
    "CONTEXT_STORAGE",
    "The received document has invalid storage references.",
    500,
  );
  return refs;
}

export async function persistFragments(store, org, chunks) {
  if (!chunks.size) return;
  const existing = new Set(
    (
      await store.query(
        "SELECT digest FROM entity_fragments WHERE org=$1 AND digest=ANY($2::text[])",
        [org, [...chunks.keys()]],
      )
    ).rows.map((row) => row.digest),
  );
  for (const [digest, json] of chunks)
    if (!existing.has(digest))
      await store.query(
        "INSERT INTO entity_fragments(org,digest,data) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING",
        [org, digest, json],
      );
}

export async function hydrateEntityRows(store, org, rows) {
  const references = rows.map(entityReferences),
    digests = [...new Set(references.flat().map((ref) => ref.digest))];
  if (!digests.length) return rows;
  const cache = store.fragmentCache,
    cached = digests.filter((digest) => cache.has(org + "/" + digest)),
    received = await store.query(
      `SELECT digest,
      CASE WHEN digest=ANY($3::text[]) THEN NULL ELSE data END AS data
      FROM entity_fragments WHERE org=$1 AND digest=ANY($2::text[])`,
      [org, digests, cached],
    );
  // The durable row is checked even on cache hits. Erasure, rollback and a
  // deleted fragment can never be hidden by a process-local cached document.
  check(
    received.rows.length === digests.length,
    "CONTEXT_STORAGE",
    "A received document fragment is unavailable.",
    500,
  );
  const documents = new Map();
  for (const row of received.rows) {
    const key = org + "/" + row.digest,
      json = cache.get(key) ?? JSON.stringify(row.data);
    documents.set(row.digest, json);
    if (!cache.has(key)) {
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(key, json);
    }
  }
  return rows.map((row, index) => {
    if (!references[index].length) return row;
    const data = { ...row.data };
    for (const ref of references[index]) {
      let target = data;
      for (const key of ref.path.slice(0, -1)) {
        check(
          target && typeof target === "object" && Object.hasOwn(target, key),
          "CONTEXT_STORAGE",
          "A received document reference has no parent.",
          500,
        );
        target[key] = Array.isArray(target[key])
          ? [...target[key]]
          : { ...target[key] };
        target = target[key];
      }
      target[ref.path.at(-1)] = JSON.parse(documents.get(ref.digest));
    }
    return { ...row, data };
  });
}
