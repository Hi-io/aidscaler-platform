# NEXO · Disaster-response operations platform

Local operations software for NGOs, emergency teams and public response organizations. Public signals and scoped operational systems feed a model-assisted investigation. Humans authorize consequential actions; transactional and physical validators remain outside the model.

The current model adapter uses **Gemma 4 31B through OpenRouter**, not Gemini. A model's performance is not transferable by assumption. Google Cloud deployment is deliberately excluded from this implementation phase.

## Run locally

Requires Node.js 24+ and pnpm. Clone this private repository and the private `disaster-response-simulator` repository into sibling directories, then:

```powershell
pnpm install
if (!(Test-Path -LiteralPath '.env.local')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
}
# Set OPENROUTER_API_KEY in the ignored local file.
pnpm lab
```

Four NEXO processes, each with its own persistent embedded PostgreSQL database, run at `http://127.0.0.1:4400`–`4403`. A fifth independent contractor at `4404` has its own database and authority, without a NEXO model. The 3D laboratory observer runs at `http://127.0.0.1:4328`; its source gateway runs at `4329`. Existing simulator ports `4318`/`4319` are left alone.

Role accounts and generated local passwords are saved in ignored `.local/access-org*.json`. No account, model key, simulator key or observer credential is committed. The platform is bound to localhost.

Each laboratory restart creates a new private session directory, retaining earlier databases. Resetting the physical world never silently reuses stale operations from an old run. See [LOCAL.md](docs/LOCAL.md) for roles, budgets, offline operation, moderation, publication and backup/restore.

Investigations receive a focused, sourced preview and can retrieve omitted records with scoped tools. Custom action contracts load only when needed. Reasoning is enabled for supported models with an initial 8,192-token output allowance; private reasoning is never displayed or stored. Provider routing seeks low latency under an explicit tariff ceiling. See [model context and spending](docs/CONTEXTO_MODELO.md).

For one standalone instance, provision its scoped source configuration in `.local/bootstrap.json`, then run `pnpm start`. Use `DATABASE_URL` for a server PostgreSQL database. Without it, the local prototype uses filesystem-persistent embedded PostgreSQL (PGlite); its exclusive connection is not evidence of multi-host database throughput.

## Workspaces

- Response overview, collected signals, sourced investigations and a human decision queue.
- Operational stages, inventory, vehicles, assessed facilities, reservations, deadlines and protected reserves.
- Signed partner messages, explicit sharing, version handling, revocation and independent owner decisions.
- Compiled allocations from owned and current consented partner capacities, with exact offer references, revalidation and independent owner review.
- Approved public response updates, pooled-fund accounting and a local payment-provider sandbox.
- Field reporting with a durable device queue, community intake, scoped accounts and decision history.
- Reviewed photo/audio uploads, reversible evidence groups, sourced human corrections, public photo derivation and traceable publication corrections/retractions.
- Original-byte integrity checks, sampled video frames, local speech transcription and bounded scanned-PDF visual transcription with page provenance and unresolved-page markers.
- Resumable organization setup, persistent processing limits, scoped account revocation, private exports and consistent local recovery bundles.
- Model activity displays real tool requests, returned results and short rationales. It does not display fabricated private chain-of-thought.

## Verification

```powershell
pnpm check
pnpm test
node scripts/verify.mjs
pnpm test:live
pnpm demo
# With pnpm lab running:
pnpm test:ui
```

Tests exercise authorization, CSRF, ownership, version conflicts, idempotency, reserve floors, concurrent allocations, dependency invalidation, restart recovery, signed network messages, payment webhooks and desktop/mobile navigation. Real provider smoke tests and investigation episodes write receipts to `reports/`. Failed or inconclusive investigations do not count as delivered aid.

`pnpm demo` uses the real provider and the actor-visible HTTP gateway. A scripted evaluation operator models approval; this is not a human comprehension trial. Its accelerated modeled clock and actual provider wall latency are reported separately. Production observations, clinical calibration, organizational adoption and statistically supported performance improvements remain separate evidence requirements.

To investigate a received shelter need without supplying the facility or solution:

```powershell
node --env-file-if-exists=.env.local scripts/service-demo.mjs --from-need
```

Comparative pilots save a protocol before execution and retain failed/incomplete outcomes. All arms keep the same per-episode cap; later evaluations use a shared inference pool across owners rather than starving a coordinator with fixed quarters. Both shared arms assign one research coordinator to their shared incident while partners independently authorize and execute their contributions. This is an explicit deployment policy, not distributed leader election. A network benefit is not automatically a GenAI benefit. Summaries distinguish NEXO versus the same-model general investigator and network NEXO versus conventional shared planning.

## Specification and delivery evidence

The full product contract is [PLATAFORMA.md](docs/PLATAFORMA.md). [Implementation coverage](docs/ESTADO_IMPLEMENTACION.md), [measured results](docs/VALIDACION.md), [local operation](docs/LOCAL.md) and [external validation](docs/VALIDACION_EXTERNA.md) distinguish working mechanisms from unproven hypotheses. Simulator requirements and the dated original audit remain in `docs/`. A passing test does not imply the full specification has been demonstrated.

Google Cloud architecture is retained in [ARQUITECTURA_GCP.md](docs/ARQUITECTURA_GCP.md) for a later migration. No cloud service is deployed by this repository at this stage.

The final local verification passes **120 platform tests and 120 simulator tests** with an unchanged candidate fingerprint. The four-process transport probe persisted all **4,000 expected publication/organization versions**, including late uploads, at **3.33 seconds p95 from source availability**; polling and model inference are excluded. Physical service, original-cargo repair, semantic interpretation and role-based UI have separate evidence.

The 36-outcome comparative pilot **does not establish a robust advantage over conventional shared planning or the same-model general investigator**. Negative results, provider failures, backlogs, historical builds and evaluator corrections are retained. See [the final evidence ledger](docs/VALIDACION.md#13-resultados-finales-de-la-entrega-local--13-de-octubre-de-2026-tokio). Independent calibration, human trials and Gemini remeasurement remain separate requirements.
