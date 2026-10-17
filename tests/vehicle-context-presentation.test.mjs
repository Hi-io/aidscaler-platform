import test from "node:test";
import assert from "node:assert/strict";
import { createDecisionExperience } from "../ui/decision.mjs";
import { createEvidenceExperience, evidenceTitle } from "../ui/evidence.mjs";
import { operationSummary } from "../ui/operation-view.mjs";
import { createExtras } from "../ui/extras.mjs";
import { setDisplayContext } from "../ui/labels.mjs";

const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const need = { id: "need-water-main", building: "b41", node: "n41", type: "water", unit: "L", quantity: 600, served: 0 };
const resource = { id: "r-org0-water", type: "water", unit: "L", quantity: 500, floor: 0, reserved: 0, owner: "org0" };
const vehicle = { id: "v-org0-0", name: "Harbor response truck", owner: "org0", state: "available" };
const proposal = { id: "plan-one", title: "Respond to checked concurrent needs", benefit: "Useful aid with separate owner review", version: 1, state: "awaiting_review", references: [need.id, resource.id, vehicle.id], conditions: [], actions: [{ type: "dispatch", owner: "org0", params: { need: need.id, resource: resource.id, vehicle: vehicle.id, quantity: 300 }, dependsOn: [] }] };

function fixture({ real = false } = {}) {
  setDisplayContext({ organization: { id: real ? "harbor-team" : "org0", name: real ? "Harbor Response" : "Relief North" }, geography: { places: [{ id: "b41", name: "Sakura Shelter", use: "shelter", node: "n41" }] } });
  const found = new Map([[need.id, { kind: "need", record: need }], [resource.id, { kind: "resource", record: resource }], [vehicle.id, { kind: "vehicle", record: vehicle }]]);
  const markup = [];
  const helper = {
    api: async url => { const id = new URL(url, "http://local").searchParams.get("id"); if (!found.has(id)) throw Error("Not available"); return structuredClone(found.get(id)); },
    record: async (kind, id) => structuredClone(id ? found.get(id)?.record : ({ need: [need], proposal: [proposal], operation: [], resource: [resource], vehicle: [vehicle, { id: "traffic-0", name: "Civilian vehicle", owner: "org0" }, { id: "real-traffic", name: "Civilian registered vehicle", owner: "org0", background: true, plate: "REAL-22" }, { id: "v-org1-0", name: "Partner vehicle", owner: "org1" }] }[kind] ?? [])),
    escape, icon: name => `<i data-icon="${name}"></i>`, badge: state => `<span>${escape(state)}</span>`, action: (label, action, id) => `<button data-action="${action}" data-id="${escape(id)}">${escape(label)}</button>`,
    time: value => String(value), state: { user: { org: "org0", role: "commander" } }, modal: (_, content) => markup.push(content),
  };
  return { helper, found, markup };
}

test("review steps, vehicle evidence and operation details share registration-aware identity without changing records", async () => {
  const { helper } = fixture(), original = structuredClone(vehicle);
  assert.match(await createDecisionExperience(helper).renderProposal(proposal), /Harbor response truck · TK-01-0001/);
  const found = { kind: "vehicle", record: vehicle };
  assert.equal(evidenceTitle(found), "Harbor response truck · TK-01-0001");
  const evidence = await createEvidenceExperience(helper).render(found);
  assert.match(evidence, /<dt>Demo registration<\/dt><dd>TK-01-0001<\/dd>/);
  const summary = operationSummary({ type: "delivery", vehicle: vehicle.id, building: need.building }, { vehicles: [vehicle] });
  assert.equal(summary.vehicle, "Harbor response truck · TK-01-0001");
  assert.deepEqual(vehicle, original);
});

test("declared registrations win and real unnamed identifiers never acquire fictional registrations", async () => {
  const { helper } = fixture({ real: true });
  const actual = { ...vehicle, plate: "Kagawa 100 A 12-34" };
  assert.equal(evidenceTitle({ kind: "vehicle", record: actual }), "Harbor response truck · Kagawa 100 A 12-34");
  const evidence = await createEvidenceExperience(helper).render({ kind: "vehicle", record: actual });
  assert.match(evidence, /<dt>Registration<\/dt><dd>Kagawa 100 A 12-34<\/dd>/);
  assert.doesNotMatch(evidence, /TK-01|Demo registration/);
  assert.equal(evidenceTitle({ kind: "vehicle", record: vehicle }), "Harbor response truck");
});

test("manual response choices exclude observed traffic and partner vehicles while preserving operational IDs", async () => {
  const { helper, markup } = fixture();
  assert.equal(await createExtras(helper).run("manual-response", ""), true);
  const select = markup[0].match(/<select name="vehicle">([\s\S]*?)<\/select>/)?.[1];
  assert.match(select, /value="v-org0-0"/);
  assert.match(select, /Harbor response truck · TK-01-0001/);
  assert.doesNotMatch(select, /traffic-0|real-traffic|v-org1-0|Civilian|Partner vehicle/);
});

test("case responses use the same typed need and quantities as the decision queue", async () => {
  const { helper, markup } = fixture();
  assert.equal(await createExtras(helper).run("case", need.id), true);
  assert.match(markup[0], /Water for Sakura Shelter/);
  assert.match(markup[0], /300 L proposed · 1 delivery/);
  assert.doesNotMatch(markup[0], /Respond to checked concurrent needs|Useful aid with separate owner review/);
  assert.match(markup[0], /data-action="proposal" data-id="plan-one"/);
});
