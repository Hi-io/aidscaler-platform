# Development and evaluation guide

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Google Cloud deployment](../deploy/gcp/README.md)

This guide covers a development checkout and the repeatable evaluation laboratory. The deployed AidScaler platform runs on Google Cloud.

## Install

Use **Node.js 24+**, **pnpm 11** and Git.

```sh
git clone https://github.com/Hi-io/aidscaler-platform.git
cd aidscaler-platform
pnpm install --frozen-lockfile
pnpm check
```

## Evaluation laboratory

The laboratory connects multiple AidScaler organizations to the separate disaster-response simulator. Clone it beside the platform and install its dependencies:

```sh
cd ..
git clone https://github.com/Hi-io/disaster-response-simulator.git
cd disaster-response-simulator
pnpm install --frozen-lockfile
cd ../aidscaler-platform
```

Expected layout:

```text
workspace/
  aidscaler-platform/
  disaster-response-simulator/
```

Keep the simulator directory named `disaster-response-simulator`: the launcher and evaluation tests resolve that sibling path.

For a new configuration, copy [`.env.example`](../.env.example) to `.env.local`. The standalone laboratory launcher uses the API-key provider configured in that example; supply `OPENROUTER_API_KEY` and review the model and spending settings. Keep an existing configuration when resuming a session.

**Gemini on Vertex AI** is integrated through [`VertexProvider`](../src/vertex-provider.mjs) and the Cloud Run provider factory. The [cloud guide](../deploy/gcp/README.md#configure-gemini-on-vertex-ai) documents the Vertex configuration; the laboratory launcher's provider setup is separate.

Start the laboratory:

```sh
pnpm lab
```

| Surface                      | Address                                                     |
| ---------------------------- | ----------------------------------------------------------- |
| First organization           | [localhost:4400](http://127.0.0.1:4400/)                    |
| Other organizations          | Ports 4401–4403                                             |
| Independent partner          | [localhost:4404](http://127.0.0.1:4404/)                    |
| Public portal                | [localhost:4400/public](http://127.0.0.1:4400/public)       |
| Community reporting          | [localhost:4400/community](http://127.0.0.1:4400/community) |
| 3D evaluation viewer         | [localhost:4328](http://127.0.0.1:4328/)                    |
| Fictional public source feed | [localhost:4329/feed](http://127.0.0.1:4329/feed)           |

Generated role accounts are in ignored `.local/access-org*.json` files; the independent partner uses `.local/access-partner-org4.json`. Use the listed account for the role being tested.

Each new launch creates an isolated session under `.local/labs/`, with organization-specific stores and source credentials. `.local/lab.json` identifies the current session. The observer's controls belong to the evaluator and are separate from the model's scoped sources.

## Follow an operator's workflow

1. **Overview:** inspect known needs, supporting sources, received aid and active operations.
2. **Signals:** review originals and revisions, then investigate a potential need.
3. **Investigations:** follow model activity, tool results, findings and pending checks.
4. **Decisions:** review quantities, conditions, evidence and owners. Approve, edit or reject the exact response version.
5. **Operations:** follow execution through physical receipt and service; review repairs when conditions change.

| Role                   | Focus                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| Commander / dispatcher | Priorities, resources, response review and operational decisions.         |
| Analyst                | Sources, investigations, checks and draft proposals.                      |
| Field                  | Assigned tasks, evidence, progress and offline reports.                   |
| Publisher              | Reviewed public updates and media.                                        |
| Finance                | Funds, allocations and purchase reconciliation in the evaluation sandbox. |
| Admin / auditor        | Accounts and connectors / read-only history and evidence.                 |

Organization administrators can customize public page identity, copy, accent color and banner. Community reports receive private tracking keys and operator follow-up. Approved publications form the public view of progress.

## Session controls

The interactive laboratory starts on Takamatsu's 10 × 10 km mapped road network. The viewer can pause the world or adjust its speed. For a different scenario or time scale, set the desired environment values before starting a new session:

```powershell
$env:AIDSCALER_SCENARIO = 'S19'
$env:AIDSCALER_LAB_RATE = '10'
pnpm lab
```

To close and later resume the same world, organization databases and credentials:

```sh
pnpm lab:resume --shutdown
pnpm lab:resume
```

Wait for the coordinated-shutdown receipt before resuming. Use `pnpm lab` for a **new** session. Keep the world checkpoint and platform databases from the same coordinated point; a matching source identity is part of recovery.

Automatic ingestion and investigation are separately configurable. `.env.example` includes call limits, timeouts, batch sizes and spending limits. A coordinator can pause investigations while retaining access to human workflows.

## Persistence

Development uses PostgreSQL-compatible PGlite by default. Set `DATABASE_URL` for an external PostgreSQL database; the deployed platform uses Cloud SQL.

Operational records and evidence bytes are separate. `.env.local`, `.local/`, generated accounts, backups and credentials remain Git-ignored.

For an instance backup, stop its writers and use:

```sh
node scripts/backup.mjs export <new-backup-file>
node scripts/backup.mjs restore <backup-file> <new-directory>
```

Set `AIDSCALER_LOCAL_DIR` to the intended instance directory. Restore its source and network credentials separately, and resume one authoritative instance.

## Media processing

```sh
pnpm setup:media
```

This prepares transcription and document-extraction dependencies. Images and sampled video frames use the configured model. Processed outputs remain linked to their original evidence.

## Checks

With both repositories installed:

```sh
pnpm check
pnpm test
pnpm hygiene
```

Focused browser checks:

```sh
pnpm exec playwright install chromium
pnpm test:offline
pnpm test:journeys
pnpm test:review
```

The [test directory](../tests/) covers authorization, cross-organization ownership, inventory, physical delivery, recovery, source boundaries, model adapters and workspace behavior. Read each script's configuration before running a live-provider or full evaluation job; inference uses the configured budget.

For the recorded Gemini comparison and metric definitions, see [Benchmark](BENCHMARK.md).
