/** Ignored control, archived verbatim before execution. Preparation creates no
 * worlds. Each execution requires a separate literal parent authorization. */
import { readFile, writeFile, mkdir, copyFile, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { validateGate } from './federation-structural-control.mjs';

const script = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(script), '..');
const sha = b => createHash('sha256').update(b).digest('hex');
const json = async f => JSON.parse(await readFile(f, 'utf8'));
const save = async (f, x) => writeFile(f, JSON.stringify(x, null, 2));
export const AUTHORIZATION = Object.freeze({ clean: 'ROOT_GO_CLEAN_CHECKOUT', viewer: 'ROOT_GO_SIMULATOR_VIEWER', arithmetic: 'ROOT_GO_NUMERIC_RECEIPTS' });
export const DESIGNS = Object.freeze({
  clean: {
    schema: 'local-clean-checkout-control-v1', wallLimitMs: 600000,
    source: 'Two git archive HEAD snapshots of the sealed commits, extracted into new sibling directories.',
    archiveLineEndings: 'git -c core.autocrlf=false -c core.eol=lf archive preserves the committed LF bytes regardless of the host Git configuration. No runtime source normalization is performed.',
    generatedLayout: 'Fresh checkout, package-manager store and HOME directories are created under ignored .local/T27-private-builds/<report-id> from the start. Only immutable source archives, install logs, protocol, receipts and results remain in reports.',
    install: 'Declared pnpm@11.25.0: pnpm install --frozen-lockfile with a fresh isolated store. Neither repo has package-lock.json; npm ci would invent a different dependency protocol.',
    environment: 'Only explicit OS/runtime paths. Fresh HOME/USERPROFILE/APPDATA/LOCALAPPDATA, empty npmrc; no API keys, .env files, inherited node_modules/junctions, local databases or credentials.',
    smoke: 'Copied platform and copied source start from fresh runtime state. Ordinary scoped HTTP map/policy/inventory/vehicle queries, independently reviewed shipment and actual positive physical receipt; model complete always throws.',
    limits: ['Node dependency installation and local source/platform startup only. Python/ASR binaries, optional media models and Chromium are separate declared host dependencies.', 'Not GCP deployment, not a provider quality test, not a full-size restore benchmark. Existing backup/process-crash artifacts remain separate.'],
  },
  viewer: {
    schema: 'simulator-real-webgl-control-v1', wallLimitMs: 180000,
    fixture: { scenario: 'S23', seed: 'viewer-literal-2026-01', organizations: 1, grid: 5, extentKm: 2, horizonMs: 1800000 },
    checks: ['Real Chromium WebGL canvas renders with no application error.', 'Orthographic camera pan/zoom and zoom-out building LOD toggle.', 'Entity search, follow and stop tracking.', 'Truth lane hidden in actor perspective; only actual connector intake receipts shown.', 'Camera-only operations while paused preserve the complete physical state hash.', 'A/B canvases initialize and report synchronized source clocks with the same initial physical map.'],
    instrumentation: 'Browser route injects an observation-only JSON readout immediately before the existing renderer.render; it copies camera, LOD flags, draw-call count. The injected source and original source SHA are retained. No camera, state, physics or policy mutation by instrumentation.',
    limits: ['Behavioral smoke on declared hardware/browser, not independent human comprehension or accessibility certification.', 'Frame counter is descriptive, not a calibrated 30–60 FPS certification. A/B policy comparison is not scored for advantage.'],
  },
  arithmetic: {
    schema: 'four-needs-two-vehicles-two-owners-control-v1', wallLimitMs: 180000,
    source: { scenario: 'S23', seed: 'hand-sheet-2026-01', organizations: 2, grid: 5, extentKm: 1, durationMs: 1200000,
      policy: 'none', hazard: 'none', topology: 'grid', postsPerHour: 0, backgroundTraffic: 0,
      packetLoss: 0, healthReports: false, recurringNeeds: false, reviewMs: 1000,
      networkLatencyMs: 1000, queryLatencyMs: 1000, loadMs: 1000, unloadMs: 1000 },
    needs: [{ id: 'hand-a', owner: 'org0', quantity: 50, sendQuantity: 50, deadline: 600000 },
      { id: 'hand-b', owner: 'org0', quantity: 90, sendQuantity: 30, deadline: 600000 },
      { id: 'hand-c', owner: 'org1', quantity: 40, sendQuantity: 40, deadline: 600000 },
      { id: 'hand-d', owner: 'org1', quantity: 25, sendQuantity: 0, deadline: 1800000 }],
    initialAuthoring: 'Withdraw the default main need, add four water needs at four existing residential buildings and retain one original native vehicle per owner before the first external input. No stock is added. Archive the complete authored initial checkpoint. This is checkpoint-replay evidence, not seed-only reproduction of an unmodified S23.',
    controller: 'Fixed scripted owner plan from ordinary received need/stock/vehicle/map/policy rows. org0 supplies A then deliberately partial B with the same finite vehicle; org1 supplies C; D is the declared unserved/future-deadline negative. Every exact command requires ordinary owner reviews.',
    expected: 'Independent piecewise demand-minus-actual-service integral from service_delivered events, first-positive and sufficient timestamps, right censoring, deadline-aware denominators, source stock/reserved/cargo conservation, received-vs-approved distinction, resource occupancy hours and complete checkpoint/input replay.',
    limits: ['One arithmetic/safety fixture, not a comparative benefit or semantic throughput study.', 'Source reviewer and staff resource hours are distinct; no measured human reading/decision time is asserted. Future deadline is not counted as an already missed deadline.'],
  },
});

