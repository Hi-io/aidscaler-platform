import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const sdk = '/home/hiio/.local/aidscaler-tools/google-cloud-sdk/bin/gcloud';
function command(args) {
  const result = spawnSync(process.platform === 'win32' ? 'wsl.exe' : sdk,
    process.platform === 'win32' ? ['-d', 'Ubuntu', '--', sdk, ...args] : args, { encoding: 'utf8', windowsHide: true, timeout: 45000 });
  if (result.status !== 0) throw Error('Google Cloud access check failed. Complete gcloud login first.');
  return result.stdout.trim();
}
const account = JSON.parse(command(['auth', 'list', '--format=json'])).find(a => a.status === 'ACTIVE')?.account;
const project = JSON.parse(command(['projects', 'describe', 'aidscaler', '--format=json']));
const billing = JSON.parse(command(['billing', 'projects', 'describe', 'aidscaler', '--format=json']));
const report = { checkedAt: new Date().toISOString(), account, project: project.projectId, projectNumber: project.projectNumber,
  billingEnabled: billing.billingEnabled === true, deploymentAllowed: false, createdPaidResources: false };
if (report.billingEnabled) {
  const token = command(['auth', 'print-access-token']);
  const result = await fetch('https://cloudbilling.googleapis.com/v1/' + billing.billingAccountName, { headers: { Authorization: 'Bearer ' + token } });
  if (result.ok) report.billingCurrency = (await result.json()).currencyCode;
  else if (result.status === 403) {
    const budgets = await fetch('https://billingbudgets.googleapis.com/v1/' + billing.billingAccountName +
      '/budgets?scope=projects%2F439219992256&pageSize=100', { headers: { Authorization: 'Bearer ' + token, 'x-goog-user-project': 'aidscaler' } });
    if (budgets.ok) report.billingCurrency = (await budgets.json()).budgets?.[0]?.amount?.specifiedAmount?.currencyCode;
  }
  report.deploymentAllowed = ['USD', 'THB'].includes(report.billingCurrency);
  if (!report.deploymentAllowed) report.blocker = 'Convert USD budgets to the billing currency before applying infrastructure.';
} else report.blocker = 'Link and enable billing before deploying. Local preparation and tests are available.';
await mkdir('.local/gcp', { recursive: true });
await writeFile('.local/gcp/preflight.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
