export function createCaseControls(h) {
  const {
    api,
    record,
    escape: e,
    action,
    state,
    modal,
    toast,
    render,
    close,
  } = h;
  const allowed = () =>
    ["analyst", "commander", "dispatcher"].includes(state.user.role);
  let editing;
  async function context(id) {
    if (!allowed()) return "";
    const [claims, groups] = await Promise.all([
      record("claim"),
      record("evidence_group"),
    ]);
    const linked = claims.filter((c) => (c.references ?? []).includes(id));
    const active = groups.filter(
      (g) => g.state === "active" && g.members.includes(id),
    );
    return `<details class="collapse"><summary>Review interpretations & evidence grouping</summary><p class="note">Corrections preserve original sources and physical demand. Dependent plans return for review.</p>${linked
      .slice(0, 8)
      .map(
        (c) =>
          `<div class="case-row"><p>${e(c.text)}</p>${action("Correct interpretation", "claim-correct", c.id)}</div>`,
      )
      .join("")}${active
      .slice(0, 8)
      .map(
        (g) =>
          `<div class="case-row"><p>${e(g.label)} · ${g.members.length} sources</p>${action("Review grouping", "group-edit", g.id)}</div>`,
      )
      .join(
        "",
      )}${action("Group related evidence", "group-new", id, "accent")}</details>`;
  }
  async function groupForm(group, selected = []) {
    const signals = await record("signal");
    const rows = signals.slice(0, 60);
    for (const id of group?.members ?? selected)
      if (!rows.some((r) => r.id === id)) rows.unshift({ id, text: id });
    const chosen = group?.members ?? selected;
    editing = group;
    modal(
      group ? "Review evidence grouping" : "Group related evidence",
      `<form id="group-editor" class="fieldform"><label>Concise incident label<input name="label" maxlength="160" minlength="3" required value="${e(group?.label ?? "")}"></label><details class="collapse" open><summary>Select original sources</summary><div class="source-picker">${rows.map((r) => `<label class="checkbox"><input type="checkbox" name="member" value="${e(r.id)}" ${chosen.includes(r.id) ? "checked" : ""}>${e((r.text ?? r.id).slice(0, 140))}</label>`).join("")}</div></details><label>Why do these sources belong together?<textarea name="reason" minlength="3" maxlength="600" required></textarea></label><p class="note">Grouping is an interpretation, not verification. It does not combine physical need quantities or discard original sources.</p><button class="primary">Save reviewed grouping</button></form>${group ? `<div class="actions">${action("Separate into two incidents", "group-split", group.id)}${action("Restore a previous grouping", "group-restore", group.id)}</div>` : ""}`,
    );
  }
  async function run(name, id) {
    if (!allowed()) return false;
    if (name === "group-new") {
      await groupForm(null, [id]);
      return true;
    }
    if (name === "group-edit") {
      await groupForm(await record("evidence_group", id));
      return true;
    }
    if (name === "claim-correct") {
      editing = await record("claim", id);
      modal(
        "Correct an interpretation",
        `<form id="claim-editor" class="fieldform"><label>Interpretation<textarea name="text" required maxlength="4000">${e(editing.text)}</textarea></label><label>Evidence status<select name="state"><option value="pending">Pending</option><option value="inferred">Inferred</option><option value="observed">Observed</option><option value="confirmed">Human confirmed</option><option value="contradicted">Contradicted</option><option value="expired">Expired</option></select></label><label>Correction reason<textarea name="reason" required minlength="3" maxlength="600"></textarea></label><details class="collapse"><summary>Retained original references</summary><p class="small">${editing.references.map(e).join(" · ")}</p></details><p class="note">This records your interpretation and invalidates dependent authorizations. It does not certify the source or change a physical receipt.</p><button class="primary">Record correction</button></form>`,
      );
      const states = document.querySelector('[name="state"]');
      if ([...states.options].some((o) => o.value === editing.state))
        states.value = editing.state;
      return true;
    }
    if (name === "group-split") {
      editing = await record("evidence_group", id);
      modal(
        "Separate evidence into two incidents",
        `<form id="group-split-form" class="fieldform"><label>First incident<input name="first" required minlength="3" maxlength="160"></label><label>Second incident<input name="second" required minlength="3" maxlength="160"></label><details class="collapse" open><summary>Move selected sources to the second incident</summary><div class="source-picker">${editing.members.map((m) => `<label class="checkbox"><input type="checkbox" name="member" value="${e(m)}">${e(m)}</label>`).join("")}</div></details><label>Separation reason<textarea name="reason" required minlength="3" maxlength="600"></textarea></label><p class="note">Unchecked sources stay in the first incident. Both incidents must retain at least one source.</p><button class="primary">Separate and retain history</button></form>`,
      );
      return true;
    }
    if (name === "group-restore") {
      editing = await record("evidence_group", id);
      const history = (await record("group_history")).filter(
        (r) => r.snapshot.id === id,
      );
      modal(
        "Restore an earlier interpretation",
        `<form id="group-restore-form" class="fieldform"><label>Historical grouping<select name="historyVersion">${history.map((r) => `<option value="${r.snapshot.version}">Version ${r.snapshot.version} · ${e(r.snapshot.label)}</option>`).join("")}</select></label><label>Reason for restoration<textarea name="reason" required minlength="3" maxlength="600"></textarea></label><p class="note">Restoration creates a new version. Split histories and original records are never erased.</p><button class="primary" ${history.length ? "" : "disabled"}>Restore as a new version</button></form>`,
      );
      return true;
    }
    return false;
  }
  function bind(root) {
    const on = (selector, fn) =>
      root.querySelector(selector)?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const button = ev.target.querySelector("button");
        button.disabled = true;
        try {
          await fn(new FormData(ev.target));
          await close();
          toast("Evidence interpretation recorded with its history.");
          await render();
        } catch (err) {
          toast(err.message);
          button.disabled = false;
        }
      });
    on("#group-editor", (d) =>
      api("/api/evidence/group", {
        label: d.get("label"),
        members: d.getAll("member"),
        reason: d.get("reason"),
        ...(editing ? { id: editing.id, version: editing.version } : {}),
      }),
    );
    on("#claim-editor", (d) =>
      api("/api/claim/correct", {
        id: editing.id,
        version: editing.version,
        text: d.get("text"),
        state: d.get("state"),
        reason: d.get("reason"),
      }),
    );
    on("#group-split-form", (d) => {
      const second = d.getAll("member"),
        first = editing.members.filter((m) => !second.includes(m));
      if (!first.length || !second.length)
        throw new Error("Each incident must retain at least one source.");
      return api("/api/evidence/split", {
        id: editing.id,
        version: editing.version,
        reason: d.get("reason"),
        partitions: [
          { label: d.get("first"), members: first },
          { label: d.get("second"), members: second },
        ],
      });
    });
    on("#group-restore-form", (d) =>
      api("/api/evidence/group/restore", {
        id: editing.id,
        version: editing.version,
        historyVersion: Number(d.get("historyVersion")),
        reason: d.get("reason"),
      }),
    );
  }
  return { context, run, bind };
}
