# Connected Kubernetes demo

The public entry is `https://aidscaler.com/demo/`. It runs one shared, persistent Takamatsu world. The browser observes a restricted 3D projection and can join with its own organization, three vehicles, 600 L of water and 120 meal portions. These are explicit demo onboarding resources. They are not benchmark inputs or resources discovered by a model.

The existing platform supplies ingestion, source investigation, versioned human review, peer sharing and physical operation tracking. The configured provider is **Gemma 4 31B through OpenRouter**. GCP and Gemini are separate future deployments.

The map opens with a close view, simulated clock, visible aid vehicles and separate gray traffic markers. Report avatars come from published, located sources; selecting one keeps that source open until the visitor returns to the live stream. “Full map” restores the entire region. A participant's pending responses appear on their workspace button and are still reviewed before authorization.

## Boundaries

- Public: `/demo/`, `/demo/api/*`, approved spectator assets and a session-bound `/demo/workspace/`.
- Private: observer/control/actor provisioning ports, PostgreSQL, provider credentials, platform service accounts and network signing secrets. The sole externally routed Service is the gateway, reached through the existing landing proxy and Cloudflare Tunnel.
- Each browser session owns one organization. It cannot choose another organization's workspace or change connectors, automation budgets, model configuration or simulator controls.
- Contributions are simulation operations. Payments remain a sandbox. Published or approved plans do not count as physical deliveries.
- The observer map is a presentation projection. Investigators receive their organization's scoped actor state and ordinary sources, not observer facts or future events.

## Current deployment

Namespace: `aidscaler`, on `worker-1`. Existing `landing` and `cloudflared` remain independent.

| Resource | Purpose |
|---|---|
| `deployment/demo`, `service/demo:8080` | Gateway, organization instances and isolated engine worker |
| `deployment/demo-postgres`, private Service | Shared PostgreSQL with organization-scoped records |
| PVC `demo-data` | World checkpoint, event archives, credentials and evidence |
| PVC `demo-postgres` | Database files |
| Secret `demo-credentials` | Database, model and persistent session secrets |

Volumes are retained, explicitly pinned to this single node under `/var/lib/aidscaler-demo/`. They survive ordinary pod restarts; they are not off-node backups or high availability. Do not delete/reinitialize either volume to repair an application error.

The runtime PVC advertises 12 GiB, but this `hostPath` storage has no filesystem quota: the actual limit is the node's free disk. Approximately 180 GB was free at deployment. Full physical history and deduplication IDs are retained. A conservative extrapolation of the initial high-traffic period could require 100–130 GB at checkpoint peak over fourteen days; this is an estimate, not a measured requirement. Inspect actual growth and free space during the run. For a longer unattended service, provide a dedicated volume and off-node backups rather than relying on a nominal PVC capacity.

Runtime code is an immutable, size-bounded archive in ConfigMaps. A non-root init container extracts it and installs frozen production lockfiles into an ephemeral application volume. Runtime source is read-only; state writes go to the PVC. Images are pinned by digest. No credentials or local development state enter the code bundle. No container registry or privileged build daemon is needed for this cluster.

PostgreSQL has a 1 GiB memory ceiling, 40 connection slots and bounded per-query working memory; organization instances share one connection pool. Readiness checks both the simulator and a database query. Process liveness uses `/healthz` so a temporary database outage does not restart the authoritative world. PostgreSQL connection errors are handled and logged using an allowlisted code only, with no complete client or error object.

## Initial credentials and deploy

Run from the platform checkout with Node.js 24+. Use the existing ignored `.env.local` or a trusted process environment for `OPENROUTER_API_KEY`:

```powershell
node deploy/prepare-demo-secret.mjs
```

This creates a private ignored file and never prints its contents. Apply it from WSL Ubuntu using the existing cluster context:

```bash
export PATH="$HOME/.local/bin:$PATH"
platform="/mnt/c/Users/Hiros/OneDrive/Documentos/AI Builder Cup/nexo-platform"
kubectl -n aidscaler apply --server-side --field-manager=aidscaler-demo-secret -f "$platform/.local/kubernetes-demo/credentials.json"
bash "$platform/deploy/deploy-demo.sh"
```

Then publish the sibling landing's static files and proxy configuration with its existing `deploy-k8s.sh`. That script preserves `/` and routes only `/demo/api/`, `/demo/workspace/` and `/demo/viewer/` to the private gateway. No DNS or tunnel credential change is required.

## Updates and recovery

The runtime uses one replica with `Recreate`. On termination it stops operational writers, checkpoints the authoritative engine and closes the database connection. The 120-second grace period is intentional. Never use forced termination for normal maintenance.

```bash
kubectl -n aidscaler get deployments,pods,pvc
kubectl -n aidscaler rollout status deployment/demo
curl -fsS https://aidscaler.com/demo/api/health
```

The host preserves the same source instance and world clock. A compatible code update requires an explicit operator opt-in:

```bash
DEMO_ALLOW_BUILD_UPGRADE=true bash "$platform/deploy/deploy-demo.sh"
```

The host checks the checkpoint contract and records the before/after build and unchanged physical state hash. A schema, engine-version or incompatible contract change is refused; it does not create a replacement world. The one-time `DEMO_MIGRATE_OPERATIONAL_CONFIG=true` flag is reserved for the documented operational-demo configuration migration, with a separate audit record. Neither flag enables benchmark migration.

Shutdown first stops source HTTP admission and drains admitted commands before the final pause, transport flush and checkpoint. A genuine source rewind or changed response still fences earlier workspaces. For already fenced automated bases only, trusted maintenance can explicitly set `DEMO_ARCHIVE_FENCED_BASES=true` for one deployment, then remove the flag. This archives the complete previous active partition with a verified hash in the private `demo_response_archives` table before starting a fresh base context. It retains the original audit, billing and replay receipts, admits no archived job, and never unlocks visitor plans. It refuses a different scenario run. Do not use it as a substitute for a paired backup or to reauthorize old work.

Keep a paired backup before significant changes. Quiesce the runtime with `kubectl -n aidscaler scale deployment/demo --replicas=0`, wait for graceful termination, back up both the simulator/evidence volume and a PostgreSQL dump, then scale back to one replica. Preserve identities, secrets, archives and PostgreSQL from the same quiesced point. Restoring only an old world checkpoint beside a newer database is unsafe; source boundary checks must remain enabled.

`kubectl rollout undo deployment/demo` can restore a previous code release, but cannot make an incompatible persisted schema backward-compatible. Preserve the last working immutable source ConfigMaps. Inspect logs locally; never publish credentials, session cookies or full source configuration.

## Quotas and continuing operation

- Four concurrently active visitor teams; 100 total teams per configured demo. Finished teams retain their unique identities and contribution history. Idle teams drain existing operations before their capacity can be released.
- No email or registration is required in this demo. A finished visitor can explicitly start a new session; the old organization and its history are preserved. An active or draining team cannot use renewal to duplicate its kit.
- A participant can explicitly end their session. This stops new investigations and workspace writes; already issued physical operations must finish or reach a terminal state before the simulator releases the team. Ending and renewing are separate, session-scoped actions. Participants may also set their operational priorities within the host's bounded review limits; model budgets and technical settings remain private.
- Each visitor starts with an audited planning policy that prioritizes urgency and deadlines. The existing investigation agent receives operational needs and public sources automatically. The policy orders proposed responses; it never authorizes a resource movement.
- Session cookies are HttpOnly, Secure on HTTPS and SameSite. Joining and operational writes use origin checks, CSRF protection, idempotency and server-side authorization.
- Service actor credentials are renewed before the simulator's seven-day TTL. A visitor cookie has its own lifetime and does not expose those credentials.
- Default shared model ceilings: two concurrent requests, bounded waiting queue, USD 1 per hour and USD 15 total. Per-team limits apply too. Change limits only in trusted deployment configuration, not through the public UI. Keep enough output tokens for substantive responses.
- Paid inference runs while a participant is active. An idle public map does not run endless model calls. Existing operations continue if inference is paused or unavailable.
- A visitor receives current public sources without a multi-week history backfill. Each team can accept 5,000 new synthetic source IDs and 20 MB of attachments. Existing evidence is preserved; source revisions and withdrawals remain accepted after the new-source allowance is reached. The session API reports source quota state. Operational map, needs and physical receipts continue updating. Base services refresh operational state without copying the public feed indefinitely.
- The operational demo uses controlled recurring incidents and explicitly recorded replenishment. It disables the long-horizon fatality experiment; it demonstrates coordination workflows and physical deliveries, not measured lives saved over 140 simulated days.
- The director opens a further wave after three requests are physically resolved, with a ten-simulated-minute quiet-period watchdog and at most eight open demo incidents. An outstanding request is never silently deleted to make room. Automated bases leave a brief intervention window for visitors, then can serve the uncommitted remainder without authorizing visitor resources. Reconfirmed outstanding needs retain their original deadline and receipt history.
- All active teams default to scheduled incoming supplies: 300 L of water and 60 food portions every 30 simulated minutes (about three real minutes at 10×). Visitors can change their own schedule when joining or from the map. Allowed intervals are 5–360 simulated minutes, with 0–600 L and 0–120 portions per shipment; depot stock is capped at 1,200 L and 300 portions. Disabling a schedule stops future receipts. Changing it starts the next interval from the current simulated time, with no retroactive catch-up. Incoming supplies are logged ledger additions, not replacement inventory or completed beneficiary deliveries.
- **Resources & facilities → Record received supplies** is a human warehouse intake workflow. The owning commander or dispatcher confirms a shipment, its quantity and a unique reference; the connected source must acknowledge it before the platform calls it received. Reusing the reference is idempotent; changing its material conflicts. In the public demo, manual receipts are additionally bounded to 600 L or 120 portions per request, one per team per 30 simulated minutes, and the same depot caps. Agent tools cannot use this human intake route.
- Base teams are explicitly automated. Their platform owners independently review signed visitor requests against the real plan checks and accept at most one 100 L water or 40-portion food action per request. Advertised base stock is bounded to that allowance. Unsupported or infeasible requests receive a signed rejection with a reason. Visitor approvals remain entirely human-owned; the base controller does not authorize visitor resources.
- Presentation queues and read models are compacted; authoritative physical history remains retained. Demo projections are published every 1,500 ms and rendered with the existing movement interpolation. After a checkpoint is durable, matching audit payloads can be pruned from the duplicate transport queue; event-ID deduplication and the authoritative log remain intact. Obsolete files from previous processes are removed only after a replacement checkpoint is durable, with active and retained files protected. Private maintenance results are recorded in `simulator/storage-maintenance.json`.
- Audit compaction is optional maintenance. If an old queued payload cannot be proven identical to its durable checkpoint event, it remains unacknowledged and unpruned, with the sanitized warning `AUDIT_COMPACTION_DEFERRED`. This does not stop the world or invalidate a successful checkpoint. Inspect the retained history before attempting any manual cleanup.
- Monitor actual disk growth, request latency, ingestion lag and provider usage during the run. Queue files may keep their SQLite high-water size while reusing free pages; a successful prune does not necessarily shrink the file immediately.

