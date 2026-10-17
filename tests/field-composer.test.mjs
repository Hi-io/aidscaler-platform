import test from "node:test";
import assert from "node:assert/strict";
import { FIELD_REPORT_KINDS, fieldReportPayload, validateFieldAttachment, renderFieldComposer, bindFieldComposer, fieldLocationPlacement } from "../ui/field-composer.mjs";
import { fieldReport } from "../src/contracts.mjs";
import { icons } from "../ui/icons.mjs";

test("compact field reports retain all existing report types and exact JSON-only report semantics", () => {
  for (const [kind] of FIELD_REPORT_KINDS) {
    const payload = fieldReportPayload({ kind, text: "  About 60 people need water.  ", location: "  Sakura Shelter  ", observedAt: "" }, 7000);
    assert.deepEqual(payload, { kind, text: "About 60 people need water.", location: "Sakura Shelter", observedAt: 7000 });
    assert.doesNotThrow(() => fieldReport.parse({ ...payload, clientId: "local-report" }));
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
  }
  assert.equal(fieldReportPayload({ text: "Observed", location: "Depot" }, 9000).kind, "need");
  assert.equal(fieldReportPayload({ text: "Observed", location: "Depot", observedAt: 0 }).observedAt, 0);
  assert.equal(fieldReportPayload({ text: "Observed", location: "Depot", observedAt: "2026-10-17T12:30" }).observedAt, new Date("2026-10-17T12:30").getTime());
});

test("missing location opens a useful validation path; invalid text, timestamps and bounds never enter the outbox", () => {
  const valid = { text: "Observed", location: "Depot", observedAt: 20 };
  for (const [values, field] of [
    [{ location: "  " }, "location"], [{ location: "x".repeat(201) }, "location"],
    [{ text: "  " }, "text"], [{ text: "x".repeat(6001) }, "text"],
    [{ observedAt: "not a date" }, "observedAt"], [{ observedAt: -1 }, "observedAt"], [{ observedAt: 1.5 }, "observedAt"],
    [{ kind: "unknown" }, "kind"],
  ]) assert.throws(() => fieldReportPayload({ ...valid, ...values }), error => error.field === field);
  assert.equal(fieldReportPayload({ ...valid, text: "x".repeat(6000), location: "x".repeat(200) }).text.length, 6000);
});

test("field attachments allow the supported media and reject oversized or unsupported files before reading bytes", () => {
  for (const type of ["image/png", "image/jpeg", "audio/wav", "audio/mpeg"])
    assert.doesNotThrow(() => validateFieldAttachment({ type, size: 2_000_000 }));
  assert.doesNotThrow(() => validateFieldAttachment(undefined));
  for (const file of [{ type: "image/png", size: 2_000_001 }, { type: "image/png", size: 0 }, { type: "text/html", size: 3 }, { type: "image/svg+xml", size: 20 }])
    assert.throws(() => validateFieldAttachment(file), error => error.field === "attachment");
});

