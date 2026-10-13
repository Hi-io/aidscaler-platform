import { Store, hash } from "../src/store.mjs";
import { configuration } from "../src/config.mjs";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { check } from "../src/errors.mjs";

const TABLES = [
  "organizations",
  "users",
  "entities",
  "idempotency",
  "audit",
  "jobs",
  "inbox",
  "usage",
  "finance",
];
/** A consistent SQL snapshot. Secrets/session cookies are not exported.
 * Password hashes and private evidence ARE included: keep the bundle private.
 * The caller must quiesce its source/worker before opening the local database.
 */
export async function backupLocal(store, config) {
  const payload = await store.transaction(async (tx) => {
    const pending = (
      await tx.query("SELECT COUNT(*) AS n FROM jobs WHERE state='running'")
    ).rows[0];
    check(
      Number(pending.n) === 0,
      "BACKUP_BUSY",
      "Stop workers and let active jobs finish before taking a recovery snapshot.",
      409,
    );
    const tables = {};
    for (const table of TABLES)
      tables[table] = (await tx.query(`SELECT * FROM ${table}`)).rows;
    return {
      format: "aidscaler-local-backup-v1",
      createdAt: new Date().toISOString(),
      tables,
      files: [],
    };
  });
  const names = new Set();
  for (const r of payload.tables.entities) {
    const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    const contentHash =
      r.kind === "media"
        ? d.contentHash
        : r.kind === "public_evidence"
          ? d.publicHash
          : null;
    if (!contentHash || names.has(r.org + "/" + contentHash)) continue;
    check(
      /^[a-zA-Z0-9_-]+$/.test(r.org) && /^[a-f0-9]{64}$/.test(contentHash),
      "BACKUP_PATH",
      "Unexpected evidence identifier.",
    );
    names.add(r.org + "/" + contentHash);
    const bytes = await readFile(
      path.join(config.evidenceDir, r.org, contentHash),
    );
    check(
      hash(bytes.toString("base64")) === contentHash,
      "EVIDENCE_INTEGRITY",
      "An evidence file no longer matches its content hash.",
    );
    payload.files.push({
      org: r.org,
      contentHash,
      base64: bytes.toString("base64"),
    });
  }
  return { payload, integrity: hash(payload) };
}
export async function restoreLocal(bundle, target) {
  check(
    // Legacy bundles retain their exact payload and integrity: renaming a
    // format before hashing would invalidate a genuine recovery snapshot.
    ["aidscaler-local-backup-v1", "nexo-local-backup-v1"].includes(
      bundle?.payload?.format,
    ) && bundle.integrity === hash(bundle.payload),
    "BACKUP_INTEGRITY",
    "Recovery bundle integrity check failed.",
  );
  const resolved = path.resolve(target);
  const exists = await access(resolved).then(
    () => true,
    () => false,
  );
  check(
    !exists,
    "RESTORE_EXISTS",
    "Restore into a new directory; existing workspace data is never overwritten.",
  );
  check(
    Array.isArray(bundle.payload.files) &&
      TABLES.every((t) => Array.isArray(bundle.payload.tables[t])),
    "BACKUP_SCHEMA",
    "Invalid recovery bundle.",
  );
  const dataDir = path.join(resolved, "pgdata"),
    evidenceDir = path.join(resolved, "evidence");
  await mkdir(resolved, { recursive: true });
  const s = await Store.open({ dataDir });
  try {
    await s.transaction(async (tx) => {
      for (const table of TABLES) {
        const columns = new Set(
          (
            await tx.query(
              "SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND table_schema='public'",
              [table],
            )
          ).rows.map((r) => r.column_name),
        );
        for (const row of bundle.payload.tables[table]) {
          const keys = Object.keys(row);
          check(
            keys.length && keys.every((k) => columns.has(k)),
            "BACKUP_SCHEMA",
            "Unexpected recovery column.",
          );
          await tx.query(
            `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
            keys.map((k) =>
              row[k] != null && typeof row[k] === "object"
                ? JSON.stringify(row[k])
                : row[k],
            ),
          );
        }
      }
      await tx.query(
        "SELECT setval('audit_sequence_seq',COALESCE((SELECT MAX(sequence) FROM audit),1),(SELECT COUNT(*)>0 FROM audit))",
      );
    });
    for (const f of bundle.payload.files) {
      check(
        /^[a-zA-Z0-9_-]+$/.test(f.org) && /^[a-f0-9]{64}$/.test(f.contentHash),
        "BACKUP_PATH",
        "Unexpected evidence identifier.",
      );
      const bytes = Buffer.from(f.base64, "base64");
      check(
        hash(bytes.toString("base64")) === f.contentHash,
        "EVIDENCE_INTEGRITY",
        "Recovered evidence failed its hash check.",
      );
      const dir = path.join(evidenceDir, f.org);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, f.contentHash), bytes);
    }
    return {
      directory: resolved,
      dataDir,
      evidenceDir,
      tables: TABLES.length,
      files: bundle.payload.files.length,
      sessionsRestored: false,
    };
  } finally {
    await s.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [operation, filename, destination] = process.argv.slice(2);
  check(
    ["export", "restore"].includes(operation) && filename,
    "BACKUP_COMMAND",
    "Use: node scripts/backup.mjs export .local/backups/name.json.gz OR restore bundle new-directory.",
  );
  if (operation === "export") {
    const config = await configuration(),
      s = await Store.open(config);
    try {
      const bundle = await backupLocal(s, config);
      await mkdir(path.dirname(path.resolve(filename)), { recursive: true });
      await writeFile(filename, gzipSync(JSON.stringify(bundle)), {
        flag: "wx",
      });
      console.log(
        "Private recovery snapshot created. Keep it outside Git; do not publish its contents.",
      );
    } finally {
      await s.close();
    }
  } else {
    check(destination, "RESTORE_TARGET", "Specify a new recovery directory.");
    const compressed = await readFile(filename);
    check(
      compressed.length <= 200_000_000,
      "BACKUP_SIZE",
      "Recovery bundle exceeds the local limit.",
    );
    const bundle = JSON.parse(
      gunzipSync(compressed, { maxOutputLength: 500_000_000 }).toString("utf8"),
    );
    console.log(JSON.stringify(await restoreLocal(bundle, destination)));
  }
}
