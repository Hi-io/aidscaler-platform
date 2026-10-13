# NEXO · Disaster-response operations platform

NEXO helps NGOs, emergency services and public response teams turn scattered reports into coordinated help. It combines public signals with each team's operational tools, investigates what needs checking and prepares feasible actions for human approval. Organizations can share capacity while retaining control of their resources and decisions.

The local platform uses **Gemma 4 31B through OpenRouter**. In the latest matched simulation, preparing and authorizing the response took **30.49% less time**. Sufficient physical aid arrived **20.59% sooner**:

| Recorded metric | Conventional | NEXO + Gemma 4 | What it means |
|---|---:|---:|---|
| Prepare and authorize the response | 28.278 min | 19.656 min | 8.622 fewer minutes waiting before help is authorized; excludes the shipment's pickup and loaded journeys. |
| Operations excluding both shipment journeys | 30.295 min | 21.673 min | 28.46% less time; retains coordination, command transmission, loading and unloading. |
| Wait for sufficient aid | 44.279 min | 35.162 min | 9.117 fewer minutes until the required quantity is physically received, including travel. |
| Needs fully supplied | 24/24 | 24/24 | All requested quantities delivered; this counts needs, not individual people or lives saved. |
| Fuel consumed | 38.880 L | 37.665 L | 3.125% less simulated vehicle fuel for the same coverage. |

Both methods had the same seed, resources, physical constraints and owner approvals. Six real model calls cost **USD 0.00613892**. Blankets took longer despite the improvement overall. [Current times, resource units and what every metric means](reports/analysis/final-two-response-explained-20261013/readout.md); [unchanged recorded evidence](reports/analysis/final-two-response-closed-20261013/readout.json); [earlier three-seed result and assumptions](docs/RESULTADOS_CAPACIDAD_HUMANA.md).

Preparation and authorization includes access to information, reading, checks, coordination, review and fleet-availability waits; it is not the model's thinking time alone. Removing the shipment journeys retains those waits. Food is measured in portions, water in litres and blankets in individual items. Quantity × waiting time is reported separately for each resource, without assuming a number of people or families served.

Reading, decision and communication times are simulation assumptions. The current result is one paired seed; the earlier three-seed result of 18.02% remains separate. Gemini, emergency field operations and Google Cloud deployment require their own validation.

## Run locally

Requires Node.js 24+ and pnpm. Clone this private repository and the private disaster-response-simulator repository into sibling directories, then:

~~~powershell
pnpm install
if (!(Test-Path -LiteralPath '.env.local')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
}
# Set OPENROUTER_API_KEY in the ignored local file.
pnpm lab
~~~

The first operational workspace is at [localhost:4400](http://127.0.0.1:4400); the other organizations use ports 4401–4403, each with its own persistent database. The independent contractor workspace is at port 4404; the 3D observer is at 4328 and its source gateway at 4329. Generated local passwords are saved in ignored .local/access-org*.json files. The platform binds to localhost, and credentials are excluded from Git.

Each restart retains earlier session databases. A reset creates a fresh operational session instead of reusing stale commitments. [LOCAL.md](docs/LOCAL.md) explains accounts, budgets, field reports, publication and recovery.

## What you can do

- Collect public reports, inspect their sources and follow a sourced investigation.
- Review proposed actions against available stock, qualified staff, vehicle capacity, routes, deadlines and protected reserves.
- Coordinate independently approved contributions from partner organizations, with signed messages, reservations and delivery receipts.
- Track physical delivery, facility readiness and evacuation separately from approval or dispatch.
- Receive offline field reports and reviewed media, then publish approved progress through the public portal.
- Manage pooled funds and local sandbox payments, with traceable allocations and purchase receipts.

Model activity shows real tool requests, returned evidence and short explanations. It does not display fabricated private reasoning. Investigations receive focused context and retrieve further records through scoped tools. [CONTEXTO_MODELO.md](docs/CONTEXTO_MODELO.md) explains context and spending.

The simulator's **Human attention profile** selector exposes zero, moderate and burst presets; Advanced JSON controls timings and finite staff pools. Its scripted policy menu remains separate from a real manual controller or the Gemma integration. The measured manual workflow uses native read → decide → relay tasks and actual communication receipts, with finite owner reviews for both methods.

## Verification and evidence

~~~powershell
pnpm check
pnpm test
node scripts/verify.mjs
# Real provider and browser checks have separate receipts:
pnpm test:live
pnpm test:ui
~~~

The unchanged platform candidate 9b4de8b… has a previously sealed [486-check core verification](reports/verifications/1791875155549.json). After the latest simulator and viewer updates, **249 simulator checks**, [31 affected integration checks](reports/verifications/affected-facility-integration-20261013.json) and [7 focused browser checks](reports/human-profile-ui/1791891190000/result.json) passed. The earlier [113 browser checks](reports/ui-verifications/1791876005595.json) remain evidence of their recorded version. These receipts verify behavior; performance comes from separate physical comparisons.

The full design is in [PLATAFORMA.md](docs/PLATAFORMA.md). [Implementation coverage](docs/ESTADO_IMPLEMENTACION.md), [measured results](docs/RESULTADOS_CAPACIDAD_HUMANA.md) and [external validation](docs/VALIDACION_EXTERNA.md) distinguish implemented mechanisms, measured simulation outcomes and evidence still needed in the field. Earlier receipts remain versioned in reports/ and Git history.

The [Google Cloud architecture](docs/ARQUITECTURA_GCP.md) is a migration plan. This phase runs locally and does not deploy cloud services.

## Repeat the response comparison

`node --env-file-if-exists=.env.local scripts/compare-response.mjs` displays the fixed protocol without making calls. Add `--run=ROOT_GO_FINAL_TWO_RESPONSE` to run the paired local experiment with the configured Gemma key. Results, physical receipts, failed cases and costs are saved under `reports/final-two-response/`; the maximum declared model exposure is USD 0.15.

`node scripts/explain-response.mjs --output=reports/analysis/your-new-readout` renders the existing closed comparison with time breakdowns, travel-excluded operations and explanations for every displayed metric. This command only reads saved evidence and writes a new report; it makes no provider calls and runs no simulations.
