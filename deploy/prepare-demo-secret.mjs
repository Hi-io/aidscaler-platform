import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

// Run from the platform checkout. The output is a private local file, never
// stdout; apply it to the user's cluster without printing its JSON contents.
try { process.loadEnvFile('.env.local'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const output = path.resolve('.local/kubernetes-demo/credentials.json');
await mkdir(path.dirname(output), { recursive: true });
let exists = false;
try { await readFile(output); exists = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (exists) console.log('Existing private demo credentials retained.');
else {
  if (!process.env.OPENROUTER_API_KEY) throw Error('Set OPENROUTER_API_KEY through the local environment before provisioning.');
  const password = randomBytes(32).toString('base64url');
  const secret = { apiVersion:'v1', kind:'Secret', type:'Opaque', metadata:{name:'demo-credentials',namespace:'aidscaler'}, stringData:{
    POSTGRES_PASSWORD:password,
    DATABASE_URL:`postgresql://aidscaler:${password}@demo-postgres.aidscaler.svc.cluster.local:5432/aidscaler_demo`,
    OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY,
    DEMO_SESSION_SECRET:randomBytes(48).toString('base64url'),
  }};
  await writeFile(output, JSON.stringify(secret), {mode:0o600, flag:'wx'});
  console.log('Private demo credentials prepared under ignored .local/kubernetes-demo/. Values were not printed.');
}
