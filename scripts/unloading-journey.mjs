import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHarness, buildFingerprint, evaluatorFingerprint } from "../evaluation/harness.mjs";
import { simulatorFingerprint } from "../evaluation/simulator-build.mjs";

const fingerprints = async () => ({ candidate: await buildFingerprint(), evaluator: await evaluatorFingerprint(), simulator: await simulatorFingerprint() });
const before = await fingerprints(), h = await createHarness({ scenario: "S14", seed: "ui-unloading-current",
  config: { reviewMs: 1000, loadMs: 1000, unloadMs: 2000, setupMs: 1000, healthReports: false, recurringNeeds: false },
  provider: { complete: async () => { throw Error("A receiver UI journey cannot call a model"); } } }),
  app = h.apps[0], w = h.lab.world, browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" }),
  page = await context.newPage(), checks = [], errors = [], expectedAnonymousSessionProbes = [],
  folder = `reports/unloading-journey/${Date.now()}`;
function watch(target) {
  target.on("pageerror", e => errors.push(e.message));
  target.on("console", m => {
    if (m.type() !== "error") return;
    const url = m.location().url;
    if (/status of 401/.test(m.text()) && url === app.url + "/api/me") expectedAnonymousSessionProbes.push({ path: "/api/me", status: 401 });
    else errors.push({ text: m.text(), url });
  });
}
watch(page);
async function login(target, role) {
  await target.goto(app.url); await target.getByLabel("Email", { exact: true }).fill(`${role}@org0.nexo.local`);
  await target.getByLabel("Password", { exact: true }).fill("evaluation-password");
  await target.getByRole("button", { name: "Enter workspace", exact: true }).click(); await target.locator(".workspace").waitFor();
}
async function operations() {
  await page.goto(app.url + "/#operations"); await page.locator(".unloading-panel").waitFor();
}
async function keyboardPrepare(stage) {
  await operations(); const summary = page.locator(".unloading-panel summary").first(); await summary.focus();
  if (!await summary.evaluate(s => s.parentElement.open)) await summary.press("Enter");
  const check = page.getByRole("button", { name: "Check receiver crew", exact: true }); await check.focus();
  const response = page.waitForResponse(r => r.url().endsWith("/api/unloading/plan") && r.request().method() === "POST");
  await check.press("Enter"); const plan = await (await response).json();
  assert.equal(plan.readyToDraft, true, JSON.stringify(plan));
  assert.equal(plan.stage, stage === "crew trip" ? "transport_crew" : "unload", JSON.stringify(plan));
  const button = page.getByRole("button", { name: `Prepare ${stage} for owner review`, exact: true }); await button.waitFor();
  await page.waitForTimeout(5000);
  assert.equal(await summary.evaluate(s => s.parentElement.open), true);
  await button.waitFor(); checks.push("Checked crew plan and expanded request survive a periodic received-state refresh");
  await button.focus(); await button.press("Enter");
  await page.getByText("Prepared for owner review. No physical receipt has been assumed.", { exact: true }).waitFor();
  const proposals = await app.store.list("org0", "proposal", 2000), p = proposals.find(p => p.unloadingOperation === aid.id && p.state === "awaiting_review");
  assert.ok(p); assert.equal(p.authorization, null); checks.push(`Keyboard prepares ${stage} without owner authority or physical receipt`);
  return p;
}
async function review(p, inspectEvidence = false) {
  await page.goto(app.url + "/#review"); await page.locator(`[data-action="proposal"][data-id="${p.id}"]`).focus();
  await page.locator(`[data-action="proposal"][data-id="${p.id}"]`).press("Enter");
  await page.getByRole("heading", { name: "Review a response", exact: true }).waitFor();
  if (inspectEvidence) {
    await page.locator("dialog summary").filter({ hasText: /evidence references$/ }).focus();
    await page.locator("dialog summary").filter({ hasText: /evidence references$/ }).press("Enter");
    const evidence = page.locator(`dialog [data-action="evidence"][data-id="${p.references[0]}"]`);
    await evidence.focus(); await evidence.press("Enter");
    await page.getByRole("heading", { name: "Evidence record", exact: true }).waitFor();
    assert.match(await page.locator("dialog pre").textContent(), /"received": 0/);
    checks.push("Reviewer opens the authentic original request and sees zero physical receipt");
    await page.keyboard.press("Escape"); await page.locator(`[data-action="proposal"][data-id="${p.id}"]`).click();
  }
  await page.locator("#reviewnote").fill("Receiver owner approves only this sourced finite continuation; arrival is not receipt.");
  await page.getByRole("button", { name: "Authorize response", exact: true }).focus();
  await page.getByRole("button", { name: "Authorize response", exact: true }).press("Enter");
  await page.getByText("Authorization recorded. Execution still requires valid conditions.", { exact: true }).waitFor();
  assert.equal((await app.store.get("org0", "proposal", p.id)).state, "authorized");
  checks.push("Keyboard receiver review records an exact authorization before source execution");
}
async function screenshot(label) {
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 }); await operations();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `${folder}/${label}-${width}.png`, fullPage: true });
    checks.push(`${label} at ${width}px has no horizontal overflow`);
  }
}
let aid;
try {
  await mkdir(folder, { recursive: true });
  for (const target of ["inventory", "vehicles", "roads", "map", "policy"])
    await app.connector.action("query", { target }, "unloading-ui-bootstrap-" + target);
  await app.ingestion.sync({ sources: false });
  aid = await app.connector.action("dispatch", { vehicle: "v-org0-0", resource: "r-org0-water", need: "need-water-main", quantity: 300 }, "unloading-ui-arrived-aid", { human: true });
  assert.equal(h.advanceUntil(() => w.actorView("org0").unloadingRequests.some(r => r.operation === aid.id)), true);
  await app.ingestion.sync({ sources: false });
  const request = (await app.store.list("org0", "unloading_request"))[0];
  for (let attempt = 0; attempt < 3; attempt++) {
    await app.connector.action("verify", { target: "building", id: request.building, method: "clarification" }, "unloading-ui-receiver-site-" + attempt);
    await app.ingestion.sync({ sources: false });
    if ((await app.store.get("org0", "facility", request.building, false))?.sourceVersion === request.targetVersion) break;
  }
  await writeFile(`${folder}/received-prerequisites.json`, JSON.stringify({ request, site: await app.store.get("org0", "facility", request.building, false), inspections: (await app.connector.state()).inspections }, null, 2));
  await login(page, "commander"); await operations();
  assert.match(await page.locator(".unloading-panel").textContent(), /0 \/ 300 received/);
  checks.push("Arrived cargo shows zero received before crew approval and finite work"); await screenshot("arrived");
  const auditorContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), auditor = await auditorContext.newPage(); watch(auditor);
  await login(auditor, "auditor"); await auditor.goto(app.url + "/#operations"); await auditor.locator(".unloading-panel").waitFor();
  const summary = auditor.locator(".unloading-panel summary").first(); await summary.focus(); await summary.press("Enter");
  assert.equal(await auditor.locator(".unloading-plan,.unloading-prepare").count(), 0);
  checks.push("Auditor can inspect pending native quantities but has no crew preparation or authorization controls"); await auditorContext.close();
  const trip = await keyboardPrepare("crew trip"); await review(trip, true);
  assert.equal((await app.worker.execute(trip.id)).complete, false);
  assert.equal(h.advanceUntil(() => w.actorView("org0").operations.some(o => o.resourceType === "staff" && o.state === "completed")), true);
  await app.ingestion.sync({ sources: false }); await app.worker.execute(trip.id);
  assert.equal(w.need("need-water-main").served, 0); checks.push("Actual crew transport finishes while the original aid still has zero useful receipt");
  const job = await keyboardPrepare("unloading work"); assert.equal(job.actions[0].type, "unload"); await review(job);
  assert.equal((await app.worker.execute(job.id)).complete, false); assert.equal(w.need("need-water-main").served, 0);
  assert.equal(h.advanceUntil(() => w.actorView("org0").unloadingRequests.find(r => r.operation === aid.id)?.state === "completed"), true);
  await app.ingestion.sync({ sources: false }); assert.equal((await app.worker.execute(job.id)).complete, true);
  await operations(); assert.match(await page.locator(".unloading-panel").textContent(), /300 \/ 300 received/);
  assert.equal(w.need("need-water-main").served, 300); assert.equal(w.state.operations.filter(o => o.resourceType === "water").length, 1);
  checks.push("Browser receipt shows the original 300 units only after real source work, with no duplicate aid dispatch"); await screenshot("received");
  assert.deepEqual(errors, []); assert.deepEqual(w.invariants(), []);
  assert.equal((await app.store.query("SELECT COUNT(*) AS n FROM usage")).rows[0].n, 0);
  const after = await fingerprints(); assert.deepEqual(after, before, "Concurrent source changes invalidate UI evidence");
  const result = { at: new Date().toISOString(), ...before, folder, checks, errors, expectedAnonymousSessionProbes,
    usageCalls: 0, nativeReceived: 300, status: "passed",
    note: "Actual Chromium keyboard/desktop/mobile and local HTTP source. Scripted laboratory source owners; not human comprehension, model reasoning or comparative time gain." };
  await writeFile(`${folder}/result.json`, JSON.stringify(result, null, 2));
  await writeFile("reports/ui-unloading-journeys.json", JSON.stringify(result, null, 2)); console.log(JSON.stringify({ folder, checks: checks.length, errors: errors.length, ...before }));
} catch (error) {
  await page.screenshot({ path: `${folder}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${folder}/visible-failure.txt`, await page.locator("body").innerText().catch(() => ""));
  const failed = { ...before, folder, checks, errors, expectedAnonymousSessionProbes, status: "failed", error: error.message };
  await writeFile(`${folder}/failure.json`, JSON.stringify(failed, null, 2));
  await writeFile("reports/ui-unloading-journeys.json", JSON.stringify(failed, null, 2)); throw error;
} finally { await browser.close(); await h.close(); }
