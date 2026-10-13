# Offline fresh evidence readout

The reader performs **zero model calls** and imports no harness, evaluator or application code. It writes only the explicitly requested JSON/Markdown destination. Source trees remain under HOLD.

Run from `.candidate-development/nexo-platform` after the root provides the new freeze and exact campaign index paths:

```powershell
node .local/read-fresh-evidence.mjs --freeze=reports/FRESH_FREEZE.json --primary=reports/comparisons/NEW-primary/index.json --controls=reports/comparisons/NEW-controls/index.json --info=reports/comparisons/NEW-info/index.json --out=.local/fresh-complete-readout
```

Optional inputs accept repeated arguments:

```powershell
node .local/read-fresh-evidence.mjs --freeze=reports/FRESH_FREEZE.json --primary=reports/comparisons/NEW-primary/index.json --s19=reports/evaluations/NEW --ablations=reports/ablations/repair-gated-NEW --ablations=reports/ablations/inquiry-gated-NEW --recovery=reports/source-recovery/NEW/report.json --out=.local/fresh-complete-readout
```

`--extra=REPORT_OR_FOLDER` adds a separate provided cohort; it never automatically searches for a favorable run. Relative paths inside indices are resolved against their report project, so an explicit main-repo historical path stays historical and is rejected by the fresh freeze if its hashes differ.

The index must have successfully closed every required free/paid phase to claim a complete cohort. Complete raw files do not bypass this gate. During progress, missing declared paid worlds retain `declared_not_completed` with unknown calls/cost rather than an invented zero. Explicit `not_launched_budget_cap` or summary `notAttempted` records justify known zero spend; absence of an outcome does not. An active or attempted missing outcome retains the full fixed episode cap, unknown actual billing/calls, and a blocked comparison. Progress, summary, explicit invalidation and duplicate outcomes are retained; invalidation or duplicates block benefit claims.

K07 `strategy` and K14 `inquiryStrategy` are normalized only against the declared treatment/seed/scenario protocol. Both K14 treatments still identify their actual controller as B6; that shared controller label never merges `active` with `broad_refresh`. No treatment is inferred from a favorable score.

## Output

- Every declared seed/arm, all settled report bytes and file SHA256, status/errors/invariants/source hashes, and undeclared-file warning. A settled file written before its index checkpoint is discovered in that profile folder, not lost.
- K01 native deficits by service; K02 separate first-useful and sufficient physical-service clocks with right-censored cohorts; K03 deadline windows whose ends are observable. Future/missing windows are separate.
- K08 silent/remote demand, service and censoring; K09 native excess, vehicle km, fuel mL and litres, failures. New source instrumentation records vehicle committed/moving/waiting/blocked hours and staff committed/transit/field-work person-hours separately. These overlapping scopes are not summed into productive labor or money. Legacy, missing or unavailable utilization stays `null`, including when an old row contains a misleading zero. Inconsistent hour/integral values are disclosed.
- K15 same-seed/same-corpus/same-physical-world/three-hash comparisons to B5, B8, B9 or declared ablation. Incomplete or failed cohorts can retain valid-pair diagnostics, but cannot support a cohort benefit claim. Negative effects remain negative.
- K16 scorer-only `proposalFunnel` retains all owner-scoped proposals, historical review versions/decisions, authorization, exact issued actions/operations, independent positive physical receipts, intermediate-only completions, partial help, rejection reasons and missing links. A coordinator and its delegated copy retain distinct review scopes but share one unique physical receipt. The reader preserves the full export and checks denominator/link consistency. Missing review history leaves the conversion rate unknown; legacy absent or malformed exports are never replaced by completed-state counts. Scripted review conversion is not human comprehension or independent field effectiveness.
- K22 sealed versioned recovery cohort, retained attention, backlog timeline and received queue waits. Closing a semantic receipt does not independently score semantic quality.
- K23 actual public comprehension remains unmeasured: browser finance controls are mechanism tests, not real-human comprehension.
- K24 source/receipt stage distributions, total/provider wall and missing timing. Concurrent percentiles are never summed, nor are completed-only stage latencies called full uncensored response times.
- K25 known usage charges/subtotals, nullable true total, charged exposure, unknown-cost reserves and missing outcome cap exposure. Infrastructure/wages/unpriced tools are not presumed free.

Seed bootstrap is deterministic, resamples complete independent **worlds**, and reports both the point estimate and all raw seed pairs. With one seed it produces no fabricated confidence interval. A small internal sample remains a descriptive pilot.

## Verified reader behavior

`node --test .local/read-fresh-evidence.test.mjs`: 19/19 offline regression tests passed. Cases cover first-vs-sufficient/censoring/future deadlines, missing paid outcomes, provider failure/unknown costs, mismatched final/engine/native units, pre-checkpoint files and budget skips, recovery without semantic/public-comprehension claims, negative paired effects, duplicate files/outcomes, measured and unavailable K09 scopes, K07/K14 treatment identity, active/exception/unattempted checkpoint distinctions, stream phase closure, explicit invalidation and truncated declared files. K16 cases additionally preserve all owners/history/partial/rejected/intermediate outcomes without duplicate physical credit; incomplete review history and malformed counters/receipt links remain unknown. They prove reader behavior, not candidate performance.

Historical reader validation is deliberately named `.local/readout-reader-validation-legacy-not-fresh.{json,md}`. It is **not** a result for the new candidate and cannot be cited as such. No source commits or paid study launches occur in this task.

## Independent receipt-time guard (2026-10-13 amendment)

A claimed positive K16 service receipt must carry a finite, nonnegative `createdAtSourceClock`, and its finite service time must be no earlier than creation and no later than the exported source horizon. Zero is a valid source-clock epoch. The offline reader checks these boundaries independently of the evaluator's `usefulPhysicalService` flag. A missing, negative or nonfinite creation clock, or an inverted creation/service order, leaves conversion unknown and preserves the malformed JSON export for diagnosis. Nonfinite numbers serialized by JSON are `null`, never measured zero. This hardening changes only the offline report reader and its tests; it changes no actor, controller, evaluator, clock, quota or physical result.

The amended offline suite records 18/18 PASS, including all four creation-clock negatives and the valid epoch-zero receipt. The earlier 17/18 attempt is retained in the task log: its expected fixture still contained JavaScript Infinity after the input JSON necessarily serialized that value as null. The assertion now compares exactly the transmitted JSON evidence.

## Recovered operational errors remain in the comparison

A completed physical episode with unchanged source fingerprints and intact invariants remains comparable when a schema or provider error was recovered by the declared fallback. The error, cost, delay and final outcome remain visible. Dropping that world would select successful calls and bias the comparison. Missing, interrupted, failed, invalidated, changed-source or invariant-breaking worlds still block a cohort claim. The new nineteenth regression checks this distinction. The earlier eighteen-test archives remain immutable.
