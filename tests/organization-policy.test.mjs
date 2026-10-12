import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Organization } from "../src/organization.mjs";
import { Intake } from "../src/intake.mjs";
import { OpenRouterProvider } from "../src/provider.mjs";
test("organization setup resumes durably, rejects stale configuration, and exports only the authorized organization", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  await s.organization("org1");
  const service = new Organization(s, { orgName: "Local Relief" }),
    admin = { org: "org0", id: "admin0", role: "admin" };
  const data = {
    name: "Local Relief Team",
    response: "Regional flood",
    zones: ["East", "West"],
    coordinator: "Coordinator A",
    retentionDays: 30,
    version: 0,
  };
  const saved = await service.configure(admin, data, "configure");
  assert.deepEqual((await new Organization(s, {}).read("org0")).zones, [
    "East",
    "West",
  ]);
  await assert.rejects(
    service.configure(admin, { ...data, name: "Stale change" }, "stale"),
  );
  await s.put("org0", "operation", "local", { state: "ordered" }, 0);
  await s.put(
    "org1",
    "operation",
    "foreign",
    { secret: "private outsider" },
    0,
  );
  const exported = await service.export(
    { ...admin, role: "auditor" },
    { kind: "operation" },
  );
  assert.equal(exported.rows.length, 1);
  assert.equal(exported.rows[0].id, "local");
  await assert.rejects(
    service.export({ ...admin, role: "analyst" }, { kind: "operation" }),
    (e) => e.code === "FORBIDDEN",
  );
  await assert.rejects(service.export(admin, { kind: "users" }));
  assert.equal(saved.version, 1);
});
test("a persistent processing policy can lower budgets and batch size, not raise server maxima or grant dispatch authority", async (t) => {
  const s = await Store.open();
  t.after(() => s.close());
  await s.organization("org0");
  const config = { org: "org0", hourlyCallLimit: 40, hourlyBudgetUsd: 2 },
    intake = new Intake(s, config),
    admin = { org: "org0", id: "admin", role: "admin" };
  await intake.configure(
    admin,
    {
      enabled: true,
      hourlyCallLimit: 1,
      hourlyBudgetUsd: 0.01,
      maxGroups: 1,
      maxSignals: 2,
    },
    "limits",
  );
  assert.equal((await new Intake(s, config).policy()).maxSignals, 2);
  await assert.rejects(
    intake.configure(admin, { enabled: true, hourlyBudgetUsd: 3 }, "too-high"),
    (e) => e.code === "AUTOMATION_LIMIT",
  );
  await assert.rejects(
    intake.configure({ ...admin, role: "agent" }, { enabled: true }, "agent"),
    (e) => e.code === "FORBIDDEN",
  );
  const provider = new OpenRouterProvider(s, {
    ...config,
    budgetUsd: 1,
    maxCalls: 8,
    modelId: "test-model",
    apiKey: "test-not-a-credential",
    pricing: { prompt: 0, completion: 0 },
  });
  provider.pricing = { rates: { prompt: "0", completion: "0" } };
  await s.query(
    "INSERT INTO usage(id,org,episode,model,request_hash,state,started_at,reserved_usd,pricing) VALUES('existing','org0','other','test','h','failed',$1,0.001,'{}')",
    [Date.now()],
  );
  await assert.rejects(
    provider.complete({
      org: "org0",
      episode: "new",
      messages: [
        { role: "user", content: "This must not reach the provider." },
      ],
    }),
    (e) => e.code === "ORGANIZATION_CALL_BUDGET",
  );
  assert.equal(
    Number((await s.query("SELECT COUNT(*) AS n FROM usage")).rows[0].n),
    1,
  );
});
