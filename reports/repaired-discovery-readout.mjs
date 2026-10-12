import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hash } from "../src/store.mjs";
import { summarizeDiscovery } from "../evaluation/discovery-benchmark.mjs";

const references = ["B5", "B8", "B0", "B9"];
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const minutes = (x) => (finite(x) ? x / 60000 : null);
const min = (xs) => {
  const ys = xs.filter(finite);
  return ys.length ? Math.min(...ys) : null;
};
const max = (xs) => {
  const ys = xs.filter(finite);
  return ys.length ? Math.max(...ys) : null;
};
const gap = (a, b) => (finite(a) && finite(b) ? minutes(b - a) : null);
const counts = (xs, get) =>
  xs.reduce((a, x) => {
    const k = String(get(x));
    a[k] = (a[k] ?? 0) + 1;
    return a;
  }, {});
const mean = (xs) =>
  xs.length && xs.every(finite)
    ? xs.reduce((a, x) => a + x, 0) / xs.length
    : null;
const addKnown = (xs) => xs.filter(finite).reduce((a, x) => a + x, 0);
const nativeCohort = (outcomes) => {
  const groups = {};
  for (const n of outcomes) {
    const key = n.type + ":" + n.unit;
    const g = (groups[key] ??= {
      type: n.type,
      unit: n.unit,
      eligible: 0,
      completed: 0,
      censored: 0,
      demand: 0,
      served: 0,
      pending: 0,
      overprovided: 0,
    });
    g.eligible++;
    g.completed += n.censored === false;
    g.censored += n.censored === true;
    for (const [field, value] of [
      ["demand", n.quantity],
      ["served", n.served],
      [
        "pending",
        finite(n.quantity) && finite(n.served)
          ? Math.max(0, n.quantity - n.served)
          : null,
      ],
      ["overprovided", n.overprovided],
    ]) {
      if (finite(value)) g[field] += value;
      else (g.unknownFields ??= []).push({ need: n.id, field });
    }
  }
  return Object.values(groups);
};
const clock = (value) =>
  value
    ? {
        eligible: value.eligible,
        completed: value.completed ?? value.reached,
        rightCensored: value.rightCensored,
        restrictedMeanMinutes: minutes(value.restrictedMeanMs),
        medianMinutes: minutes(value.medianMs),
        p95Minutes: minutes(value.p95Ms),
      }
    : null;
