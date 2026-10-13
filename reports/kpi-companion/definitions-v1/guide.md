# Native human KPI companion

This is a builtins-only offline companion. It loads no harness, starts no world, calls no provider, and changes no controller, simulator, or sealed primary reader. Every input episode is retained, including failed, stopped, changed-build and censored episodes. It does not decide whether a paired comparison is valid.

## Provenance

The author previously read the completed C_manual/B5 seed01 summaries during an authorized denominator audit. The author did not read B6 or further primary results while implementing this helper. This is **post-baseline descriptive instrumentation**, not a completely blinded preregistration. Definitions come from the existing Markdown requirements and native source metrics. No threshold, favorable seed, or success criterion is fitted here. Seal the exact helper and tests before loading a complete campaign. Keep the original sealed reader unchanged.

## What each field means

- **K20** sums `metrics.humanCapacity.stages.{read,decide,relay}.elapsedWorkPersonMs`. Owner reviews already occupy the decide pool, so `operatorReviewMs` is displayed but never added again. Queue waiting is separate. If raw final tasks exist, a second calculation integrates actual started work through `min(cutoff, readyAt)` and reports equality. A relay waiting for delivery is not working. The quotient is attention minutes per physically sufficient positive-demand cohort case; independent semantic correctness remains unknown without labels.
- **K22** reports completed-only turnaround percentiles, terminal outcome percentiles, started queue percentiles, all pending counts/states/ages and the native observation cutoff. A read or decision has no universal source deadline, so `deadlineOverdue` stays unknown. Maximum backlog means the native maximum for each organization, and the overall field is the maximum individual organizational peak, not a simultaneous global peak. Full source-version recovery is a separate fixed-cohort gate, not inferred from task completion.
- **K24** subtracts actual timestamps from each individual operation. Native `metrics.latency` contains cumulative offsets from operation creation and is never used as a sequence of stage durations. Missing stages remain null. The operation-scope sum and interval union are shown separately because concurrent operations overlap. Pickup handling, communication and unloading wait can occur inside these intervals; they are not pure driving times. Nonphysical stages requiring inquiry/model/review linkage remain explicitly unknown.
- **K09** retains the all-vehicle distance/fuel aggregate, including background traffic. It does not infer an ownership split from that aggregate. `summarizeEpisode(record,{vehicleLedger})` can separately calculate the non-background sum only from a complete offline ledger with explicit owner/background classification and cumulative physical quantities. The CLI does not accept an inferred ledger. Native vehicle/person commitment scopes are copied with their definitions; they are not wages. Unit prices and costs allocated to different aid types stay unknown.

Task histories are keyed by owner and task ID and select the highest material version. Equal-version conflicts are reported. Operation duplicate scopes are reported and do not double-count. A completion after the observation cutoff is censored. Missing clocks and missing quality data are not converted to zero or success.

## Commands

Use the declared Node runtime. The test file is outside the production test tree.

```text
node --test .local/human-kpi-companion.test.mjs
node .local/human-kpi-companion.mjs --seal-only --output=reports/kpi-companion/DECLARED-ID
node .local/human-kpi-companion.mjs --input=ARCHIVED-CAMPAIGN-ROWS.json --seal=reports/kpi-companion/DECLARED-ID/seal.json --output=reports/kpi-companion/DECLARED-ID/result.json
```

The offline input is one episode, an array of episodes, or an object containing `rows`. Supply actual full episode artifacts, not an already compressed comparative summary. The result records the exact input SHA-256 and seal SHA-256, with whitelisted episode identity and descriptive metrics only. No raw private payload, source snapshot, token, or observer credential is written into companion output. The initial seal explicitly records that this execution has loaded no raw primary input; it does not erase the earlier baseline-summary exposure.
