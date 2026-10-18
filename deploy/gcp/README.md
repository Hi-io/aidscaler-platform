# AidScaler on Google Cloud

[Product overview](../../README.md) · [Architecture](../../docs/ARCHITECTURE.md) · [Integrations](../../docs/INTEGRATIONS.md)

AidScaler's application, workspaces, API, operational database and evidence storage are deployed on Google Cloud. Gemini on Vertex AI is integrated with the platform's model and tool workflow.

## Service responsibilities

| Service                             | Responsibility                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| **Firebase Hosting**                | HTTPS web delivery, static assets and dynamic rewrites to Cloud Run.             |
| **Cloud Run**                       | Application gateway, organization workspaces, API and bounded agent processing.  |
| **Gemini on Vertex AI**             | Interpret signals, inspect image evidence and call scoped investigation tools.   |
| **Cloud SQL · PostgreSQL**          | Operational records, decisions, reservations, jobs, audit and execution history. |
| **Cloud Storage**                   | Private evidence bytes and build artifacts in separately scoped buckets.         |
| **Pub/Sub**                         | Asynchronous events and source command/response transport.                       |
| **Cloud Tasks**                     | Authenticated scheduled work, retries and separate operational/model queues.     |
| **IAM + Secret Manager**            | Service identities, scoped access and runtime secrets.                           |
| **Cloud Build + Artifact Registry** | Build containers and publish releases identified by immutable image digests.     |
| **Terraform**                       | Define resources, permissions, queues and infrastructure controls.               |

The external simulator supplies evaluation data through its own source adapter. Its hosting is independent of the platform deployment.

## Configure Gemini on Vertex AI

The [Cloud Run entry point](../../scripts/gcp-server.mjs) selects the Vertex adapter with:

```dotenv
MODEL_PROVIDER=vertex
MODEL_ID=gemini-3.8-flash
GOOGLE_CLOUD_PROJECT=<your-project-id>
```

The corresponding Terraform variables are `model_provider` and `model_id`. For a Gemini release, set these explicitly in the deployment environment:

```powershell
$env:TF_VAR_model_provider = 'vertex'
$env:TF_VAR_model_id = 'gemini-3.8-flash'
```

The adapter uses Application Default Credentials from the attached service identity, with the Vertex AI API enabled and the required model permissions. The Cloud Run factory sets the Vertex location to `global`.

[`src/vertex-provider.mjs`](../../src/vertex-provider.mjs) contains request/response conversion, function calling, media input and usage accounting. Its reviewed model catalog defines the supported model IDs. Provider configuration stays outside the frontend.

## Infrastructure and release files

| File                                             | Purpose                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| [`main.tf.json`](main.tf.json)                   | Cloud resources, IAM, runtime variables, queues, storage and budget controls. |
| [`Dockerfile`](Dockerfile)                       | Platform container with production dependencies and media processing.         |
| [`cloudbuild.json`](cloudbuild.json)             | Container build and publication.                                              |
| [`prepare.mjs`](prepare.mjs)                     | Allowlisted build/static staging with credential-pattern checks.              |
| [`deploy.ps1`](deploy.ps1)                       | Staged release orchestration for the maintained AidScaler deployment.         |
| [`publish-hosting.mjs`](publish-hosting.mjs)     | Firebase Hosting publication and rewrites.                                    |
| [`tests/demo.tftest.hcl`](tests/demo.tftest.hcl) | Terraform resource and configuration checks.                                  |

The release tooling includes the site's presentation assets and evaluation adapter. For a separately operated organization, configure its project, domain, service identities, source connections and resource policy in the infrastructure definition. Operational data and approval remain scoped to that organization.

## Release workflow

The maintained deployment separates preparation, infrastructure, application publication and Hosting into reviewable stages:

| Stage          | Result                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| **Check**      | Validate source checks, allowlisted artifacts and Terraform configuration.  |
| **Safety**     | Establish budget alerts and service spending controls.                      |
| **Foundation** | Provision the database, storage, queues and service identities.             |
| **Build**      | Build a versioned container and publish it to Artifact Registry.            |
| **Runtime**    | Resolve the reviewed image to its digest and deploy the Cloud Run revision. |
| **Hosting**    | Publish the web assets and application rewrites.                            |

[`deploy.ps1`](deploy.ps1) is configured for the maintained deployment's project and toolchain. Use its stage definitions together with Terraform variables when preparing another deployment.

For configuration validation with Terraform installed:

```sh
terraform -chdir=deploy/gcp init -backend=false
terraform -chdir=deploy/gcp validate
terraform -chdir=deploy/gcp test
```

Keep the Terraform state backend private. Build staging uses explicit source allowlists; runtime secrets are supplied through service identities or Secret Manager. Image digests identify the exact release used by Cloud Run.

## Runtime behavior

- **Durable work:** PostgreSQL retains jobs, reservations, proposal versions and operational history across worker turns.
- **Separate work queues:** operational updates and execution can progress while a model investigation is pending.
- **Controlled inference:** request concurrency, call limits, spending reservations and task scheduling bound model work.
- **Organization isolation:** sessions, API checks and scoped records keep each organization's decisions under its own control.
- **Evidence protection:** attachment access is checked through the application even when bytes live in Cloud Storage.
- **Idempotent execution:** repeat delivery of a task or command retains the original command identity.
- **Hosting sessions:** the gateway uses the reserved `__session` cookie for dynamic Firebase Hosting requests.

## Release verification

Verify the revision with a complete response: ingest a report, inspect Gemini's tool activity, review a proposal, authorize the owner's contribution and follow execution through receipt. Check a second organization to verify its separate resource authority and public projection.

The repository includes focused [Vertex adapter tests](../../tests/vertex-provider.test.mjs), [cloud task tests](../../tests/cloud-model-tasks.test.mjs), [operational scheduling tests](../../tests/cloud-operational-lanes.test.mjs) and [cross-organization ownership tests](../../tests/network-ownership.test.mjs).

For recovery, preserve the operational database, private evidence and the source connection identity together. Resume durable jobs from the matching checkpoint and verify current reservations before admitting new work.
