import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {spawnLabChild,stopLabChildren,installLauncherControl} from './lab-lifecycle.mjs';
import {captureLab} from './resume-lab.mjs';
import {laboratoryConfig,existingLabPassword} from './lab-config.mjs';
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  simRoot = path.resolve(root, "../disaster-response-simulator");
const { createLabServers } = await import(
  pathToFileURL(path.join(simRoot, "sources/server.mjs")).href
);
const initialRate = Number(process.env.AIDSCALER_LAB_RATE ?? 10);
if (!Number.isFinite(initialRate) || initialRate <= 0 || initialRate > 1000)
  throw Error("AIDSCALER_LAB_RATE must be greater than zero and at most 1000.");
// A reset world must not inherit stale physical operations/source versions from
// an earlier run. Preserve each prior database under its own private session.
const sessionId =
  new Date().toISOString().replace(/[:.]/g, "-") +
  "-" +
  randomBytes(3).toString("hex");
const lab = await createLabServers({
  isolated: true,
  observerPort: Number(process.env.LAB_OBSERVER_PORT ?? 4328),
  sourcePort: Number(process.env.LAB_SOURCE_PORT ?? 4329),
  config: laboratoryConfig(),
  storageDir: path.join(root, ".local", "labs", sessionId, "transport"),
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
  // One-time source discovery for a fresh lab. These are ordinary scoped read
  // actions, not observer facts. Replies arrive when the initial clock advances.
  for (const target of ["inventory", "vehicles", "map", "policy"]) {
    const discovery = await fetch(
      `http://127.0.0.1:${lab.sourcePort}/api/actor/action`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agentKey}`,
        },
        body: JSON.stringify({
          type: "query",
          params: { target },
          idempotencyKey: `bootstrap-${sessionId}-${org}-${target}`,
        }),
      },
    );
    if (!discovery.ok) throw Error("Initial scoped source discovery failed.");
  }
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
        id: `aidscaler-operator-${org}`,
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
    autoInvestigate: process.env.AIDSCALER_AUTO_INVESTIGATE !== "false",
    autoDiscover: true,
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
  const bootstrapPassword = await existingLabPassword(root, org);
  const child = spawnLabChild({rootDir:root,instanceDir,org,port:4400+i,bootstrapPassword});
  children.push(child);
  child.stdout.on("data", (d) => process.stdout.write(`[${org}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${org}] ${d}`));
  child.on("exit", (code) => {
    if (code) console.error(`${org} exited (${code}).`);
  });
}
await lab.advance(45000);
await fetch(`http://127.0.0.1:${lab.observerPort}/api/control`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${lab.observerKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ play: true, rate: initialRate }),
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
  `Laboratory observer: http://127.0.0.1:${lab.observerPort}\nFour isolated AidScaler instances: http://127.0.0.1:4400–4403\nIndependent contractor bridge (no model): http://127.0.0.1:4404\nRole credentials are saved under ignored .local/access-org*.json; contractor in .local/access-partner-org4.json.\nUse the observer only for controlling and evaluating the world, never inside AidScaler.`,
);
let shutdownPromise=null;
function shutdownLab(){
  if(shutdownPromise)return shutdownPromise;
  shutdownPromise=(async()=>{
    const response=await fetch(`http://127.0.0.1:${lab.observerPort}/api/state`,{headers:{Authorization:`Bearer ${lab.observerKey}`}}),before=await response.json();
    await fetch(`http://127.0.0.1:${lab.observerPort}/api/control`,{method:'POST',headers:{Authorization:`Bearer ${lab.observerKey}`,'Content-Type':'application/json'},body:JSON.stringify({play:false})});
    await stopLabChildren(children);
    const captured=await captureLab({rootDir:root,resumeControl:before});
    await lab.close();return captured;
  })().catch(error=>{shutdownPromise=null;throw error;});
  return shutdownPromise;
}
const launcherControl=await installLauncherControl({rootDir:root,onShutdown:shutdownLab,onStopped:()=>process.exit(0)});
console.log('For a coordinated Windows-safe shutdown use: pnpm lab:resume --shutdown');
for (const s of ["SIGINT", "SIGTERM"])
  process.once(s, async () => {
    try{await shutdownLab();await launcherControl.close();process.exit(0);}
    catch{console.error('Coordinated shutdown did not complete. No final snapshot is claimed; use the private launcher control.');}
  });