export function safeChildEnvironment(parent, runtimeHome, nodeDirectory) {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'])
    if (parent[key]) env[key] = parent[key];
  env.PATH = nodeDirectory + path.delimiter + path.join(parent.SystemRoot ?? 'C:\\Windows', 'System32');
  Object.assign(env, { HOME: runtimeHome, USERPROFILE: runtimeHome, APPDATA: path.join(runtimeHome, 'Roaming'),
    LOCALAPPDATA: path.join(runtimeHome, 'Local'), npm_config_userconfig: path.join(runtimeHome, 'empty.npmrc'),
    pnpm_config_pm_on_fail: 'ignore', OPENROUTER_API_KEY: '', DATABASE_URL: '' });
  return env;
}
export function allowedTrackedPath(p) {
  const normalized = p.replaceAll('\\', '/');
  return !normalized.toLowerCase().split('/').some(part => ['node_modules', '.local', '.codex', 'agents.md', '.git'].includes(part)) &&
    !normalized.toLowerCase().split('/').some(part => part.startsWith('.env') && part !== '.env.example');
}
export function validateAuthorization(kind, given) {
  assert.ok(Object.hasOwn(DESIGNS, kind), 'Unknown closure-control kind');
  assert.equal(given, AUTHORIZATION[kind], 'Execution requires the separate literal parent authorization');
}
export function gitArchiveArgs(archive) {
  return ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=tar', '--output=' + archive, 'HEAD'];
}
export function cleanPrivatePaths(workspace, evidenceFolder) {
  const workspacePath = path.resolve(workspace), evidencePath = path.resolve(evidenceFolder);
  const prefix = workspacePath + path.sep;
  assert.ok(evidencePath.startsWith(path.join(workspacePath, 'reports', 'local-closure') + path.sep), 'Evidence must stay inside the declared report directory');
  const id = path.basename(evidencePath); assert.match(id, /^\d+-clean$/, 'Expected a new timestamped clean report');
  const base = path.resolve(workspacePath, '.local/T27-private-builds', id);
  assert.ok(base.startsWith(prefix), 'Generated builds must stay inside the declared workspace');
  return { base, checkout: path.join(base, 'clean-checkouts'), home: path.join(base, 'fresh-runtime-home'), store: path.join(base, 'fresh-pnpm-store') };
}
export function deficitSheet(needs, events, horizon) {
  return needs.map(n => {
    let previous = n.createdAt ?? 0, served = 0, deficitUnitMs = 0, firstServiceAt = null, sufficientServiceAt = null;
    const receipts = events.filter(e => e.type === 'service_delivered' && e.entity === n.id && e.at <= horizon)
      .sort((a, b) => a.at - b.at || a.index - b.index);
    for (const receipt of receipts) {
      assert.ok(receipt.at >= previous, 'Service event clock cannot regress');
      deficitUnitMs += (receipt.at - previous) * Math.max(0, n.quantity - served);
      const useful = Math.min(Math.max(0, receipt.data.quantity), Math.max(0, n.quantity - served));
      if (useful > 0 && firstServiceAt == null) firstServiceAt = receipt.at;
      served += useful;
      if (served >= n.quantity && sufficientServiceAt == null && n.quantity > 0) sufficientServiceAt = receipt.at;
      previous = receipt.at;
    }
    deficitUnitMs += (horizon - previous) * Math.max(0, n.quantity - served);
    return { id: n.id, quantity: n.quantity, unit: n.unit ?? 'L', createdAt: n.createdAt ?? 0, deadline: n.deadline,
      served, outstanding: Math.max(0, n.quantity - served), deficitUnitMs, firstServiceAt, sufficientServiceAt,
      firstUsefulCensored: firstServiceAt == null, sufficientCensored: sufficientServiceAt == null,
      restrictedFirstUsefulMs: (firstServiceAt ?? horizon) - (n.createdAt ?? 0),
      restrictedSufficientMs: (sufficientServiceAt ?? horizon) - (n.createdAt ?? 0),
      onTime: sufficientServiceAt != null && sufficientServiceAt <= n.deadline,
      deadlineMatured: n.deadline <= horizon, failedByDeadline: n.deadline <= horizon && (sufficientServiceAt == null || sufficientServiceAt > n.deadline),
      receipts: receipts.map(e => ({ at: e.at, quantity: e.data.quantity, index: e.index })) };
  });
}

