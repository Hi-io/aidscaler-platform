# NEXO · Disaster-response operations platform

Local operations software for NGOs, emergency teams and public response organizations. Public signals and scoped operational systems feed a model-assisted investigation. Humans authorize consequential actions; transactional and physical validators remain outside the model.

The current model adapter uses **Gemma 4 31B through OpenRouter**, not Gemini. A model's performance is not transferable by assumption. Google Cloud deployment is deliberately excluded from this implementation phase.

## Run locally

Requires Node.js 24+ and pnpm. Clone this private repository and the private `disaster-response-simulator` repository into sibling directories, then:

```powershell
pnpm install
Copy-Item .env.example .env.local
# Set OPENROUTER_API_KEY in the ignored local file.
pnpm lab
```

Four independent local processes, each with a separate PostgreSQL database, run at `http://127.0.0.1:4400`–`4403`. The 3D laboratory observer runs at `http://127.0.0.1:4328`; its source gateway runs at `4329`. Existing simulator ports `4318`/`4319` are left alone.

Role accounts and generated local passwords are saved in ignored `.local/access-org*.json`. No account, model key, simulator key or observer credential is committed. The platform is bound to localhost.

For one standalone instance, provision its scoped source configuration in `.local/bootstrap.json`, then run `pnpm start`. Use `DATABASE_URL` for a server PostgreSQL database. Without it, the local prototype uses filesystem-persistent embedded PostgreSQL (PGlite); its exclusive connection is not evidence of multi-host database throughput.

## Workspaces

- Response overview, collected signals, sourced investigations and a human decision queue.
- Operational stages, inventory, vehicles, assessed facilities, reservations, deadlines and protected reserves.
- Signed partner messages, explicit sharing, version handling, revocation and independent owner decisions.
- Approved public response updates, pooled-fund accounting and a local payment-provider sandbox.
- Field reporting with a durable device queue, community intake, scoped accounts and decision history.
- Model activity displays real tool requests, returned results and short rationales. It does not display fabricated private chain-of-thought.

## Verification

```powershell
pnpm check
pnpm test
pnpm test:live
pnpm demo
# With pnpm lab running:
pnpm test:ui
```

Tests exercise authorization, CSRF, ownership, version conflicts, idempotency, reserve floors, concurrent allocations, dependency invalidation, restart recovery, signed network messages, payment webhooks and desktop/mobile navigation. Real provider smoke tests and investigation episodes write receipts to `reports/`. Failed or inconclusive investigations do not count as delivered aid.

`pnpm demo` uses the real provider and the actor-visible HTTP gateway. A scripted evaluation operator models approval; this is not a human comprehension trial. Its accelerated modeled clock and actual provider wall latency are reported separately. Production observations, clinical calibration, organizational adoption and statistically supported performance improvements remain separate evidence requirements.

## Specification and delivery evidence

The full product contract is [PLATAFORMA.md](docs/PLATAFORMA.md). Simulator requirements and its audit are in `docs/`. Implementation progress, experiments and known limitations are kept separately from aspirational requirements; a passing test does not imply the full specification has been demonstrated.

Google Cloud architecture is retained in [ARQUITECTURA_GCP.md](docs/ARQUITECTURA_GCP.md) for a later migration. No cloud service is deployed by this repository at this stage.
