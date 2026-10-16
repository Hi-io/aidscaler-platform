import path from 'node:path';
import { readFile } from 'node:fs/promises';

// The viewer and all organization connectors share this one source world.
// Simulator evaluation defaults remain separate from the interactive product lab.
export function laboratoryConfig(env = process.env) {
  const topology = env.AIDSCALER_TOPOLOGY ?? 'takamatsu';
  return {
    scenario: env.AIDSCALER_SCENARIO ?? 'S01',
    organizations: 5,
    seed: env.AIDSCALER_SEED ?? 'aidscaler-development-001',
    grid: topology === 'takamatsu' ? 66 : 9,
    extentKm: topology === 'takamatsu' ? 10 : 12,
    topology,
    hazard: env.AIDSCALER_HAZARD ?? 'none',
    durationMs: 21600000,
    policy: 'none',
    mode: 'interactive',
    clockLatency: 'wall',
    continuousDemo: true,
    maxEvents: 100000000,
    modelCallLimit: 100000,
    postsPerHour: 240,
    backgroundTraffic: 30,
    packetLoss: 0,
    observationRate: 1,
    sourceRequestLimit: 5000,
  };
}

export async function existingLabPassword(rootDir, org) {
  if (!/^org[0-3]$/.test(org)) return undefined;
  let access;
  try {
    access = JSON.parse(await readFile(path.join(rootDir, '.local', `access-${org}.json`), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (typeof access.password !== 'string' || access.password.length < 12)
    throw Error(`Existing ${org} access is invalid. Preserve its access file before starting a new lab.`);
  return access.password;
}
