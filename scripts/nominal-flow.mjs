import {
  createHarness,
  buildFingerprint,
  evaluatorFingerprint,
} from "../evaluation/harness.mjs";
import { percentile } from "../src/evaluation.mjs";
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hash } from "../src/store.mjs";
import os from "node:os";

// A finite transport/UI probe, separate from semantic quality and physical aid.
const run = "nominal-flow-" + Date.now(),
  fingerprint = await buildFingerprint(),
  evaluator = await evaluatorFingerprint(),
  h = await createHarness({
    organizations: 4,
    scenario: "S23",
    config: {
      postsPerHour: 0,
      recurringNeeds: false,
      healthReports: false,
      sourceRequestLimit: 1000000,
    },
  }),
  rows = [],
  commands = [],
  navigation = [],
  interaction = [],
  errors = [],
  started = performance.now();
let browser,
  status = "completed",
  failure = null;
const protocol = {
  organizations: 4,
  needs: 100,
  publications: 1000,
  batches: 20,
  postsPerBatch: 50,
  nominalPostsPerHour: 10000,
  ingestionTopology:
    "Four independent concurrent organization workers; no artificial serial wait between organizations",
  publicationMix: {
    tweet: 0.5,
    videoDescription: 0.2,
    voiceNoteDescription: 0.1,
    news: 0.2,
  },
  clock:
    "HTTP, durable storage, UI and command delays use actual wall time. Source arrivals advance in finite modeled bursts equivalent to 10000/hour. Polling is excluded and recorded separately.",
  scope:
    "Functional transport and UI performance on this host under concurrent development tests. No semantic inference, real-media accuracy, human comprehension or hundred-solution throughput is inferred.",
};
try {
  const w = h.lab.world,
    places = w.state.map.buildings.filter((b) => b.use === "residential");
  for (let i = 0; i < 100; i++) {
    const b = places[i % places.length],
      n = w.addNeed({
        id: "flow-need-" + i,
        building: b.id,
        type: ["water", "food", "blankets"][i % 3],
        unit: ["L", "portions", "blankets"][i % 3],
        quantity: 20 + (i % 10),
        deadline: 7200000,
        priority: 1 + (i % 4),
      });
    for (const app of h.apps) w.observeNeed(app.config.org, n);
  }
  w.advance(60000);
  for (const app of h.apps) await app.ingestion.sync();
  for (let batch = 0; batch < protocol.batches; batch++) {
    const ids = [];
    for (let j = 0; j < 50; j++) {
      const i = batch * 50 + j,
        b = places[i % places.length],
        type =
          j % 10 < 5
            ? "tweet"
            : j % 10 < 7
              ? "video"
              : j % 10 < 8
                ? "audio"
                : "news";
      const p = w.generateSignal("P01", {
        building: b.id,
        causeEvent: run + "-" + i,
        type,
        text: `Current community report ${i} at ${b.id}: access and resource needs require local confirmation.`,
      });
      ids.push(p.public.id);
    }
    w.advance(w.now + 18000);
    // Only evaluator bookkeeping records availability. The candidate uses its
    // ordinary HTTP sources and never receives this manifest of expected IDs.
    const availableAt = Date.now();
    const batchResults = await Promise.allSettled(
      h.apps.map(async (app) => {
        const expected = ids.filter((id) =>
          w.sourceVisible(
            w.state.posts.find((p) => p.public.id === id),
            app.config.org,
          ),
        );
        const t = performance.now();
        await app.ingestion.sync();
        const missing = [],
          delays = [];
        for (const id of expected) {
          const s = await app.store.get(app.config.org, "signal", id, false);
          if (!s) missing.push(id);
          else delays.push(Math.max(0, Date.now() - availableAt));
        }
        return {
          batch,
          org: app.config.org,
          expected: expected.length,
          durable: expected.length - missing.length,
          missing,
          ingestionWallMs: performance.now() - t,
          availableToDurableMs: delays,
        };
      }),
    );
    for (const result of batchResults) {
      if (result.status === "rejected") throw result.reason;
      rows.push(result.value);
    }
    if ((batch + 1) % 5 === 0)
      console.log(
        JSON.stringify({ batches: batch + 1, publications: (batch + 1) * 50 }),
      );
  }
  const app = h.apps[0],
    signal = (await app.store.list("org0", "signal", 1))[0];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    await app.domain.createClaim(
      { org: "org0", id: "flow-analyst", role: "analyst" },
      {
        text: "Unverified performance probe; no operational authority",
        state: "pending",
        references: [signal.id],
      },
      run + "-command-" + i,
    );
    commands.push(performance.now() - t);
  }
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.url);
  await page
    .getByLabel("Email", { exact: true })
    .fill("commander@org0.aidscaler.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("evaluation-password");
  await page
    .getByRole("button", { name: "Enter workspace", exact: true })
    .click();
  await page.locator(".workspace").waitFor();
  const pages = [
    ["signals", "The world speaks in fragments."],
    ["overview", "Response overview"],
    ["resources", "Know what can be committed."],
    ["investigations", "Investigate what could unlock help."],
  ];
  for (let cycle = 0; cycle < 5; cycle++)
    for (const [route, title] of pages) {
      const t = performance.now();
      await page.evaluate((route) => {
        location.hash = route;
      }, route);
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      navigation.push(performance.now() - t);
    }
  await page.goto(app.url + "/#signals");
  const filter = page.getByLabel("Search collected signals", { exact: true });
  await filter.waitFor();
  for (let i = 0; i < 30; i++)
    interaction.push(
      await page.evaluate(
        (value) =>
          new Promise((resolve) => {
            const input = document.querySelector("#signalfilter"),
              t = performance.now();
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now() - t)),
            );
          }),
        i % 2 ? "community" : "",
      ),
    );
} catch (e) {
  status = "failed";
  failure = {
    code: e.code ?? e.name,
    causeCode: e.cause?.code ?? null,
    message: e.message.slice(0, 300),
  };
}
await browser?.close();
const delays = rows.flatMap((r) => r.availableToDurableMs),
  results = {
    sourceAvailableToDurableP95Ms: percentile(delays, 0.95),
    commandDurableP95Ms: percentile(commands, 0.95),
    workspaceNavigationToVisibleP95Ms: percentile(navigation, 0.95),
    filterInputToTwoFramesP95Ms: percentile(interaction, 0.95),
    missingPublications: rows.reduce((s, r) => s + r.missing.length, 0),
    sourceVersionsDurable: rows.reduce((s, r) => s + r.durable, 0),
  };
