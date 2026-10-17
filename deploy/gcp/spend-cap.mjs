import { GoogleAuth } from 'google-auth-library';
export function cloudRunCap(projectNumber) {
  return { displayName: 'AidScaler Cloud Run USD 10 cap', budgetFilter: {
    projects: ['projects/' + projectNumber], services: ['services/152E-C115-5142'],
    creditTypesTreatment: 'EXCLUDE_ALL_CREDITS', calendarPeriod: 'MONTH' },
    amount: { specifiedAmount: { currencyCode: 'USD', units: '10' } },
    thresholdRules: [0.5, 0.8, 1].map(thresholdPercent => ({ thresholdPercent })),
    notificationsRule: { enableProjectLevelRecipients: true }, spendCap: { inputState: 'CONFIGURED' } };
}
export async function configureCap({ billingAccount, project = 'aidscaler', projectNumber = '439219992256', accessToken }) {
  const token = accessToken ?? await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
  const base = 'https://billingbudgets.googleapis.com/v1/billingAccounts/' + billingAccount + '/budgets';
  const headers = { Authorization: 'Bearer ' + token, 'x-goog-user-project': project, 'Content-Type': 'application/json' };
  const listing = await fetch(base + '?pageSize=1000', { headers });
  if (!listing.ok) throw Error('Cannot inspect billing protection (' + listing.status + '). Deployment stopped.');
  const spec = cloudRunCap(projectNumber);
  const old = (await listing.json()).budgets?.find(b => b.displayName === spec.displayName);
  if (old) {
    const state = old.spendCap?.outputState ?? old.spendCap?.inputState;
    if (state !== 'CONFIGURED' || old.amount?.specifiedAmount?.units !== '10' ||
        old.budgetFilter?.projects?.[0] !== 'projects/' + projectNumber ||
        old.budgetFilter?.services?.[0] !== 'services/152E-C115-5142')
      throw Error('Existing Cloud Run cap needs review. It was not silently lifted or changed.');
    console.log('Cloud Run USD 10 cap already configured.'); return;
  }
  const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify(spec) });
  if (!response.ok) throw Error('Cloud Run spend cap could not be created (' + response.status + '). Deployment stopped.');
  console.log('Cloud Run USD 10 cap configured; Gemini spending remains separate.');
}
if (process.argv[1]?.endsWith('spend-cap.mjs')) {
  if (!process.env.GCP_BILLING_ACCOUNT) throw Error('Set GCP_BILLING_ACCOUNT before configuring the cap.');
  await configureCap({ billingAccount: process.env.GCP_BILLING_ACCOUNT, accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN });
}
