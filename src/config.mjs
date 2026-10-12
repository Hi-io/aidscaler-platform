import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
export async function configuration(overrides = {}) {
  const dir = path.resolve(process.env.NEXO_LOCAL_DIR ?? ".local");
  await mkdir(dir, { recursive: true });
  let local = {};
  try {
    local = JSON.parse(
      await readFile(path.join(dir, "bootstrap.json"), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let secret;
  try {
    secret = (await readFile(path.join(dir, "server.key"), "utf8")).trim();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    secret = randomBytes(32).toString("hex");
    await writeFile(path.join(dir, "server.key"), secret, { mode: 0o600 });
  }
  return {
    port: Number(process.env.PORT ?? 4400),
    host: "127.0.0.1",
    org: process.env.NEXO_ORG ?? "org0",
    orgName: "Relief North",
    dataDir: process.env.DATA_DIR ?? path.join(dir, "pgdata"),
    databaseUrl: process.env.DATABASE_URL,
    evidenceDir: process.env.EVIDENCE_DIR ?? path.join(dir, "evidence"),
    secret,
    mcpReadKey:
      process.env.NEXO_MCP_KEY ??
      createHash("sha256")
        .update(secret + ":read-only-mcp")
        .digest("hex"),
    modelId: process.env.MODEL_ID ?? "google/gemma-4-31b-it",
    provider: process.env.MODEL_PROVIDER ?? "openrouter",
    apiKey: process.env.OPENROUTER_API_KEY,
    modelTimeoutMs: Number(process.env.MODEL_TIMEOUT_MS ?? 120000),
    modelMaxOutputTokens: Number(process.env.MODEL_MAX_OUTPUT_TOKENS ?? 8192),
    modelReasoning: process.env.MODEL_REASONING !== "false",
    modelProviderSort: process.env.MODEL_PROVIDER_SORT ?? "latency",
    modelPriceMultiplier: Number(process.env.MODEL_PRICE_MULTIPLIER ?? 2),
    budgetUsd: Number(process.env.MODEL_EPISODE_BUDGET_USD ?? 2),
    maxCalls: Number(process.env.MODEL_MAX_CALLS ?? 8),
    sourceUrl: process.env.SOURCE_URL ?? "http://127.0.0.1:4319",
    sourceAgentKey: process.env.SOURCE_AGENT_KEY,
    sourceHumanKey: process.env.SOURCE_HUMAN_KEY,
    bootstrapPassword: process.env.NEXO_BOOTSTRAP_PASSWORD,
    peers: [],
    pollMs: 5000,
    autoIngest: true,
    autoInvestigate: false,
    hourlyCallLimit: Number(process.env.MODEL_HOURLY_CALL_LIMIT ?? 40),
    hourlyBudgetUsd: Number(process.env.MODEL_HOURLY_BUDGET_USD ?? 2),
    investigationTimeoutMs: Number(
      process.env.INVESTIGATION_TIMEOUT_MS ?? 360000,
    ),
    ...local,
    ...overrides,
  };
}
