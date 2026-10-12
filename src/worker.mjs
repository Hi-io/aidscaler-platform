import { check } from "./errors.mjs";
import { uid, hash } from "./store.mjs";
import { syncReservation } from "./reservations.mjs";
import { authorizationCurrent } from "./authority.mjs";
const PHYSICAL = new Set([
  "dispatch",
  "repair",
  "evacuate",
  "reroute",
  "cancel",
]);
const DONE = new Set(["received", "completed", "service", "operating"]);
function resolution(action, receipt, state) {
  if (receipt?.owner && receipt.owner !== state.organization.id)
    return (
      receipt.state === "completed" &&
      receipt.partnerResult?.confirmedBySource === true
    );
  if (!receipt?.result) return false;
  if (PHYSICAL.has(action.type))
    return state.operations.some(
      (o) =>
        o.id === (receipt.result.operation ?? receipt.result.id) &&
        (action.type === "cancel"
          ? o.state === "cancelled"
          : DONE.has(o.state)),
    );
  if (action.type === "activate")
    return Object.values(state.known.buildings ?? {}).some(
      (b) => b.id === action.params.building && b.state === "operating",
    );
  if (action.type === "commitment")
    return state.commitments.some(
      (c) =>
        c.id === receipt.result.id &&
        [
          "confirmed",
          "reserved",
          "offered",
          "withdrawn",
          "released",
          "rejected",
        ].includes(c.state),
    );
  if (action.type === "transfer")
    return (
      state.transfers?.some(
        (t) => t.id === receipt.result.id && t.state === receipt.result.state,
      ) ?? false
    );
  return true; // Ledger/read ack never certifies a physical receipt.
}
function resolveParams(params, results) {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => {
      if (typeof v === "string" && /^@step:\d+$/.test(v)) {
        const dependency = results.find((r) => r.index === Number(v.slice(6)));
        check(
          dependency?.result?.id,
          "STEP_PENDING",
          "The referenced action has not acknowledged an ID.",
          409,
        );
        return [k, dependency.result.id];
      }
      return [k, v];
    }),
  );
}
export class Worker {
  constructor(options) {
    Object.assign(this, options);
    this.running = false;
    this.timer = null;
    this.loopPromise = null;
  }
  async execute(id) {
    const org = this.config.org,
      p = await this.store.get(org, "proposal", id);
    if (
      [
        "completed",
        "rejected",
        "cancelled",
        "requires_review",
        "needs_clarification",
      ].includes(p.state)
    )
      return { skipped: true, state: p.state };
    check(
      ["authorized", "executing", "awaiting_partner"].includes(p.state) &&
        p.authorization &&
        !p.conditions.some((c) => !c.satisfied),
      "AUTHORIZATION_REQUIRED",
      "A current human authorization is required.",
      403,
    );
    if (
      !(await authorizationCurrent(this.store, org, p.authorization)) ||
      (p.authorization.planHash && p.authorization.planHash !== hash(p.actions))
    ) {
      await this.store.upsert(org, "proposal", id, {
        state: "requires_review",
        previousAuthorization: p.authorization,
        authorization: null,
        changedReason:
          "Authorization expired or the authorized action scope changed.",
      });
      await this.store.audit(
        org,
        "authority-monitor",
        "proposal.authorization_invalidated",
        id,
        {
          scopeChanged:
            !!p.authorization.planHash &&
            p.authorization.planHash !== hash(p.actions),
        },
      );
      return { requiresReview: true };
    }
    let simId = p.simId;
    if (!simId) {
      const sp = await this.connector.action(
        "propose",
        {
          title: p.title,
          plan: { actions: p.actions },
          conditions: [],
          references: p.references.filter((r) => /^[a-f0-9]{24}$/.test(r)),
        },
        "sim_propose_" + id,
      );
      simId = sp.id;
      await this.store.upsert(org, "proposal", id, { simId });
    }
    let current = await this.connector.state(),
      sim = current.proposals.find((x) => x.id === simId);
    const issued = p.executionResults ?? [];
    const failed = issued.filter(
      (r) =>
        r.result &&
        PHYSICAL.has(p.actions[r.index]?.type) &&
        current.operations.some(
          (o) =>
            o.id === (r.result.operation ?? r.result.id) &&
            (p.actions[r.index]?.type === "cancel"
              ? ["failed", "blocked"]
              : ["failed", "cancelled", "blocked"]
            ).includes(o.state),
        ),
    );
    if (failed.length) {
      const preserved = issued
        .filter((r) => resolution(p.actions[r.index], r, current))
        .map((r) => r.index);
      await this.store.transaction(async (tx) => {
        const row = await tx.get(org, "proposal", id);
        await tx.put(
          org,
          "proposal",
          id,
          {
            ...row,
            state: "requires_review",
            previousAuthorization: row.authorization,
            authorization: null,
            changedReason:
              "An issued physical operation was blocked, failed or cancelled. Review affected work; preserve loaded cargo and completed receipts.",
            affectedSteps: failed.map((r) => r.index),
            preservedSteps: preserved,
          },
          row.version,
        );
        await tx.audit(org, "source-monitor", "proposal.physical_failure", id, {
          affectedSteps: failed.map((r) => r.index),
          preservedSteps: preserved,
          operationStates: failed.map(
            (r) =>
              current.operations.find(
                (o) => o.id === (r.result.operation ?? r.result.id),
              )?.state,
          ),
        });
      });
      if (p.originPartner)
        await this.network.response(p, "failed", {
          confirmedBySource: true,
          reason:
            "Owner source reports interrupted physical work requiring a new decision; a blocked shipment is not released or cancelled",
        });
      return {
        requiresReview: true,
        affectedSteps: failed.map((r) => r.index),
        preservedSteps: preserved,
      };
    }
    if (sim?.state === "awaiting_approval")
      await this.connector.action(
        "review",
        { id: simId, decision: "approve" },
        "sim_review_" + id,
        { human: true },
      );
    const end = Date.now() + 15000;
    while (sim?.state !== "authorized" && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 150));
      current = await this.connector.state();
      sim = current.proposals.find((x) => x.id === simId);
    }
    check(
      sim?.state === "authorized",
      "REVIEW_PENDING",
      "The finite operator review has not arrived.",
      409,
    );
    let results =
      (await this.store.get(org, "proposal", id)).executionResults ?? [];
    for (const [i, a] of p.actions.entries()) {
      if (results.some((r) => r.index === i && r.result)) continue;
      const latest = await this.store.get(org, "proposal", id);
      check(
        ["authorized", "executing", "awaiting_partner"].includes(
          latest.state,
        ) && latest.authorization,
        "AUTHORIZATION_STALE",
        "A dependency changed after authorization.",
        409,
      );
      const obsolete =
        !(await authorizationCurrent(this.store, org, latest.authorization)) ||
        (latest.authorization.planHash &&
          latest.authorization.planHash !== hash(latest.actions));
      const expiredEvidence =
        latest.conditions.some(
          (c) => c.type === "time" && c.expiresAt <= Date.now(),
        ) ||
        (
          await Promise.all(
            latest.references.map((r) =>
              this.store.get(org, "peer_offer", r, false),
            ),
          )
        ).some((o) => o && (!o.active || o.expiresAt <= Date.now()));
      if (obsolete || expiredEvidence) {
        await this.store.upsert(org, "proposal", id, {
          state: "requires_review",
          previousAuthorization: latest.authorization,
          authorization: null,
          changedReason:
            "Current authorization or partner evidence expired before issuing the next step.",
        });
        return { requiresReview: true };
      }
      if (
        a.dependsOn.some(
          (j) =>
            !resolution(
              p.actions[j],
              results.find((r) => r.index === j),
              current,
            ),
        )
      )
        continue;
      if (a.owner !== org) {
        if (!results.some((r) => r.index === i)) {
          const request = await this.network.requestStep(p, i);
          results.push({
            index: i,
            state: "awaiting_partner",
            owner: a.owner,
            requestId: request.id,
          });
          await this.store.upsert(org, "proposal", id, {
            executionResults: results,
            state: "awaiting_partner",
          });
        }
        continue;
      }
      let result;
      try {
        result = await this.connector.action(
          a.type,
          {
            ...resolveParams(a.params, results),
            ...(a.type === "dispatch" ? { proposal: simId } : {}),
          },
          `execute_${id}_${i}`,
          { human: true },
        );
      } catch (e) {
        if (
          ![400, 403, 404, 409].includes(e.status) ||
          ["STEP_PENDING", "REVIEW_PENDING"].includes(e.code)
        )
          throw e;
        const preserved = results
          .filter((r) => resolution(p.actions[r.index], r, current))
          .map((r) => r.index);
        await this.store.transaction(async (tx) => {
          const row = await tx.get(org, "proposal", id);
          await tx.put(
            org,
            "proposal",
            id,
            {
              ...row,
              state: "requires_review",
              previousAuthorization: row.authorization,
              authorization: null,
              changedReason:
                "The operational source refused a prospective command: " +
                e.code,
              affectedSteps: [i],
              preservedSteps: preserved,
              commandRejection: {
                step: i,
                code: e.code,
                status: e.status,
                at: Date.now(),
              },
            },
            row.version,
          );
          await tx.audit(
            org,
            "source-monitor",
            "proposal.command_rejected",
            id,
            { step: i, code: e.code, preservedSteps: preserved },
          );
        });
        if (p.originPartner)
          await this.network.response(p, "failed", {
            confirmedBySource: false,
            reason:
              "The owner's source refused the prospective command: " + e.code,
          });
        return { requiresReview: true, rejectedStep: i, code: e.code };
      }
      results.push({ index: i, result });
      if (PHYSICAL.has(a.type) && result.id)
        await this.store.upsert(
          org,
          "operation",
          result.operation ?? result.id,
          {
            ...result,
            proposalId: id,
            authorizedBy: p.authorization.by,
            dependencies: p.dependencies,
            step: i,
            confirmedBySource: false,
          },
        );
      await this.store.upsert(org, "proposal", id, {
        executionResults: results,
        state: "executing",
      });
      current = await this.connector.state();
    }
    if (
      p.actions.some((a) => a.type === "activate") &&
      !current.queries?.some(
        (q) => q.target === "facility" && q.state === "pending",
      )
    )
      await this.connector.action(
        "query",
        { target: "facility" },
        uid("facility_status"),
      );
    current = await this.connector.state();
    const latest = await this.store.get(org, "proposal", id);
    results = latest.executionResults ?? results;
    const complete = p.actions.every((a, i) =>
      resolution(
        a,
        results.find((r) => r.index === i),
        current,
      ),
    );
    await this.store.transaction(async (tx) => {
      const row = await tx.get(org, "proposal", id);
      await tx.put(
        org,
        "proposal",
        id,
        {
          ...row,
          state: complete
            ? "completed"
            : results.some((r) => r.state === "awaiting_partner")
              ? "awaiting_partner"
              : "executing",
          executionResults: results,
        },
        row.version,
      );
      if (complete && row.repairOf) {
        const parent = await tx.get(org, "proposal", row.repairOf, false);
        const unresolved = (row.inheritedWork ?? [])
          .filter((w) => w.state === "still_in_progress")
          .filter((w) => {
            const op = current.operations?.find((o) => o.id === w.operationId);
            return !op || ![...DONE, "cancelled"].includes(op.state);
          });
        if (parent?.state === "requires_review" && unresolved.length === 0) {
          await tx.upsert(org, "proposal", parent.id, {
            state: "repaired",
            repairedBy: id,
          });
          await tx.audit(
            org,
            p.authorization.by,
            "proposal.repaired",
            parent.id,
            { replacement: id, receiptsPreserved: true },
          );
        }
      }
      await tx.audit(
        org,
        p.authorization.by,
        complete ? "proposal.completed" : "proposal.progress",
        id,
        {
          simId,
          steps: results.map((r) => ({
            index: r.index,
            id: r.result?.id,
            state: r.result?.state ?? r.state,
          })),
        },
      );
      if (!complete)
        await tx.enqueue(
          org,
          "continue_proposal",
          { id },
          uid("continue"),
          Date.now() + 1000,
        );
    });
    if (p.originPartner) {
      const r = results.find((r) => r.result)?.result,
        o = current.operations.find((o) => o.id === r?.id);
      await this.network.response(
        { ...p, version: latest.version },
        complete ? "completed" : "in_transit",
        {
          id: r?.id,
          type: p.actions[0].type,
          quantity: o?.quantity,
          unit: o?.unit,
          state: o?.state ?? r?.state,
          confirmedBySource: complete,
          observedAt: current.now,
        },
      );
    }
    return { simId, results, complete };
  }
  async once({ asOf = Date.now() } = {}) {
    const job = await this.store.lease(this.config.org, 180000, asOf);
    if (!job) return false;
    const heartbeat = setInterval(
      () => this.store.renewJob(job).catch(() => {}),
      30000,
    );
    heartbeat.unref();
    try {
      let result;
      if (job.kind === "ingest") result = await this.ingestion.sync();
      else if (job.kind === "investigate")
        result = await this.investigator.run(job.payload, job.id);
      else if (job.kind === "analyze_media")
        result = await this.media.analyze(job.org, job.payload.id, job.id, {
          pages: job.payload.pages,
        });
      else if (job.kind === "erase_source_files")
        result = await this.retention.cleanup(job.org, job.payload.id);
      else if (job.kind === "interpret_sources")
        result = await this.semantic.process(
          { ids: job.payload.ids, org: job.org },
          job.id,
        );
      else if (["execute_proposal", "continue_proposal"].includes(job.kind))
        result = await this.execute(job.payload.id);
      else if (job.kind === "expire_commitment")
        result = await this.domain.expire(job.org, job.payload.id);
      else if (job.kind === "source_commitment")
        result = await syncReservation(this, job.payload);
      else if (job.kind === "peer_send")
        result = await this.network.send(job.payload);
      else if (job.kind === "invalidate")
        result = await this.domain.invalidate(
          { id: "source-monitor", org: job.org, role: "analyst" },
          job.payload.dependency,
          job.payload.reason,
          job.id,
        );
      else throw new Error("Unknown durable job kind.");
      await this.store.finishJob(job.id, result, job.lease_token);
      if (job.kind === "investigate" && this.intake)
        await this.intake.complete(job.payload, result);
      return true;
    } catch (e) {
      if (job.kind === "investigate" && this.intake)
        await this.intake.complete(job.payload, null, e);
      await this.store.failJob(job, e);
      return true;
    } finally {
      clearInterval(heartbeat);
    }
  }
  async drain(limit = 32) {
    // A finite snapshot prevents a continuation from perpetually consuming its
    // own newly created jobs while the modeled world has no chance to advance.
    const asOf = Date.now();
    let count = 0;
    while (count < limit && (await this.once({ asOf }))) count++;
    return { processed: count, limited: count === limit };
  }
  start() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      try {
        if (this.running) await this.drain();
      } catch (e) {
        this.lastError = e.code ?? "WORKER";
      } finally {
        if (this.running)
          this.timer = setTimeout(() => {
            this.loopPromise = loop();
          }, 500);
      }
    };
    this.loopPromise = loop();
  }
  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    await this.loopPromise;
  }
}
