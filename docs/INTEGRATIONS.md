# Connect AidScaler to your response network

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Development](LOCAL.md)

AidScaler combines public information with the systems and resources response teams already use. Every connection has a defined purpose, scope and owner. Sources retain their origin as information moves into an investigation or response.

## Public information and operational systems

Operators can register a **read-only JSON HTTP connector** or a **read-only MCP connection** in Integrations. These connections bring authorized public reports, news, inventories and other operational records into the workspace.

1. Register the source and describe its purpose and access permission.
2. Reference a server-side credential when the source requires authentication.
3. Inspect a read and confirm the returned records.
4. Enable a polling interval.
5. Follow ingestion, source versions and evidence in the workspace.

Use a dedicated environment variable named `AIDSCALER_CONNECTOR_<NAME>` and reference its name in the connector form. MCP connections allow an explicit list of tool names and arguments. Source content is processed as evidence; it does not grant additional permissions.

The [integration registry](../src/integrations.mjs) enforces access scope and destination checks. The [ingestion layer](../src/ingestion.mjs) preserves source versions for downstream investigation.

## Multimodal evidence

Text reports, images, voice notes, documents and video frames can contribute to a case. Media processing prepares transcripts, extracted text or image evidence for the configured model. Evidence links preserve the relationship between the original attachment, its processed content and the resulting findings.

The development guide includes [media setup](LOCAL.md#media-processing). In the cloud deployment, media dependencies are included in the [application container](../deploy/gcp/Dockerfile).

## Partner organizations

The [network layer](../src/network.mjs) exchanges selected observations, capabilities, proposals and commitments. A partner can offer supplies or transport while keeping inventory, reservations and approvals under its own authority.

Messages use signed envelopes at `/api/network/inbox`, with `X-AIDSCALER-From` and `X-AIDSCALER-Signature` headers. Provision shared keys outside the repository. Version changes and revocations propagate into dependent response checks.

This makes complementary resources usable together: a shared response can reference different organizations while each approves its own contribution and follows its completion.

## AidScaler's read-only MCP endpoint

Each instance exposes JSON-RPC at `POST /mcp`, authenticated with `Authorization: Bearer <dedicated-read-key>`. Configure `AIDSCALER_MCP_KEY` in the runtime environment.

| Tool                  | Returns                                           |
| --------------------- | ------------------------------------------------- |
| `aidscaler_context`   | The organization's received operational snapshot. |
| `aidscaler_signals`   | Up to 100 received source records.                |
| `aidscaler_evidence`  | An accessible evidence record by ID.              |
| `aidscaler_responses` | Status of human-owned response proposals.         |

Use tool discovery for the current schemas. These read tools let other systems consume scoped operational context; authorization remains in the resource owner's workflow.

## Community and field input

Communities can submit reports through an organization-owned page and return with a private tracking key for follow-up. Operators review submissions and connect them to operational cases.

Field teams use assigned tasks to report progress, upload evidence and confirm delivery. Offline reports retain command identity and organization ownership when synchronized.

## Evaluation source

The separate [disaster-response simulator](https://github.com/Hi-io/disaster-response-simulator) provides reproducible source feeds and physical outcomes for evaluation. Its connector uses separate credentials for the organization's received information and human-authorized actions.

The platform consumes published sources and scoped operational queries. Observer access belongs to the evaluator. See [measurement design](BENCHMARK.md) and [laboratory setup](LOCAL.md).