async function libraries(base = root) {
  const imp = p => import(pathToFileURL(path.join(base, p)));
  return { harness: await imp('evaluation/harness.mjs'), builds: await imp('evaluation/simulator-build.mjs'),
    world: await imp('../disaster-response-simulator/engine/world.mjs'),
    metrics: await imp('../disaster-response-simulator/evaluation/metrics.mjs'),
    utilization: await imp('../disaster-response-simulator/engine/utilization.mjs'),
    digest: (await imp('../disaster-response-simulator/engine/determinism.mjs')).digest };
}
async function fingerprints(lib) { return { candidate: await lib.harness.buildFingerprint(), evaluator: await lib.harness.evaluatorFingerprint(), simulator: await lib.builds.requireLoadedSimulatorBuild() }; }
async function currentGate(sealPath, kind, authorization) {
  validateAuthorization(kind, authorization);
  const seal = await json(sealPath), verification = await json(seal.verification), ui = await json(seal.ui.path), benchmark = await json(seal.engineBenchmark);
  for (const [file, expected] of [[seal.verification, seal.verificationByteHash], [seal.ui.path, seal.ui.byteHash], [seal.engineBenchmark, seal.engineBenchmarkByteHash]])
    assert.equal(sha(await readFile(file)), expected, 'A sealed evidence artifact changed');
  const lib = await libraries(), builds = await fingerprints(lib);
  validateGate({ ...seal, authorization: 'ROOT_GO_FEDERATION' }, verification, ui, benchmark, builds, 'ROOT_GO_FEDERATION');
  return { lib, builds, evidence: { sealPath, verification: seal.verification, ui: seal.ui.path, benchmark: seal.engineBenchmark } };
}
function refuseExternalFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = (request, options) => {
    const u = new URL(typeof request === 'string' || request instanceof URL ? request : request.url);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(u.hostname), 'No paid/external network allowed in local smoke');
    return original(request, options);
  };
  return () => { globalThis.fetch = original; };
}
async function processResult(command, args, options = {}) {
  const { timeoutMs = 120000, silent = false, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', silent ? 'ignore' : 'pipe', silent ? 'ignore' : 'pipe'], ...spawnOptions });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout?.on('data', chunk => { if (stdout.length < 200000) stdout += chunk; });
    child.stderr?.on('data', chunk => { if (stderr.length < 200000) stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut, stdout, stderr }); });
  });
}
async function refresh(app, tag) {
  for (const target of ['map', 'policy', 'inventory', 'vehicles']) await app.connector.action('query', { target }, tag + '-' + target);
  await app.ingestion.sync({ sources: false });
}
async function bootSmoke(base, outputPath) {
  const restoreFetch = refuseExternalFetch(), lib = await libraries(base);
  const h = await lib.harness.createHarness({ seed: 'clean-runtime-2026-01', organizations: 1, maxCalls: 0,
    provider: { complete: () => { throw Error('MODEL_FORBIDDEN'); } },
    platformConfig: { autoInvestigate: false }, config: { organizations: 1, extentKm: 1, grid: 5,
      reviewMs: 1000, loadMs: 1000, unloadMs: 1000, packetLoss: 0, healthReports: false, recurringNeeds: false } });
  try {
    const app = h.apps[0]; app.config.peers = [];
    const response = await fetch(app.url + '/api/health');
    // A health route may be intentionally authenticated; the HTTP server must answer.
    assert.ok([200, 401, 403, 404].includes(response.status));
    h.lab.world.advance(60000); await refresh(app, 'clean-boot');
    const received = await app.connector.state();
    assert.ok(Object.keys(received.known.resources).length > 0 && Object.keys(received.known.vehicles).length > 0);
    const plan = await lib.harness.ruleProposal(app, 'clean-startup-shipment'); assert.ok(plan.proposalId);
    const proposal = await app.store.get(app.config.org, 'proposal', plan.proposalId);
    assert.equal(await lib.harness.scriptedReview(app, proposal), true); await app.worker.execute(proposal.id);
    for (let i = 0; i < 30; i++) {
      h.lab.world.advance(Math.min(h.lab.world.config.durationMs, h.lab.world.now + 60000));
      await app.ingestion.sync({ sources: false }); await app.worker.execute(proposal.id);
      if (h.lab.world.state.operations.some(o => o.type === 'delivery' && o.received > 0)) break;
    }
    const receipts = h.lab.world.state.operations.filter(o => o.received > 0).map(o => ({ id: o.id, org: o.org, type: o.type, received: o.received, times: o.times }));
    assert.ok(receipts.length > 0, 'Startup smoke must reach positive physical receipt');
    assert.equal(h.lab.world.invariants().length, 0); assert.equal(h.lab.world.state.modelCalls, 0);
    await save(outputPath, { passed: true, fingerprints: await fingerprints(lib), atSourceClock: h.lab.world.now,
      readyQueries: received.queries.filter(q => q.state === 'ready').map(q => ({ target: q.target, state: q.state })),
      receipts, invariants: [], modelCalls: 0, sourceStore: 'new in-memory PGlite; no copied DB or bootstrap credentials' });
  } finally { await h.close(); restoreFetch(); }
}

