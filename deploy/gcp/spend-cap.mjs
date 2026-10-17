import { GoogleAuth } from 'google-auth-library';
export function cloudRunCap(projectNumber, currency = 'USD', units = '10') {
  return { displayName: `AidScaler Cloud Run ${currency} ${units} cap`, budgetFilter: {
    projects: ['projects/' + projectNumber], services: ['services/152E-C115-5142'],
    creditTypesTreatment: 'EXCLUDE_ALL_CREDITS', calendarPeriod: 'MONTH' },
    amount: { specifiedAmount: { currencyCode: currency, units } },
    thresholdRules: [0.5, 0.8, 1].map(thresholdPercent => ({ thresholdPercent })),
    notificationsRule: { enableProjectLevelRecipients: true }, spendCap: { inputState: 'CONFIGURED' } };
}
export async function configureCap({ billingAccount, project = 'aidscaler', projectNumber = '439219992256', accessToken, currency = 'USD', units = '10' }) {
  const token = accessToken ?? await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
  const base = 'https://billingbudgets.googleapis.com/v1/billingAccounts/' + billingAccount + '/budgets';
  const headers = { Authorization: 'Bearer ' + token, 'x-goog-user-project': project, 'Content-Type': 'application/json' };
  // Project owners can manage their own budgets without account-wide IAM.
  const listing = await fetch(base + '?pageSize=100&scope=' + encodeURIComponent('projects/' + projectNumber), { headers });
  if (!listing.ok) throw Error('Cannot inspect billing protection (' + listing.status + '). Deployment stopped.');
  const spec = cloudRunCap(projectNumber, currency, units);
  const old = (await listing.json()).budgets?.find(b => b.displayName === spec.displayName);
  if (old) {
    const state = old.spendCap?.outputState ?? old.spendCap?.inputState;
    if (state !== 'CONFIGURED' || old.amount?.specifiedAmount?.units !== units ||
        old.amount?.specifiedAmount?.currencyCode !== currency ||
        old.budgetFilter?.projects?.[0] !== 'projects/' + projectNumber ||
        old.budgetFilter?.services?.[0] !== 'services/152E-C115-5142')
      throw Error('Existing Cloud Run cap needs review. It was not silently lifted or changed.');
    console.log(`Cloud Run ${currency} ${units} cap already configured.`); return;
  }
  const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify(spec) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Error('Cloud Run spend cap could not be created (' + response.status + '): ' +
      (error.error?.message ?? 'Request rejected') + '. Deployment stopped.');
  }
  const created = await response.json();
  // The API rejects a currency different from the account currency; verify
  // the returned amount before creating any continuously billed resources.
  if (created.amount?.specifiedAmount?.currencyCode !== currency || created.amount?.specifiedAmount?.units !== units ||
      (created.spendCap?.outputState ?? created.spendCap?.inputState) !== 'CONFIGURED')
    throw Error('Cloud Run cap currency or enforcement was not confirmed. Deployment stopped.');
  console.log(`Cloud Run ${currency} ${units} cap configured; Gemini spending remains separate.`);
}
if (process.argv[1]?.endsWith('spend-cap.mjs')) {
  if (!process.env.GCP_BILLING_ACCOUNT) throw Error('Set GCP_BILLING_ACCOUNT before configuring the cap.');
  await configureCap({ billingAccount: process.env.GCP_BILLING_ACCOUNT, accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN,
    currency: process.env.BUDGET_CURRENCY ?? 'USD', units: process.env.CLOUD_RUN_CAP_UNITS ?? '10' });
}
