import { unlink, rm } from "node:fs/promises";
import path from "node:path";
import { role, check } from "./errors.mjs";
import { hash, uid } from "./store.mjs";
const originals = ["signal", "media"],
  derived = new Set(["signal", "source_version", "media", "media_analysis", "claim", "claim_history", "group_history", "external", "report", "pattern", "evidence_group", "investigation_checkpoint", "semantic_receipt", "discovery_run", "source_opportunity", "source_attention"]);
const refers = (v, ids) => typeof v === "string" ? ids.has(v) : v && typeof v === "object" && Object.values(v).some((x) => refers(x, ids));
function fragmentsOf(value, into = new Set()) {
  if (value && typeof value === "object") for (const [key, v] of Object.entries(value)) {
    if (["text", "transcript", "caption", "description", "summary", "title", "content"].includes(key) && typeof v === "string" && v.length >= 16) into.add(v);
    else if (v && typeof v === "object") fragmentsOf(v, into);
  }
  return into;
}
const scrub = (v, fragments) => typeof v === "string" ? [...fragments].reduce((s, f) => s.split(f).join("[source content erased]"), v) :
  Array.isArray(v) ? v.map((x) => scrub(x, fragments)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, fragments)])) : v;
/** Source erasure preserves physical commands and decision owners. File cleanup
 * is durable; metadata-only erasure is never reported as complete. */
