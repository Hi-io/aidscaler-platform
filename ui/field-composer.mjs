import { approximateCoordinates } from "./portal.mjs";

export const FIELD_REPORT_KINDS = Object.freeze([
  ["need", "A need or situation"],
  ["receipt", "Aid received"],
  ["road", "Access restriction"],
  ["facility", "Facility assessment"],
  ["correction", "A correction"],
  ["voice", "Voice note transcript"],
]);
const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "audio/wav", "audio/mpeg"]);
const MEDIA_LIMIT = 2_000_000;

function invalid(field, message) {
  const error = new Error(message);
  error.field = field;
  return error;
}

/** Keep browser-only File objects out of the durable, JSON-only field outbox. */
export function fieldReportPayload(values, now = Date.now()) {
  const kind = values.kind || "need";
  const text = String(values.text ?? "").trim();
  const location = String(values.location ?? "").trim();
  if (!FIELD_REPORT_KINDS.some(([key]) => key === kind))
    throw invalid("kind", "Choose a report type.");
  if (!text || text.length > 6000)
    throw invalid("text", "Describe what you observed, using up to 6,000 characters.");
  if (!location || location.length > 200)
    throw invalid("location", "Add a nearby place or approximate location.");
  const observedAt = values.observedAt === "" || values.observedAt == null
    ? now
    : typeof values.observedAt === "number"
      ? values.observedAt
      : new Date(values.observedAt).getTime();
  if (!Number.isSafeInteger(observedAt) || observedAt < 0)
    throw invalid("observedAt", "Choose a valid observation time, or leave it blank to use now.");
  return { kind, location, text, observedAt };
}

export function validateFieldAttachment(file) {
  if (!file) return;
  if (!MEDIA_TYPES.has(file.type))
    throw invalid("attachment", "Choose a PNG or JPEG photo, or a WAV or MP3 audio file.");
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MEDIA_LIMIT)
    throw invalid("attachment", "Choose a non-empty file up to 2 MB.");
}

export function fieldLocationPlacement({ top, bottom, height, viewportTop = 0, viewportHeight }) {
  const gap = 22; // 10 px from the control, plus 12 px of viewport clearance.
  const below = Math.max(0, viewportTop + viewportHeight - bottom - gap);
  const above = Math.max(0, top - viewportTop - gap);
  const opensAbove = below < height && above > below;
  return { opensAbove, maxHeight: Math.floor(opensAbove ? above : below) };
}

export function renderFieldComposer({ escape: e, icon }) {
  return `<form id="fieldform" class="field-composer" novalidate>
    <label class="field-composer-label" for="field-observation">What did you observe?</label>
    <textarea id="field-observation" name="text" maxlength="6000" required placeholder="Describe what happened and what is needed. Include quantities when known." aria-describedby="field-composer-message"></textarea>
    <div class="field-attachment-preview" data-field-attachment hidden></div>
    <div class="field-composer-toolbar">
      <div class="field-composer-tools">
        <button type="button" class="field-attach-button" data-field-add-attachment aria-label="Add a photo or audio attachment" title="Add a photo or audio attachment">${icon("plus")}</button>
        <input name="attachment" type="file" accept="image/png,image/jpeg,audio/wav,audio/mpeg" hidden>
        <div class="field-location-control">
          <button type="button" data-field-location-toggle aria-expanded="false" aria-controls="field-location-options">${icon("map-pin")}<span>Attach location</span>${icon("chevron-down")}</button>
          <div id="field-location-options" class="field-location-options" hidden>
            <div class="field-location-heading"><strong>Observation location</strong><button type="button" data-field-close-location aria-label="Close location options">${icon("x")}</button></div>
            <button type="button" data-field-use-location>${icon("locate-fixed")} Use my current location</button>
            <label for="field-location">Or enter a nearby place<input id="field-location" name="location" maxlength="200" placeholder="Shelter, neighborhood or landmark" autocomplete="off" required></label>
            <p data-field-location-help>Only an approximate location is attached.</p>
            <button type="button" data-field-save-location>Done</button>
          </div>
        </div>
      </div>
      <button type="submit" class="primary" data-field-submit>Submit ${icon("arrow-right")}</button>
    </div>
    <p id="field-composer-message" class="field-composer-message" role="alert" hidden></p>
    <details class="field-report-options"><summary>Report options <span data-field-options-label>A need or situation · Now</span></summary>
      <div class="field-options-grid"><label>Report type<select name="kind">${FIELD_REPORT_KINDS.map(([value, label]) => `<option value="${e(value)}">${e(label)}</option>`).join("")}</select></label>
      <label>Observation time<input type="datetime-local" name="observedAt"><small>Leave blank to use the time you submit.</small></label></div>
    </details>
  </form>`;
}

