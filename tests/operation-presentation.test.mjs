import assert from "node:assert/strict";
import test from "node:test";
import {
  createOperationView,
  operationSummary,
} from "../ui/operation-view.mjs";
import { setDisplayContext } from "../ui/labels.mjs";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const view = createOperationView({
  escape,
  badge: (state) => `<span>${escape(state)}</span>`,
  action: (label, action, id) =>
    `<button data-action="${action}" data-id="${escape(id)}">${escape(label)}</button>`,
  number: (value) => Number(value).toLocaleString("en-US"),
});
function context() {
  setDisplayContext({
    organization: { id: "org0", name: "Relief North" },
    geography: {
      places: [
        { id: "b2179", node: "n2561", name: "Sakura Shelter", use: "shelter" },
      ],
    },
  });
  return {
    organization: "org0",
    currentUser: {
      id: "user_commander-uuid",
      name: "Alex Morgan",
      role: "commander",
    },
    people: [
      { id: "user_dispatcher-uuid", name: "Yuna Mori", role: "dispatcher" },
    ],
    needs: [
      {
        id: "need-water-main",
        building: "b2179",
        type: "water",
        unit: "L",
        quantity: 600,
      },
    ],
    resources: [{ id: "r-org0-water", type: "water", unit: "L" }],
    vehicles: [{ id: "v-org0-0", name: "Harbor response truck" }],
  };
}
const shipment = () => ({
  id: "operation-2",
  type: "delivery",
  state: "completed",
  org: "org0",
  authorizedBy: "user_commander-uuid",
  resource: "r-org0-water",
  resourceType: "water",
  vehicle: "v-org0-0",
  need: "need-water-main",
  building: "b2179",
  destination: "n2561",
  quantity: 300,
  received: 120,
  confirmedBySource: true,
  times: {
    authorized: 110010,
    accepted: 111011,
    prepared: 171011,
    dispatched: 171011,
    arrived: 642258,
    received: 702258,
    service: 702258,
  },
});

test("operations use destination, native cargo units, named vehicle and permitted author instead of raw identifiers", () => {
  const data = shipment(),
    before = structuredClone(data),
    records = context(),
    summary = operationSummary(data, records),
    row = view.row(data, records);
  assert.equal(summary.title, "Delivery to Sakura Shelter");
  assert.equal(summary.unit, "L");
  assert.equal(summary.author, "Alex Morgan");
  assert.equal(summary.vehicle, "Harbor response truck");
  assert.match(row, /300 L · Drinking water · Harbor response truck/);
  assert.match(row, /Alex Morgan/);
  assert.match(
    row,
    /120 L received/,
    "partial physical receipt stays distinct from planned quantity",
  );
  assert.doesNotMatch(
    row.replace(/<[^>]*>/g, ""),
    /ration-2|user_commander|300 units/,
  );
  assert.match(
    row,
    /data-action="operation" data-id="operation-2"/,
    "the exact follow identifier remains unchanged",
  );
  assert.deepEqual(data, before);
});

test("follow detail keeps the same human labels and full technical identity in a collapsed disclosure", () => {
  const data = shipment(),
    html = view.detail(data, context()),
    primary = html.split("<details")[0];
  assert.match(primary, /Delivery to Sakura Shelter/);
  assert.match(primary, /300 L · Drinking water · Harbor response truck/);
  assert.match(primary, /120 L received by the operational source/);
  assert.match(primary, /Alex Morgan/);
  assert.doesNotMatch(
    primary,
    /operation-2|user_commander|need-water-main|r-org0-water/,
  );
  assert.match(
    html,
    /<details class="collapse"><summary>Operational record &amp; timestamps<\/summary>|<details class="collapse"><summary>Operational record & timestamps<\/summary>/,
  );
  assert.match(html, /&quot;id&quot;: &quot;operation-2&quot;/);
  assert.match(
    html,
    /user_commander-uuid/,
    "technical provenance remains available",
  );
  assert.equal(
    operationSummary(data, context()).stages.filter(([, done]) => done).length,
    7,
  );
});

