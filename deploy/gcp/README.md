# AidScaler demo on Google Cloud

Deployment: 18 October 2026, project `aidscaler`. The hybrid demo uses Google
Cloud for the application and the existing local Kubernetes cluster for its world.
The active model remains **Gemma 4 through OpenRouter**. Vertex/Gemini is an
optional adapter; deployment does not switch providers automatically.

## Deployment shape

- Static landing and spectator assets: Firebase Hosting, global CDN and HTTPS.
- API, UI gateway and bounded processing: Cloud Run, 1 CPU / 1 GiB,
  minimum zero, maximum one instance initially.
- Five active visitor workspaces plus the four fixed simulated response teams.
  The fixed teams do not make autonomous paid model calls.
- PostgreSQL: Cloud SQL Enterprise, db-g1-small, 20 GiB SSD, no HA replica,
  three retained backups, automatic storage expansion disabled.
- Attachments: private Cloud Storage bucket. Browser API authorization remains
  in force; mounting the bucket does not make its contents public.
- Simulator: existing local Kubernetes node, retained Takamatsu world, process
  kept loaded but clock paused after ten real minutes without visible visitors.
- Pub/Sub request/reply transport: the local cluster uses outbound connections.
  No public simulator controls or observer credentials are exposed.
- Cloud Tasks: bounded worker requests while visitors are present. Persistent
  jobs, reservations, authority checks and idempotency remain in PostgreSQL.
- BigQuery: short-retention analytics dataset prepared. Domain analytics export
  is not connected yet; transactional application data remains in PostgreSQL.

## Verification and recovery

Real Cloud Build images, Cloud SQL import, Firebase Hosting publication, Pub/Sub
round trips and two isolated cloud visitor workspaces have been checked. The
session signing secret and paired PostgreSQL/world backup were preserved.
A real Vertex tool-call smoke test checked future compatibility only; it does
not change the demo's active provider or replace its Gemma evaluation evidence.

Private deployment evidence is in `.local/gcp/`. Keep live functional checks
separate from mocked Terraform tests. Budget email delivery requires recipient
confirmation; configured channels alone do not prove an email was delivered.

The first low-memory bridge startup advanced the transport journal beyond its
checkpoint and therefore created a new source epoch. The physical run and world
were retained. Old partitions were fenced, not silently rebound. Four automated
base partitions were archived with hash verification while writers and queues
were stopped; visitor history and all audit/usage records were preserved.
A later graceful restart retained the same new source epoch and physical run.
The five-slot soak then exceeded the original 4 GiB allocation. The local bridge
now has 6 GiB, a 4 GiB V8 heap allowance and a longer recovery startup probe.
Unexpected recovery must still fence earlier transport epochs; memory limits
are not a substitute for this check.
Do not restore an old database dump over newer visitor work.

## Local tools and configuration

The current Windows workstation uses Google Cloud CLI in WSL Ubuntu and a portable
Terraform CLI in the parent workspace's .local/tools directory. deploy.ps1 reads
the private alert recipient from .local/gcp/settings.json. That file, OAuth
credentials, Terraform state, plans and backend settings are excluded from Git.
The cloud gateway uses the reserved `__session` HttpOnly cookie because Firebase
Hosting forwards only that cookie to dynamic rewrites. CSRF/origin checks and
organization isolation remain enforced. Operational worker turns reserve space
for execution and ingestion; partner requests/receipts precede snapshot backlog.
An independent operational lane schedules the existing checked response compiler
when received demand/capacity materially changes under an approved coordinator
policy. It can prepare useful drafts while a separate model inquiry is pending
or inconclusive. Its activity is labelled as deterministic compilation with zero
model calls; uncertainty in the investigated case remains visible. This neither
authorizes resources nor claims that the model authored the compiled plan.

    ./deploy/gcp/deploy.ps1 -Stage Check

The Check stage prepares allowlisted build/static artifacts, scans them for
credential patterns, validates Terraform, runs a fully mocked Terraform plan,
and reads project/billing status. It does not enable APIs or create resources.

Terraform dependencies are pinned in .terraform.lock.hcl. Runtime dependencies
use the repositories' frozen pnpm lockfiles. Re-run prepare after source changes.

## Budget protection

The active billing account uses **THB**, so deployed controls use THB. The
infrastructure target remains roughly USD 35–55/month at low use; exchange rates,
taxes and usage change the final invoice. Model charges are separate.

1. Project-scoped infrastructure budget: **THB 3,000/month**, with actual-spend
   alerts at 40/55/70/85% and a forecast threshold of 100%.
2. Authenticated budget messages pause new dynamic work at **THB 2,100** or a
   forecast alert. Fixed SQL/storage charges continue during this pause.
3. Native Cloud Run monthly spend cap: **THB 300**, verified through the Billing
   Budget API. Scripts refuse to silently lift an existing cap.
4. Cloud Run service and revision maxima are both one instance, minimum zero;
   eight pooled database connections, two model lanes and five visitor slots.
5. OpenRouter usage is charged to its existing account and recorded separately.
   The shared demo inference allowance defaults to USD 1/hour and USD 15 total;
   each organization also has its own limits. Unknown-cost failed attempts
   retain their conservative reservation.
6. No visible visitors means no new AI work and, after ten minutes, no tick task
   chain or simulation ticks. Landing visits and health probes do not renew
   presence. Cloud SQL remains running to avoid database wake-up delay.

Budgets, alerts and spend caps are not instantaneous invoice guarantees. The
conservative THB conversion leaves margin below the requested USD 100 ceiling.
Do not treat the monthly budget as a prepaid balance or an automatic SQL stop.

