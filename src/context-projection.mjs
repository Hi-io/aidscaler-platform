import { check } from "./errors.mjs";

const schema = "received-context-v1";
const operationalFields = ["now", "runId", "inspections", "operations"];
const knownFields = ["buildings", "sectorContacts", "buildingContacts"];
const definitions = {
  operational: { source: "operational", projection: "operational_projection" },
  geography: { source: "geography", projection: "geography_projection" },
};
const pick = (object, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(object, key))
      .map((key) => [key, object[key]]),
  );

// The source entity's normal version column fences this derived read model.
// CASE does not touch the large source JSONB when the derived row is current.
// Direct writes, older databases and rolled-back transactions fall back to
// the exact authoritative row; no process-local cache can hide a correction.
function readSource(kind, projected = true) {
  const { source, projection } = definitions[kind];
  return projected
    ? `WITH received_context AS (
    SELECT CASE WHEN derived.data->>'projectionSchema'='${schema}'
        AND derived.data->>'sourceEntityVersion'=original.version::text
      THEN derived.data ELSE aidscaler_entity_data(original.org,original.data,original.data_refs) END AS data
    FROM entities AS original LEFT JOIN entities AS derived
      ON derived.org=original.org AND derived.kind='context' AND derived.id='${projection}'
    WHERE original.org=$1 AND original.kind='context' AND original.id='${source}')`
    : `WITH received_context AS (SELECT aidscaler_entity_data(org,data,data_refs) AS data FROM entities
      WHERE org=$1 AND kind='context' AND id='${source}')`;
}

async function persistReadModel(
  store,
  org,
  kind,
  sourceEntityVersion,
  material,
) {
  check(
    Number.isSafeInteger(sourceEntityVersion) && sourceEntityVersion > 0,
    "CONTEXT_VERSION",
    "A received read model needs the current source entity version.",
  );
  const data = { projectionSchema: schema, sourceEntityVersion, ...material },
    at = Date.now();
  await store.query(
    `INSERT INTO entities(org,kind,id,data,created_at,updated_at)
    VALUES($1,'context',$2,$3::jsonb,$4,$4) ON CONFLICT(org,kind,id) DO UPDATE SET
      data=EXCLUDED.data,version=entities.version+1,updated_at=EXCLUDED.updated_at
    WHERE entities.data->>'sourceEntityVersion' IS DISTINCT FROM EXCLUDED.data->>'sourceEntityVersion'
      OR entities.data->>'projectionSchema' IS DISTINCT FROM EXCLUDED.data->>'projectionSchema'`,
    [org, definitions[kind].projection, JSON.stringify(data), at],
  );
}

export async function persistOperationalReadModel(
  store,
  org,
  snapshot,
  sourceEntityVersion,
) {
  let selected = snapshot;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    selected = pick(snapshot, operationalFields);
    if (Object.hasOwn(snapshot, "known"))
      selected.known =
        snapshot.known &&
        typeof snapshot.known === "object" &&
        !Array.isArray(snapshot.known)
          ? pick(snapshot.known, knownFields)
          : snapshot.known;
    if (Object.hasOwn(snapshot, "queries"))
      selected.queries = Array.isArray(snapshot.queries)
        ? snapshot.queries.filter((query) => query.target === "policy")
        : snapshot.queries;
  }
  await persistReadModel(store, org, "operational", sourceEntityVersion, {
    snapshot: selected,
  });
}

export async function persistDirectoryReadModel(
  store,
  org,
  map,
  sourceEntityVersion,
  sourceMapHash,
) {
  const selected =
    map && typeof map === "object" && !Array.isArray(map)
      ? pick(map, ["places"])
      : map;
  await persistReadModel(store, org, "geography", sourceEntityVersion, {
    map: selected,
    sourceMapHash,
  });
}

export async function receivedDirectoryRevision(store, org) {
  const { rows } = await store.query(
    `SELECT original.version,
      CASE WHEN derived.data->>'projectionSchema'='${schema}'
          AND derived.data->>'sourceEntityVersion'=original.version::text
        THEN derived.data->>'sourceMapHash' ELSE original.data->>'sourceMapHash' END AS source_map_hash
    FROM entities AS original LEFT JOIN entities AS derived
      ON derived.org=original.org AND derived.kind='context' AND derived.id='geography_projection'
    WHERE original.org=$1 AND original.kind='context' AND original.id='geography'`,
    [org],
  );
  return rows[0];
}

