import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Auth } from "../src/auth.mjs";
import { Domain } from "../src/domain.mjs";
import { Workforce } from "../src/workforce.mjs";
import { authorizationCurrent } from "../src/authority.mjs";
import { createPlatform } from "../server.mjs";

async function setup(t) {
  const s = await Store.open();
  await s.organization("org0");
  await s.organization("org1");
  t.after(() => s.close());
  const auth = new Auth(s),
    d = new Domain(s, { peers: [] }),
    w = new Workforce(s, d);
  const add = (role, n, org = "org0") =>
    auth.create(null, {
      org,
      email: `${n}@example.test`,
      name: n,
      role,
      password: "workforce-test-password",
    });
  const c = await add("commander", "coordinator"),
    a = await add("analyst", "analyst"),
    f = await add("field", "field-one"),
    f2 = await add("field", "field-two"),
    other = await add("field", "other-field", "org1");
  await s.put(
    "org0",
    "operation",
    "delivery",
    {
      type: "dispatch",
      owner: "org0",
      from: "depot",
      to: "shelter",
      quantity: 20,
      unit: "L",
      state: "in_transit",
    },
    0,
  );
  await s.put(
    "org0",
    "need",
    "need",
    { type: "water", quantity: 20, served: 0 },
    0,
  );
  await s.put(
    "org0",
    "signal",
    "post",
    { text: "20 L requested", sourceVersion: 1 },
    0,
  );
  await s.put(
    "org0",
    "resource",
    "water",
    { type: "water", quantity: 20, reserved: 0, floor: 0, owner: "org0" },
    0,
  );
  await s.put(
    "org0",
    "vehicle",
    "van",
    { capacity: 20, state: "idle", owner: "org0" },
    0,
  );
  const draft = {
    title: "Deliver an observed water requirement",
    summary: "20 L to a recorded need",
    benefit: "Useful water",
    references: ["post"],
    conditions: [],
    alternatives: [],
    actions: [
      {
        type: "dispatch",
        owner: "org0",
        params: {
          resource: "water",
          need: "need",
          vehicle: "van",
          quantity: 20,
        },
        dependsOn: [],
      },
    ],
    priority: "urgent",
    rationale: "Received stock and requirement checked.",
  };
  return { s, auth, d, w, c, a, f, f2, other, draft };
}
test("field tasks are assigned to active scoped humans and reports do not create physical aid", async (t) => {
  const { s, w, c, f, f2, other } = await setup(t);
  await assert.rejects(
    w.assign(c, { operation: "delivery", assignee: other.id }, "foreign"),
    (e) => e.code === "ASSIGNEE",
  );
  let task = await w.assign(
    c,
    {
      operation: "delivery",
      assignee: f.id,
      instructions: "Confirm with the receiving team.",
    },
    "assign",
  );
  assert.deepEqual(await w.tasks(f2), []);
  assert.equal((await w.tasks(f)).length, 1);
  await assert.rejects(
    w.update(
      f2,
      { id: task.id, version: task.version, stage: "acknowledged" },
      "wrong-person",
    ),
    (e) => e.code === "TASK_OWNER",
  );
  const payload = { id: task.id, version: task.version, stage: "acknowledged" };
  task = await w.update(f, payload, "device-ack");
  assert.deepEqual(
    await w.update(f, payload, "device-ack"),
    task,
    "retries preserve the same acknowledgement",
  );
  task = await w.update(
    f,
    { id: task.id, version: task.version, stage: "departed" },
    "depart",
  );
  task = await w.update(
    f,
    { id: task.id, version: task.version, stage: "arrived" },
    "arrive",
  );
  await assert.rejects(
    w.update(
      f,
      {
        id: task.id,
        version: task.version,
        stage: "receipt_reported",
        quantity: 21,
        note: "Receiving team checked",
      },
      "over",
    ),
    (e) => e.code === "QUANTITY",
  );
  task = await w.update(
    f,
    {
      id: task.id,
      version: task.version,
      stage: "receipt_reported",
      quantity: 15,
      note: "Receiving team reports a partial delivery.",
    },
    "partial",
  );
  assert.equal(task.reportedQuantity, 15);
  assert.equal(
    (await s.get("org0", "operation", "delivery")).state,
    "in_transit",
  );
  assert.equal((await s.get("org0", "need", "need")).served, 0);
  assert.equal(
    (await s.list("org0", "report")).at(-1).physicalConfirmation,
    false,
  );
});
test("shift handover is versioned, requires the receiver and does not transfer an approval", async (t) => {
  const { s, w, d, c, f, f2, draft } = await setup(t);
  const task = await w.assign(
      c,
      { operation: "delivery", assignee: f.id },
      "assign",
    ),
    p = await d.propose(c, draft, "draft");
  const h = await w.handover(
    c,
    {
      tasks: [task.id],
      to: f2.id,
      note: "Check the pending destination report.",
      versionById: { [task.id]: task.version },
    },
    "handover",
  );
  const newTask = await s.get("org0", "task", task.id);
  await assert.rejects(
    w.update(
      f,
      { id: task.id, version: newTask.version, stage: "acknowledged" },
      "old-assignee",
    ),
    (e) => e.code === "TASK_OWNER",
  );
  await assert.rejects(
    w.acknowledgeHandover(f, { id: h.id, version: h.version }, "wrong-ack"),
    (e) => e.code === "HANDOVER_OWNER",
  );
  const ack = await w.acknowledgeHandover(
    f2,
    { id: h.id, version: h.version },
    "ack-handover",
  );
  assert.ok(ack.acknowledgedAt);
  assert.equal(newTask.state, "assigned");
  await w.handover(
    c,
    {
      proposals: [p.id],
      to: c.id,
      note: "Review the unresolved current proposal.",
      versionById: { [p.id]: p.version },
    },
    "decision-handover",
  );
  assert.equal((await s.get("org0", "proposal", p.id)).authorization, null);
});
test("exact human delegations allow a scoped analyst review and revocation invalidates future work", async (t) => {
  const { s, w, d, c, a, draft } = await setup(t);
  const p = await d.propose(c, draft, "draft");
  await assert.rejects(
    d.review(a, p.id, { decision: "approve", version: p.version }, "unscoped"),
    (e) => e.code === "REVIEW_SCOPE",
  );
  const g = await w.delegate(
    c,
    {
      proposal: p.id,
      version: p.version,
      to: a.id,
      note: "Review this allocation within the current shift.",
    },
    "delegate",
  );
  const approved = await d.review(
    a,
    p.id,
    { decision: "approve", version: p.version },
    "scoped",
  );
  assert.equal(approved.authorization.delegation, g.id);
  assert.ok(approved.authorization.expiresAt <= g.expiresAt);
  assert.equal(
    await authorizationCurrent(s, "org0", approved.authorization),
    true,
  );
  await w.revoke(c, { id: g.id, version: g.version }, "revoke");
  const current = await s.get("org0", "proposal", p.id);
  assert.equal(current.state, "requires_review");
  assert.equal(current.authorization, null);
  assert.equal(
    await authorizationCurrent(s, "org0", approved.authorization),
    false,
  );
});
test("an expired or revised delegated proposal cannot retain its scope, and deactivated owners stop future approvals", async (t) => {
  const { s, w, d, c, a, auth, draft } = await setup(t);
  let p = await d.propose(c, draft, "draft");
  const g = await w.delegate(
    c,
    {
      proposal: p.id,
      version: p.version,
      to: a.id,
      note: "Review this one version only.",
    },
    "delegate",
  );
  p = await s.put(
    "org0",
    "proposal",
    p.id,
    { ...p, summary: "Changed scope review" },
    p.version,
  );
  await assert.rejects(
    d.review(a, p.id, { decision: "approve", version: p.version }, "changed"),
    (e) => e.code === "REVIEW_SCOPE",
  );
  await s.upsert("org0", "delegation", g.id, {
    proposalVersion: p.version,
    expiresAt: Date.now() - 1,
  });
  await assert.rejects(
    d.review(a, p.id, { decision: "approve", version: p.version }, "expired"),
    (e) => e.code === "REVIEW_SCOPE",
  );
  const approved = await d.review(
    c,
    p.id,
    { decision: "approve", version: p.version },
    "commander-review",
  );
  await s.query("UPDATE users SET active=false WHERE id=$1", [c.id]);
  assert.equal(
    await authorizationCurrent(s, "org0", approved.authorization),
    false,
  );
});
test("the HTTP field role cannot read decision, source context or identity collections", async (t) => {
  const { s, f } = await setup(t);
  const app = await createPlatform({
    org: "org0",
    store: s,
    port: 0,
    autoIngest: false,
    startWorker: false,
    writeAccessFile: false,
  });
  t.after(() => app.close());
  const login = await fetch(app.url + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: app.url },
    body: JSON.stringify({
      email: f.email,
      password: "workforce-test-password",
    }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  for (const endpoint of [
    "/api/context",
    "/api/dashboard",
    "/api/records?kind=proposal",
    "/api/users",
    "/api/usage",
  ])
    assert.equal(
      (await fetch(app.url + endpoint, { headers: { cookie } })).status,
      403,
      endpoint,
    );
  assert.equal(
    (await fetch(app.url + "/api/tasks", { headers: { cookie } })).status,
    200,
  );
});


test('field assignments expose only their readable received destination and native unit without map access or changing legacy task versions', async t => {
  const {s,w,c,f,f2} = await setup(t);
  await s.put('org0','context','geography',{map:{
    nodes:[{id:'n2180',name:'Sakura Shelter access'},{id:'private-node',name:'Private unrelated staging area'}],
    places:[{id:'b2180',node:'n2180',name:'Sakura Shelter'},{id:'private-place',node:'private-node',name:'Private unrelated site'}],
    roads:[{id:'private-road',from:'n2180',to:'private-node'}],
  }},0);
  await s.put('org1','context','geography',{map:{nodes:[{id:'n2180',name:'Other tenant private destination'}]}},0);
  await s.upsert('org0','resource','water',{unit:'L'});
  await s.upsert('org0','operation','delivery',{type:'delivery',destination:'n2180',to:null,building:'b2180',resource:'water',unit:null});
  const task = await w.assign(c,{operation:'delivery',assignee:f.id,instructions:'Confirm with the receiving team.'},'named-assignment');
  assert.equal(task.title,'Delivery to Sakura Shelter');
  assert.equal(task.destination,'n2180');
  assert.equal(task.destinationName,'Sakura Shelter');
  assert.equal(task.unit,'L');
  // Existing assignments gain a read projection without rewriting their
  // version, stage, signature or the original exact operation references.
  const legacy = await s.upsert('org0','task',task.id,{title:'delivery · n2180',destinationName:null,unit:null});
  const app = await createPlatform({org:'org0',store:s,port:0,autoIngest:false,startWorker:false,writeAccessFile:false});
  t.after(()=>app.close());
  const login = await fetch(app.url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password:'workforce-test-password'})});
  assert.equal(login.status,200);
  const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
  const response=await fetch(app.url+'/api/tasks',{headers});
  assert.equal(response.status,200);
  const rows=await response.json();
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Delivery to Sakura Shelter');
  assert.equal(rows[0].destinationName,'Sakura Shelter');
  assert.equal(rows[0].unit,'L');
  assert.equal(rows[0].version,legacy.version);
  assert.deepEqual(await s.get('org0','task',task.id),legacy);
  assert.deepEqual(await w.tasks(f2),[]);
  assert.equal((await fetch(app.url+'/api/map',{headers})).status,403);
  assert.doesNotMatch(JSON.stringify(rows),/Private unrelated|Other tenant|private-road|private-node|private-place/);
  // An absent directory name remains explicitly unknown rather than being
  // replaced by a made-up site or by an opaque raw identifier in the title.
  await s.upsert('org0','operation','unnamed',{type:'delivery',destination:'n9999',quantity:1,state:'reserved'});
  const unnamed=await w.assign(c,{operation:'unnamed',assignee:f2.id},'unnamed-assignment');
  assert.equal(unnamed.title,'Delivery · Assigned destination');
  assert.equal(unnamed.destinationName,null);
  assert.equal(unnamed.destination,'n9999');
});