async function clean(folder, gate) {
  const layout = cleanPrivatePaths(root, folder), { home, checkout } = layout;
  // Refuse pre-existing generated directories rather than accidentally reuse a cache.
  let existing = false; try { await lstat(layout.base); existing = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  assert.equal(existing, false, 'This clean run must use a fresh private build directory');
  assert.equal((await lstat(path.join(root, '.local'))).isSymbolicLink(), false, 'Ignored helper directory cannot redirect outside the declared workspace');
  await mkdir(path.dirname(layout.base), { recursive: true });
  assert.equal((await lstat(path.dirname(layout.base))).isSymbolicLink(), false, 'Private build parent cannot be a junction to another workspace');
  await save(path.join(folder, 'generated-build-layout.json'), { schema: 't27-private-layout-v1', evidenceFolder: folder, layout, initialDirectoryAbsent: true, inheritedDependencies: false, sourcesMutated: false });
  await mkdir(path.join(home, 'Roaming'), { recursive: true }); await mkdir(path.join(home, 'Local'), { recursive: true });
  await writeFile(path.join(home, 'empty.npmrc'), ''); await mkdir(checkout, { recursive: true });
  const env = safeChildEnvironment(process.env, home, path.dirname(process.execPath));
  const pnpm = path.resolve(path.dirname(process.execPath), '../node_modules/pnpm/bin/pnpm.mjs');
  assert.ok((await lstat(pnpm)).isFile(), 'Declared pnpm runtime is unavailable');
  const tool = await processResult(process.execPath, [pnpm, '--version'], { env }); assert.equal(tool.code, 0);
  assert.equal(tool.stdout.trim(), '11.25.0', 'Use the packageManager version declared by both repositories');
  const rows = [];
  for (const name of ['nexo-platform', 'disaster-response-simulator']) {
    const source = path.join(root, '..', name), destination = path.join(checkout, name), archive = path.join(folder, name + '.tar');
    const commit = await processResult('git', ['rev-parse', 'HEAD'], { cwd: source }); assert.equal(commit.code, 0);
    const files = await processResult('git', ['ls-files', '-z'], { cwd: source }); assert.equal(files.code, 0);
    const paths = files.stdout.split('\0').filter(Boolean); assert.ok(paths.length > 0);
    assert.deepEqual(paths.filter(p => !allowedTrackedPath(p)), [], 'A tracked local/key/dependency artifact must not be copied');
    const archived = await processResult('git', gitArchiveArgs(archive), { cwd: source }); assert.equal(archived.code, 0);
    await mkdir(destination); const extracted = await processResult('tar', ['-xf', archive, '-C', destination]); assert.equal(extracted.code, 0);
    for (const forbidden of ['node_modules', '.local', '.git', '.env.local', '.env']) {
      let exists = false; try { await lstat(path.join(destination, forbidden)); exists = true; } catch { /* absent is required */ }
      assert.equal(exists, false, 'Fresh archive inherited ' + forbidden);
    }
    const lock = path.join(destination, 'pnpm-lock.yaml'), lockHash = sha(await readFile(lock));
    const installStarted = performance.now(), install = await processResult(process.execPath,
      [pnpm, 'install', '--frozen-lockfile', '--store-dir=' + layout.store],
      { cwd: destination, env, timeoutMs: 240000 });
    await writeFile(path.join(folder, name + '-install.stdout.txt'), install.stdout); await writeFile(path.join(folder, name + '-install.stderr.txt'), install.stderr);
    assert.equal(install.code, 0, 'Fresh lockfile installation failed; raw logs retained');
    assert.equal(sha(await readFile(lock)), lockHash, 'Frozen installation changed lockfile');
    const modules = await lstat(path.join(destination, 'node_modules'));
    assert.equal(modules.isSymbolicLink(), false, 'Top-level dependencies must not inherit a junction');
    rows.push({ repository: name, commit: commit.stdout.trim(), trackedFiles: paths.length, archiveSha256: sha(await readFile(archive)),
      lockHash, installWallMs: performance.now() - installStarted, installExit: install.code, topLevelModulesRealDirectory: modules.isDirectory() });
  }
  const childHelper = path.join(checkout, 'nexo-platform', '.local', path.basename(script));
  await mkdir(path.dirname(childHelper)); await copyFile(script, childHelper);
  await copyFile(path.join(root, '.local/federation-structural-control.mjs'), path.join(path.dirname(childHelper), 'federation-structural-control.mjs'));
  const smokePath = path.join(folder, 'clean-startup-smoke.json');
  const started = await processResult(process.execPath, [childHelper, '--clean-child=' + smokePath],
    { cwd: path.join(checkout, 'nexo-platform'), env, silent: true, timeoutMs: 120000 });
  assert.equal(started.code, 0, 'Copied startup smoke failed; no inherited provider or credentials');
  const smoke = await json(smokePath); assert.equal(smoke.passed, true);
  assert.deepEqual(smoke.fingerprints, gate.builds, 'Copied committed bytes differ from the sealed tested runtime');
  return { checks: rows, startup: smoke, runtime: { node: process.version, pnpm: tool.stdout.trim(), platform: process.platform,
    credentialEnvironmentInherited: false, optionalPythonMediaInstalled: false, optionalChromiumInstalled: false }, passed: true };
}

async function viewer(folder, gate) {
  const restoreFetch = refuseExternalFetch(), { chromium } = await import('@playwright/test');
  const h = await gate.lib.harness.createHarness({ ...DESIGNS.viewer.fixture, maxCalls: 0,
    provider: { complete: () => { throw Error('MODEL_FORBIDDEN'); } }, platformConfig: { autoInvestigate: false },
    config: { organizations: 1, grid: 5, extentKm: 2, reviewMs: 1000, loadMs: 1000, unloadMs: 1000,
      healthReports: false, recurringNeeds: false, packetLoss: 0, durationMs: DESIGNS.viewer.fixture.horizonMs } });
  let browser;
  const checks = [], errors = [];
  try {
    const app = h.apps[0]; app.config.peers = []; h.lab.world.advance(60000); await refresh(app, 'viewer-boot');
    await app.ingestion.sync(); const actualIntake = h.lab.world.state.ingestion.length;
    const plan = await gate.lib.harness.ruleProposal(app, 'viewer-shipment'); assert.ok(plan.proposalId);
    const p = await app.store.get('org0', 'proposal', plan.proposalId); assert.equal(await gate.lib.harness.scriptedReview(app, p), true);
    await app.worker.execute(p.id); h.lab.world.advance(h.lab.world.now + 5000);
    const original = await readFile(path.join(root, '../disaster-response-simulator/viewer/app.js'), 'utf8');
    const anchor = 'renderer.render(scene, camera);'; assert.equal(original.split(anchor).length, 2);
    const readout = `window.__readOnlyViewerProbe = {zoom:camera.zoom,position:camera.position.toArray(),target:controls.target.toArray(),orthographic:camera.isOrthographicCamera,buildingsVisible:layerGroups.buildings?.visible,sectorsVisible:layerGroups.sectors?.visible,calls:renderer.info.render.calls};\n`;
    const instrumented = original.replace(anchor, readout + anchor); await writeFile(path.join(folder, 'observed-viewer-app.js'), instrumented);
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
    await page.route('**/app.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: instrumented }));
    const url = 'http://127.0.0.1:' + h.lab.observerPort; await page.goto(url); await page.locator('#key').fill(h.lab.observerKey);
    await page.locator('#loginForm button').click(); await page.locator('#app').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__readOnlyViewerProbe?.calls > 0);
    const before = h.lab.world.stateHash(), camera = await page.evaluate(() => window.__readOnlyViewerProbe);
    assert.equal(camera.orthographic, true); checks.push({ name: 'real WebGL orthographic draw', passed: true, camera });
    await page.locator('#canvas').click({ position: { x: 80, y: 80 } }); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(prior => window.__readOnlyViewerProbe.position[0] !== prior, camera.position[0]);
    checks.push({ name: 'keyboard pan changes camera', passed: true });
    const bounds = await page.locator('#canvas').boundingBox(); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 1400); await page.waitForFunction(() => window.__readOnlyViewerProbe.zoom < 0.55);
    const distant = await page.evaluate(() => window.__readOnlyViewerProbe); assert.equal(distant.buildingsVisible, false); assert.equal(distant.sectorsVisible, true);
    checks.push({ name: 'zoom-out hides buildings and shows sector LOD', passed: true, distant }); await page.screenshot({ path: path.join(folder, 'observer-lod.png') });
    await page.locator('#home').click(); await page.locator('#toggleConfig').click(); await page.locator('#find').fill('v-org0-0'); await page.locator('#find').press('Enter');
    await page.locator('#follow').waitFor({ state: 'visible' }); await page.locator('#follow').click(); await page.locator('#stopTracking').waitFor({ state: 'visible' });
    checks.push({ name: 'search and follow existing source vehicle', passed: true, tracking: await page.locator('#canvas').getAttribute('data-tracking') });
    await page.locator('#stopTracking').click(); await page.locator('#perspective').selectOption('org0');
    await page.waitForFunction(() => document.getElementById('realityCount').textContent.includes('Ground truth hidden'));
    const actorText = await page.locator('#reality').innerText(); assert.ok(actorText.includes('World truth is hidden'));
    checks.push({ name: 'actor perspective hides truth lane', passed: true, actualConnectorReceipts: actualIntake });
    assert.ok(actualIntake > 0, 'Intake must be a genuine source acknowledgement, not a fake UI row');
    assert.equal(h.lab.world.stateHash(), before, 'Paused camera/UI inspection must not advance or mutate physical truth');
    checks.push({ name: 'camera-only interactions preserve complete physical hash', passed: true, stateHash: before });
    await page.screenshot({ path: path.join(folder, 'actor-follow.png') });
    await page.locator('#openComparison').click(); await page.locator('#comparisonForm button').click();
    await page.waitForFunction(() => document.getElementById('comparisonStatus').textContent.includes('clocks synchronized'));
    assert.equal(await page.locator('#compareA canvas').count(), 1); assert.equal(await page.locator('#compareB canvas').count(), 1);
    const pair = await page.evaluate(() => fetch('/api/compare?pair=1').then(r => r.json()));
    assert.equal(pair.a.now, pair.b.now); assert.equal(pair.a.state.map.hash, pair.b.state.map.hash);
    checks.push({ name: 'two real WebGL comparison canvases synchronize source clocks/map', passed: true, atSourceClock: pair.a.now, initialMapHash: pair.a.state.map.hash });
    await page.screenshot({ path: path.join(folder, 'paired-cameras.png') });
    const frames = await page.locator('#canvas canvas').getAttribute('data-fps');
    assert.deepEqual(errors, []); return { passed: true, checks, errors, descriptiveFps: frames, browser: browser.version(),
      originalViewerAppSha256: sha(original), observedViewerAppSha256: sha(instrumented), sourceReceiptCount: actualIntake,
      scope: 'Real browser behavioral smoke with read-only scene introspection, not user testing or GenAI evidence.' };
  } finally { await browser?.close(); await h.close(); restoreFetch(); }
}

