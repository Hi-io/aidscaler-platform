/** Offline preparation only: exact seven platform UI reports plus one source
 * viewer proof. No world, browser or model is started by this helper. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFingerprint, evaluatorFingerprint } from '../evaluation/harness.mjs';
import { requireLoadedSimulatorBuild } from '../evaluation/simulator-build.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sealed = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const scripts = ['ui-test.mjs','journey-test.mjs','review-journey.mjs',
  'response-journey.mjs','finance-journey.mjs','coverage-journey.mjs','unloading-journey.mjs'];
const json = async p => { const bytes = await readFile(p); return { bytes, data: JSON.parse(bytes.toString('utf8')) }; };
const sameBuilds = (p, builds) => ['candidate','evaluator','simulator'].every(k =>
  sealed(builds[k]) && p?.[k+'Fingerprint'] === builds[k]);
const failedCheck = c => c && typeof c === 'object' &&
  (c.passed === false || c.loaded === false || c.horizontalOverflow === true);

export function validateOfflineSources(verification, snapshot, benchmark, viewer, builds) {
  if (!verification?.passed || verification.candidateChanged !== false || verification.evaluatorChanged !== false ||
      verification.simulatorChanged !== false || !sameBuilds(verification, builds) ||
      ['candidate','evaluator','simulator'].some(k => verification[k+'FinalFingerprint'] !== builds[k]) ||
      !Array.isArray(verification.cases) || verification.cases.some(c => c.exitCode !== 0 || c.signal != null))
    throw Error('Exact unchanged successful current full verification required');
  for (const name of ['platform-tests','simulator-tests']) {
    const t = verification.cases.find(c => c.name === name)?.tests;
    if (!t || !(t.tests > 0) || t.pass !== t.tests || t.fail !== 0 || t.cancelled !== 0 || t.skipped !== 0)
      throw Error('Incomplete current full suite '+name);
  }
  if (!snapshot?.passed || snapshot.unchanged !== true || !sameBuilds(snapshot, builds) ||
      !sameBuilds(snapshot.finalFingerprints, builds) || !Array.isArray(snapshot.cases) ||
      snapshot.cases.length !== scripts.length || new Set(snapshot.cases.map(c => c.script)).size !== scripts.length ||
      scripts.some(s => !snapshot.cases.some(c => c.script === s)) ||
      snapshot.cases.some(c => c.exitCode !== 0 || c.signal != null || !Array.isArray(c.report?.checks) ||
        !c.report.checks.length || (c.report.errors?.length ?? 0) !== 0 || c.report.checks.some(failedCheck)))
    throw Error('Exact seven current successful UI journeys required');
  if (benchmark?.valid !== true || benchmark.complete !== true || benchmark.sourceUnchanged !== true ||
      benchmark.engineBuildInitial !== builds.simulator || benchmark.engineBuildFinal !== builds.simulator ||
      benchmark.benchmark?.results?.length !== 5 || benchmark.benchmark.results.some(r => r.ledgerValid !== true))
    throw Error('Exact unchanged five-profile engine benchmark required');
  if (viewer?.passed !== true || !Array.isArray(viewer.checks) || !viewer.checks.length ||
      viewer.checks.some(failedCheck) || (viewer.errors?.length ?? 0) !== 0 ||
      (viewer.sourceIntegrity?.length ?? 0) !== 0 || viewer.initialBuild !== builds.simulator ||
      viewer.finalBuild !== builds.simulator || viewer.modelCalls !== 0)
    throw Error('Successful unchanged actual source viewer proof required');
  return true;
}

export async function prepareFederationSeal(options = {}) {
  for (const key of ['verification','ui','engine','viewer']) if (!options[key])
    throw Error('Explicit timestamped --'+key+' path required; no latest fallback');
  const root = resolve(options['platform-root'] ?? process.cwd());
  const paths = Object.fromEntries(['verification','ui','engine','viewer'].map(k => [k,resolve(root,options[k])]));
  const inputs = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([k,p]) => [k,await json(p)])));
  const builds = {candidate:await buildFingerprint(), evaluator:await evaluatorFingerprint(), simulator:await requireLoadedSimulatorBuild()};
  validateOfflineSources(inputs.verification.data,inputs.ui.data,inputs.engine.data,inputs.viewer.data,builds);
  const records = [], checks = [], checkSources = [];
  for (const row of inputs.ui.data.cases) {
    if (!row.reportPath) throw Error('Raw report path missing '+row.script);
    const sourcePath = resolve(root,row.reportPath), allowedPrefix = (root+sep).toLowerCase();
    if (!sourcePath.toLowerCase().startsWith(allowedPrefix) || !sourcePath.endsWith('.json'))
      throw Error('Raw UI report must stay inside workspace '+row.script);
    const retained = await json(sourcePath);
    if (JSON.stringify(retained.data) !== JSON.stringify(row.report))
      throw Error('Raw UI bytes no longer match recorded snapshot '+row.script);
    records.push({script:row.script,originalPath:sourcePath,bytes:retained.bytes,
      byteHash:sha(retained.bytes),checks:retained.data.checks.length});
    for (const [sourceCheckIndex,check] of retained.data.checks.entries()) {
      checkSources.push({aggregateIndex:checks.length,script:row.script,sourceCheckIndex});checks.push(check);
    }
  }
  const folder = resolve(root,options.folder ?? 'reports/federation-structural/seal-'+Date.now());
  await mkdir(resolve(folder,'source-reports'),{recursive:true});
  const write = async (p,bytes) => writeFile(p,bytes,{flag:'wx'});
  for (const record of records) {
    const p = resolve(folder,'source-reports',record.script.replace(/\.mjs$/,'.json'));
    await write(p,record.bytes);record.retainedPath=p;delete record.bytes;
  }
  const viewerPath=resolve(folder,'source-reports','simulator-viewer.json');
  await write(viewerPath,inputs.viewer.bytes);
  const proofPaths={};
  for (const key of ['verification','ui','engine']) {
    proofPaths[key]=resolve(folder,'source-reports',key+'-snapshot.json');
    await write(proofPaths[key],inputs[key].bytes);
  }
  const fingerprints=Object.fromEntries(Object.entries(builds).map(([k,v])=>[k+'Fingerprint',v]));
  const aggregatePath=resolve(folder,'ui-aggregate.json');
  await write(aggregatePath,JSON.stringify({recordedAt:new Date().toISOString(),...fingerprints,
    passed:true,unchanged:true,checks,checkSources,errors:[],sourceReports:records,
    snapshot:{originalPath:paths.ui,retainedPath:proofPaths.ui,byteHash:sha(inputs.ui.bytes)},
    scope:'Exact seven-platform-journey flattening. Source viewer is retained separately as the eighth report, not fabricated platform assertions.'},null,2)+'\n');
  const authorization=options.authorization==='ROOT_GO_FEDERATION'?'ROOT_GO_FEDERATION':'PENDING_ROOT_GO_FEDERATION';
  const seal={recordedAt:new Date().toISOString(),...fingerprints,authorization,
    executionApproved:authorization==='ROOT_GO_FEDERATION',worldsStarted:0,modelCalls:0,
    verification:proofPaths.verification,verificationByteHash:sha(inputs.verification.bytes),
    ui:{path:aggregatePath,byteHash:sha(await readFile(aggregatePath)),...fingerprints,passed:true},
    engineBenchmark:proofPaths.engine,engineBenchmarkByteHash:sha(inputs.engine.bytes),
    viewer:{path:viewerPath,originalPath:paths.viewer,byteHash:sha(inputs.viewer.bytes),checks:inputs.viewer.data.checks.length,
      initialBuild:inputs.viewer.data.initialBuild,finalBuild:inputs.viewer.data.finalBuild,passed:true},
    sourceReportCount:records.length+1,platformJourneyReports:records.length,
    note:'Preparation retains exact raw evidence. The runner still requires explicit ROOT_GO_FEDERATION; no episode/browser/model was started.'};
  const sealPath=resolve(folder,'seal.json');
  await write(sealPath,JSON.stringify(seal,null,2)+'\n');
  const helperBytes=await readFile(new URL(import.meta.url));
  await write(resolve(folder,'prepare-seal.mjs'),helperBytes);
  await write(resolve(folder,'helper-sha256.json'),JSON.stringify({helperSha256:sha(helperBytes)},null,2)+'\n');
  return {sealPath,folder,authorization,sourceReportCount:seal.sourceReportCount,platformChecks:checks.length,viewerChecks:seal.viewer.checks,builds};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options=Object.fromEntries(process.argv.slice(2).map(s=>{
    const at=s.indexOf('=');return at<0?[s.replace(/^--/,''),true]:[s.slice(2,at),s.slice(at+1)];
  }));
  if (!options.verification) console.log(JSON.stringify({state:'prepared_not_launched',requiredPaths:['verification','ui','engine','viewer'],
    explicitAuthorization:'ROOT_GO_FEDERATION',worldsStarted:0,modelCalls:0}));
  else console.log(JSON.stringify(await prepareFederationSeal(options),null,2));
}
