export function infrastructureBudgetEvent(message, now = Date.now(), policy = {}) {
  const { currency = 'USD', units = 100, pause = 70 } = policy;
  if (message.budgetDisplayName !== `AidScaler infrastructure ${currency} ${units}` || message.currencyCode !== currency ||
      !Number.isFinite(message.costAmount) || message.costAmount < 0) throw Error('BUDGET_SCOPE');
  const start = new Date(message.costIntervalStart);
  if (!Number.isFinite(start.getTime()) || start.getUTCFullYear() !== new Date(now).getUTCFullYear() ||
      start.getUTCMonth() !== new Date(now).getUTCMonth()) return { stale: true };
  return { month: start.toISOString().slice(0, 7), cost: message.costAmount,
    pause: message.costAmount >= pause || Number(message.forecastThresholdExceeded ?? 0) >= 1 };
}
