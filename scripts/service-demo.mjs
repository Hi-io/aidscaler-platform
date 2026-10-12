import {
  createHarness,
  scriptedReview,
  buildFingerprint,
} from "../evaluation/harness.mjs";
import { evaluate } from "../../disaster-response-simulator/evaluation/metrics.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const started = performance.now(),
  fingerprint = await buildFingerprint(),
  h = await createHarness({
    scenario: "S19",
    seed: "nexo-composition-functional",
    organizations: 4,
  });
const episode = "service-live-" + Date.now();
const autonomous = process.argv.includes("--autonomous");
const fromNeed = process.argv.includes("--from-need");
let activity,
  outcome = { prepared: false, operating: false },
  error;
try {
  h.lab.world.advance(60000);
  for (const app of h.apps) {
    for (const target of ["inventory", "vehicles", "map"])
      await app.connector.action(
        "query",
        { target },
        episode + "-" + app.config.org + "-" + target,
      );
    await app.ingestion.sync();
  }
  const a = h.apps[0],
    org = a.config.org,
    building = (await a.store.get(org, "context", "geography")).map.places.find(
      (b) => b.use === "shelter",
    );
  for (const app of h.apps.slice(1)) {
    const actor = (
      await app.store.query(
        "SELECT id,org,role FROM users WHERE org=$1 AND role='commander'",
        [app.config.org],
      )
    ).rows[0];
    for (const kind of ["resource", "vehicle"])
      for (const r of await app.store.list(app.config.org, kind, 100))
        await app.network.share(
          actor,
          { kind, id: r.id, version: r.version, to: org },
          episode + "-share-" + r.id,
        );
    await app.worker.drain();
  }
  const save = a.investigator.activity.bind(a.investigator);
  let last = "";
  a.investigator.activity = async (id, data) => {
    const step = data.steps.at(-1),
      label = data.state + " " + (step?.tool ?? "") + " " + (step?.state ?? "");
    if (label !== last) {
      console.log(label);
      last = label;
    }
    return save(id, data);
  };
  // An operator selects a visible facility. This proves research and execution
  // for that task; it is NOT evidence of unprompted discovery or field accuracy.
  const shelterNeed = (await a.store.list(org, "need", 2000)).find(
    (n) => n.type === "shelter" && n.quantity > (n.served ?? 0),
  );
  if (fromNeed && !shelterNeed)
    throw Object.assign(
      new Error("No received shelter need is available to select."),
      { code: "NO_OBSERVED_SHELTER_NEED" },
    );
  activity = await a.investigator.run(
    fromNeed
      ? { needId: shelterNeed.id }
      : autonomous
        ? {}
        : { facilityId: building.id },
    episode,
  );
  if (activity.proposalId) {
    outcome.prepared = true;
    const p = await a.store.get(org, "proposal", activity.proposalId);
    outcome.approved = await scriptedReview(a, p);
    if (outcome.approved) await a.worker.execute(p.id);
    await a.worker.drain();
    for (let i = 0; i < 48; i++) {
      h.lab.world.advance(
        Math.min(h.lab.world.config.durationMs, h.lab.world.now + 300000),
      );
      for (const app of h.apps) {
        await app.ingestion.sync({ sources: false });
        for (const row of await app.store.list(
          app.config.org,
          "proposal",
          100,
        )) {
          if (row.originPartner && row.state === "awaiting_review")
            await scriptedReview(app, row);
          const current = await app.store.get(
            app.config.org,
            "proposal",
            row.id,
          );
          if (
            ["authorized", "executing", "awaiting_partner"].includes(
              current.state,
            )
          )
            await app.worker.execute(row.id);
        }
        await app.worker.drain();
      }
      if (
        ["completed", "requires_review"].includes(
          (await a.store.get(org, "proposal", p.id)).state,
        )
      )
        break;
    }
    outcome.finalProposal = await a.store.get(org, "proposal", p.id);
    outcome.operating =
      (await a.connector.state()).known.buildings[building.id]?.state ===
      "operating";
    const occupiedBefore =
      (await a.connector.state()).known.buildings[building.id]?.occupancy ?? 0;
    h.lab.world.advance(
      Math.min(h.lab.world.config.durationMs, h.lab.world.now + 600000),
      { maxEvents: 100000 },
    );
    outcome.occupiedPeople = occupiedBefore;
    outcome.sustainedObservationMs = 600000;
  }
} catch (e) {
  error = { code: e.code ?? e.name, message: e.message.slice(0, 500) };
}
try {
  const usage = [];
  for (const app of h.apps)
    usage.push(
      ...(
        await app.store.query(
          "SELECT episode,model,state,wall_ms,input_tokens,output_tokens,cost_usd,provider_id FROM usage",
        )
      ).rows,
    );
  const result = {
    at: new Date().toISOString(),
    episode,
    scope: `Actual Gemma provider + four independent scoped HTTP instances + scripted owners + modeled physical laboratory; ${fromNeed ? "operator-selected received shelter need, no facility ID or solution supplied" : autonomous ? "unfocused investigator input" : "operator-selected facility"}; not a comparative benchmark or independent discovery validation`,
    candidateFingerprint: fingerprint,
    candidateChanged: fingerprint !== (await buildFingerprint()),
    worldManifest: h.lab.world.manifest,
    activity,
    outcome,
    error,
    usage,
    costUsd: usage.reduce((s, u) => s + Number(u.cost_usd ?? 0), 0),
    wallMs: performance.now() - started,
    metrics: evaluate(h.lab.world),
    invariants: h.lab.world.invariants(),
  };
  await mkdir("reports/runs", { recursive: true });
  await writeFile(
    "reports/runs/" + episode + ".json",
    JSON.stringify(result, null, 2),
  );
  await writeFile(
    "reports/service-demo-latest.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      prepared: outcome.prepared,
      operating: outcome.operating,
      occupiedPeople: outcome.occupiedPeople,
      occupiedPlaceHours: result.metrics.collective.shelterPlaceHours,
      error,
      calls: usage.length,
      costUsd: result.costUsd,
      violations: result.invariants.length,
    }),
  );
  if (
    error ||
    result.candidateChanged ||
    result.invariants.length ||
    !outcome.operating ||
    !(outcome.occupiedPeople > 0)
  )
    process.exitCode = 1;
} finally {
  await h.close();
}
