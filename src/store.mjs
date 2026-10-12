import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { AppError, check } from "./errors.mjs";
export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const uid = (prefix) => `${prefix}_${randomUUID()}`;
export class Store {
  constructor(db, postgres = false) {
    this.db = db;
    this.postgres = postgres;
  }
  static async open({ dataDir, databaseUrl } = {}) {
    const db = databaseUrl
      ? new pg.Pool({ connectionString: databaseUrl })
      : new PGlite(dataDir ?? "memory://");
    const s = new Store(db, !!databaseUrl);
    await s.exec(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    return s;
  }
  query(sql, values = []) {
    return this.db.query(sql, values);
  }
  async exec(sql) {
    return this.postgres ? this.db.query(sql) : this.db.exec(sql);
  }
  async transaction(fn) {
    if (!this.postgres) return this.db.transaction((tx) => fn(new Store(tx)));
    for (let attempt = 0; attempt < 4; attempt++) {
      const c = await this.db.connect();
      try {
        await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const result = await fn(new Store(c, true));
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        if (e.code !== "40001" || attempt === 3) throw e;
      } finally {
        c.release();
      }
    }
  }
  async organization(org, name = org) {
    await this.query(
      "INSERT INTO organizations(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [org, name],
    );
  }
  async get(org, kind, id, required = true) {
    const { rows } = await this.query(
      "SELECT id,kind,version,data,created_at,updated_at FROM entities WHERE org=$1 AND kind=$2 AND id=$3",
      [org, kind, id],
    );
    if (!rows[0] && required)
      throw new AppError("NOT_FOUND", "Record not found.", 404);
    return rows[0]
      ? {
          ...rows[0].data,
          id: rows[0].id,
          version: rows[0].version,
          createdAt: Number(rows[0].created_at),
          updatedAt: Number(rows[0].updated_at),
        }
      : null;
  }
  async list(org, kind, limit = 250) {
    const { rows } = await this.query(
      "SELECT id,kind,version,data,created_at,updated_at FROM entities WHERE org=$1 AND kind=$2 ORDER BY updated_at DESC,id LIMIT $3",
      [org, kind, limit],
    );
    return rows.map((r) => ({
      ...r.data,
      id: r.id,
      version: r.version,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }
  async put(org, kind, id, data, expectedVersion) {
    const clean = { ...data };
    delete clean.id;
    delete clean.version;
    delete clean.createdAt;
    delete clean.updatedAt;
    if (expectedVersion === 0) {
      try {
        await this.query(
          "INSERT INTO entities(org,kind,id,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)",
          [org, kind, id, JSON.stringify(clean), Date.now()],
        );
      } catch (e) {
        if (e.code === "23505")
          throw new AppError(
            "VERSION_CONFLICT",
            "This record already exists.",
            409,
          );
        throw e;
      }
    } else {
      const r = await this.query(
        "UPDATE entities SET data=$4,version=version+1,updated_at=$5 WHERE org=$1 AND kind=$2 AND id=$3 AND version=$6 RETURNING id",
        [org, kind, id, JSON.stringify(clean), Date.now(), expectedVersion],
      );
      check(
        r.rows.length,
        "VERSION_CONFLICT",
        "This record changed. Review its latest version.",
        409,
      );
    }
    return this.get(org, kind, id);
  }
  async upsert(org, kind, id, data) {
    const old = await this.get(org, kind, id, false);
    return this.put(org, kind, id, { ...old, ...data }, old?.version ?? 0);
  }
  async audit(org, actor, action, entity, detail = {}) {
    await this.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      org,
    ]);
    const previous =
      (
        await this.query(
          "SELECT hash FROM audit WHERE org=$1 ORDER BY sequence DESC LIMIT 1",
          [org],
        )
      ).rows[0]?.hash ?? "";
    const at = Date.now(),
      digest = hash({ org, actor, action, entity, detail, at, previous });
    await this.query(
      "INSERT INTO audit(org,actor,action,entity,detail,occurred_at,previous_hash,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        org,
        actor,
        action,
        entity,
        JSON.stringify(detail),
        at,
        previous,
        digest,
      ],
    );
  }
  async command(org, key, payload, fn) {
    check(
      typeof key === "string" && key.length >= 3 && key.length <= 180,
      "IDEMPOTENCY",
      "An idempotency key is required.",
    );
    return this.transaction(async (tx) => {
      await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        org,
      ]);
      const h = hash(payload),
        existing = (
          await tx.query(
            "SELECT request_hash,result FROM idempotency WHERE org=$1 AND key=$2",
            [org, key],
          )
        ).rows[0];
      if (existing) {
        check(
          existing.request_hash === h,
          "IDEMPOTENCY_CONFLICT",
          "The same key cannot be reused for a different command.",
          409,
        );
        return existing.result;
      }
      await tx.query(
        "INSERT INTO idempotency(org,key,request_hash) VALUES($1,$2,$3)",
        [org, key, h],
      );
      const result = await fn(tx);
      await tx.query(
        "UPDATE idempotency SET result=$3 WHERE org=$1 AND key=$2",
        [org, key, JSON.stringify(result)],
      );
      return result;
    });
  }
  async enqueue(org, kind, payload, id = uid("job"), due = Date.now()) {
    await this.query(
      "INSERT INTO jobs(id,org,kind,payload,state,due_at,created_at) VALUES($1,$2,$3,$4,'queued',$5,$6) ON CONFLICT DO NOTHING",
      [id, org, kind, JSON.stringify(payload), due, Date.now()],
    );
    return id;
  }
  async lease(org, leaseMs = 180000) {
    return this.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT * FROM jobs WHERE org=$1 AND ((state IN ('queued','retry') AND due_at<=$2) OR (state='running' AND leased_until<$2)) ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        [org, Date.now()],
      );
      if (!rows[0]) return null;
      await tx.query(
        "UPDATE jobs SET state='running',attempts=attempts+1,leased_until=$2 WHERE id=$1",
        [rows[0].id, Date.now() + leaseMs],
      );
      return { ...rows[0], attempts: rows[0].attempts + 1 };
    });
  }
  async finishJob(id, result) {
    await this.query(
      "UPDATE jobs SET state='completed',result=$2,leased_until=NULL WHERE id=$1",
      [id, JSON.stringify(result)],
    );
  }
  async failJob(job, error) {
    await this.query(
      "UPDATE jobs SET state=$2,last_error=$3,due_at=$4,leased_until=NULL WHERE id=$1",
      [
        job.id,
        job.attempts >= 5 ? "failed" : "retry",
        String(error.code ?? "WORKER_ERROR") +
          ": " +
          error.message.slice(0, 180),
        Date.now() + Math.min(60000, 1000 * 2 ** job.attempts),
      ],
    );
  }
  async close() {
    return this.postgres ? this.db.end() : this.db.close();
  }
}
