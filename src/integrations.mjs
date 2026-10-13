import { z } from "zod";
import { role, check } from "./errors.mjs";
import { uid, hash } from "./store.mjs";
import { McpConnector } from "./mcp.mjs";
import { Intake } from "./intake.mjs";
const PAGE_SIZE = 100,
  MAX_RECORDS = 10000,
  MAX_BYTES = 8_000_000;
const entries = (data) => {
  const value = Array.isArray(data)
    ? data
    : (data?.results ?? data?.data ?? [data]);
  return Array.isArray(value) ? value : [value];
};
const entryId = (id, item) => id + "_" + hash(item?.id ?? item).slice(0, 24);
const connectionScope = (c) =>
  hash({
    type: c.type,
    url: c.url,
    allowedOrigin: c.allowedOrigin,
    credentialsEnv: c.credentialsEnv ?? null,
    allowedTools: c.allowedTools,
    purpose: c.purpose,
    license: c.license,
  });
function replaceEntries(data, items) {
  if (Array.isArray(data)) return items;
  if (Array.isArray(data?.results)) return { ...data, results: items };
  if (Array.isArray(data?.data)) return { ...data, data: items };
  return items.length === 1 ? items[0] : items;
}
// Registry declarations describe coverage and policy; they grant no tool,
// source-confirmation or write authority. Unknown is a value, never implied zero.
const registrySchema = z
  .object({
    sourceOwner: z.string().trim().min(1).max(200).default("unknown"),
    lifecycle: z
      .enum([
        "proposed",
        "sandbox",
        "not_tested",
        "tested_read_only",
        "operational",
      ])
      .default("not_tested"),
    authority: z
      .enum(["unknown", "public_observation", "operational_system_of_record"])
      .default("unknown"),
    schema: z
      .object({
        name: z.string().trim().min(1).max(150).default("unknown"),
        version: z.string().trim().min(1).max(100).default("unknown"),
      })
      .strict()
      .prefault({}),
    coverage: z
      .object({
        geography: z.string().trim().min(1).max(1000).default("unknown"),
        languages: z
          .array(z.string().trim().min(2).max(40))
          .max(30)
          .default(["unknown"]),
      })
      .strict()
      .prefault({}),
    cost: z
      .object({
        state: z.enum(["unknown", "declared"]).default("unknown"),
        amount: z.number().finite().nonnegative().nullable().default(null),
        currency: z.string().trim().min(3).max(16).nullable().default(null),
        per: z.string().trim().min(1).max(150).default("unknown"),
      })
      .strict()
      .prefault({}),
    retention: z
      .object({
        state: z.enum(["unknown", "declared"]).default("unknown"),
        policy: z.string().trim().min(1).max(1000).default("unknown"),
      })
      .strict()
      .prefault({}),
    lastTest: z
      .object({
        state: z
          .enum(["not_tested", "reported_pass", "reported_fail"])
          .default("not_tested"),
        at: z.number().int().positive().nullable().default(null),
        reference: z.string().trim().min(1).max(1000).nullable().default(null),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .prefault({})
  .superRefine((r, ctx) => {
    if (
      r.cost.state === "declared" &&
      (r.cost.amount === null ||
        r.cost.currency === null ||
        r.cost.per === "unknown")
    )
      ctx.addIssue({
        code: "custom",
        path: ["cost"],
        message:
          "A declared cost requires amount, currency and unit; otherwise keep it unknown.",
      });
    if (r.retention.state === "declared" && r.retention.policy === "unknown")
      ctx.addIssue({
        code: "custom",
        path: ["retention"],
        message: "A declared retention policy requires its actual policy text.",
      });
    if (
      r.lastTest.state !== "not_tested" &&
      (r.lastTest.at === null || r.lastTest.reference === null)
    )
      ctx.addIssue({
        code: "custom",
        path: ["lastTest"],
        message: "A reported test requires a dated evidence reference.",
      });
    if (
      ["tested_read_only", "operational"].includes(r.lifecycle) &&
      r.lastTest.state !== "reported_pass"
    )
      ctx.addIssue({
        code: "custom",
        path: ["lifecycle"],
        message:
          "A tested or operational declaration requires a reported passing test; it does not independently certify integration.",
      });
  });
const schema = z
  .object({
    id: z.string().min(2).max(80),
    name: z.string().max(150),
    type: z.enum(["http_json", "mcp"]),
    url: z.url(),
    allowedOrigin: z.url(),
    credentialsEnv: z
      .string()
      .regex(/^NEXO_CONNECTOR_[A-Z0-9_]{1,80}$/)
      .optional(),
    allowedTools: z.array(z.string().max(150)).max(30).default([]),
    purpose: z.string().min(5).max(1000),
    license: z.string().max(1000),
    enabled: z.boolean().default(true),
    pollMs: z.number().int().min(30000).max(3600000).optional(),
    registry: registrySchema,
  })
  .strict();
export class Integrations {
  constructor(store, config) {
    Object.assign(this, { store, config });
    this.intake = new Intake(store, config);
  }
  async configure(actor, input, key) {
    role(actor, ["admin"]);
    const d = schema.parse(input);
    const u = new URL(d.url);
    check(
      !u.username && !u.password,
      "CONNECTOR_CREDENTIALS",
      "Use a dedicated server-side connector credential, never credentials in URLs.",
    );
    check(
      u.origin === d.allowedOrigin,
      "CONNECTOR_ORIGIN",
      "Approve the exact origin.",
    );
    check(
      u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(u.hostname)),
      "CONNECTOR_PROTOCOL",
      "Use HTTPS or a local laboratory service.",
    );
    check(
      !/\/api\/(control|credentials|inject|checkpoint|metrics|state)(\/|$)/.test(
        u.pathname,
      ),
      "OBSERVER_SCOPE",
      "Observer endpoints cannot be registered as platform inputs.",
    );
    return this.store.command(actor.org, key, d, async (tx) => {
      const previous = await tx.get(actor.org, "integration", d.id, false);
      const changedScope =
        previous && connectionScope(previous) !== connectionScope(d);
      const record = await tx.upsert(actor.org, "integration", d.id, {
        ...d,
        registryDeclaration: {
          by: actor.id,
          at: Date.now(),
          verification: "configuration_only",
          access: "read_only",
          notice:
            "Declared metadata is not independent validation or operational authority.",
        },
        processingLimits: {
          pageSize: PAGE_SIZE,
          maxRecords: MAX_RECORDS,
          maxBytes: MAX_BYTES,
          readsPerMinute: Math.min(
            1000,
            Math.max(1, this.config.integrationReadsPerMinute ?? 30),
          ),
          pagesPerPoll: Math.min(
            100,
            Math.max(1, this.config.integrationPagesPerPoll ?? 4),
          ),
        },
        configuredBy: actor.id,
        state: previous?.pending
          ? d.enabled && !changedScope
            ? "backlog"
            : "paused"
          : "configured",
        ...(changedScope ? { readLease: null } : {}),
        updatedAt: Date.now(),
      });
      await tx.audit(actor.org, actor.id, "integration.configured", d.id, {
        origin: d.allowedOrigin,
        type: d.type,
        purpose: d.purpose,
        registry: d.registry,
        registryVerification: "configuration_only",
      });
      return record;
    });
  }
  async read(org, id, { tool, arguments: args = {} } = {}) {
    const c = await this.store.get(org, "integration", id);
    check(
      c.enabled,
      "CONNECTOR_DISABLED",
      "This integration is disabled.",
      403,
    );
    if (c.notifyPending) {
      await this.notify(org, id);
      // A retry of the final page must finish its durable notification rather
      // than make a new source request after its cursor already committed.
      if (!c.pending)
        return this.store.get(org, "external", c.notifyPending.observation);
    }
    if (c.pending) {
      check(
        c.type !== "mcp" ||
          c.pending.requestHash === hash({ tool, arguments: args }),
        "CONNECTOR_BATCH_PENDING",
        "Finish the pending received batch with its original MCP tool and arguments before starting another read.",
        409,
      );
      return this.continue(org, id);
    }
    const lease = uid("integration-read"),
      scope = connectionScope(c),
      began = Date.now();
    const admitted = await this.store.transaction(async (tx) => {
      await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        org,
      ]);
      const current = await tx.get(org, "integration", id);
      check(
        current.enabled && connectionScope(current) === scope,
        "CONNECTOR_CHANGED",
        "The connector's approved scope changed before reading.",
        409,
      );
      if (current.pending || current.readLease?.until > began) return false;
      const budget = await tx.get(
        org,
        "integration_read_budget",
        "active",
        false,
      );
      const window = Math.floor(began / 60000),
        used = budget?.window === window ? budget.used : 0;
      const limit = Math.min(
        1000,
        Math.max(1, this.config.integrationReadsPerMinute ?? 30),
      );
      check(
        used < limit,
        "CONNECTOR_READ_BUDGET",
        "The organization's external read budget is exhausted. Pending received pages remain durable.",
        429,
      );
      await tx.upsert(org, "integration_read_budget", "active", {
        window,
        used: used + 1,
        limit,
      });
      await tx.upsert(org, "integration", id, {
        readLease: { id: lease, until: began + 30000, scope },
      });
      return true;
    });
    if (!admitted)
      return {
        id,
        state: "pending_read",
        notice:
          "An existing read or received batch is already active. No additional source request was made.",
      };
    const token = c.credentialsEnv ? process.env[c.credentialsEnv] : null;
    try {
      let data;
      if (c.type === "mcp") {
        check(
          c.allowedTools.includes(tool),
          "MCP_SCOPE",
          "Tool is outside the configured read scope.",
          403,
        );
        const client = new McpConnector({ ...c, token });
        try {
          await client.connect();
          data = await client.call(tool, args);
        } finally {
          await client.close().catch(() => {});
        }
      } else {
        const response = await fetch(c.url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        check(
          response.ok,
          "CONNECTOR_HTTP",
          `The source returned HTTP ${response.status}.`,
          502,
        );
        let bytes = 0;
        const parts = [];
        for await (const part of response.body) {
          bytes += part.byteLength;
          check(
            bytes <= MAX_BYTES,
            "CONNECTOR_SIZE",
            "The source response exceeds the configured byte limit.",
            413,
          );
          parts.push(part);
        }
        data = JSON.parse(Buffer.concat(parts).toString("utf8"));
      }
      check(
        data !== null && data !== undefined,
        "CONNECTOR_SCHEMA",
        "The source returned no usable record envelope; the read remains a visible failure.",
        502,
      );
      check(
        Buffer.byteLength(JSON.stringify(data)) <= MAX_BYTES,
        "CONNECTOR_SIZE",
        "The source response exceeds the configured byte limit.",
        413,
      );
      const items = entries(data);
      check(
        items.length <= MAX_RECORDS,
        "CONNECTOR_RECORD_LIMIT",
        "This received batch exceeds 10,000 records. Configure smaller source pages; nothing was marked processed.",
        413,
      );
      const observation = {
        id: uid("external"),
        connector: id,
        data,
        contentHash: hash(data),
        receivedAt: Date.now(),
        origin: c.allowedOrigin,
        license: c.license,
        untrustedContent: true,
        notPhysicalTruth: true,
      };
      await this.store.transaction(async (tx) => {
        await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
          org,
        ]);
        const current = await tx.get(org, "integration", id);
        check(
          current.enabled &&
            connectionScope(current) === scope &&
            current.readLease?.id === lease,
          "CONNECTOR_CHANGED",
          "The source permission or read lease changed while downloading. No batch was accepted.",
          409,
        );
        const ids = items.map((item) => entryId(id, item));
        const erased = await tx.getMany(org, "erased_source", ids);
        // Do not reintroduce original text into a new raw snapshot after erasure.
        const erasedOffsets = [],
          invalidOffsets = [];
        const sanitized = items.map((item, offset) => {
          if (
            item === null ||
            item === undefined ||
            !["string", "object"].includes(typeof item) ||
            (typeof item === "string" && !item.trim())
          ) {
            invalidOffsets.push(offset);
            return { invalidSourceRecord: true };
          }
          if (!erased.has(ids[offset])) return item;
          erasedOffsets.push(offset);
          return { sourceContentErased: true };
        });
        const pending = {
          observation: observation.id,
          offset: 0,
          total: items.length,
          scope,
          requestHash: hash({ tool, arguments: args }),
          pageSize: PAGE_SIZE,
        };
        await tx.put(
          org,
          "external",
          observation.id,
          {
            ...observation,
            data: replaceEntries(data, sanitized),
            sourceIds: ids,
            erasedOffsets,
            invalidOffsets,
            processing: {
              state: "pending",
              total: items.length,
              offset: 0,
              remaining: items.length,
              pageSize: PAGE_SIZE,
              acceptedVersions: 0,
              unchanged: 0,
              erased: 0,
              rejected: 0,
              request:
                c.type === "mcp"
                  ? { tool, arguments: args }
                  : { method: "GET", url: c.url },
            },
          },
          0,
        );
        await tx.upsert(org, "integration", id, {
          pending,
          readLease: null,
          state: "backlog",
          backlogRecords: items.length,
          lastDownloadedAt: Date.now(),
          contentHash: observation.contentHash,
          error: null,
        });
        await tx.audit(org, "connector", "integration.downloaded", id, {
          observation: observation.id,
          hash: observation.contentHash,
          totalRecords: items.length,
          pendingRecords: items.length,
        });
      });
      return await this.continue(org, id);
    } catch (e) {
      await this.store.transaction(async (tx) => {
        const current = await tx.get(org, "integration", id);
        if (
          connectionScope(current) === scope &&
          (!current.readLease || current.readLease.id === lease)
        )
          await tx.upsert(org, "integration", id, {
            state: "degraded",
            lastFailureAt: Date.now(),
            error: e.code ?? e.name,
            ...(current.readLease?.id === lease ? { readLease: null } : {}),
          });
      });
      throw e;
    }
  }
  async continue(org, id) {
    if ((await this.store.get(org, "integration", id)).notifyPending)
      await this.notify(org, id);
    const result = await this.store.transaction(async (tx) => {
      await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        org,
      ]);
      const c = await tx.get(org, "integration", id);
      check(
        c.enabled,
        "CONNECTOR_DISABLED",
        "This integration is disabled; its pending records remain durable.",
        403,
      );
      // Another caller may have registered a page between the initial read
      // and this transaction. Never replace that page's durable notification.
      if (c.notifyPending)
        return {
          observation: await tx.get(
            org,
            "external",
            c.notifyPending.observation,
          ),
          fresh: [],
          notify: true,
        };
      if (!c.pending)
        return {
          observation: {
            id,
            state: "no_pending_batch",
            notice: "No received records await processing.",
          },
          fresh: [],
        };
      check(
        c.pending.scope === connectionScope(c),
        "CONNECTOR_CHANGED",
        "The received batch belongs to an earlier approved scope. Restore that scope or review its retained backlog before continuing.",
        409,
      );
      const observation = await tx.get(org, "external", c.pending.observation);
      if (observation.state === "erased" || observation.erasure) {
        await tx.upsert(org, "integration", id, {
          pending: null,
          state: "attention",
          error: "CONNECTOR_SOURCE_ERASED",
          backlogRecords: 0,
          closedBatch: {
            observation: observation.id,
            state: "erased",
            unprocessedRecords: c.pending.total - c.pending.offset,
          },
        });
        return {
          observation: {
            id: observation.id,
            state: "erased",
            processing: {
              state: "cancelled_erasure",
              remaining: c.pending.total - c.pending.offset,
            },
          },
          fresh: [],
        };
      }
      const items = entries(observation.data),
        start = c.pending.offset,
        end = Math.min(start + PAGE_SIZE, c.pending.total);
      check(
        items.length === c.pending.total &&
          Number.isSafeInteger(start) &&
          start >= 0 &&
          start <= items.length,
        "CONNECTOR_CURSOR",
        "The durable received batch or cursor is inconsistent. Review it instead of silently dropping records.",
        409,
      );
      const erasedOffsets = new Set(observation.erasedOffsets ?? []),
        invalidOffsets = new Set(observation.invalidOffsets ?? []),
        fresh = [];
      let unchanged = 0,
        erased = 0,
        rejected = 0;
      for (let offset = start; offset < end; offset++) {
        const item = items[offset],
          sourceId = observation.sourceIds[offset];
        if (invalidOffsets.has(offset)) {
          rejected++;
          continue;
        }
        if (
          erasedOffsets.has(offset) ||
          (await tx.get(org, "erased_source", sourceId, false))
        ) {
          erased++;
          continue;
        }
        const previous = await tx.get(org, "signal", sourceId, false),
          contentHash = hash(item);
        if (previous?.contentHash === contentHash) {
          unchanged++;
          continue;
        }
        const text = typeof item === "string" ? item : JSON.stringify(item);
        const row = await tx.upsert(org, "signal", sourceId, {
          text: text.slice(0, 18000),
          source: c.name,
          sourceUrl: c.url,
          sourceVersion: (previous?.sourceVersion ?? 0) + 1,
          contentHash,
          receivedAt: Date.now(),
          state: "unverified",
          group: hash(item),
          modality: "structured",
          publishedAt: item?.created_at ?? item?.date ?? null,
          permissions: "organization",
          external: true,
          originalReferences: [observation.id],
          sourceTextTruncated: text.length > 18000,
          pendingOriginalObservation:
            text.length > 18000 ? observation.id : null,
        });
        fresh.push(row);
        await tx.upsert(
          org,
          "source_version",
          `${sourceId}_${row.sourceVersion}`,
          { snapshot: row, contentHash, sourceVersion: row.sourceVersion },
        );
        await this.intake.stage(org, row, tx);
        if (previous)
          await tx.enqueue(
            org,
            "invalidate",
            {
              dependency: sourceId,
              reason: "An external source supplied a revised observation",
            },
            `external_change_${sourceId}_${row.sourceVersion}`,
          );
      }
      const totalRejected = (observation.processing.rejected ?? 0) + rejected;
      const processing = {
        ...observation.processing,
        state:
          end === items.length
            ? totalRejected
              ? "registered_with_attention"
              : "registered_unverified"
            : "pending",
        offset: end,
        remaining: items.length - end,
        acceptedVersions:
          (observation.processing.acceptedVersions ?? 0) + fresh.length,
        unchanged: (observation.processing.unchanged ?? 0) + unchanged,
        erased: (observation.processing.erased ?? 0) + erased,
        rejected: totalRejected,
      };
      const saved = await tx.put(
        org,
        "external",
        observation.id,
        { ...observation, processing },
        observation.version,
      );
      await tx.upsert(org, "integration", id, {
        pending: end === items.length ? null : { ...c.pending, offset: end },
        state:
          end === items.length
            ? totalRejected
              ? "attention"
              : "connected"
            : "backlog",
        backlogRecords: items.length - end,
        notifyPending: fresh.length
          ? {
              id: uid("external-page"),
              observation: observation.id,
              scope: c.pending.scope,
              versions: fresh.map((r) => [r.id, r.sourceVersion]),
            }
          : null,
        lastPageAt: Date.now(),
        ...(end === items.length ? { lastSuccessAt: Date.now() } : {}),
        error: totalRejected ? "CONNECTOR_INVALID_RECORDS" : null,
      });
      await tx.audit(org, "connector", "integration.page_registered", id, {
        observation: observation.id,
        start,
        end,
        totalRecords: items.length,
        acceptedVersions: fresh.length,
        unchanged,
        erased,
        rejected,
        pendingRecords: items.length - end,
      });
      return { observation: saved, fresh };
    });
    if (result.fresh.length || result.notify) await this.notify(org, id);
    return result.observation;
  }
  async notify(org, id) {
    const c = await this.store.get(org, "integration", id),
      pending = c.notifyPending;
    if (!pending) return;
    check(
      c.enabled && connectionScope(c) === pending.scope,
      "CONNECTOR_CHANGED",
      "The received page's downstream notification is paused by its connector scope.",
      409,
    );
    const records = await this.store.getMany(
      org,
      "signal",
      pending.versions.map(([id]) => id),
    );
    const rows = pending.versions
      .map(([id, version]) => records.get(id))
      .filter(
        (r, i) =>
          r &&
          r.sourceVersion === pending.versions[i][1] &&
          r.state !== "erased",
      );
    try {
      if (this.afterRead && rows.length) await this.afterRead(rows);
      await this.store.transaction(async (tx) => {
        const current = await tx.get(org, "integration", id);
        if (current.notifyPending?.id !== pending.id) return;
        check(
          current.enabled && connectionScope(current) === pending.scope,
          "CONNECTOR_CHANGED",
          "The received page's downstream notification remains pending after a permission change.",
          409,
        );
        const observation = await tx.get(org, "external", pending.observation);
        const rejected = observation.processing?.rejected ?? 0;
        await tx.upsert(org, "integration", id, {
          notifyPending: null,
          state: current.pending
            ? "backlog"
            : rejected
              ? "attention"
              : "connected",
          error: rejected ? "CONNECTOR_INVALID_RECORDS" : null,
          downstreamState: "durable_intake",
          lastDownstreamError: null,
          lastNotificationAt: Date.now(),
        });
      });
    } catch (error) {
      await this.store.transaction(async (tx) => {
        const current = await tx.get(org, "integration", id);
        if (current.notifyPending?.id === pending.id)
          await tx.upsert(org, "integration", id, {
            ...(current.enabled && connectionScope(current) === pending.scope
              ? { state: "degraded" }
              : {}),
            error: "CONNECTOR_DOWNSTREAM_PENDING",
            downstreamState: "pending_retry",
            lastDownstreamError: error.code ?? error.name,
            lastFailureAt: Date.now(),
          });
      });
      throw error;
    }
  }
  async pollDue() {
    const now = Date.now(),
      limit = Math.min(
        100,
        Math.max(1, this.config.integrationPagesPerPoll ?? 4),
      );
    let pages = 0;
    const connectors = (
      await this.store.list(this.config.org, "integration", 100)
    ).sort(
      (a, b) =>
        Number(Boolean(b.pending || b.notifyPending)) -
          Number(Boolean(a.pending || a.notifyPending)) ||
        (a.lastPageAt ?? 0) - (b.lastPageAt ?? 0),
    );
    for (const c of connectors) {
      if (pages >= limit) break;
      if (
        c.enabled &&
        (c.pending ||
          c.notifyPending ||
          (c.pollMs &&
            now - Math.max(c.lastSuccessAt ?? 0, c.lastFailureAt ?? 0) >=
              c.pollMs))
      ) {
        pages++;
        if (c.pending || c.notifyPending) {
          await this.continue(this.config.org, c.id).catch(async (error) => {
            await this.store.upsert(this.config.org, "integration", c.id, {
              state: "degraded",
              error: error.code ?? error.name,
              lastFailureAt: Date.now(),
            });
          });
          continue;
        }
        if (c.type === "mcp") continue;
        await this.read(this.config.org, c.id).catch(() => {});
      }
    }
    return { pages, pageLimit: limit, pageSize: PAGE_SIZE };
  }
}
