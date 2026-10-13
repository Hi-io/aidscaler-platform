import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { gitArchiveArgs, cleanPrivatePaths, safeChildEnvironment, allowedTrackedPath, validateAuthorization, DESIGNS } from './local-clean-checkout-profile-v2.mjs';

test('v2 does not reassign or propagate HOME/CODEX_HOME, and preserves the actual Windows profile paths',()=>{
  const parent=Object.freeze({HOME:'C:\\original-home',home:'C:\\lowercase-home',CODEX_HOME:'C:\\private-codex',USERPROFILE:'C:\\Users\\Original',
    APPDATA:'C:\\Users\\Original\\AppData\\Roaming',LOCALAPPDATA:'C:\\Users\\Original\\AppData\\Local',SystemRoot:'C:\\Windows'});
  const before=JSON.stringify(parent),e=safeChildEnvironment(parent,path.resolve('task-config'),path.resolve('node-runtime'));
  for(const key of ['HOME','home','CODEX_HOME'])assert.equal(Object.hasOwn(e,key),false);
  for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA'])assert.equal(e[key],parent[key]);
  assert.equal(JSON.stringify(parent),before);
  assert.match(DESIGNS.clean.environment,/original Windows user profile remains accessible/);
  assert.match(DESIGNS.clean.limits.join(' '),/No fresh HOME or isolated user-profile claim/);
});
test('child environment is an exact OS/runtime/config whitelist without inherited secrets, proxies or options',()=>{
  const dir=path.resolve('task-config'),nodeDir=path.resolve('node-runtime');
  const e=safeChildEnvironment({SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',COMSPEC:'C:\\Windows\\System32\\cmd.exe',PATHEXT:'.EXE;.CMD',
    TEMP:'C:\\Temp',TMP:'C:\\Temp',NUMBER_OF_PROCESSORS:'12',PROCESSOR_ARCHITECTURE:'AMD64',USERPROFILE:'C:\\Users\\Original',
    PATH:'private-parent-path',OPENROUTER_API_KEY:'sentinel',DATABASE_URL:'sentinel',NODE_OPTIONS:'sentinel',HTTP_PROXY:'sentinel',
    HTTPS_PROXY:'sentinel',NPM_TOKEN:'sentinel',NEXO_MCP_KEY:'sentinel',npm_config_userconfig:'private.npmrc',
    npm_config_globalconfig:'private-global.npmrc',npm_config_cache:'old-cache'},dir,nodeDir);
  assert.deepEqual(Object.keys(e).sort(),['SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE',
    'USERPROFILE','PATH','npm_config_userconfig','npm_config_globalconfig','npm_config_cache','pnpm_config_pm_on_fail'].sort());
  assert.equal(e.PATH,nodeDir+path.delimiter+path.join('C:\\Windows','System32'));
  assert.equal(e.npm_config_userconfig,path.join(dir,'empty-user.npmrc'));
  assert.equal(e.npm_config_globalconfig,path.join(dir,'empty-global.npmrc'));
  assert.equal(e.npm_config_cache,path.join(dir,'npm-cache'));
  assert.equal(e.pnpm_config_pm_on_fail,'ignore');
  assert.ok(!JSON.stringify(e).includes('sentinel'));assert.ok(!JSON.stringify(e).includes('private-parent-path'));
});
test('missing profile paths remain absent and no synthetic user-profile directory is invented',()=>{
  const e=safeChildEnvironment({},path.resolve('task-config'),path.resolve('node-runtime'));
  for(const key of ['USERPROFILE','APPDATA','LOCALAPPDATA','HOME','CODEX_HOME'])assert.equal(Object.hasOwn(e,key),false);
});
test('new dependency/config/cache layout starts in distinct ignored v2 storage without a home field',()=>{
  const workspace=path.resolve('example-workspace'),report=path.join(workspace,'reports/local-closure/1791869000000-clean');
  const p=cleanPrivatePaths(workspace,report),base=path.join(workspace,'.local/T27-private-builds-v2/1791869000000-clean');
  assert.equal(p.base,base);assert.equal(Object.hasOwn(p,'home'),false);
  for(const v of [p.runtimeConfig,p.checkout,p.store])assert.ok(v.startsWith(base+path.sep)&&!v.startsWith(report+path.sep));
  assert.throws(()=>cleanPrivatePaths(workspace,path.resolve('outside/reports/local-closure/1791869000000-clean')));
  assert.throws(()=>cleanPrivatePaths(workspace,path.join(workspace,'reports/local-closure/../../../escape/1791869000000-clean')));
  assert.throws(()=>cleanPrivatePaths(workspace,path.join(workspace,'reports/local-closure/not-a-new-run')));
});
test('LF archive flags, non-secret tracked path filter and separate launch authorization are retained',()=>{
  const archive=path.resolve('source archive.tar');
  assert.deepEqual(gitArchiveArgs(archive),['-c','core.autocrlf=false','-c','core.eol=lf','archive','--format=tar','--output='+archive,'HEAD']);
  for(const p of ['.env','.env.local','src/AGENTS.md','.local/helper.mjs','node_modules/x.js'])assert.equal(allowedTrackedPath(p),false);
  assert.equal(allowedTrackedPath('.env.example'),true);
  assert.doesNotThrow(()=>validateAuthorization('clean','ROOT_GO_CLEAN_CHECKOUT'));
  assert.throws(()=>validateAuthorization('clean','ROOT_GO_FEDERATION'));
  assert.equal(DESIGNS.clean.schema,'local-clean-checkout-profile-control-v2');
});
test('actual v2 recipe creates empty task npm config, passes explicit store and never writes a fresh profile',async()=>{
  const source=await readFile(new URL('./local-clean-checkout-profile-v2.mjs',import.meta.url),'utf8');
  assert.match(source,/await writeFile\(path.join\(runtimeConfig, 'empty-user\.npmrc'\), ''\)/);
  assert.match(source,/await writeFile\(path.join\(runtimeConfig, 'empty-global\.npmrc'\), ''\)/);
  assert.match(source,/--store-dir=' \+ layout.store/);
  assert.doesNotMatch(source,/HOME\s*:\s*runtimeHome|USERPROFILE\s*:\s*runtimeHome|fresh-runtime-home|path.join\(home, 'Roaming'\)/);
  assert.match(source,/model complete always throws/);
  assert.match(source,/assert.deepEqual\(smoke.fingerprints, gate.builds/);
});