/** onSave resolves only after the JSON report is safely stored in the local outbox. */
export function bindFieldComposer(form, { readAttachment, onSave, toast, now = Date.now }) {
  if (!form) return () => {};
  const events = [], controls = form.elements;
  const text = controls.namedItem("text"), place = controls.namedItem("location"), fileInput = controls.namedItem("attachment");
  const kind = controls.namedItem("kind"), observed = controls.namedItem("observedAt");
  const find = selector => form.querySelector(selector);
  const toggle = find("[data-field-location-toggle]"), options = find("#field-location-options");
  const preview = find("[data-field-attachment]"), message = find("#field-composer-message");
  const submit = find("[data-field-submit]"), useLocation = find("[data-field-use-location]");
  const submitLabel = submit.innerHTML, locationLabel = useLocation.innerHTML;
  let busy = false, disposed = false, locating = false;
  const listen = (node, event, fn) => { node.addEventListener(event, fn); events.push(() => node.removeEventListener(event, fn)); };
  const positionLocation = () => {
    const view = form.ownerDocument.defaultView;
    const viewport = view?.visualViewport;
    const viewportHeight = viewport?.height ?? view?.innerHeight;
    if (options.hidden || !Number.isFinite(viewportHeight) || typeof toggle.getBoundingClientRect !== "function") return;
    options.classList.remove("opens-above");
    options.style.maxHeight = "";
    const anchor = toggle.getBoundingClientRect();
    const height = options.getBoundingClientRect().height;
    const placement = fieldLocationPlacement({ top: anchor.top, bottom: anchor.bottom, height, viewportTop: viewport?.offsetTop ?? 0, viewportHeight });
    options.classList.toggle("opens-above", placement.opensAbove);
    if (height > placement.maxHeight) options.style.maxHeight = `${placement.maxHeight}px`;
  };
  const showLocation = (show, focus = false) => {
    options.hidden = !show;
    toggle.setAttribute("aria-expanded", String(show));
    if (show) positionLocation();
    if (show && focus) place.focus();
  };
  const updateLocation = () => {
    const value = place.value.trim();
    toggle.querySelector("span").textContent = value ? "Location attached" : "Attach location";
    toggle.title = value || "Choose the observation location";
    toggle.classList.toggle("has-location", Boolean(value));
  };
  const showError = error => {
    message.textContent = error.message;
    message.hidden = false;
    if (error.field === "location") { showLocation(true, true); place.setAttribute("aria-invalid", "true"); }
    else if (error.field === "observedAt" || error.field === "kind") {
      find(".field-report-options").open = true;
      controls.namedItem(error.field).focus();
    } else if (error.field === "attachment") find("[data-field-add-attachment]").focus();
    else if (error.field === "text") { text.setAttribute("aria-invalid", "true"); text.focus(); }
    else toast?.(error.message);
  };
  const clearError = () => {
    message.hidden = true;
    text.removeAttribute("aria-invalid");
    place.removeAttribute("aria-invalid");
  };
  const updateOptions = () => {
    const label = FIELD_REPORT_KINDS.find(([value]) => value === kind.value)?.[1] || "Choose type";
    find("[data-field-options-label]").textContent = `${label} · ${observed.value ? "Custom time" : "Now"}`;
  };
  const updateAttachment = () => {
    preview.replaceChildren();
    const file = fileInput.files?.[0];
    preview.hidden = !file;
    if (!file) return;
    const name = form.ownerDocument.createElement("span"); name.textContent = file.name;
    const remove = form.ownerDocument.createElement("button"); remove.type = "button";
    remove.textContent = "Remove"; remove.setAttribute("aria-label", "Remove attachment");
    remove.onclick = () => { fileInput.value = ""; preview.replaceChildren(); preview.hidden = true; clearError(); };
    preview.append(name, remove);
    try { validateFieldAttachment(file); clearError(); } catch (error) { showError(error); }
  };
  listen(toggle, "click", () => showLocation(options.hidden));
  listen(find("[data-field-close-location]"), "click", () => { showLocation(false); toggle.focus(); });
  listen(find("[data-field-save-location]"), "click", () => {
    if (!place.value.trim()) return showError(invalid("location", "Add a nearby place or approximate location."));
    updateLocation(); clearError(); showLocation(false); toggle.focus();
  });
  listen(place, "input", () => { updateLocation(); clearError(); });
  listen(text, "input", clearError);
  listen(kind, "change", updateOptions);
  listen(observed, "input", updateOptions);
  listen(find("[data-field-add-attachment]"), "click", () => fileInput.click());
  listen(fileInput, "change", updateAttachment);
  listen(form, "keydown", event => {
    if (event.key === "Escape" && !options.hidden) { event.preventDefault(); showLocation(false); toggle.focus(); }
  });
  listen(form.ownerDocument, "pointerdown", event => {
    if (!options.hidden && !toggle.parentElement.contains(event.target)) showLocation(false);
  });
  const view = form.ownerDocument.defaultView;
  if (view?.addEventListener) listen(view, "resize", positionLocation);
  if (view?.visualViewport?.addEventListener) {
    listen(view.visualViewport, "resize", positionLocation);
    listen(view.visualViewport, "scroll", positionLocation);
  }
  listen(useLocation, "click", () => {
    if (locating) return;
    const locationHelp = find("[data-field-location-help]");
    const unavailable = () => {
      if (disposed) return;
      locating = false; useLocation.disabled = false; useLocation.innerHTML = locationLabel;
      locationHelp.textContent = "Location wasn't shared. Enter a nearby place instead.";
      showLocation(true, true);
    };
    const geolocation = form.ownerDocument.defaultView?.navigator.geolocation;
    if (!geolocation) return unavailable();
    locating = true; useLocation.disabled = true; useLocation.textContent = "Finding location…";
    geolocation.getCurrentPosition(position => {
      if (disposed) return;
      const location = approximateCoordinates(position.coords);
      if (!location) return unavailable();
      locating = false; useLocation.disabled = false; useLocation.innerHTML = locationLabel;
      place.value = location; updateLocation(); clearError();
      locationHelp.textContent = "Approximate location attached. You can replace it with a nearby landmark.";
      showLocation(false); toggle.focus();
    }, unavailable, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });
  listen(form, "submit", async event => {
    event.preventDefault();
    if (busy || submit.disabled) return;
    const values = { kind: kind.value, location: place.value, text: text.value, observedAt: observed.value };
    const file = fileInput.files?.[0];
    busy = true; submit.disabled = true;
    try {
      clearError();
      const payload = fieldReportPayload(values, now());
      validateFieldAttachment(file);
      submit.textContent = "Saving…"; form.setAttribute("aria-busy", "true");
      if (file) payload.attachment = await readAttachment(file, MEDIA_LIMIT);
      // Navigation or sign-out can remove this form while file bytes are read.
      // Its previous draft must never be handed to a newly signed-in account.
      if (disposed) return;
      await onSave(payload);
      if (disposed) return;
      // Keep a newer draft if the operator typed while the local save completed.
      const unchanged = kind.value === values.kind && place.value === values.location && text.value === values.text && observed.value === values.observedAt && fileInput.files?.[0] === file;
      if (unchanged) { form.reset(); updateLocation(); updateOptions(); preview.replaceChildren(); preview.hidden = true; showLocation(false); clearError(); }
    } catch (error) { if (!disposed) showError(error); }
    finally {
      busy = false;
      if (!disposed) { submit.disabled = submit.title === "This response is read-only."; submit.innerHTML = submitLabel; form.removeAttribute("aria-busy"); }
    }
  });
  updateLocation(); updateOptions();
  return () => { disposed = true; events.forEach(remove => remove()); };
}
