import { check } from "./errors.mjs";
import { resolveEvidence } from "./citations.mjs";
export const mcpTools = [
  {
    name: "aidscaler_context",
    description:
      "Read this organization’s received operational snapshot. No observer truth or credentials.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "aidscaler_signals",
    description: "Read up to 100 received source records.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  {
    name: "aidscaler_evidence",
    description: "Read one accessible evidence record.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "aidscaler_responses",
    description:
      "Read the status of human-owned response proposals. Cannot authorize.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];
export async function handleMcp(store, org, request) {
  check(request.jsonrpc === "2.0", "MCP_RPC", "JSON-RPC 2.0 required.");
  const { id, method, params = {} } = request;
  if (method === "notifications/initialized") return null;
  let result;
  if (method === "initialize")
    result = {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "aidscaler-read-only", version: "0.1.0" },
    };
  else if (method === "tools/list") result = { tools: mcpTools };
  else if (method === "tools/call") {
    check(
      mcpTools.some((t) => t.name === params.name),
      "MCP_SCOPE",
      "This endpoint exposes read tools only.",
      403,
    );
    let data;
    const args = params.arguments ?? {};
    if (params.name === "aidscaler_context")
      data =
        (await store.get(org, "context", "operational", false))?.snapshot ??
        null;
    if (params.name === "aidscaler_signals")
      data = await store.list(
        org,
        "signal",
        Math.max(1, Math.min(100, Number(args.limit ?? 30))),
      );
    if (params.name === "aidscaler_evidence")
      data = await resolveEvidence(store, org, args.id);
    if (params.name === "aidscaler_responses")
      data = await store.list(org, "proposal", 100);
    result = {
      content: [{ type: "text", text: JSON.stringify(data) }],
      isError: false,
    };
  } else check(false, "MCP_METHOD", "Unsupported MCP method.", 405);
  return { jsonrpc: "2.0", id, result };
}
