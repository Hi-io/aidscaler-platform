import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { spawnLabChild, stopLabChildren, installLauncherControl, requestLauncherShutdown } from './lab-lifecycle.mjs';

const defaultRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const parse = async file => JSON.parse(await readFile(file, 'utf8'));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex');
const privateJSON = (file, value, flag = 'wx') => writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600, flag });
const within = (parent, file) => {
  const result = path.resolve(parent, file), rel = path.relative(parent, result);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw Error('Resume path leaves its existing laboratory session.');
  return result;
};
const localURL = value => {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== '/')
    throw Error('Resume requires a localhost laboratory URL with an explicit port.');
  return url;
};
async function session(rootDir) {
  const current = await parse(path.join(rootDir, '.local', 'lab.json'));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(current.sessionId) || !current.observerKey || !Array.isArray(current.instances) || current.instances.length !== 5)
    throw Error('The existing laboratory session is incomplete. No new world or database will be created.');
  localURL(current.observerUrl); localURL(current.sourceUrl);
  const directory = within(path.join(rootDir, '.local', 'labs'), current.sessionId);
  const instances = [];
  for (const item of current.instances) {
    if (!/^org[0-4]$/.test(item.org)) throw Error('Unexpected laboratory organization.');
    const dir = within(directory, item.org), config = await parse(path.join(dir, 'bootstrap.json'));
    if (config.org !== item.org || config.sourceUrl !== current.sourceUrl || Number(localURL(item.url).port) !== Number(config.port))
      throw Error('Existing bootstrap configuration does not match the saved session.');
    // Refuse to bootstrap empty databases, accounts or a new cookie-signing key.
    await stat(path.join(dir, 'pgdata', 'PG_VERSION'));
    await stat(path.join(dir, 'server.key'));
    instances.push({ ...item, dir, config });
  }
  if (new Set(instances.map(i => i.org)).size !== 5) throw Error('Laboratory organizations are duplicated.');
  return { current, directory, instances };
}
async function observerJSON(current, endpoint, data, fetcher = fetch) {
  const response = await fetcher(current.observerUrl + endpoint, {
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
    headers: { Authorization: `Bearer ${current.observerKey}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Error(`Laboratory ${endpoint} returned HTTP ${response.status}.`);
  return response.json();
}
function archiveIdentity(value) {
  if (!value?.archive) return value;
  const db = new DatabaseSync(value.file, { readOnly: true });
  try {
    const digest = createHash('sha256'); let count = 0;
    for (const row of db.prepare('SELECT value FROM records ORDER BY idx').iterate()) {
      digest.update(JSON.stringify(canonical(JSON.parse(row.value))) + '\n'); count++;
    }
    if (count !== value.length) throw Error('A checkpoint archive has an inconsistent record count.');
    return { archive: true, kind: value.kind, length: count, sha256: digest.digest('hex') };
  } finally { db.close(); }
}
function independentlyCountPublicPosts(posts) {
  const published = post => post.public?.publishedAt != null && post.private?.audience === 'public';
  if (Array.isArray(posts)) return posts.reduce((count, post) => count + (published(post) ? 1 : 0), 0);
  if (!posts?.archive) throw Error('Missing publication history; the demo publication counter cannot be reconstructed.');
  const db = new DatabaseSync(posts.file, { readOnly: true });
  try {
    let count = 0;
    // Do not filter by deletion or indexing. Removed public publications still
    // happened; private and not-yet-published rows never count as public volume.
    for (const row of db.prepare('SELECT value FROM records ORDER BY idx').iterate())
      if (published(JSON.parse(row.value))) count++;
    return count;
  } finally { db.close(); }
}
export function checkpointIdentity(checkpoint) {
  const value = structuredClone(checkpoint);
  delete value.manifest;
  if (value.state) for (const key of ['posts', 'messages']) value.state[key] = archiveIdentity(value.state[key]);
  value.log = archiveIdentity(value.log);
  // Includes physical state, idempotency ledger, counters/keyed-draw inputs,
  // event queue, clock, event count and run identity. Archive paths may change.
  return hash(value);
}
async function relocateArchives(checkpoint, dir) {
  const targets = [['posts', checkpoint.state?.posts], ['messages', checkpoint.state?.messages], ['events', checkpoint.log]];
  for (const [name, value] of targets) {
    if (!value?.archive) continue;
    const file = path.join(dir, name + '.sqlite');
    await copyFile(value.file, file);
    value.file = file;
  }
}
export async function captureLab({ rootDir = defaultRoot, fetcher = fetch, resumeControl = null } = {}) {
  const saved = await session(rootDir), { current, directory } = saved,
    before = await observerJSON(current, '/api/state', undefined, fetcher);
  // Stop clock advancement before capturing. Existing launcher must then be
  // stopped promptly; it owns the only remaining source-writing processes.
  await observerJSON(current, '/api/control', { play: false }, fetcher);
  const checkpoint = await observerJSON(current, '/api/checkpoint', undefined, fetcher),
    credentials = await observerJSON(current, '/api/credentials', undefined, fetcher);
  if (!checkpoint.manifest?.config || !checkpoint.runId || !checkpoint.state || !Array.isArray(checkpoint.queue) ||
      !credentials.actors || credentials.sourceUrl !== current.sourceUrl)
    throw Error('The live laboratory did not return a complete matching checkpoint.');
  for (const item of saved.instances) {
    if (credentials.actors[item.config.sourceAgentKey]?.org !== item.org || credentials.actors[item.config.sourceHumanKey]?.org !== item.org)
      throw Error('The live actor credentials do not match the existing platform bootstrap.');
  }
  const dir = path.join(directory, 'resume', stamp());
  await mkdir(path.dirname(dir), { recursive: true });
  await mkdir(dir);
  await relocateArchives(checkpoint, dir);
  const identity = checkpointIdentity(checkpoint), bundle = {
    format: 'aidscaler-lab-resume-v1', sessionId: current.sessionId, capturedAt: Date.now(),
    checkpointIdentity: identity, checkpointHash: hash(checkpoint),
    credentialsHash: hash(credentials), observerKeyHash: hash(current.observerKey),
    observerUrl: current.observerUrl, sourceUrl: current.sourceUrl,
    control: { playing: Boolean((resumeControl ?? before).playing), rate: [1, 10, 100, 1000].includes((resumeControl ?? before).rate) ? (resumeControl ?? before).rate : 10 },
    bootstrapHashes: Object.fromEntries(saved.instances.map(i => [i.org, hash(i.config)])),
  };
  await privateJSON(path.join(dir, 'checkpoint.json'), checkpoint);
  await privateJSON(path.join(dir, 'credentials.json'), credentials);
  await privateJSON(path.join(dir, 'bundle.json'), bundle);
  // Only this pointer is replaced; all original checkpoints remain immutable.
  await privateJSON(path.join(directory, 'resume-latest.json'), { directory: path.relative(directory, dir) }, 'w');
  return { directory: dir, sessionId: current.sessionId, runId: checkpoint.runId, now: checkpoint.now };
}
async function assertPortsFree(ports) {
  for (const port of ports) await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(Error(`Port ${port} is still in use. Stop the existing laboratory first; no process was terminated.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
export async function resumeLab({ rootDir = defaultRoot, simulatorRoot = path.resolve(rootDir, '../disaster-response-simulator'), upgradeDemoBuild = false, spawnChildren = true, spawnProcess = spawn } = {}) {
  const saved = await session(rootDir), { current, directory, instances } = saved,
    latest = await parse(path.join(directory, 'resume-latest.json')),
    dir = within(directory, latest.directory),
    bundle = await parse(path.join(dir, 'bundle.json')),
    original = await parse(path.join(dir, 'checkpoint.json')),
    credentials = await parse(path.join(dir, 'credentials.json'));
  try {
    const launcher=await parse(path.join(directory,'launcher-status.json'));
    if(launcher.sessionId!==current.sessionId||launcher.state!=='stopped')
      throw Error('This session has no completed coordinated launcher shutdown. An older world snapshot must not be paired with newer databases. Preserve this session and recover or start a separate one.');
  } catch(error){if(error.code!=='ENOENT')throw error;}
  if (bundle.format !== 'aidscaler-lab-resume-v1' || bundle.sessionId !== current.sessionId ||
      bundle.observerUrl !== current.observerUrl || bundle.sourceUrl !== current.sourceUrl ||
      bundle.checkpointHash !== hash(original) || bundle.checkpointIdentity !== checkpointIdentity(original) ||
      bundle.credentialsHash !== hash(credentials) || bundle.observerKeyHash !== hash(current.observerKey) ||
      instances.some(i => bundle.bootstrapHashes[i.org] !== hash(i.config)))
    throw Error('The resume bundle, checkpoint or existing bootstrap changed. No database or world was started.');
  for (const item of instances) {
    if (credentials.actors?.[item.config.sourceAgentKey]?.org !== item.org || credentials.actors?.[item.config.sourceHumanKey]?.org !== item.org)
      throw Error('Saved actor credentials do not cover the existing organizations.');
  }
  const simRoot = simulatorRoot,
    { createLabServers } = await import(pathToFileURL(path.join(simRoot, 'sources/server.mjs')).href),
    { manifest } = await import(pathToFileURL(path.join(simRoot, 'contracts/config.mjs')).href),
    currentManifest = manifest(original.manifest.config, { contentVersion: original.manifest.contentVersion }),
    changed = original.manifest.engineBuild !== currentManifest.engineBuild,
    missingPublicationCounter = !Object.hasOwn(original.state.statistics ?? {}, 'publicPostsPublished'),
    explicitDemoUpgrade = upgradeDemoBuild && original.manifest.config.continuousDemo === true && original.manifest.config.mode === 'interactive';
  if (hash(original.manifest.config) !== hash(currentManifest.config) ||
      ['engineVersion', 'schemaVersion', 'randomVersion', 'runtimeMajor', 'contentVersion'].some(k => original.manifest[k] !== currentManifest[k]))
    throw Error('Checkpoint configuration or engine contract changed. A resume cannot migrate this state.');
  if (changed && !explicitDemoUpgrade)
    throw Error('Simulator code changed. Strict resume refused. Only an interactive continuous demo may explicitly use --upgrade-demo-build; benchmark snapshots cannot be migrated.');
  if (missingPublicationCounter && !explicitDemoUpgrade)
    throw Error('The publication counter is absent. Only an explicit continuous-demo upgrade may add this reconstructed field.');
  if (!missingPublicationCounter && !Number.isSafeInteger(original.state.statistics.publicPostsPublished))
    throw Error('An existing publication counter is invalid. Resume does not replace present fields.');
  const checkpoint = structuredClone(original), migration = changed || missingPublicationCounter ? {
    kind: 'explicit-continuous-demo-build-upgrade', at: Date.now(), benchmarkEligible: false,
    originalEngineBuild: original.manifest.engineBuild, currentEngineBuild: currentManifest.engineBuild,
    originalCheckpointHash: bundle.checkpointHash, stateIdentity: bundle.checkpointIdentity,
  } : null;
  if (migration) {
    checkpoint.manifest.engineBuild = currentManifest.engineBuild;
    if (missingPublicationCounter) {
      if (!checkpoint.state.statistics || typeof checkpoint.state.statistics !== 'object')
        throw Error('Missing simulation statistics; only the single absent publication counter may be added.');
      const value = independentlyCountPublicPosts(checkpoint.state.posts);
      checkpoint.state.statistics.publicPostsPublished = value;
      migration.stateAdditions = [{ path: 'state.statistics.publicPostsPublished', value,
        method: 'Independent count of all public published archive records; includes deleted and excludes private/unpublished posts' }];
    }
    checkpoint.manifest.demoMigrations = [...(checkpoint.manifest.demoMigrations ?? []), migration];
  }
  const expectedStateIdentity = checkpointIdentity(checkpoint);
  const observerPort = Number(localURL(current.observerUrl).port), sourcePort = Number(localURL(current.sourceUrl).port);
  await assertPortsFree([observerPort, sourcePort, ...(spawnChildren ? instances.map(i => Number(i.config.port)) : [])]);
  const lab = await createLabServers({ observerPort, sourcePort, observerKey: current.observerKey,
    actorKeys: structuredClone(credentials.actors), persistCredentials: false, config: checkpoint.manifest.config });
  const children = []; let closed = false,closePromise=null;
  const close = async ({ capture = false } = {}) => {
    if (closed) return;
    if(closePromise)return closePromise;
    closePromise=(async()=>{
    const beforeClose = capture ? await observerJSON(current, '/api/state').catch(() => null) : null;
    await observerJSON(current, '/api/control', { play: false }).catch(() => {});
    await stopLabChildren(children);
    const receipt=capture?await captureLab({ rootDir, resumeControl: beforeClose }):null;
    await lab.close();
    closed=true;return receipt;
    })().catch(error=>{closePromise=null;throw error;});
    return closePromise;
  };
  try {
    // Restore via the normal observer API, before any platform/partner child can
    // issue a command. The general simulator restore contract stays unchanged.
    const restored = await observerJSON(current, '/api/restore', checkpoint), after = lab.world.checkpoint();
    if (restored.runId !== original.runId || checkpointIdentity(after) !== expectedStateIdentity)
      throw Error('Restored physical/event state differs from the captured checkpoint. No platform was started.');
    const receipt = { format: 'aidscaler-lab-resume-receipt-v1', at: Date.now(), sessionId: current.sessionId,
      runId: original.runId, now: after.now, restoredStateIdentity: checkpointIdentity(after),
      originalStateIdentity: bundle.checkpointIdentity, expectedRestoredStateIdentity: expectedStateIdentity, migration,
      manifest: after.manifest, benchmarkEligible: after.manifest.config.continuousDemo !== true };
    await privateJSON(path.join(dir, 'resume-receipt-' + stamp() + '.json'), receipt);
    if (spawnChildren) for (const item of instances) {
      const child = spawnLabChild({rootDir,instanceDir:item.dir,org:item.org,port:item.config.port,spawnProcess});
      children.push(child);
      child.stdout?.on('data', data => process.stdout.write(`[${item.org}] ${data}`));
      child.stderr?.on('data', data => process.stderr.write(`[${item.org}] ${data}`));
      child.once('error', () => { console.error(`${item.org} could not start; pausing the laboratory.`); close().catch(()=>console.error('Coordinated shutdown remains incomplete; no new snapshot was claimed.')); });
      child.once('exit', code => { if (code && !closed) { console.error(`${item.org} exited (${code}); pausing the laboratory.`); close().catch(()=>console.error('Coordinated shutdown remains incomplete; no new snapshot was claimed.')); } });
    }
    await observerJSON(current, '/api/control', { play: bundle.control.playing, rate: bundle.control.rate });
    return { lab, children, close, receipt, directory: dir };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.some(arg => !['--capture', '--upgrade-demo-build','--shutdown'].includes(arg)) || args.includes('--capture') && args.includes('--upgrade-demo-build') || args.includes('--shutdown')&&args.length!==1)
      throw Error('Use lab:resume --capture, lab:resume --shutdown, or lab:resume [--upgrade-demo-build].');
    if(args.includes('--shutdown')) {
      await requestLauncherShutdown({rootDir:defaultRoot});
      console.log('Laboratory stopped through its private control. Owned writers closed before the final world capture; databases and credentials were retained.');
    } else if (args.includes('--capture')) {
      const result = await captureLab();
      console.log(`Private laboratory checkpoint saved. Session ${result.sessionId}; same run at ${result.now} ms.\nThe demo clock is paused. Stop the current launcher promptly, then run pnpm lab:resume. Existing databases and credentials were not changed.`);
    } else {
      const running = await resumeLab({ upgradeDemoBuild: args.includes('--upgrade-demo-build') });
      const control=await installLauncherControl({rootDir:defaultRoot,onShutdown:()=>running.close({capture:true}),onStopped:()=>process.exit(0)});
      console.log(`Existing laboratory resumed at ${running.receipt.now} ms. Session, run, ports, organization databases and sign-in credentials preserved.${running.receipt.migration ? '\nExplicit demo build migration recorded privately; this run is not benchmark eligible.' : ''}`);
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
        try{await running.close({ capture: true });await control.close();process.exit(0);}
        catch{console.error('Coordinated shutdown did not complete. Use the private control and inspect owned writers; no successful final snapshot is claimed.');}
      });
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