test("only permitted people become names; missing unit and unconfirmed timestamps remain explicit", () => {
  const data = shipment(),
    records = context();
  data.authorizedBy = "user_dispatcher-uuid";
  assert.equal(operationSummary(data, records).author, "Yuna Mori");
  data.authorizedBy = "user_private-not-in-directory";
  assert.equal(
    operationSummary(data, records).author,
    "Authorized coordinator",
  );
  data.confirmedBySource = false;
  const summary = operationSummary(data, records),
    html = view.detail(data, records).split("<details")[0];
  assert.equal(summary.confirmation, "Awaiting source acknowledgement");
  assert.equal(summary.received, null);
  assert.equal(
    summary.stages.filter(([, done]) => done).length,
    1,
    "a local record cannot certify travel or receipt",
  );
  assert.doesNotMatch(
    html,
    /120 L received|Receipt recorded|Source acknowledged/,
  );
  const unknown = operationSummary(
    {
      id: "operation-new",
      type: "delivery",
      quantity: 3,
      authorizedBy: "user_unknown",
    },
    {},
  );
  assert.equal(unknown.unit, null);
  assert.match(
    view.row({ id: "operation-new", type: "delivery", quantity: 3 }, {}),
    /3 \(unit not recorded\)/,
  );
  assert.equal(
    operationSummary(
      { resourceType: "water", quantity: 300, type: "delivery" },
      {},
    ).unit,
    "L",
  );
});

test("explicit received units, locations and escaped names are preserved without changing an operation", () => {
  const data = shipment(),
    records = context();
  data.unit = "containers";
  data.building = "b2179";
  records.needs[0].building = "a-different-current-case";
  records.currentUser.name = "<script>not markup</script>";
  const html = view.row(data, records);
  assert.match(html, /300 containers/);
  assert.match(
    html,
    /Sakura Shelter/,
    "the operation keeps its original physical destination",
  );
  assert.match(html, /&lt;script&gt;not markup&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(
    operationSummary({ type: "evacuation", quantity: 10 }, {}).unit,
    "people",
  );
});

test("unknown UUIDs and source actor identifiers stay technical without fabricated person names", () => {
  for (const id of [
    "7accc017-f9ab-4850-a60d-3d766441af46",
    "external-org0",
    "human-org0",
  ]) {
    const data = { ...shipment(), authorizedBy: id };
    assert.equal(operationSummary(data, {}).author, "Authorized coordinator");
    const html = view.detail(data, {}),
      visible = html.split("<details")[0];
    assert.ok(!visible.includes(id));
    assert.ok(html.includes(id), "original authority remains inspectable");
  }
});

test("source-completed inspections and road repairs show completed work without inventing a goods receipt", () => {
  const records = context();
  for (const type of ["inspection", "repair"]) {
    // These are the source task lifecycle fields: service completes the work;
    // neither task has cargo or a goods-received timestamp.
    const data = {
      id: `operation-${type}`,
      type,
      state: "completed",
      org: "org0",
      vehicle: "v-org0-0",
      destination: "n2561",
      confirmedBySource: true,
      times: { authorized: 10, dispatched: 20, arrived: 100, service: 150 },
    };
    const before = structuredClone(data),
      summary = operationSummary(data, records),
      html = view.detail(data, records).split("<details")[0];
    assert.equal(summary.received, null);
    assert.equal(summary.confirmation, type === "repair" ? "Road repair completed" : "Field visit completed");
    assert.equal(summary.stages.at(-1)[0], "Completed");
    assert.equal(summary.stages.at(-1)[1], true);
    assert.ok(!summary.stages.some(([label]) => label === "Received"));
    assert.match(html, /confirms that the (?:road repair|field visit) is complete/);
    assert.doesNotMatch(html, /receipt|>Received<|>Service</i);
    assert.deepEqual(data, before);
  }
});

test("field task arrival stays distinct from completion and unconfirmed local timestamps cannot certify either", () => {
  for (const type of ["inspection", "repair"]) {
    const data = {
      type,
      state: "arrived",
      confirmedBySource: true,
      times: { authorized: 10, arrived: 100 },
    };
    const arrived = operationSummary(data),
      html = view.detail(data, context()).split("<details")[0];
    assert.equal(arrived.confirmation, "At the worksite");
    assert.equal(arrived.stages.at(-1)[1], false);
    assert.match(arrived.confirmationText, /Task completion is not yet confirmed/);
    assert.doesNotMatch(html, /receipt|>Received</i);

    data.times.service = 150;
    data.times.received = 150; // A stray local receipt is not relevant to field work.
    data.confirmedBySource = false;
    const local = operationSummary(data);
    assert.equal(local.confirmation, "Awaiting source acknowledgement");
    assert.equal(local.received, null);
    assert.equal(local.stages.filter(([, done]) => done).length, 1);
    assert.match(local.confirmationText, /not yet reached confirmed completion/);
  }
});
