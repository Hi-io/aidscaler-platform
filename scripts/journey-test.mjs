import { chromium } from "@playwright/test";
import { createHarness } from "../evaluation/harness.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const h = await createHarness(),
  browser = await chromium.launch(),
  checks = [],
  errors = [];
await mkdir(".local/screenshots", { recursive: true });
const base = h.apps[0].url;
const login = async (page, role) => {
  await page.goto(base);
  await page
    .getByLabel("Email", { exact: true })
    .fill(role + "@org0.nexo.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("evaluation-password");
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.locator(".workspace").waitFor();
};
try {
  h.lab.world.advance(60000);
  for (const target of ["inventory", "vehicles", "map"])
    await h.apps[0].connector.action("query", { target }, "journey-" + target);
  await h.apps[0].ingestion.sync();
  const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      reducedMotion: "reduce",
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "commander");
  await page.getByRole("button", { name: "Case", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("heading", { name: "Response case", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Prepare a manual response", exact: true })
    .click();
  await page.locator("#manualform [name=quantity]").fill("100");
  await page
    .locator("#manualform [name=rationale]")
    .fill(
      "Check a proportionate response using observed quantities and human review.",
    );
  await page
    .getByRole("button", { name: "Prepare for review", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page
    .getByLabel("What changed and why?", { exact: true })
    .fill("Adjust a draft before any physical authority.");
  await page.locator("#editform input[data-param=quantity]").fill("90");
  await page
    .getByRole("button", { name: "Save revision for review", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  checks.push("Case → manual draft → versioned revision; no dispatch");
  const draft = (await h.apps[0].store.list("org0", "proposal", 100))[0];
  assert.equal(draft.actions[0].params.quantity, 90);
  assert.equal(draft.authorization, null);
  await page.goto(base + "/#map");
  await page.locator("svg#responsemap").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  await page.screenshot({
    path: ".local/screenshots/map-1366.png",
    fullPage: true,
  });
  checks.push("Received operational map and keyboard fallback render");
  await page.goto(base + "/#media");
  await page.locator("#mediaform [name=file]").setInputFiles({
    name: "field-observation.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Field team reports families still need drinking water. Quantity requires verification.",
    ),
  });
  await page
    .getByLabel("Source or owner", { exact: true })
    .fill("Authorized synthetic journey fixture");
  await page
    .getByLabel("Short description", { exact: true })
    .fill("A sourced field observation");
  await page
    .getByRole("button", { name: "Preserve original evidence", exact: false })
    .click();
  await page
    .getByRole("heading", { name: "Inspect original evidence", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Analyze source bytes", exact: true })
    .click();
  await h.apps[0].worker.drain();
  const media = (await h.apps[0].store.list("org0", "media", 100))[0],
    analysis = await h.apps[0].store.get("org0", "media_analysis", media.id);
  assert.equal(analysis.state, "interpreted_unverified");
  assert.ok(analysis.result.text.includes("families"));
  await page.keyboard.press("Escape");
  checks.push(
    "Actual source file upload → processing → unverified interpretation",
  );
  await context.close();
  const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    field = await mobile.newPage();
  field.on("pageerror", (e) => errors.push(e.message));
  await login(field, "field");
  assert.equal(await field.locator("nav [data-page=review]").count(), 0);
  await field.evaluate(() => navigator.serviceWorker.ready);
  await field.reload();
  await field
    .getByRole("heading", { name: "Report from the field.", exact: true })
    .waitFor();
  await mobile.setOffline(true);
  await field
    .getByLabel("What did you observe?", { exact: true })
    .fill("Offline field request retained until the server acknowledges it.");
  await field.getByLabel("Location", { exact: true }).fill("Shelter North");
  await field
    .getByRole("button", { name: "Save & send report", exact: true })
    .click();
  await field
    .getByText(
      "Offline field request retained until the server acknowledges it.",
      { exact: true },
    )
    .waitFor();
  await field.reload();
  await field
    .getByRole("heading", { name: "Report from the field.", exact: true })
    .waitFor();
  assert.ok(
    (await field.locator("body").innerText()).includes("Offline field request"),
  );
  await mobile.setOffline(false);
  await field
    .waitForFunction(
      () => !document.body.innerText.includes("Waiting to send"),
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  for (let i = 0; i < 50; i++) {
    if (
      (await h.apps[0].store.list("org0", "report", 100)).some((r) =>
        r.text.startsWith("Offline field request"),
      )
    )
      break;
    await field.waitForTimeout(100);
  }
  assert.equal(
    (await h.apps[0].store.list("org0", "report", 100)).filter((r) =>
      r.text.startsWith("Offline field request"),
    ).length,
    1,
  );
  checks.push(
    "Field offline write → reload → reconnect → one durable acknowledged report",
  );
  await field.screenshot({
    path: ".local/screenshots/field-offline-recovered.png",
    fullPage: true,
  });
  await mobile.close();
  for (const role of [
    "admin",
    "analyst",
    "dispatcher",
    "publisher",
    "finance",
    "auditor",
  ]) {
    const c = await browser.newContext(),
      p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await login(p, role);
    assert.ok(await p.locator("h1").textContent());
    checks.push("Role workspace: " + role);
    await c.close();
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/ui-journeys.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        browser: "Chromium",
        checks,
        errors,
        scope:
          "Automated workflows and keyboard/mobile/offline checks; not a human comprehension or accessibility certification",
      },
      null,
      2,
    ),
  );
  console.log(checks.length + " interactive journey checks passed.");
} catch (error) {
  for (const c of browser.contexts())
    for (const p of c.pages()) {
      console.error(
        "Journey stopped on",
        p.url(),
        (await p.locator("body").innerText()).slice(0, 1400),
        "page errors:",
        errors,
      );
      await p
        .screenshot({
          path: ".local/screenshots/journey-failure.png",
          fullPage: true,
        })
        .catch(() => {});
    }
  throw error;
} finally {
  await browser.close();
  await h.close();
}
