import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHarness, buildFingerprint } from "../evaluation/harness.mjs";

const h = await createHarness({ scenario: "S07", seed: "coverage-browser", awaitVerifications: false,
  config: { grid: 3, extentKm: 1, inspectionMs: 60000, observationRate: 1 },
  provider: { complete: async () => { throw Error("No paid inference in coverage UI verification"); } } });
const app = h.apps[0], fingerprint = await buildFingerprint(), browser = await chromium.launch(), checks = [], errors = [];
let currentPage;
try {
  for (const target of ["map", "inventory", "vehicles", "policy"])
    await app.connector.action("query", { target }, "coverage-browser-query-" + target);
  await app.ingestion.sync({ sources: false });
  await mkdir(".local/screenshots", { recursive: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" }), page = await context.newPage(); currentPage = page;
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(app.url); await page.getByLabel("Email", { exact: true }).fill("commander@org0.nexo.local");
    await page.getByLabel("Password", { exact: true }).fill("evaluation-password");
    await page.getByRole("button", { name: "Enter workspace", exact: true }).click();
    const review = page.getByRole("button", { name: "Review coverage", exact: true });
    await review.waitFor(); await review.focus(); await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Check communities we have not heard from", exact: true }).waitFor();
    if (!(await app.coverage.summary()).policy) {
      await page.getByText("Approve contact policy", { exact: true }).click();
      await page.getByLabel("Approval reason", { exact: true }).fill("Review every received directory place without inferring hidden needs");
      await page.getByRole("button", { name: "Approve contact scope and limits", exact: true }).click();
      await page.locator("#coverage-check-form").waitFor();
    }
    const d = await app.coverage.summary(), target = d.rows.find(r => r.state === "unknown").id;
    await page.getByLabel("Exact place", { exact: true }).selectOption(target);
    await page.getByLabel("I authorize this exact check and its channel. A missing response stays unknown.", { exact: true }).check();
    const before = h.lab.world.state.inspections.length;
    const sent = page.waitForResponse(r => new URL(r.url()).pathname === "/api/coverage/check" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Approve one contact check", exact: true }).click();
    assert.equal((await sent).status(), 202);
    await page.locator("#coverage-check-form").waitFor();
    assert.equal(h.lab.world.state.inspections.length, before + 1);
    let row = (await app.store.list("org0", "coverage_request", 100))[0];
    assert.equal(row.checks[0].building, target); assert.equal(row.checks[0].state, "checking");
    assert.equal((await app.coverage.summary()).rows.find(r => r.id === target).lastContactAt, null, "Pending acknowledgement cannot make unknown contact disappear");
    const dimensions = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, width: innerWidth,
      dialog: document.querySelector("dialog").getBoundingClientRect().width }));
    assert.ok(dimensions.body <= dimensions.width + 1); assert.ok(dimensions.dialog <= dimensions.width);
    await page.getByRole("button", { name: "Close dialog", exact: true }).focus(); await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest("dialog"))), true, "Keyboard focus stays within the modal");
    await page.screenshot({ path: `.local/screenshots/coverage-${viewport.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    h.lab.world.advance(h.lab.world.now + 180000); await app.ingestion.sync({ sources: false });
    row = await app.store.get("org0", "coverage_request", row.id); assert.equal(row.state, "completed");
    assert.equal(row.checks[0].state, "contact_confirmed");
    assert.equal(h.lab.world.state.inspections.length, before + 1);
    await page.reload(); await review.waitFor(); await review.click();
    await page.getByRole("heading", { name: "Check communities we have not heard from", exact: true }).waitFor();
    assert.ok(await page.getByText(/contact confirmed/).count());
    checks.push({ width: viewport.width, exactApproval: true, pendingNotCredited: true, deliveredReceiptVisible: true,
      keyboardContained: true, horizontalOverflow: false, physicalInquiryCount: 1 });
    await context.close(); currentPage = null;
  }
  assert.deepEqual(errors, []);
} catch (error) {
  await mkdir(".local/screenshots", { recursive: true });
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: ".local/screenshots/coverage-failure.png", fullPage: true });
  throw error;
} finally {
  await mkdir("reports", { recursive: true });
  await writeFile("reports/ui-coverage-journeys.json", JSON.stringify({ at: new Date().toISOString(),
    candidateFingerprint: fingerprint, candidateChanged: fingerprint !== await buildFingerprint(), checks, errors,
    scope: "Automated local browser and real source-queue mechanism at two viewports; no paid inference or human-comprehension claim" }, null, 2));
  await browser.close(); await h.close();
}
console.log(`${checks.length} coverage browser journeys passed`);
