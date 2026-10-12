import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  simRoot = path.resolve(root, "../disaster-response-simulator");
const { createLabServers } = await import(
  pathToFileURL(path.join(simRoot, "sources/server.mjs")).href
);
const scenario = process.env.NEXO_SCENARIO ?? "S01";
// A reset world must not inherit stale physical operations/source versions from
// an earlier run. Preserve each prior database under its own private session.
const sessionId =
  new Date().toISOString().replace(/[:.]/g, "-") +
  "-" +
  randomBytes(3).toString("hex");
const lab = await createLabServers({
  observerPort: Number(process.env.LAB_OBSERVER_PORT ?? 4328),
  sourcePort: Number(process.env.LAB_SOURCE_PORT ?? 4329),
  config: {
    scenario,
    organizations: 5,
    seed: process.env.NEXO_SEED ?? "nexo-development-001",
    grid: 9,
    extentKm: 12,
    topology: "grid",
    hazard: process.env.NEXO_HAZARD ?? "none",
    durationMs: 21600000,
    policy: "none",
    mode: "modeled",
    clockLatency: "modeled",
    postsPerHour: 240,
    backgroundTraffic: 30,
    packetLoss: 0,
    observationRate: 1,
    sourceRequestLimit: 5000,
  },
});
const configs = [],
  children = [],
  links = new Map();
for (let a = 0; a < 5; a++)
  for (let b = a + 1; b < 5; b++)
    links.set(`${a}-${b}`, randomBytes(32).toString("hex"));
for (let i = 0; i < 5; i++) {
  const org = `org${i}`,
    agentKey = Object.entries(lab.actorKeys).find(
      ([, a]) => a.org === org && a.role === "agent",
    )?.[0];
  const res = await fetch(
    `http://127.0.0.1:${lab.observerPort}/api/actors/provision`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lab.observerKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        org,
        role: "commander",
        id: `nexo-operator-${org}`,
        ttlMs: 604800000,
      }),
    },
  );
  if (!res.ok) throw new Error("Could not provision a scoped operator.");
  const { key: humanKey } = await res.json();
  const instanceDir = path.join(root, ".local", "labs", sessionId, org);
  await mkdir(instanceDir, { recursive: true });
  const config = {
    org,
    orgName: [
      "Relief North",
      "Community East",
      "Rescue South",
      "Medical West",
      "Independent contractor",
    ][i],
    port: 4400 + i,
    sourceUrl: `http://127.0.0.1:${lab.sourcePort}`,
    sourceAgentKey: agentKey,
    sourceHumanKey: humanKey,
    autoIngest: true,
    autoInvestigate: false,
    pollMs: 6000,
    peers: Array.from({ length: 5 }, (_, j) => j)
      .filter((j) => j !== i)
      .map((j) => ({
        org: `org${j}`,
        url: `http://127.0.0.1:${4400 + j}`,
        key: links.get(`${Math.min(i, j)}-${Math.max(i, j)}`),
      })),
  };
  await writeFile(
    path.join(instanceDir, "bootstrap.json"),
    JSON.stringify(config, null, 2),
    { mode: 0o600 },
  );
  configs.push({ org, url: `http://127.0.0.1:${4400 + i}` });
  const child = spawn(
    process.execPath,
    [
      "--env-file-if-exists=.env.local",
      i === 4 ? "scripts/partner.mjs" : "server.mjs",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        NEXO_LOCAL_DIR: instanceDir,
        NEXO_ORG: org,
        PORT: String(4400 + i),
        DATA_DIR: path.join(instanceDir, "pgdata"),
        EVIDENCE_DIR: path.join(instanceDir, "evidence"),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);
  child.stdout.on("data", (d) => process.stdout.write(`[${org}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${org}] ${d}`));
  child.on("exit", (code) => {
    if (code) console.error(`${org} exited (${code}).`);
  });
}
lab.world.advance(45000);
await fetch(`http://127.0.0.1:${lab.observerPort}/api/control`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${lab.observerKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ play: true, rate: 100 }),
});
await writeFile(
  path.join(root, ".local", "lab.json"),
  JSON.stringify(
    {
      sessionId,
      observerUrl: `http://127.0.0.1:${lab.observerPort}`,
      observerKey: lab.observerKey,
      sourceUrl: `http://127.0.0.1:${lab.sourcePort}`,
      instances: configs,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  `Laboratory observer: http://127.0.0.1:${lab.observerPort}\nFour isolated NEXO instances: http://127.0.0.1:4400–4403\nIndependent contractor bridge (no model): http://127.0.0.1:4404\nRole credentials are saved under ignored .local/access-org*.json; contractor in .local/access-partner-org4.json.\nUse the observer only for controlling and evaluating the world, never inside NEXO.`,
);
for (const s of ["SIGINT", "SIGTERM"])
  process.on(s, async () => {
    for (const c of children) c.kill();
    await lab.close();
    process.exit(0);
  });
