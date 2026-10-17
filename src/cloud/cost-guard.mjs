export function infrastructureBudgetEvent(message, now = Date.now()) {
  if (message.budgetDisplayName !== 'AidScaler infrastructure USD 100' || message.currencyCode !== 'USD' ||
      !Number.isFinite(message.costAmount) || message.costAmount < 0) throw Error('BUDGET_SCOPE');
  const start = new Date(message.costIntervalStart);
  if (!Number.isFinite(start.getTime()) || start.getUTCFullYear() !== new Date(now).getUTCFullYear() ||
      start.getUTCMonth() !== new Date(now).getUTCMonth()) return { stale: true };
  return { month: start.toISOString().slice(0, 7), cost: message.costAmount,
    pause: message.costAmount >= 70 || Number(message.forecastThresholdExceeded ?? 0) >= 1 };
}
