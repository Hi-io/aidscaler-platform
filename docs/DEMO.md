# Connected Kubernetes demo

The public entry is `https://aidscaler.com/demo/`. It runs one shared, persistent Takamatsu world. The browser observes a restricted 3D projection and can join with its own organization, three vehicles, 600 L of water and 120 meal portions. These are explicit demo onboarding resources. They are not benchmark inputs or resources discovered by a model.

The existing platform supplies ingestion, source investigation, versioned human review, peer sharing and physical operation tracking. The configured provider is **Gemma 4 31B through OpenRouter**. GCP and Gemini are separate future deployments.

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

Keep a paired backup before significant changes. Quiesce the runtime with `kubectl -n aidscaler scale deployment/demo --replicas=0`, wait for graceful termination, back up both the simulator/evidence volume and a PostgreSQL dump, then scale back to one replica. Preserve identities, secrets, archives and PostgreSQL from the same quiesced point. Restoring only an old world checkpoint beside a newer database is unsafe; source boundary checks must remain enabled.

`kubectl rollout undo deployment/demo` can restore a previous code release, but cannot make an incompatible persisted schema backward-compatible. Preserve the last working immutable source ConfigMaps. Inspect logs locally; never publish credentials, session cookies or full source configuration.

## Quotas and continuing operation

- Four concurrently active visitor teams; 100 total teams per configured demo. Finished teams retain their unique identities and contribution history. Idle teams drain existing operations before their capacity can be released.
- No email or registration is required in this demo. A finished visitor can explicitly start a new session; the old organization and its history are preserved. An active or draining team cannot use renewal to duplicate its kit.
- Each visitor starts with an audited planning policy that prioritizes urgency and deadlines. The existing investigation agent receives operational needs and public sources automatically. The policy orders proposed responses; it never authorizes a resource movement.
- Session cookies are HttpOnly, Secure on HTTPS and SameSite. Joining and operational writes use origin checks, CSRF protection, idempotency and server-side authorization.
- Service actor credentials are renewed before the simulator's seven-day TTL. A visitor cookie has its own lifetime and does not expose those credentials.
- Default shared model ceilings: two concurrent requests, bounded waiting queue, USD 1 per hour and USD 15 total. Per-team limits apply too. Change limits only in trusted deployment configuration, not through the public UI. Keep enough output tokens for substantive responses.
- Paid inference runs while a participant is active. An idle public map does not run endless model calls. Existing operations continue if inference is paused or unavailable.
- A visitor receives current public sources without a multi-week history backfill. Each team can accept 5,000 new synthetic source IDs and 20 MB of attachments. Existing evidence is preserved; source revisions and withdrawals remain accepted after the new-source allowance is reached. The session API reports source quota state. Operational map, needs and physical receipts continue updating. Base services refresh operational state without copying the public feed indefinitely.
- The operational demo uses controlled recurring incidents and explicitly recorded replenishment. It disables the long-horizon fatality experiment; it demonstrates coordination workflows and physical deliveries, not measured lives saved over 140 simulated days.
- Base teams are explicitly automated. Their platform owners independently review signed visitor requests against the real plan checks and accept at most one 100 L water or 40-portion food action per request. Advertised base stock is bounded to that allowance. Unsupported or infeasible requests receive a signed rejection with a reason. Visitor approvals remain entirely human-owned; the base controller does not authorize visitor resources.
- Presentation queues and read models are compacted; authoritative physical history remains retained. Demo projections are published every 1,500 ms and rendered with the existing movement interpolation. After a checkpoint is durable, matching audit payloads can be pruned from the duplicate transport queue; event-ID deduplication and the authoritative log remain intact. Obsolete files from previous processes are removed only after a replacement checkpoint is durable, with active and retained files protected. Private maintenance results are recorded in `simulator/storage-maintenance.json`.
- Monitor actual disk growth, request latency, ingestion lag and provider usage during the run. Queue files may keep their SQLite high-water size while reusing free pages; a successful prune does not necessarily shrink the file immediately.

The setup is intended for a two-week demonstration. Passing a short soak, renewal tests and restart checks is not evidence that fourteen real days have already elapsed. Keep the benchmark seeds and published landing results separate from this shared, replenished visitor world.

## Verification

Run the demo-specific simulator and platform integration tests before release. Acceptance includes two independent visitors, duplicate join replay, denied administrative/control requests, cross-organization access rejection, a model-created proposal, human authorization, actual physical receipt and session recovery after restart. Verify desktop 16:9 and mobile in the real browser. Confirm the browser never receives observer credentials.

After the cluster passes these checks, shut down the local development lab through its coordinated control:

```powershell
node scripts/resume-lab.mjs --shutdown
```

That local lab is independent of the public Kubernetes world; stopping it must not affect the demo.
