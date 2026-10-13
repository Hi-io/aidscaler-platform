import { check } from "./errors.mjs";
import { uid, hash } from "./store.mjs";
import { syncReservation } from "./reservations.mjs";
import { authorizationCurrent } from "./authority.mjs";
import { assessmentCurrent } from "./assessment-receipts.mjs";
import { validateDispatchReservation, validatePlan } from "./planning.mjs";
import { validateUnloadingAction, persistReceivedUnloadingRequests } from "./unloading.mjs";
const PHYSICAL = new Set([
  "dispatch",
  "repair",
  "evacuate",
  "reroute",
  "cancel",
]);
const DONE = new Set(["received", "completed", "service", "operating"]);
// Purchase acknowledgements describe a financial order, not usable inventory.
// Only a completed, scoped finance query can report the supplier's receipt.
function receivedPurchase(state, id) {
  const query = (state.queries ?? [])
    .filter((q) => q.org === state.organization.id && q.state === "ready" && q.target === "finance" && q.result?.sandbox === true)
    // Delivery order is not capture order: an older snapshot may arrive after
    // a newer receipt during an outage. Prefer the source's material version.
    .sort((a, b) => (b.result.version ?? 0) - (a.result.version ?? 0) ||
      (b.completedAt ?? b.readyAt ?? b.observedAt ?? 0) - (a.completedAt ?? a.readyAt ?? a.observedAt ?? 0))[0];
  return query?.result?.purchases?.find((p) => p.id === id && p.org === state.organization.id);
}
function resolution(action, receipt, state) {
  if (action.type === "unload") {
    const request = receipt?.owner && receipt.owner !== state.organization.id
      ? receipt.partnerResult : state.unloadingRequests?.find(r => r.id === receipt?.result?.id && r.receiverOrg === state.organization.id);
    return !!request && (receipt?.owner === state.organization.id || !receipt?.owner || request.confirmedBySource === true) &&
      request.operation === action.params.operation && request.state === "completed" &&
      request.deliveryQuantity === action.params.deliveryQuantity && request.received === action.params.deliveryQuantity &&
      Number.isFinite(request.times?.received) && request.times.received <= state.now;
  }
  if (action.type === "verify") {
    const inspection =
      receipt?.owner && receipt.owner !== state.organization.id
        ? receipt.partnerResult
        : state.inspections?.find((i) => i.id === receipt?.result?.id);
    return assessmentCurrent(
      inspection,
      {
        id: action.params.id,
        sourceVersion:
          state.known?.buildings?.[action.params.id]?.version ??
          action.params.targetVersion,
      },
      state.now,
    );
  }
  if (receipt?.owner && receipt.owner !== state.organization.id)
    return (
      receipt.state === "completed" &&
      receipt.partnerResult?.confirmedBySource === true
    );
  if (!receipt?.result) return false;
  if (action.type === "purchase") {
    const purchase = receivedPurchase(state, receipt.result.id);
    return purchase?.state === "received" &&
      purchase.quantity === action.params.quantity && purchase.type === action.params.type &&
      Number.isFinite(purchase.receivedQuantity) &&
      purchase.receivedQuantity >= purchase.quantity;
  }
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
function assessmentFailed(action, receipt, state) {
  if (action?.type !== "verify") return false;
  if (receipt.owner && receipt.owner !== state.organization.id)
    return (
      receipt.state === "completed" &&
      !!receipt.partnerResult &&
      !resolution(action, receipt, state)
    );
  if (!receipt.result) return false;
  const inspection = state.inspections?.find((i) => i.id === receipt.result.id),
    operation = state.operations?.find(
      (o) =>
        o.inspection === receipt.result.id ||
        (inspection?.operation && o.id === inspection.operation),
    );
  return !!(
    (inspection &&
      (["inconclusive", "timeout", "failed", "cancelled"].includes(
        inspection.state,
      ) ||
        (inspection.state === "completed" &&
          !resolution(action, receipt, state)))) ||
    (operation && ["blocked", "failed", "cancelled"].includes(operation.state))
  );
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
const ACTIVE_EXECUTION = ["authorized", "executing", "awaiting_partner"];
const sameExecutionScope = (current, issued) =>
  ACTIVE_EXECUTION.includes(current.state) &&
  current.authorization &&
  hash(current.authorization) === hash(issued.authorization) &&
  hash(current.actions) === hash(issued.actions);
function mergeExecutionResults(current = [], issued = []) {
  const results = current.map((r) => ({ ...r }));
  for (const receipt of issued) {
    const at = results.findIndex((r) => r.index === receipt.index);
    if (at < 0) results.push(receipt);
    // Preserve more recent peer receipt/status data written during an await.
    else results[at] = { ...receipt, ...results[at] };
  }
  return results;
}
export class Worker {
  constructor(options) {
    Object.assign(this, options);
    this.running = false;
    this.timer = null;
    this.loopPromise = null;
  }
  async recordIssuedResults(proposal, issued, state) {
    const org = this.config.org;
    return this.store.transaction(async (tx) => {
      const row = await tx.get(org, "proposal", proposal.id);
      const current =
        sameExecutionScope(row, proposal) &&
        (await authorizationCurrent(tx, org, row.authorization));
      await tx.put(
        org,
        "proposal",
        row.id,
        {
          ...row,
          executionResults: mergeExecutionResults(row.executionResults, issued),
          ...(current ? { state } : {}),
        },
        row.version,
      );
      if (!current)
        await tx.completeContinuation(org, row.id, {
          state: row.state,
          authorityChanged: true,
        });
      return current;
    });
  }
  async refreshActivationStatus(proposal, state, results) {
    for (const [index, action] of proposal.actions.entries()) {
      if (action.type !== "activate" || action.owner !== this.config.org)
        continue;
      const receipt = results.find((r) => r.index === index)?.result;
      if (!receipt) continue;
      const facility = state.known?.buildings?.[action.params.building];
      if (
        facility?.state === "operating" ||
        (Number.isFinite(receipt.readyAt) && state.now < receipt.readyAt)
      )
        continue;
      const row = await this.store.get(
        this.config.org,
        "proposal",
        proposal.id,
      );
      if (!sameExecutionScope(row, proposal)) return;
      const signature = hash([
        action.params.building,
        receipt,
        facility ?? null,
      ]);
      const previous = row.facilityStatusQueries?.[index];
      if (
        previous?.signature === signature ||
        (previous?.id &&
          state.queries?.some(
            (q) => q.id === previous.id && q.state === "pending",
          ))
      )
        continue;
      const result = await this.connector.action(
        "query",
        { target: "facility", id: action.params.building },
        "facility_status_" +
          hash([this.config.org, proposal.id, index, signature]),
      );
      await this.store.transaction(async (tx) => {
        const current = await tx.get(this.config.org, "proposal", proposal.id);
        await tx.put(
          this.config.org,
          "proposal",
          proposal.id,
          {
            ...current,
            facilityStatusQueries: {
              ...current.facilityStatusQueries,
              [index]: { id: result.id, signature, requestedAt: state.now },
            },
          },
          current.version,
        );
      });
    }
  }
  async refreshPurchaseStatus(proposal, state, results) {
    for (const [index, action] of proposal.actions.entries()) {
      if (action.type !== "purchase" || action.owner !== this.config.org) continue;
      const receipt = results.find((r) => r.index === index)?.result;
      if (!receipt?.id || resolution(action, { result: receipt }, state)) continue;
      const purchase = receivedPurchase(state, receipt.id);
      const nextReceiptAt = purchase?.nextArrivalAt ?? purchase?.expectedArrivalAt;
      if (Number.isFinite(nextReceiptAt) && state.now < nextReceiptAt) continue;
      const row = await this.store.get(this.config.org, "proposal", proposal.id);
      if (!sameExecutionScope(row, proposal) ||
          !(await authorizationCurrent(this.store, this.config.org, row.authorization))) return;
      const previous = row.purchaseStatusQueries?.[index];
      if (previous?.id && state.queries?.some((q) => q.id === previous.id && q.state === "pending")) continue;
      // Bounded passive receipt refresh: no model call, no repeated query at
      // the same source-clock instant, and no guess that an ETA means delivery.
      const bucket = Math.floor(state.now / 60000);
      if (previous?.bucket === bucket) continue;
      const result = await this.connector.action("query", { target: "finance" },
        "purchase_status_" + hash([this.config.org, proposal.id, index, receipt.id, bucket]));
      await this.store.transaction(async (tx) => {
        const current = await tx.get(this.config.org, "proposal", proposal.id);
        if (!sameExecutionScope(current, proposal) ||
            !(await authorizationCurrent(tx, this.config.org, current.authorization))) return;
        await tx.put(this.config.org, "proposal", proposal.id, {
          ...current,
          purchaseStatusQueries: {
            ...current.purchaseStatusQueries,
            [index]: { id: result.id, bucket, requestedAt: state.now },
          },
        }, current.version);
      });
    }
  }
  async recordSourceReview(
    proposal,
    sourceProposal,
    state,
    { record = true } = {},
  ) {
    const org = this.config.org;
    return this.store.transaction(async (tx) => {
      const row = await tx.get(org, "proposal", proposal.id);
      const current =
        sameExecutionScope(row, proposal) &&
        !row.conditions.some((c) => !c.satisfied) &&
        (await authorizationCurrent(tx, org, row.authorization));
      if (!current) {
        // Source progress cannot undo a newer human decision. Keep any source
        // proposal ID and already issued receipts for reconciliation only.
        await tx.completeContinuation(org, row.id, {
          authorityChanged: true,
          state: row.state,
        });
        return { authorityChanged: true, state: row.state };
      }
      const sourceActions = sourceProposal?.plan?.actions;
      const scopeChanged =
        sourceProposal &&
        (!Array.isArray(sourceActions) ||
          hash(sourceActions) !== hash(row.actions) ||
          (sourceProposal.org && sourceProposal.org !== org));
      const sourceRejected = [
        "rejected",
        "needs_clarification",
        "cancelled",
      ].includes(sourceProposal?.state);
      if (scopeChanged || sourceRejected) {
        const reason = scopeChanged
          ? "The operational owner's received plan is missing or differs from the locally authorized actions. Review the exact scope before continuing; preserve already issued work and physical receipts."
          : "The operational owner did not authorize this source proposal.";
        await tx.put(
          org,
          "proposal",
          row.id,
          {
            ...row,
            state: "requires_review",
            previousAuthorization:
              row.authorization ?? row.previousAuthorization,
            authorization: null,
            changedReason: reason,
            sourceReview: {
              ...row.sourceReview,
              state: scopeChanged ? "scope_changed" : sourceProposal.state,
              sourceState: sourceProposal.state,
              sourceProposal: sourceProposal.id,
              sourceVersion: sourceProposal.version ?? null,
              approvedPlanHash: hash(row.actions),
              receivedPlanHash: Array.isArray(sourceActions)
                ? hash(sourceActions)
                : null,
              observedAtSourceClock: state.now,
            },
          },
          row.version,
        );
        await tx.audit(
          org,
          "source-monitor",
          "proposal.source_review_required",
          row.id,
          {
            sourceProposal: sourceProposal.id,
            sourceState: sourceProposal.state,
            scopeChanged: Boolean(scopeChanged),
            sourceVersion: sourceProposal.version ?? null,
          },
        );
        await tx.completeContinuation(org, row.id, { requiresReview: true });
        return {
          requiresReview: true,
          sourceProposal: sourceProposal.id,
          sourceState: sourceProposal.state,
          scopeChanged: Boolean(scopeChanged),
        };
      }
      const authorized = sourceProposal?.state === "authorized";
      if (!record)
        return authorized
          ? { sourceAuthorized: true }
          : {
              pendingReview: true,
              complete: false,
              sourceProposal: row.simId,
            };
      await tx.put(
        org,
        "proposal",
        row.id,
        {
          ...row,
          sourceReview: {
            ...row.sourceReview,
            state: authorized ? "authorized" : "pending",
            sourceProposal: row.simId,
            sourceVersion: sourceProposal?.version ?? null,
            requestedAtSourceClock:
              row.sourceReview?.requestedAtSourceClock ?? state.now,
            observedAtSourceClock: state.now,
            ...(authorized
              ? { reviewedAtSourceClock: sourceProposal.reviewedAt ?? null }
              : {}),
          },
        },
        row.version,
      );
      if (!authorized) await tx.enqueueContinuation(org, row.id);
      return authorized
        ? { sourceAuthorized: true }
        : {
            pendingReview: true,
            complete: false,
            sourceProposal: row.simId,
          };
    });
  }
  async requestSourceReview(proposal, sourceProposal) {
    // The authorization check and source approval are serialized with local
    // human decisions. Source I/O is bounded by the connector timeout; the
    // source version check prevents approval of a concurrently modified plan.
    return this.store.transaction(async (tx) => {
      const row = await tx.get(this.config.org, "proposal", proposal.id);
      if (
        !sameExecutionScope(row, proposal) ||
        row.conditions.some((c) => !c.satisfied) ||
        !(await authorizationCurrent(tx, this.config.org, row.authorization))
      ) {
        await tx.completeContinuation(this.config.org, row.id, {
          authorityChanged: true,
          state: row.state,
        });
        return { authorityChanged: true, state: row.state };
      }
      check(
        Array.isArray(sourceProposal.plan?.actions) &&
          hash(sourceProposal.plan.actions) === hash(row.actions),
        "SOURCE_PLAN_SCOPE",
        "Receive the exact operational owner's plan before approving it.",
        409,
      );
      await this.connector.action(
        "review",
        { id: sourceProposal.id, decision: "approve" },
        "sim_review_" + row.id,
        {
          human: true,
          ...(Number.isSafeInteger(sourceProposal.version)
            ? { version: sourceProposal.version }
            : {}),
        },
      );
      return { requested: true };
    });
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
    ) {
      const result = { skipped: true, state: p.state };
      await this.store.completeContinuation(org, id, result);
      return result;
    }
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
      await this.store.completeContinuation(org, id, { requiresReview: true });
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
        (p.actions[r.index]?.type === "unload" && r.result && current.unloadingRequests?.some(u =>
          u.id === r.result.id && ["inconclusive", "cancelled"].includes(u.state))) ||
        assessmentFailed(p.actions[r.index], r, current) ||
        (r.result &&
          PHYSICAL.has(p.actions[r.index]?.type) &&
          current.operations.some(
            (o) =>
              o.id === (r.result.operation ?? r.result.id) &&
              (p.actions[r.index]?.type === "cancel"
                ? ["failed", "blocked"]
                : ["failed", "cancelled", "blocked"]
              ).includes(o.state),
          )),
    );
    if (failed.length) {
      const preserved = issued
        .filter((r) => resolution(p.actions[r.index], r, current))
        .map((r) => r.index);
      await this.store.transaction(async (tx) => {
        const row = await tx.get(org, "proposal", id);
        const currentAuthority = sameExecutionScope(row, p);
        for (const receipt of failed) {
          const operation = current.operations.find(
            (o) => o.id === (receipt.result?.operation ?? receipt.result?.id),
          );
          if (operation)
            await tx.upsert(org, "operation", operation.id, {
              ...operation,
              confirmedBySource: true,
              sourceSnapshot: operation,
              proposalId: id,
              step: receipt.index,
            });
        }
        await tx.put(
          org,
          "proposal",
          id,
          {
            ...row,
            ...(currentAuthority
              ? {
                  state: "requires_review",
                  previousAuthorization: row.authorization,
                  authorization: null,
                  changedReason: failed.some(
                    (r) => p.actions[r.index]?.type === "verify",
                  )
                    ? "A field assessment failed, became stale or lost validity. Review affected work; preserve the physical crew operation and historical source receipts."
                    : "An issued physical operation was blocked, failed or cancelled. Review affected work; preserve loaded cargo and completed receipts.",
                  affectedSteps: failed.map((r) => r.index),
                  preservedSteps: preserved,
                }
              : {}),
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
      if (p.originPartner) {
        const receipt = failed[0],
          action = p.actions[receipt.index],
          source =
            action.type === "verify"
              ? current.inspections?.find((i) => i.id === receipt.result?.id)
              : current.operations.find(
                  (o) =>
                    o.id === (receipt.result?.operation ?? receipt.result?.id),
                );
        await this.network.response(
          p,
          "failed",
          source
            ? {
                ...source,
                observedAt: current.now,
                confirmedBySource: true,
              }
            : {
                confirmedBySource: false,
                reason:
                  "The owner's observed assessment is no longer valid. Review issued work; physical history is preserved.",
              },
        );
      }
      await this.store.completeContinuation(org, id, { requiresReview: true });
      return {
        requiresReview: true,
        affectedSteps: failed.map((r) => r.index),
        preservedSteps: preserved,
      };
    }
    const beforeReview = await this.recordSourceReview(p, sim, current, {
      record: false,
    });
    if (beforeReview.authorityChanged || beforeReview.requiresReview)
      return beforeReview;
    if (sim?.state === "awaiting_approval" && !sim.reviewPending) {
      const review = await this.requestSourceReview(p, sim);
      if (review.authorityChanged) return review;
    }
    current = await this.connector.state();
    sim = current.proposals.find((x) => x.id === simId);
    const sourceReview = await this.recordSourceReview(p, sim, current);
    if (!sourceReview.sourceAuthorized) return sourceReview;
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
        await this.store.completeContinuation(org, id, {
          requiresReview: true,
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
          const request = await this.network.requestStep({ ...p, simId }, i);
          results.push({
            index: i,
            state: "awaiting_partner",
            owner: a.owner,
            requestId: request.id,
          });
          if (!(await this.recordIssuedResults(p, results, "awaiting_partner")))
            return {
              authorityChanged: true,
              results,
              state: (await this.store.get(org, "proposal", id)).state,
            };
        }
        continue;
      }
      let result;
      try {
        if (p.unloadingOperation && p.unloadingPlanCheckpoint) await validatePlan(this.store, org, p);
        if (a.type === "unload")
          await validateUnloadingAction(this.store, org, a, { excludeProposal: id });
        if (a.type === "dispatch")
          await validateDispatchReservation(
            this.store,
            org,
            resolveParams(a.params, results),
          );
        result = await this.connector.action(
          a.type,
          {
            ...resolveParams(a.params, results),
            ...(a.type === "dispatch" ? { proposal: simId } : {}),
            ...(a.type === "unload" ? { proposal: simId, step: i } : {}),
            ...(a.type === "verify"
              ? {
                  proposal: simId,
                  step: i,
                  ...(p.originPartner
                    ? {
                        requestProposal: p.originSourceProposal,
                        requestStep: p.originStep,
                      }
                    : {}),
                }
              : {}),
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
        await this.store.completeContinuation(org, id, {
          requiresReview: true,
          rejectedStep: i,
          code: e.code,
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
      if (!(await this.recordIssuedResults(p, results, "executing")))
        return {
          authorityChanged: true,
          results,
          state: (await this.store.get(org, "proposal", id)).state,
        };
      current = await this.connector.state();
    }
    await this.refreshActivationStatus(p, current, results);
    await this.refreshPurchaseStatus(p, current, results);
    current = await this.connector.state();
    await this.store.transaction(tx => persistReceivedUnloadingRequests(tx, org, current));
    for (const a of p.actions.filter((a) => a.type === "verify")) {
      for (const inspection of current.inspections?.filter(
        (i) => i.entity === a.params.id && i.target === "building",
      ) ?? [])
        await this.store.upsert(org, "verification", inspection.id, inspection);
    }
    const latest = await this.store.get(org, "proposal", id);
    results = latest.executionResults ?? results;
    const complete = p.actions.every((a, i) =>
      resolution(
        a,
        results.find((r) => r.index === i),
        current,
      ),
    );
    const recorded = await this.store.transaction(async (tx) => {
      const row = await tx.get(org, "proposal", id);
      results = mergeExecutionResults(row.executionResults, results);
      if (
        !sameExecutionScope(row, p) ||
        !(await authorizationCurrent(tx, org, row.authorization))
      ) {
        // A command may already have reached its physical source before a
        // concurrent cancellation. Keep its receipt, never undo the decision.
        await tx.put(
          org,
          "proposal",
          id,
          { ...row, executionResults: results },
          row.version,
        );
        await tx.completeContinuation(org, id, {
          state: row.state,
          authorityChanged: true,
        });
        return { authorityChanged: true, state: row.state };
      }
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
      if (!complete) await tx.enqueueContinuation(org, id);
      else await tx.completeContinuation(org, id, { complete: true });
      return { authorityChanged: false };
    });
    if (recorded.authorityChanged) return { ...recorded, simId, results };
    if (p.originPartner) {
      const r = results.find((r) => r.result)?.result,
        o = current.operations.find((o) => o.id === (r?.operation ?? r?.id)),
        inspection =
          p.actions[0].type === "verify"
            ? current.inspections?.find((i) => i.id === r?.id)
            : null;
      const purchase = p.actions[0].type === "purchase" ? receivedPurchase(current, r?.id) : null;
      const unloading = p.actions[0].type === "unload" ? current.unloadingRequests?.find(u => u.id === r?.id) : null;
      await this.network.response(
        { ...p, version: latest.version },
        complete ? "completed" : "in_transit",
        unloading
          ? { ...unloading, confirmedBySource: true, observedAt: current.now }
          : purchase
          ? { ...purchase, confirmedBySource: true, observedAt: current.now }
          : inspection
          ? {
              ...inspection,
              confirmedBySource: inspection.confirmedBySource === true,
            }
          : {
              id: o?.id ?? r?.id,
              type: o?.type ?? p.actions[0].type,
              org,
              need: o?.need ?? null,
              building: o?.building ?? null,
              destination: o?.destination ?? null,
              vehicle: o?.vehicle ?? null,
              resource: o?.resource ?? null,
              resourceType: o?.resourceType ?? null,
              quantity: o?.quantity,
              received: o?.received,
              ...(o?.staffSkills === undefined
                ? {}
                : { staffSkills: o.staffSkills }),
              ...(o?.receivedStaff === undefined
                ? {}
                : { receivedStaff: o.receivedStaff }),
              times: o?.times ?? {},
              unit: o?.unit,
              state: o?.state ?? r?.state,
              confirmedBySource: !!o || complete,
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
      if (job.kind === "source_accept") {
        const posts = [];
        for (const ref of job.payload.versions) {
          if (await this.store.get(job.org, "erased_source", ref.id, false))
            continue;
          const version = await this.store.get(
            job.org,
            "source_version",
            `${ref.id}_${ref.version}`,
            false,
          );
          if (version?.snapshot) posts.push(version.snapshot);
        }
        const receipts = this.connector.ackBatch
          ? await this.connector.ackBatch(posts, "accepted")
          : await Promise.all(
              posts.map((p) => this.connector.ack(p, "accepted")),
            );
        check(
          receipts.every((r) => r.ok !== false),
          "SOURCE_RECEIPT",
          "The source has not confirmed every durable version.",
          502,
        );
        result = {
          accepted: posts.length,
          skippedErased: job.payload.versions.length - posts.length,
          confirmedBySource: true,
        };
      } else if (job.kind === "ingest") result = await this.ingestion.sync();
      else if (job.kind === "investigate")
        result = await this.investigator.run(job.payload, job.id);
      else if (job.kind === "discover_response")
        result = await this.discovery.run(
          job.payload,
          job.payload.resumeOf ?? job.id,
        );
      else if (job.kind === "compile_response")
        result = await this.discovery.compile(job.id);
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
      if (job.kind === "continue_proposal" && result?.complete === false)
        await this.store.rescheduleJob(job, { result });
      else await this.store.finishJob(job.id, result, job.lease_token);
      if (
        ["investigate", "discover_response", "compile_response"].includes(
          job.kind,
        ) &&
        this.intake
      )
        await this.intake.complete(job.payload, result);
      return true;
    } catch (e) {
      if (
        ["investigate", "discover_response", "compile_response"].includes(
          job.kind,
        ) &&
        this.intake
      )
        await this.intake.complete(job.payload, null, e);
      if (job.kind === "continue_proposal" && job.attempts >= 5)
        await this.store.transaction(async (tx) => {
          // The lease fence and attention state change are one transaction:
          // an obsolete worker cannot invalidate a reclaimed owner's work.
          if (!(await tx.failJob(job, e))) return;
          const proposal = await tx.get(
            job.org,
            "proposal",
            job.payload.id,
            false,
          );
          if (
            !proposal ||
            !["authorized", "executing", "awaiting_partner"].includes(
              proposal.state,
            )
          )
            return;
          const monitoringFailure = {
            job: job.id,
            attempts: job.attempts,
            code: e.code ?? e.name ?? "WORKER_ERROR",
            at: Date.now(),
            physicalStatus: "unconfirmed",
            issuedWorkPreserved: true,
          };
          await tx.put(
            job.org,
            "proposal",
            proposal.id,
            {
              ...proposal,
              state: "requires_review",
              previousAuthorization:
                proposal.authorization ?? proposal.previousAuthorization,
              authorization: null,
              monitoringFailure,
              changedReason:
                "Monitoring stopped after five unsuccessful checks. Review the owner's source and already issued work before continuing. Physical cargo and execution receipts are preserved; this does not declare that the operation failed.",
            },
            proposal.version,
          );
          await tx.audit(
            job.org,
            "source-monitor",
            "proposal.monitoring_exhausted",
            proposal.id,
            monitoringFailure,
          );
        });
      else await this.store.failJob(job, e);
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
