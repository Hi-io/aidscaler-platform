# AidScaler

### Disaster-response operations, from scattered reports to coordinated action.

AidScaler is an operations platform for NGOs, emergency services and public response teams. It connects public reports with operational data, investigates what needs checking and prepares actions for human review. Multiple organizations can coordinate their capabilities while keeping control of their resources and decisions.

The live hybrid demo runs on **Google Cloud with Gemma 4 31B through OpenRouter**. Its shared simulation runs in Kubernetes. A Vertex AI adapter is available for a future Gemini rollout.

## Try the connected demo

Open [aidscaler.com/demo](https://aidscaler.com/demo/) to observe the shared Takamatsu response or create a demo organization. No registration is required. Your team receives limited vehicles and supplies, reviews real model proposals and can follow its authorized deliveries in the simulated world.

The public viewer is read-only. Each participant controls their own organization's decisions; simulator controls, connectors and provider credentials stay private. See [Cloud deployment](deploy/gcp/README.md) for the current stack, quotas and recovery. The [local demo guide](docs/DEMO.md) retains the Kubernetes rollback workflow.

The shared demo creates further incidents as requests are resolved. Teams receive scheduled supplies by default; expand **Recurring supplies (demo)** when joining, or edit your team's schedule on the map. Operators can also use **Resources & facilities → Record received supplies** to confirm an incoming shipment with a unique delivery reference.

## What the platform does

- **Bring information together.** Collect public signals, field reports and connected operational sources, preserving their origin and versions.
- **Investigate with evidence.** Interpret text and supported media, cross-check claims and request clarification or competent field assessment.
- **Prepare feasible responses.** Check stock, staff qualifications and shifts, vehicle capacity, routes, deadlines and protected reserves.
- **Coordinate across organizations.** Exchange consented capabilities and proposals; each owner reviews its own contribution.
- **Follow execution.** Distinguish approval, dispatch, travel, arrival, physical receipt and service. Revisit plans when their dependencies change.
- **Keep the public informed.** Publish approved progress and aggregate sandbox funding information without exposing the operational workspace.

Operators work through signals, investigations, decisions and operations. Field teams have assigned tasks and offline reporting; publishers, finance staff and administrators have separate permissions. Model activity shows real tool requests and returned evidence, with explanations that the operator can inspect.

## Run locally

Install **Node.js 24+**, **pnpm 11** and Git. Clone the platform and its simulation laboratory into sibling directories:

```sh
git clone --depth 1 https://github.com/Hi-io/aidscaler-platform.git
git clone --depth 1 https://github.com/Hi-io/disaster-response-simulator.git

cd disaster-response-simulator
pnpm install --frozen-lockfile

cd ../aidscaler-platform
pnpm install --frozen-lockfile
```

On first setup, copy `.env.example` to `.env.local` and set `OPENROUTER_API_KEY` in that local file. Keep the configured model as `google/gemma-4-31b-it` to use the current integration. Then start the laboratory:

```sh
pnpm lab
```

| Open | Purpose |
|---|---|
| [Workspace · localhost:4400](http://127.0.0.1:4400/) | First organization's operational workspace |
| [3D laboratory · localhost:4328](http://127.0.0.1:4328/) | Inspect and control the connected Takamatsu world |
| [Source feed · localhost:4329/feed](http://127.0.0.1:4329/feed) | Fictional public reports consumed over HTTP |
| [Public portal](http://127.0.0.1:4400/public) | Approved public updates |

The launcher also starts three organization workspaces on ports 4401–4403 and an independent partner on 4404. Generated sign-in details are stored in ignored `.local/access-org*.json` files; use the exact account for the role you need. Stop the launcher with **Ctrl+C**.

Keep the simulator directory named `disaster-response-simulator`: the launcher and evaluation tools resolve it as a sibling. The platform directory can be named `aidscaler-platform`.

See [Local operation](docs/LOCAL.md) for accounts, model budgets, media setup and the operator workflow. The [simulation laboratory](https://github.com/Hi-io/disaster-response-simulator) provides the deterministic world, source gateway and optional 3D viewer; it is separate from the operational product.

For development, see the [architecture](docs/ARCHITECTURE.md) and [integration guide](docs/INTEGRATIONS.md).

## Development

```sh
pnpm check
pnpm test
```

The ordinary test suite uses local fixtures. Commands that explicitly invoke the live model or media inference require provider access and consume the configured budget.

## Project scope

This is a working prototype with a local laboratory and a public hybrid Google Cloud/Kubernetes demo. The laboratory represents finite resources, human attention, communication delays and physical delivery; its outcomes are simulation evidence. Real emergency operations, institutional adoption and Gemini performance need their own validation. Financial flows use a local sandbox and do not charge real money.
