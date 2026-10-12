import { actionBrief } from "./uploads.mjs";
const content = document.querySelector("#content"),
  notice = document.querySelector("#notice");
let csrf = "";
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function api(path, data) {
  const r = await fetch(path, {
    method: data ? "POST" : "GET",
    headers: data
      ? {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
          "Idempotency-Key": crypto.randomUUID(),
        }
      : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.message);
  return v;
}
function login() {
  content.innerHTML =
    '<section><form id="login"><label>Partner owner email<input name="email" type="email" required autocomplete="username"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><button>Sign in</button></form></section>';
  document.querySelector("#login").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(e.target)),
        s = await api("/api/login", data);
      csrf = s.csrf;
      await show();
    } catch (err) {
      notice.textContent = err.message;
    }
  };
}
async function show() {
  const d = await api("/api/requests");
  content.innerHTML =
    `<section><h2>Share only the capacity you choose.</h2><p>Other teams see a scoped offer. Every delivery still needs your approval.</p><details><summary>Available capabilities and consent</summary>${[...d.capabilities.resources.map((r) => ({ ...r, kind: "resource" })), ...d.capabilities.vehicles.map((v) => ({ ...v, kind: "vehicle" }))].map((r) => `<form data-share="${escape(r.id)}" data-kind="${r.kind}"><label>${escape(r.type ?? "Vehicle")} · ${escape(r.id)}<select name="to">${d.peers.map((p) => `<option value="${escape(p.org)}">${escape(p.org)}</option>`).join("")}</select></label><button>Share this capability</button></form>`).join("")}${d.permissions
      .filter((p) => p.active)
      .map(
        (p) =>
          `<p>${escape(p.recordId)} shared with ${escape(p.to)} <button data-revoke="${escape(p.recordId)}" data-kind="${escape(p.kind)}" data-to="${escape(p.to)}">Revoke sharing</button></p>`,
      )
      .join(
        "",
      )}</details><button id="refresh">Refresh current requests</button></section>` +
    (d.requests
      .map(
        (w) =>
          `<section><span class="status">${escape(w.state.replaceAll("_", " "))} · from ${escape(w.from)}</span><h2>${escape(w.title)}</h2><p>${escape(actionBrief(w.action))}.</p>${w.changedReason ? `<p>${escape(w.changedReason)}</p>` : ""}<details><summary>Requested scope and source confirmation</summary><pre>${escape(JSON.stringify({ action: w.action, issued: w.issued, receipt: w.receipt }, null, 2))}</pre></details>${w.state === "awaiting_review" ? `<form data-id="${escape(w.id)}" data-version="${w.version}"><label>Decision reason<textarea name="note" required></textarea></label><button name="decision" value="approve">Approve my delivery</button><button name="decision" value="reject">Decline request</button></form>` : ""}<p class="status">${w.receipt?.confirmedBySource ? (["failed", "blocked", "cancelled"].includes(w.receipt.state) ? "Your operational source reports interrupted work. A new owner decision is required." : ["completed", "received", "service"].includes(w.receipt.state) ? "Your operational source confirms physical receipt." : "Your source reports work in progress; arrival is not yet confirmed.") : "A request or dispatch is not a confirmed arrival."}</p></section>`,
      )
      .join("") ||
      "<section><h2>No requests yet.</h2><p>Your inventory remains private until you choose what to share.</p></section>");
  document.querySelector("#refresh").onclick = () =>
    show().catch((e) => {
      notice.textContent = e.message;
    });
  for (const f of content.querySelectorAll("form[data-share]"))
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("/api/share", {
          kind: f.dataset.kind,
          id: f.dataset.share,
          to: new FormData(f).get("to"),
        });
        notice.textContent =
          "Scoped offer queued. Sharing is not dispatch authority.";
        await show();
      } catch (err) {
        notice.textContent = err.message;
      }
    };
  for (const b of content.querySelectorAll("button[data-revoke]"))
    b.onclick = async () => {
      try {
        await api("/api/share", {
          kind: b.dataset.kind,
          id: b.dataset.revoke,
          to: b.dataset.to,
          revoke: true,
        });
        notice.textContent =
          "Revocation queued. Previously completed deliveries remain historical facts.";
        await show();
      } catch (err) {
        notice.textContent = err.message;
      }
    };
  for (const f of content.querySelectorAll("form[data-id]"))
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("/api/decision", {
          id: f.dataset.id,
          version: Number(f.dataset.version),
          decision: e.submitter.value,
          note: new FormData(f).get("note"),
        });
        notice.textContent =
          "Decision recorded with your identity. Physical progress remains separate.";
        await show();
      } catch (err) {
        notice.textContent = err.message;
      }
    };
}
login();
