import { configuration } from "../src/config.mjs";
import { SimulatorConnector } from "../src/connector.mjs";
import { createExternalGateway } from "../src/external-gateway.mjs";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const config = await configuration(),
  accessFile = new URL(
    `../.local/access-partner-${config.org}.json`,
    import.meta.url,
  );
let access;
try {
  access = JSON.parse(await readFile(accessFile, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  access = {
    email: `owner@${config.org}.partner.local`,
    password: randomBytes(24).toString("base64url"),
  };
  await writeFile(accessFile, JSON.stringify(access, null, 2), { mode: 0o600 });
}
const connector = new SimulatorConnector(config),
  gateway = await createExternalGateway({
    ...config,
    connector,
    bootstrapPassword: access.password,
    startWorker: true,
  });
for (const target of ["inventory", "vehicles", "map"])
  await connector.action("query", { target }, "partner-bootstrap-" + target);
await gateway.observe();
console.log(
  `Independent contractor bridge: ${gateway.url}. Local credentials are in the ignored access file. No model is installed in this bridge.`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await gateway.close();
    process.exit(0);
  });
