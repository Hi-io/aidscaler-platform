import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { AppError, check } from "./errors.mjs";
const canonical = (value) => {
  if (value?.toJSON) return canonical(value.toJSON());
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
};
export const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonical(value)),
    )
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
  // A page-sized scoped read, including inside the caller's transaction. Never
  // reuse this map across transactions: erasure and version changes must be
  // re-read after a remote download acknowledgement.
  async getMany(org, kind, ids) {
    check(
      Array.isArray(ids) && ids.length <= 10000 &&
        ids.every((id) => typeof id === "string" && id.length > 0),
      "BATCH_SCOPE", "Use a bounded list of exact entity IDs.",
    );
    if (!ids.length) return new Map();
    const { rows } = await this.query(
      "SELECT id,version,data,created_at,updated_at FROM entities WHERE org=$1 AND kind=$2 AND id=ANY($3::text[])",
      [org, kind, [...new Set(ids)]],
    );
    return new Map(rows.map((r) => [r.id, {
      ...r.data, id: r.id, version: r.version,
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    }]));
  }
  async dependents(org, kind, dependency) {
    const { rows } = await this.query(
      "SELECT id,version,data,created_at,updated_at FROM entities WHERE org=$1 AND kind=$2 AND data->'dependencies' @> $3::jsonb ORDER BY id",
      [org, kind, JSON.stringify([dependency])],
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
  async decisionPage(org, { offset = 0, limit = 12, history = false } = {}) {
    check(
      Number.isSafeInteger(offset) &&
        offset >= 0 &&
        offset <= 1000000 &&
        Number.isSafeInteger(limit) &&
        limit > 0 &&
        limit <= 50,
      "PAGINATION",
      "Invalid decision page.",
    );
    const states = [
      "awaiting_review",
      "requires_review",
      "needs_clarification",
      "conditionally_authorized",
    ];
    const predicate = history
      ? "NOT (data->>'state'=ANY($2::text[]))"
      : "data->>'state'=ANY($2::text[])";
    const total = Number(
      (
        await this.query(
          `SELECT COUNT(*) AS total FROM entities WHERE org=$1 AND kind='proposal' AND ${predicate}`,
          [org, states],
        )
      ).rows[0].total,
    );
    const { rows } = await this.query(
      `SELECT id,version,data,created_at,updated_at FROM entities WHERE org=$1 AND kind='proposal' AND ${predicate} ORDER BY CASE data->>'priority' WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 ELSE 1 END DESC,created_at,id LIMIT $3 OFFSET $4`,
      [org, states, limit, offset],
    );
    return {
      rows: rows.map((r) => ({
        ...r.data,
        id: r.id,
        version: r.version,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      })),
      total,
      offset,
      limit,
    };
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
  async enqueueContinuation(
    org,
    proposalId,
    { due = Date.now() + 1000, revive = true } = {},
  ) {
    const id = "continue_" + hash([org, proposalId]);
    // Coalesce direct execution, source receipts and worker polling into one
    // durable record. A live lease and a failed retry budget are never reset.
    await this.query(
      `INSERT INTO jobs(id,org,kind,payload,state,due_at,created_at)
       VALUES($1,$2,'continue_proposal',$3,'queued',$4,$5)
       ON CONFLICT(id) DO UPDATE SET
         state=CASE WHEN jobs.state='completed' THEN 'queued' ELSE jobs.state END,
         due_at=CASE WHEN jobs.state='completed' THEN EXCLUDED.due_at ELSE LEAST(jobs.due_at,EXCLUDED.due_at) END,
         attempts=CASE WHEN jobs.state='completed' THEN 0 ELSE jobs.attempts END,
         leased_until=CASE WHEN jobs.state='completed' THEN NULL ELSE jobs.leased_until END,
         lease_token=CASE WHEN jobs.state='completed' THEN NULL ELSE jobs.lease_token END,
         result=CASE WHEN jobs.state='completed' THEN NULL ELSE jobs.result END,
         last_error=CASE WHEN jobs.state='completed' THEN NULL ELSE jobs.last_error END,
         created_at=CASE WHEN jobs.state='completed' THEN EXCLUDED.created_at ELSE jobs.created_at END
       WHERE jobs.org=EXCLUDED.org AND jobs.kind='continue_proposal'
         AND ((jobs.state='completed' AND $6) OR
              (jobs.state='queued' AND EXCLUDED.due_at<jobs.due_at))`,
      [id, org, JSON.stringify({ id: proposalId }), due, Date.now(), revive],
    );
    return id;
  }
  async rescheduleJob(job, { due = Date.now() + 1000, result = null } = {}) {
    const changed = await this.query(
      `UPDATE jobs SET state='queued',due_at=$4,result=$5,attempts=0,created_at=$6,
         last_error=NULL,leased_until=NULL,lease_token=NULL
       WHERE id=$1 AND org=$2 AND state='running' AND lease_token=$3 RETURNING id`,
      [
        job.id,
        job.org,
        job.lease_token,
        due,
        JSON.stringify(result),
        Date.now(),
      ],
    );
    check(
      changed.rows.length,
      "JOB_LEASE_LOST",
      "This worker cannot reschedule a reclaimed job.",
      409,
    );
  }
  async completeContinuation(org, proposalId, result = null) {
    // A running owner must finish through its lease fence. A direct terminal
    // observation can safely retire a pending poll without stealing that lease.
    await this.query(
      `UPDATE jobs SET state='completed',result=$3,leased_until=NULL,lease_token=NULL
       WHERE id=$1 AND org=$2 AND kind='continue_proposal' AND state IN ('queued','retry')`,
      ["continue_" + hash([org, proposalId]), org, JSON.stringify(result)],
    );
  }
  async lease(org, leaseMs = 180000, asOf = Date.now()) {
    return this.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT * FROM jobs WHERE org=$1 AND created_at<=$3 AND ((state IN ('queued','retry') AND due_at<=$2) OR (state='running' AND leased_until<$2)) ORDER BY due_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        [org, asOf, asOf],
      );
      if (!rows[0]) return null;
      const token = uid("lease");
      await tx.query(
        "UPDATE jobs SET state='running',attempts=attempts+1,leased_until=$2,lease_token=$3 WHERE id=$1",
        [rows[0].id, Date.now() + leaseMs, token],
      );
      return { ...rows[0], lease_token: token, attempts: rows[0].attempts + 1 };
    });
  }
  async renewJob(job, leaseMs = 180000) {
    const result = await this.query(
      "UPDATE jobs SET leased_until=$4 WHERE id=$1 AND org=$2 AND state='running' AND lease_token=$3 RETURNING id",
      [job.id, job.org, job.lease_token, Date.now() + leaseMs],
    );
    check(
      result.rows.length,
      "JOB_LEASE_LOST",
      "Another worker now owns this job.",
      409,
    );
  }
  async finishJob(id, result, token = null) {
    const changed = await this.query(
      "UPDATE jobs SET state='completed',result=$2,leased_until=NULL WHERE id=$1 AND ($3::text IS NULL OR lease_token=$3) RETURNING id",
      [id, JSON.stringify(result), token],
    );
    check(
      changed.rows.length,
      "JOB_LEASE_LOST",
      "This worker cannot finish a reclaimed job.",
      409,
    );
  }
  async failJob(job, error) {
    const changed = await this.query(
      "UPDATE jobs SET state=$2,last_error=$3,due_at=$4,leased_until=NULL WHERE id=$1 AND org=$6 AND state='running' AND ($5::text IS NULL OR lease_token=$5) RETURNING id",
      [
        job.id,
        job.attempts >= 5 ? "failed" : "retry",
        String(error.code ?? "WORKER_ERROR") +
          ": " +
          error.message.slice(0, 180),
        Date.now() + Math.min(60000, 1000 * 2 ** job.attempts),
        job.lease_token ?? null,
        job.org,
      ],
    );
    return changed.rows.length > 0;
  }
  async close() {
    return this.postgres ? this.db.end() : this.db.close();
  }
}
