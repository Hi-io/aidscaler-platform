# K11/K13: existing internal scoring, not new annotation

Prepared before this study's outcomes; no worlds/providers or result selection. The child `scripts/semantic-load.mjs` already scores eight authored current requests against evaluator-only exact tuples after extraction. There is no reason to run a second extraction or add a model judge.

The fixed selected set is 24 originals: eight current requests, eight explicit historical video captions and eight hostile instruction posts. Two public-lineage copies of each request are persisted but excluded by declared public-original selection. This is not arbitrary feed triage. The eight cases cycle en/es/fr/ja, five resource types and native stated units; it is not a complete type-by-language matrix. Captions/text are evaluated here, not actual media bytes. The controller receives ordinary actor-scoped map/policy data and original public content, never evaluator labels.

The child exports observer-scored request recall, accepted nonhistorical exact-tuple fraction and a conservative fraction including rejected need observations. `precision` is this internal tuple fraction, not verified truth precision. Unknown-time needs stay in the nonhistorical denominator; they must not be described as confirmed false positives. Omissions, rejected observations, failed batches, false-merge candidates and usage remain visible. A zero-need denominator is null, never 100%.

The child stores complete semantic receipts internally, but its final report exports accepted observations/rejections rather than the complete `semantic_receipt.sources` and all eight gold tuples. Gold appears only in omissions. Consequently a downstream reader cannot independently reconstruct the complete 24 public ID/version roster, exact source-version linkage or per-language true positives. Product reference/schema checks can be described as the guarded execution path; they are not an independent post-hoc provenance audit of all originals. Source truth and confidence calibration remain unknown. K12 independently annotated accuracy remains external.

The child probes whether a need row has semantic-processor origin and records source invariants. Neither absence of that flag nor rejected hostile text proves exhaustive prompt-injection resistance, absence of unauthorized commands, or credential safety. Separate existing security/authority regressions are required for those claims.

The ignored reader `.local/semantic-internal-readout.mjs` only presents existing fields and checks arithmetic/count/profile/source-integrity consistency. It does not replace child scoring, add annotations, fit thresholds or reconstruct missing gold. It preserves incomplete results, first/recovered schema failures and missing charges; legacy null-to-zero cost fields never become invoices. No new safety, physical-service or independent multilingual efficacy claim is created.

After root read-only GO, invoke with exact child raw and wrapper summary (both preserved):

```powershell
node .local/semantic-internal-readout.mjs --raw=<raw-semantic.json> --wrapper=<summary.json> --seal=<prepared-seal.json> --output=<reports/analysis/unique-stem> --run=ROOT_GO_READ_K11_K13_INTERNAL
```

Outputs use exclusive file creation and include both raw SHA values. The reader/plan bytes are sealed before outcomes. No child source, model prompt, simulation physics or scorer definition is amended.
