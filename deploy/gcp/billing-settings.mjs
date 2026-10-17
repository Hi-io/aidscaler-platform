import { mkdir, writeFile } from 'node:fs/promises';
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN, account = process.env.GCP_BILLING_ACCOUNT;
if (!token || !account) throw Error('Billing authentication required.');
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-goog-user-project': 'aidscaler' };
const base = 'https://billingbudgets.googleapis.com/v1/billingAccounts/' + account + '/budgets';
async function get(url) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers });
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt >= 3) return response;
    await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}
let currency;
const response = await get('https://cloudbilling.googleapis.com/v1/billingAccounts/' + account);
if (response.ok) currency = (await response.json()).currencyCode;
else if (response.status !== 403) throw Error('Billing account check failed (' + response.status + ').');
if (!currency) {
  const listing = await get(base + '?scope=projects%2F439219992256&pageSize=100');
  if (!listing.ok) throw Error('Cannot inspect project budgets (' + listing.status + ').');
  const budgets = (await listing.json()).budgets ?? [];
  currency = budgets[0]?.amount?.specifiedAmount?.currencyCode;
  for (const budget of budgets.filter(b => b.displayName === 'AidScaler setup currency check' &&
      Number(b.amount?.specifiedAmount?.units ?? 0) === 0 && !b.spendCap)) {
    const removed = await fetch('https://billingbudgets.googleapis.com/v1/' + budget.name, { method: 'DELETE', headers });
    if (!removed.ok) throw Error('Currency probe cleanup failed.');
  }
}
if (!currency) {
  // A zero-cost budget probe resolves currency without account-wide access.
  const probe = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ displayName: 'AidScaler setup currency check',
    budgetFilter: { projects: ['projects/439219992256'] }, amount: { specifiedAmount: { units: '0' } }, thresholdRules: [{ thresholdPercent: 1 }] }) });
  if (!probe.ok) throw Error('Cannot verify billing currency (' + probe.status + ').');
  const budget = await probe.json(); currency = budget.amount?.specifiedAmount?.currencyCode;
  const removed = await fetch('https://billingbudgets.googleapis.com/v1/' + budget.name, { method: 'DELETE', headers });
  if (!removed.ok) throw Error('Currency probe cleanup failed.');
}
const policy = currency === 'USD' ? { units: 100, pause: 70, runCap: '10' } : currency === 'THB' ? { units: 3000, pause: 2100, runCap: '300' } : null;
if (!policy) throw Error('Review a conservative USD-equivalent budget for currency ' + currency + ' before deployment.');
// THB: 33.541/USD, Bank of Thailand 2026-10-15. Use only 30/USD for
// the infrastructure ceiling, leaving approximately 10% FX/tax headroom.
const report = { checkedAt: new Date().toISOString(), account, currency, ...policy };
await mkdir('.local/gcp', { recursive: true });
await writeFile('.local/gcp/billing.json', JSON.stringify(report, null, 2));
console.log(`Verified ${currency}: infrastructure ${policy.units}, preventive pause ${policy.pause}, Cloud Run cap ${policy.runCap}.`);
