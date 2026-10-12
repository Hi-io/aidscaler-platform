import { z } from "zod";
import { check, role } from "./errors.mjs";
import { claimSchema } from "./contracts.mjs";
import { resolveEvidence } from "./citations.mjs";
import { uid } from "./store.mjs";
const HUMAN = ["analyst", "commander", "dispatcher"];
const membersSchema = z.array(z.string().min(1).max(180)).min(1).max(60);
const reasonSchema = z.string().min(3).max(600);

/** Evidence classification is reversible. It never merges physical demand,
 * rewrites a source, cancels a truck or grants execution authority. */
export class Casework {
  constructor(store, domain) {
    Object.assign(this, { store, domain });
  }
  async members(tx, org, members) {
    const ids = [...new Set(membersSchema.parse(members))],
      snapshots = [];
    for (const id of ids) {
      const evidence = await resolveEvidence(tx, org, id);
      check(
        evidence && evidence.kind !== "evidence_group",
        "GROUP_EVIDENCE",
        "Each member must be accessible original evidence, not another group.",
      );
      snapshots.push({
        id,
        kind: evidence.kind,
        version: evidence.record.version,
      });
    }
    return { members: ids, snapshots };
  }
  async group(actor, input, key) {
    role(actor, HUMAN);
    const reason = reasonSchema.parse(input.reason);
    check(
      typeof input.label === "string" &&
        input.label.length >= 3 &&
        input.label.length <= 160,
      "GROUP_LABEL",
      "Give this evidence group a concise label.",
    );
    return this.store.command(actor.org, key, input, async (tx) => {
      const validated = await this.members(tx, actor.org, input.members),
        id = input.id ?? uid("group");
      const old = input.id
        ? await tx.get(actor.org, "evidence_group", id)
        : null;
      if (old) {
        check(
          old.state === "active" && old.version === input.version,
          "GROUP_VERSION",
          "Review the current evidence grouping.",
          409,
        );
        await tx.put(
          actor.org,
          "group_history",
          id + "_" + old.version,
          { snapshot: old, actor: actor.id, reason },
          0,
        );
      }
      const r = await tx.put(
        actor.org,
        "evidence_group",
        id,
        {
          ...old,
          ...validated,
          label: input.label,
          reason,
          state: "active",
          classifiedBy: actor.id,
          classifiedAt: Date.now(),
          physicalDemandChanged: false,
        },
        old?.version ?? 0,
      );
      if (old)
        await this.domain.invalidateTx(
          tx,
          actor.org,
          id,
          "The evidence grouping changed; review its current sources",
        );
      await tx.audit(
        actor.org,
        actor.id,
        old ? "evidence_group.revised" : "evidence_group.created",
        id,
        { reason, members: r.members },
      );
      return r;
    });
  }
  async split(actor, input, key) {
    role(actor, HUMAN);
    const reason = reasonSchema.parse(input.reason);
    check(
      Array.isArray(input.partitions) &&
        input.partitions.length >= 2 &&
        input.partitions.length <= 6,
      "GROUP_PARTITIONS",
      "Split into two to six explicitly labeled groups.",
    );
    return this.store.command(actor.org, key, input, async (tx) => {
      const old = await tx.get(actor.org, "evidence_group", input.id);
      check(
        old.version === input.version && old.state === "active",
        "GROUP_VERSION",
        "Review the current evidence grouping.",
        409,
      );
      const flat = input.partitions.flatMap((p) =>
        membersSchema.parse(p.members),
      );
      check(
        new Set(flat).size === flat.length &&
          flat.length === old.members.length &&
          flat.every((id) => old.members.includes(id)),
        "GROUP_PARTITION_SCOPE",
        "Every original member must appear exactly once; no evidence is dropped or invented.",
      );
      const children = [];
      for (const p of input.partitions) {
        check(
          typeof p.label === "string" &&
            p.label.length >= 3 &&
            p.label.length <= 160,
          "GROUP_LABEL",
          "Give each group a concise label.",
        );
        const v = await this.members(tx, actor.org, p.members),
          id = uid("group");
        children.push(
          await tx.put(
            actor.org,
            "evidence_group",
            id,
            {
              ...v,
              label: p.label,
              reason,
              parent: old.id,
              state: "active",
              classifiedBy: actor.id,
              classifiedAt: Date.now(),
              physicalDemandChanged: false,
            },
            0,
          ),
        );
      }
      await tx.put(
        actor.org,
        "group_history",
        old.id + "_" + old.version,
        { snapshot: old, actor: actor.id, reason },
        0,
      );
      await tx.put(
        actor.org,
        "evidence_group",
        old.id,
        { ...old, state: "split", children: children.map((r) => r.id), reason },
        old.version,
      );
      await this.domain.invalidateTx(
        tx,
        actor.org,
        old.id,
        "Evidence was separated into distinct incidents",
      );
      await tx.audit(actor.org, actor.id, "evidence_group.split", old.id, {
        reason,
        children: children.map((r) => r.id),
      });
      return children;
    });
  }
  async restoreGrouping(actor, input, key) {
    role(actor, HUMAN);
    const historical = await this.store.get(
      actor.org,
      "group_history",
      input.id + "_" + input.historyVersion,
    );
    const current = await this.store.get(actor.org, "evidence_group", input.id);
    check(
      current.state === "active",
      "GROUP_STATE",
      "A split grouping stays historical. Create a new explicit group from its members if they belong together.",
      409,
    );
    return this.group(
      actor,
      {
        id: current.id,
        version: input.version,
        label: historical.snapshot.label,
        members: historical.snapshot.members,
        reason: input.reason,
      },
      key,
    );
  }
  async correctClaim(actor, input, key) {
    role(actor, HUMAN);
    const reason = reasonSchema.parse(input.reason);
    return this.store.command(actor.org, key, input, async (tx) => {
      const old = await tx.get(actor.org, "claim", input.id);
      check(
        old.version === input.version,
        "CLAIM_VERSION",
        "Review the current claim before correcting it.",
        409,
      );
      const next = claimSchema.parse({
        text: input.text ?? old.text,
        references: input.references ?? old.references,
        state: input.state ?? old.state,
        location: input.location ?? old.location,
        validUntil: input.validUntil ?? old.validUntil,
        contradicts: input.contradicts ?? old.contradicts,
        sourceRelations: input.sourceRelations ?? old.sourceRelations,
      });
      for (const id of [
        ...next.references,
        ...next.contradicts,
        ...next.sourceRelations.map((r) => r.id),
      ])
        check(
          id !== old.id && (await resolveEvidence(tx, actor.org, id)),
          "CLAIM_EVIDENCE",
          "Cite accessible independent evidence rather than this claim itself.",
        );
      await tx.put(
        actor.org,
        "claim_history",
        old.id + "_" + old.version,
        { snapshot: old, changedBy: actor.id, reason },
        0,
      );
      const r = await tx.put(
        actor.org,
        "claim",
        old.id,
        {
          ...old,
          ...next,
          correctedBy: actor.id,
          correctedAt: Date.now(),
          correctionReason: reason,
        },
        old.version,
      );
      await this.domain.invalidateTx(
        tx,
        actor.org,
        old.id,
        "A cited claim changed: " + reason,
      );
      await tx.audit(actor.org, actor.id, "claim.corrected", old.id, {
        from: old.version,
        to: r.version,
        state: r.state,
        reason,
      });
      return r;
    });
  }
}
