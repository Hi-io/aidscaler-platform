/** Ignored, archivable control. This is federation ablation, NOT an LLM trial.
 * Execute only after the parent seals current verification/UI/benchmark and
 * explicitly supplies ROOT_GO_FEDERATION. Every episode is retained. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = fileURLToPath(import.meta.url);
const sha = x => createHash('sha256').update(x).digest('hex');
const seeds = ['federation-structural-2026-01', 'federation-structural-2026-02'];
const conditions = ['standard', 'incompatible', 'communication_delay'];
const arms = ['disconnected', 'linked'];
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const at = arg.indexOf('=');
  return at < 0 ? [arg.replace(/^--/, ''), true] : [arg.slice(2, at), arg.slice(at + 1)];
}));

export const DESIGN = Object.freeze({
  schema: 'federation-structural-control-v1', scenario: 'S19', seeds, conditions, arms,
  physicalOwners: 4, platformInstances: 4, horizonMs: 10_800_000,
  wallLimitMsPerEpisode: 240_000, planningIntervalMs: 300_000, pumpIntervalMs: 60_000,
  coordinator: 'org0', maxPolicyRounds: 36,
  responsePolicy: { order: 'deadline_then_priority', maxOpenReviews: 8,
    investigationCooldownMs: 60_000, protectedTypes: [] },
  sourceParameters: { grid: 5, extentKm: 2, topology: 'grid', hazard: 'none',
    backgroundTraffic: 0, postsPerHour: 0, packetLoss: 0, queryLatencyMs: 1000,
    reviewMs: 30_000, inspectionMs: 60_000, loadMs: 60_000, unloadMs: 60_000,
    setupMs: 60_000, durationMs: 10_800_000, organizations: 4 },
  networkLatencyByConditionMs: { standard: 1000, incompatible: 1000, communication_delay: 30_000 },
  permittedDifference: 'Explicit connected-peer configuration and signed owner-consented projections only.',
  controller: 'Same conventionalSharedProposal received-data compiler; fixed incident coordinator org0 in BOTH arms; all four owners ingest and independently review their own physical actions.',
  provider: 'No model. complete always throws; global fetch refuses every non-loopback destination.',
  clocks: 'Same physical source config and finite review/inspection/command queues. Linked peer transport costs additional real source network latency. No CPU or SQL wall time is silently charged as physical latency.',
  planningInputs: 'Ordinary owner-scoped HTTP snapshots, queries and received signed peer offers. No observer truth, native stock, source preset or private cohort passed to controllers.',
  outcomes: ['Occupied shelter place-hours', 'Native shelter coverage/deficit integral',
    'First useful and sufficient physical service, with every missing case right-censored',
    'Fuel/travel/utilization, physical receipts and conservation', 'Same initial physical fingerprint for each of six pairs'],
  stopping: 'Fixed source horizon, or declared wall/dependency failure; never stops because private physical needs became served.',
  limits: ['Structural integration contrast against unlinked deployments, not superiority to competent interagency coordination.',
    'The linked arm is itself a competent deterministic cooperative reference. No incremental LLM, Gemini, human usability, mortality or real humanitarian efficacy claim.',
    'S19 was authored with complementary owners; it establishes finite feasibility in that contract, not arbitrary industry composition.',
    'Communication delay changes no resources and affects own source commands in both arms; all extra peer traffic retains its delay.',
    'No post-outcome seeds, tuning, new resources or excluded failures. Condition incompatible is an expected safety negative.'],
});

function fail(message) { throw Object.assign(new Error(message), { code: 'FEDERATION_GATE' }); }
const same = (a, b) => a === b && typeof a === 'string' && /^[a-f0-9]{64}$/.test(a);
export function validateGate(seal, verification, ui, benchmark, builds, authorization) {
  if (authorization !== 'ROOT_GO_FEDERATION' || seal.authorization !== authorization) fail('Explicit ROOT_GO_FEDERATION is required.');
  if (verification.passed !== true || verification.candidateChanged || verification.evaluatorChanged || verification.simulatorChanged) fail('Current full verification must pass unchanged.');
  for (const key of ['candidate', 'evaluator', 'simulator']) {
    const field = `${key}Fingerprint`, finalField = `${key}FinalFingerprint`;
    if (!same(seal[field], builds[key]) || !same(verification[field], builds[key]) || !same(verification[finalField], builds[key])) fail(`Unsealed or stale ${key}.`);
    if (!same(seal.ui?.[field], builds[key])) fail(`UI seal missing exact ${key}.`);
  }
  for (const name of ['platform-tests', 'simulator-tests']) {
    const row = verification.cases?.find(x => x.name === name);
    if (!row || row.exitCode !== 0 || !(row.tests?.pass > 0) || row.tests.fail !== 0 || row.tests.cancelled !== 0 || row.tests.skipped !== 0) fail(`Incomplete ${name}.`);
  }
  if (verification.cases?.some(x => x.exitCode !== 0)) fail('A verification stage failed.');
  if (seal.ui?.passed !== true || !Array.isArray(ui.checks) || !ui.checks.length || (ui.errors?.length ?? 0) !== 0 ||
    ui.checks.some(x => typeof x === 'object' && (x.loaded === false || x.horizontalOverflow === true))) fail('Current UI evidence has not passed.');
  if (benchmark.valid !== true || benchmark.complete !== true || benchmark.sourceUnchanged !== true ||
    !same(benchmark.engineBuildInitial, builds.simulator) || !same(benchmark.engineBuildFinal, builds.simulator) ||
    benchmark.benchmark?.results?.length !== 5 || benchmark.benchmark.results.some(x => x.ledgerValid !== true)) fail('Current five-profile source benchmark must pass.');
  return true;
}

async function libraries(root) {
  const load = file => import(pathToFileURL(path.join(root, file)));
  return {
    harness: await load('evaluation/harness.mjs'),
    build: await load('evaluation/simulator-build.mjs'),
    policy: await load('src/response-policy.mjs'),
    funnel: await load('evaluation/proposal-funnel.mjs'),
    simulator: await import(pathToFileURL(path.join(root, '../disaster-response-simulator/evaluation/metrics.mjs'))),
    determinism: await import(pathToFileURL(path.join(root, '../disaster-response-simulator/engine/determinism.mjs'))),
    replay: await import(pathToFileURL(path.join(root, '../disaster-response-simulator/evaluation/runs.mjs'))),
  };
}

async function fingerprints(lib) {
  return { candidate: await lib.harness.buildFingerprint(), evaluator: await lib.harness.evaluatorFingerprint(),
    simulator: await lib.build.requireLoadedSimulatorBuild() };
}
const json = async p => JSON.parse(await readFile(p, 'utf8'));
async function artifact(root, value) {
  const p = path.resolve(root, value), bytes = await readFile(p);
  return { path: p, sha256: sha(bytes), data: JSON.parse(bytes.toString('utf8')) };
}
async function persist(p, value) { await writeFile(p, JSON.stringify(value, null, 2)); }

function refuseExternalFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (request, options) => {
    const url = new URL(typeof request === 'string' || request instanceof URL ? request : request.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw Object.assign(new Error('External networking refused in no-paid federation control.'), { code: 'NO_PAID_NETWORK' });
    return original(request, options);
  };
  return () => { globalThis.fetch = original; };
}

// Scorer-only. Initial physical snapshot is never passed to a controller.
function physicalInitial(world, digest) {
  const body = { config: world.manifest.config, map: world.state.map,
    resources: world.state.resources, vehicles: world.state.vehicles,
    needs: world.state.needs, cohorts: world.state.cohorts };
  return { fingerprint: digest(body), mapHash: world.state.map.hash,
    resourceRows: world.state.resources.map(r => ({ id: r.id, owner: r.owner, type: r.type, quantity: r.quantity,
      qualifications: r.qualifications, qualificationCounts: r.qualificationCounts, qualificationProfiles: r.qualificationProfiles })),
    vehicles: world.state.vehicles.filter(v => !v.background).map(v => ({ id: v.id, owner: v.owner,
      capacity: v.capacity, seats: v.seats, maxCargoKg: v.maxCargoKg, fuel: v.fuel })),
    purpose: 'Scorer-only equality/conservation audit; not an agent input.' };
}

function score(world, lib) {
  const metrics = lib.simulator.evaluate(world), cohort = metrics.perCommunity.filter(n => n.type === 'shelter' && n.quantity > 0),
    at = world.now, rows = cohort.map(n => ({ ...n,
      firstUsefulCensored: n.firstServiceAt == null, sufficientCensored: n.completedAt == null || n.served < n.quantity,
      restrictedFirstUsefulMs: (n.firstServiceAt ?? at) - n.createdAt,
      restrictedSufficientMs: (n.completedAt != null && n.served >= n.quantity ? n.completedAt : at) - n.createdAt,
    }));
  const mean = field => rows.length ? rows.reduce((sum, row) => sum + row[field], 0) / rows.length : null;
  return { metrics, shelterCohort: rows, restrictedMeanFirstUsefulMs: mean('restrictedFirstUsefulMs'),
    restrictedMeanSufficientMs: mean('restrictedSufficientMs'),
    rightCensoredFirstUseful: rows.filter(x => x.firstUsefulCensored).length,
    rightCensoredSufficient: rows.filter(x => x.sufficientCensored).length,
    shelterCoverage: metrics.services.shelter ? metrics.services.shelter.served / metrics.services.shelter.demand : null,
    invariants: world.invariants(), observedThroughSourceMs: at,
    nativeUnitNote: 'Do not sum water liters, shelter people and other resource quantities. Scored shelter deficit has people·ms units.' };
}

async function episode(root, protocolFile, descriptor, output) {
  const protocol = await json(protocolFile), lib = await libraries(root), before = await fingerprints(lib);
  if (JSON.stringify(before) !== JSON.stringify(protocol.builds)) fail('Source changed since preregistration.');
  if (sha(await readFile(SCRIPT)) !== protocol.runnerHash) fail('Runner changed since preregistration.');
  const restoreFetch = refuseExternalFetch(), started = performance.now();
  let providerCalls = 0, h, status = 'running', nextPlanAt = 0, rounds = 0;
  const errors = [], activities = [], progress = [],
    provider = { complete: async () => { providerCalls++; throw Object.assign(new Error('No model calls in structural control.'), { code: 'NO_MODEL_ALLOWED' }); } };
  let initial = null, lastReport = null;
  const publish = async () => {
    if (!h) return;
    const scored = score(h.lab.world, lib);
    lastReport = { recordedAt: new Date().toISOString(), ...descriptor, status, complete: h.lab.world.now === DESIGN.horizonMs,
      builds: before, initialPhysical: initial, wallMs: performance.now() - started,
      modelCalls: providerCalls, costUsd: 0, errors: [...errors], activities: [...activities], progress: [...progress], ...scored,
      horizonOverrunMs: Math.max(0, h.lab.world.now - DESIGN.horizonMs),
      claimScope: 'Finite federation mechanism only; no incremental AI or real-world efficacy claim.' };
    await persist(output + '.partial.json', lastReport);
  };
  try {
    h = await lib.harness.createHarness({ scenario: DESIGN.scenario, seed: descriptor.seed, organizations: 4,
      config: { ...DESIGN.sourceParameters,
        compositionVariant: descriptor.condition === 'incompatible' ? 'incompatible' : 'standard',
        networkLatencyMs: DESIGN.networkLatencyByConditionMs[descriptor.condition] },
      awaitReviews: false, awaitVerifications: false, provider, maxCalls: 0,
      platformConfig: { autoInvestigate: false } });
    initial = physicalInitial(h.lab.world, lib.determinism.digest);
    if (descriptor.arm === 'disconnected') for (const app of h.apps) app.config.peers = [];
    h.lab.world.advance(60_000);
    const commanders = new Map();
    for (const app of h.apps) {
      for (const target of ['inventory', 'vehicles', 'map', 'policy'])
        await app.connector.action('query', { target }, `federation-bootstrap-${target}`);
      await app.ingestion.sync({ sources: false });
      const actor = (await app.store.query("SELECT id,org,role FROM users WHERE org=$1 AND role='commander'", [app.config.org])).rows[0];
      commanders.set(app.config.org, actor);
      await lib.policy.configureResponsePolicy(app.store, actor, { ...DESIGN.responsePolicy, version: 0,
        reason: 'Predeclared identical finite owner policy for federation structural ablation' }, 'federation-response-policy');
    }
    if (descriptor.arm === 'linked') {
      // Same explicit received projections as reference evaluation; no private stock import.
      for (const app of h.apps) for (const kind of ['resource', 'vehicle'])
        for (const row of (await app.store.list(app.config.org, kind, 2000)).filter(row => row.owner === app.config.org))
          for (const peer of app.config.peers) {
            await app.network.share(commanders.get(app.config.org), { kind, id: row.id, version: row.version, to: peer.org },
              `federation-share-${row.id}-${peer.org}`);
            await app.worker.drain();
          }
    }
    nextPlanAt = h.lab.world.now;
    await publish();
    while (h.lab.world.now < DESIGN.horizonMs) {
      if (performance.now() - started >= DESIGN.wallLimitMsPerEpisode) { status = 'wall_censored'; break; }
      if (h.lab.world.now >= nextPlanAt && rounds < DESIGN.maxPolicyRounds) {
        const app = h.apps[0], round = rounds++;
        const activity = await lib.harness.conventionalSharedProposal(app, `federation-${descriptor.seed}-${descriptor.condition}-${descriptor.arm}-${round}`);
        activities.push({ round, atSource: h.lab.world.now, ...activity });
        if (activity.proposalId) {
          const proposal = await app.store.get(app.config.org, 'proposal', activity.proposalId);
          await lib.harness.scriptedReview(app, proposal);
        }
        nextPlanAt += DESIGN.planningIntervalMs;
      }
      const target = Math.min(DESIGN.horizonMs, h.lab.world.now + DESIGN.pumpIntervalMs);
      const advanced = h.lab.world.advance(target, { maxEvents: 100_000 });
      if (advanced.blocked) throw Object.assign(new Error('Unexpected model clock barrier.'), { code: 'UNEXPECTED_MODEL_BARRIER' });
      // At the administrative horizon physical events are scored, but no new
      // source/network work is initiated beyond that horizon to gather receipts.
      if (h.lab.world.now === DESIGN.horizonMs) break;
      for (const app of h.apps) {
        await app.ingestion.sync({ sources: false });
        // Uses only received platform proposals. No gold-dependent stop or action selection.
        for (const row of await app.store.list(app.config.org, 'proposal', 2000)) {
          if (row.state === 'awaiting_review') await lib.harness.scriptedReview(app, row);
          const current = await app.store.get(app.config.org, 'proposal', row.id);
          if (['authorized', 'executing', 'awaiting_partner'].includes(current.state)) {
            try { await app.worker.execute(row.id); }
            catch (e) { errors.push({ atSource: h.lab.world.now, org: app.config.org, phase: 'execute', code: e.code ?? e.name }); }
          }
        }
        await app.worker.drain();
      }
      progress.push({ atSource: h.lab.world.now, wallMs: performance.now() - started, rounds });
      if (progress.length % 5 === 0) { await publish(); console.log(`PROGRESS ${descriptor.seed}/${descriptor.condition}/${descriptor.arm} ${h.lab.world.now}`); }
    }
    if (status === 'running') status = h.lab.world.now === DESIGN.horizonMs ? 'completed' : 'incomplete';
  } catch (e) {
    status = 'failed'; errors.push({ phase: 'episode', code: e.code ?? e.name, message: e.message });
    // Failed controllers are still scored at the same horizon if source clock
    // integrity allows it. Previously commissioned physical work remains real.
    if (h && h.lab.world.now < DESIGN.horizonMs && !h.lab.world.modelBarrier())
      h.lab.world.advance(DESIGN.horizonMs, { maxEvents: 1_000_000 });
  } finally {
    if (h) {
      await publish();
      lastReport.platformReceipts = [];
      for (const app of h.apps) lastReport.platformReceipts.push({ org: app.config.org,
        proposals: await app.store.list(app.config.org, 'proposal', 2000),
        operations: await app.store.list(app.config.org, 'operation', 2000),
        verifications: await app.store.list(app.config.org, 'verification', 2000),
        facilities: await app.store.list(app.config.org, 'facility', 2000),
        peerOffers: await app.store.list(app.config.org, 'peer_offer', 2000) });
      lastReport.proposalFunnel = await lib.funnel.collectProposalServiceFunnel(h.apps, h.lab.world);
      lastReport.sourceTransport = h.lab.world.log.filter(e => e.type === 'platform_peer_transport');
      lastReport.physicalOperations = h.lab.world.state.operations;
      const checkpoint = h.lab.world.checkpoint();
      await persist(output + '.checkpoint.json', checkpoint);
      try { const replay = lib.replay.replay(checkpoint); lastReport.replay = { matches: replay.matches, expected: replay.expected, actual: replay.actual }; replay.world.close(); }
      catch (e) { lastReport.replay = { matches: false, error: e.message }; }
      const after = await fingerprints(lib);
      lastReport.finalBuilds = after;
      lastReport.sourceUnchanged = JSON.stringify(before) === JSON.stringify(after);
      lastReport.valid = lastReport.sourceUnchanged && providerCalls === 0 && !lastReport.invariants.length && lastReport.replay.matches && lastReport.horizonOverrunMs === 0;
      if (lastReport.horizonOverrunMs > 0) lastReport.status = 'invalid_horizon_overrun';
      if (!lastReport.sourceUnchanged) lastReport.status = 'invalid_source_changed';
      await persist(output + '.json', lastReport);
      await h.close();
    } else await persist(output + '.json', { ...descriptor, status, complete: false, valid: false, errors, modelCalls: providerCalls });
    restoreFetch();
  }
}

async function childEpisode(root, protocolFile, descriptor, prefix) {
  const child = spawn(process.execPath, [SCRIPT, '--episode=' + JSON.stringify(descriptor), '--platform-root=' + root,
    '--protocol=' + protocolFile, '--output=' + prefix], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', bytes => { stdout += bytes; process.stdout.write(bytes); });
  child.stderr.on('data', bytes => { stderr += bytes; process.stderr.write(bytes); });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, DESIGN.wallLimitMsPerEpisode + 15_000);
  const result = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })); });
  clearTimeout(timer);
  await writeFile(prefix + '.stdout.txt', stdout); await writeFile(prefix + '.stderr.txt', stderr);
  let report;
  try { report = await json(prefix + '.json'); }
  catch { try { report = await json(prefix + '.partial.json'); } catch { report = { ...descriptor, errors: [{ code: 'NO_EPISODE_REPORT' }] }; } }
  if (timedOut || result.code !== 0) {
    report = { ...report, status: timedOut ? 'wall_censored' : 'process_failed', complete: false, finalIntegrityUnconfirmed: true,
      valid: false, process: { ...result, timedOut, wallLimitMs: DESIGN.wallLimitMsPerEpisode + 15_000 },
      missingTail: 'Only the last durable partial is measured; unobserved time is not counted as service or source horizon.' };
    await persist(prefix + '.json', report);
  }
  return report;
}

async function main() {
  const root = path.resolve(args['platform-root'] ?? process.cwd());
  if (args.episode) return episode(root, args.protocol, JSON.parse(args.episode), args.output);
  const lib = await libraries(root), builds = await fingerprints(lib), runnerHash = sha(await readFile(SCRIPT));
  const directory = path.join(root, 'reports', 'federation-structural', String(Date.now()));
  await mkdir(directory, { recursive: true });
  await copyFile(SCRIPT, path.join(directory, 'runner.mjs'));
  let gate = null;
  if (args.execute) {
    if (!args.seal) fail('A current parent source/UI/benchmark seal is required.');
    const seal = await artifact(root, args.seal), verification = await artifact(root, seal.data.verification),
      ui = await artifact(root, seal.data.ui.path), benchmark = await artifact(root, seal.data.engineBenchmark);
    validateGate(seal.data, verification.data, ui.data, benchmark.data, builds, args.authorization);
    gate = Object.fromEntries(Object.entries({ seal, verification, ui, benchmark }).map(([name, a]) => [name, { path: a.path, sha256: a.sha256 }]));
  }
  const descriptors = seeds.flatMap((seed, seedIndex) => conditions.flatMap((condition, conditionIndex) =>
    (seedIndex + conditionIndex) % 2 ? [...arms].reverse().map(arm => ({ seed, condition, arm })) : arms.map(arm => ({ seed, condition, arm }))));
  const protocol = { declaredAt: new Date().toISOString(), executionAuthorized: !!args.execute, design: DESIGN,
    builds, runnerHash, gate, descriptors,
    hardware: { cpu: os.cpus()[0]?.model, logicalCpus: os.availableParallelism(), ramGiB: os.totalmem() / 2 ** 30,
      os: os.platform(), node: process.version },
    sealContract: { authorization: 'ROOT_GO_FEDERATION', candidateFingerprint: builds.candidate,
      evaluatorFingerprint: builds.evaluator, simulatorFingerprint: builds.simulator, verification: 'CURRENT_FULL_VERIFICATION_PATH',
      ui: { path: 'CURRENT_UI_REPORT_PATH', passed: true, candidateFingerprint: builds.candidate,
        evaluatorFingerprint: builds.evaluator, simulatorFingerprint: builds.simulator }, engineBenchmark: 'CURRENT_5_PROFILE_BENCHMARK_PATH' } };
  const protocolFile = path.join(directory, 'protocol.json');
  await persist(protocolFile, protocol);
  console.log(`PREREGISTERED ${protocolFile}; executionAuthorized=${protocol.executionAuthorized}; no model calls`);
  if (!args.execute) return;
  const rows = [];
  for (const descriptor of descriptors) {
    if (JSON.stringify(builds) !== JSON.stringify(await fingerprints(lib))) { await persist(path.join(directory, 'interrupted.json'), { reason: 'source_changed', remaining: descriptors.slice(rows.length) }); break; }
    const prefix = path.join(directory, `${descriptor.seed}-${descriptor.condition}-${descriptor.arm}`);
    rows.push(await childEpisode(root, protocolFile, descriptor, prefix));
    await persist(path.join(directory, 'index.json'), { protocol: protocolFile, completedAttempts: rows.length, expectedAttempts: 12,
      artifacts: rows.map(row => ({ seed: row.seed, condition: row.condition, arm: row.arm, status: row.status, complete: row.complete, valid: row.valid })) });
  }
  const pairs = seeds.flatMap(seed => conditions.map(condition => {
    const isolated = rows.find(x => x.seed === seed && x.condition === condition && x.arm === 'disconnected'),
      linked = rows.find(x => x.seed === seed && x.condition === condition && x.arm === 'linked'),
      sameInitialPhysicalWorld = same(isolated?.initialPhysical?.fingerprint, linked?.initialPhysical?.fingerprint),
      eligible = sameInitialPhysicalWorld && isolated?.valid && linked?.valid && isolated?.complete && linked?.complete;
    return { seed, condition, sameInitialPhysicalWorld, pairedCompleteValid: !!eligible,
      disconnectedStatus: isolated?.status ?? 'missing', linkedStatus: linked?.status ?? 'missing',
      occupiedShelterPlaceHours: { disconnected: isolated?.metrics?.collective?.shelterPlaceHours ?? null,
        linked: linked?.metrics?.collective?.shelterPlaceHours ?? null },
      shelterCoverage: { disconnected: isolated?.shelterCoverage ?? null, linked: linked?.shelterCoverage ?? null },
      restrictedFirstUsefulMs: { disconnected: isolated?.restrictedMeanFirstUsefulMs ?? null, linked: linked?.restrictedMeanFirstUsefulMs ?? null },
      restrictedSufficientMs: { disconnected: isolated?.restrictedMeanSufficientMs ?? null, linked: linked?.restrictedMeanSufficientMs ?? null },
      inference: eligible ? 'Finite federation ablation, not incremental AI or conventional coordination superiority.' : 'Incomplete/invalid pair; no comparative gain inference.' };
  }));
  await persist(path.join(directory, 'summary.json'), { recordedAt: new Date().toISOString(), protocol: protocolFile,
    builds, finalBuilds: await fingerprints(lib), allTwelveAttemptsRetained: rows.length === 12, pairs,
    claimScope: DESIGN.limits });
  console.log(`SUMMARY ${path.join(directory, 'summary.json')}`);
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT) main().catch(error => {
  console.error(JSON.stringify({ code: error.code ?? error.name, message: error.message })); process.exitCode = 1;
});
