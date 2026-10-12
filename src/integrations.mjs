import { z } from "zod";
import { role, check } from "./errors.mjs";
import { uid, hash } from "./store.mjs";
import { McpConnector } from "./mcp.mjs";
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
  })
  .strict();
export class Integrations {
  constructor(store, config) {
    Object.assign(this, { store, config });
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
      const record = await tx.upsert(actor.org, "integration", d.id, {
        ...d,
        configuredBy: actor.id,
        state: "configured",
        updatedAt: Date.now(),
      });
      await tx.audit(actor.org, actor.id, "integration.configured", d.id, {
        origin: d.allowedOrigin,
        type: d.type,
        purpose: d.purpose,
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
        const text = await response.text();
        check(
          text.length < 8_000_000,
          "CONNECTOR_SIZE",
          "The source response exceeds the configured limit.",
          413,
        );
        data = JSON.parse(text);
      }
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
      await this.store.put(org, "external", observation.id, observation, 0);
      await this.store.upsert(org, "integration", id, {
        state: "connected",
        lastSuccessAt: Date.now(),
        contentHash: observation.contentHash,
      });
      const candidate = Array.isArray(data)
        ? data
        : (data?.results ?? data?.data ?? [data]);
      const items = Array.isArray(candidate) ? candidate : [candidate];
      const fresh = [];
      for (const item of items.slice(0, 100)) {
        const entryId = id + "_" + hash(item.id ?? item).slice(0, 24);
        const previous = await this.store.get(org, "signal", entryId, false),
          contentHash = hash(item);
        if (previous?.contentHash === contentHash) continue;
        const row = await this.store.upsert(org, "signal", entryId, {
          text:
            typeof item === "string"
              ? item
              : JSON.stringify(item).slice(0, 18000),
          source: c.name,
          sourceUrl: c.url,
          sourceVersion: (previous?.sourceVersion ?? 0) + 1,
          contentHash,
          receivedAt: Date.now(),
          state: "unverified",
          group: hash(item),
          modality: "structured",
          publishedAt: item.created_at ?? item.date ?? null,
          permissions: "organization",
          external: true,
        });
        fresh.push(row);
        await this.store.upsert(
          org,
          "source_version",
          `${entryId}_${row.sourceVersion}`,
          { snapshot: row, contentHash, sourceVersion: row.sourceVersion },
        );
        if (previous)
          await this.store.enqueue(
            org,
            "invalidate",
            {
              dependency: entryId,
              reason: "An external source supplied a revised observation",
            },
            `external_change_${entryId}_${row.sourceVersion}`,
          );
      }
      await this.store.transaction((tx) =>
        tx.audit(org, "connector", "integration.read", id, {
          observation: observation.id,
          hash: observation.contentHash,
          items: items.length,
        }),
      );
      if (this.afterRead) await this.afterRead(fresh);
      return observation;
    } catch (e) {
      await this.store.upsert(org, "integration", id, {
        state: "degraded",
        lastFailureAt: Date.now(),
        error: e.code ?? e.name,
      });
      throw e;
    }
  }
  async pollDue() {
    const now = Date.now();
    for (const c of await this.store.list(this.config.org, "integration", 100))
      if (
        c.enabled &&
        c.pollMs &&
        now - Math.max(c.lastSuccessAt ?? 0, c.lastFailureAt ?? 0) >= c.pollMs
      ) {
        if (c.type === "mcp") continue;
        await this.read(this.config.org, c.id).catch(() => {});
      }
  }
}
