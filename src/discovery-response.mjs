import { check } from "./errors.mjs";
import { hash } from "./store.mjs";
import {
  receivedAllocationPlan,
  validateAllocationOffers,
} from "./received-allocation.mjs";
import { responseQueue, outstanding } from "./response-policy.mjs";
import { validatePlan } from "./planning.mjs";
import { effectiveNeed } from "./response-receipts.mjs";
import { processSourceOpportunities } from "./source-opportunities.mjs";
import { requestReceivedInquiry } from "./received-inquiries.mjs";

async function stopped(store, org, episode) {
  const activity = await store.get(org, "activity", episode, false);
  const run = await store.get(org, "discovery_run", episode, false);
  return Boolean(
    activity?.cancelRequested ||
    activity?.erasure ||
    activity?.state === "cancelled" ||
    run?.erasure ||
    ["cancelled", "erased"].includes(run?.state),
  );
}
async function cancel(app, episode) {
  const org = app.config.org;
  await app.store.transaction(async (tx) => {
    const run = await tx.get(org, "discovery_run", episode, false);
    if (run && run.state !== "erased" && !run.erasure)
      await tx.upsert(org, "discovery_run", episode, {
        state: "cancelled",
        finishedAt: Date.now(),
      });
    const activity = await tx.get(org, "activity", episode, false);
    if (activity)
      await tx.upsert(org, "activity", episode, {
        state: "cancelled",
        finishedAt: Date.now(),
      });
  });
  return { state: "cancelled" };
}
async function currentProvenance(store, org, episode, preparedRun) {
  const run =
    preparedRun ?? (await store.get(org, "discovery_run", episode, false));
  if (!run?.sourceIds) return;
  const semantic = await store.get(
    org,
    "semantic_receipt",
    run.semanticReceipt,
  );
  check(
    semantic.state !== "erased" && !semantic.erasure,
    "SOURCE_ERASED",
    "The discovery interpretation was erased.",
    409,
  );
  for (const id of run.sourceIds) {
    const source = await store.get(org, "signal", id, false);
    check(
      source && source.state !== "erased",
      "SOURCE_ERASED",
      "The discovery source is no longer available.",
      409,
    );
    const presented = semantic.sources?.find((s) => s.id === id);
    check(
      presented &&
        (source.sourceVersion ?? source.version) === presented.version,
      "SEMANTIC_VERSION",
      "Discovery evidence changed. Interpret the current source version before continuing.",
      409,
    );
  }
}

// Arithmetic is deliberately shared with the conventional reference. The
// model's contribution is interpreting received sources and directing checks,
// not claiming ownership, inventing need IDs or calculating truck capacity.
export async function draftReceivedResponse(
  app,
  episode,
  { needIds, references = [] } = {},
) {
  const org = app.config.org;
  if (await stopped(app.store, org, episode)) return cancel(app, episode);
  const plan = await receivedAllocationPlan(app.store, app.config, { needIds });
  const selected = plan.allocations.slice(0, 30);
  if (!selected.length)
    return {
      state: "inconclusive",
      reason: "No currently executable received capacity",
      allocations: 0,
    };
  await validateAllocationOffers(app.store, app.config, selected);
  const scope = await responseQueue(app.store, org);
  // Domain.propose owns the idempotent transaction. Its guarded store performs
  // final checks under the same organization lock as proposal persistence.
  const guardedStore = Object.create(app.store);
  guardedStore.command = (tenant, key, input, fn) =>
    app.store.command(tenant, key, input, async (tx) => {
      if (await stopped(tx, org, episode)) return { state: "cancelled" };
      await currentProvenance(tx, org, episode);
      const fresh = await receivedAllocationPlan(tx, app.config, { needIds });
      check(
        hash(fresh.actions.slice(0, 30)) === hash(plan.actions.slice(0, 30)),
        "ALLOCATION_CHANGED",
        "Received capacity or concurrent holds changed. Compile the current response again.",
        409,
      );
      await validateAllocationOffers(tx, app.config, selected);
      await validatePlan(tx, org, input.draft);
      return fn(tx);
    });
  const guardedDomain = Object.assign(
    Object.create(Object.getPrototypeOf(app.domain)),
    app.domain,
    { store: guardedStore },
  );
  const proposal = await guardedDomain.propose(
    { org: app.config.org, id: "received-response-compiler", role: "agent" },
    {
      title: "Respond to checked concurrent needs",
      summary:
        "Proportionate aid using received demand and consented capacity.",
      benefit: "Useful aid with separate owner review",
      rationale:
        "Received observations establish demand. Deterministic checks compile quantities and transport; human owners must authorize each action. Source interpretations are hypotheses, never physical confirmation.",
      actions: plan.actions.slice(0, 30),
      references: [
        ...new Set([...selected.flatMap((a) => a.evidenceIds), ...references]),
      ],
      conditions: [],
      alternatives: [],
    },
    episode + "-draft-" + hash([scope.signature, plan.actions.slice(0, 30)]),
  );
  if (proposal.state === "cancelled") return cancel(app, episode);
  return {
    state: "ready",
    proposalId: proposal.id,
    allocations: selected.length,
    attribution: {
      interpretation: references.length
        ? "model-supported sourced hypotheses"
        : "received structured records",
      allocation: "deterministic constraints",
      authority: "human owners",
    },
  };
}

