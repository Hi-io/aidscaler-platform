import test from "node:test";
import assert from "node:assert/strict";
import { createWorkforceControls, assignmentOperationLabel, fieldTaskTitle, fieldTaskDestination } from "../ui/workforce.mjs";
import { operationChoiceLabel } from "../ui/operation-view.mjs";
import { setDisplayContext } from "../ui/labels.mjs";

const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
test("an existing field assignment explains the next step instead of showing an empty required selector", async () => {
  const rows = records(); let content;
  const controls = createWorkforceControls({ state: {user:{org:"org0",role:"commander"}}, escape,
    record: async kind => rows[kind] ?? [], api: async url => url === "/api/tasks" ? [{operation:"operation-1"}] : [],
    modal: (_, markup) => {content=markup;}, action: () => "Close",
  });
  assert.equal(await controls.run("task-assign","operation-1"),true);
  assert.match(content,/already has a field task.*People &amp; handovers|already has a field task.*People & handovers/);
  assert.doesNotMatch(content,/<select/);
});
test("field destination uses its bounded assignment label without a directory permission", () => {
  setDisplayContext({organization:{id:"org0",name:"Relief North"}});
  assert.equal(fieldTaskDestination({destination:"n2561",destinationName:"North City Shelter"}),"North City Shelter");
  assert.equal(fieldTaskDestination({}),"See operational instructions");
});
function records() {
  setDisplayContext({ organization: { id: "org0", name: "Relief North" }, geography: { places: [{ id: "b41", name: "Sakura Shelter", node: "n41" }] } });
  return {
    operation: [{ id: "operation-1", type: "delivery", state: "unloading", need: "need-main", resource: "r-org0-water", vehicle: "v-org0-0", quantity: 300 }, { id: "operation-2", type: "delivery", state: "unloading", need: "need-main", resource: "r-org0-water", vehicle: "v-org0-1", quantity: 80 }],
    need: [{ id: "need-main", building: "b41", type: "water", unit: "L" }],
    resource: [{ id: "r-org0-water", type: "water", unit: "L" }],
    vehicle: [{ id: "v-org0-0", name: "Response truck" }, { id: "v-org0-1", name: "Response truck" }],
  };
}

test("publication and assignment operation choices distinguish same-destination trips by cargo and received vehicle identity", () => {
  const rows = records(), context = { needs: rows.need, resources: rows.resource, vehicles: rows.vehicle };
  assert.equal(assignmentOperationLabel, operationChoiceLabel, "all operation selectors share the same identity rules");
  const labels = rows.operation.map(operation => assignmentOperationLabel(operation, context));
  assert.match(labels[0], /Delivery to Sakura Shelter · 300 L · TK-01-0001 · Unloading/);
  assert.match(labels[1], /Delivery to Sakura Shelter · 80 L · TK-01-0002 · Unloading/);
  assert.equal(new Set(labels).size, 2);
  assert.ok(labels.every(label => !label.includes("operation-")));
  const original = structuredClone(rows);
  rows.operation.forEach(operation => assignmentOperationLabel(operation, context));
  assert.deepEqual(rows, original);
});

test("assignment options keep actual IDs and accessible labels while task headings resolve permitted location names", async () => {
  const rows = records(); let content;
  const controls = createWorkforceControls({
    state: { user: { org: "org0", role: "commander" } }, escape,
    record: async kind => rows[kind] ?? [],
    api: async url => url === "/api/people" ? [{ id: "taylor", name: "Taylor Lee", role: "field" }] : [],
    modal: (_, markup) => { content = markup; },
  });
  assert.equal(await controls.run("task-assign", ""), true);
  assert.match(content, /<option value="operation-1">Delivery to Sakura Shelter · 300 L · TK-01-0001/);
  assert.match(content, /<option value="operation-2">Delivery to Sakura Shelter · 80 L · TK-01-0002/);
  assert.match(content, /<label for="assignment-person">Assigned person<select id="assignment-person" name="assignee"/);
  assert.match(content, /<option value="taylor">Taylor Lee · field<\/option>/);
  assert.doesNotMatch(content.replace(/<[^>]*>/g, ""), /ration-1|ration-2/);
  assert.equal(fieldTaskTitle({ title: "delivery · n41" }), "Delivery · Sakura Shelter access");
});