References: [Google spend cap API](https://docs.cloud.google.com/billing/docs/how-to/budget-api-spend-cap),
[spend cap limitations](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps),
[Cloud SQL pricing](https://cloud.google.com/sql/pricing).

## Safe deployment sequence after billing is ready

Run stages separately and inspect their outcomes:

    ./deploy/gcp/deploy.ps1 -Stage Safety
    ./deploy/gcp/deploy.ps1 -Stage Foundation
    ./deploy/gcp/deploy.ps1 -Stage Build -Tag VERIFIED_RELEASE
    ./deploy/gcp/deploy.ps1 -Stage Runtime -Tag VERIFIED_RELEASE

Safety creates alerts and the service spend cap before the continuously billed
SQL instance. Foundation creates the remaining infrastructure. Build uses
allowlisted sources in a dedicated private staging bucket; its service account
cannot read the Terraform-state bucket or database secrets. Runtime deploys the
reviewed image. Do not use mutable tags for later production updates: pin the
Artifact Registry image digest after its first successful build.

The state backend is a separate private GCS bucket. It contains generated database
and session secrets; treat access to it as administrative access. The deployment
scripts keep access tokens in process environment only and remove them afterward.
The application reads its OpenRouter key only from Secret Manager at runtime.
No key enters the cloud build, browser or Terraform source/state variables.
The attached service account also supports a future Vertex switch.

## Local simulator activation and preservation

render-simulator.py creates code-only ConfigMaps, a dedicated Kubernetes service
account, external-account federation config, an outbound-only workload and a
Deployment at ZERO replicas. It uses the public pinned Node image and installs
frozen dependencies, avoiding private-registry passwords on the local cluster.

    node deploy/gcp/prepare.mjs
    python3 deploy/gcp/render-simulator.py > .local/gcp/simulator.json
    kubectl --context kubernetes-admin@kubernetes apply --server-side --dry-run=server -f .local/gcp/simulator.json

Before activation:

1. Retain private paired backups of the current PostgreSQL database and simulator
   checkpoint/source credentials. Drain writers and pause the old demo first.
2. Stop the old combined demo Deployment. Confirm there is no second writer on
   demo-data. The new bridge reuses /data/demo/simulator, never a new random world.
3. Restore the matching platform database into Cloud SQL using the authenticated
   Cloud SQL connector/proxy. Never print dumps or credentials into logs.
4. Apply the prepared manifest, then scale gcp-simulator to one replica.
   Its DATA_DIR for bridge receipts is separate from the existing world directory.
5. Check federation, source identity, current simulated time and a harmless scoped
   read through the cloud API before enabling participant work.

Federation uses projected, rotating Kubernetes service-account tokens and the
cluster's public JWKS, bound only to system:serviceaccount:aidscaler:aidscaler-simulator.
No Google service-account private key is generated. Refresh the JWKS configuration
if the local cluster rotates its signing keys.

The retained large world currently has a 6 GiB simulator memory limit. Monitor
its working set before raising visitor limits; historical growth matters too.
The initial dependency install can take minutes during deployment/restart; visits
resume the already loaded world instead of re-running that installation.

The long-running world also exposed an unrelated SQLite retention scan in the
local transport. On the retained production queue, the indexed audience-prefix
query returned the same 187 eligible rows in 4.5 ms instead of 30.6 seconds.
It still waits for every audience subscriber, retains event-ID tombstones,
and preserves physical audit history. This is a single-query diagnostic, not
an application latency percentile or a new response-impact benchmark.

Continuous-demo checkpoints are persisted atomically by the simulator worker.
Only configuration, time and archive descriptors return to the HTTP host;
city-sized state is not repeatedly transferred through its request loop. The
full checkpoint and its physical replay remain intact. Deployment/recovery can
still take minutes for the retained historical world; this differs from waking
an already loaded, idle simulator.

## Live gates before publishing Hosting or changing DNS

- Real Pub/Sub round trip with actor identity and source-instance headers intact.
- Anonymous spectator can see only the public projection and cannot control time.
- Two isolated visitor sessions create distinct organizations.
- A real reviewed response is authorized, sent, received and shown in the same
  world; retrying the command cannot dispatch twice.
- Cross-organization resource ownership and separate partner approval still hold.
- A missing simulator gives a visible reconnecting state and never a fake receipt.
- A hidden tab, landing visitor, scraper and health probe cannot keep work awake.
- After ten idle minutes the clock and task chain stop; a returning viewer wakes
  the same world, without simulated catch-up or duplicate tasks.
- Capture cold-start and warm timings; target a usable landing under five seconds.
  Target a live demo resume in 2–10 seconds, to be measured rather than assumed.
- Confirm the active model is OpenRouter/Gemma, check paid-call receipts and
  preserve the optional Vertex smoke as compatibility evidence only.
- Verify real budget emails, the Cloud Run cap, and the authenticated preventive
  pause. Confirm Gemini charges do not trigger the infrastructure budget.
- Check CPU/RAM and SQL connections with 1, 2 and 5 participants before opening
  the five-slot demo. Do not raise limits based only on a mocked plan.

After the gates pass:

    ./deploy/gcp/deploy.ps1 -Stage Hosting

This publishes to the Firebase site first. Configure the custom domain, verify
its certificate and then move aidscaler.com DNS away from the existing tunnel.
Keep rollback records and the old database/world backups until migration is
confirmed. Do not run the old and new simulator writers against the same files.

## Known limits of this first cloud target

The demo has a single Cloud Run application instance and one local simulator;
brief maintenance downtime is accepted. The local simulator depends on local
power/internet. PostgreSQL stays running to avoid a database startup delay.
Media decoding dependencies are bundled in the image; the first real audio decode
may download the small ASR model. That does not block the landing page.

Visitors expire through the existing draining/retirement flow after thirty
minutes, preserving active trips, commitments, audit and completed contributions.
There is no destructive thirty-minute deletion of shared operational records.
