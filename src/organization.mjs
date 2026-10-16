import { z } from "zod";
import { role, check } from "./errors.mjs";
import { publicText } from "./public-safety.mjs";
export const portalSchema = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(3).max(400),
  communityTitle: z.string().trim().min(3).max(100),
  communityDescription: z.string().trim().min(3).max(400),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bannerDataUrl: z.string().max(450000).default(""),
  bannerAlt: z.string().trim().max(160).default(""),
}).strict();
export function defaultPortal(name = "Response team") {
  return {
    title: name.length > 72 ? name.slice(0, 100) : `${name}: help where it matters`,
    description: `Follow ${name}'s response, see what is needed and support the next step. Updates are reviewed by our team.`,
    communityTitle: "Tell us what is needed",
    communityDescription: `Send a need to ${name}. Our team reviews reports and shares progress through your private tracking reference.`,
    accent: "#2458e5",
    bannerDataUrl: "",
    bannerAlt: "",
  };
}
function validatePortal(value) {
  const p = portalSchema.parse(value);
  publicText(p.title, p.description, p.communityTitle, p.communityDescription, p.bannerAlt);
  if (p.bannerDataUrl) {
    const match = p.bannerDataUrl.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
    check(match, "PORTAL_BANNER", "Choose a PNG or JPEG banner.");
    const bytes = Buffer.from(match[2], "base64");
    check(bytes.length <= 300000, "PORTAL_BANNER", "Resize the banner to 300 KB or less.");
    const valid = match[1] === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    check(valid, "PORTAL_BANNER", "The image content must match its file type.");
  }
  return p;
}
const profile = z
  .object({
    name: z.string().min(3).max(120),
    response: z.string().min(3).max(160),
    zones: z.array(z.string().min(1).max(160)).max(30),
    coordinator: z.string().min(3).max(120),
    retentionDays: z.number().int().min(1).max(3650),
    version: z.number().int().min(0),
    portal: portalSchema.optional(),
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
    const p = saved ?? {
        id: "active",
        version: 0,
        name: ({ ReliefNorth: "Relief North", CommunityEast: "Community East", RescueSouth: "Rescue South", MedicalWest: "Medical West" })[this.config.orgName] ?? this.config.orgName ?? "Response team",
        response: "Disaster response",
        coordinator: "Not assigned",
        zones: [],
        retentionDays: 30,
      };
    return { ...p, portal: { ...defaultPortal(p.name), ...p.portal } };
  }
  async publicProfile(org) {
    const p = await this.read(org);
    return { id: org, name: p.name, response: p.response, portal: p.portal };
  }
  async configure(actor, input, key) {
    role(actor, ["admin", "commander"]);
    const data = profile.parse(input);
    if (data.portal) data.portal = validatePortal(data.portal);
    return this.store.command(actor.org, key, data, async (tx) => {
      const previous = await tx.get(actor.org, "organization_profile", "active", false);
      const saved = await tx.put(
        actor.org,
        "organization_profile",
        "active",
        {
          ...data,
          portal: data.portal ?? previous?.portal ?? defaultPortal(data.name),
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
