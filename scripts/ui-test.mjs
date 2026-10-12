import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.env.UI_BASE_URL ?? "http://127.0.0.1:4400",
  access = JSON.parse(await readFile(".local/access-org0.json", "utf8"));
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
      .fill("commander@org0.nexo.local");
    await page.getByLabel("Password", { exact: true }).fill(access.password);
    await page.getByRole("button", { name: "Enter workspace" }).click();
    await page
      .getByRole("heading", { name: "A clearer picture. A faster response." })
      .waitFor();
    for (const [hash, title] of [
      ["overview", "A clearer picture. A faster response."],
      ["map", "A map of what your team knows."],
      ["signals", "The world speaks in fragments."],
      ["investigations", "Investigate what could unlock help."],
      ["review", "The decision belongs to you."],
      ["operations", "From an order to useful help."],
      ["resources", "Know what can be committed."],
      ["network", "Independent teams. A connected response."],
      ["publications", "Transparency that earns trust."],
      ["finance", "Shared support. Clear accounting."],
      ["field", "Report from the field."],
      ["coordination", "Keep a responsible person on every pending action."],
      ["settings", "Sources, permissions & continuity."],
      ["audit", "Every decision has an owner."],
      ["media", "Evidence you can inspect."],
      ["connections", "Connect the sources your team trusts."],
      ["moderation", "Community reports need context."],
    ]) {
      await page.goto(base + "/#" + hash);
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
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
    await page.goto(base + "/public");
    await page.getByRole("heading", { name: /Know what's needed/ }).waitFor();
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
      .getByRole("heading", { name: "Make a need visible.", exact: true })
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
}
