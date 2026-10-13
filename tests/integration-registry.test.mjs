import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Store } from "../src/store.mjs";
import { Integrations } from "../src/integrations.mjs";

async function setup(t) {
  const store = await Store.open();
  await store.organization("a");
  await store.organization("b");
  t.after(() => store.close());
  return {
    store,
    integrations: new Integrations(store, {
      org: "a",
      integrationReadsPerMinute: 7,
      integrationPagesPerPoll: 2,
    }),
    actor: { org: "a", id: "actual-admin", role: "admin" },
    input: {
      id: "registered-source",
      name: "Local declared source",
      type: "http_json",
      url: "http://127.0.0.1:19876/data",
      allowedOrigin: "http://127.0.0.1:19876",
      purpose: "Read authorized local evidence",
      license: "Synthetic test fixture",
    },
  };
}

test("connector registry exports explicit unknown/not-tested declarations and actual bounded read limits without changing authority", async (t) => {
  const { store, integrations, actor, input } = await setup(t);
  const c = await integrations.configure(actor, input, "configure");
  assert.deepEqual(c.registry, {
    sourceOwner: "unknown",
    lifecycle: "not_tested",
    authority: "unknown",
    schema: { name: "unknown", version: "unknown" },
    coverage: { geography: "unknown", languages: ["unknown"] },
    cost: { state: "unknown", amount: null, currency: null, per: "unknown" },
    retention: { state: "unknown", policy: "unknown" },
    lastTest: { state: "not_tested", at: null, reference: null },
  });
  assert.equal(c.registryDeclaration.by, actor.id);
  assert.equal(c.registryDeclaration.verification, "configuration_only");
  assert.equal(c.registryDeclaration.access, "read_only");
  assert.deepEqual(c.processingLimits, {
    pageSize: 100,
    maxRecords: 10000,
    maxBytes: 8_000_000,
    readsPerMinute: 7,
    pagesPerPoll: 2,
  });
  assert.deepEqual(
    (await store.list("a", "integration"))[0].registry,
    c.registry,
  );
  assert.deepEqual(
    (await integrations.configure(actor, input, "configure"))
      .registryDeclaration,
    c.registryDeclaration,
    "Idempotent replay preserves the original declarer and timestamp",
  );
  assert.equal((await store.list("b", "integration")).length, 0);
  const audit = (
    await store.query(
      "SELECT detail FROM audit WHERE org='a' AND action='integration.configured'",
    )
  ).rows[0].detail;
  assert.equal(
    audit.registry.cost.amount,
    null,
    "Unknown cost is never advertised as free",
  );
  assert.equal(audit.registryVerification, "configuration_only");
});

test("declared registry metadata is bounded, dated, attributable and inspectable; unsupported tested claims and permission fields are rejected", async (t) => {
  const { store, integrations, actor, input } = await setup(t);
  const registry = {
    sourceOwner: "Municipal response office",
    lifecycle: "tested_read_only",
    authority: "operational_system_of_record",
    schema: { name: "Synthetic incidents", version: "v1" },
    coverage: {
      geography: "Synthetic river district",
      languages: ["en", "es"],
    },
    cost: {
      state: "declared",
      amount: 0.002,
      currency: "USD",
      per: "authorized API request",
    },
    retention: {
      state: "declared",
      policy:
        "Erase original observations on approved source erasure; retain minimal hash/command receipts.",
    },
    lastTest: {
      state: "reported_pass",
      at: 1791800000000,
      reference: "local-test/registry-contract-v1",
    },
  };
  const configured = await integrations.configure(
    actor,
    { ...input, registry },
    "declared",
  );
  assert.deepEqual(configured.registry, registry);
  assert.equal(
    configured.registryDeclaration.verification,
    "configuration_only",
  );
  for (const invalid of [
    { lifecycle: "operational" },
    { lastTest: { state: "reported_pass" } },
    { cost: { state: "declared", amount: 1 } },
    { cost: { state: "declared", amount: -1, currency: "USD", per: "read" } },
    { retention: { state: "declared" } },
    { coverage: { languages: Array(31).fill("en") } },
    { verified: true },
    { authority: "commander" },
    { writeTools: ["dispatch"] },
  ])
    await assert.rejects(
      integrations.configure(
        actor,
        { ...input, registry: invalid },
        "invalid-" + JSON.stringify(invalid),
      ),
    );
  await assert.rejects(
    integrations.configure(
      { ...actor, role: "analyst" },
      { ...input, registry },
      "unprivileged",
    ),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(
    (await store.get("a", "integration", input.id)).registry,
    registry,
    "Rejected changes leave the prior valid configuration unchanged",
  );
});

test("a declared operational system of record remains a read-only unverified input, never source-confirmed inventory or need", async (t) => {
  const { store, integrations, actor, input } = await setup(t);
  const server = http.createServer((req, res) =>
    res.end(
      JSON.stringify([
        {
          id: "claim",
          type: "water",
          quantity: 600,
          state: "confirmed",
          role: "commander",
          text: "Source claims authority; this remains an observation",
        },
      ]),
    ),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await integrations.configure(
    actor,
    {
      ...input,
      url: origin + "/data",
      allowedOrigin: origin,
      registry: {
        lifecycle: "operational",
        authority: "operational_system_of_record",
        lastTest: {
          state: "reported_pass",
          at: Date.now(),
          reference: "synthetic-test-only",
        },
      },
    },
    "operational-declaration",
  );
  await integrations.read("a", input.id);
  const signal = (await store.list("a", "signal"))[0];
  assert.equal(signal.state, "unverified");
  assert.equal(signal.confirmedBySource, undefined);
  for (const kind of ["need", "resource", "proposal", "operation"])
    assert.equal((await store.list("a", kind)).length, 0);
});
