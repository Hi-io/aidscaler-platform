import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHarness } from "../evaluation/harness.mjs";
// By default test the current source bytes in a fresh owned harness, not a
// pre-existing presentation server that may run an older candidate version.
const harness = process.env.UI_BASE_URL ? null : await createHarness({
  provider: { complete: async () => { throw Error("No inference is allowed in UI verification"); } },
});
const base = process.env.UI_BASE_URL ?? harness.apps[0].url,
  access = harness ? { password: "evaluation-password" } : JSON.parse(await readFile(".local/access-org0.json", "utf8"));
const browser = await chromium.launch({ headless: true });
await mkdir(".local/screenshots", { recursive: true });
const errors = [],
  results = [];
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
        viewport,
        reducedMotion: "reduce",
      }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page
      .getByLabel("Email", { exact: true })
      .fill("commander@org0.aidscaler.local");
    await page.getByLabel("Password", { exact: true }).fill(access.password);
    await page.getByRole("button", { name: "Enter workspace" }).click();
    await page
      .getByRole("heading", { name: "Response overview", exact: true })
      .waitFor();
    for (const [hash, title] of [
      ["overview", "Response overview"],
      ["map", "Operational map"],
      ["signals", "Signals & evidence"],
      ["investigations", "Agent activity"],
      ["review", "Decision queue"],
      ["operations", "Operations"],
      ["resources", "Resources & facilities"],
      ["network", "Partner network"],
      ["publications", "Public updates"],
      ["finance", "Pooled funds"],
      ["field", "Field workspace"],
      ["coordination", "People & handovers"],
      ["settings", "Sources & access"],
      ["audit", "Decision history"],
      ["media", "Source media"],
      ["connections", "External connections"],
      ["moderation", "Community reports"],
    ]) {
      await page.goto(base + "/#" + hash);
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      assert.equal(await page.locator('[data-agent-monitor]').count(), ["overview", "investigations"].includes(hash) ? 1 : 0,
        `${hash} should display only its relevant work status`);
      const horizontal = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      assert.equal(
        horizontal,
        false,
        `${hash} overflows at ${viewport.width}px`,
      );
      results.push({
        page: hash,
        width: viewport.width,
        loaded: true,
        horizontalOverflow: false,
      });
      if (["overview", "signals", "field"].includes(hash))
        await page.screenshot({
          path: `.local/screenshots/${hash}-${viewport.width}.png`,
          fullPage: true,
        });
    }
    const publicData = await (await fetch(base + '/api/public')).json();
    await page.goto(base + "/public");
    await page.getByRole("heading", { name: publicData.organization.portal.title, exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: `.local/screenshots/public-${viewport.width}.png`,
      fullPage: true,
    });
    results.push({
      page: "public",
      width: viewport.width,
      loaded: true,
      horizontalOverflow: false,
    });
    await page.goto(base + "/community");
    await page
      .getByRole("heading", { name: publicData.organization.portal.communityTitle, exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    results.push({
      page: "community",
      width: viewport.width,
      loaded: true,
      horizontalOverflow: false,
    });
    await context.close();
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/ui-verification.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        browser: "Chromium",
        checks: results,
        errors,
        note: "Automated rendering/navigation at 1440, 1920 and 390 px with reduced motion. Not human comprehension evidence or a full accessibility certification.",
      },
      null,
      2,
    ),
  );
  console.log(
    `${results.length} desktop/mobile workspace checks passed; public views and screenshots captured.`,
  );
} finally {
  await browser.close();
  if (harness) await harness.close();
}