/** Turns a bounded public-source batch into inquiries and a reviewed draft.
 * Pending confirmations resume WITHOUT reinterpreting unchanged evidence.
 * No source text, including a claimed cancellation, can erase an official need.
 */
export class DiscoveryResponse {
  constructor(options) {
    Object.assign(this, options);
  }
  async compile(episode) {
    if (await stopped(this.store, this.config.org, episode))
      return cancel(this, episode);
    let result;
    try {
      result = await draftReceivedResponse(this, episode);
    } catch (error) {
      await this.recordFailure(episode, error);
      throw error;
    }
    if (result.state === "cancelled") return result;
    const saved = await this.store.transaction(async (tx) => {
      if (await stopped(tx, this.config.org, episode)) return false;
      await tx.upsert(this.config.org, "activity", episode, {
        ...result,
        kind: "structured_response",
        calls: 0,
        finishedAt: Date.now(),
        steps: [
          {
            type: "compilation",
            state: result.proposalId ? "completed" : "pending",
            label:
              "Deterministic checks compiled received demand without another model call",
            at: Date.now(),
          },
        ],
      });
      return true;
    });
    if (!saved) return cancel(this, episode);
    return result;
  }
  async resumePending() {
    const org = this.config.org;
    const snapshot = (
      await this.store.get(org, "context", "operational", false)
    )?.snapshot;
    if (!snapshot) return;
    const signature = hash([
      (await responseQueue(this.store, org)).signature,
      (snapshot.inspections ?? []).map(i => [i.id, i.target, i.entity, i.method, i.purpose,
        i.state, i.observedAt ?? null, i.result ?? null]),
      (snapshot.operations ?? []).map(o => [o.id, o.state, o.phase, o.quantity,
        o.deliveredQuantity, o.receivedQuantity, o.destination, o.vehicle, o.route]),
      (await this.store.list(org, "peer_offer", 2000)).map((o) => [
        o.id,
        o.version,
        o.active,
        o.permissionVersion,
        o.expiresAt > Date.now(),
      ]),
    ]);
    for (const r of (await this.store.list(org, "discovery_run", 2000))
      .filter((r) => ["waiting_evidence", "waiting_capacity", "waiting_review", "waiting_receipt", "waiting_context"].includes(r.state) || r.sourceOpportunities?.deferred?.length)
      .slice(0, 4)) {
      if (await stopped(this.store, org, r.id)) {
        await cancel(this, r.id);
        continue;
      }
      const automation = await this.store.get(
        org,
        "automation",
        "intake",
        false,
      );
      if (r.automatic && !automation?.enabled) continue;
      if (r.resumeSignature === signature) continue;
      await this.store.transaction(async (tx) => {
        if (await stopped(tx, org, r.id)) return;
        await tx.enqueue(
          org,
          "discover_response",
          { resumeOf: r.id },
          "resume-discovery-" + hash([r.id, signature]),
        );
        await tx.upsert(org, "discovery_run", r.id, {
          resumeSignature: signature,
        });
      });
    }
  }
  async run(input = {}, episode) {
    try {
      return await this.runEpisode(input, episode);
    } catch (error) {
      if (await stopped(this.store, this.config.org, episode))
        return cancel(this, episode);
      await this.recordFailure(episode, error);
      throw error;
    }
  }
  async recordFailure(episode, error) {
    await this.store.transaction(async (tx) => {
      if (await stopped(tx, this.config.org, episode)) return;
      await tx.upsert(this.config.org, "activity", episode, {
        state: "failed",
        finishedAt: Date.now(),
        error: error.code ?? "DISCOVERY_FAILURE",
      });
      if (await tx.get(this.config.org, "discovery_run", episode, false))
        await tx.upsert(this.config.org, "discovery_run", episode, {
          state: "failed",
          error: error.code ?? "DISCOVERY_FAILURE",
        });
    });
  }
  async runEpisode(
    { ids = [], verificationMethod = "clarification", automatic = false } = {},
    episode,
  ) {
    const org = this.config.org;
    check(
      ["field", "radio", "clarification"].includes(verificationMethod),
      "VERIFICATION_METHOD",
      "Choose an available verification channel.",
    );
    if (await stopped(this.store, org, episode)) return cancel(this, episode);
    let receipt = await this.store.get(org, "discovery_run", episode, false);
    if (
      receipt &&
      ["ready", "cancelled", "inconclusive"].includes(receipt.state) &&
      !receipt.sourceOpportunities?.deferred?.length
    )
      return receipt;
    if (!receipt) {
      check(
        Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= 35 &&
          new Set(ids).size === ids.length,
        "SEMANTIC_BATCH",
        "Select one to thirty-five received sources.",
      );
      const semantic = await this.semantic.process(
        { ids, org },
        episode + "-perception",
      );
      if (await stopped(this.store, org, episode)) return cancel(this, episode);
      const candidates = [
        ...new Set(
          semantic.observations
            .filter(
              (o) =>
                o.kind === "need" &&
                o.location &&
                o.timeStatus !== "historical",
            )
            .map((o) => o.location),
        ),
      ];
      receipt = await this.store.transaction(async (tx) => {
        if (await stopped(tx, org, episode)) return null;
        await currentProvenance(tx, org, episode, {
          sourceIds: ids,
          semanticReceipt: semantic.id,
        });
        return tx.put(
          org,
          "discovery_run",
          episode,
          {
            state: "checking",
            sourceIds: ids,
            semanticReceipt: semantic.id,
            claimIds: semantic.claimIds,
            candidateLocations: candidates,
            verifications: [],
            verificationMethod,
            automatic,
            candidates: candidates.map((location) => ({
              location,
              types: [
                ...new Set(
                  semantic.observations
                    .filter(
                      (o) =>
                        o.kind === "need" &&
                        o.location === location &&
                        o.timeStatus !== "historical",
                    )
                    .map((o) => o.resourceType)
                    .filter(Boolean),
                ),
              ],
            })),
            opportunityObservations: semantic.observations.filter(o => o.kind !== "need"),
            model: this.config.modelId,
            startedAt: Date.now(),
            interpretation:
              "Unverified hypotheses; original sources remain available.",
          },
          0,
        );
      });
      if (!receipt) return cancel(this, episode);
    }
    if (await stopped(this.store, org, episode)) return cancel(this, episode);
    // Revalidate provenance on every continuation, before requesting or drafting.
    await currentProvenance(this.store, org, episode);
    await this.store.upsert(org, "activity", episode, {
      state: "checking",
      kind: "source_response",
      model: this.config.modelId,
      startedAt: receipt.startedAt,
      semanticReceipt: receipt.semanticReceipt,
      steps: [
        {
          type: "perception",
          state: "completed",
          label: "Interpreted received sources into hypotheses",
          at: Date.now(),
          sourceCount: receipt.sourceIds.length,
        },
        {
          type: "verification",
          state: "running",
          label: "Checking locations with the responsible field channel",
          at: Date.now(),
          candidateLocations: receipt.candidateLocations,
        },
      ],
    });
    const known = await this.connector.state();
    for (const location of receipt.candidateLocations) {
      if (await stopped(this.store, org, episode)) return cancel(this, episode);
      await currentProvenance(this.store, org, episode);
      if (receipt.verifications.some((v) => v.location === location)) continue;
      // An already received current need does not need a redundant field trip.
      const types =
        receipt.candidates.find((c) => c.location === location)?.types ?? [];
      if (
        types.length &&
        types.every((type) =>
          Object.values(known.known?.needs ?? {}).some(
            (n) =>
              n.building === location &&
              n.type === type &&
              n.quantity > (n.served ?? 0),
          ),
        )
      ) {
        receipt.verifications.push({ location, state: "already_received" });
      } else {
        // Different source batches may refer to the same current incident.
        // Reuse the owner's actual pending inquiry across runs; merely reusing
        // an episode key would enqueue the same work again for every repost.
        const inquiry = await requestReceivedInquiry(this, {
            target: "building",
            id: location,
            method: receipt.verificationMethod,
          }, { assertCurrent: tx => currentProvenance(tx, org, episode), requestClass: "foreground" });
        receipt.verifications.push({
          location,
          id: inquiry.id,
          state: inquiry.state,
          reused: Boolean(inquiry.reused),
        });
      }
      if (await stopped(this.store, org, episode)) return cancel(this, episode);
      const persisted = await this.store.transaction(async (tx) => {
        if (await stopped(tx, org, episode)) return false;
        await tx.upsert(org, "discovery_run", episode, {
          verifications: receipt.verifications,
        });
        return true;
      });
      if (!persisted) return cancel(this, episode);
    }
    if (await stopped(this.store, org, episode)) return cancel(this, episode);
    await this.ingestion.sync({ sources: false });
    if (await stopped(this.store, org, episode)) return cancel(this, episode);
    await currentProvenance(this.store, org, episode);
    const state = await this.connector.state();
    receipt.verifications = receipt.verifications.map((v) => ({
      ...v,
      state: v.id
        ? (state.inspections.find((i) => i.id === v.id)?.state ?? v.state)
        : v.state,
    }));
    const pending = receipt.verifications.filter(
      (v) =>
        !["already_received", "completed", "inconclusive", "timeout", "failed", "cancelled", "requires_review"].includes(
          v.state,
        ),
    );
    const unresolved = receipt.verifications.filter(v =>
      ["inconclusive", "timeout", "failed", "cancelled", "requires_review"].includes(v.state),
    );
    // Received structured demand, not the model's estimated quantity, is used.
    const needs = await this.store.list(org, "need", 10000);
    const checkedNeeds = needs.filter((n) =>
      receipt.candidates.some(
        (c) =>
          c.location === n.building &&
          (!c.types.length || c.types.includes(n.type)),
      ),
    );
    const checked = [...new Set(checkedNeeds.map((n) => n.building))];
    const relevantClaims = (
      await Promise.all(
        receipt.claimIds.map((id) => this.store.get(org, "claim", id, false)),
      )
    )
      .filter(
        (c) =>
          c &&
          c.kind === "need" &&
          c.timeStatus !== "historical" &&
          checkedNeeds.some(
            (n) =>
              n.building === c.location &&
              (!c.resourceType || n.type === c.resourceType),
          ),
      )
      .map((c) => c.id);
    const opportunities = receipt.opportunityObservations?.length
      ? await processSourceOpportunities(this, episode, {
          observations: receipt.opportunityObservations,
          references: receipt.claimIds,
          assertCurrent: tx => currentProvenance(tx, org, episode),
          stopRequested: tx => stopped(tx, org, episode),
        }) : null;
    const receivedCapacityOrDemand = opportunities?.opportunities.some(o => o.received && o.target !== "road");
    const draft = checked.length || receivedCapacityOrDemand
      ? await draftReceivedResponse(this, episode, {
          // The interpreted batch supplies evidence, not a competing dispatch
          // policy. Compile against ALL received needs in the approved order.
          // A later source continuation cannot seize a truck from an already
          // known higher-priority need simply because that need is in another
          // source batch. Explicit manual focus belongs to investigation.
          references: relevantClaims,
        })
      : {
          state: pending.length ? "waiting_evidence" : "inconclusive",
          reason: unresolved.length
            ? "The requested confirmation ended without actionable evidence. Review its receipt and explicitly retry or choose another channel."
            : "No confirmed actionable need received yet",
        };
    if (draft.state === "cancelled") return draft;
    if (await stopped(this.store, org, episode)) return cancel(this, episode);
    if (!draft.proposalId && opportunities?.proposalIds.length) {
      draft.proposalId = opportunities.proposalIds[0];
      draft.state = "ready";
      draft.reason = "Received road checks support repair of existing cargo, pending human owner review.";
    }
    if (pending.length || opportunities?.pending.length) draft.state = "waiting_evidence";
    else if (!draft.proposalId && !checkedNeeds.length && opportunities?.deferred?.length) {
      draft.state = "waiting_context";
      draft.reason = "Unverified context remains visible. Explicit need and safety checks take precedence; bounded background inquiry resumes when received operational material changes.";
    }
    else if (!draft.proposalId && checkedNeeds.length) {
      const operations = await this.store.list(org, "operation", 10000),
        unmet = checkedNeeds.map(n => effectiveNeed(n, operations)).filter(n => n.quantity > (n.served ?? 0)),
        queue = await responseQueue(this.store, org),
        remaining = unmet.map(n => {
          const held = queue.planningHolds.filter(h => h.needIds.includes(n.id)).reduce((sum, h) => sum + h.quantity, 0);
          return { id: n.id, draftHeldQuantity: held, planningOutstanding: Math.max(0, outstanding(n, operations) - held) };
        });
      if (unmet.length) {
        draft.state = remaining.some(n => n.planningOutstanding > 0) ? "waiting_capacity"
          : remaining.some(n => n.draftHeldQuantity > 0) ? "waiting_review" : "waiting_receipt";
        draft.reason = {
          waiting_capacity: "An uncovered residual need remains; wait for eligible capacity or review another option.",
          waiting_review: "The remaining quantity is held by a response awaiting owner review. It is not dispatched or delivered.",
          waiting_receipt: "The remaining quantity is already in transit. Await a physical receipt; the dispatch is not delivered aid.",
        }[draft.state];
      } else draft.reason = "Received physical service already covers the checked needs. No additional dispatch is needed.";
    }
    const result = await this.store.transaction(async (tx) => {
      if (await stopped(tx, org, episode)) return null;
      await currentProvenance(tx, org, episode);
      const result = await tx.upsert(org, "discovery_run", episode, {
        ...draft,
        verifications: receipt.verifications,
        checkedLocations: checked,
        pendingLocations: pending.map((v) => v.location),
        unresolvedLocations: unresolved.map(v => ({ location: v.location, inspection: v.id, state: v.state })),
        sourceOpportunities: opportunities,
        finishedAt: Date.now(),
        proposalIds: [
          ...new Set([
            ...(receipt.proposalIds ?? []),
            ...(draft.proposalId ? [draft.proposalId] : []),
            ...(opportunities?.proposalIds ?? []),
          ]),
        ],
        noModelAuthority: true,
        physicalCompletion: false,
      });
      await tx.upsert(org, "activity", episode, {
        state: result.state,
        proposalId: result.proposalId ?? null,
        finishedAt: Date.now(),
        calls: 1,
        steps: [
          {
            type: "perception",
            state: "completed",
            label: "Sourced hypotheses from the received batch",
            at: Date.now(),
            sourceCount: receipt.sourceIds.length,
          },
          {
            type: "verification",
            state: pending.length ? "pending" : unresolved.length ? "inconclusive" : "completed",
            label: unresolved.length ? "Some confirmations ended without actionable evidence" : "Responsible field observations received",
            at: Date.now(),
            confirmedLocations: checked.length,
            pendingLocations: pending.length,
          },
          {
            type: "compilation",
            state: draft.proposalId ? "completed" : "pending",
            label: draft.proposalId
              ? "Compiled a feasible batch for human owner review"
              : "Keep unanswered needs visible; wait for evidence or capacity",
            at: Date.now(),
            allocations: draft.allocations ?? 0,
          },
          ...(opportunities?.attentionRequired ? [{ type: "source_context", state: "pending",
            label: `${opportunities.deferred.length} deferred hypotheses and ${opportunities.unresolved.length} unresolved observations remain unverified and available for review`,
            result: { deferred: opportunities.deferred, unresolved: opportunities.unresolved, note: "Deferred context is not false or safe; no need is erased by this admission decision." },
            at: Date.now() }] : []),
        ],
      });
      return result;
    });
    return result ?? cancel(this, episode);
  }
}
