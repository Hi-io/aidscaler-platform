import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from '../src/store.mjs';
import { createDemoSource } from '../src/demo-source.mjs';
import { createDemoGateway } from '../src/demo-gateway.mjs';
import { archiveDemoBaseResponse } from '../src/demo-response-archive.mjs';

const root = path.dirname(fileURLToPath(new URL('../server.mjs', import.meta.url)));
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, '.local', 'demo'));
await mkdir(dataDir, { recursive: true });
process.env.AIDSCALER_LOCAL_DIR ??= path.join(dataDir, 'config');
if (!process.env.DEMO_SESSION_SECRET || process.env.DEMO_SESSION_SECRET.length < 32)
  throw Error('Set a persistent DEMO_SESSION_SECRET with at least 32 characters.');
const { startDemoHost } = await import(pathToFileURL(path.resolve(root, '../disaster-response-simulator/scripts/demo-host.mjs')).href);
const world = await startDemoHost({ dataDir: path.join(dataDir, 'simulator'),
  observerPort: Number(process.env.DEMO_OBSERVER_PORT ?? 4318), sourcePort: Number(process.env.DEMO_SOURCE_PORT ?? 4319),
  allowDemoBuildUpgrade: process.env.DEMO_ALLOW_BUILD_UPGRADE === 'true', rate: Number(process.env.DEMO_RATE ?? 10),
  allowOperationalDemoUpgrade: process.env.DEMO_MIGRATE_OPERATIONAL_CONFIG === 'true',
  director: { enabled: true, intervalMs: 300000, maxOpen: 8, maxActive: Number(process.env.DEMO_MAX_ACTIVE ?? 4) } });
let store, gateway;
try {
  store = await Store.open({ databaseUrl: process.env.DATABASE_URL, dataDir: path.join(dataDir, 'database') });
  const source = createDemoSource(world.credentials), bootstrap = await source.request('/api/demo/bootstrap');
  source.healthCheck = () => { if (world.persistenceError) throw Object.assign(Error('The simulation is paused while durable storage recovers.'), { status: 503, code: 'DEMO_STORAGE' }); };
  source.baseOrganizations = bootstrap.frame.organizations.filter(o => !o.demoVisitor);
  // Explicit, private one-time recovery. This runs before there are platform
  // writers or public admission. Fenced visitor workspaces remain read-only.
  if (process.env.DEMO_ARCHIVE_FENCED_BASES === 'true') {
    for (const base of source.baseOrganizations) await archiveDemoBaseResponse({ store, enabled: true, workersStopped: true,
      organization: base.id, frame: bootstrap.frame });
  }
  gateway = await createDemoGateway({ store, source, dataDir, secret: process.env.DEMO_SESSION_SECRET,
    host: process.env.DEMO_HOST ?? '0.0.0.0', port: Number(process.env.DEMO_PORT ?? 8080),
    origin: process.env.DEMO_ORIGIN ?? 'http://127.0.0.1:8080', maxActive: Number(process.env.DEMO_MAX_ACTIVE ?? 4),
    maxTeamsTotal: Number(process.env.DEMO_MAX_TEAMS_TOTAL ?? 100),
    maxSignalsPerTeam: Number(process.env.DEMO_MAX_SIGNALS_PER_TEAM ?? 5000),
    model: { hourlyUsd: Number(process.env.DEMO_MODEL_HOURLY_USD ?? 1), totalUsd: Number(process.env.DEMO_MODEL_TOTAL_USD ?? 15),
      concurrency: Number(process.env.DEMO_MODEL_CONCURRENCY ?? 2) } });
} catch (error) { await gateway?.close(); await store?.close(); await world.close(); throw error; }
let stopping;
async function shutdown() {
  if (stopping) return stopping;
  stopping = (async () => {
    // Close every operational writer before the final physical checkpoint. Do
    // not pair a new database with an old simulation or silently reset a world.
    await gateway.close(); await world.close(); await store.close();
  })();
  return stopping;
}
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => shutdown().then(() => process.exit(0), () => process.exit(1)));
console.log(`AidScaler connected demo is ready on port ${gateway.server.address().port}; simulator controls remain private.`);