test("the initial field view prioritizes observation and keeps location, media and report options available without duplicate location inputs", () => {
  const html = renderFieldComposer({ escape: text => String(text), icon: name => { assert.ok(icons[name], `Missing field control icon: ${name}`); return `<svg data-icon="${name}">${icons[name]}</svg>`; } });
  assert.equal((html.match(/name="location"/g) || []).length, 1);
  assert.match(html, /id="field-location-options"[^>]*hidden/);
  assert.match(html, /<details class="field-report-options">/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.match(html, /name="text" maxlength="6000"/);
  assert.match(html, /name="location" maxlength="200"/);
  assert.match(html, /data-field-use-location/);
  assert.match(html, />Submit /);
  assert.ok(html.indexOf("What did you observe?") < html.indexOf("Attach location"));
  assert.equal((html.match(/<option /g) || []).length, 6);
});

test("a location popover near the mobile viewport bottom opens above; shorter viewports retain scrollable clearance", () => {
  assert.deepEqual(fieldLocationPlacement({ top: 634, bottom: 672, height: 273, viewportHeight: 844 }), { opensAbove: true, maxHeight: 612 });
  assert.deepEqual(fieldLocationPlacement({ top: 300, bottom: 338, height: 273, viewportHeight: 1080 }), { opensAbove: false, maxHeight: 720 });
  assert.deepEqual(fieldLocationPlacement({ top: 160, bottom: 198, height: 273, viewportTop: 40, viewportHeight: 320 }), { opensAbove: false, maxHeight: 140 });
});

// EventTarget stubs exercise async form behavior without a browser or a UI runner.
function composerFixture() {
  class Element extends EventTarget {
    constructor() {
      super(); this.value = ""; this.textContent = ""; this.innerHTML = "";
      this.disabled = false; this.hidden = true; this.title = ""; this.attrs = new Map();
      this.classList = { toggle() {} }; this.children = [];
    }
    setAttribute(key, value) { this.attrs.set(key, value); }
    removeAttribute(key) { this.attrs.delete(key); }
    focus() { this.focused = true; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    click() { this.dispatchEvent(new Event("click")); }
    contains() { return false; }
  }
  const nodes = Object.fromEntries([
    "[data-field-location-toggle]", "#field-location-options", "[data-field-attachment]", "#field-composer-message",
    "[data-field-submit]", "[data-field-use-location]", "[data-field-add-attachment]", "[data-field-close-location]",
    "[data-field-save-location]", "[data-field-options-label]", ".field-report-options", "[data-field-location-help]",
  ].map(key => [key, new Element()]));
  nodes["[data-field-submit]"].innerHTML = "Submit";
  nodes["[data-field-use-location]"].innerHTML = "Use my current location";
  nodes["[data-field-location-toggle]"].parentElement = new Element();
  nodes["[data-field-location-toggle]"].querySelector = () => new Element();
  const fields = Object.fromEntries(["text", "location", "kind", "observedAt", "attachment"].map(key => [key, new Element()]));
  fields.kind.value = "need"; fields.attachment.files = [];
  const form = new Element(), doc = new Element();
  form.elements = { namedItem: key => fields[key] };
  form.querySelector = selector => nodes[selector];
  form.ownerDocument = doc;
  doc.createElement = () => new Element();
  const locations = [];
  doc.defaultView = { navigator: { geolocation: { getCurrentPosition: (...args) => locations.push(args) } } };
  form.reset = () => { Object.values(fields).forEach(field => { field.value = ""; }); fields.kind.value = "need"; fields.attachment.files = []; };
  return { form, fields, nodes, locations, submit: () => form.dispatchEvent(new Event("submit", { cancelable: true })) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("submitting a field observation never requests GPS implicitly and missing place is handled inline", async () => {
  const f = composerFixture(); let saved = 0;
  const cleanup = bindFieldComposer(f.form, { now: () => 123, readAttachment: async () => null, onSave: async () => saved++ });
  f.fields.text.value = "Water needed";
  f.submit(); await settle();
  assert.equal(f.locations.length, 0);
  assert.equal(saved, 0);
  assert.equal(f.nodes["#field-location-options"].hidden, false);
  assert.equal(f.fields.location.focused, true);
  assert.match(f.nodes["#field-composer-message"].textContent, /nearby place/);
  f.nodes["[data-field-use-location]"].click();
  assert.equal(f.locations.length, 1);
  f.locations[0][0]({ coords: { latitude: 34.342876, longitude: 134.046521 } });
  assert.equal(f.fields.location.value, "Approximate coordinates: 34.343, 134.047");
  assert.equal(f.nodes["#field-location-options"].hidden, true);
  cleanup();
});

test("double submit saves one JSON report and clears the draft only after a durable save resolves", async () => {
  const f = composerFixture(), reports = []; let resolve;
  const saved = new Promise(done => { resolve = done; });
  const cleanup = bindFieldComposer(f.form, { now: () => 123, readAttachment: async () => null, onSave: payload => { reports.push(payload); return saved; } });
  f.fields.text.value = "Water needed"; f.fields.location.value = "Harbor Depot";
  f.submit(); f.submit();
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], { kind: "need", text: "Water needed", location: "Harbor Depot", observedAt: 123 });
  assert.equal(f.fields.text.value, "Water needed");
  assert.equal(f.nodes["[data-field-submit]"].disabled, true);
  resolve(); await settle();
  assert.equal(f.fields.text.value, "");
  assert.equal(f.nodes["[data-field-submit]"].disabled, false);
  cleanup();
});

test("a failed local save retains the narrative, place and selected file for a safe retry", async () => {
  const f = composerFixture(), file = { type: "image/png", size: 12, name: "site.png" }, media = { mime: "image/png", contentBase64: "AA==" };
  let received;
  const cleanup = bindFieldComposer(f.form, { now: () => 123, readAttachment: async read => { assert.equal(read, file); return media; }, onSave: async payload => { received = payload; throw new Error("Local storage is full."); } });
  f.fields.text.value = "Water needed"; f.fields.location.value = "Harbor Depot"; f.fields.attachment.files = [file];
  f.submit(); await settle();
  assert.deepEqual(received.attachment, media);
  assert.equal(f.fields.text.value, "Water needed");
  assert.equal(f.fields.location.value, "Harbor Depot");
  assert.equal(f.fields.attachment.files[0], file);
  assert.equal(f.nodes["[data-field-submit]"].disabled, false);
  assert.match(f.nodes["#field-composer-message"].textContent, /storage is full/);
  cleanup();
});

test("disposing a composer during an attachment read prevents its old draft from reaching another signed-in account", async () => {
  const f = composerFixture(), file = { type: "image/png", size: 12, name: "site.png" };
  let finishRead, saves = 0;
  const bytes = new Promise(resolve => { finishRead = resolve; });
  const cleanup = bindFieldComposer(f.form, { now: () => 123, readAttachment: () => bytes, onSave: async () => { saves++; } });
  f.fields.text.value = "Water needed"; f.fields.location.value = "Harbor Depot"; f.fields.attachment.files = [file];
  f.submit();
  cleanup();
  finishRead({ mime: "image/png", contentBase64: "AA==" });
  await settle();
  assert.equal(saves, 0);
  assert.equal(f.fields.text.value, "Water needed");
});
