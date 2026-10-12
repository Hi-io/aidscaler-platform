import { createHmac, timingSafeEqual } from "node:crypto";
import { check, role } from "./errors.mjs";
import { recordResponseReceipt } from "./response-receipts.mjs";
import { recordAssessmentReceipt } from "./assessment-receipts.mjs";
import { uid, hash } from "./store.mjs";
import { actionSchema } from "./contracts.mjs";
import { Domain } from "./domain.mjs";
export const sign = (key, payload) =>
  createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex");
const vehicleProjection = (row, owner) =>
  Object.fromEntries(
    Object.entries({
      id: row.id,
      owner,
      node: row.node,
      state: row.state,
      capacity: row.capacity,
      weightKg: row.weightKg,
      speedMps: row.speedMps,
      maxCargoKg: row.maxCargoKg,
      volumeM3: row.volumeM3,
      seats: row.seats,
      fuelMlPerKm: row.fuelMlPerKm,
      maxWaterDepth: row.maxWaterDepth,
      shiftEnd: row.shiftEnd,
      fuel: row.fuel,
      at: row.at,
    }).filter(([, v]) => v !== undefined),
  );
export class Network {
  constructor(store, config, fetcher = fetch) {
    Object.assign(this, { store, config, fetcher });
  }
  async share(actor, { kind, id, to, version, revoke = false }, key) {
    role(actor, ["commander", "dispatcher"]);
    const peer = this.config.peers.find((p) => p.org === to);
    check(peer, "PEER", "This organization is not a connected partner.");
    check(
      [
        "resource",
        "claim",
        "commitment",
        "operation",
        "facility",
        "vehicle",
      ].includes(kind),
      "SHARING_SCOPE",
      "This record type cannot be shared.",
    );
    return this.store.command(
      actor.org,
      key,
      { kind, id, to, version, revoke },
      async (tx) => {
        const record = await tx.get(actor.org, kind, id);
        if (["resource", "vehicle"].includes(kind))
          check(record.owner === actor.org, "OWNER", "Only the actual owner may publish inventory or transport capacity. Observed partner stock cannot be rebranded as local capacity.", 403);
        check(
          record.version === version,
          "VERSION_CONFLICT",
          "Record changed.",
          409,
        );
        const permissionId = `${kind}_${id}_${to}`,
          prior = await tx.get(actor.org, "permission", permissionId, false),
          permissionVersion = (prior?.permissionVersion ?? 0) + 1;
        await tx.upsert(actor.org, "permission", permissionId, {
          kind,
          recordId: id,
          to,
          active: !revoke,
          permissionVersion,
          actorId: actor.id,
          expiresAt: Date.now() + 86400000,
          lastSharedVersion: record.version,
        });
        // Explicit public offer projection excludes confidential source text and victim locations.
        const projection = revoke
          ? null
          : kind === "resource"
            ? {
                id: record.id,
                type: record.type,
                available: Math.max(
                  0,
                  record.quantity - record.reserved - record.floor,
                ),
                unit: record.unit,
                node: record.node,
                compatibility: record.compatibility,
                qualifications: record.qualifications,
                owner: actor.org,
                sourceVersion: record.version,
              }
            : kind === "claim"
              ? {
                  id: record.id,
                  text: record.text,
                  state: record.state,
                  references: record.references,
                  owner: actor.org,
                }
              : kind === "commitment"
                ? {
                    id: record.id,
                    resource: record.resource,
                    quantity: record.quantity,
                    state: record.state,
                    expiresAt: record.expiresAt,
                    requester: record.requester,
                    owner: actor.org,
                  }
                : kind === "vehicle"
                  ? vehicleProjection(record, actor.org)
                  : {
                      id: record.id,
                      state: record.state,
                      type: record.type,
                      owner: actor.org,
                    };
        const message = {
          id: uid("message"),
          from: actor.org,
          to,
          kind,
          entityId: id,
          version: record.version,
          permissionVersion,
          permissionId,
          at: Date.now(),
          expiresAt: Date.now() + 86400000,
          projection,
          revoke,
        };
        await tx.enqueue(
          actor.org,
          "peer_send",
          { to, message },
          "send_" + message.id,
        );
        await tx.audit(
          actor.org,
          actor.id,
          revoke ? "network.revoked" : "network.shared",
          id,
          { to, kind, permissionVersion },
        );
        return { queued: true, messageId: message.id };
      },
    );
  }
  async send({ to, message }) {
    const peer = this.config.peers.find((p) => p.org === to);
    check(peer, "PEER", "Partner connection is unavailable.");
    const envelope = { message, sentAt: Date.now() };
    const response = await this.fetcher(peer.url + "/api/network/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NEXO-From": this.config.org,
        "X-NEXO-Signature": sign(peer.key, envelope),
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(10000),
    });
    check(
      response.ok,
      "PEER_HTTP",
      `Partner returned HTTP ${response.status}.`,
      502,
    );
    return response.json();
  }
  async refresh() {
    const org = this.config.org;
    for (const offer of await this.store.list(org, "peer_offer", 2000))
      if (offer.active && offer.expiresAt <= Date.now()) {
        await this.store.upsert(org, "peer_offer", offer.id, {
          active: false,
          state: "expired",
        });
        await this.store.enqueue(
          org,
          "invalidate",
          { dependency: offer.id, reason: "Partner offer expired" },
          "expired_" + offer.id + "_" + offer.sourceVersion,
        );
      }
    for (const permission of await this.store.list(org, "permission", 2000)) {
      if (!permission.active || permission.expiresAt <= Date.now()) continue;
      const row = await this.store.get(
        org,
        permission.kind,
        permission.recordId,
        false,
      );
      if (!row || row.owner !== org || row.version === permission.lastSharedVersion) continue;
      let projection;
      if (permission.kind === "resource")
        projection = {
          id: row.id,
          owner: org,
          type: row.type,
          node: row.node,
          available: Math.max(0, row.quantity - row.reserved - row.floor),
          compatibility: row.compatibility,
          qualifications: row.qualifications,
          unit: row.unit,
        };
      else if (permission.kind === "vehicle")
        projection = vehicleProjection(row, org);
      else continue;
      const message = {
        id: uid("message"),
        from: org,
        to: permission.to,
        kind: permission.kind,
        entityId: row.id,
        version: row.version,
        permissionVersion: permission.permissionVersion,
        permissionId: permission.id,
        at: Date.now(),
        expiresAt: permission.expiresAt,
        projection,
        revoke: false,
      };
      await this.store.transaction(async (tx) => {
        await tx.enqueue(
          org,
          "peer_send",
          { to: permission.to, message },
          "send_" + message.id,
        );
        await tx.upsert(org, "permission", permission.id, {
          lastSharedVersion: row.version,
        });
      });
    }
  }
  async requestStep(proposal, index) {
    const action = proposal.actions[index],
      id = `work_${proposal.id}_${index}`;
    check(
      proposal.authorization,
      "OWNER_AUTHORITY",
      "A response request needs a human-owned originating decision.",
      403,
    );
    const targetNeed = action.params.need
      ? await this.store.get(this.config.org, "need", action.params.need, false)
      : null;
    const message = {
      id,
      from: this.config.org,
      to: action.owner,
      kind: "response_request",
      entityId: id,
      version: proposal.version,
      permissionVersion: 1,
      at: Date.now(),
      expiresAt: Date.now() + 86400000,
      projection: {
        title: proposal.title,
        summary: proposal.summary,
        benefit: proposal.benefit,
        rationale: proposal.rationale,
        action: { ...action, dependsOn: [] },
        originProposal: proposal.id,
        originStep: index,
        originSourceProposal: proposal.simId ?? null,
        requestedBy: proposal.authorization.by,
        targetNeed: targetNeed
          ? {
              id: targetNeed.id,
              building: targetNeed.building,
              node: targetNeed.node,
              type: targetNeed.type,
              quantity: targetNeed.quantity,
              served: targetNeed.served,
              unit: targetNeed.unit,
              deadline: targetNeed.deadline,
              at: targetNeed.at,
            }
          : null,
      },
      revoke: false,
    };
    await this.store.enqueue(
      this.config.org,
      "peer_send",
      { to: action.owner, message },
      "send_" + id,
    );
    return { id, state: "awaiting_partner" };
  }
  async response(proposal, state, result = {}) {
    if (!proposal.originPartner) return;
    const id = `receipt_${proposal.id}_${state}_${hash(result).slice(0, 16)}`;
    const message = {
      id,
      from: this.config.org,
      to: proposal.originPartner,
      kind: "response_receipt",
      entityId: `work_${proposal.originProposal}_${proposal.originStep}`,
      version: proposal.version,
      permissionVersion: 1,
      at: Date.now(),
      expiresAt: Date.now() + 86400000,
      revoke: false,
      projection: {
        originProposal: proposal.originProposal,
        originStep: proposal.originStep,
        state,
        operation: result,
        owner: this.config.org,
      },
    };
    await this.store.enqueue(
      this.config.org,
      "peer_send",
      { to: proposal.originPartner, message },
      "send_" + id,
    );
  }
  async receive(from, signature, envelope) {
    const peer = this.config.peers.find((p) => p.org === from);
    check(
      peer && typeof signature === "string",
      "PEER_AUTH",
      "Partner authentication failed.",
      401,
    );
    const expected = Buffer.from(sign(peer.key, envelope)),
      actual = Buffer.from(signature);
    check(
      actual.length === expected.length && timingSafeEqual(actual, expected),
      "PEER_AUTH",
      "Partner authentication failed.",
      401,
    );
    const m = envelope.message;
    check(
      m &&
        typeof m.id === "string" &&
        m.id.length <= 240 &&
        Number.isSafeInteger(m.version) &&
        Number.isSafeInteger(m.permissionVersion),
      "PEER_SCHEMA",
      "A versioned message ID is required.",
    );
    check(
      m.from === from &&
        m.to === this.config.org &&
        Math.abs(Date.now() - envelope.sentAt) < 60000 &&
        m.expiresAt > Date.now(),
      "PEER_WINDOW",
      "Message is expired or addressed incorrectly.",
      403,
    );
    return this.store.transaction(async (tx) => {
      const seen = (
        await tx.query(
          "SELECT message_id FROM inbox WHERE org=$1 AND message_id=$2",
          [this.config.org, m.id],
        )
      ).rows.length;
      if (seen) return { duplicate: true };
      await tx.query(
        "INSERT INTO inbox(org,message_id,sender,received_at) VALUES($1,$2,$3,$4)",
        [this.config.org, m.id, from, Date.now()],
      );
      const id = `${from}_${m.kind}_${m.entityId}`,
        old = await tx.get(this.config.org, "peer_offer", id, false);
      if (old && m.permissionVersion < old.permissionVersion)
        return { stale: true };
      if (
        old &&
        m.permissionVersion === old.permissionVersion &&
        m.version < old.sourceVersion
      )
        return { stale: true };
      check(
        [
          "resource",
          "claim",
          "commitment",
          "operation",
          "facility",
          "vehicle",
          "response_request",
          "response_receipt",
        ].includes(m.kind),
        "PEER_SCHEMA",
        "Unsupported partner message.",
      );
      await tx.upsert(this.config.org, "peer_offer", id, {
        from,
        kind: m.kind,
        entityId: m.entityId,
        sourceVersion: m.version,
        permissionVersion: m.permissionVersion,
        projection: m.projection,
        active: !m.revoke,
        expiresAt: m.expiresAt,
        receivedAt: Date.now(),
      });
      if (m.kind === "response_request" && !m.revoke) {
        const p = m.projection;
        p.action = actionSchema.parse(p.action);
        check(
          p.action?.owner === this.config.org,
          "PEER_OWNER",
          "Partner cannot assign another owner through this instance.",
          403,
        );
        if (p.targetNeed && p.action.params.need === p.targetNeed.id) {
          check(
            typeof p.targetNeed.type === "string" &&
              Number.isFinite(p.targetNeed.quantity),
            "PEER_SCHEMA",
            "Invalid shared need.",
          );
          await tx.upsert(this.config.org, "need", p.targetNeed.id, {
            ...p.targetNeed,
            sharedBy: from,
            sourceEvidence: id,
          });
        }
        const existing = await tx.get(
          this.config.org,
          "proposal",
          "partner_" + m.entityId,
          false,
        );
        if (existing) return { accepted: true, existing: true };
        await tx.upsert(this.config.org, "proposal", "partner_" + m.entityId, {
          title: p.title,
          summary: p.summary,
          benefit: p.benefit,
          rationale: p.rationale,
          actions: [p.action],
          references: [id],
          conditions: [],
          alternatives: [],
          priority: "high",
          state: "awaiting_review",
          dependencies: [id],
          authorization: null,
          simId: null,
          createdBy: "peer:" + from,
          repairOf: null,
          originPartner: from,
          originProposal: p.originProposal,
          originStep: p.originStep,
          originSourceProposal: p.originSourceProposal ?? null,
        });
      }
      if (m.kind === "response_receipt" && !m.revoke) {
        const p = m.projection,
          proposal = await tx.get(
            this.config.org,
            "proposal",
            p.originProposal,
            false,
          );
        if (proposal) {
          const results = proposal.executionResults ?? [];
          const result = results.find((r) => r.index === p.originStep);
          if (result) {
            check(
              proposal.actions[p.originStep]?.owner === from &&
                result.requestId === m.entityId,
              "PEER_OWNER",
              "Receipt does not match a step assigned to this partner.",
              403,
            );
            check(
              [
                "authorized",
                "in_transit",
                "completed",
                "rejected",
                "failed",
              ].includes(p.state),
              "PEER_SCHEMA",
              "Invalid partner response state.",
            );
            if (p.state === "completed")
              check(
                p.operation?.confirmedBySource === true,
                "PEER_RECEIPT",
                "Completion requires the owner source receipt.",
              );
            const physical = await recordResponseReceipt(tx, this.config.org, from,
              proposal, p.originStep, p.state, p.operation);
            if (physical?.stale) return { accepted: true, stale: true };
            const assessment = await recordAssessmentReceipt(tx, this.config.org, from,
              proposal, p.originStep, p.state, p.operation);
            if (assessment?.stale) return { accepted: true, stale: true };
            result.state = p.state;
            result.partnerResult = p.operation;
            await tx.put(
              this.config.org,
              "proposal",
              proposal.id,
              {
                ...proposal,
                executionResults: results,
                ...(["failed", "rejected"].includes(p.state)
                  ? {
                      state: "requires_review",
                      authorization: null,
                      changedReason:
                        "A partner could not complete its part of the response",
                    }
                  : {}),
              },
              proposal.version,
            );
            if (p.state === "completed")
              await tx.enqueue(
                this.config.org,
                "continue_proposal",
                { id: proposal.id },
                "peer_continue_" + m.id,
              );
          }
        }
      }
      if (m.revoke) {
        const domain = new Domain(this.store, this.config);
        for (const dependency of [id, m.entityId])
          await domain.invalidateTx(
            tx,
            this.config.org,
            dependency,
            "Partner revoked a shared dependency",
          );
      } else if (old && ["resource", "vehicle"].includes(m.kind)) {
        // Expected consumption of a step already requested is not a reason to
        // cancel its response. Recheck only future, unissued work using an offer.
        for (const p of await tx.dependents(this.config.org, "proposal", id)) {
          if (["completed", "cancelled", "rejected"].includes(p.state))
            continue;
          const future = p.actions.filter(
            (a, index) =>
              a.owner === from &&
              a.params[m.kind] === m.entityId &&
              !p.executionResults?.some(
                (r) => r.index === index && (r.result || r.requestId),
              ),
          );
          const resourceLost =
            m.kind === "resource" &&
            future.length &&
            (future.reduce((s, a) => s + (a.params.quantity ?? 0), 0) >
              (m.projection?.available ?? 0) ||
              hash(old.projection?.compatibility ?? {}) !==
                hash(m.projection?.compatibility ?? {}));
          const vehicleLost =
            m.kind === "vehicle" &&
            future.length &&
            ["disabled", "broken", "retired", "failed"].includes(
              m.projection?.state,
            );
          if (resourceLost || vehicleLost)
            await tx.put(
              this.config.org,
              "proposal",
              p.id,
              {
                ...p,
                state: "requires_review",
                authorization: null,
                previousAuthorization:
                  p.authorization ?? p.previousAuthorization,
                changedReason:
                  "A partner's current capability no longer covers an unissued step",
                invalidatedDependency: id,
              },
              p.version,
            );
        }
      }
      await tx.audit(this.config.org, "peer:" + from, "network.received", id, {
        kind: m.kind,
        permissionVersion: m.permissionVersion,
        revoke: m.revoke,
      });
      return { accepted: true };
    });
  }
}