/** Read an exact subset of already received context inside the caller's
 * transaction. Never cache it across decisions or consult observer state. */
export async function receivedSnapshotFields(
  store,
  org,
  { fields = [], known = [] } = {},
) {
  for (const keys of [fields, known])
    check(
      Array.isArray(keys) &&
        keys.length <= 32 &&
        keys.every(
          (key) =>
            typeof key === "string" && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key),
        ),
      "CONTEXT_FIELDS",
      "Use a bounded list of received context field names.",
    );
  check(
    !fields.includes("known"),
    "CONTEXT_FIELDS",
    "Select known collections explicitly.",
  );
  const values = [org],
    selection = [
      "data ? 'snapshot' AS has_snapshot",
      "jsonb_typeof(data->'snapshot') AS snapshot_type",
      "CASE WHEN jsonb_typeof(data->'snapshot')<>'object' THEN data->'snapshot' END AS other_snapshot",
    ];
  const select = (prefix, keys, collection) =>
    keys.forEach((key, i) => {
      const parameter = "$" + values.push(key);
      selection.push(
        `(${collection} ? ${parameter}::text) AS ${prefix}has_${i}`,
        `(${collection}->${parameter}::text) AS ${prefix}value_${i}`,
      );
    });
  select("field_", fields, "(data->'snapshot')");
  if (known.length) {
    selection.push(
      "data->'snapshot' ? 'known' AS has_known",
      "jsonb_typeof(data#>'{snapshot,known}') AS known_type",
      "CASE WHEN jsonb_typeof(data#>'{snapshot,known}')<>'object' THEN data#>'{snapshot,known}' END AS other_known",
    );
    select("known_", known, "(data#>'{snapshot,known}')");
  }
  const canUseProjection =
    fields.every((key) => operationalFields.includes(key)) &&
    known.every((key) => knownFields.includes(key));
  const { rows } = await store.query(
    `${readSource("operational", canUseProjection)} SELECT ${selection.join(",")}
    FROM received_context`,
    values,
  );
  const row = rows[0];
  if (!row?.has_snapshot) return undefined;
  if (row.snapshot_type !== "object") return row.other_snapshot;
  const snapshot = {};
  fields.forEach((key, i) => {
    if (row[`field_has_${i}`]) snapshot[key] = row[`field_value_${i}`];
  });
  if (known.length && row.has_known) {
    snapshot.known = row.known_type === "object" ? {} : row.other_known;
    if (row.known_type === "object")
      known.forEach((key, i) => {
        if (row[`known_has_${i}`])
          snapshot.known[key] = row[`known_value_${i}`];
      });
  }
  return snapshot;
}

/** Preserve source-array order for stable equal-time policy selection. */
export async function receivedPolicyQueries(store, org) {
  const { rows } = await store.query(
    `${readSource("operational")} SELECT item FROM received_context
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(
      NULLIF(data#>'{snapshot,queries}', 'null'::jsonb), '[]'::jsonb))
      WITH ORDINALITY AS received(item,ordinal)
    WHERE item->>'target'='policy' ORDER BY ordinal`,
    [org],
  );
  return rows.map((row) => row.item);
}

/** Coverage uses the received place directory, never routes or world truth. */
export async function receivedDirectoryPlaces(store, org) {
  const { rows } = await store.query(
    `${readSource("geography")} SELECT data ? 'map' AS has_map,
    jsonb_typeof(data->'map') AS map_type, data->'map' ? 'places' AS has_places,
    data#>'{map,places}' AS places,
    CASE WHEN jsonb_typeof(data->'map')<>'object' THEN data->'map' END AS other_map
    FROM received_context`,
    [org],
  );
  const row = rows[0];
  return !row?.has_map
    ? undefined
    : row.map_type !== "object"
      ? row.other_map
      : row.has_places
        ? { places: row.places }
        : {};
}
