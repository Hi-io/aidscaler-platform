import { z } from "zod";
import { role, check } from "./errors.mjs";
const profile = z
  .object({
    name: z.string().min(3).max(120),
    response: z.string().min(3).max(160),
    zones: z.array(z.string().min(1).max(160)).max(30),
    coordinator: z.string().min(3).max(120),
    retentionDays: z.number().int().min(1).max(3650),
    version: z.number().int().min(0),
  })
  .strict();
export class Organization {
  constructor(store, config) {
    Object.assign(this, { store, config });
  }
  async read(org) {
    const saved = await this.store.get(
      org,
      "organization_profile",
      "active",
      false,
    );
    return (
      saved ?? {
        id: "active",
        version: 0,
        name: this.config.orgName,
        response: "Disaster response",
        coordinator: "Not assigned",
        zones: [],
        retentionDays: 30,
      }
    );
  }
  async configure(actor, input, key) {
    role(actor, ["admin", "commander"]);
    const data = profile.parse(input);
    return this.store.command(actor.org, key, data, async (tx) => {
      const saved = await tx.put(
        actor.org,
        "organization_profile",
        "active",
        {
          ...data,
          changedBy: actor.id,
          changedAt: Date.now(),
          retentionMode:
            "documented manual review; original source deletion requires explicit procedure",
        },
        input.version,
      );
      await tx.query(
        "UPDATE organizations SET name=$2,revision=revision+1 WHERE id=$1",
        [actor.org, data.name],
      );
      await tx.audit(actor.org, actor.id, "organization.configured", "active", {
        version: saved.version,
        coordinator: data.coordinator,
      });
      return saved;
    });
  }
  async export(actor, { kind, offset = 0 }) {
    role(actor, ["admin", "commander", "auditor"]);
    check(
      [
        "signal",
        "claim",
        "proposal",
        "operation",
        "resource",
        "report",
        "publication",
        "commitment",
        "task",
        "audit",
      ].includes(kind),
      "EXPORT_KIND",
      "Choose a supported organization record type.",
    );
    check(
      Number.isSafeInteger(offset) && offset >= 0 && offset <= 10000000,
      "EXPORT_OFFSET",
      "Use a valid export page offset.",
    );
    const limit = 200,
      rows =
        kind === "audit"
          ? (
              await this.store.query(
                "SELECT sequence,actor,action,entity,detail,occurred_at,previous_hash,hash FROM audit WHERE org=$1 ORDER BY sequence LIMIT $2 OFFSET $3",
                [actor.org, limit, offset],
              )
            ).rows
          : (
              await this.store.query(
                "SELECT id,version,data,created_at,updated_at FROM entities WHERE org=$1 AND kind=$2 ORDER BY id LIMIT $3 OFFSET $4",
                [actor.org, kind, limit, offset],
              )
            ).rows;
    await this.store.audit(actor.org, actor.id, "organization.exported", kind, {
      offset,
      count: rows.length,
    });
    return {
      organization: actor.org,
      kind,
      offset,
      nextOffset: rows.length === limit ? offset + limit : null,
      rows,
      privacy:
        "Private organizational export. No session, password, provider credential or observer world is included.",
    };
  }
}
