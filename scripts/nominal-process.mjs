// Same finite transport probe as nominal-flow, with the actual four-process
// laboratory topology and durable private file databases. No inference occurs.
import { createLabServers } from "../../disaster-response-simulator/sources/server.mjs";
import {
  PILOT_CONFIG,
  buildFingerprint,
  evaluatorFingerprint,
} from "../evaluation/harness.mjs";
import { percentile } from "../src/evaluation.mjs";
import { hash } from "../src/store.mjs";
import { fork } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { chromium } from "@playwright/test";

const run = "nominal-process-" + Date.now(),
  candidate = await buildFingerprint(),
  evaluator = await evaluatorFingerprint(),
  privateDir = path.resolve(".local", run),
  workers = [],
  publications = [],
  rows = [],
  navigation = [],
  interaction = [],
  errors = [],
  started = performance.now();
const lab = await createLabServers({
  observerPort: 0,
  sourcePort: 0,
  persistCredentials: false,
  config: {
    ...PILOT_CONFIG,
    organizations: 4,
    scenario: "S23",
    seed: "pilot-2026-01",
    recurringNeeds: false,
    healthReports: false,
    sourceRequestLimit: 1000000,
  },
});
let browser,
  commands = [],
  status = "completed",
  failure = null;
async function startWorker(org) {
  const cwd = path.join(privateDir, org);
  await mkdir(cwd, { recursive: true });
  const child = fork(
    fileURLToPath(new URL("./nominal-process-worker.mjs", import.meta.url)),
    [],
    {
      cwd,
      execArgv: [],
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        NEXO_LOCAL_DIR: path.join(cwd, ".local"),
        DATA_DIR: path.join(cwd, "pgdata"),
        EVIDENCE_DIR: path.join(cwd, "evidence"),
      },
    },
  );
  let next = 0;
  const pending = new Map();
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  child.on("message", (message) => {
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    clearTimeout(p.timer);
    if (message.error)
      p.reject(
        Object.assign(Error(message.error.message), {
          code: message.error.code,
        }),
      );
    else p.resolve(message.result);
  });
  const rejectPending = () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Owned benchmark worker stopped before replying."));
    }
    pending.clear();
  };
  child.on("error", rejectPending);
  child.on("exit", rejectPending);
  const call = (type, data = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Private benchmark command timed out."));
      }, 180000);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, type, data });
    });
  const worker = { org, child, call, measured: new Set() };
  workers.push(worker);
  const sourceAgentKey = Object.entries(lab.actorKeys).find(
    ([, actor]) => actor.org === org,
  )[0];
  Object.assign(
    worker,
    await call("init", {
      org,
      sourceAgentKey,
      sourceUrl: "http://127.0.0.1:" + lab.sourcePort,
    }),
  );
  return worker;
}
async function measureAvailable(batch) {
  const availableAt = Date.now();
  const batchResults = await Promise.allSettled(
    workers.map(async (worker) => {
      const ids = publications
        .filter(
          (post) =>
            lab.world.sourceVisible(post, worker.org) &&
            !worker.measured.has(post.public.id),
        )
        .map((post) => post.public.id);
      const result = await worker.call("ingest", { batch, availableAt, ids });
      for (const id of ids) worker.measured.add(id);
      return result;
    }),
  );
  for (const result of batchResults) {
    if (result.status === "rejected") throw result.reason;
    rows.push(result.value);
  }
}
try {
  // Startup is outside per-source latency; every app serves its ordinary HTTP UI.
  await Promise.all(
    Array.from({ length: 4 }, (_, i) => startWorker("org" + i)),
  );
  const w = lab.world,
    places = w.state.map.buildings.filter((b) => b.use === "residential");
  for (let i = 0; i < 100; i++) {
    const need = w.addNeed({
      id: "flow-need-" + i,
      building: places[i % places.length].id,
      type: ["water", "food", "blankets"][i % 3],
      unit: ["L", "portions", "blankets"][i % 3],
      quantity: 20 + (i % 10),
      deadline: 7200000,
      priority: 1 + (i % 4),
    });
    for (const worker of workers) w.observeNeed(worker.org, need);
  }
  w.advance(60000);
  await Promise.all(
    workers.map((worker) =>
      worker.call("ingest", { ids: [], availableAt: Date.now(), batch: -1 }),
    ),
  );
  for (let batch = 0; batch < 20; batch++) {
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
      publications.push(
        w.generateSignal("P01", {
          building: b.id,
          causeEvent: run + "-" + i,
          type,
          text: `Current community report ${i} at ${b.id}: access and resource needs require local confirmation.`,
        }),
      );
    }
    w.advance(w.now + 18000);
    await measureAvailable(batch);
    if ((batch + 1) % 5 === 0)
      console.log(
        JSON.stringify({
          run,
          batches: batch + 1,
          publications: (batch + 1) * 50,
        }),
      );
  }
  // Video upload and other simulated transport delays must not silently escape
  // the scorer because their source becomes available in a later arrival burst.
  for (
    let drain = 0;
    drain < 10 &&
    workers.some((worker) => worker.measured.size < publications.length);
    drain++
  ) {
    w.advance(w.now + 60000);
    await measureAvailable("drain-" + drain);
  }
  if (workers.some((worker) => worker.measured.size !== 1000))
    throw Error(
      "Not all planned public sources became observable and measured.",
    );
  const worker = workers.find((item) => item.org === "org0");
  commands = await worker.call("commands", { run });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(worker.url);
  await page
    .getByLabel("Email", { exact: true })
    .fill("commander@org0.nexo.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("evaluation-password");
  await page
    .getByRole("button", { name: "Enter workspace", exact: true })
    .click();
  await page.locator(".workspace").waitFor();
  const pages = [
    ["signals", "The world speaks in fragments."],
    ["overview", "A clearer picture. A faster response."],
    ["resources", "Know what can be committed."],
    ["investigations", "Investigate what could unlock help."],
  ];
  for (let cycle = 0; cycle < 5; cycle++)
    for (const [route, title] of pages) {
      const began = performance.now();
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
      navigation.push(performance.now() - began);
    }
  await page.goto(worker.url + "/#signals");
  await page.getByLabel("Search collected signals", { exact: true }).waitFor();
  for (let i = 0; i < 30; i++)
    interaction.push(
      await page.evaluate(
        (value) =>
          new Promise((resolve) => {
            const input = document.querySelector("#signalfilter"),
              began = performance.now();
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now() - began)),
            );
          }),
        i % 2 ? "community" : "",
      ),
    );
} catch (e) {
  status = "failed";
  failure = { code: e.code ?? e.name, message: e.message.slice(0, 300) };
} finally {
  await browser?.close();
  await Promise.allSettled(
    workers.map(async (worker) => {
      try {
        if (worker.child.connected) await worker.call("close");
      } finally {
        if (worker.child.exitCode === null && worker.child.connected)
          worker.child.kill();
      }
    }),
  );
}
const results = {
  sourceAvailableToDurableP95Ms: percentile(
    rows.flatMap((row) => row.availableToDurableMs),
    0.95,
  ),
  commandDurableP95Ms: percentile(commands, 0.95),
  workspaceNavigationToVisibleP95Ms: percentile(navigation, 0.95),
  filterInputToTwoFramesP95Ms: percentile(interaction, 0.95),
  missingPublications: rows.reduce((sum, row) => sum + row.missing.length, 0),
  sourceVersionsDurable: rows.reduce((sum, row) => sum + row.durable, 0),
  unmeasuredPublicationPairs:
    4000 - rows.reduce((sum, row) => sum + row.expected, 0),
};
const targets = {
  sourceAvailableToDurableP95Ms: 5000,
  commandDurableP95Ms: 2000,
  workspaceNavigationToVisibleP95Ms: 2000,
  filterInputToTwoFramesP95Ms: 200,
};
const report = {
  at: new Date().toISOString(),
  run,
  status,
  failure,
  protocol: {
    organizations: 4,
    needs: 100,
    publications: 1000,
    batches: 20,
    postsPerBatch: 50,
    nominalPostsPerHour: 10000,
    expectedPublicationOrganizationPairs: 4000,
    latePublicationPolicy:
      "All generated public IDs are monitored across subsequent arrivals; a finite final drain covers delayed upload availability. The source availability boundary is timed after each evaluator-only world advance. No expected-ID manifest is sent to candidate HTTP ingestion.",
    ingestionTopology:
      "Four independent OS processes with four durable private PGlite file databases; ordinary HTTP sources and UI, same candidate source as nominal-flow.",
    publicationMix: {
      tweet: 0.5,
      videoDescription: 0.2,
      voiceNoteDescription: 0.1,
      news: 0.2,
    },
    clock:
      "Actual wall time for HTTP, commit and UI. Source arrival modeled in bursts equivalent to 10000/hour. Production polling excluded and reported separately.",
    scope:
      "Transport-only benchmark; no semantic accuracy, autonomous decision throughput, human comprehension or field impact is inferred. Both process topologies remain reported.",
  },
  candidateFingerprint: candidate,
  evaluatorFingerprint: evaluator,
  scorerFingerprint: hash(
    await Promise.all(
      ["nominal-process.mjs", "nominal-process-worker.mjs"].map(
        async (file) => [
          file,
          await readFile(new URL(file, import.meta.url), "utf8"),
        ],
      ),
    ),
  ),
  candidateChanged: candidate !== (await buildFingerprint()),
  hardware: {
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    node: process.version,
  },
  productionPollMs: workers[0]?.pollMs ?? null,
  actualWallMs: performance.now() - started,
  modelCalls: 0,
  results,
  targets,
  targetResults: Object.fromEntries(
    Object.entries(targets).map(([key, target]) => [
      key,
      results[key] == null ? null : results[key] < target,
    ]),
  ),
  rows,
  commandWallMs: commands,
  navigationWallMs: navigation,
  interactionWallMs: interaction,
  errors,
  invariants: lab.world.invariants(),
};
await lab.close();
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
  results.unmeasuredPublicationPairs ||
  errors.length ||
  report.invariants.length
)
  process.exitCode = 1;
