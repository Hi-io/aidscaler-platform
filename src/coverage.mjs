import { z } from "zod";
import { check, role } from "./errors.mjs";
import { hash, uid } from "./store.mjs";
import { authorizationCurrent } from "./authority.mjs";

const methods = z.enum(["clarification", "radio"]);
const policySchema = z.object({
  version: z.number().int().nonnegative(),
  placeIds: z.array(z.string().min(1).max(180)).min(1).max(200),
  staleAfterMs: z.number().int().min(60000).max(86400000),
  cooldownMs: z.number().int().min(60000).max(86400000).default(60000),
  maxWaitMs: z.number().int().min(60000).max(86400000).default(3600000),
  maxActive: z.number().int().min(1).max(5).default(2),
  maxPerBatch: z.number().int().min(1).max(5).default(5),
  allowedMethods: z.array(methods).min(1).max(2).default(["clarification"]),
  reason: z.string().min(5).max(500),
}).strict();
const requestSchema = z.object({
  policyVersion: z.number().int().positive(),
  coverageVersion: z.string().min(1).max(100),
  checks: z.array(z.object({
    building: z.string().min(1).max(180), method: methods,
    staff: z.string().min(1).max(180).optional(),
    vehicle: z.string().min(1).max(180).optional(),
  }).strict()).min(1).max(5),
}).strict();
const active = state => ["queued", "checking"].includes(state);
const snapshotSchema = z.object({ version: z.number().int().nonnegative(), observedAt: z.number().finite().nonnegative(),
  scope: z.literal("received"), contacts: z.array(z.object({ sector: z.string().min(1).max(180),
    lastContactAt: z.number().finite().nonnegative() }).strict()).max(5000),
  buildingContacts: z.array(z.object({ building: z.string().min(1).max(180), sector: z.string().min(1).max(180),
    lastContactAt: z.number().finite().nonnegative(), receivedAt: z.number().finite().nonnegative() }).strict()).max(10000).default([]) });
const directory = map => (map?.places ?? []).map(p => ({ id: p.id, node: p.node,
  sector: p.sector ?? null, name: p.name ?? p.id })).sort((a, b) => a.id.localeCompare(b.id));

/** A received contact gap is a reason to ask, never a need or a safety result.
 * Approval covers an exact finite batch. Durable requests resume after ingest;
 * source keys survive a rollback/restart without issuing a second inquiry. */
