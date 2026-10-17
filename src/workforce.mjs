import { check, role } from "./errors.mjs";
import { hash, uid } from "./store.mjs";

const MANAGERS = ["commander", "dispatcher"];
const FIELD = ["field", "commander", "dispatcher"];
const STAGES = {
  assigned: ["acknowledged", "problem"],
  acknowledged: ["departed", "arrived", "problem"],
  departed: ["arrived", "problem"],
  arrived: ["receipt_reported", "problem"],
  problem: ["acknowledged", "departed", "arrived"],
  receipt_reported: [],
};
const taskActionNames = { delivery: 'Delivery', dispatch: 'Delivery', evacuation: 'Evacuation', evacuate: 'Evacuation', inspection: 'Field assessment', assessment: 'Field assessment', verify: 'Field assessment', repair: 'Road repair' };
const placeName = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
function assignmentPlaces(map) {
  const names = new Map(), nodes = new Map((map?.nodes ?? []).map(node => [node.id, node]));
  for (const place of map?.places ?? []) {
    const nodeName = placeName(nodes.get(place.node)?.name),
      name = placeName(place.name ?? place.label) ?? nodeName?.replace(/ Junction$/, '');
    if (name) { names.set(place.id, name); if (place.node && !names.has(place.node)) names.set(place.node, name); }
  }
  for (const node of nodes.values()) if (placeName(node.name)) names.set(node.id, placeName(node.name));
  return names;
}
function namedAssignment(task, operation, names, resource) {
  const destinationName = placeName(task.destinationName) ??
    [operation?.building, operation?.to, operation?.destination, task.destination].map(id => names.get(id)).find(Boolean) ?? null;
  const originName = placeName(task.originName) ?? names.get(task.origin) ?? null;
  const type = typeof operation?.type === 'string' && operation.type ? operation.type : 'Operation',
    action = taskActionNames[type] ?? (type[0]?.toUpperCase() + type.slice(1).replaceAll('_', ' ')),
    legacyTitle = `${type} · ${task.destination ?? 'Assigned destination'}`,
    title = task.title && task.title !== legacyTitle ? task.title : destinationName ? `${action} to ${destinationName}` : `${action} · Assigned destination`;
  // Only this assignment's names and units cross the field-role boundary.
  // Directory geometry, other sites and inventory remain private to operators.
  return { ...task, title, destinationName, originName, unit: task.unit ?? resource?.unit ?? null };
}
export class Workforce {
  constructor(store, domain) {
    Object.assign(this, { store, domain });
  }
  async people(actor) {
    role(actor, MANAGERS);
    return (
      await this.store.query(
        "SELECT id,name,role FROM users WHERE org=$1 AND active=true ORDER BY name",
        [actor.org],
      )
    ).rows;
  }
  async target(tx, org, id, allowed = FIELD) {
    const u = (
      await tx.query(
        "SELECT id,name,role,active FROM users WHERE org=$1 AND id=$2",
        [org, id],
      )
    ).rows[0];
    check(
      u?.active && allowed.includes(u.role),
      "ASSIGNEE",
      "Choose an active person in this organization with the required operational role.",
    );
    return u;
  }
  async tasks(actor) {
    role(actor, [...FIELD, "analyst", "auditor"]);
    const rows = (
      await this.store.query(
        "SELECT id FROM entities WHERE org=$1 AND kind='task' AND ($2::boolean OR data->>'assignee'=$3) ORDER BY created_at DESC LIMIT 100",
        [actor.org, actor.role !== "field", actor.id],
      )
    ).rows;
    const tasks = await Promise.all(rows.map(r => this.store.get(actor.org, "task", r.id)));
    if (tasks.every(task => task.destinationName && task.unit)) return tasks;
    const directory = await this.store.get(actor.org, 'context', 'geography', false),
      names = assignmentPlaces(directory?.map),
      operations = await this.store.getMany(actor.org, 'operation', [...new Set(tasks.map(task => task.operation).filter(Boolean))]),
      resources = await this.store.getMany(actor.org, 'resource', [...new Set([...operations.values()].map(operation => operation.resource).filter(Boolean))]);
    return tasks.map(task => namedAssignment(task, operations.get(task.operation), names, resources.get(operations.get(task.operation)?.resource)));
  }
  async assign(
    actor,
    { operation, assignee, contact = "", instructions = "" },
    key,
  ) {
    role(actor, MANAGERS);
    check(
      typeof contact === "string" &&
        contact.length <= 160 &&
        typeof instructions === "string" &&
        instructions.length <= 1200,
      "INSTRUCTIONS",
      "Keep field instructions brief.",
    );
    return this.store.command(
      actor.org,
      key,
      { operation, assignee, contact, instructions },
      async (tx) => {
        const person = await this.target(tx, actor.org, assignee);
        const o = await tx.get(actor.org, "operation", operation);
        check(
          !o.owner || o.owner === actor.org,
          "OWNER",
          "Only the operation owner assigns its field task.",
          403,
        );
        check(
          !["failed", "cancelled"].includes(o.state),
          "OPERATION_STATE",
          "Do not assign a failed or cancelled operation.",
          409,
        );
        const id = "task_" + operation,
          old = await tx.get(actor.org, "task", id, false);
        check(
          !old,
          "TASK_EXISTS",
          "This operation already has a task. Use an explicit handover to change its responsible person.",
          409,
        );
        const directory = await tx.get(actor.org, 'context', 'geography', false),
          names = assignmentPlaces(directory?.map),
          resource = o.resource ? await tx.get(actor.org, 'resource', o.resource, false) : null;
        const task = await tx.put(
          actor.org,
          "task",
          id,
          namedAssignment({
            operation,
            assignee,
            assigneeName: person.name,
            assignedBy: actor.id,
            origin: o.from ?? null,
            destination: o.to ?? o.destination ?? o.building ?? null,
            quantity: o.quantity ?? null,
            unit: o.unit ?? null,
            instructions,
            contact,
            state: "assigned",
            timeline: [],
            sourceStateAtAssignment: o.state,
            note: "Task status is a field report. Operational receipt and service are confirmed separately by the source.",
          }, o, names, resource),
          0,
        );
        await tx.audit(actor.org, actor.id, "task.assigned", id, {
          operation,
          assignee,
        });
        return task;
      },
    );
  }
  async update(
    actor,
    { id, version, stage, note = "", quantity, evidence = [] },
    key,
  ) {
    role(actor, FIELD);
    check(
      typeof note === "string" &&
        note.length <= 1200 &&
        Array.isArray(evidence) &&
        evidence.length <= 4,
      "REPORT",
      "Use a short note and at most four evidence attachments.",
    );
    return this.store.command(
      actor.org,
      key,
      { id, version, stage, note, quantity, evidence },
      async (tx) => {
        const t = await tx.get(actor.org, "task", id);
        check(
          t.assignee === actor.id,
          "TASK_OWNER",
          "Only the assigned person can acknowledge or report this task.",
          403,
        );
        check(
          t.version === version,
          "VERSION_CONFLICT",
          "The assignment changed. Read the current task before sending this update.",
          409,
        );
        check(
          STAGES[t.state]?.includes(stage),
          "TASK_TRANSITION",
          "That field stage does not follow the last received update.",
          409,
        );
        if (stage === "receipt_reported") {
          check(
            Number.isSafeInteger(quantity) &&
              quantity >= 0 &&
              (t.quantity == null || quantity <= t.quantity),
            "QUANTITY",
            "Report a nonnegative received quantity no larger than the assigned load.",
          );
          check(
            note.trim().length > 0,
            "RECEIPT_NOTE",
            "Describe the receiving team or any discrepancy without identifying affected people.",
          );
        }
        for (const ref of evidence) await tx.get(actor.org, "media", ref);
        const reportId = uid("fieldtask");
        const report = await tx.put(
          actor.org,
          "report",
          reportId,
          {
            clientId: reportId,
            kind: stage === "receipt_reported" ? "receipt" : "task",
            task: id,
            operation: t.operation,
            location: t.destination ?? "Assigned operation",
            text: note || stage.replaceAll("_", " "),
            quantity: quantity ?? null,
            evidence,
            observedAt: Date.now(),
            origin: actor.id,
            state: "received",
            receivedAt: Date.now(),
            physicalConfirmation: false,
          },
          0,
        );
        if (note.trim() || ["receipt_reported", "problem"].includes(stage))
          await this.domain.stageReport(tx, actor.org, report);
        const updated = await tx.put(
          actor.org,
          "task",
          id,
          {
            ...t,
            state: stage,
            timeline: [
              ...t.timeline,
              {
                stage,
                at: Date.now(),
                by: actor.id,
                note,
                quantity: quantity ?? null,
                evidence,
                reportId,
              },
            ],
            reportedQuantity:
              stage === "receipt_reported" ? quantity : t.reportedQuantity,
          },
          version,
        );
        await tx.audit(actor.org, actor.id, "task." + stage, id, {
          operation: t.operation,
          reportId,
          physicalConfirmation: false,
        });
        return updated;
      },
    );
  }
  async handover(
    actor,
    { tasks = [], proposals = [], to, note, versionById = {} },
    key,
  ) {
    role(actor, MANAGERS);
    check(
      Array.isArray(tasks) &&
        Array.isArray(proposals) &&
        tasks.length + proposals.length > 0 &&
        tasks.length + proposals.length <= 30,
      "HANDOVER",
      "Select between one and thirty explicit pending items.",
    );
    check(
      typeof note === "string" &&
        note.trim().length >= 5 &&
        note.length <= 1200,
      "HANDOVER_NOTE",
      "Record the pending conditions and reason for the handover.",
    );
    return this.store.command(
      actor.org,
      key,
      { tasks, proposals, to, note, versionById },
      async (tx) => {
        const person = await this.target(
          tx,
          actor.org,
          to,
          tasks.length ? FIELD : MANAGERS,
        );
        if (proposals.length)
          check(
            MANAGERS.includes(person.role),
            "ASSIGNEE",
            "Decision handovers need a coordinator or dispatcher.",
          );
        const id = uid("handover");
        for (const taskId of tasks) {
          const t = await tx.get(actor.org, "task", taskId);
          check(
            t.version === versionById[taskId] && t.state !== "receipt_reported",
            "VERSION_CONFLICT",
            "A selected task changed or was already reported complete.",
            409,
          );
          await tx.put(
            actor.org,
            "task",
            taskId,
            {
              ...t,
              assignee: to,
              assigneeName: person.name,
              state: "assigned",
              previousStage: t.state,
              timeline: [
                ...t.timeline,
                {
                  stage: "handover",
                  at: Date.now(),
                  by: actor.id,
                  from: t.assignee,
                  to,
                  note,
                },
              ],
              handover: id,
            },
            t.version,
          );
        }
        for (const pId of proposals) {
          const p = await tx.get(actor.org, "proposal", pId);
          check(
            p.version === versionById[pId] &&
              !["completed", "rejected", "cancelled"].includes(p.state),
            "VERSION_CONFLICT",
            "A selected decision changed or is no longer pending.",
            409,
          );
          await tx.put(
            actor.org,
            "proposal",
            pId,
            { ...p, responsibleUser: to, handover: id },
            p.version,
          );
        }
        const row = await tx.put(
          actor.org,
          "handover",
          id,
          {
            from: actor.id,
            to,
            tasks,
            proposals,
            note,
            receivedAt: Date.now(),
            acknowledgedAt: null,
            noteOnAuthority:
              "Handover does not create an approval or transfer another person's authorization.",
          },
          0,
        );
        await tx.audit(actor.org, actor.id, "handover.created", id, {
          to,
          tasks,
          proposals,
        });
        return row;
      },
    );
  }
  async acknowledgeHandover(actor, { id, version }, key) {
    return this.store.command(actor.org, key, { id, version }, async (tx) => {
      const h = await tx.get(actor.org, "handover", id);
      check(
        h.to === actor.id,
        "HANDOVER_OWNER",
        "Only the receiving person can acknowledge this handover.",
        403,
      );
      const row = await tx.put(
        actor.org,
        "handover",
        id,
        { ...h, acknowledgedAt: Date.now() },
        version,
      );
      await tx.audit(actor.org, actor.id, "handover.acknowledged", id, {});
      return row;
    });
  }
  async delegate(actor, { proposal, version, to, ttlMs = 1800000, note }, key) {
    role(actor, MANAGERS);
    check(
      Number.isSafeInteger(ttlMs) && ttlMs >= 1000 && ttlMs <= 28800000,
      "EXPIRY",
      "Delegations expire within eight hours.",
    );
    check(
      typeof note === "string" &&
        note.trim().length >= 5 &&
        note.length <= 1200,
      "DELEGATION_NOTE",
      "Explain the review responsibility.",
    );
    return this.store.command(
      actor.org,
      key,
      { proposal, version, to, ttlMs, note },
      async (tx) => {
        await this.target(tx, actor.org, to, ["analyst", ...MANAGERS]);
        const p = await tx.get(actor.org, "proposal", proposal);
        check(
          p.version === version &&
            [
              "awaiting_review",
              "needs_clarification",
              "requires_review",
            ].includes(p.state),
          "VERSION_CONFLICT",
          "Delegate a current proposal waiting for review.",
          409,
        );
        const id = uid("delegation"),
          grant = await tx.put(
            actor.org,
            "delegation",
            id,
            {
              proposal,
              proposalVersion: version,
              to,
              grantedBy: actor.id,
              planHash: hash(p.actions),
              expiresAt: Date.now() + ttlMs,
              state: "active",
              note,
            },
            0,
          );
        await tx.audit(actor.org, actor.id, "authority.delegated", id, {
          proposal,
          version,
          to,
          expiresAt: grant.expiresAt,
        });
        return grant;
      },
    );
  }
  async revoke(actor, { id, version }, key) {
    role(actor, MANAGERS);
    return this.store.command(actor.org, key, { id, version }, async (tx) => {
      const g = await tx.get(actor.org, "delegation", id);
      const row = await tx.put(
        actor.org,
        "delegation",
        id,
        { ...g, state: "revoked", revokedBy: actor.id },
        version,
      );
      await this.domain.invalidateTx(
        tx,
        actor.org,
        id,
        "The decision delegation was revoked",
        actor.id,
      );
      await tx.audit(actor.org, actor.id, "authority.revoked", id, {
        proposal: g.proposal,
      });
      return row;
    });
  }
  async grants(actor) {
    const all = await this.store.list(actor.org, "delegation", 500);
    return all.filter(
      (g) => MANAGERS.includes(actor.role) || g.to === actor.id,
    );
  }
  async handovers(actor) {
    const all = await this.store.list(actor.org, "handover", 100);
    return all.filter(
      (g) =>
        MANAGERS.includes(actor.role) ||
        g.to === actor.id ||
        g.from === actor.id,
    );
  }
}
