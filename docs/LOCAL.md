# Run AidScaler locally

## Setup

Use Node.js 24+, pnpm 11 and the sibling checkouts described in the [README](../README.md):

```text
your-workspace/
  aidscaler-platform/
  disaster-response-simulator/
```

Run `pnpm install --frozen-lockfile` in both repositories. In the platform directory, copy `.env.example` to `.env.local` only if you do not already have a local configuration. Set `OPENROUTER_API_KEY` there, then run:

```sh
pnpm lab
```

The current backend integration is **Gemma 4 31B through OpenRouter** (`MODEL_ID=google/gemma-4-31b-it`). Internet access is required for model inference; the workspace, databases and simulator run locally. Gemini and GCP are future integrations.

The launcher resolves `../disaster-response-simulator`. Keep that sibling directory name even if you use another platform directory name.

## Open the workspace

| Surface | Address |
|---|---|
| First organization | [localhost:4400](http://127.0.0.1:4400/) |
| Other organizations | Ports 4401–4403 |
| Independent partner | [localhost:4404](http://127.0.0.1:4404/) |
| Public updates | [localhost:4400/public](http://127.0.0.1:4400/public) |
| Community reporting | [localhost:4400/community](http://127.0.0.1:4400/community) |
| 3D laboratory | [localhost:4328](http://127.0.0.1:4328/) |
| Fictional source feed | [localhost:4329/feed](http://127.0.0.1:4329/feed) |

Services bind to localhost. The standalone simulator's defaults are separate from the laboratory launcher ports above.

Find the generated account addresses, roles and password in `.local/access-org0.json`; organizations 1–3 have equivalent files. The independent partner uses `.local/access-partner-org4.json`. Use the listed address rather than constructing an account name. `.env.local`, `.local/`, session databases and credentials are local, Git-ignored data.

Each launch creates a new session under `.local/labs/<session>/`, with separate databases and credentials per organization. Earlier sessions are retained. `.local/lab.json` identifies the current session and contains the observer access details. The observer controls and inspects the laboratory; it is not an information source for the model.

## A short operator walkthrough

1. **Overview:** see known needs, their sources, received help and active operations.
2. **Signals:** inspect originals and revisions. Select sources to interpret or choose **Discover a response** to investigate a possible need.
3. **Investigations:** follow actual model activity, tool results and pending checks. A request for clarification or assessment remains pending until its response arrives.
4. **Decisions:** inspect quantities, evidence, conditions and owners. An authorized operator approves, edits or rejects the exact proposal version. Partners review their contributions independently.
5. **Operations:** follow orders and trips through physical receipt and service. For a blocked operation, review a repair or recovery of the existing operation instead of silently duplicating it.

The model prepares options; it does not acquire an owner's authority. Acknowledgement, departure, arrival and sufficient receipt are separate states.

| Role | Main workspace responsibility |
|---|---|
| Commander / dispatcher | Priorities, resources, proposal review and operational decisions |
| Analyst | Sources, investigations, checks and draft proposals |
| Field | Assigned tasks, reports and evidence; offline reports sync after reconnection |
| Publisher | Review and approve public updates and media |
| Finance | Sandbox funds, allocations and purchase reconciliation |
| Admin / auditor | Accounts and connectors / read-only history and evidence |

The public portal shows approved aggregates. Community submissions enter moderation. A financial settlement does not establish a physical delivery, and the local payment sandbox does not move real money.

## Organization-owned public pages

In **Sources & access → Public page appearance**, a commander or administrator can edit the organization name, public and reporting page copy, accent color and an optional PNG/JPEG banner. Public pages lead with the organization and keep AidScaler in the footer.

Community reports receive a private tracking key. People can return to `/community` to see the review and team updates. In **Community reports**, operators can review a submission, send a progress update and link a real operational response. Tracking does not expose the original report or manufacture a dispatch status. Test contributions display a dismissible inline receipt and collect no money.

## Model controls and simulation

Automatic source ingestion is enabled by the launcher; automatic investigations start enabled with bounded source batches and the configured call and spending limits. The coordinator can pause or resume them in organization settings. `.env.example` documents provider, timeout and episode-budget settings. Investigations use bounded context and fetch further evidence through scoped tools.

If provider credit is exhausted, new model work pauses while the workspace and human actions remain available. Restore the provider account's credit and restart the affected backend with its existing configuration; avoid replacing the operational database to recover model access.

The interactive laboratory starts at ×10 on an irregular regional map. Its continuous demo clock keeps moving while model work is pending and can run beyond the scenario horizon; benchmark runners reject this demo mode. Pause or adjust its speed in the viewer. **Human attention profile** selects zero, moderate or burst; Advanced JSON can configure finite pools and timings. These native read/decision/transmission queues do not grant physical approval. The scripted simulator policy is a separate control.

To select another scenario before launching, for example in PowerShell:

```powershell
$env:AIDSCALER_SCENARIO = 'S19'
$env:AIDSCALER_LAB_RATE = '10'
pnpm lab
```

Stop the launcher from a second terminal with `pnpm lab:resume --shutdown` before starting another session. This uses a private localhost control and waits for its own backend workers and stores to close before saving the final world checkpoint. On Windows, terminating a process tree or sending Ctrl+C through a noninteractive execution tool can bypass Node's shutdown handlers.

### Resume an existing demo after a code update

`pnpm lab` starts a fresh world. To preserve the current world, proposals, organization databases and sign-in credentials, run `pnpm lab:resume --shutdown` and wait for its coordinated-shutdown receipt, then run `pnpm lab:resume`. No missing database or bootstrap is recreated. The private control token is saved only in the session's ignored local control file; it is never printed. The endpoint cannot terminate arbitrary processes.

`pnpm lab:resume --capture` is a world-only capture for controlled maintenance; it pauses the clock but does not stop source-writing backends. Do not pair it with databases that continued changing afterward. An unclean launcher status causes resume to refuse an older world snapshot rather than pretend it matches newer operational records. Preserve that session for diagnosis and recover a coordinated snapshot or start a separate demo session. There is no periodic world-only backup presented as a consistent platform recovery.

Strict resume requires the same simulator build. An explicitly authorized update to an **interactive continuous demo** may use `pnpm lab:resume --upgrade-demo-build`. This preserves the original checkpoint and run identity, verifies physical/event-state integrity, and records old/new build provenance privately. An older demo may add only the missing public-publication counter, independently reconstructed from its saved public history and recorded in the migration receipt; every other state value must match. It refuses changed configuration or engine contracts and cannot migrate a benchmark run. Resumed-launcher shutdown saves another private checkpoint after stopping its owned children. Resume bundles and credentials stay Git-ignored in `.local/`.

## Optional media and checks

```sh
pnpm setup:media
pnpm check
pnpm test
```

Media setup prepares local transcription and extraction dependencies; the first transcription may download model weights. Supported images and sampled video frames use the configured model. Unprocessed pages, frames or segments remain explicit rather than being presented as fully observed.

Ordinary checks and tests do not require a paid provider. Live-model demos and inference checks do: run them deliberately with a configured budget. Keep keys and generated access files out of screenshots, exports and Git.

To test offline queue migration in a real browser, install the optional Chromium test binary and run:

```sh
pnpm exec playwright install chromium
pnpm test:offline
```

Existing offline reports retain their command IDs and organization ownership when migrated to AidScaler. Older local backup formats remain accepted after an integrity check; new backups use the AidScaler format.

For a database backup, stop the affected instance first. `node scripts/backup.mjs export <new-backup-file>` saves a private bundle; `restore <backup-file> <new-directory>` requires a new destination. Set `AIDSCALER_LOCAL_DIR` to the intended instance's directory. Restore source/network credentials separately, and do not operate the recovered instance alongside the original against the same physical world.
