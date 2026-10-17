import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';
const root = path.resolve('.local/gcp/hosting'), site = 'aidscaler';
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
async function api(url, method, value) {
  const response = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-goog-user-project': 'aidscaler' },
    ...(value ? { body: JSON.stringify(value) } : {}) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Error('Hosting API returned ' + response.status + ': ' + (error.error?.message ?? 'Request rejected'));
  }
  return response.json();
}
const base = 'https://firebasehosting.googleapis.com/v1beta1';
const version = await api(base + '/sites/' + site + '/versions', 'POST', { config: {
  rewrites: ['/demo/api/**', '/demo/workspace/**'].map(glob => ({ glob, run: { serviceId: 'aidscaler-api', region: 'us-central1' } })),
  headers: [{ glob: '**', headers: { 'X-Content-Type-Options': 'nosniff' } },
    { glob: '**/*.html', headers: { 'Cache-Control': 'public,max-age=0,must-revalidate' } }] } });
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      const bytes = gzipSync(await readFile(file)), digest = createHash('sha256').update(bytes).digest('hex');
      files.push({ name: '/' + path.relative(root, file).split(path.sep).join('/'), bytes, digest });
    }
  }
}
await walk(root);
for (let offset = 0; offset < files.length; offset += 1000) {
  const batch = files.slice(offset, offset + 1000);
  const upload = await api(base + '/' + version.name + ':populateFiles', 'POST', { files: Object.fromEntries(batch.map(f => [f.name, f.digest])) });
  const missing = new Set(upload.uploadRequiredHashes ?? []);
  for (const file of batch.filter(f => missing.has(f.digest))) {
    const response = await fetch(upload.uploadUrl + '/' + file.digest, { method: 'POST', headers: {
      Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream', 'x-goog-user-project': 'aidscaler' }, body: file.bytes });
    if (!response.ok) throw Error('Hosting file upload failed (' + response.status + ').');
  }
}
await api(base + '/' + version.name + '?updateMask=status', 'PATCH', { status: 'FINALIZED' });
await api(base + '/sites/' + site + '/releases?versionName=' + encodeURIComponent(version.name), 'POST');
console.log('Published https://aidscaler.web.app. Custom-domain DNS cutover is a separate deployment step.');
