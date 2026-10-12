import { chromium } from "@playwright/test";
import { createHarness, buildFingerprint } from "../evaluation/harness.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const provider = { complete: async ({ messages }) => {
 const input = JSON.parse(messages.at(-1).content), source = input.sources[0];
 return { model: "recorded-UI-contract", message: { content: JSON.stringify({ observations: [{ kind: "need", text: "Unverified received request for review", sourceIds: [source.id], location: null, resourceType: "water", quantity: null, unit: null, timeStatus: "unknown" }] }) }, usage: { providerCost: 0 } };
} };
const fingerprint = await buildFingerprint(), h = await createHarness({ provider }), app = h.apps[0], browser = await chromium.launch(),
 checks = [], errors = [], context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }), page = await context.newPage();
page.on("pageerror", e => errors.push(e.message));
const close = () => page.getByRole("button", { name: "Close dialog", exact: true }).click();
try {
 h.lab.world.advance(60000); for (const target of ["inventory", "vehicles", "map"]) await app.connector.action("query", { target }, "response-ui-" + target); await app.ingestion.sync();
 await page.goto(app.url); await page.getByLabel("Email", { exact: true }).fill("commander@org0.nexo.local"); await page.getByLabel("Password", { exact: true }).fill("evaluation-password"); await page.getByRole("button", { name: "Enter workspace", exact: true }).click(); await page.locator(".workspace").waitFor();
 await page.goto(app.url + "/#settings"); await page.getByText("Responsibilities, coverage & processing policy", { exact: true }).click(); await page.getByRole("button", { name: "Set response priorities", exact: true }).click();
 await page.locator("#response-policy [name=order]").selectOption("deadline_then_priority"); await page.getByText("Protected need types", { exact: true }).click(); await page.getByLabel("water", { exact: true }).check();
 await page.locator("#response-policy [name=reason]").fill("Explicit coordinator policy for this synthetic UI exercise"); await page.getByRole("button", { name: "Approve this policy version", exact: true }).click(); await page.locator("dialog").waitFor({ state: "detached" });
 const policy = await app.store.get("org0", "response_policy", "active"); assert.equal(policy.approved, true); assert.deepEqual(policy.protectedTypes, ["water"]); checks.push("Coordinator approves priorities and protected types through the UI; native units and delivery authority remain separate");
 await page.goto(app.url + "/#signals"); await page.getByRole("button", { name: "Interpret received batch", exact: true }).click(); await app.worker.drain(); await page.reload();
 assert.equal((await app.store.list("org0", "semantic_receipt", 10)).length, 1); assert.equal((await app.store.list("org0", "proposal", 10)).length, 0); checks.push("Received-source batch is queued through the UI; sourced interpretations do not create operational authority or a proposal");
 await page.goto(app.url + "/#signals"); await page.getByRole("heading", { name: "The world speaks in fragments.", exact: true }).waitFor();
 let startedRead; const startedReading = new Promise(resolve => { startedRead = resolve; });
 await page.route(/\/api\/records\?kind=activity/, async route => { startedRead(); await new Promise(resolve => setTimeout(resolve, 400)); await route.continue(); });
 await page.evaluate(() => { location.hash = "investigations"; }); await startedReading; await page.evaluate(() => { location.hash = "signals"; });
 await page.getByRole("heading", { name: "The world speaks in fragments.", exact: true }).waitFor(); await page.waitForTimeout(600);
 assert.ok(await page.getByRole("heading", { name: "The world speaks in fragments.", exact: true }).isVisible()); await page.unroute(/\/api\/records\?kind=activity/);
 checks.push("A delayed investigation response cannot replace the newly selected sources screen");
 await page.goto(app.url + "/#signals"); await page.getByRole("button", { name: "Inspect source", exact: true }).first().click(); await page.getByRole("button", { name: "Review local erasure", exact: true }).click();
 await page.locator("#source-erasure [name=reason]").fill("Synthetic fixture source retention exercise"); await page.getByLabel("I reviewed the scope and separate external obligations.", { exact: true }).check(); await page.getByRole("button", { name: "Erase reviewed local source", exact: true }).click(); await page.getByRole("heading", { name: "Source content removed", exact: true }).waitFor(); await app.worker.drain();
 assert.equal((await app.store.list("org0", "erasure", 10))[0].state, "local_erasure_completed"); assert.equal((await app.store.get("org0", "automation", "intake")).enabled, false); checks.push("Explicit local erasure review removes linked source content, completes durable cleanup and pauses automatic investigation without deleting physical history");
 await close(); await page.reload(); await page.getByRole("heading", { name: "The world speaks in fragments.", exact: true }).waitFor();
 const remainingSources = (await app.store.list("org0", "signal", 100)).filter(s => s.state !== "erased").length;
 await page.getByText(remainingSources + " collected signals", { exact: true }).waitFor();
 assert.equal(errors.length, 0); await context.close();
 const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }), m = await mobile.newPage();
 await m.goto(app.url); await m.getByLabel("Email", { exact: true }).fill("commander@org0.nexo.local"); await m.getByLabel("Password", { exact: true }).fill("evaluation-password"); await m.getByRole("button", { name: "Enter workspace", exact: true }).click(); await m.locator(".workspace").waitFor();
 await m.goto(app.url + "/#settings"); await m.getByText("Responsibilities, coverage & processing policy", { exact: true }).click(); await m.getByRole("button", { name: "Set response priorities", exact: true }).click();
 await m.locator("dialog").waitFor({ state: "visible" });
 const sizes = await m.evaluate(() => ({ body: document.documentElement.scrollWidth, width: innerWidth, dialog: document.querySelector("dialog").getBoundingClientRect().width })); assert.ok(sizes.body <= sizes.width + 1); assert.ok(sizes.dialog <= sizes.width); checks.push("Response-policy dialog remains usable at 390px with reduced motion and without page overflow");
 await mkdir(".local/screenshots", { recursive: true }); await m.screenshot({ path: ".local/screenshots/response-mobile.png" }); await mobile.close();
} catch (e) { await mkdir(".local/screenshots", { recursive: true }); if (!page.isClosed()) await page.screenshot({ path: ".local/screenshots/response-journey-failure.png", fullPage: true }); throw e; }
finally {
 await mkdir("reports", { recursive: true }); await writeFile("reports/ui-response-journeys.json", JSON.stringify({ at: new Date().toISOString(), candidateFingerprint: fingerprint, candidateChanged: fingerprint !== await buildFingerprint(), checks, errors, scope: "Automated browser mechanism exercise with a recorded semantic provider fixture; not real-model accuracy or human understanding" }, null, 2));
 await browser.close(); await h.close(); console.log(checks.length + " new response and retention UI journeys completed");
}
