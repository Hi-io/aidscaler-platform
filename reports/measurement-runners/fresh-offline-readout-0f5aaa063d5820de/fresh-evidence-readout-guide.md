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

The index must be closed to claim a complete cohort. During progress, missing declared paid worlds retain `declared_not_completed` with unknown calls/cost rather than a invented zero. An explicit `not_launched_budget_cap` checkpoint is the only missing-run state with a known zero spend. An attempted missing outcome retains the full fixed episode cap, unknown actual billing/calls, and a blocked comparison.

## Output

- Every declared seed/arm, all settled report bytes and file SHA256, status/errors/invariants/source hashes, and undeclared-file warning. A settled file written before its index checkpoint is discovered in that profile folder, not lost.
- K01 native deficits by service; K02 separate first-useful and sufficient physical-service clocks with right-censored cohorts; K03 deadline windows whose ends are observable. Future/missing windows are separate.
- K08 silent/remote demand, service and censoring; K09 native excess, vehicle km, fuel mL and litres, failures. Unknown staff/vehicle hours are `null`.
- K15 same-seed/same-corpus/same-physical-world/three-hash comparisons to B5, B8, B9 or declared ablation. Incomplete or failed cohorts can retain valid-pair diagnostics, but cannot support a cohort benefit claim. Negative effects remain negative.
- K16 proposal/operation snapshot states, linked repair funnel when emitted. Full historically reviewed→authorized→useful conversion is explicitly unmeasured where missing.
- K22 sealed versioned recovery cohort, retained attention, backlog timeline and received queue waits. Closing a semantic receipt does not independently score semantic quality.
- K23 actual public comprehension remains unmeasured: browser finance controls are mechanism tests, not real-human comprehension.
- K24 source/receipt stage distributions, total/provider wall and missing timing. Concurrent percentiles are never summed, nor are completed-only stage latencies called full uncensored response times.
- K25 known usage charges/subtotals, nullable true total, charged exposure, unknown-cost reserves and missing outcome cap exposure. Infrastructure/wages/unpriced tools are not presumed free.

Seed bootstrap is deterministic, resamples complete independent **worlds**, and reports both the point estimate and all raw seed pairs. With one seed it produces no fabricated confidence interval. A small internal sample remains a descriptive pilot.

## Verified reader behavior

`node --test .local/read-fresh-evidence.test.mjs`: 8/8 offline regression tests passed. Cases cover first-vs-sufficient/censoring/future deadlines, a missing paid outcome, provider failure with unknown cost, mismatched final/engine/native-unit versions, a pre-checkpoint settled file and budget skip, recovery without semantic-quality/public-comprehension claims, negative paired time effects, and refusal to select one favorable duplicate while duplicate input files are not double-billed.

Historical reader validation is deliberately named `.local/readout-reader-validation-legacy-not-fresh.{json,md}`. It is **not** a result for the new candidate and cannot be cited as such. No source commits or paid study launches occur in this task.
