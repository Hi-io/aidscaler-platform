/** Organization-owned public pages. Private reports never appear in the public feed. */
export function createPortalViews(h) {
  const { api, escape: e, icon, money, time, publicProcurement, readAttachment, toast } = h;
  let trackerTimer, publicProgressTimer;
  function style() {
    if (!document.querySelector('link[data-portal-style]')) {
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/portal.css"; link.dataset.portalStyle = "true"; document.head.append(link);
    }
  }
  const initials = name => name.split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase();
  const orgHead = (org, active) => `<header class="org-public-nav"><a href="/public" class="org-public-brand"><span class="org-monogram" aria-hidden="true">${e(initials(org.name))}</span><span><strong>${e(org.name)}</strong><small>Community response</small></span></a><nav aria-label="Public pages"><a href="/public" ${active === "updates" ? 'aria-current="page"' : ""}>Updates</a><a href="/community" ${active === "report" ? 'aria-current="page"' : ""}>Report a need</a><a href="/" class="org-team-link">Team sign in ${icon("arrow-up-right")}</a></nav></header>`;
  const footer = org => `<footer class="org-public-footer"><span>${e(org.name)} · Local demonstration</span><span>Powered by <a href="/">AidScaler</a></span></footer>`;
  const banner = org => org.portal.bannerDataUrl ? `<div class="org-response-banner"><img src="${e(org.portal.bannerDataUrl)}" alt="${e(org.portal.bannerAlt)}"></div>` : "";
  const labels = { support_needed: ["Support needed", "heart-handshake"], en_route: ["On the way", "truck"], received: ["Received", "package-check"], retracted: ["Update withdrawn", "circle-alert"] };
  const quantity = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
  function progressMarkup(progress) {
    const p = progress ?? { receivedDeliveries: 0, enRouteDeliveries: 0, materials: [] };
    const material = row => `<div><strong>${e(row.label)}</strong><span>${quantity(row.received)} ${e(row.unit)} received</span><span>${quantity(row.enRoute)} ${e(row.unit)} on the way</span></div>`;
    return `<section id="public-response-progress" class="org-response-progress" aria-label="Confirmed response progress"><div class="org-progress-intro"><span class="org-eyebrow">CONFIRMED PROGRESS</span><p>From our reviewed response updates.</p></div><div class="org-progress-total"><strong>${quantity(p.receivedDeliveries)}</strong><span>Deliveries received</span></div><div class="org-progress-total"><strong>${quantity(p.enRouteDeliveries)}</strong><span>Deliveries on the way</span></div>${p.materials?.length ? `<div class="org-progress-materials">${p.materials.slice(0, 3).map(material).join("")}${p.materials.length > 3 ? `<details><summary>${p.materials.length - 3} more supply types</summary>${p.materials.slice(3).map(material).join("")}</details>` : ""}</div>` : `<p class="org-progress-empty">Delivery totals appear when a source-confirmed operation is included in a public update.</p>`}</section>`;
  }
  async function publicView(app) {
    style(); clearInterval(trackerTimer); clearInterval(publicProgressTimer);
    const d = await api("/api/public"), org = d.organization;
    document.title = `${org.name} · Response updates`;
    app.innerHTML = `<div class="org-public" style="--org-accent:${e(org.portal.accent)}">${orgHead(org, "updates")}<main id="main" class="org-public-main">${banner(org)}<section class="org-portal-intro"><div class="org-intro-copy"><span class="org-eyebrow"><i></i> ${e(org.response || "Disaster response")}</span><h1>${e(org.portal.title)}</h1><p>${e(org.portal.description)}</p><div class="org-intro-actions"><a class="org-primary" href="/community">Tell us where help is needed ${icon("arrow-up-right")}</a><a class="org-text-link" href="#response-updates-title">Follow the response ${icon("arrow-down")}</a></div></div><div class="org-intro-aside"><span>ONE COMMUNITY.<br>A SHARED RESPONSE.</span><p>Local knowledge. Coordinated action.<br>Updates from ${e(org.name)}.</p><small>LOCAL DEMONSTRATION</small></div></section>${progressMarkup(d.responseProgress)}<section aria-labelledby="response-updates-title"><div class="org-section-title"><h2 id="response-updates-title">Latest response updates</h2><span>Reviewed by ${e(org.name)}</span></div><div class="org-update-grid">${d.updates.map(p => {
      const [label, glyph] = labels[p.status] ?? ["Team update", "globe"];
      return `<article class="org-update-card ${e(p.status)}"><div class="org-update-status">${icon(glyph)}<span>${e(label)}</span></div><h3>${e(p.title)}</h3><p>${e(p.text)}</p><small>${e(p.area)} · ${time(p.publishedAt)}${p.corrected ? " · corrected" : ""}</small>${(p.proofs ?? []).map(f => `<figure class="publicproof"><img src="${e(f.url)}" alt="${e(f.caption)}" loading="lazy"><figcaption>${e(f.caption)} · reviewed evidence</figcaption></figure>`).join("")}</article>`;
    }).join("") || `<article class="org-no-updates">${icon("radio")}<div><h3>Updates will appear here</h3><p>Our team publishes progress after review. Community reports stay private.</p></div></article>`}</div></section><section class="org-support-grid" aria-labelledby="support-title"><div><span class="org-eyebrow">MAKE THE NEXT RESPONSE POSSIBLE</span><h2 id="support-title">Stand with your community.</h2><p>Contributions support our pooled response fund, so we can direct support where it is needed as the situation changes.</p><form id="contributeform"><label>Test contribution · USD<input name="amount" type="number" min="1" max="100000" value="25" required></label><button class="org-primary">Contribute ${icon("arrow-right")}</button></form><p class="org-fine-print">Sandbox only. No money is collected.</p><div id="contribution-receipt" aria-live="polite"></div></div><div class="org-fund-summary"><span class="org-eyebrow">POOLED RESPONSE FUND · TEST FUNDS</span><strong>${money(d.finance.receivedCents)}</strong><span>Settled support</span><dl><div><dt>Allocated</dt><dd>${money(d.finance.allocatedCents)}</dd></div><div><dt>Refunded</dt><dd>${money(d.finance.refundedCents)}</dd></div><div><dt>Available</dt><dd>${money(d.finance.availableCents)}</dd></div></dl><p class="org-fine-print">Support is pooled, rather than assigned to one item or recipient. A pending test payment is not settled support.</p></div></section>${publicProcurement(d.financeReview, e, time)}<details class="org-explainer"><summary>What do these response stages mean?</summary><p><b>Support needed:</b> a requirement remains. <b>On the way:</b> an operation is travelling; arrival and receipt are pending. <b>Received:</b> a receipt has been recorded. Our team reviews public updates and omits personal details and sensitive locations.</p></details></main>${footer(org)}</div>`;
    publicProgressTimer = setInterval(async () => {
      if (document.hidden || !app.querySelector("#public-response-progress")) return;
      try {
        const latest = await api("/api/public");
        const target = app.querySelector("#public-response-progress");
        if (target && JSON.stringify(latest.responseProgress) !== target.dataset.snapshot) {
          const holder = document.createElement("div"); holder.innerHTML = progressMarkup(latest.responseProgress);
          const next = holder.firstElementChild; next.dataset.snapshot = JSON.stringify(latest.responseProgress); target.replaceWith(next);
        }
      } catch { /* Keep the last confirmed public projection while offline. */ }
    }, 15000);
    app.querySelector("#contributeform").addEventListener("submit", async ev => {
      ev.preventDefault(); const button = ev.target.querySelector("button"); button.disabled = true;
      try {
        const r = await api("/api/contribute", { amountCents: Math.round(Number(new FormData(ev.target).get("amount")) * 100) });
        const receipt = app.querySelector("#contribution-receipt");
        receipt.innerHTML = `<section class="org-receipt" role="status"><button type="button" aria-label="Dismiss contribution confirmation">${icon("x")}</button><strong>${money(r.amountCents)} test contribution created</strong><p>No money was collected. This payment is pending a signed provider confirmation.</p></section>`;
        receipt.querySelector("button").onclick = () => receipt.replaceChildren();
      } catch (err) { toast(err.message); } finally { button.disabled = false; }
    });
  }
  async function communityView(app) {
    style(); clearInterval(trackerTimer); clearInterval(publicProgressTimer);
    const { organization: org } = await api("/api/public"), storageKey = "aidscaler-community-tracking:" + org.id;
    document.title = `${org.name} · Report a need`;
    app.innerHTML = `<div class="org-public org-community" style="--org-accent:${e(org.portal.accent)}">${orgHead(org, "report")}<main id="main" class="org-community-main"><section class="org-community-intro"><span class="org-eyebrow">DIRECT TO ${e(org.name.toUpperCase())}</span><h1>${e(org.portal.communityTitle)}</h1><p>${e(org.portal.communityDescription)}</p></section><section class="org-report-composer" aria-label="Send a need"><form id="communityform"><label class="org-composer-label" for="need-text">What is needed?</label><textarea id="need-text" name="text" maxlength="6000" placeholder="Tell us what is happening, who needs help and what would help most."></textarea><div id="attachment-preview" class="org-attachment-preview" hidden></div><div class="org-composer-toolbar"><div class="org-composer-tools"><label class="org-attach-button" tabindex="0" aria-label="Add a photo or audio attachment" title="Add a photo or audio attachment"><span aria-hidden="true">+</span><input name="attachment" type="file" accept="image/png,image/jpeg,audio/wav,audio/mpeg" class="org-file-input"></label><div class="org-location-control"><button type="button" id="attach-location" aria-pressed="true" aria-expanded="false" aria-controls="location-options">${icon("map-pin")}<span>Attach location</span>${icon("chevron-down")}</button><div id="location-options" class="org-location-options" hidden><div class="org-location-heading"><strong>Report location</strong><button type="button" id="close-location" aria-label="Close location options">${icon("x")}</button></div><button type="button" id="use-location">${icon("locate-fixed")} Use my current location</button><label for="report-location">Or enter a nearby place<input id="report-location" name="location" maxlength="200" placeholder="Shelter, neighborhood or landmark" autocomplete="off"></label><div class="org-location-actions"><button type="button" id="remove-location">Don't attach</button><button type="button" id="save-location">Done</button></div><p id="location-help" class="org-fine-print">Only an approximate location is attached. Your browser asks before sharing it.</p></div></div></div><button class="org-primary" type="submit">Submit ${icon("arrow-right")}</button></div><p id="composer-help" class="org-composer-help" hidden>Share what the team needs to know. Avoid private contact details. Reports are reviewed; for immediate danger, contact your local emergency service.</p></form></section><section id="report-tracking" class="org-tracking-section" aria-labelledby="track-title"><div class="org-section-title"><h2 id="track-title">Know what happens next.</h2></div><p>Already sent a report? Check its progress with your private tracking key.</p><form id="trackingform" class="org-tracking-form"><label>Private tracking key<input type="password" name="token" required minlength="32" maxlength="180" autocomplete="off" spellcheck="false" placeholder="Paste your tracking key"></label><button type="submit">Check status ${icon("arrow-right")}</button></form><div id="tracking-result" aria-live="polite"></div></section></main>${footer(org)}</div>`;
    const form = app.querySelector("#communityform"), locationButton = app.querySelector("#attach-location"), locationOptions = app.querySelector("#location-options"), placeInput = app.querySelector("#report-location"), attachment = form.elements.attachment, preview = app.querySelector("#attachment-preview"), help = app.querySelector("#composer-help");
    let attachLocation = true, pendingSubmission, activeToken;
    const showLocation = show => { locationOptions.hidden = !show; locationButton.setAttribute("aria-expanded", String(show)); };
    const updateLocationLabel = () => { locationButton.setAttribute("aria-pressed", String(attachLocation)); locationButton.querySelector("span").textContent = !attachLocation ? "Add location" : placeInput.value.trim() ? "Location attached" : "Attach location"; locationButton.title = attachLocation && placeInput.value.trim() ? placeInput.value.trim() : "Choose the location to attach"; };
    locationButton.onclick = () => { attachLocation = true; updateLocationLabel(); showLocation(locationOptions.hidden); };
    app.querySelector("#close-location").onclick = () => showLocation(false);
    app.querySelector("#remove-location").onclick = () => { attachLocation = false; updateLocationLabel(); showLocation(false); locationButton.focus(); };
    app.querySelector("#save-location").onclick = () => { attachLocation = true; updateLocationLabel(); showLocation(false); locationButton.focus(); };
    placeInput.oninput = updateLocationLabel;
    form.elements.text.addEventListener("focus", () => { help.hidden = false; }, { once: true });
    form.addEventListener("keydown", ev => { if (ev.key === "Escape" && !locationOptions.hidden) { ev.preventDefault(); showLocation(false); locationButton.focus(); } });
    const attachLabel = app.querySelector(".org-attach-button");
    attachLabel.onkeydown = ev => { if (["Enter", " "].includes(ev.key)) { ev.preventDefault(); attachment.click(); } };
    attachment.onchange = () => { help.hidden = false; preview.hidden = !attachment.files.length; preview.innerHTML = attachment.files.length ? `${icon(attachment.files[0].type.startsWith("audio") ? "volume-2" : "image")}<span>${e(attachment.files[0].name)}</span><button type="button" aria-label="Remove attachment">${icon("x")}</button>` : ""; if (preview.firstChild) preview.querySelector("button").onclick = () => { attachment.value = ""; preview.hidden = true; }; };
    const acquireLocation = () => new Promise(resolve => {
      const button = app.querySelector("#use-location"), hint = app.querySelector("#location-help");
      const unavailable = () => { button.disabled = false; button.innerHTML = `${icon("locate-fixed")} Use my current location`; hint.textContent = "Location wasn't shared. Enter a nearby place, or choose Don't attach."; showLocation(true); placeInput.focus(); resolve(false); };
      if (!navigator.geolocation) return unavailable();
      button.disabled = true; button.textContent = "Finding location…";
      navigator.geolocation.getCurrentPosition(position => {
        const location = approximateCoordinates(position.coords);
        if (!location) return unavailable();
        placeInput.value = location; attachLocation = true; updateLocationLabel();
        button.disabled = false; button.innerHTML = `${icon("locate-fixed")} Use my current location`;
        hint.textContent = "Approximate location attached. You can replace it with a nearby landmark.";
        showLocation(false); resolve(true);
      }, unavailable, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    });
    app.querySelector("#use-location").onclick = acquireLocation;
    const track = async (token, isNew = false) => {
      const result = await api("/api/community/track", { token }); activeToken = token;
      app.querySelector("#trackingform input").value = token;
      const target = app.querySelector("#tracking-result");
      if (target.dataset.updated === String(result.updatedAt) && target.dataset.reference === result.reference) return;
      target.dataset.updated = result.updatedAt; target.dataset.reference = result.reference;
      target.innerHTML = `<section class="org-tracking-card"><div class="org-tracking-heading"><span class="org-tracking-check">${icon("check")}</span><div><small>${isNew ? "YOUR REPORT HAS BEEN RECEIVED" : "YOUR REPORT"}</small><h3>${e(result.reference)}</h3></div><button id="copy-tracking" type="button">Copy tracking key</button></div><ol class="org-report-timeline">${result.events.map((event, i) => `<li ${i === result.events.length - 1 ? 'class="current"' : ""}><span></span><div><h4>${e(event.title)}</h4><p>${e(event.text)}</p><small>${time(event.at)}</small></div></li>`).join("")}</ol><p class="org-fine-print">${e(result.notice)} This browser remembers your most recent report.</p></section>`;
      app.querySelector("#copy-tracking").onclick = async () => { try { await navigator.clipboard.writeText(token); toast("Private tracking key copied."); } catch { const input = app.querySelector("#trackingform input"); input.focus(); input.select(); toast("Select and copy your private tracking key."); } };
      try { localStorage.setItem(storageKey, token); } catch {}
    };
    form.onsubmit = async ev => {
      ev.preventDefault(); const button = form.querySelector('button[type="submit"]'); button.disabled = true;
      try {
        help.hidden = false;
        const media = await readAttachment(attachment.files[0]);
        const text = form.elements.text.value.trim();
        if (!text && !media) throw new Error("Tell us what is needed, or add a photo or audio recording.");
        if (attachLocation && !placeInput.value.trim() && !await acquireLocation()) return;
        const location = attachLocation ? placeInput.value.trim() : "";
        const signature = JSON.stringify({ text, location, attachment: media });
        if (pendingSubmission?.signature !== signature) pendingSubmission = { signature, clientId: crypto.randomUUID(), observedAt: Date.now(), trackingToken: crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "") };
        const r = await api("/api/community/report", { clientId: pendingSubmission.clientId, observedAt: pendingSubmission.observedAt, trackingToken: pendingSubmission.trackingToken, text, location, attachment: media });
        await track(r.trackingToken, true); pendingSubmission = null; form.reset(); preview.hidden = true; attachLocation = true; updateLocationLabel(); showLocation(false); help.hidden = true;
        app.querySelector("#report-tracking").scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) { toast(err.message); } finally { button.disabled = false; }
    };
    app.querySelector("#trackingform").onsubmit = async ev => { ev.preventDefault(); const button = ev.target.querySelector("button"); button.disabled = true; try { await track(ev.target.elements.token.value.trim()); } catch (err) { toast(err.message); } finally { button.disabled = false; } };
    let saved; try { saved = localStorage.getItem(storageKey); } catch {}
    if (saved) { try { await track(saved); } catch { /* A saved report may belong to a previous local lab. */ } }
    trackerTimer = setInterval(() => { if (activeToken && !document.hidden) track(activeToken).catch(() => {}); }, 10000);
  }
  return { publicView, communityView };
}

/** Coarse coordinates reduce accidental disclosure; no browser access is performed here. */
export function approximateCoordinates(coords) {
  if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude) || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) return null;
  return `Approximate coordinates: ${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`;
}
