import { createHarness, buildFingerprint } from "../evaluation/harness.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
const opts = Object.fromEntries(
    process.argv.slice(2).map((s) => s.replace(/^--/, "").split("=")),
  ),
  counts = (opts.needs ?? "10,100,1000").split(",").map(Number),
  orgs = (opts.orgs ?? "1,4,12").split(",").map(Number),
  rows = [];
if (
  !counts.every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 10000) ||
  !orgs.every((n) => [1, 4, 12].includes(n))
)
  throw Error("Invalid load profile");
const fingerprint = await buildFingerprint(),
  run = Date.now();
await mkdir("reports/load", { recursive: true });
for (const organizations of orgs)
  for (const needs of counts) {
    const start = performance.now(),
      cpuStart = process.cpuUsage(),
      h = await createHarness({
        organizations,
        seed: `load-${needs}`,
        scenario: "S23",
        config: {
          grid: Math.max(7, Math.ceil(Math.sqrt(needs / 3))),
          extentKm: 80,
          sourceRequestLimit: 1000000,
          postsPerHour: 0,
          healthReports: false,
          recurringNeeds: false,
        },
      });
    try {
      // Exogenous benchmark construction belongs to the evaluator only. AidScaler
      // receives operational observations and actual HTTP publication pages.
      const buildings = h.lab.world.state.map.buildings.filter(
        (b) => b.use === "residential",
      );
      for (let i = 0; i < needs; i++) {
        const b = buildings[i % buildings.length],
          n = h.lab.world.addNeed({
            id: "load-need-" + i,
            building: b.id,
            type: ["water", "food", "medicine"][i % 3],
            quantity: 100 + (i % 20),
            unit: ["litres", "portions", "packs"][i % 3],
            deadline: 7200000,
            priority: 1 + (i % 3),
          });
        for (const app of h.apps) h.lab.world.observeNeed(app.config.org, n);
        h.lab.world.generateSignal("P01", {
          building: b.id,
          causeEvent: "load-" + i,
          quantity: n.quantity,
          text: `Community request at ${b.id}: ${n.quantity} ${n.unit} of ${n.type}. Quantity needs field confirmation.`,
        });
        if (i % 5 === 0)
          h.lab.world.generateSignal("P18", {
            building: b.id,
            causeEvent: "load-rumour-" + i,
            false: true,
            text: `Unverified claim: every request at ${b.id} has been fulfilled.`,
          });
      }
      h.lab.world.advance(300000, { maxEvents: 1000000 });
      const pages = [];
      for (const app of h.apps) {
        let expected = 0,
          cursor = 0;
        for (let i = 0; i < 20000; i++) {
          const feed = await app.connector.feed(cursor, 100);
          expected += feed.posts.length;
          if (feed.nextCursor == null) break;
          cursor = feed.nextCursor;
        }
        let passes = 0;
        for (; passes < 20000; passes++) {
          await app.ingestion.sync();
          const stored = Number(
            (
              await app.store.query(
                "SELECT COUNT(*) AS n FROM entities WHERE org=$1 AND kind='signal'",
                [app.config.org],
              )
            ).rows[0].n,
          );
          if (stored >= expected) break;
        }
        const actor = (
          await app.store.query(
            "SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",
            [app.config.org],
          )
        ).rows[0];
        await app.intake.configure(actor, { enabled: true }, "load-enable");
        await app.intake.kick();
        const coverage = Number(
            (
              await app.store.query(
                "SELECT COUNT(*) AS n FROM entities WHERE org=$1 AND kind='signal'",
                [app.config.org],
              )
            ).rows[0].n,
          ),
          pending = (
            await app.store.query(
              "SELECT COUNT(*) AS n FROM jobs WHERE org=$1 AND kind='investigate' AND state='queued'",
              [app.config.org],
            )
          ).rows[0].n;
        const queue = await app.store.decisionPage(app.config.org);
        pages.push({
          org: app.config.org,
          expectedPublicVersions: expected,
          storedSignals: coverage,
          ingestionPasses: passes + 1,
          pendingInvestigations: Number(pending),
          visibleDecisionPageSize: queue.rows.length,
        });
      }
      const cpu = process.cpuUsage(cpuStart),
        result = {
          organizations,
          generatedNeeds: needs,
          generatedRumours: Math.ceil(needs / 5),
          wallMs: performance.now() - start,
          cpuMs: (cpu.user + cpu.system) / 1000,
          rssBytes: process.memoryUsage().rss,
          sourceRequests: h.lab.world.state.sourceRequests ?? null,
          pages,
          invariants: h.lab.world.invariants(),
          modelCalls: 0,
          scope:
            "HTTP ingestion, version storage, bounded automatic intake and SQL paging. Not semantic accuracy, provider concurrency or human throughput.",
        };
      rows.push(result);
      await writeFile(
        `reports/load/${run}-${organizations}org-${needs}needs.json`,
        JSON.stringify(result, null, 2),
      );
      console.log(
        JSON.stringify({
          organizations,
          needs,
          wallSeconds: Math.round(result.wallMs / 1000),
          coverage: pages.map((p) => [
            p.storedSignals,
            p.expectedPublicVersions,
          ]),
          rssMB: Math.round(result.rssBytes / 1048576),
          violations: result.invariants.length,
        }),
      );
    } finally {
      await h.close();
    }
  }
const report = {
  at: new Date().toISOString(),
  candidateFingerprint: fingerprint,
  candidateChanged: fingerprint !== (await buildFingerprint()),
  hardware: {
    platform: process.platform,
    node: process.version,
    cpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  profiles: rows,
  semanticThroughputNotMeasured: true,
};
await writeFile("reports/load-latest.json", JSON.stringify(report, null, 2));
