import { check, role, owner, AppError } from "./errors.mjs";
import { hash, uid } from "./store.mjs";
import {
  proposalSchema,
  claimSchema,
  fieldReport,
  ACTIONS,
} from "./contracts.mjs";
import { validateConditions, validatePlan } from "./planning.mjs";
import { resolveEvidence } from "./citations.mjs";
const COMMAND = ["commander", "dispatcher"];
export class Domain {
  constructor(store, config) {
    this.store = store;
    this.config = config;
  }
  async createClaim(actor, input, key) {
    role(actor, ["analyst", "commander", "dispatcher", "field", "agent"]);
    const d = claimSchema.parse(input);
    check(
      actor.role !== "agent" || d.state !== "confirmed",
      "HUMAN_CONFIRMATION",
      "A model cannot independently certify a claim.",
      403,
    );
    return this.store.command(actor.org, key, d, async (tx) => {
      for (const ref of d.references)
        check(
          await resolveEvidence(tx, actor.org, ref),
          "EVIDENCE",
          "One of the cited sources is unavailable.",
        );
      const id = uid("claim"),
        c = await tx.put(
          actor.org,
          "claim",
          id,
          { ...d, originActor: actor.id, observedAt: Date.now() },
          0,
        );
      await tx.audit(actor.org, actor.id, "claim.created", id, {
        references: d.references,
        state: d.state,
      });
      return c;
    });
  }
  async propose(actor, input, key) {
    role(actor, ["analyst", "commander", "dispatcher", "agent"]);
    const d = proposalSchema.parse(input);
    return this.store.command(actor.org, key, d, async (tx) => {
      for (const ref of d.references)
        check(
          await resolveEvidence(tx, actor.org, ref),
          "EVIDENCE",
          "A proposal must cite accessible evidence. Copy the exact evidence IDs returned by tools.",
        );
      for (let i = 0; i < d.actions.length; i++) {
        check(
          d.actions[i].dependsOn.every((j) => j < i),
          "DEPENDENCY_CYCLE",
          "Action dependencies must be acyclic and refer to earlier actions.",
        );
        check(
          d.actions[i].owner === actor.org ||
            this.config.peers.some((p) => p.org === d.actions[i].owner),
          "OWNER",
          "An action requires a known responsible organization.",
        );
      }
      const conditions = await validateConditions(tx, actor.org, d.conditions);
      const id = uid("proposal"),
        proposal = await tx.put(
          actor.org,
          "proposal",
          id,
          {
            ...d,
            conditions,
            state: "awaiting_review",
            createdBy: actor.id,
            authorization: null,
            simId: null,
            dependencies: [...d.references, ...d.conditions.map((c) => c.id)],
            activity: [],
            repairOf: null,
          },
          0,
        );
      await tx.audit(actor.org, actor.id, "proposal.created", id, {
        requestHash: hash(d),
        references: d.references,
      });
      return proposal;
    });
  }
  async review(
    actor,
    id,
    { decision, version, note = "", allowConditional = false },
    key,
  ) {
    role(actor, COMMAND);
    check(
      ["approve", "reject", "clarify"].includes(decision),
      "DECISION",
      "Choose approve, reject or clarify.",
    );
    return this.store.command(
      actor.org,
      key,
      { id, decision, version, note, allowConditional },
      async (tx) => {
        const p = await tx.get(actor.org, "proposal", id);
        check(
          p.version === version,
          "VERSION_CONFLICT",
          "This proposal changed. Read the update before approving.",
          409,
        );
        check(
          [
            "awaiting_review",
            "needs_clarification",
            "requires_review",
          ].includes(p.state),
          "PROPOSAL_STATE",
          "This proposal cannot be reviewed now.",
          409,
        );
        p.conditions = await validateConditions(tx, actor.org, p.conditions);
        const unsatisfied = p.conditions.filter((c) => !c.satisfied);
        check(
          decision !== "approve" || !unsatisfied.length || allowConditional,
          "PENDING_CONDITIONS",
          "Resolve the conditions or authorize a conditional reservation.",
        );
        const checkedConstraints =
          decision === "approve" && !unsatisfied.length
            ? await validatePlan(tx, actor.org, p)
            : [];
        const state =
          decision === "approve"
            ? unsatisfied.length
              ? "conditionally_authorized"
              : "authorized"
            : decision === "reject"
              ? "rejected"
              : "needs_clarification";
        const evidence = await Promise.all(
          p.references.map(async (ref) => {
            const resolved = await resolveEvidence(tx, actor.org, ref);
            return { ref, kind: resolved?.kind, snapshot: resolved?.record };
          }),
        );
        const authorization =
          decision === "approve"
            ? {
                by: actor.id,
                name: actor.name,
                at: Date.now(),
                proposalVersion: version,
                note,
                conditional: !!unsatisfied.length,
                evidenceHash: hash(evidence),
                evidence,
              }
            : null;
        const result = await tx.put(
          actor.org,
          "proposal",
          id,
          { ...p, state, authorization, checkedConstraints, reviewNote: note },
          version,
        );
        await tx.audit(actor.org, actor.id, "proposal." + decision, id, {
          version,
          conditions: unsatisfied.map((c) => c.id),
          evidenceHash: authorization?.evidenceHash ?? null,
          note,
        });
        if (decision === "approve" && !unsatisfied.length)
          await tx.enqueue(
            actor.org,
            "execute_proposal",
            { id },
            "execute_" + id + "_" + result.version,
          );
        return result;
      },
    );
  }
  async satisfy(actor, id, { conditionId, version, evidenceId }, key) {
    role(actor, ["analyst", ...COMMAND]);
    return this.store.command(
      actor.org,
      key,
      { id, conditionId, version, evidenceId },
      async (tx) => {
        const p = await tx.get(actor.org, "proposal", id);
        check(
          p.version === version,
          "VERSION_CONFLICT",
          "Proposal changed.",
          409,
        );
        const evidence = await tx.get(
          actor.org,
          "verification",
          evidenceId,
          false,
        );
        check(
          evidence?.state === "completed",
          "CHECK_REQUIRED",
          "A completed verification is required.",
        );
        const c = p.conditions.find((c) => c.id === conditionId);
        check(c, "CONDITION", "Condition not found.");
        c.satisfied = true;
        c.evidenceId = evidenceId;
        const r = await tx.put(
          actor.org,
          "proposal",
          id,
          { ...p, state: p.authorization ? "requires_review" : p.state },
          version,
        );
        await tx.audit(actor.org, actor.id, "condition.updated", id, {
          conditionId,
          evidenceId,
        });
        return r;
      },
    );
  }
  async revise(actor,id,input,key){
    role(actor,['analyst',...COMMAND]);
    const {version,note, ...values}=input,d=proposalSchema.parse(values);
    check(typeof note==='string'&&note.trim().length>0,'REVISION_NOTE','Explain what changed.');
    return this.store.command(actor.org,key,{id,...input},async tx=>{
      const p=await tx.get(actor.org,'proposal',id);
      check(p.version===version,'VERSION_CONFLICT','This response changed. Read the latest version.',409);
      check(!p.executionResults?.length&&['awaiting_review','authorized','conditionally_authorized','needs_clarification','requires_review'].includes(p.state),'EXECUTION_STARTED','An issued operation requires a separate repair plan; editing cannot erase physical work.',409);
      for(const ref of d.references)check(await resolveEvidence(tx,actor.org,ref),'EVIDENCE','A cited source is unavailable.');
      for(const [i,a]of d.actions.entries()){check(a.dependsOn.every(j=>j<i),'DEPENDENCY_CYCLE','Action dependencies must refer to earlier steps.');check(a.owner===actor.org||this.config.peers.some(p=>p.org===a.owner),'OWNER','Unknown responsible owner.');}
      const conditions=await validateConditions(tx,actor.org,d.conditions);
      const result=await tx.put(actor.org,'proposal',id,{...p,...d,conditions,state:'awaiting_review',previousAuthorization:p.authorization??p.previousAuthorization,authorization:null,simId:null,dependencies:[...d.references,...d.conditions.map(c=>c.id)],changedReason:note,revisedBy:actor.id,revisionOf:version},version);
      await tx.audit(actor.org,actor.id,'proposal.revised',id,{from:version,note,oldPlanHash:hash(p.actions),newPlanHash:hash(d.actions),authorizationInvalidated:true});return result;
    });
  }
  async resource(actor, input, key) {
    // Imported quantities remain owned by the source. Local edits are local
    // inventory records, never evidence that physical external stock changed.
    role(actor, [...COMMAND, "admin"]);
    check(
      typeof input.type === "string" &&
        Number.isFinite(input.quantity) &&
        input.quantity >= 0,
      "RESOURCE",
      "Type and nonnegative quantity required.",
    );
    const { id = uid("resource"), version = 0, ...d } = input;
    return this.store.command(actor.org, key, input, async (tx) => {
      const old = await tx.get(actor.org, "resource", id, false);
      check(
        (old?.reserved ?? 0) <= d.quantity - (d.floor ?? 0),
        "RESOURCE_RESERVED",
        "Stock cannot be reduced below reservations and reserve floor.",
        409,
      );
      const r = await tx.put(
        actor.org,
        "resource",
        id,
        {
          ...old,
          ...d,
          owner: actor.org,
          reserved: old?.reserved ?? 0,
          floor: d.floor ?? 0,
        },
        version,
      );
      await tx.audit(actor.org, actor.id, "resource.updated", id, {
        quantity: d.quantity,
        version,
      });
      return r;
    });
  }
  async reserve(actor, input, key) {
    role(actor, COMMAND);
    const {
      resource,
      quantity,
      version,
      requester = actor.org,
      conditions = [],
      ttlMs = 900000,
    } = input;
    check(
      Number.isFinite(quantity) && quantity > 0,
      "QUANTITY",
      "Choose a positive quantity.",
    );
    check(
      ttlMs >= 1000 && ttlMs <= 86400000,
      "EXPIRY",
      "Reservation validity must be between one second and one day.",
    );
    return this.store.command(actor.org, key, input, async (tx) => {
      const r = await tx.get(actor.org, "resource", resource);
      check(
        r.version === version,
        "VERSION_CONFLICT",
        "Resource changed.",
        409,
      );
      check(
        r.quantity - r.reserved - r.floor >= quantity,
        "RESERVATION_CONFLICT",
        "Available stock is already committed or protected by a reserve floor.",
        409,
      );
      const id = uid("commitment"),
        expiresAt = Date.now() + ttlMs;
      for (const c of conditions) {
        check(
          c.id !== id,
          "DEPENDENCY_CYCLE",
          "A commitment cannot depend on itself.",
        );
        check(
          c.type !== "commitment" ||
            (await tx.get(actor.org, "commitment", c.id, false)),
          "CONDITION",
          "Commitment dependency must exist.",
        );
      }
      await tx.put(
        actor.org,
        "resource",
        resource,
        { ...r, reserved: r.reserved + quantity },
        r.version,
      );
      const result = await tx.put(
        actor.org,
        "commitment",
        id,
        {
          resource,
          quantity,
          requester,
          conditions,
          owner: actor.org,
          state: "reserved",
          expiresAt,
          authorizedBy: actor.id,
          ttlMs,
          sourceVersion: r.sourceVersion,
          sourceId: null,
          syncState: r.sourceSnapshot ? "pending" : "local",
        },
        0,
      );
      if (r.sourceSnapshot)
        await tx.enqueue(
          actor.org,
          "source_commitment",
          { id, action: "reserve" },
          "source_reserve_" + id,
        );
      await tx.enqueue(
        actor.org,
        "expire_commitment",
        { id },
        "expire_" + id,
        expiresAt,
      );
      await tx.audit(actor.org, actor.id, "commitment.reserved", id, {
        resource,
        quantity,
        requester,
        expiresAt,
      });
      return result;
    });
  }
  async commitment(actor, id, { action, version }, key) {
    role(actor, COMMAND);
    check(
      ["confirm", "withdraw", "release", "reject"].includes(action),
      "COMMITMENT_ACTION",
      "Invalid commitment action.",
    );
    return this.store.command(
      actor.org,
      key,
      { id, action, version },
      async (tx) => {
        const c = await tx.get(actor.org, "commitment", id);
        check(
          c.version === version,
          "VERSION_CONFLICT",
          "Commitment changed.",
          409,
        );
        check(
          c.expiresAt > Date.now() &&
            ["reserved", "offered", "confirmed"].includes(c.state),
          "COMMITMENT_STATE",
          "Commitment is no longer available.",
          409,
        );
        if (action === "confirm")
          check(
            !c.sourceVersion || c.syncState === "acknowledged",
            "RESERVATION_PENDING",
            "The system of record must acknowledge the hold before confirmation.",
            409,
          );
        if (action === "confirm")
          for (const condition of c.conditions) {
            const ref = await tx.get(
              actor.org,
              condition.type === "commitment" ? "commitment" : "verification",
              condition.id,
              false,
            );
            check(
              ref && ["confirmed", "completed"].includes(ref.state),
              "CONDITION",
              "A dependency is still unconfirmed.",
            );
          }
        const state =
          action === "confirm"
            ? "confirmed"
            : action === "withdraw"
              ? "withdrawn"
              : action === "release"
                ? "released"
                : "rejected";
        if (
          action !== "confirm" &&
          ["reserved", "confirmed"].includes(c.state)
        ) {
          const r = await tx.get(actor.org, "resource", c.resource);
          await tx.put(
            actor.org,
            "resource",
            r.id,
            { ...r, reserved: r.reserved - c.quantity },
            r.version,
          );
          await this.invalidateTx(
            tx,
            actor.org,
            c.id,
            "A commitment was " + state,
          );
        }
        const result = await tx.put(
          actor.org,
          "commitment",
          id,
          { ...c, state, syncState:c.sourceId?'pending':c.syncState },
          version,
        );
        await tx.audit(actor.org, actor.id, "commitment." + state, id, {});
        if (c.sourceId)
          await tx.enqueue(
            actor.org,
            "source_commitment",
            { id, action },
            "source_" + action + "_" + id,
          );
        return result;
      },
    );
  }
  async expire(org, id) {
    return this.store.transaction(async (tx) => {
      const c = await tx.get(org, "commitment", id, false);
      if (
        !c ||
        !["reserved", "confirmed"].includes(c.state) ||
        c.expiresAt > Date.now()
      )
        return { expired: false };
      const r = await tx.get(org, "resource", c.resource);
      await tx.put(
        org,
        "resource",
        r.id,
        { ...r, reserved: r.reserved - c.quantity },
        r.version,
      );
      await tx.put(
        org,
        "commitment",
        id,
        { ...c, state: "expired" },
        c.version,
      );
      await this.invalidateTx(tx, org, id, "Reservation expired");
      if(c.sourceId)await tx.enqueue(org,'source_commitment',{id,action:'release'},'source_release_'+id);
      await tx.audit(org, "system", "commitment.expired", id, {});
      return { expired: true };
    });
  }
  async invalidateTx(tx, org, dependency, reason) {
    const affected = [];
    for (const p of await tx.list(org, "proposal", 2000))
      if (
        p.dependencies.includes(dependency) &&
        !["rejected", "completed", "cancelled"].includes(p.state)
      ) {
        await tx.put(
          org,
          "proposal",
          p.id,
          {
            ...p,
            state: "requires_review",
            changedReason: reason,
            invalidatedDependency: dependency,
            previousAuthorization: p.authorization,
            authorization: null,
          },
          p.version,
        );
        affected.push(p.id);
      }
    for (const o of await tx.list(org, "operation", 2000))
      if (
        o.dependencies?.includes(dependency) &&
        !["completed", "cancelled", "failed"].includes(o.state)
      ) {
        await tx.put(
          org,
          "operation",
          o.id,
          { ...o, requiresRepair: true, changedReason: reason },
          o.version,
        );
        affected.push(o.id);
      }
    return affected;
  }
  async invalidate(actor, dependency, reason, key) {
    role(actor, ["analyst", ...COMMAND]);
    return this.store.command(
      actor.org,
      key,
      { dependency, reason },
      async (tx) => {
        const affected = await this.invalidateTx(
          tx,
          actor.org,
          dependency,
          reason,
        );
        await tx.audit(
          actor.org,
          actor.id,
          "dependency.invalidated",
          dependency,
          { affected, reason },
        );
        return { affected };
      },
    );
  }
  async report(actor, input, key) {
    role(actor, ["field", "analyst", ...COMMAND]);
    const d = fieldReport.parse(input);
    return this.store.command(
      actor.org,
      "field_" + d.clientId,
      d,
      async (tx) => {
        const r = await tx.put(
          actor.org,
          "report",
          d.clientId,
          { ...d, origin: actor.id, state: "received", receivedAt: Date.now() },
          0,
        );
        await tx.audit(actor.org, actor.id, "field.received", d.clientId, {
          kind: d.kind,
          observedAt: d.observedAt,
        });
        return r;
      },
    );
  }
  async draftPublication(actor, input, key) {
    role(actor, ["publisher", ...COMMAND]);
    check(
      typeof input.title === "string" && typeof input.text === "string",
      "PUBLICATION",
      "Title and update required.",
    );
    return this.store.command(actor.org, key, input, async (tx) => {
      const id = uid("publication");
      return tx.put(
        actor.org,
        "publication",
        id,
        {
          title: input.title.slice(0, 140),
          text: input.text.slice(0, 2000),
          area: input.area ?? "Response area",
          operationIds: input.operationIds ?? [],
          state: "draft",
          status: input.status ?? "support_needed",
          createdBy: actor.id,
        },
        0,
      );
    });
  }
  async publish(actor, id, { version }, key) {
    role(actor, ["publisher", ...COMMAND]);
    return this.store.command(actor.org, key, { id, version }, async (tx) => {
      const p = await tx.get(actor.org, "publication", id);
      check(
        p.version === version && p.state === "draft",
        "PUBLICATION_STATE",
        "Review the latest draft.",
        409,
      );
      check(
        !/\bsk-or-|api.?key|\bpassword\b|\bprivate\b/i.test(p.text),
        "PUBLIC_DATA",
        "The update contains restricted information.",
      );
      check(
        p.status !== "received" || p.operationIds.length > 0,
        "PREMATURE_PUBLICATION",
        "A received update must cite a confirmed operational receipt.",
      );
      for (const opid of p.operationIds) {
        const op = await tx.get(actor.org, "operation", opid);
        if (p.status === "received")
          check(
            ["received", "completed", "service"].includes(op.state) &&
              op.confirmedBySource === true,
            "PREMATURE_PUBLICATION",
            "Receipt has not been confirmed.",
          );
      }
      const result = await tx.put(
        actor.org,
        "publication",
        id,
        {
          ...p,
          state: "published",
          approvedBy: actor.id,
          publishedAt: Date.now(),
        },
        version,
      );
      await tx.audit(actor.org, actor.id, "publication.approved", id, {
        version,
        status: p.status,
      });
      return result;
    });
  }
}