export class Retention {
  constructor(store, domain, config) { Object.assign(this, { store, domain, config }); }
  async preview(actor, { kind, id }, store = this.store) {
    role(actor, ["admin", "commander", "auditor"]);
    check(originals.includes(kind), "RETENTION_KIND", "Select an original signal or uploaded source.");
    const original = await store.get(actor.org, kind, id), ids = new Set([id]), hashes = new Set([original.contentHash].filter(Boolean));
    if (kind === "media") ids.add("media_interpretation_" + id);
    const rows = (await store.query("SELECT kind,id,version,data FROM entities WHERE org=$1 ORDER BY kind,id", [actor.org])).rows;
    for (const r of rows.filter((r) => r.kind === "media" && hashes.has(r.data.contentHash))) ids.add(r.id);
    let affected = [], previous = -1;
    while (affected.length !== previous) {
      previous = affected.length;
      affected = rows.filter((r) => ids.has(r.id) || refers(r.data, ids) || r.kind === "source_version" && [...ids].some((source) => r.id.startsWith(source + "_")));
      for (const r of affected) if (derived.has(r.kind) || ["proposal", "activity", "publication", "public_evidence"].includes(r.kind)) ids.add(r.id);
    }
    for (const r of affected) if (["media", "public_evidence"].includes(r.kind)) for (const key of ["contentHash", "publicHash", "originalHash"])
      if (/^[a-f0-9]{64}$/.test(r.data[key] ?? "")) hashes.add(r.data[key]);
    return { kind, id, version: original.version, records: affected.map(({ kind, id, version }) => ({ kind, id, version })), files: [...hashes].sort(),
      sourceHash: original.contentHash, planHash: hash(affected),
      processingEffect: "Automatic inquiry pauses. In-flight inquiries cancel and provider response bodies are redacted. Already received physical commands remain.",
      limitations: ["External provider copies, peer instances, exports and old backups need separate deletion procedures.",
        "Decision identities, command quantities, deduplication keys and hash receipts remain. Audit text redaction is explicit and records its former chain head."] };
  }
  async erase(actor, input, key) {
    role(actor, ["admin", "commander"]);
    const replay = (await this.store.query("SELECT request_hash,result FROM idempotency WHERE org=$1 AND key=$2", [actor.org, key])).rows[0];
    if (replay) {
      check(replay.request_hash === hash(input), "IDEMPOTENCY_CONFLICT", "Use the original erasure command or a new key.", 409);
      return this.store.get(actor.org, "erasure", replay.result.id);
    }
    check(typeof input.reason === "string" && input.reason.length >= 5 && input.reason.length <= 500, "RETENTION_REASON", "Record the source-policy or privacy basis.");
    const plan = await this.preview(actor, input);
    check(plan.planHash === input.planHash && plan.version === input.version, "RETENTION_CHANGED", "Review the current erasure scope before confirming.", 409);
    const id = uid("erasure"), affectedIds = new Set(plan.records.map((r) => r.id));
    return this.store.command(actor.org, key, input, async (tx) => {
      const current = await this.preview(actor, input, tx);
      check(current.planHash === plan.planHash, "RETENTION_CHANGED", "The erasure scope changed.", 409);
      const fragments = new Set();
      for (const r of plan.records) fragmentsOf(await tx.get(actor.org, r.kind, r.id), fragments);
      for (const r of plan.records) {
        const old = await tx.get(actor.org, r.kind, r.id);
        if (r.kind === "public_evidence") {
          await tx.put(actor.org, r.kind, r.id, { ...old, state: "withdrawn", caption: "Source withdrawn", originalHash: null, publicHash: null, erasure: id }, old.version);
        } else if (derived.has(r.kind)) {
          await tx.put(actor.org, r.kind, r.id, { state: "erased", erasedAt: Date.now(), erasure: id, sourceHash: hash(old), visibility: "organization" }, old.version);
          if (originals.includes(r.kind)) await tx.upsert(actor.org, "erased_source", r.id, { kind: r.kind, sourceHash: old.contentHash ?? hash(old), at: Date.now(), erasure: id });
        } else {
          const clean = scrub(old, fragments);
          if (["proposal", "activity", "publication"].includes(r.kind)) {
            for (const field of ["text", "summary", "rationale", "benefit", "title", "evidence", "steps", "inputSnapshot", "alternatives", "previousAuthorization"])
              if (field in clean) clean[field] = ["evidence", "steps", "alternatives"].includes(field) ? [] : "Source content erased";
            if (clean.authorization) clean.authorization = { ...clean.authorization, evidence: [], evidenceRedactedBy: id };
            if (r.kind === "publication") clean.state = "withdrawn";
          }
          await tx.put(actor.org, r.kind, r.id, { ...clean, erasure: id }, old.version);
        }
      }
      for (const row of (await tx.query("SELECT kind,id,version,data FROM entities WHERE org=$1", [actor.org])).rows) {
        if (affectedIds.has(row.id) || row.kind === "erasure") continue;
        const cleaned = scrub(row.data, fragments);
        if (hash(cleaned) !== hash(row.data)) await tx.put(actor.org, row.kind, row.id, { ...cleaned, erasure: id }, row.version);
        if (row.kind === "investigation_checkpoint") await tx.upsert(actor.org, row.kind, row.id, { state: "erased", messages: [], erasure: id });
        if (row.kind === "activity" && !["ready", "failed", "cancelled", "inconclusive"].includes(row.data.state))
          await tx.upsert(actor.org, row.kind, row.id, { cancelRequested: true, state: "cancelled", steps: [], erasure: id });
      }
      await this.domain.invalidateTx(tx, actor.org, input.id, "A cited original source was erased under an approved policy");
      await tx.upsert(actor.org, "retention_epoch", "active", { at: Date.now(), erasure: id });
      await tx.upsert(actor.org, "automation", "intake", { enabled: false, pausedReason: "Source erasure; review before resuming" });
      for (const row of (await tx.query("SELECT key,result FROM idempotency WHERE org=$1", [actor.org])).rows)
        if (refers(row.result, affectedIds) || hash(scrub(row.result, fragments)) !== hash(row.result))
          await tx.query("UPDATE idempotency SET result=$3 WHERE org=$1 AND key=$2", [actor.org, row.key, JSON.stringify({ redacted: true, erasure: id })]);
      await tx.query("UPDATE usage SET result=jsonb_build_object('erased',true,'receiptPreserved',true) WHERE org=$1", [actor.org]);
      await tx.query("UPDATE jobs SET state='cancelled',payload=jsonb_build_object('erased',true),result=NULL,lease_token=NULL WHERE org=$1 AND kind IN ('investigate','analyze_media','discover_response','compile_response','interpret_sources') AND state IN ('queued','running','retry')", [actor.org]);
      // Source text is not an immutable privacy exemption. Chain migration is
      // explicit: preserve the former head and redacted row hashes in the receipt.
      const audits = (await tx.query("SELECT * FROM audit WHERE org=$1 ORDER BY sequence", [actor.org])).rows;
      const priorAuditHead = audits.at(-1)?.hash ?? "", redactions = [];
      let previous = "";
      for (const a of audits) {
        const detail = scrub(a.detail, fragments);
        if (hash(detail) !== hash(a.detail)) redactions.push({ sequence: Number(a.sequence), formerHash: a.hash, formerDetailHash: hash(a.detail) });
        const digest = hash({ org: actor.org, actor: a.actor, action: a.action, entity: a.entity, detail, at: Number(a.occurred_at), previous });
        await tx.query("UPDATE audit SET detail=$2,previous_hash=$3,hash=$4 WHERE sequence=$1", [a.sequence, JSON.stringify(detail), previous, digest]);
        previous = digest;
      }
      const receipt = await tx.put(actor.org, "erasure", id, { source: input.id, sourceKind: input.kind,
        sourceHash: plan.sourceHash ?? hash([input.kind, input.id, input.version]), recordCount: plan.records.length, files: plan.files,
        confirmedBy: actor.id, reason: input.reason, state: "metadata_erased_files_pending", obligations: plan.limitations, priorAuditHead, auditRedactions: redactions }, 0);
      await tx.enqueue(actor.org, "erase_source_files", { id }, "erase_files_" + id);
      await tx.audit(actor.org, actor.id, "source.erased", input.id, { erasure: id, sourceHash: receipt.sourceHash, recordCount: receipt.recordCount, priorAuditHead, redactions: redactions.length });
      return receipt;
    });
  }
  async cleanup(org, id) {
    const receipt = await this.store.get(org, "erasure", id);
    if (receipt.state === "local_erasure_completed") return receipt;
    const base = path.resolve(this.config.evidenceDir, org);
    for (const digest of receipt.files) {
      check(/^[a-f0-9]{64}$/.test(digest), "RETENTION_PATH", "Only validated source hashes can be deleted.");
      const referenced = (await this.store.query("SELECT id FROM entities WHERE org=$1 AND kind IN ('media','public_evidence') AND (data->>'contentHash'=$2 OR data->>'publicHash'=$2) AND data->>'state' NOT IN ('erased','withdrawn')", [org, digest])).rows;
      check(!referenced.length, "RETENTION_REFERENCE", "A live reference to these bytes still needs review.", 409);
      for (const suffix of ["", "-pages", "-frames"]) {
        const target = path.resolve(base, digest + suffix);
        check(target.startsWith(base + path.sep), "RETENTION_PATH", "Resolved target stays inside this organization's evidence directory.");
        if (suffix) await rm(target, { recursive: true, force: true });
        else await unlink(target).catch((e) => { if (e.code !== "ENOENT") throw e; });
      }
    }
    return this.store.upsert(org, "erasure", id, { state: "local_erasure_completed", completedAt: Date.now() });
  }
}