const cohort = (r) =>
  (r.outcomes ?? [])
    .map((n) => ({
      id: n.id,
      building: n.building,
      type: n.type,
      unit: n.unit,
      quantity: n.quantity,
      deadline: n.deadline,
      silent: n.silent,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

export function buildIntegrity(r) {
  const initial = {
    candidate: r.candidateFingerprint ?? null,
    evaluator: r.evaluatorFingerprint ?? null,
    simulator: r.manifest?.engineBuild ?? null,
  };
  const final = {
    candidate: r.finalCandidateFingerprint ?? null,
    evaluator: r.finalEvaluatorFingerprint ?? null,
    simulator: r.finalEngineBuild ?? null,
  };
  const flags = {
    candidate: r.candidateChanged ?? null,
    evaluator: r.evaluatorChanged ?? null,
    simulator: r.simulatorChanged ?? null,
  };
  const verified = ["candidate", "evaluator", "simulator"].every(
    (k) =>
      typeof initial[k] === "string" &&
      typeof final[k] === "string" &&
      initial[k] === final[k] &&
      flags[k] === false,
  );
  return {
    initial,
    final,
    changedFlags: flags,
    verified,
    note: verified
      ? "All three freshly checked final hashes match their initial loaded builds"
      : "Missing or changed final hash cannot establish unchanged source; raw results and charges are retained",
  };
}

export function causalFunnel(r) {
  const operations =
    r.operationalDiagnostics?.scorerOnlyPhysical?.operations ?? [];
  const departures =
    r.operationalDiagnostics?.scorerOnlyPhysical?.departures ?? [];
  const activities = r.activities ?? [];
  return (r.outcomes ?? []).map((n) => {
    const ops = operations.filter(
      (o) => o.type === "delivery" && o.need === n.id,
    );
    const useful = ops.filter(
      (o) => o.received > 0 && finite(o.times?.service),
    );
    const contributing = useful.filter(
      (o) => finite(n.completedAt) && o.times.service <= n.completedAt,
    );
    const checks = activities.filter(
      (a) =>
        a.stage === "source-directed-confirmation" && a.location === n.building,
    );
    const review = activities.filter(
      (a) =>
        a.stage === "conventional-source-review" &&
        a.observations?.some((o) => o.location === n.building),
    );
    const firstRequest = min(checks.map((a) => a.requestedAt));
    const firstAuthorization = min(ops.map((o) => o.times?.authorized));
    const firstUsefulAuthorization = min(
      useful.map((o) => o.times?.authorized),
    );
    return {
      need: n.id,
      building: n.building,
      type: n.type,
      unit: n.unit,
      quantity: n.quantity,
      served: n.served,
      silent: n.silent,
      censored: n.censored,
      firstSourceReviewProcessedMinute: minutes(
        min(review.map((a) => a.processedAt)),
      ),
      firstVerificationRequestedMinute: minutes(firstRequest),
      verificationReceiptMinute: null,
      verificationReceiptNote:
        "The pending request ACK is not check completion. A received verification-completion timestamp is absent from this report; no stage is imputed.",
      sourceConfirmationRequests: checks.map((a) => ({
        inspection: a.inspection,
        sourceIds: a.references,
        requestedMinute: minutes(a.requestedAt),
        pendingAckMinute: minutes(a.observedAt),
      })),
      firstAnyAuthorizationMinute: minutes(firstAuthorization),
      firstUsefulCargoAuthorizationMinute: minutes(firstUsefulAuthorization),
      lastContributingAuthorizationMinute: minutes(
        max(contributing.map((o) => o.times.authorized)),
      ),
      firstUsefulServiceMinute: minutes(n.firstServiceAt),
      sufficientServiceMinute: minutes(n.completedAt),
      restrictedFirstUsefulMinutes: minutes(n.timeToFirstUsefulServiceMs),
      restrictedSufficientMinutes: minutes(n.timeToSufficientServiceMs),
      requestToFirstAuthorizationMinutes: gap(firstRequest, firstAuthorization),
      requestToAuthorizationScope:
        "Contains received check/communication, planning, owner review and fleet/capacity wait; absent intermediate receipts prevent separate attribution",
      firstUsefulCargoAuthorizationToFirstServiceMinutes: gap(
        firstUsefulAuthorization,
        n.firstServiceAt,
      ),
      deliveries: ops.map((o) => ({
        id: o.id,
        state: o.state,
        owner: o.owner,
        vehicle: o.vehicle,
        resource: o.resource,
        quantity: o.quantity,
        received: o.received,
        times: o.times,
        authorizationToServiceMinutes: gap(
          o.times?.authorized,
          o.times?.service,
        ),
        departures: departures
          .filter((d) => d.operation === o.id)
          .map((d) => ({
            phase: d.phase,
            from: d.from,
            destination: d.destination,
            departedAt: d.departedAt,
            expectedArrivalAt: d.expectedArrivalAt,
            distanceM: d.distanceM,
            routeNodes: d.routeNodes,
            routeEdges: d.routeEdges,
          })),
      })),
    };
  });
}

export function runReadout(r, sourceFile, invalidation = null) {
  const outcomes = r.outcomes ?? [],
    usage = r.usage ?? [];
  const unknownCharges = usage
    .map((u, i) => ({
      index: i,
      model: u.model,
      state: u.state,
      costUsd: u.cost_usd,
      reservedUsd: u.reserved_usd,
      wallMs: u.wall_ms,
      error: u.error,
    }))
    .filter((u) => !finite(u.costUsd));
  const thresholdInconsistencies = outcomes
    .filter(
      (n) =>
        finite(n.quantity) &&
        finite(n.served) &&
        ((n.served >= n.quantity && n.censored === true) ||
          (n.served < n.quantity && n.censored === false)),
    )
    .map((n) => n.id);
  const integrity = buildIntegrity(r);
  return {
    sourceFile,
    arm: r.arm,
    seed: r.seed,
    status: r.status,
    buildIntegrity: integrity,
    invalidation,
    validForComparativeClaims:
      integrity.verified && invalidation?.validForComparativeClaims !== false,
    errors: r.errors ?? [],
    invariants: r.invariants ?? [],
    protocol: r.protocol ?? null,
    modelConfig: r.modelConfig ?? null,
    corpus: r.corpus ?? null,
    counts: {
      eligible: outcomes.length,
      completed: outcomes.filter((n) => n.censored === false).length,
      censored: outcomes.filter((n) => n.censored === true).length,
      unknownCensorStatus: outcomes.filter(
        (n) => typeof n.censored !== "boolean",
      ).length,
      quantityThresholdReached: outcomes.filter(
        (n) =>
          finite(n.quantity) &&
          finite(n.served) &&
          n.quantity > 0 &&
          n.served >= n.quantity,
      ).length,
      thresholdInconsistencies,
    },
    clocks: {
      sufficient: clock(r.timeToSufficientService),
      firstUseful: clock(r.timeToFirstUsefulService),
      note: "RMST/median/p95 retain declared right-censoring at the fixed horizon; served-only values never replace these endpoints",
    },
    nativeCohort: nativeCohort(outcomes),
    nativeWorldServices: r.metrics?.services ?? null,
    silent: {
      eligible: outcomes.filter((n) => n.silent === true).length,
      completed: outcomes.filter(
        (n) => n.silent === true && n.censored === false,
      ).length,
      censored: outcomes.filter((n) => n.silent === true && n.censored === true)
        .length,
      native: nativeCohort(outcomes.filter((n) => n.silent === true)),
      meanRestrictedSufficientMinutes: minutes(
        mean(
          outcomes
            .filter((n) => n.silent === true)
            .map((n) => n.timeToSufficientServiceMs),
        ),
      ),
    },
    costs: {
      providerUsd: r.costUsd ?? null,
      chargedBudgetUsd: r.chargedBudgetUsd ?? null,
      modelCalls: usage.length,
      unknownChargeCount: unknownCharges.length,
      unknownCharges,
      wallMinutes: minutes(r.wallMs),
      providerWallMinutes: minutes(addKnown(usage.map((u) => u.wall_ms))),
      inputTokensKnown: addKnown(usage.map((u) => u.input_tokens)),
      outputTokensKnown: addKnown(usage.map((u) => u.output_tokens)),
      modeledHumanAttentionMinutes: minutes(
        r.sourceCoverage?.modeledHumanAttentionMs,
      ),
    },
    sourceCoverage: r.sourceCoverage ?? null,
    planningTurns: r.operationalDiagnostics?.planningTurns ?? null,
    physicalOperationStates: counts(
      r.operationalDiagnostics?.scorerOnlyPhysical?.operations ?? [],
      (o) => o.state,
    ),
    physicalEventCounts: r.metrics?.eventCounts ?? null,
    funnel: causalFunnel(r),
    scope:
      "This discovery runner preserves its physical-need/trip completion stopping rule and final horizon scoring (K02). It is not the received-source recovery experiment (K22), and source counts are not people physically aided.",
  };
}

export function pairRejection(a, b, { invalidated = false } = {}) {
  if (invalidated) return "campaign_explicitly_invalidated";
  if (!buildIntegrity(a).verified || !buildIntegrity(b).verified)
    return "initial_final_source_integrity_missing_or_changed";
  if (a.seed !== b.seed) return "different_seed";
  for (const [name, get] of [
    ["protocol", (r) => r.protocol],
    ["corpus", (r) => r.corpus],
    ["cohort", cohort],
    ["candidate", (r) => r.candidateFingerprint],
    ["evaluator", (r) => r.evaluatorFingerprint],
    ["simulator", (r) => r.manifest?.engineBuild],
  ])
    if (hash(get(a)) !== hash(get(b))) return "different_" + name;
  if (a.arm === "B9" && hash(a.modelConfig) !== hash(b.modelConfig))
    return "different_general_agent_model_or_cap";
  if (
    !finite(a.timeToSufficientService?.restrictedMeanMs) ||
    !finite(b.timeToSufficientService?.restrictedMeanMs) ||
    !finite(a.timeToFirstUsefulService?.restrictedMeanMs) ||
    !finite(b.timeToFirstUsefulService?.restrictedMeanMs)
  )
    return "missing_censored_response_clock";
  return null;
}

export async function campaignReadout(folder) {
  const files = await readdir(folder),
    readJSON = async (file) =>
      JSON.parse(await readFile(resolve(folder, file), "utf8"));
  let protocol = null,
    invalidation = null,
    summary = null;
  if (files.includes("protocol.json"))
    protocol = await readJSON("protocol.json");
  if (files.includes("invalidation.json"))
    invalidation = await readJSON("invalidation.json");
  if (files.includes("summary.json")) summary = await readJSON("summary.json");
  const raw = [];
  for (const file of files.filter((f) => /-B(?:0|5|6|8|9)\.json$/.test(f))) {
    try {
      const report = await readJSON(file);
      if (report.arm && report.seed && Array.isArray(report.outcomes))
        raw.push({ file, report });
    } catch (error) {
      raw.push({ file, parseError: error.message });
    }
  }
  const rows = raw.filter((x) => x.report);
  const arms = protocol?.arms ?? [...new Set(rows.map((x) => x.report.arm))];
  const observedSeeds = [...new Set(rows.map((x) => x.report.seed))];
  const inferredPrefixes = [
    ...new Set(
      observedSeeds.filter((s) => /-\d{2}$/.test(s)).map((s) => s.slice(0, -2)),
    ),
  ];
  const prefix =
    protocol?.seedPrefix ??
    protocol?.config?.seedPrefix ??
    (inferredPrefixes.length === 1 ? inferredPrefixes[0] : null);
  const declaredSeeds = Number.isSafeInteger(protocol?.seeds)
    ? protocol.seeds
    : null;
  const seedNames = protocol?.seed
    ? [protocol.seed]
    : declaredSeeds && prefix
      ? Array.from(
          { length: declaredSeeds },
          (_, i) => prefix + String(i + 1).padStart(2, "0"),
        )
      : observedSeeds;
  const declared = [];
  for (const seed of seedNames)
    for (const arm of arms) {
      const matches = rows.filter(
        (x) => x.report.seed === seed && x.report.arm === arm,
      );
      declared.push({
        seed,
        arm,
        state: matches.length
          ? matches.length === 1
            ? matches[0].report.status
            : "duplicate"
          : "missing",
        files: matches.map((x) => x.file),
      });
    }
  const declaredRuns = declaredSeeds
    ? declaredSeeds * arms.length
    : protocol?.seed
      ? arms.length
      : (summary?.declaredRuns ?? null);
  const comparisons = [],
    rejectedPairs = [];
  for (const ref of references) {
    const exact = [];
    for (const seed of seedNames) {
      const aa = rows.filter(
          (x) => x.report.arm === ref && x.report.seed === seed,
        ),
        bb = rows.filter(
          (x) => x.report.arm === "B6" && x.report.seed === seed,
        );
      if (!arms.includes(ref) || !arms.includes("B6")) continue;
      let reason =
        aa.length !== 1 || bb.length !== 1
          ? aa.length > 1 || bb.length > 1
            ? "duplicate_run"
            : "missing_run"
          : pairRejection(aa[0].report, bb[0].report, {
              invalidated: invalidation?.validForComparativeClaims === false,
            });
      if (reason) {
        rejectedPairs.push({
          baseline: ref,
          candidate: "B6",
          seed,
          reason,
          baselineFiles: aa.map((x) => x.file),
          candidateFiles: bb.map((x) => x.file),
        });
        continue;
      }
      exact.push({ a: aa[0].report, b: bb[0].report });
    }
    if (exact.length) {
      try {
        const result = summarizeDiscovery(exact.flatMap((p) => [p.a, p.b]));
        comparisons.push(
          ...result.comparisons.map((c) => ({
            ...c,
            exactPairCount: exact.length,
            declaredWorlds: declaredSeeds,
            partial: declaredSeeds != null && exact.length < declaredSeeds,
            note: "Only exact observed pairs are computed. All missing, failed, invalidated and unpaired runs remain separately listed; partial campaigns are not admitted as complete results.",
          })),
        );
      } catch (error) {
        rejectedPairs.push({
          baseline: ref,
          candidate: "B6",
          reason: "summary_rejected",
          message: error.message,
          seeds: exact.map((p) => p.a.seed),
        });
      }
    }
  }
  return {
    folder,
    protocol,
    invalidation,
    existingSummary: summary,
    declaredRuns,
    observedClosedRuns: rows.length,
    missingRuns:
      declaredRuns == null ? null : Math.max(0, declaredRuns - rows.length),
    declaredOutcomes: declared,
    unresolvedMissingRunLabels:
      declaredRuns != null ? Math.max(0, declaredRuns - declared.length) : null,
    statusCounts: counts(rows, (x) => x.report.status),
    parseFailures: raw.filter((x) => x.parseError),
    costs: {
      knownProviderUsd: addKnown(rows.map((x) => x.report.costUsd)),
      knownChargedBudgetUsd: addKnown(
        rows.map((x) => x.report.chargedBudgetUsd),
      ),
      runsMissingProviderCost: rows
        .filter((x) => !finite(x.report.costUsd))
        .map((x) => x.file),
      runsMissingCharge: rows
        .filter((x) => !finite(x.report.chargedBudgetUsd))
        .map((x) => x.file),
      unknownUsageCharges: rows.reduce(
        (sum, x) =>
          sum +
          (x.report.usage ?? []).filter((u) => !finite(u.cost_usd)).length,
        0,
      ),
      note: "Known sums are not substituted for unknown costs; unknown reservations/failures remain individually reported",
    },
    aggregateInvariants: rows.reduce(
      (sum, x) => sum + (x.report.invariants ?? []).length,
      0,
    ),
    aggregateErrors: rows.reduce(
      (sum, x) => sum + (x.report.errors ?? []).length,
      0,
    ),
    runs: rows.map((x) =>
      runReadout(x.report, resolve(folder, x.file), invalidation),
    ),
    comparisons,
    rejectedPairs,
    completenessNote:
      "Partial, missing and failed worlds are retained, without inferred outcomes or favorable retries. Invalidated old measurements remain evidence of failure/cost, never an apparent advantage.",
  };
}

export async function main(argv = process.argv.slice(2)) {
  const folders = argv.filter((s) => !s.startsWith("--"));
  if (!folders.length)
    throw Error(
      "Usage: node reports/repaired-discovery-readout.mjs <campaign-folder> [...] [--out=reports/readout.json]",
    );
  const output = argv.find((s) => s.startsWith("--out="))?.slice(6);
  const campaigns = await Promise.all(folders.map(campaignReadout));
  const readout = {
    at: new Date().toISOString(),
    version: "repaired-discovery-readout-v1",
    scope:
      "Reproducible offline attribution of exact K02 discovery pairs, including B9. No source mutation or provider request.",
    campaigns,
  };
  if (output) await writeFile(output, JSON.stringify(readout, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output: output ?? null,
        campaigns: campaigns.map((c) => ({
          folder: c.folder,
          declaredRuns: c.declaredRuns,
          observedClosedRuns: c.observedClosedRuns,
          missingRuns: c.missingRuns,
          statusCounts: c.statusCounts,
          costs: c.costs,
          invariants: c.aggregateInvariants,
          errors: c.aggregateErrors,
          comparisons: c.comparisons,
          rejectedPairs: c.rejectedPairs,
        })),
      },
      null,
      2,
    ),
  );
  return readout;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
