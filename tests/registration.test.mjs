import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { createPlatform } from "../server.mjs";
import {
  receivedLocations,
  localResourceInput,
  localResourceForm,
  registrationGuide,
} from "../ui/registration.mjs";

const geography = {
  nodes: [
    { id: "n1", name: "Harbor access" },
    { id: "n2", name: "Sakura access" },
  ],
  places: [
    { id: "b1", node: "n1", name: "Harbor Depot" },
    { id: "b2", node: "n1", name: "Harbor Annex" },
    { id: "missing", node: "absent", name: "Invalid" },
  ],
};

test("local inventory uses received location identifiers with readable names and explicit unknown locations", () => {
  const locations = receivedLocations(geography);
  assert.deepEqual(locations, [
    { id: "n1", label: "Harbor Depot" },
    { id: "n2", label: "Sakura access" },
  ]);
  const values = {
    label: " Water reserve ",
    type: "water",
    quantity: "120",
    floor: "20",
    unit: " litres ",
    node: "n1",
  };
  assert.deepEqual(localResourceInput(values, locations), {
    label: "Water reserve",
    type: "water",
    quantity: 120,
    floor: 20,
    unit: "litres",
    node: "n1",
  });
  assert.equal(
    "node" in localResourceInput({ ...values, node: "" }, locations),
    false,
  );
  assert.deepEqual(receivedLocations(null), []);
  for (const invalid of [
    { label: "" },
    { type: "unknown" },
    { quantity: "" },
    { quantity: "NaN" },
    { quantity: "1.5" },
    { floor: "-1" },
    { floor: "121" },
    { unit: "" },
    { node: "invented" },
  ])
    assert.throws(() =>
      localResourceInput({ ...values, ...invalid }, locations),
    );
});

test("registration explains operator records and source-owned vehicles without promising to create physical assets", () => {
  const h = {
    escape: (value) =>
      String(value).replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
    icon: () => "",
    action: (label, action) =>
      `<button data-action="${action}">${label}</button>`,
  };
  const html = localResourceForm([{ id: 'n1"', label: "<Depot>" }], h);
  assert.match(html, /value="n1&quot;"/);
  assert.doesNotMatch(html, /<Depot>/);
  assert.match(html, /Location not confirmed/);
  assert.match(html, /source/);
  const commander = registrationGuide({ ...h, role: "commander" });
  assert.match(commander, /Record inventory/);
  assert.match(commander, /Add an observation/);
  assert.match(commander, /Get vehicles/);
  const admin = registrationGuide({ ...h, role: "admin" });
  assert.match(admin, /External connections/);
  assert.doesNotMatch(admin, /data-action="navigate">Add an observation/);
  assert.match(localResourceForm([], h), /No map has been received yet/);
});

test("actual HTTP forms save local inventory, reject invalid reserves and protect imported assets; admins can request scoped reads", async (t) => {
  const store = await Store.open(),
    calls = [];
  const connector = {
    action: async (type, params, key) => {
      calls.push({ type, params, key });
      return { id: "query-vehicles", state: "queued" };
    },
  };
  const app = await createPlatform({
    store,
    connector,
    org: "org0",
    orgName: "Harbor Relief",
    port: 0,
    startWorker: false,
    autoIngest: false,
    writeAccessFile: false,
    bootstrapPassword: "registration-test-password",
    provider: {
      complete() {
        throw new Error(
          "No model call is permitted in registration verification",
        );
      },
    },
  });
  t.after(async () => {
    await app.close();
    await store.close();
  });
  await store.put("org0", "context", "geography", { map: geography }, 0);
  async function login(role) {
    const response = await fetch(app.url + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${role}@org0.aidscaler.local`,
        password: "registration-test-password",
      }),
    });
    assert.equal(response.status, 200);
    return {
      cookie: response.headers.get("set-cookie").split(";")[0],
      csrf: (await response.json()).csrf,
    };
  }
  const admin = await login("admin");
  async function post(session, endpoint, data, key = crypto.randomUUID()) {
    return fetch(app.url + endpoint, {
      method: "POST",
      headers: {
        cookie: session.cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(data),
    });
  }
  const map = await (
    await fetch(app.url + "/api/map", { headers: { cookie: admin.cookie } })
  ).json();
  const input = localResourceInput(
    {
      label: "Harbor water reserve",
      type: "water",
      quantity: "100",
      floor: "20",
      unit: "L",
      node: "n1",
    },
    receivedLocations(map.geography),
  );
  const created = await post(
    admin,
    "/api/resource",
    input,
    "registration-create",
  );
  assert.equal(created.status, 200);
  const resource = await created.json();
  assert.equal(resource.label, input.label);
  assert.equal(resource.node, "n1");
  assert.equal(resource.owner, "org0");
  assert.equal(resource.sourceSnapshot, undefined);
  const repeated = await post(
    admin,
    "/api/resource",
    input,
    "registration-create",
  );
  assert.equal((await repeated.json()).id, resource.id);
  for (const invalid of [
    { floor: -1 },
    { floor: 101 },
    { type: "" },
    { label: "" },
    { unit: "" },
  ])
    assert.equal(
      (await post(admin, "/api/resource", { ...input, ...invalid })).status,
      400,
    );
  await store.put(
    "org0",
    "resource",
    "source-water",
    { ...input, owner: "org0", reserved: 0, sourceSnapshot: "run0" },
    0,
  );
  const importedEdit = await post(admin, "/api/resource", {
    ...input,
    id: "source-water",
    version: 1,
    quantity: 999,
  });
  assert.equal(importedEdit.status, 409);
  assert.equal((await importedEdit.json()).error, "RESOURCE_SOURCE");
  assert.equal(
    (await store.get("org0", "resource", "source-water")).quantity,
    100,
  );
  const queried = await post(admin, "/api/query", { target: "vehicles" });
  assert.equal(queried.status, 202);
  assert.deepEqual(
    calls.map((call) => [call.type, call.params.target]),
    [["query", "vehicles"]],
  );
  const analyst = await login("analyst");
  assert.equal((await post(analyst, "/api/resource", input)).status, 403);
  const field = await login("field");
  assert.equal(
    (await post(field, "/api/query", { target: "vehicles" })).status,
    403,
  );
  assert.equal((await fetch(app.url + "/registration.mjs")).status, 200);
});