export class Coverage {
  constructor(store, connector, config) { Object.assign(this, { store, connector, config }); }
  async context(store = this.store) {
    const org = this.config.org;
    const recent = await store.list(org, "coverage_request", 1000), pendingIds = (await store.query(
      "SELECT id FROM entities WHERE org=$1 AND kind='coverage_request' AND data->>'state' IN ('queued','checking') ORDER BY created_at,id",
      [org])).rows.map(r => r.id), pending = await store.getMany(org, "coverage_request", pendingIds);
    return {
      map: (await store.get(org, "context", "geography", false))?.map,
      snapshot: (await store.get(org, "context", "operational", false))?.snapshot,
      policy: await store.get(org, "coverage_policy", "active", false),
      received: await store.get(org, "coverage_snapshot", "received", false),
      requests: [...new Map([...recent, ...pending.values()].map(r => [r.id, r])).values()],
      sourceStatus: await store.get(org, "coverage_status", "source", false),
    };
  }
  async summary(store = this.store) {
    const c = await this.context(store), places = directory(c.map), now = c.snapshot?.now;
    const rows = places.filter(p => !c.policy || c.policy.placeIds.includes(p.id)).map(p => {
      const tracked = new Map(c.requests.filter(r => r.sourceRunId === c.snapshot?.runId)
        .flatMap(r => r.checks).filter(k => k.inspection).map(k => [k.inspection, k.state]));
      const contact = c.received?.runId === c.snapshot?.runId ? c.received?.contacts?.find(r => r.sector === p.sector) : null,
        buildingContact = c.received?.runId === c.snapshot?.runId ? c.received.buildingContacts?.find(r => r.building === p.id) : null,
        exactChecks = (c.snapshot?.inspections ?? []).filter(i => i.org === this.config.org && i.target === "building" &&
          i.entity === p.id && i.state === "completed" && i.confirmedBySource === true && i.result?.id === p.id &&
          (!tracked.has(i.id) || tracked.get(i.id) === "contact_confirmed")),
        checks = c.requests.filter(r => r.sourceRunId === c.snapshot?.runId).flatMap(r => r.checks.map(k => ({ ...k, request: r.id }))).filter(k => k.building === p.id),
        completed = checks.filter(k => k.state === "contact_confirmed").map(k => k.observedAt),
        at = Math.max(-1, buildingContact?.lastContactAt ?? -1, ...exactChecks.map(i => i.observedAt ?? -1), ...completed),
        lastContactAt = Number.isFinite(now) && at >= 0 && at <= now ? at : null,
        pending = checks.find(k => active(k.state)),
        stale = lastContactAt !== null && now - lastContactAt >= (c.policy?.staleAfterMs ?? 1800000);
      return { ...p, lastContactAt, sectorLastContactAt: contact?.lastContactAt ?? null,
        state: pending ? "checking" : lastContactAt === null ? "unknown" : stale ? "stale" : "contact_confirmed",
        ...(pending ? { request: pending.request, inspection: pending.inspection ?? null,
          method: pending.method, queueState: pending.queueState ?? pending.state } : {}),
        attention: checks.filter(k => k.state === "requires_review").at(-1)?.reason ?? null };
    }).sort((a, b) => Number(a.lastContactAt !== null) - Number(b.lastContactAt !== null) ||
      (a.lastContactAt ?? -1) - (b.lastContactAt ?? -1) || a.id.localeCompare(b.id));
    return { policy: c.policy, directory: places, directoryVersion: hash(places),
      version: hash([hash(places), c.policy?.version ?? 0, rows.map(r => [r.id, r.lastContactAt, r.state, r.inspection, r.attention])]),
      rows, counts: Object.fromEntries(["unknown", "stale", "checking", "contact_confirmed"].map(s => [s, rows.filter(r => r.state === s).length])),
      requests: c.requests.map(r => ({ id: r.id, version: r.version, approvedBy: r.authorization?.by,
        checks: r.checks, state: r.state })),
      sourceError: c.sourceStatus?.error ?? null,
      note: "Contact coverage only. Silence never establishes safety or absence of need. Only separately received need observations can support aid." };
  }
  async configure(actor, input, key) {
    role(actor, ["commander"]); check(actor.org === this.config.org, "OWNER", "Coverage belongs to this organization.", 403);
    const data = policySchema.parse(input);
    check(new Set(data.placeIds).size === data.placeIds.length, "COVERAGE_SCOPE", "Choose unique received places.");
    return this.store.command(actor.org, key, data, async tx => {
      const c = await this.context(tx), known = new Set(directory(c.map).map(p => p.id));
      check(data.placeIds.every(id => known.has(id)), "COVERAGE_SCOPE", "Every place must be in the received public directory.");
      const saved = await tx.put(actor.org, "coverage_policy", "active", { ...data,
        approvedBy: actor.id, approvedAt: Date.now() }, data.version);
      await tx.audit(actor.org, actor.id, "coverage.policy_approved", saved.id, { version: saved.version, places: data.placeIds.length });
      return saved;
    });
  }
  async request(actor, input, key) {
    role(actor, ["commander", "dispatcher"]); check(actor.org === this.config.org, "OWNER", "Only this organization may request its checks.", 403);
    const data = requestSchema.parse(input);
    return this.store.command(actor.org, key, data, async tx => {
      const c = await this.context(tx), summary = await this.summary(tx);
      check(c.policy?.version === data.policyVersion && summary.version === data.coverageVersion,
        "COVERAGE_CHANGED", "Read the current directory and coverage before approving these checks.", 409);
      check(data.checks.length <= c.policy.maxPerBatch, "COVERAGE_QUOTA", "This batch exceeds its owner-approved limit.");
      check(Number.isFinite(c.snapshot?.now), "COVERAGE_CLOCK", "Receive the source clock before requesting contact.", 409);
      check(c.requests.flatMap(r => r.checks).filter(k => active(k.state)).length + data.checks.length <= 20,
        "COVERAGE_BACKLOG", "Resolve or cancel existing checks before approving more than twenty outstanding contacts.", 409);
      const identities = new Set();
      for (const k of data.checks) {
        check(c.policy.placeIds.includes(k.building) && directory(c.map).some(p => p.id === k.building),
          "COVERAGE_SCOPE", "This place is outside the owner-approved received directory.", 403);
        check(c.policy.allowedMethods.includes(k.method), "COVERAGE_CHANNEL", "The owner has not permitted this channel.", 403);
        const identity = k.building + ":" + k.method;
        check(!identities.has(identity), "COVERAGE_DUPLICATE", "Each target and channel can appear once."); identities.add(identity);
        const old = c.requests.filter(r => r.sourceRunId === c.snapshot.runId).flatMap(r => r.checks).filter(o => o.building === k.building && o.method === k.method);
        check(!old.some(o => active(o.state)), "COVERAGE_PENDING", "This target and channel already has a pending check.", 409);
        const prior = await tx.get(actor.org, "coverage_target", identity, false);
        check(!old.some(o => Number.isFinite(o.requestedAt) && c.snapshot.now - o.requestedAt < c.policy.cooldownMs) &&
          (!prior || prior.sourceRunId !== c.snapshot.runId || c.snapshot.now - prior.requestedAt >= c.policy.cooldownMs),
          "COVERAGE_COOLDOWN", "Review the existing check or wait for the declared cooldown.", 409);
        await this.validateChannel(tx, k);
        await tx.upsert(actor.org, "coverage_target", identity, { requestedAt: c.snapshot.now, sourceRunId: c.snapshot.runId });
      }
      const id = uid("coverage"), row = await tx.put(actor.org, "coverage_request", id, {
        state: "queued", directoryVersion: summary.directoryVersion, policyVersion: c.policy.version, sourceRunId: c.snapshot.runId,
        authorization: { by: actor.id, role: actor.role, expiresAt: Date.now() + 86400000 },
        checks: data.checks.map(k => ({ ...k, state: "queued", requestedAt: c.snapshot.now,
          waitUntil: c.snapshot.now + c.policy.maxWaitMs, attempts: 0, nextAttemptAt: c.snapshot.now })),
      }, 0);
      await tx.audit(actor.org, actor.id, "coverage.checks_approved", id, { checks: data.checks, policyVersion: c.policy.version });
      return row;
    });
  }
  async validateChannel(tx, k) {
    if (k.method === "clarification") {
      check(!k.staff && !k.vehicle, "COVERAGE_CHANNEL", "Clarification uses the finite contact queue, not a field crew."); return;
    }
    const org = this.config.org, staff = k.staff && await tx.get(org, "resource", k.staff, false),
      vehicle = k.vehicle && await tx.get(org, "vehicle", k.vehicle, false);
    check(staff?.owner === org && staff.type === "staff" && staff.quantity - (staff.reserved ?? 0) - (staff.floor ?? 0) >= 1 &&
      vehicle?.owner === org && ["idle", "arrived"].includes(vehicle.state) && vehicle.driverAvailable !== false && vehicle.seats >= 1,
      "COVERAGE_CREW", "A radio field check needs an explicitly selected available owned crew and vehicle.", 409);
  }
  async cancel(actor, id, version, key) {
    role(actor, ["commander", "dispatcher"]); check(actor.org === this.config.org, "OWNER", "This check belongs to another organization.", 403);
    return this.store.command(actor.org, key, { id, version }, async tx => {
      const r = await tx.get(actor.org, "coverage_request", id);
      const saved = await tx.put(actor.org, "coverage_request", id, { ...r, state: "cancelled",
        checks: r.checks.map(k => active(k.state) ? { ...k, state: "cancelled", reason: "Local follow-up stopped; issued source work is preserved." } : k) }, version);
      await tx.audit(actor.org, actor.id, "coverage.cancelled", id, { sourceReceiptsPreserved: true }); return saved;
    });
  }
  async sync() {
    const org = this.config.org, c = await this.context();
    if (!c.snapshot?.runId || !Number.isFinite(c.snapshot.now)) return;
    // One idempotent snapshot per received contact material; ordinary polls
    // cannot manufacture fresh geographic contact or churn material versions.
    const material = hash([c.snapshot.runId, c.snapshot.known?.sectorContacts ?? {}, c.snapshot.known?.buildingContacts ?? {}]);
    if (c.received?.material !== material) {
      try {
        const raw = await this.connector.action("coverage", {}, "coverage-snapshot-" + material), parsed = snapshotSchema.safeParse(raw);
        check(parsed.success, "COVERAGE_SCHEMA", "Contact metadata did not match the received coverage contract.", 409);
        const result = parsed.data;
        // The coverage request is a later source read than the operational
        // snapshot above. In a running world its observation may legitimately
        // be newer. Bound it to an actual subsequent scoped clock receipt,
        // never to local wall time or the coverage response's own timestamp.
        const canRefreshClock = typeof this.connector.state === "function",
          clock = canRefreshClock ? await this.connector.state() : c.snapshot;
        check((!canRefreshClock || clock?.organization?.id === org) &&
          clock?.runId === c.snapshot.runId && Number.isFinite(clock.now) && clock.now >= c.snapshot.now,
          "COVERAGE_SCHEMA", "The contact receipt's scoped source clock changed run, owner or moved backwards.", 409);
        check(result.observedAt <= clock.now && new Set(result.contacts.map(p => p.sector)).size === result.contacts.length &&
          result.contacts.every(p => p.lastContactAt <= result.observedAt) &&
          new Set(result.buildingContacts.map(p => p.building)).size === result.buildingContacts.length &&
          result.buildingContacts.every(p => p.lastContactAt <= p.receivedAt && p.receivedAt <= result.observedAt),
          "COVERAGE_SCHEMA", "Contact metadata is duplicated, future-dated or older than its prior source receipt.", 409);
        await this.store.transaction(async tx => {
          const current = (await tx.get(org, "context", "operational", false))?.snapshot,
            previous = await tx.get(org, "coverage_snapshot", "received", false);
          check(current?.runId === clock.runId && Number.isFinite(current.now) && current.now <= clock.now &&
            (!previous || previous.runId !== clock.runId || result.version >= previous.sourceVersion && result.observedAt >= previous.sourceObservedAt &&
              clock.now >= (previous.sourceClockAtReceipt ?? previous.sourceObservedAt)),
            "COVERAGE_SCHEMA", "Contact metadata or its source clock is older than the latest received evidence.", 409);
          await tx.upsert(org, "coverage_snapshot", "received", { contacts: result.contacts, buildingContacts: result.buildingContacts, scope: result.scope,
            sourceVersion: result.version, sourceObservedAt: result.observedAt, sourceClockAtReceipt: clock.now,
            runId: clock.runId, material });
          await tx.upsert(org, "coverage_status", "source", { error: null });
        });
      } catch (error) {
        // A snapshot error remains explicit without losing already-issued
        // verification receipts or claiming that unknown contacts succeeded.
        await this.store.upsert(org, "coverage_status", "source", { error: error.code ?? error.name });
      }
    }
    await this.store.transaction(async tx => {
      const current = await this.context(tx), now = current.snapshot.now;
      let inFlight = current.requests.flatMap(r => r.checks).filter(k => k.state === "checking").length;
      for (const row of current.requests.filter(r => r.checks.some(k => active(k.state))).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
        const checks = structuredClone(row.checks);
        const author = (await tx.query("SELECT active,role FROM users WHERE org=$1 AND id=$2", [org, row.authorization?.by])).rows[0];
        const scopeCurrent = current.policy?.version === row.policyVersion &&
          current.snapshot.runId === row.sourceRunId &&
          hash(directory(current.map)) === row.directoryVersion &&
          author?.active === true && ["commander", "dispatcher"].includes(author.role) &&
          await authorizationCurrent(tx, org, row.authorization);
        for (const k of checks.filter(k => active(k.state))) {
          if (current.snapshot.runId !== row.sourceRunId) { k.state = "requires_review"; k.reason = "The source run changed; prior checks cannot establish current contact."; continue; }
          if (k.inspection) {
            const receipt = current.snapshot.inspections?.find(i => i.id === k.inspection);
            k.queueState = receipt?.state ?? "awaiting_receipt";
            if (receipt?.state === "completed") {
              const latest = current.snapshot.known?.buildings?.[k.building];
              const exact = receipt.org === org && receipt.entity === k.building && receipt.target === "building" &&
                receipt.method === k.method && receipt.purpose === "observation" && receipt.confirmedBySource === true &&
                receipt.result?.id === k.building && Number.isFinite(receipt.observedAt) &&
                receipt.observedAt >= k.requestedAt && receipt.observedAt <= now &&
                (!latest || receipt.result.version >= latest.version);
              k.state = exact ? "contact_confirmed" : "requires_review";
              k.observedAt = exact ? receipt.observedAt : null;
              if (!exact) k.reason = "The contact receipt is old, mismatched or no longer current.";
              inFlight--;
            } else if (["failed", "timeout", "inconclusive", "cancelled"].includes(receipt?.state) || now >= k.waitUntil) {
              k.state = "requires_review"; k.reason = receipt?.failure ?? "No confirmed contact received within the declared wait window."; inFlight--;
            }
            continue;
          }
          if (!scopeCurrent) { k.state = "requires_review"; k.reason = "Approval, coverage policy or received directory changed before emission."; continue; }
          if (now >= k.waitUntil) { k.state = "requires_review"; k.reason = "This queued approval exceeded its declared wait window."; continue; }
          if (inFlight >= current.policy.maxActive) continue;
          if (now < (k.nextAttemptAt ?? k.requestedAt)) continue;
          try {
            await this.validateChannel(tx, k);
            const pending = current.snapshot.inspections?.find(i => i.org === org && i.target === "building" &&
              i.entity === k.building && i.method === k.method && i.purpose === "observation" &&
              !["completed", "inconclusive", "timeout", "failed", "cancelled"].includes(i.state));
            if (!pending) k.attempts = (k.attempts ?? 0) + 1;
            const result = pending ?? await this.connector.action("verify", {
              target: "building", id: k.building, method: k.method, purpose: "observation",
              ...(k.staff ? { staff: k.staff, vehicle: k.vehicle } : {}),
            }, "coverage-check-" + hash([org, row.id, k.building, k.method]), { human: true });
            check(typeof result?.id === "string" && result.id.length > 0, "COVERAGE_ACK", "The source did not return a check identifier.", 409);
            k.inspection = result.id; k.state = "checking"; k.queueState = result.state; k.reused = Boolean(pending); inFlight++;
          } catch (error) {
            // Keep a transient command retry under the same source key. A
            // definite refusal requires a human decision, never automatic retry.
            k.lastError = error.code ?? error.name;
            k.nextAttemptAt = now + Math.max(60000, current.policy.cooldownMs);
            if ([400, 403, 404, 409].includes(error.status) || (k.attempts ?? 0) >= 3) {
              k.state = "requires_review"; k.reason = (k.attempts ?? 0) >= 3 ? "Contact monitoring exhausted three attempts; review the source and any previously issued check." : error.message;
            }
          }
        }
        if (hash(checks) !== hash(row.checks)) {
          const state = checks.some(k => active(k.state)) ? "checking" : checks.some(k => k.state === "requires_review") ? "requires_review" : "completed";
          await tx.put(org, "coverage_request", row.id, { ...row, checks, state }, row.version);
          await tx.audit(org, "coverage-monitor", "coverage.progress", row.id, { states: checks.map(k => k.state) });
        }
      }
    });
  }
}
