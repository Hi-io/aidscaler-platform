import { entityLabel, readableText, humanLabel } from "./labels.mjs";
import { operationChoiceLabel } from "./operation-view.mjs";

export const fieldTaskTitle = task => humanLabel(readableText(task.title || "Assigned field work"));
export const fieldTaskDestination = task => task.destinationName || entityLabel(task.destination) || "See operational instructions";
export const assignmentOperationLabel = operationChoiceLabel;
export function createWorkforceControls(h) {
  const {
    api,
    record,
    escape: e,
    action,
    badge,
    empty,
    title,
    state,
    modal,
    toast,
    render,
    offlineQueue,
  } = h;
  let editing,
    taskRows = [];
  const managers = () => ["commander", "dispatcher"].includes(state.user?.role);
  const opts = (rows, label) =>
    rows
      .map((r) => `<option value="${e(r.id)}">${e(label(r))}</option>`)
      .join("");
  const taskCache = () => `aidscaler-tasks:${state.user.org}:${state.user.id}`;
  async function field() {
    try {
      taskRows = await api("/api/tasks");
      localStorage.setItem(taskCache(), JSON.stringify(taskRows));
    } catch (err) {
      if (navigator.onLine) throw err;
      taskRows = JSON.parse(localStorage.getItem(taskCache()) || "[]");
    }
    const own = taskRows.filter(
      (t) => t.assignee === state.user.id && t.state !== "receipt_reported",
    );
    let handovers = [];
    if (navigator.onLine)
      handovers = (await api("/api/handovers")).filter(
        (r) => r.to === state.user.id && !r.acknowledgedAt,
      );
    const card = (t) =>
      `<article class="card"><div class="cardheader"><h2>${e(fieldTaskTitle(t))}</h2>${badge(t.state)}</div><p class="sub">${e(t.instructions || "Follow the received operational instructions. Report any change before proceeding.")}</p><p><strong>Destination</strong> ${e(fieldTaskDestination(t))}${t.quantity != null ? ` · ${e(t.quantity)} ${e(t.unit ?? "units")}` : ""}</p>${t.contact ? `<p class="small">Responsible contact: ${e(t.contact)}</p>` : ""}<div class="actions">${action("Open current task", "task-open", t.id, "primary")}</div><p class="note">${navigator.onLine ? "Last state acknowledged by the workspace." : "Saved task snapshot · new instructions may be pending."} A field report does not itself confirm physical receipt.</p></article>`;
    return `<div class="grid">${own[0] ? card(own[0]) : `<section class="inline-notice"><strong>No assigned task</strong><span>You can still report an observation below.</span></section>`}${handovers.length ? `<section class="card"><h2>Shift handover</h2>${handovers.map((r) => `<div class="listrow"><div class="grow"><p>${e(r.note)}</p><small>${r.tasks.length} tasks · ${r.proposals.length} decisions</small></div>${action("Acknowledge", "handover-ack", r.id)}</div>`).join("")}</section>` : ""}</div>${own.length > 1 ? `<details class="collapse"><summary>${own.length - 1} other assigned tasks</summary>${own.slice(1).map(card).join("")}</details>` : ""}`;
  }
  async function coordination() {
    const [tasks, grants, handovers] = await Promise.all([
      api("/api/tasks"),
      api("/api/delegations"),
      api("/api/handovers"),
    ]);
    return (
      title(
        "People & handovers",
        "Assign field work, hand over unresolved items and delegate one exact decision for a limited time.",
      ) +
      `<section class="card workforce-card"><div class="cardheader"><h2>Field assignments</h2>${managers() ? action("Assign an operation", "task-assign", "", "primary") : ""}</div>${
        tasks
          .slice(0, 8)
          .map(
            (t) =>
              `<div class="listrow"><div class="grow"><h3>${e(fieldTaskTitle(t))}</h3><p>${e(t.assigneeName)} · ${badge(t.state)}</p></div>${managers() && t.state !== "receipt_reported" ? action("Handover", "handover-task", t.id) : ""}</div>`,
          )
          .join("") ||
        empty(
          "Assignment follows an existing operation; it never creates a dispatch.",
        )
      }<details class="collapse"><summary>Field status and confirmed aid are different</summary><p class="sub">Acknowledgement, departure, arrival and receipt reports are signed by the assigned person. Actual stock, people arriving and service remain confirmed by the source system. A shift handover requires a new acknowledgement and transfers no approval.</p></details></section>` +
      `<section class="card workforce-card"><div class="cardheader"><h2>Decision delegates</h2>${managers() ? action("Delegate a decision", "delegation-new", "", "accent") : ""}</div>${
        grants
          .slice(0, 8)
          .map(
            (g) =>
              `<div class="listrow"><div class="grow"><h3>Proposal ${e(g.proposal.slice(-8))}</h3><p>${e(g.note)}</p><small>Exact version ${g.proposalVersion} · expires ${e(new Date(g.expiresAt).toLocaleTimeString())}</small></div>${badge(g.expiresAt <= Date.now() ? "expired" : g.state)}${managers() && g.state === "active" ? action("Revoke", "delegation-revoke", g.id) : action("Open decision", "proposal", g.proposal)}</div>`,
          )
          .join("") || empty("No review authority has been delegated.")
      }</section>` +
      `<details class="collapse"><summary>Shift handovers · ${handovers.length} records</summary>${managers() ? action("Handover a pending decision", "handover-proposal", "", "accent") : ""}${handovers.map((r) => `<div class="listrow"><div class="grow"><p>${e(r.note)}</p><small>${r.tasks.length} tasks · ${r.proposals.length} decisions · ${r.acknowledgedAt ? "acknowledged" : "awaiting receiver"}</small></div>${r.to === state.user.id && !r.acknowledgedAt ? action("Acknowledge", "handover-ack", r.id) : ""}</div>`).join("")}</details>`
    );
  }
  async function run(name, id) {
    if (name === "task-open") {
      const t = taskRows.find((t) => t.id === id);
      if (!t)
        throw Error("Refresh your assigned tasks before opening this item.");
      editing = { type: "update", task: t };
      const stages =
        {
          assigned: ["acknowledged", "problem"],
          acknowledged: ["departed", "arrived", "problem"],
          departed: ["arrived", "problem"],
          arrived: ["receipt_reported", "problem"],
          problem: ["acknowledged", "departed", "arrived"],
        }[t.state] ?? [];
      modal(
        "Your current field task",
        `<h2>${e(fieldTaskTitle(t))}</h2><p class="sub">${e(t.instructions || "Use your operational instructions.")}</p><p>${badge(t.state)} · last server version ${t.version}</p><form id="taskupdateform" class="fieldform"><label>Report the next stage<select name="stage">${stages.map((s) => `<option value="${s}">${e(humanLabel(s))}</option>`).join("")}</select></label><label>Observation or discrepancy<textarea name="note" maxlength="1200" placeholder="Keep names and affected people's details out of the report."></textarea></label><label data-task-received hidden>Received quantity${t.unit ? " (" + e(t.unit) + ")" : ""}<input name="quantity" type="number" min="0" max="${t.quantity ?? ""}" step="1"></label><button class="primary">Save & send update</button><p class="note">Offline updates are saved with the assignment version. A changed assignment requires review; it is never silently overwritten.</p></form>`,
        action("Close", "close"),
      );
      return true;
    }
    if (name === "task-assign") {
      const [people, ops, needs, resources, vehicles] = await Promise.all([
        api("/api/people"),
        record("operation"),
        record("need"),
        record("resource"),
        record("vehicle"),
      ]);
      const existing = await api("/api/tasks");
      const candidates = ops.filter(
        (o) =>
          !["failed", "cancelled"].includes(o.state) &&
          !existing.some((t) => t.operation === o.id) &&
          (!id || o.id === id),
      );
      if (!candidates.length) {
        const assigned = id && existing.some(task => task.operation === id);
        modal("Assign received operational work", `<p class="sub">${assigned ? "This operation already has a field task. Review People & handovers to manage its reporting responsibility." : "No operations are available for a new assignment. Follow a received operation to assign its reporting responsibility."}</p>`, action("Close", "close"));
        return true;
      }
      editing = { type: "assign" };
      modal(
        "Assign received operational work",
        `<form id="coordinationform" class="fieldform"><label for="assignment-operation">Existing operation<select id="assignment-operation" name="operation" required>${opts(candidates, (o) => assignmentOperationLabel(o, { needs, resources, vehicles, organization: state.user.org }))}</select></label><label for="assignment-person">Assigned person<select id="assignment-person" name="assignee" required>${opts(
          people.filter((p) =>
            ["field", "commander", "dispatcher"].includes(p.role),
          ),
          (p) => `${p.name} · ${p.role}`,
        )}</select></label><label>Short instructions<textarea name="instructions" maxlength="1200" required></textarea></label><label>Responsible contact<input name="contact" maxlength="160"></label><button class="primary" ${candidates.length ? "" : "disabled"}>Assign task</button><p class="note">This assigns reporting responsibility. It does not dispatch a new vehicle.</p></form>`,
      );
      return true;
    }
    if (
      ["delegation-new", "handover-task", "handover-proposal"].includes(name)
    ) {
      const [people, items] = await Promise.all([
        api("/api/people"),
        name === "handover-task" ? api("/api/tasks") : record("proposal"),
      ]);
      const candidates =
        name === "handover-task"
          ? items.filter((t) => t.id === id)
          : items.filter((p) =>
              [
                "awaiting_review",
                "requires_review",
                "needs_clarification",
              ].includes(p.state),
            );
      editing = { type: name, items: candidates };
      const roles =
        name === "delegation-new"
          ? ["analyst", "commander", "dispatcher"]
          : name === "handover-task"
            ? ["field", "commander", "dispatcher"]
            : ["commander", "dispatcher"];
      modal(
        name === "delegation-new"
          ? "Delegate one exact review"
          : "Handover pending work",
        `<form id="coordinationform" class="fieldform"><label>Current item<select name="item" required>${opts(candidates, (p) => name === "handover-task" ? fieldTaskTitle(p) : readableText(p.title ?? p.id))}</select></label><label>Receiving person<select name="to" required>${opts(
          people.filter((p) => roles.includes(p.role)),
          (p) => `${p.name} · ${p.role}`,
        )}</select></label>${name === "delegation-new" ? '<label>Expiry<select name="ttlMs"><option value="1800000">30 minutes</option><option value="3600000">1 hour</option><option value="14400000">4 hours</option></select></label>' : ""}<label>Pending conditions and responsibility<textarea name="note" required minlength="5" maxlength="1200"></textarea></label><button class="primary" ${candidates.length ? "" : "disabled"}>Record scoped ${name === "delegation-new" ? "delegation" : "handover"}</button><p class="note">${name === "delegation-new" ? "A revised proposal needs a new delegation. The model and technical administrator cannot approve." : "The receiver must acknowledge. Existing approvals are not transferred."}</p></form>`,
      );
      return true;
    }
    if (name === "delegation-revoke") {
      const g = (await api("/api/delegations")).find((g) => g.id === id);
      await api("/api/delegation/revoke", { id, version: g.version });
      toast("Delegation revoked. Dependent future actions require review.");
      await render();
      return true;
    }
    if (name === "handover-ack") {
      const g = (await api("/api/handovers")).find((g) => g.id === id);
      await api("/api/handover/acknowledge", { id, version: g.version });
      toast("Handover acknowledged. No new approval was created.");
      await render();
      return true;
    }
    return false;
  }
  function bind(root) {
    root
      .querySelector("#coordinationform")
      ?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const b = Object.fromEntries(new FormData(ev.target));
        const button = ev.target.querySelector(
          "button[type=submit],button.primary",
        );
        button.disabled = true;
        try {
          if (editing.type === "assign") await api("/api/task/assign", b);
          else {
            const item = editing.items.find((p) => p.id === b.item);
            if (editing.type === "delegation-new")
              await api("/api/delegation", {
                proposal: item.id,
                version: item.version,
                to: b.to,
                ttlMs: Number(b.ttlMs),
                note: b.note,
              });
            else
              await api("/api/handover", {
                to: b.to,
                note: b.note,
                tasks: editing.type === "handover-task" ? [item.id] : [],
                proposals:
                  editing.type === "handover-proposal" ? [item.id] : [],
                versionById: { [item.id]: item.version },
              });
          }
          await h.close();
          toast("Responsibility recorded with its scope.");
          await render();
        } catch (err) {
          toast(err.message);
          button.disabled = false;
        }
      });
    const taskForm = root.querySelector("#taskupdateform");
    if (taskForm) {
      const updateReceipt = () => {
        const receipt = taskForm.elements.stage.value === "receipt_reported";
        taskForm.querySelector("[data-task-received]").hidden = !receipt;
        taskForm.elements.quantity.required = receipt;
        taskForm.elements.note.required = receipt;
      };
      taskForm.elements.stage.addEventListener("change",updateReceipt);
      updateReceipt();
    }
    taskForm?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const button = ev.target.querySelector("button[type=submit],button:not([type])");
        if (button.disabled) return;
        button.disabled = true;
        let saved = false;
        try {
        const b = Object.fromEntries(new FormData(ev.target)),
          t = editing.task,
          clientId = crypto.randomUUID();
        const payload = {
          id: t.id,
          version: t.version,
          stage: b.stage,
          note: b.note,
          ...(b.stage === "receipt_reported" && b.quantity !== "" ? { quantity: Number(b.quantity) } : {}),
        };
        await offlineQueue("put", {
          clientId,
          queueOrg: state.user.org,
          queueActor: state.user.id,
          queueKind: "task",
          taskPayload: payload,
          location: t.destinationName || t.destination || t.title,
          text: b.stage.replaceAll("_", " ") + ": " + b.note,
        });
        saved = true;
        toast("Saved on this device. Awaiting server acknowledgement.");
        await h.flush();
        } catch (error) {
          toast(error.message);
          if (!saved) button.disabled = false;
        }
        if (saved) {
          if (taskForm.isConnected) await h.close();
          try { await h.refreshFieldOutbox(); }
          catch { toast("Your update is saved. Reopen the outbox to check its delivery status."); }
        }
      });
  }
  return { field, coordination, run, bind };
}