const report = {
  at: new Date().toISOString(),
  run,
  status,
  failure,
  protocol,
  candidateFingerprint: fingerprint,
  evaluatorFingerprint: evaluator,
  scorerFingerprint: hash(await readFile(new URL(import.meta.url), "utf8")),
  candidateChanged: fingerprint !== (await buildFingerprint()),
  hardware: {
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    node: process.version,
  },
  productionPollMs: h.apps[0].config.pollMs,
  actualWallMs: performance.now() - started,
  modelCalls: 0,
  results,
  targets: {
    sourceAvailableToDurableP95Ms: 5000,
    commandDurableP95Ms: 2000,
    workspaceNavigationToVisibleP95Ms: 2000,
    filterInputToTwoFramesP95Ms: 200,
  },
  targetResults: {
    source:
      results.sourceAvailableToDurableP95Ms == null
        ? null
        : results.sourceAvailableToDurableP95Ms < 5000,
    command:
      results.commandDurableP95Ms == null
        ? null
        : results.commandDurableP95Ms < 2000,
    navigation:
      results.workspaceNavigationToVisibleP95Ms == null
        ? null
        : results.workspaceNavigationToVisibleP95Ms < 2000,
    interaction:
      results.filterInputToTwoFramesP95Ms == null
        ? null
        : results.filterInputToTwoFramesP95Ms < 200,
  },
  rows,
  commandWallMs: commands,
  navigationWallMs: navigation,
  interactionWallMs: interaction,
  errors,
  invariants: h.lab.world.invariants(),
};
await h.close();
await mkdir("reports/flow", { recursive: true });
await writeFile(
  "reports/flow/" + run + ".json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    run,
    status,
    failure,
    results,
    targetsMet: report.targetResults,
    candidateChanged: report.candidateChanged,
    errors,
    violations: report.invariants.length,
  }),
);
if (
  status !== "completed" ||
  report.candidateChanged ||
  results.missingPublications ||
  errors.length ||
  report.invariants.length
)
  process.exitCode = 1;
