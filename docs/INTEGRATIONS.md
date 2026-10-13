# AidScaler integrations

AidScaler reads scoped sources, preserves evidence and prepares proposals for human review. Connecting a system does not grant authority to consume its resources.

## Simulation laboratory

Keep [disaster-response-simulator](https://github.com/Hi-io/disaster-response-simulator) beside the platform checkout. `pnpm lab` starts the source gateway and provisions separate agent and commander credentials for each organization.

The agent credential reads that organization's received information and submits proposals. Human review uses a separate credential. The observer has access to simulation truth and controls; never give its key or endpoints to the model.

See the simulator's [source and action API](https://github.com/Hi-io/disaster-response-simulator/blob/main/docs/API.md) for authentication, actions and receipt semantics.

## External sources

Operators can register a read-only JSON HTTP connector or a read-only MCP connection in Integrations. Record its purpose and permission or license, then inspect a read before enabling a polling interval. Each ingested version retains its source, time and access scope.

Credentials stay on the server. Set a dedicated environment variable named `AIDSCALER_CONNECTOR_<NAME>` and reference that variable in the connector form; do not paste the token into the UI. MCP registrations allow an explicit list of tool names and arguments.

URL and network checks restrict connector destinations. Redirects, untrusted attachment text and source instructions do not authorize new destinations or actions. Register only sources the organization is allowed to access.

## Read-only MCP endpoint

Each AidScaler instance exposes JSON-RPC at `POST /mcp`, using `Authorization: Bearer <dedicated-read-key>`. Configure `AIDSCALER_MCP_KEY` locally or use the generated server configuration. Do not publish this key.

The endpoint supports initialization, tool discovery and these read tools:

| Tool | Returns |
|---|---|
| `aidscaler_context` | The organization's received operational snapshot |
| `aidscaler_signals` | Up to 100 received source records |
| `aidscaler_evidence` | An accessible evidence record by ID |
| `aidscaler_responses` | Status of human-owned response proposals |

These tools cannot authorize a response or expose observer truth. Prefer tool discovery over hard-coded schemas when writing a client.

## Partner organizations

The local launcher provisions isolated stores and signed links between participating organizations. A partner shares selected capabilities or observations; inventory, reservations and approval remain under the owner's control. Revocations and newer versions invalidate stale assumptions.

Transport uses signed envelopes at `/api/network/inbox` with `X-AIDSCALER-From` and `X-AIDSCALER-Signature`. Provision shared keys out of band and keep them outside Git. A valid message is not a physical delivery receipt.

## Media

`pnpm setup:media` installs local transcription and document extraction dependencies. Images and sampled video frames use the configured model. The interface distinguishes processed evidence from unsupported or unprocessed parts; an attachment is never treated as a verified instruction.
