import { createHash } from "node:crypto";
import { check } from "./errors.mjs";
export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(s.length * p) - 1)];
}
const random = (seed, i) =>
  Number.parseInt(
    createHash("sha256").update(`${seed}:${i}`).digest("hex").slice(0, 8),
    16,
  ) /
  2 ** 32;
const key = (r) =>
  `${r.scenario ?? r.manifest?.config?.scenario ?? ""}:${r.seed}`;
function fingerprint(r) {
  const c = { ...r.manifest?.config };
  delete c.policy;
  return JSON.stringify({
    config: c,
    engineBuild: r.engineBuild ?? r.manifest?.engineBuild,
    contentVersion: r.manifest?.contentVersion,
    clock: r.measurementMode ?? r.clockPolicy,
    horizon: r.metrics?.simulatedMs,
    candidate: r.candidateFingerprint,
    evaluator: r.evaluatorFingerprint,
    modelConfig: r.modelConfig,
    planningRounds: r.planningRounds ?? 1,
    responseOrder: r.responseOrder ?? "unspecified",
    policyIntervalMs: r.policyIntervalMs ?? 600000,
    episodeBudgetUsd: r.episodeBudgetUsd,
  });
}
export function pairedBootstrap(
  baseline,
  candidate,
  { field = "uncoveredUnitMs", resource = "water", iterations = 2000 } = {},
) {
  // Replicates are averaged WITHIN a world. A burst of tweets or repeated model
  // calls does not create additional independent experimental units.
  function cluster(rows) {
    const groups = new Map();
    for (const r of rows) {
      check(
        r.metrics,
        "EVALUATION_MISSING",
        "Failed runs must retain outcome metrics, not be silently dropped.",
      );
      const k = key(r),
        old = groups.get(k) ?? [];
      check(
        !old.some((x) => (x.replicate ?? 0) === (r.replicate ?? 0)),
        "EVALUATION_DUPLICATE",
        "Duplicate world/replicate.",
      );
      if (old.length)
        check(
          fingerprint(old[0]) === fingerprint(r),
          "EVALUATION_CONFIG",
          "Replicate configurations differ.",
        );
      old.push(r);
      groups.set(k, old);
    }
    return groups;
  }
  const a = cluster(baseline),
    b = cluster(candidate);
  check(
    a.size === b.size && [...a.keys()].every((k) => b.has(k)),
    "EVALUATION_PAIR",
    "Every baseline world must have a candidate outcome, including failures.",
  );
  if (!a.size) return { pairs: 0, improvement: null, interval95: null };
  const value = (rows) =>
    rows.reduce((n, r) => {
      const x = r.metrics.services?.[resource]?.[field] ?? 0;
      check(
        Number.isFinite(x) && x >= 0,
        "EVALUATION_VALUE",
        "Non-finite or negative outcome.",
      );
      return n + x;
    }, 0) / rows.length;
  const pairs = [...a].map(([k, rows]) => {
    check(
      fingerprint(rows[0]) === fingerprint(b.get(k)[0]),
      "EVALUATION_CONFIG",
      "World, clock, build, horizon and configuration must match.",
    );
    return { key: k, a: value(rows), b: value(b.get(k)) };
  });
  const mean = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length,
    ma = mean(pairs.map((p) => p.a)),
    mb = mean(pairs.map((p) => p.b));
  const draws = Array.from({ length: iterations }, (_, i) => {
    const sample = pairs.map(
      (_, j) =>
        pairs[
          Math.floor(
            random("paired-worlds", i * pairs.length + j) * pairs.length,
          )
        ],
    );
    const sa = mean(sample.map((p) => p.a)),
      sb = mean(sample.map((p) => p.b));
    return { delta: sa - sb, relative: sa ? 1 - sb / sa : null };
  });
  const interval = (values) => {
    const xs = values.filter((x) => x != null).sort((a, b) => a - b);
    return xs.length ? [percentile(xs, 0.025), percentile(xs, 0.975)] : null;
  };
  return {
    pairs: pairs.length,
    unit: "resource units × milliseconds",
    resource,
    field,
    baselineMean: ma,
    candidateMean: mb,
    delta: ma - mb,
    improvement: ma ? 1 - mb / ma : null,
    interval95: interval(draws.map((x) => x.delta)),
    relativeInterval95: interval(draws.map((x) => x.relative)),
    evidenceLevel:
      pairs.length < 30
        ? "exploratory_pilot"
        : "sample_size_requires_preregistered_power_check",
    note: "Positive unmet-demand reduction favors the candidate. This does not establish human UX, field effectiveness or lives saved.",
  };
}
export function gates(metrics) {
  return {
    integrity: metrics.ledgerValid === true,
    noOrphanReservations: metrics.coordination?.orphanReservations === 0,
    modelFailures: metrics.modelUsage?.failed ?? 0,
    pendingReceipts: metrics.physical?.arrivedNotReceived ?? 0,
    safetyNote:
      "An arrived vehicle without receipt is pending aid, not an integrity failure or a successful delivery.",
  };
}
