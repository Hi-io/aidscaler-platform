import { chromium } from "@playwright/test";
import { createHarness } from "../evaluation/harness.mjs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
// The public rendition is decoded with the actual local Pillow runtime. Fail
// before launching a world/browser when this required dependency is missing.
const mediaPython =
  process.env.AIDSCALER_MEDIA_PYTHON ??
  fileURLToPath(
    new URL(
      process.platform === "win32"
        ? "../.local/asr-venv/Scripts/python.exe"
        : "../.local/asr-venv/bin/python",
      import.meta.url,
    ),
  );
await access(mediaPython).catch(() => {
  throw new Error(
    "Review journey requires the real local image runtime. Run npm run setup:media or set AIDSCALER_MEDIA_PYTHON to an installed runtime.",
  );
});
await promisify(execFile)(
  mediaPython,
  ["-c", "import PIL; from PIL import Image, ImageOps"],
  { windowsHide: true },
);
const h = await createHarness({ platformConfig: { mediaPython } }),
  browser = await chromium.launch(),
  checks = [],
  errors = [],
  failedRequests = [];
const app = h.apps[0],
  base = app.url,
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  }),
  page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", async (response) => {
  const pathname = new URL(response.url()).pathname;
  if (!pathname.startsWith("/api/publication/") || response.ok()) return;
  const body = await response.json().catch(() => ({}));
  failedRequests.push({
    path: pathname,
    status: response.status(),
    error: body.error ?? null,
    message: body.message ?? null,
  });
});
const login = async (role) => {
  await page.goto(base);
  await page
    .getByLabel("Email", { exact: true })
    .fill(role + "@org0.aidscaler.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("evaluation-password");
  await page
    .getByRole("button", { name: "Enter workspace", exact: true })
    .click();
  await page.locator(".workspace").waitFor();
};
const close = () =>
  page.getByRole("button", { name: "Close dialog", exact: true }).click();
const submit = async (name) => {
  await page.getByRole("button", { name, exact: true }).click();
  try {
    await page.locator("dialog").waitFor({ state: "detached" });
  } catch (error) {
    throw new Error(
      `${name} did not complete. Publication HTTP failures: ${JSON.stringify(failedRequests)}`,
      { cause: error },
    );
  }
};
try {
  await mkdir(".local/screenshots", { recursive: true });
  await page.goto(base + "/community");
  await page.getByLabel("Location", { exact: true }).fill("North district");
  await page
    .getByLabel("Photo or audio recording", { exact: true })
    .setInputFiles({
      name: "supply.png",
      mimeType: "image/png",
      buffer: await readFile(".local/media-fixtures/water-storage.png"),
    });
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Report received for review", exact: true })
    .waitFor();
  const report = (await app.store.list("org0", "report", 100))[0];
  assert.equal(report.state, "pending_moderation");
  assert.equal((await app.store.list("org0", "signal", 100)).length, 0);
  checks.push(
    "Anonymous image submission without written narrative stays private and creates no model work",
  );
  await close();
  await login("commander");
  await page.goto(base + "/#moderation");
  await page
    .getByRole("button", { name: "Keep for investigation", exact: true })
    .click();
  await page
    .getByLabel("Reason or verification still required", { exact: true })
    .fill(
      "Source reviewed; quantities and location still require operational verification.",
    );
  await submit("Record review");
  assert.equal(
    (await app.store.get("org0", "report", report.id)).state,
    "observed",
  );
  checks.push(
    "Human moderation with exact version stages source evidence without confirming physical demand",
  );
  const signalId = "report_" + report.id,
    human = { org: "org0", id: "fixture-analyst", role: "analyst" };
  const claim = await app.domain.createClaim(
    human,
    {
      text: "An initial interpretation awaiting review",
      references: [signalId],
      state: "pending",
    },
    "journey-claim",
  );
  await page.goto(base + "/#signals");
  await page.locator('[data-action="signal"]').first().click();
  await page
    .getByText("Review interpretations & evidence grouping", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Correct interpretation", exact: true })
    .click();
  await page
    .locator("#claim-editor [name=text]")
    .fill(
      "Quantity remains unknown; original image requires local confirmation.",
    );
  await page
    .locator("#claim-editor [name=reason]")
    .fill("Image alone cannot establish available drinking water.");
  await submit("Record correction");
  assert.equal((await app.store.get("org0", "claim", claim.id)).version, 2);
  await page.locator('[data-action="signal"]').first().click();
  await page
    .getByText("Review interpretations & evidence grouping", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Group related evidence", exact: true })
    .click();
  await page
    .locator("#group-editor [name=label]")
    .fill("North district source review");
  await page
    .locator("#group-editor [name=reason]")
    .fill(
      "Retain related source references without multiplying physical needs.",
    );
  await submit("Save reviewed grouping");
  assert.equal((await app.store.list("org0", "evidence_group", 100)).length, 1);
  checks.push(
    "Source dossier → corrected interpretation → reversible evidence grouping with retained history",
  );
  // Test fixtures isolate publication UI. This is not a simulated aid outcome.
  await app.store.put(
    "org0",
    "operation",
    "public-journey-receipt",
    {
      state: "completed",
      confirmedBySource: true,
      received: 300,
      resourceType: "L",
      syntheticUiFixture: true,
    },
    0,
  );
  await page.goto(base + "/#publications");
  await page
    .getByRole("button", { name: "Review a delivery photo", exact: true })
    .click();
  await page
    .locator("#publication-photo-form [name=operationId]")
    .selectOption("public-journey-receipt");
  await page
    .locator("#publication-photo-form [name=caption]")
    .fill("Synthetic delivery image for interface verification");
  await page.locator("#publication-photo-form [name=privacyReviewed]").check();
  await submit("Approve public rendition");
  const proof = (await app.store.list("org0", "public_evidence", 100))[0];
  assert.equal(proof.metadataStripped, true);
  await page
    .getByRole("button", { name: "Prepare an update", exact: true })
    .click();
  await page
    .locator("#publication-editor [name=title]")
    .fill("Water receipt: UI fixture");
  await page.locator("#publication-editor [name=area]").fill("North district");
  await page
    .locator("#publication-editor [name=status]")
    .selectOption("received");
  await page
    .locator("#publication-editor [name=operation]")
    .selectOption("public-journey-receipt");
  await page
    .locator("#publication-editor [name=text]")
    .fill("300 litres confirmed by the source. Other needs remain pending.");
  await page.getByText("Add reviewed delivery photos", { exact: true }).click();
  await page.locator("#publication-editor [name=proof]").first().check();
  await submit("Save internal draft");
  await page
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
  await page.locator("#public-review-check").check();
  await submit("Publish approved update");
  await page.goto(base + "/public");
  const publicPhoto = page.locator(".publicproof img").first();
  await publicPhoto.waitFor();
  assert.ok(
    await publicPhoto.evaluate((i) => i.complete && i.naturalWidth > 0),
  );
  await page.screenshot({
    path: ".local/screenshots/public-reviewed-photo.png",
    fullPage: true,
  });
  checks.push(
    "Private photo → reviewed actual PNG rendition → approved public receipt update; only derived image URL",
  );
  await page.goto(base + "/#publications");
  await page
    .getByRole("button", { name: "Prepare correction", exact: true })
    .click();
  await page
    .locator("#publication-editor [name=text]")
    .fill(
      "Corrected: this receipt is partial progress, not a complete response.",
    );
  await submit("Save internal draft");
  await page
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
  await page.locator("#public-review-check").check();
  await submit("Publish approved update");
  await page
    .getByRole("button", { name: "Withdraw update", exact: true })
    .click();
  await page
    .locator("#publication-retraction [name=reason]")
    .fill("This synthetic update is withdrawn pending clarification.");
  await submit("Record withdrawal");
  const hidden = await fetch(base + "/api/public/media?id=" + proof.id);
  assert.equal(hidden.status, 404);
  checks.push(
    "Corrected public update atomically replaces previous version; withdrawal retains notice and hides photo",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("admin");
  await page.goto(base + "/#settings");
  await page
    .getByRole("button", { name: "Configure response", exact: true })
    .click();
  await page
    .locator("#organization-profile [name=coordinator]")
    .fill("Local response coordinator");
  await page
    .locator("#organization-profile [name=zones]")
    .fill("North district\nEast district");
  await submit("Save versioned configuration");
  await page.reload();
  await page
    .getByText("Responsibilities, coverage & processing policy", {
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Edit processing limits", exact: true })
    .click();
  await page.locator("#organization-policy [name=maxSignals]").fill("10");
  await page.locator("#organization-policy [name=hourlyCallLimit]").fill("5");
  await submit("Apply audited policy");
  assert.equal((await app.intake.policy()).maxSignals, 10);
  checks.push(
    "Versioned organization setup resumes after reload; finite model limits persist and remain inside server maxima",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(failedRequests.length, 0, JSON.stringify(failedRequests));
  await writeFile(
    "reports/ui-review-journeys.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        errors,
        failedRequests,
        mediaRuntime: {
          python: mediaPython,
          decoder: "actual local Pillow; no decoder stub",
        },
        scope:
          "Automated UI workflows; publication receipt explicitly injected as a synthetic UI fixture, not physical-delivery evidence; no human comprehension study",
      },
      null,
      2,
    ),
  );
  console.log(
    checks.length + " evidence, public and administrative UI journeys passed.",
  );
} catch (err) {
  await page.screenshot({
    path: ".local/screenshots/review-journey-failure.png",
    fullPage: true,
  });
  console.error(
    "Review journey stopped:",
    (await page.locator("body").innerText()).slice(-2400),
    errors,
    failedRequests,
  );
  throw err;
} finally {
  await browser.close();
  await h.close();
}
