import { AppError, check } from './errors.mjs';

// This adapter alone holds the observer capability. Agents receive only their
// ordinary organization-scoped actor keys and the separate source URL.
export function createDemoSource({ observerUrl, sourceUrl, observerKey, fetcher = fetch, baseOrganizations = [] }) {
  const actors = new Map();
  async function request(route, body) {
    check(['/api/demo/bootstrap', '/api/demo/frame', '/api/demo/organizations', '/api/demo/organizations/release', '/api/actors/provision'].includes(route), 'DEMO_SOURCE_SCOPE', 'Unsupported internal demo operation.', 403);
    const response = await fetcher(observerUrl + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + observerKey, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new AppError(data.error ?? 'DEMO_SOURCE', data.message ?? 'The simulation is reconnecting.', response.status);
    return data;
  }
  return {
    request, sourceUrl, baseOrganizations,
    async credentials(org) {
      if (actors.get(org)?.expiresAt > Date.now() + 12 * 3600000) return actors.get(org);
      const keys = {};
      for (const role of ['agent', 'commander']) {
        const result = await request('/api/actors/provision', { org, role, id: `demo-${role}-${org}`, ttlMs: 604800000 });
        keys[role] = result.key;
      }
      keys.expiresAt = Date.now() + 604800000; actors.set(org, keys); return keys;
    },
    async serveViewer(req, res, filename) {
      check(['spectator-map.mjs', 'spectator-activity.mjs', 'motion.js', 'geometry.js', 'vendor/build/three.core.js'].includes(filename) || /^vendor\/(?:build\/three(?:\.core)?\.module\.js|examples\/jsm\/(?:controls\/OrbitControls|utils\/BufferGeometryUtils)\.js)$/.test(filename), 'DEMO_VIEWER_ASSET', 'This spectator asset does not exist.', 404);
      const response = await fetcher(observerUrl + '/' + filename, { headers: { Authorization: 'Bearer ' + observerKey }, signal: AbortSignal.timeout(15000) });
      check(response.ok, 'DEMO_VIEWER_ASSET', 'This spectator asset is unavailable.', response.status);
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); res.end(Buffer.from(await response.arrayBuffer()));
    },
  };
}
