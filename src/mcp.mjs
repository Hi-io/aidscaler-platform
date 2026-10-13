import { check, AppError } from "./errors.mjs";
/** Scoped Streamable HTTP client. Server-supplied annotations never grant authority. */
export class McpConnector {
  constructor({
    url,
    token,
    allowedOrigin,
    allowedTools = [],
    fetcher = fetch,
  }) {
    check(
      new URL(url).origin === allowedOrigin,
      "MCP_ORIGIN",
      "Approve the exact MCP origin first.",
      403,
    );
    Object.assign(this, { url, token, allowedTools, fetcher });
    this.session = null;
    this.version = "2025-06-18";
    this.sequence = 0;
  }
  async request(method, params, notification = false) {
    const id = notification ? undefined : ++this.sequence;
    const r = await this.fetcher(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": this.version,
        ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    check(r.ok, "MCP_HTTP", `MCP returned HTTP ${r.status}.`, 502);
    if (notification) return null;
    if (r.headers.get("mcp-session-id"))
      this.session = r.headers.get("mcp-session-id");
    let message;
    if (r.headers.get("content-type")?.includes("event-stream")) {
      const text = await r.text();
      check(
        text.length < 2000000,
        "MCP_SIZE",
        "MCP response is too large.",
        413,
      );
      message = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => JSON.parse(l.slice(5)))
        .find((m) => m.id === id);
    } else message = await r.json();
    check(
      message?.id === id && !message.error,
      "MCP_RPC",
      "MCP request failed or returned a different response ID.",
      502,
    );
    return message.result;
  }
  async connect() {
    const r = await this.request("initialize", {
      protocolVersion: this.version,
      capabilities: {},
      clientInfo: { name: "aidscaler-scoped-client", version: "0.1.0" },
    });
    this.version = r.protocolVersion;
    await this.request("notifications/initialized", {}, true);
    return this.request("tools/list", {});
  }
  async call(name, args) {
    check(
      this.allowedTools.includes(name),
      "MCP_SCOPE",
      "This MCP tool is not explicitly permitted.",
      403,
    );
    return this.request("tools/call", { name, arguments: args });
  }
  async close() {
    if (this.session)
      await this.fetcher(this.url, {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
        redirect: "error",
        headers: {
          "Mcp-Session-Id": this.session,
          "MCP-Protocol-Version": this.version,
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });
  }
}