The setup is intended for a two-week demonstration. Passing a short soak, renewal tests and restart checks is not evidence that fourteen real days have already elapsed. Keep the benchmark seeds and published landing results separate from this shared, replenished visitor world.

## Verification

Run the demo-specific simulator and platform integration tests before release. Acceptance includes two independent visitors, duplicate join replay, denied administrative/control requests, cross-organization access rejection, a model-created proposal, human authorization, actual physical receipt and session recovery after restart. Verify desktop 16:9 and mobile in the real browser. Confirm the browser never receives observer credentials.

The public acceptance run on 17 October 2026 used the actual OpenRouter model and the public Cloudflare URL. Hikari Relief reviewed a sourced proposal for 200 L, authorized its own vehicle, followed its movement and received an engine-confirmed 200 L receipt. The need count decreased from eight to seven. A subsequent Kubernetes deployment preserved the same organization, browser session and receipt. The second organization, Sora Relief, remained isolated and received its own pending proposal. Desktop 1920×1080 and mobile 390×844 were checked in Chrome; the embedded workspace, public sandbox contribution and close controls worked. The workspace also offers a same-tab fallback if embedding is delayed.

The later UI acceptance created Sakura Response through the public join flow. Its automatically prepared plan was reviewed and authorized in the full-page workspace. The source confirmed three owned deliveries totaling 300 L of water and 80 food portions; separately reviewed base-team contributions delivered another 300 L. No UI timer counted as a receipt. Ending the earlier Hikari session and renewing its browser session preserved its records. Two consecutive runtime updates retained the same source identity and advancing clock, the original 200 L receipt, and all four recovered automated bases. Their previous partitions remain in four hash-verified private archives.

The continuous-director release passed 65 simulator regressions and 30 platform regressions, including the new supply routes. A seven-day accelerated small-map soak kept a visitor connected without approving any resources: all 168 simulated hours contained physical delivery progress, with 665 requests resolved, 1,996 completed deliveries and no failed trip. A separate twelve-hour Takamatsu run also progressed every hour and reproduced the next hour exactly after restoring its checkpoint. These are continuity checks rather than outcome comparisons. The public upgrade preserved the existing world and receipt history, recorded the first scheduled arrivals for all four bases, and opened a subsequent wave after physical service. Sakura's public warehouse form accepted a 10 L delivery reference twice while adding only 10 L and keeping one receipt record.

Release checks found no provider key in tracked or releasable source, Git-history pattern scans, or 23 public routes/assets. Authenticated workspace responses were checked too. Actual administrative requests with a valid workspace session and CSRF token returned `DEMO_SCOPE`; simulator controls and unapproved viewer assets were denied. The provider key remains in a Kubernetes Secret and the server environment. These checks establish the tested boundaries; they are not a claim of a comprehensive security certification or a fourteen-day soak.

The deployed PostgreSQL recovery check terminated only its own temporary idle connection. The handler received `57P01`, kept the process alive, connected through a replacement backend and completed a subsequent query. Diagnostics contained only the allowed connection code. A real automatic investigation also produced a pending food-delivery proposal without the operator starting an investigation.

After the cluster passes these checks, shut down the local development lab through its coordinated control:

```powershell
node scripts/resume-lab.mjs --shutdown
```

That local lab is independent of the public Kubernetes world; stopping it must not affect the demo.
