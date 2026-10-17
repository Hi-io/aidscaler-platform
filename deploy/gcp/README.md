# AidScaler demo on Google Cloud

Preparation date: 18 October 2026. This directory prepares the hybrid demo;
it does not automatically publish or migrate the current Kubernetes demo.

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

## Current verification boundary

The GCP project exists and interactive gcloud authentication was checked.
Billing is not enabled at preparation time. Terraform validation and mocked plan
tests, local bridge/provider tests and Kubernetes server-side dry runs can run
without creating paid resources. No real Cloud Run, Cloud SQL, Pub/Sub, Vertex,
Firebase Hosting release or live cloud latency claim has been verified yet.

Cloud image builds and live integration checks are deployment gates after billing
is available. Do not describe a mocked Terraform plan as a real provider apply.

## Local tools and configuration

The current Windows workstation uses Google Cloud CLI in WSL Ubuntu and a portable
Terraform CLI in the parent workspace's .local/tools directory. deploy.ps1 reads
the private alert recipient from .local/gcp/settings.json. That file, OAuth
credentials, Terraform state, plans and backend settings are excluded from Git.

    ./deploy/gcp/deploy.ps1 -Stage Check

The Check stage prepares allowlisted build/static artifacts, scans them for
credential patterns, validates Terraform, runs a fully mocked Terraform plan,
and reads project/billing status. It does not enable APIs or create resources.

Terraform dependencies are pinned in .terraform.lock.hcl. Runtime dependencies
use the repositories' frozen pnpm lockfiles. Re-run prepare after source changes.

## Budget protection

Amounts are USD before taxes. Gemini/Vertex usage is deliberately outside the
infrastructure budget and is recorded separately.

1. Target infrastructure consumption: approximately USD 35–55/month at low use.
   SQL compute is USD 25.20 for 720 hours, plus SSD and backup storage.
2. Infrastructure budget: USD 100, filtered to the service IDs used by this stack.
   Alerts at USD 40/55/70/85 and a forecast of USD 100. The service IDs were
   checked against Google's public billing catalogue.
3. A native Cloud Run monthly spend cap of USD 10 is created through the Billing
   Budget API, because the pinned Terraform provider does not expose spendCap.
   The script verifies an existing cap and refuses to silently lift one.
4. Authenticated budget messages pause new dynamic work at USD 70 infrastructure
   spend or when the forecast alert fires. The remaining margin covers continuing
   SQL/storage charges. Current in-flight requests may finish.
5. Cloud Run has maximum one instance; the database has eight pooled connections;
   model work has at most two lanes; pending Cloud Tasks are bounded.
6. No visible visitors means no new AI work, no ingestion/tick task chain, and no
   simulation ticks. Landing visits and health probes do not renew demo presence.

Budgets and spend caps are not instantaneous invoice guarantees. Storage and
fixed costs continue while processing is suspended. Keep a margin below USD 100.
If the billing account uses a currency other than USD, deployment stops before
resource creation until the budget amounts have been converted and reviewed.

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
The application uses an attached service account for Vertex; no OpenRouter key
is needed in the cloud build, browser or Terraform configuration.

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

The initial dependency install can take minutes during deployment/restart; visits
resume the already loaded world instead of re-running that installation.

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
- Run a small real Vertex tool-call sequence, check usage including thinking
  tokens, and compare required outcomes with the existing Gemma evidence.
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
