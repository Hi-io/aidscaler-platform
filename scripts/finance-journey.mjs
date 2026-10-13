import { chromium } from "@playwright/test";
import { createHarness, scriptedReview, buildFingerprint, evaluatorFingerprint } from "../evaluation/harness.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const before = { candidate: await buildFingerprint(), evaluator: await evaluatorFingerprint() },
  h = await createHarness({ config: { grid: 5, extentKm: 2,
    supply: { purchaseTranches: [{ fraction: 0.6, delayMs: 60000 }, { fraction: 0.4, delayMs: 180000 }] } },
    provider: { complete: async () => { throw Error("Inference is forbidden in a financial UI journey"); } } }),
  app = h.apps[0], browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" }),
  page = await context.newPage(), checks = [], errors = [], expectedAnonymousSessionProbes = [], folder = `reports/finance-journey/${Date.now()}`;
page.on("pageerror", e => errors.push(e.message));
page.on("console", message => {
  if (message.type() !== "error") return;
  const text = message.text(), url = message.location().url;
  // The unauthenticated entry page intentionally probes its session. Preserve
  // this 401 separately; every operational or unrelated console error fails.
  if (/status of 401/.test(text) && url === app.url + "/api/me") expectedAnonymousSessionProbes.push({ path: "/api/me", status: 401 });
  else errors.push({ text, url });
});
async function login(role, targetPage = page) {
  await targetPage.goto(app.url);
  await targetPage.getByLabel("Email", { exact: true }).fill(`${role}@org0.nexo.local`);
  await targetPage.getByLabel("Password", { exact: true }).fill("evaluation-password");
  await targetPage.getByRole("button", { name: "Enter workspace", exact: true }).click();
  await targetPage.locator(".workspace").waitFor();
}
async function financePage() {
  await page.goto(app.url + "/#finance");
  await page.getByRole("heading", { name: "Manage settled support", exact: true }).waitFor();
}
async function freshReceipts() {
  await financePage();
  await page.getByText(/Source purchases and receipts \(/).click();
  await page.getByRole("button", { name: "Request current source receipts", exact: true }).click();
  await page.getByText("Source query requested. Await its receipt before reviewing.", { exact: true }).waitFor();
  await financePage();
}
async function publishAggregate(reason) {
  await page.getByText("Review the public aggregate", { exact: true }).click();
  await page.locator("#financepublishform [name=reason]").fill(reason);
  await page.getByRole("button", { name: "Approve public aggregate", exact: true }).click();
  await page.getByText("Reviewed aggregate published.", { exact: true }).waitFor();
}
async function noOverflow(targetPage, label) {
  assert.equal(await targetPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label);
  checks.push(label + " has no horizontal overflow");
}
try {
  await mkdir(folder, { recursive: true });
  h.lab.world.advance(60000); await app.ingestion.sync({ sources: false });
  await page.goto(app.url + "/public");
  await page.getByLabel("Test contribution in USD", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Try test contribution" }).click();
  await page.getByRole("heading", { name: "Test contribution created", exact: true }).waitFor();
  const donation = (await app.store.list("org0", "donation"))[0];
  assert.equal(donation.state, "pending"); assert.equal((await app.finance.summary("org0")).receivedCents, 0);
  checks.push("Browser contribution remains pending until an authenticated local sandbox provider settles it");
  const settled = { org: "org0", id: donation.id, state: "settled", eventId: "finance-ui-settled" };
  const res = await fetch(app.url + "/api/finance/webhook", { method: "POST", headers: {
    "Content-Type": "application/json", "X-Payment-Signature": app.finance.signature(settled) }, body: JSON.stringify(settled) });
  assert.equal(res.status, 200);
  await login("finance"); await financePage();
  await page.getByText("Allocate funds", { exact: true }).click();
  await page.locator("#allocateform [name=amount]").fill("8");
  await page.locator("#allocateform [name=reason]").fill("Human-reviewed water procurement budget");
  await page.getByRole("button", { name: "Record allocation", exact: true }).click();
  await page.getByText("Budget change recorded with an audit record.", { exact: true }).waitFor();
  assert.equal((await app.finance.summary("org0")).allocatedCents, 800);
  checks.push("Financial reviewer records a real settled USD sandbox budget through the browser");

  // External physical fixture: an ordinary human-reviewed source purchase, not
  // a browser-created delivery or a fabricated finance result.
  const proposal = await app.domain.propose({ id: "finance-ui-agent", org: "org0", role: "agent" }, {
    title: "Order source water stock", summary: "Physical receipts before fulfillment", rationale: "Separate source treasury from local USD accounting",
    benefit: "Usable supplies after supplier arrival", references: ["r-org0-water"], conditions: [],
    actions: [{ type: "purchase", owner: "org0", dependsOn: [], params: { type: "water", quantity: 10, price: 1, leadMs: 180000 } }],
  }, "finance-ui-physical-order");
  assert.equal(await scriptedReview(app, proposal), true); assert.equal((await app.worker.execute(proposal.id)).complete, false);
  await freshReceipts();
  await page.getByText(/Source purchases and receipts \(/).click();
  await page.locator("summary").filter({ hasText: /water · Not reconciled/ }).click();
  await page.locator(".reconcileform [name=amount]").fill("5");
  await page.locator(".reconcileform [name=reason]").fill("Explicit accounting equivalence: ten sandbox credits to five local USD test budget; no exchange rate assumed.");
  await page.getByRole("button", { name: "Review and record spend", exact: true }).click();
  await page.getByText("Source spend reconciled. Physical receipts remain a separate state.", { exact: true }).waitFor();
  assert.equal((await app.finance.summary("org0")).spentCents, 500);
  assert.equal((await app.finance.publicSummary("org0")), null);
  const purchase = (await app.store.list("org0", "source_purchase"))[0].purchase;
  assert.equal(purchase.receivedQuantity, 0);
  checks.push("Explicit browser approval links a source expense to an unspent budget exactly once; paying does not publish a receipt");

  h.lab.world.advance(purchase.createdAt + 90000); assert.equal((await app.worker.execute(proposal.id)).complete, false);
  await freshReceipts();
  await publishAggregate("Six of ten native litres have arrived at the organization; four remain pending. Not delivery to people.");
  const partial = await app.finance.publicSummary("org0");
  assert.equal(partial.snapshot.procurement[0].receivedQuantity, 6); assert.equal(partial.snapshot.procurement[0].pendingQuantity, 4);
  const publicPage = await context.newPage();
  publicPage.on("pageerror", e => errors.push(e.message));
  await publicPage.goto(app.url + "/public");
  await publicPage.getByText("6 / 10 received by the organization", { exact: true }).waitFor();
  for (const width of [1920, 390]) {
    await publicPage.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
    await noOverflow(publicPage, `Approved partial public aggregate at ${width}px`);
    await publicPage.screenshot({ path: `${folder}/public-partial-${width}.png`, fullPage: true });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
    await financePage(); await noOverflow(page, `Financial reviewer at ${width}px`);
    await page.screenshot({ path: `${folder}/finance-${width}.png`, fullPage: true });
  }
  checks.push("Public browser shows only the deliberately reviewed partial six-of-ten aggregate without source purchase IDs");
  assert.equal((await publicPage.textContent("main")).includes(purchase.id), false);
  h.lab.world.advance(purchase.createdAt + 210000); assert.equal((await app.worker.execute(proposal.id)).complete, true);
  await freshReceipts(); await publicPage.reload();
  await publicPage.getByText("6 / 10 received by the organization", { exact: true }).waitFor();
  assert.equal((await app.store.get("org0", "purchase_reconciliation", purchase.id)).physicalReceived, 10);
  checks.push("Actual complete supplier receipt updates private evidence while the public aggregate remains at the earlier human review");
  await publishAggregate("All ten litres have arrived at the organization. Stock receipt remains separate from help delivered.");
  await publicPage.reload(); await publicPage.getByText("10 / 10 received by the organization", { exact: true }).waitFor();
  assert.equal((await app.store.query("SELECT COUNT(*) AS n FROM finance WHERE type='spent'")).rows[0].n, 1);
  assert.equal((await app.store.query("SELECT COUNT(*) AS n FROM usage")).rows[0].n, 0);
  checks.push("A new financial review publishes the later native quantity without another financial charge or any model call");
  await publicPage.close();
  for (const role of ["auditor", "analyst"]) {
    const other = await browser.newContext({ viewport: { width: 390, height: 844 } }), p = await other.newPage();
    p.on("pageerror", e => errors.push(e.message));
    await login(role, p); await p.goto(app.url + "/#finance");
    if (role === "auditor") await p.getByRole("heading", { name: "Manage settled support", exact: true }).waitFor();
    else await p.getByRole("heading", { name: "A clearer picture. A faster response.", exact: true }).waitFor();
    assert.equal(await p.locator("#allocateform,.reconcileform,#financepublishform").count(), 0);
    checks.push(`${role} has no financial reconciliation, allocation or publication form`); await other.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(h.lab.world.invariants(), []);
  const after = { candidate: await buildFingerprint(), evaluator: await evaluatorFingerprint() };
  assert.deepEqual(after, before, "A concurrent source change invalidates this UI evidence");
  await writeFile(`${folder}/result.json`, JSON.stringify({ at: new Date().toISOString(), ...before, checks, errors, expectedAnonymousSessionProbes,
    nativeReceipts: [0,6,10], financialSpendCents: 500, usageCalls: 0,
    note: "Actual Chromium + local HTTP source and sandbox payment. Mechanism/UI evidence, not human comprehension or comparative time gain." }, null, 2));
  console.log(JSON.stringify({ folder, checks: checks.length, errors: errors.length, ...before }));
} catch (error) {
  await writeFile(`${folder}/failure.json`, JSON.stringify({ ...before, checks, errors, expectedAnonymousSessionProbes, error: error.message }, null, 2));
  throw error;
} finally { await browser.close(); await h.close(); }
