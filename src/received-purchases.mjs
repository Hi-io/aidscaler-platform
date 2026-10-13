import { check } from "./errors.mjs";
import { hash } from "./store.mjs";

/** Caller owns the transaction. Only delivered actor finance queries supply
 * purchase facts; an action ACK, foreign owner, pending query or payment cannot.
 * sourceVersion changes only when purchase/expense facts change, not read time.
 */
export async function persistReceivedPurchases(store, org, state) {
  check(state.organization?.id === org, "FINANCE_OWNER", "The finance source does not belong to this organization.", 403);
  const query = (state.queries ?? []).filter(q => q.org === org && q.target === "finance" && q.state === "ready" && q.result?.sandbox === true &&
    typeof q.id === "string" && Number.isSafeInteger(q.completedAt ?? q.readyAt) && (q.completedAt ?? q.readyAt) >= 0)
    .sort((a,b) => (b.result.version ?? 0) - (a.result.version ?? 0) || (b.completedAt ?? b.readyAt) - (a.completedAt ?? a.readyAt))[0];
  if (!query) return null;
  check(query.result.org === undefined || query.result.org === org, "FINANCE_OWNER", "The received finance snapshot belongs to another organization.", 403);
  const observedAt = query.completedAt ?? query.readyAt;
  for (const purchase of query.result.purchases ?? []) {
    check(purchase.org === org && typeof purchase.id === "string", "FINANCE_OWNER", "A source purchase belongs to another organization.", 403);
    check(Number.isSafeInteger(purchase.quantity) && purchase.quantity > 0 && Number.isSafeInteger(purchase.cost) && purchase.cost > 0 &&
      (purchase.currency === undefined || purchase.currency === "sandbox_credit") &&
      (purchase.receivedQuantity === undefined || (Number.isSafeInteger(purchase.receivedQuantity) && purchase.receivedQuantity >= 0 && purchase.receivedQuantity <= purchase.quantity)),
      "FINANCE_RECEIPT", "The source purchase has invalid units, cost or physical receipt quantity.", 409);
    const entries = (query.result.entries ?? []).filter(e => e.org === org && e.type === "spent" && e.reference === purchase.id),
      materialHash = hash([purchase, entries]), prior = await store.get(org, "source_purchase", purchase.id, false);
    if (prior && (prior.materialHash === materialHash ||
      Number.isSafeInteger(purchase.version) && Number.isSafeInteger(prior.sourcePurchaseVersion) && purchase.version < prior.sourcePurchaseVersion ||
      Number.isSafeInteger(query.result.version) && Number.isSafeInteger(prior.sourceFinanceVersion) && query.result.version < prior.sourceFinanceVersion ||
      !Number.isSafeInteger(purchase.version) && !Number.isSafeInteger(query.result.version) && prior.observedAt > observedAt)) continue;
    const sourceVersion = (prior?.sourceVersion ?? 0) + 1;
    await store.put(org, "source_purchase", purchase.id, { purchase, entries, sandbox: true, sourceUnit: "sandbox_credit",
      materialHash, sourceVersion, sourcePurchaseVersion: purchase.version ?? null, sourceFinanceVersion: query.result.version ?? null,
      queryId: query.id, observedAt, confirmedBySource: true }, prior?.version ?? 0);
    const reconciled = await store.get(org, "purchase_reconciliation", purchase.id, false);
    if (reconciled) await store.put(org, "purchase_reconciliation", purchase.id, { ...reconciled,
      purchase, sourceVersion, queryId: query.id, observedAt,
      financialReviewRequired: purchase.cost !== reconciled.conversion.sourceAmount || entries.length !== 1 || entries[0]?.amount !== purchase.cost,
      physicalState: purchase.state, physicalReceived: Number.isSafeInteger(purchase.receivedQuantity) ? purchase.receivedQuantity : null,
      physicalReceivedAt: purchase.receivedAt ?? null }, reconciled.version);
  }
  return query;
}
