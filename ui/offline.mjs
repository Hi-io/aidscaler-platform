const DATABASE = "aidscaler-field-v1";
// The legacy name is a compatibility input; all new reports use DATABASE.
const LEGACY_DATABASE = "nexo-field-v1";
const IMPORTS = "legacy_imports";

function openDatabase(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const r = version ? indexedDB.open(name, version) : indexedDB.open(name);
    let absent = false,
      blocked = false;
    r.onupgradeneeded = (event) => {
      if (!upgrade && event.oldVersion === 0) {
        // Probing must not create an empty legacy database.
        absent = true;
        r.transaction.abort();
      } else upgrade?.(r.result);
    };
    r.onsuccess = () => {
      if (blocked) {
        r.result.close();
        return;
      }
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () => (absent ? resolve(null) : reject(r.error));
    r.onblocked = () => {
      blocked = true;
      reject(
        new Error(
          "Close other field-report tabs to upgrade the offline queue.",
        ),
      );
    };
  });
}

function transaction(database, stores, mode, start) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    let result, failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(
        failure ??
          tx.error ??
          new Error("Offline queue transaction was aborted."),
      );
    tx.onerror = () => {
      failure ??= tx.error;
    };
    try {
      start(
        tx,
        (value) => {
          result = value;
        },
        (error) => {
          failure = error;
          tx.abort();
        },
      );
    } catch (error) {
      failure = error;
      tx.abort();
    }
  });
}

// Field reports and task updates are JSON records. Sort object keys so an
// identical record with a different property insertion order is a safe replay.
function canonical(value) {
  return JSON.stringify(value, (_, item) =>
    item && Object.getPrototypeOf(item) === Object.prototype
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

async function migrateLegacy(database) {
  const legacy = await openDatabase(LEGACY_DATABASE);
  if (!legacy) return;
  try {
    if (!legacy.objectStoreNames.contains("queue")) return;
    const rows = await transaction(
      legacy,
      "queue",
      "readonly",
      (tx, result) => {
        tx.objectStore("queue").getAll().onsuccess = (event) =>
          result(event.target.result);
      },
    );
    if (!rows.length) return;
    const snapshots = await Promise.all(
      rows.map(async (row) => {
        const serialized = canonical(row);
        const bytes = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(serialized),
          ),
        );
        // Durable replay markers contain no retained report text after sending.
        return {
          row,
          serialized,
          fingerprint: Array.from(bytes, (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        };
      }),
    );
    // Copy and replay markers commit together. A conflict aborts the entire
    // batch, preserving both organizations' original records for resolution.
    await transaction(
      database,
      ["queue", IMPORTS],
      "readwrite",
      (tx, _, abort) => {
        const queue = tx.objectStore("queue"),
          imports = tx.objectStore(IMPORTS);
        for (const snapshot of snapshots) {
          const { row, fingerprint: original } = snapshot;
          const imported = imports.get(row.clientId),
            existing = queue.get(row.clientId);
          let left = 2;
          const ready = () => {
            if (--left) return;
            const marker = imported.result;
            if (
              (marker && marker.fingerprint !== original) ||
              (!marker &&
                existing.result !== undefined &&
                canonical(existing.result) !== snapshot.serialized)
            ) {
              const error = new Error(
                "A legacy offline report conflicts with an existing clientId. Both copies were preserved.",
              );
              error.code = "OFFLINE_MIGRATION_CONFLICT";
              abort(error);
              return;
            }
            // A marker also covers a successfully sent/deleted or subsequently
            // edited new record. Never resurrect or overwrite it on replay.
            if (!marker) {
              if (existing.result === undefined) queue.add(row);
              imports.add({ clientId: row.clientId, fingerprint: original });
            }
          };
          imported.onsuccess = ready;
          existing.onsuccess = ready;
        }
      },
    );
    // Cross-database transactions cannot be atomic. Delete from the old queue
    // only after the durable new commit, and never erase a concurrent update.
    await transaction(legacy, "queue", "readwrite", (tx) => {
      const queue = tx.objectStore("queue");
      for (const snapshot of snapshots) {
        const request = queue.get(snapshot.row.clientId);
        request.onsuccess = () => {
          if (
            request.result !== undefined &&
            canonical(request.result) === snapshot.serialized
          )
            queue.delete(snapshot.row.clientId);
        };
      }
    });
  } finally {
    legacy.close();
  }
}

async function db() {
  const database = await openDatabase(DATABASE, 2, (d) => {
    if (!d.objectStoreNames.contains("queue"))
      d.createObjectStore("queue", { keyPath: "clientId" });
    if (!d.objectStoreNames.contains(IMPORTS))
      d.createObjectStore(IMPORTS, { keyPath: "clientId" });
  });
  try {
    await migrateLegacy(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function offlineQueue(operation, value) {
  if (!["put", "all", "delete", "clear"].includes(operation))
    throw new Error("Unknown offline queue operation.");
  const database = await db();
  try {
    return await transaction(
      database,
      "queue",
      operation === "all" ? "readonly" : "readwrite",
      (tx, result) => {
        const queue = tx.objectStore("queue"),
          request =
            operation === "all" ? queue.getAll() : queue[operation](value);
        request.onsuccess = () => result(request.result);
      },
    );
  } finally {
    database.close();
  }
}
