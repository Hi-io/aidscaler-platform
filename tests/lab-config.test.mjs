import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { laboratoryConfig, existingLabPassword } from '../scripts/lab-config.mjs';
import { spawnLabChild } from '../scripts/lab-lifecycle.mjs';

test('the connected interactive lab defaults to Takamatsu and keeps explicit map overrides', () => {
  const config = laboratoryConfig({});
  assert.equal(config.topology, 'takamatsu');
  assert.equal(config.extentKm, 10);
  assert.equal(config.grid, 66);
  assert.equal(config.organizations, 5);
  assert.equal(config.policy, 'none', 'only AidScaler and authorized operators issue physical responses');
  assert.equal(config.continuousDemo, true);
  assert.equal(laboratoryConfig({ AIDSCALER_TOPOLOGY: 'honmura' }).topology, 'honmura');
  assert.equal(laboratoryConfig({ AIDSCALER_SCENARIO: 'S19' }).scenario, 'S19');
});

test('new isolated demo worlds reuse existing local account passwords without rewriting access files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aidscaler-lab-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.local'));
  assert.equal(await existingLabPassword(root, 'org0'), undefined);
  const file = path.join(root, '.local', 'access-org0.json'), content = JSON.stringify({ password: 'test-existing-local-password' });
  await writeFile(file, content);
  assert.equal(await existingLabPassword(root, 'org0'), 'test-existing-local-password');
  assert.equal(await existingLabPassword(root, '../org0'), undefined);
  assert.equal(await existingLabPassword(root, 'org4'), undefined, 'contractor keeps its separate access mechanism');
  assert.equal(await readFile(file, 'utf8'), content);
  await writeFile(file, JSON.stringify({ password: 'short' }));
  await assert.rejects(existingLabPassword(root, 'org0'), /access is invalid/);
});

test('bootstrap account reuse passes the password privately to the child environment, never its command line', () => {
  let spawned;
  spawnLabChild({ rootDir: 'lab-root', instanceDir: 'new-session', org: 'org0', port: 4400,
    bootstrapPassword: 'test-existing-local-password',
    spawnProcess: (executable, args, options) => { spawned = { executable, args, options }; return {}; } });
  assert.equal(spawned.options.env.AIDSCALER_BOOTSTRAP_PASSWORD, 'test-existing-local-password');
  assert.ok(!spawned.args.join(' ').includes('test-existing-local-password'));
  assert.equal(spawned.options.env.AIDSCALER_LOCAL_DIR, 'new-session');
});
