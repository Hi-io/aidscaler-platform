export function createPublicationControls(h) {
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
    close,
  } = h;
  let current;
  const allowed = () =>
    ["publisher", "commander", "dispatcher"].includes(state.user.role);
  const options = (rows, label) =>
    rows
      .map((r) => `<option value="${e(r.id)}">${e(label(r))}</option>`)
      .join("");
  async function view() {
    const rows = await record("publication");
    return (
      title(
        "Transparency that earns trust.",
        "Approved progress, useful evidence and clear limits. Internal drafts never appear in the public portal.",
        allowed()
          ? action("Prepare an update", "publication-new", "", "primary")
          : "",
      ) +
      `<div class="grid cols2">${
        rows
          .slice(0, 20)
          .map(
            (p) =>
              `<article class="card"><div class="cardheader">${badge(p.state)}${badge(p.status)}</div><h2>${e(p.title)}</h2><p class="sub">${e(p.text)}</p><p class="note">${e(p.area)} · ${(p.proofIds ?? []).length} reviewed photo proofs</p>${allowed() ? `<div class="actions">${p.state === "draft" ? action("Review & publish", "publication-review", p.id, "primary") : p.state === "published" ? action("Prepare correction", "publication-correct", p.id, "accent") + action("Withdraw update", "publication-withdraw", p.id) : ""}</div>` : ""}</article>`,
          )
          .join("") ||
        `<section class="card">${empty("No update is public until a responsible person reviews it.", "globe")}</section>`
      }</div>${allowed() ? `<div class="toolbar" style="margin-top:24px">${action("Review a delivery photo", "publication-photo", "", "accent")}<span class="small">Photos require a confirmed receipt and a human privacy review.</span></div>` : ""}`
    );
  }
  async function prepare(p = null) {
    const [ops, proofs] = await Promise.all([
      record("operation"),
      record("public_evidence"),
    ]);
    current = p;
    modal(
      p ? "Correct a public update" : "Prepare a public update",
      `<form id="publication-editor" class="fieldform"><label>Title<input name="title" value="${e(p?.title ?? "")}" required maxlength="140"></label><label>Approximate public area<input name="area" value="${e(p?.area ?? "")}" required></label><label>Public status<select name="status"><option value="support_needed">Support needed</option><option value="en_route">On the way</option><option value="received">Received</option></select></label><label>Operational reference<select name="operation"><option value="">No operational claim yet</option>${options(
        ops.filter((o) => o.confirmedBySource),
        (o) => `${o.id} · ${o.state} · ${o.received ?? 0} received`,
      )}</select></label><p class="note">On the way and Received require a current source-confirmed reference. They are not inferred from an authorization.</p><label>Public explanation<textarea name="text" required maxlength="2000">${e(p?.text ?? "")}</textarea></label><details class="collapse"><summary>Add reviewed delivery photos</summary>${
        proofs
          .filter((f) => f.state === "approved")
          .slice(0, 12)
          .map(
            (f) =>
              `<label class="checkbox"><input type="checkbox" name="proof" value="${e(f.id)}">${e(f.caption)} · ${e(f.operationId)}</label>`,
          )
          .join("") ||
        '<p class="small">Review a photo before attaching it to an update.</p>'
      }<p class="note">Up to three, each linked to the cited operation.</p></details><button class="primary">Save internal draft</button></form><p class="note">${p ? "The previous update remains public until this correction is reviewed and published." : "Drafts stay private until reviewed. Omit personal details and sensitive locations."}</p>`,
    );
    if (p) {
      document.querySelector('[name="status"]').value = p.status;
      document.querySelector('[name="operation"]').value =
        p.operationIds[0] ?? "";
    }
  }
  async function run(name, id) {
    if (name === "publication-new" || name === "draftpublication") {
      await prepare();
      return true;
    }
    if (name === "publication-correct") {
      await prepare(await record("publication", id));
      return true;
    }
    if (name === "publication-review") {
      current = await record("publication", id);
      modal(
        "Approve a public update",
        `<h2>${e(current.title)}</h2>${badge(current.status)}<p class="sub">${e(current.text)}</p><p class="note">${current.operationIds.length} operational references · ${(current.proofIds ?? []).length} reviewed photos. ${current.corrects ? "This replaces an earlier public update; its history is retained." : ""}</p><label class="checkbox"><input id="public-review-check" type="checkbox">I checked accuracy, privacy and the distinction between dispatch and receipt.</label>`,
        action("Publish approved update", "publication-publish", id, "primary"),
      );
      return true;
    }
    if (name === "publication-publish") {
      if (!document.querySelector("#public-review-check")?.checked)
        throw new Error("Review the update before approving publication.");
      await api("/api/publication/publish", {
        id: current.id,
        version: current.version,
      });
      await close();
      toast("Approved update is now public.");
      await render();
      return true;
    }
    if (name === "publication-withdraw") {
      current = await record("publication", id);
      modal(
        "Withdraw a public update",
        `<p class="sub">The public will see a correction notice. Private decision history is retained and attached images stop being public.</p><form id="publication-retraction"><label>Public correction reason<textarea name="reason" required minlength="3" maxlength="600"></textarea></label><button class="primary">Record withdrawal</button></form>`,
      );
      return true;
    }
    if (name === "publication-photo") {
      const [media, ops] = await Promise.all([
        record("media"),
        record("operation"),
      ]);
      const images = media.filter((m) =>
        ["image/png", "image/jpeg"].includes(m.mime),
      );
      const receipts = ops.filter(
        (o) =>
          o.confirmedBySource &&
          ["received", "completed", "service"].includes(o.state),
      );
      modal(
        "Review a delivery photo",
        `<form id="publication-photo-form" class="fieldform"><label>Private source image<select name="mediaId">${options(images, (m) => m.title)}</select></label><img id="public-image-preview" class="evidence-preview" alt="Private source image for review"><label>Confirmed receipt<select name="operationId">${options(receipts, (o) => `${o.id} · ${o.received ?? 0} ${o.resourceType ?? "units"} received`)}</select></label><label>Public caption<textarea name="caption" minlength="3" maxlength="500" required></textarea></label><label class="checkbox"><input type="checkbox" name="privacyReviewed" required>I confirm this photo documents the selected receipt and contains no identifiable people, names or sensitive details.</label><p class="note">AidScaler strips image metadata and makes a smaller copy. It does not automatically detect every person or private detail. The original remains private.</p><button class="primary" ${!images.length || !receipts.length ? "disabled" : ""}>Approve public rendition</button></form>`,
      );
      const select = document.querySelector('[name="mediaId"]'),
        preview = document.querySelector("#public-image-preview");
      select.onchange = () => {
        preview.src = "/api/media?id=" + encodeURIComponent(select.value);
      };
      if (select.value) select.onchange();
      else preview.hidden = true;
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
          await fn(ev.target);
          await close();
          await render();
        } catch (err) {
          toast(err.message);
          button.disabled = false;
        }
      });
    on("#publication-editor", async (form) => {
      const data = new FormData(form),
        operation = String(data.get("operation"));
      await api("/api/publication/draft", {
        title: String(data.get("title")),
        area: String(data.get("area")),
        status: String(data.get("status")),
        text: String(data.get("text")),
        operationIds: operation ? [operation] : [],
        proofIds: data.getAll("proof"),
        ...(current
          ? { corrects: current.id, correctsVersion: current.version }
          : {}),
      });
      toast("Draft saved for review.");
    });
    on("#publication-retraction", async (form) => {
      await api("/api/publication/retract", {
        id: current.id,
        version: current.version,
        reason: new FormData(form).get("reason"),
      });
      toast("Withdrawal recorded with a public correction notice.");
    });
    on("#publication-photo-form", async (form) => {
      const b = Object.fromEntries(new FormData(form));
      await api("/api/publication/proof", {
        ...b,
        privacyReviewed: b.privacyReviewed === "on",
      });
      toast(
        "Reviewed photo copy saved. It remains private until an update is published.",
      );
    });
  }
  return { view, run, bind };
}