// Private post-run observation. Controllers never receive these journals.
function occupancySummary(w) {
  const vehicles = w.state.vehicles.filter(v => !v.background).map(v => ({ id: v.id, state: v.state, load: v.load ?? 0,
    passengers: v.passengers ?? 0, operation: v.operation ?? null,
    operationTerminal: !v.operation || ['completed', 'received', 'failed', 'cancelled'].includes(w.state.operations.find(o => o.id === v.operation)?.state),
    edge: v.edge ?? null }));
  return { vehicles, reservedWater: w.state.resources.filter(r => r.type === 'water').reduce((s, r) => s + r.reserved, 0),
    waterStock: w.state.resources.filter(r => r.type === 'water').reduce((s, r) => s + r.quantity, 0) };
}
function journalUtilization(w) {
  const intervals = [], step = w.step.bind(w), advance = w.advance.bind(w);
  const observe = (at, to) => { if (to > at) intervals.push({ from: at, to, ...occupancySummary(w) }); };
  w.step = () => { if (!w.modelBarrier() && w.queue.peek()) observe(w.now, w.queue.peek().at); return step(); };
  w.advance = (at, opts) => {
    // Event steps are journalled by the wrapped step. The terminal event-free
    // gap needs the state after those events, not the state before advance.
    const originalIntegrate = w.state.statistics.utilization?.lastAt;
    const result = advance(at, opts);
    if (result.reached) {
      const from = intervals.at(-1)?.to ?? originalIntegrate ?? 0;
      if (at > from) intervals.push({ from, to: at, ...occupancySummary(w) });
    }
    return result;
  };
  return intervals;
}
function replayInitial(initial, final, lib) {
  const w = new lib.world.World(initial.manifest.config, initial);
  for (const input of final.inputs.slice(initial.inputs.length)) {
    while (w.eventCount < input.afterEventCount) { const e = w.step(); assert.ok(e && e.at <= input.at); }
    assert.ok(w.now <= input.at); lib.utilization.integrateUtilization(w, input.at); w.now = input.at;
    try {
      if (input.kind === 'intervention') w.inject(input.type, input.data);
      else if (input.kind === 'ingestion') w.acknowledge(input.actor, input.request);
      else if (input.kind === 'model_start') w.startModelCall(input.actor, input.request);
      else if (input.kind === 'model_finish') w.finishModelCall(input.actor, input.request);
      else w.act(input.actor, input.request);
    } catch { /* Rejected inputs must reproduce their rejection ledger. */ }
  }
  while (!w.advance(final.now).reached) assert.ok(!w.modelBarrier());
  const expected = new lib.world.World(final.manifest.config, final), result = { expected: expected.stateHash(), actual: w.stateHash() };
  result.matches = result.expected === result.actual; w.close(); expected.close(); return result;
}
async function arithmetic(folder, gate) {
  const design = DESIGNS.arithmetic, restoreFetch = refuseExternalFetch();
  const h = await gate.lib.harness.createHarness({ scenario: 'S23', seed: design.source.seed, organizations: 2,
    config: design.source, maxCalls: 0, provider: { complete: () => { throw Error('MODEL_FORBIDDEN'); } },
    platformConfig: { autoInvestigate: false } });
  try {
    const w = h.lab.world; for (const app of h.apps) app.config.peers = [];
    assert.equal(w.now, 0); assert.equal(w.inputs.length, 0);
    w.updateNeed('need-water-main', { quantity: 0 });
    const buildings = w.state.map.buildings.filter(b => b.use === 'residential').slice(0, 4); assert.equal(buildings.length, 4);
    w.state.vehicles = w.state.vehicles.filter(v => v.background || v.id === 'v-org0-0' || v.id === 'v-org1-0');
    for (const o of Object.values(w.state.observations)) for (const id of Object.keys(o.vehicles)) if (!w.state.vehicles.some(v => v.id === id)) delete o.vehicles[id];
    w.indices.clear();
    const cohort = design.needs.map((n, i) => ({ ...n, building: buildings[i].id, type: 'water', unit: 'L', createdAt: 0, silent: false }));
    for (const n of cohort) {
      const row = w.addNeed(n); w.send({ kind: 'need_observation', need: structuredClone(row), observedAt: w.now }, n.owner, { sector: w.building(n.building).sector });
    }
    assert.equal(w.state.vehicles.length, 2); assert.deepEqual(w.invariants(), []);
    const initial = w.checkpoint(), initialStock = occupancySummary(w).waterStock, intervals = journalUtilization(w);
    await save(path.join(folder, 'initial-checkpoint.json'), initial);
    const issued = new Set(), proposals = [], ledger = [];
    for (let turn = 0; turn < 20 && w.now < design.source.durationMs; turn++) {
      w.advance(Math.min(design.source.durationMs, Math.max(w.now, (turn + 1) * 60000)));
      for (const app of h.apps) {
        const org = app.config.org; await refresh(app, 'hand-' + turn + '-' + org);
        const snapshot = await app.connector.state();
        const next = design.needs.find(n => n.owner === org && n.sendQuantity > 0 && !issued.has(n.id));
        if (next) {
          const need = snapshot.known.needs[next.id], vehicle = Object.values(snapshot.known.vehicles).find(v => v.owner === org && ['idle', 'arrived'].includes(v.state));
          const resource = Object.values(snapshot.known.resources).find(r => r.owner === org && r.type === 'water');
          if (need && vehicle && resource && resource.quantity - resource.reserved - resource.floor >= next.sendQuantity) {
            const p = await app.domain.propose({ id: 'hand-operator-' + org, org, role: 'analyst' }, {
              title: 'Fixed numerical receipt fixture ' + next.id, summary: 'Exact predeclared load from received stock.', benefit: 'Arithmetic evidence only',
              references: [need.id, vehicle.id, resource.id], rationale: 'Fixed scripted laboratory scope; no observer data or model.',
              conditions: [], alternatives: [], priority: 'normal', actions: [{ owner: org, type: 'dispatch',
                params: { need: need.id, resource: resource.id, vehicle: vehicle.id, quantity: next.sendQuantity, ttlMs: 900000 }, dependsOn: [] }] }, 'hand-' + next.id);
            assert.equal(await gate.lib.harness.scriptedReview(app, p), true); await app.worker.execute(p.id);
            issued.add(next.id); proposals.push({ org, id: p.id, need: next.id, approvedQuantity: next.sendQuantity });
          }
        }
        for (const p of proposals.filter(p => p.org === org)) await app.worker.execute(p.id);
        await app.ingestion.sync({ sources: false });
      }
      ledger.push({ at: w.now, ...occupancySummary(w), actualReceipts: w.state.operations.map(o => ({ id: o.id, org: o.org, need: o.need, state: o.state, quantity: o.quantity, received: o.received ?? 0, times: o.times })) });
    }
    while (!w.advance(design.source.durationMs).reached) assert.ok(!w.modelBarrier());
    for (const app of h.apps) await app.ingestion.sync({ sources: false });
    const final = w.checkpoint(), metrics = gate.lib.metrics.evaluate(w), events = [...w.log];
    await save(path.join(folder, 'final-checkpoint.json'), final); await save(path.join(folder, 'observational-ledger.json'), { ledger, intervals, events });
    const hand = deficitSheet(cohort, events, w.now), checks = [];
    for (const n of hand) {
      const native = metrics.perCommunity.find(row => row.id === n.id), episode = metrics.response.episodes?.perEpisode?.find(e => e.need === n.id);
      const physical = w.need(n.id);
      assert.equal(native.served, n.served); assert.equal(native.firstServiceAt, n.firstServiceAt); assert.equal(native.sufficientServiceAt, n.sufficientServiceAt);
      const nativeIntegral = physical.pendingIntegral + (w.now - physical.integratedAt) * Math.max(0, physical.quantity - physical.served);
      assert.equal(nativeIntegral, n.deficitUnitMs); if (episode) assert.equal(episode.uncoveredUnitMs, n.deficitUnitMs);
      checks.push({ name: 'independent integral/timestamps ' + n.id, passed: true, deficitUnitMs: n.deficitUnitMs });
    }
    assert.equal(hand.find(n => n.id === 'hand-b').served, 30); assert.equal(hand.find(n => n.id === 'hand-b').sufficientCensored, true);
    assert.equal(hand.find(n => n.id === 'hand-d').firstUsefulCensored, true); assert.equal(hand.find(n => n.id === 'hand-d').deadlineMatured, false);
    const receiptQuantity = w.state.operations.filter(o => o.type === 'delivery' && o.resourceType === 'water').reduce((s, o) => s + (o.received ?? 0), 0);
    const stock = occupancySummary(w).waterStock, cargo = w.state.vehicles.reduce((s, v) => s + (v.resourceType === 'water' ? v.load ?? 0 : 0), 0);
    assert.equal(initialStock, stock + cargo + receiptQuantity, 'Every native water unit remains stock, cargo or physically received');
    const vehicleCommittedMs = intervals.reduce((sum, interval) => sum + (interval.to - interval.from) * interval.vehicles.filter(v =>
      !v.operationTerminal || !['idle', 'arrived', 'failed', 'cancelled'].includes(v.state) || v.load > 0 || v.passengers > 0).length, 0);
    assert.equal(metrics.utilization.vehicleCommittedMs, vehicleCommittedMs, 'Independent occupancy intervals agree with engine integral');
    const replay = replayInitial(initial, final, gate.lib); assert.equal(replay.matches, true, 'Full authored-checkpoint replay failed; retain the failed control');
    assert.deepEqual(w.invariants(), []); assert.equal(w.state.modelCalls, 0);
    await save(path.join(folder, 'hand-sheet.json'), { hand, horizonMs: w.now, unit: 'L·ms', definitions: DESIGNS.arithmetic.expected,
      receiptQuantity, initialStock, finalStock: stock, inTransitCargo: cargo, vehicleCommittedMs,
      vehicleCommittedHours: vehicleCommittedMs / 3600000, sourceReviewMs: metrics.operatorReviewMs,
      trueHumanHours: null, trueHumanHoursReason: 'Scripted source review is modeled; actual human cognitive effort was not measured.' });
    return { passed: true, checks, hand, conservation: { initialStock, finalStock: stock, cargo, receiptQuantity }, replay, metrics,
      sourceReviewMs: metrics.operatorReviewMs, vehicleCommittedMs, modelCalls: 0, invariants: [], fixture: 'Authored initial checkpoint with exactly four positive water needs and two original native vehicles.' };
  } finally { await h.close(); restoreFetch(); }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  if (args['clean-child']) { await bootSmoke(root, path.resolve(args['clean-child'])); return; }
  const kind = args.kind ?? 'clean'; assert.ok(Object.hasOwn(DESIGNS, kind));
  const folder = path.join(root, 'reports/local-closure', Date.now() + '-' + kind); await mkdir(folder, { recursive: true });
  const hardware = { platform: process.platform, arch: process.arch, node: process.version, cpus: os.cpus().map(c => c.model), totalMemoryBytes: os.totalmem() };
  const protocol = { ...DESIGNS[kind], preparedAt: new Date().toISOString(), kind, authorizationRequired: AUTHORIZATION[kind],
    scriptSha256: sha(await readFile(script)), executed: false, hardware, root, note: 'No world starts during preparation. All failures retained and never counted as complete.' };
  await copyFile(script, path.join(folder, path.basename(script))); await copyFile(path.join(root, '.local/federation-structural-control.mjs'), path.join(folder, 'federation-structural-control.mjs'));
  await save(path.join(folder, 'protocol.json'), protocol);
  if (!args.execute) { console.log(JSON.stringify({ prepared: true, executed: false, kind, folder, authorizationRequired: AUTHORIZATION[kind] })); return; }
  const started = performance.now(); let gate, result;
  try {
    gate = await currentGate(path.resolve(args.seal ?? ''), kind, args.authorization); await save(path.join(folder, 'execution-gate.json'), { ...gate.evidence, builds: gate.builds, authorization: args.authorization });
    await save(path.join(folder, 'result.json'), { kind, passed: false, incomplete: true, valid: false,
      reason: 'Execution has started; no completed evidence yet.', initialFingerprints: gate.builds, modelSpendUsd: 0 });
    const timer = setTimeout(async () => {
      await save(path.join(folder, 'result.json'), { kind, passed: false, incomplete: true, valid: false,
        reason: 'Predeclared wall limit reached; missing completion remains censored.', wallMs: performance.now() - started,
        initialFingerprints: gate.builds, modelSpendUsd: 0 });
      console.error('LOCAL_CLOSURE_WALL_LIMIT'); process.exit(124);
    }, DESIGNS[kind].wallLimitMs); timer.unref();
    try { result = await ({ clean, viewer, arithmetic })[kind](folder, gate); } finally { clearTimeout(timer); }
  } catch (error) { result = { passed: false, incomplete: true, error: { code: error.code ?? 'CONTROL_ASSERTION', message: error.message } }; }
  const finalBuilds = gate ? await fingerprints(gate.lib) : null;
  const sourceUnchanged = gate ? JSON.stringify(gate.builds) === JSON.stringify(finalBuilds) : false;
  await save(path.join(folder, 'result.json'), { ...result, kind, wallMs: performance.now() - started, sourceUnchanged,
    initialFingerprints: gate?.builds ?? null, finalFingerprints: finalBuilds, hardware, protocolSha256: sha(await readFile(path.join(folder, 'protocol.json'))),
    valid: result?.passed === true && sourceUnchanged, modelSpendUsd: 0 });
  console.log(JSON.stringify({ folder, kind, valid: result?.passed === true && sourceUnchanged, passed: result?.passed, sourceUnchanged }));
  if (result?.passed !== true || !sourceUnchanged) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) main().catch(e => { console.error(e.code ?? e.name); process.exitCode = 1; });
