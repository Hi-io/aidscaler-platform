import { mkdir, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const platform = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workspace = path.dirname(platform), stage = path.join(platform, '.local/gcp/stage');
const forbidden = /sk-or-v1-[a-f0-9]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"type"\s*:\s*"service_account"/;
async function copy(relative, root, target) {
  const source = path.join(root, relative), dest = path.join(target, relative);
  await mkdir(path.dirname(dest), { recursive: true }); await cp(source, dest, { recursive: true });
}
export async function prepare() {
  await mkdir(stage, { recursive: true });
  // Explicit allowlists exclude credentials, experiments, state and databases.
  for (const relative of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'requirements-media.txt',
    'server.mjs', 'src', 'ui', 'scripts/gcp-server.mjs', 'scripts/media_worker.py'])
    await copy(relative, platform, path.join(stage, 'platform'));
  const simulator = path.join(workspace, 'disaster-response-simulator');
  for (const relative of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'engine', 'contracts', 'content',
    'adapters', 'evaluation', 'generators', 'manifests', 'scenarios', 'sources', 'viewer',
    'scripts/demo-host.mjs', 'scripts/demo-storage.mjs', 'scripts/gcp-bridge.mjs'])
    await copy(relative, simulator, path.join(stage, 'simulator'));
  // Mirror the runtime's sibling contract location for local staged-import
  // checks. Docker copies these same bytes from simulator/sources below.
  await copy('sources/cloud-wire.mjs', simulator, path.join(stage, 'disaster-response-simulator'));
  const viewer = path.join(stage, 'viewer'); await mkdir(viewer, { recursive: true });
  for (const file of ['spectator-map.mjs', 'spectator-activity.mjs', 'motion.js', 'geometry.js'])
    await cp(path.join(simulator, 'ui', file), path.join(viewer, file)).catch(async error => {
      if (error.code !== 'ENOENT') throw error;
      await cp(path.join(simulator, 'viewer', file), path.join(viewer, file));
    });
  for (const file of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/controls/OrbitControls.js', 'examples/jsm/utils/BufferGeometryUtils.js']) {
    const dest = path.join(viewer, 'vendor', file); await mkdir(path.dirname(dest), { recursive: true });
    await cp(path.join(simulator, 'node_modules/three', file), dest);
  }
  for (const name of ['Dockerfile', 'Dockerfile.simulator', 'cloudbuild.json']) await cp(new URL(name, import.meta.url), path.join(stage, name));
  const hosting = path.join(platform, '.local/gcp/hosting');
  await cp(path.join(workspace, 'nexo-vision/dist'), hosting, { recursive: true });
  await cp(viewer, path.join(hosting, 'demo/viewer'), { recursive: true });
  const totals = { files: 0, rawBytes: 0, gzipBytes: 0 };
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else {
        if (/(\.env|\.key|\.pem|\.tfstate|credentials|bootstrap\.json)/i.test(entry.name)) throw Error('Unexpected sensitive filename in staged build.');
        const bytes = await readFile(file);
        if (bytes.length < 16 * 1024 * 1024 && forbidden.test(bytes.toString())) throw Error('Secret pattern detected in staged build.');
        totals.files++; totals.rawBytes += bytes.length; totals.gzipBytes += gzipSync(bytes).length;
      }
    }
  }
  await inspect(stage); await inspect(hosting);
  await writeFile(path.join(platform, '.local/gcp/prepared.json'), JSON.stringify({
    project: 'aidscaler', projectNumber: '439219992256',
    preparedAt: new Date().toISOString(), ...totals, secretsChecked: true }, null, 2));
  console.log(JSON.stringify({ stage, hosting, ...totals, secretsChecked: true }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepare();
