import { writeFile } from 'node:fs/promises';

// Read-only inspection of the two isolated evaluation workspaces. The login is
// the fixture credential declared in createHarness, not a production secret.
const ports = process.argv.slice(2).map(Number);
const profiles = [];
for (const port of ports) {
  const base = 'http://127.0.0.1:' + port;
  try {
    const login = await fetch(base + '/api/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'commander@org0.nexo.local', password: 'evaluation-password' }),
      signal: AbortSignal.timeout(1500) });
    if (!login.ok) continue;
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    const headers = { Cookie: cookie };
    const get = async endpoint => {
      const response = await fetch(base + endpoint, { headers, signal: AbortSignal.timeout(3000) });
      if (!response.ok) return { status: response.status };
      return response.json();
    };
    const [activity, usage, proposal] = await Promise.all([
      get('/api/records?kind=activity'), get('/api/usage'), get('/api/records?kind=proposal'),
    ]);
    profiles.push({ port,
      activity: Array.isArray(activity) ? activity.map(a => ({
        id: a.id, state: a.state, calls: a.calls, startedAt: a.startedAt,
        finishedAt: a.finishedAt, reason: a.reason,
        steps: a.steps?.slice(-4).map(s => ({ tool: s.tool, state: s.state,
          at: s.at, error: s.result?.error, label: s.label })),
      })) : activity,
      usage,
      proposals: Array.isArray(proposal) ? proposal.map(p => ({
        id: p.id, state: p.state, changedReason: p.changedReason,
        actions: p.actions?.map(a => ({ type: a.type, owner: a.owner })),
      })) : proposal,
    });
  } catch (e) { profiles.push({ port, unavailable: true, error: e.name }); }
}
const value = { at: new Date().toISOString(), profiles };
await writeFile(new URL('active-profiles.json', import.meta.url), JSON.stringify(value, null, 2));
console.log(JSON.stringify(profiles.map(p => ({
  port: p.port, unavailable: p.unavailable,
  activeActivity: p.activity?.filter?.(a => !a.finishedAt),
  usageCount: p.usage?.length,
  latestUsage: p.usage?.[0],
  knownCost: p.usage?.reduce?.((sum, u) => sum + (u.cost_usd ?? 0), 0),
  unsettledOrUnknownCost: p.usage?.filter?.(u => u.cost_usd == null).length,
})), null, 2));
