import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Finance } from "../src/finance.mjs";
import { persistReceivedPurchases } from "../src/received-purchases.mjs";
import { createFinanceControls, publicProcurement } from "../ui/finance.mjs";
import { createHarness, scriptedReview } from "../evaluation/harness.mjs";

const org = "org0", actor = { id: "financial-reviewer", org, role: "finance" },
  conversion = { sourceUnit: "sandbox_credit", sourceAmount: 10, currency: "USD", amountCents: 500 };
function sourceState({ quantity = 0, state = "ordered", at = 100, queryState = "ready", expense = 10, owner = org } = {}) {
  const purchase = { id: "purchase-own", org: owner, type: "water", unit: "L", quantity: 10,
    receivedQuantity: quantity, cost: 10, currency: "sandbox_credit", state, version: quantity + 1,
    receipts: quantity ? [{ id: "partial-receipt", quantity, receivedAt: at - 10, resource: "private-depot" }] : [],
    supplier: "private supplier", privateLocation: "private location", expectedArrivalAt: 1000 };
  return { organization: { id: org }, queries: [{ id: "query-" + at, org, target: "finance", state: queryState,
    readyAt: at, completedAt: queryState === "ready" ? at : undefined,
    result: { sandbox: true, org, currency: "sandbox_credit", purchases: [purchase],
      entries: [{ id: "spent-own", org: owner, type: "spent", reference: purchase.id, amount: expense }] } }] };
}
async function fixture(t, state = sourceState()) {
  const store = await Store.open(); t.after(() => store.close());
  await store.organization(org);
  const connector = { state: async () => state, action: async (type, params) => ({ type, ...params, state: "pending" }) },
    finance = new Finance(store, { org, secret: "test-finance-signature" }, connector),
    donation = await finance.checkout(org, { amountCents: 1000 }),
    settled = { org, id: donation.id, eventId: "donation-settled", state: "settled" };
  await finance.webhook(settled, finance.signature(settled));
  const allocation = await finance.allocate(actor, { amountCents: 800, reason: "Reviewed water procurement budget" }, "allocate-budget");
  return { store, finance, connector, allocation, donation, setState: next => { state = next; } };
}
const input = (allocation, sourceVersion = 1) => ({ allocationId: allocation.id, purchaseId: "purchase-own", sourceVersion,
  conversion, reason: "Human approval: source ten sandbox credits mapped to five test USD, not a rate or stock creation." });

test("received finance query material versions ignore repeated reads and reject pending or foreign receipts atomically", async t => {
  const { store } = await fixture(t);
  assert.equal(await store.transaction(tx => persistReceivedPurchases(tx, org, sourceState({ queryState: "pending" }))), null);
  assert.equal((await store.list(org, "source_purchase")).length, 0);
  await store.transaction(tx => persistReceivedPurchases(tx, org, sourceState()));
  const first = await store.get(org, "source_purchase", "purchase-own");
  await store.transaction(tx => persistReceivedPurchases(tx, org, sourceState({ at: 200 })));
  assert.equal((await store.get(org, "source_purchase", first.id)).sourceVersion, first.sourceVersion);
  await store.transaction(tx => persistReceivedPurchases(tx, org, sourceState({ quantity: 6, state: "partial", at: 300 })));
  const partial = await store.get(org, "source_purchase", first.id);
  assert.equal(partial.sourceVersion, first.sourceVersion + 1);
  await store.transaction(tx => persistReceivedPurchases(tx, org, sourceState({ at: 150 })));
  assert.equal((await store.get(org, "source_purchase", first.id)).purchase.receivedQuantity, 6);
  const foreign = sourceState({ owner: "org1", at: 400 });
  await assert.rejects(() => store.transaction(tx => persistReceivedPurchases(tx, org, foreign)), e => e.code === "FINANCE_OWNER");
  assert.equal((await store.get(org, "source_purchase", first.id)).sourceVersion, partial.sourceVersion);
});

test("only an explicit financial reviewer can map exact source spending within an allocation; staleness, ACKs and missing expense cannot", async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.finance.reconcile({ ...actor, role: "agent" }, input(f.allocation), "model-attempt"), e => e.code === "FORBIDDEN");
  await assert.rejects(() => f.finance.reconcile(actor, { ...input(f.allocation), conversion: undefined }, "missing-conversion"), e => e.code === "FINANCE_CONVERSION");
  f.setState(sourceState({ queryState: "pending" }));
  await assert.rejects(() => f.finance.reconcile(actor, input(f.allocation), "pending-query"), e => e.code === "NOT_FOUND");
  f.setState(sourceState({ expense: 9 }));
  await assert.rejects(() => f.finance.reconcile(actor, input(f.allocation), "wrong-expense"), e => e.code === "FINANCE_SPEND");
  f.setState(sourceState({ at: 200 }));
  await assert.rejects(() => f.finance.reconcile(actor, input(f.allocation), "stale-version"), e => e.code === "FINANCE_VERSION");
  const received = (await f.finance.purchases(actor)).records[0];
  await assert.rejects(() => f.finance.reconcile(actor, { ...input(f.allocation, received.sourceVersion), conversion: { ...conversion, amountCents: 801 } }, "overspend"), e => e.code === "FINANCE_ALLOCATION");
  assert.equal((await f.finance.summary(org)).spentCents, 0);
  assert.equal((await f.store.list(org, "purchase_reconciliation")).length, 0);
});

test("a late or same-clock older source snapshot cannot regress an approved partial or final receipt", async t => {
  const f = await fixture(t);
  await f.finance.reconcile(actor, input(f.allocation), "before-late-query");
  const partial = sourceState({ quantity: 6, state: "partial", at: 200 }); partial.queries[0].result.version = 2;
  f.setState(partial); await f.finance.purchases(actor);
  const stale = sourceState({ at: 500 }); stale.queries[0].result.version = 1;
  f.setState(stale); await f.finance.purchases(actor);
  assert.equal((await f.store.get(org, "purchase_reconciliation", "purchase-own")).physicalReceived, 6);
  const final = sourceState({ quantity: 10, state: "received", at: 200 }); final.queries[0].result.version = 3;
  f.setState({ ...final, queries: [...stale.queries, ...final.queries] }); await f.finance.purchases(actor);
  assert.equal((await f.store.get(org, "purchase_reconciliation", "purchase-own")).physicalReceived, 10);
  const sameClockOld = sourceState({ quantity: 6, state: "partial", at: 200 }); sameClockOld.queries[0].result.version = 2;
  f.setState(sameClockOld); await f.finance.purchases(actor);
  assert.equal((await f.store.get(org, "source_purchase", "purchase-own")).purchase.receivedQuantity, 10);
});

test("source spend reconciliation is atomic across the ledger, approval and idempotency record when persistence fails", async t => {
  const f = await fixture(t); await f.finance.purchases(actor);
  const transaction = f.store.transaction.bind(f.store);
  let failed = false;
  f.store.transaction = fn => transaction(async tx => {
    const put = tx.put.bind(tx);
    tx.put = async (...args) => {
      if (args[1] === "purchase_reconciliation" && !failed) { failed = true; throw Object.assign(new Error("Injected unavailable DB write"), { code: "STORAGE_WRITE" }); }
      return put(...args);
    };
    return fn(tx);
  });
  await assert.rejects(() => f.finance.reconcile(actor, input(f.allocation), "atomic-spend-retry"), e => e.code === "STORAGE_WRITE");
  assert.equal((await f.finance.summary(org)).spentCents, 0);
  assert.equal((await f.store.list(org, "purchase_reconciliation")).length, 0);
  assert.equal((await f.store.query("SELECT COUNT(*) AS n FROM idempotency WHERE key='atomic-spend-retry'")).rows[0].n, 0);
  f.store.transaction = transaction;
  await f.finance.reconcile(actor, input(f.allocation), "atomic-spend-retry");
  assert.equal((await f.finance.summary(org)).spentCents, 500);
});

test("concurrent reconciliation charges once, source partial receipts never release spent funds or enable refunds", async t => {
  const f = await fixture(t), [a,b] = await Promise.all([
    f.finance.reconcile(actor, input(f.allocation), "reconcile-one"),
    f.finance.reconcile(actor, input(f.allocation), "reconcile-two"),
  ]);
  assert.equal(a.expenseId, b.expenseId);
  assert.equal(a.physicalReceived, 0); assert.equal(a.physicalState, "ordered");
  let balance = await f.finance.summary(org);
  assert.equal(balance.availableCents, 200); assert.equal(balance.spentCents, 500); assert.equal(balance.unspentAllocatedCents, 300);
  assert.equal((await f.store.query("SELECT COUNT(*) AS n FROM finance WHERE type='spent'")).rows[0].n, 1);
  await assert.rejects(() => f.finance.reconcile(actor, { ...input(f.allocation), conversion: { ...conversion, amountCents: 400 } }, "alter-mapping"), e => e.code === "FINANCE_RECONCILED");
  f.setState(sourceState({ quantity: 6, state: "partial", at: 300 }));
  await f.finance.purchases(actor);
  const partial = await f.store.get(org, "purchase_reconciliation", a.id);
  assert.equal(partial.physicalReceived, 6); assert.equal(partial.physicalState, "partial"); assert.equal(partial.approvedSourceVersion, 1);
  await assert.rejects(() => f.finance.release(actor, { allocationId: f.allocation.id, amountCents: 301, reason: "Cannot release spent funds" }, "release-too-much"), e => e.code === "RELEASE_AMOUNT");
  await f.finance.release(actor, { allocationId: f.allocation.id, amountCents: 300, reason: "Unused approved budget" }, "release-unspent");
  balance = await f.finance.summary(org);
  assert.equal(balance.availableCents, 500); assert.equal(balance.spentCents, 500); assert.equal(balance.unspentAllocatedCents, 0);
  const refund = { org, id: f.donation.id, eventId: "refund-spent", state: "refunded" };
  await assert.rejects(() => f.finance.webhook(refund, f.finance.signature(refund)), e => e.code === "REFUND_FUNDS");
  assert.equal((await f.finance.summary(org)).refundedCents, 0);
});

test("public procurement is a deliberate material-version approval, privacy-safe and frozen at partial receipt until reviewed again", async t => {
  const f = await fixture(t);
  await f.finance.reconcile(actor, input(f.allocation), "review-purchase");
  assert.equal(await f.finance.publicSummary(org), null);
  const ordered = await f.finance.reviewSnapshot(actor);
  assert.equal(ordered.snapshot.procurement[0].receivedQuantity, 0);
  f.setState(sourceState({ quantity: 6, state: "partial", at: 200 }));
  await assert.rejects(() => f.finance.publishSummary(actor, { reviewVersion: ordered.reviewVersion, reason: "Old view" }, "stale-public"), e => e.code === "FINANCE_VERSION");
  const partial = await f.finance.reviewSnapshot(actor);
  await assert.rejects(() => f.finance.publishSummary({ ...actor, role: "publisher" }, { reviewVersion: partial.reviewVersion, reason: "Wrong authority" }, "publisher-public"), e => e.code === "FORBIDDEN");
  await f.finance.publishSummary(actor, { reviewVersion: partial.reviewVersion, reason: "Partial stock receipt reviewed" }, "publish-partial");
  let publiclyReviewed = await f.finance.publicSummary(org), g = publiclyReviewed.snapshot.procurement[0];
  assert.equal(g.receivedQuantity, 6); assert.equal(g.pendingQuantity, 4); assert.equal(g.partialOrders, 1); assert.equal(g.receivedOrders, 0);
  for (const privateValue of ["private supplier", "private location", "private-depot", "purchase-own", actor.id]) assert.equal(JSON.stringify(publiclyReviewed).includes(privateValue), false);
  f.setState(sourceState({ quantity: 10, state: "received", at: 400 })); await f.finance.purchases(actor);
  assert.equal((await f.finance.publicSummary(org)).snapshot.procurement[0].receivedQuantity, 6, "automatic source refresh cannot publish the later receipt");
  const final = await f.finance.reviewSnapshot(actor);
  await f.finance.publishSummary(actor, { reviewVersion: final.reviewVersion, reason: "Final organization receipt reviewed" }, "publish-final");
  publiclyReviewed = await f.finance.publicSummary(org);
  assert.equal(publiclyReviewed.snapshot.procurement[0].receivedQuantity, 10);
  assert.equal(publiclyReviewed.snapshot.procurement[0].receivedOrders, 1);
  assert.match(publicProcurement(publiclyReviewed, String, String), /Stock receipt is not delivery to people/);
});

test("changed source spending preserves the original approved expense and requires financial review instead of silently changing the conversion", async t => {
  const f = await fixture(t);
  await f.finance.reconcile(actor, input(f.allocation), "initial-financial-approval");
  const priorReview = await f.finance.reviewSnapshot(actor);
  await f.finance.publishSummary(actor, { reviewVersion: priorReview.reviewVersion, reason: "Initial expense reviewed" }, "public-original-expense");
  const changed = sourceState({ quantity: 6, state: "partial", at: 300, expense: 12 });
  changed.queries[0].result.purchases[0].cost = 12;
  changed.queries[0].result.version = 2;
  f.setState(changed); await f.finance.purchases(actor);
  const receipt = await f.store.get(org, "purchase_reconciliation", "purchase-own");
  assert.equal(receipt.financialReviewRequired, true);
  assert.equal(receipt.approvedPurchase.cost, 10); assert.equal(receipt.purchase.cost, 12);
  assert.deepEqual(receipt.conversion, conversion); assert.equal((await f.finance.summary(org)).spentCents, 500);
  const review = await f.finance.reviewSnapshot(actor);
  assert.equal(review.snapshot.pendingReviewCount, 1); assert.equal(review.snapshot.mappedPurchaseCount, 0);
  assert.deepEqual(review.snapshot.procurement, []);
  await assert.rejects(() => f.finance.publishSummary(actor, { reviewVersion: priorReview.reviewVersion, reason: "Stale approval" }, "stale-financial-summary"), e => e.code === "FINANCE_VERSION");
  assert.equal((await f.finance.publicSummary(org)).snapshot.mappedPurchaseCount, 1, "the previous public review remains dated and unchanged, not silently rewritten");
  assert.equal((await f.store.query("SELECT COUNT(*) AS n FROM finance WHERE type='spent'")).rows[0].n, 1);
});

test("financial UI keeps purchases collapsed, requires explicit conversion and gives auditors no accounting authority", async () => {
  const snapshot = { spentCents: 0, mappedPurchaseCount: 0, pendingReviewCount: 1, procurement: [] },
    responses = { "/api/finance/ledger": [], "/api/finance/allocations": [{ id: "budget", reference: "Water", remaining: 800 }],
      "/api/finance/purchases": { records: [{ id: "purchase", sourceVersion: 1, purchase: { type: "water", cost: 10, quantity: 10, unit: "L", receivedQuantity: 6, state: "partial" } }], pendingQueries: [] },
      "/api/finance/review-snapshot": { reviewVersion: "material", snapshot } },
    state = { user: actor }, controls = createFinanceControls({ api: async url => responses[url], escape: String, state, table: () => "", toast() {}, render() {} });
  let html = await controls.view();
  assert.match(html, /<details class="collapse"><summary>Source purchases/);
  assert.match(html, /6 \/ 10 L/); assert.match(html, /No exchange rate is assumed/); assert.match(html, /reconcileform/);
  state.user = { ...actor, role: "auditor" }; html = await controls.view();
  assert.equal(html.includes("reconcileform"), false); assert.equal(html.includes("financepublishform"), false); assert.equal(html.includes("allocateform"), false);
});

test("real HTTP source order and partial receipts reconcile a settled local budget once and publish only the human-reviewed aggregate", { timeout: 90000 }, async t => {
  const h = await createHarness({ config: { grid: 5, extentKm: 2,
    supply: { purchaseTranches: [{ fraction: 0.6, delayMs: 60000 }, { fraction: 0.4, delayMs: 180000 }] } } });
  t.after(() => h.close());
  const app = h.apps[0], w = h.lab.world;
  w.advance(60000); await app.ingestion.sync({ sources: false });
  const login = await fetch(app.url + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "finance@org0.nexo.local", password: "evaluation-password" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0], { csrf } = await login.json(),
    request = async (path, data, key) => {
      const response = await fetch(app.url + path, data === undefined ? { headers: { cookie } } : {
        method: "POST", headers: { cookie, "X-CSRF-Token": csrf, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(data) });
      return { status: response.status, data: await response.json() };
    };
  const requested = await request("/api/finance/source-refresh", {}, "initial-source-finance"); assert.equal(requested.status, 202);
  const stateBefore = await app.connector.state(), sourceBefore = stateBefore.queries.filter(q => q.target === "finance" && q.state === "ready").at(-1).result;
  const donation = await app.finance.checkout(org, { amountCents: 1000 }), settled = { org, id: donation.id, state: "settled", eventId: "s20-local-settlement" };
  const webhook = await fetch(app.url + "/api/finance/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Payment-Signature": app.finance.signature(settled) }, body: JSON.stringify(settled) });
  assert.equal(webhook.status, 200);
  const allocation = await request("/api/finance/allocate", { amountCents: 800, reason: "Human water budget" }, "s20-budget"); assert.equal(allocation.status, 200);
  const p = await app.domain.propose({ id: "purchase-agent", org, role: "agent" }, {
    title: "Purchase water for source stock", summary: "Supplier partial receipt required", benefit: "Stock only after physical receipt",
    rationale: "Source treasury spending and local USD accounting are independent", references: ["r-org0-water"], conditions: [],
    actions: [{ type: "purchase", owner: org, dependsOn: [], params: { type: "water", quantity: 10, price: 1, leadMs: 180000 } }],
  }, "s20-order");
  assert.equal(await scriptedReview(app, p), true);
  assert.equal((await app.worker.execute(p.id)).complete, false);
  await request("/api/finance/source-refresh", {}, "s20-query-order");
  let purchases = (await request("/api/finance/purchases")).data, row = purchases.records[0];
  assert.equal(row.purchase.receivedQuantity, 0); assert.equal(row.purchase.state, "ordered");
  assert.equal((await app.connector.state()).queries.filter(q => q.target === "finance" && q.state === "ready").at(-1).result.available, sourceBefore.available - 10, "local settlement does not top up source credits");
  const reconcileInput = { allocationId: allocation.data.id, purchaseId: row.id, sourceVersion: row.sourceVersion, conversion,
    reason: "Explicit reviewer mapping ten source credits to five USD test budget; not a currency exchange or payment." };
  assert.equal((await request("/api/finance/reconcile", reconcileInput, "s20-reconcile")).status, 200);
  assert.equal((await app.finance.summary(org)).spentCents, 500);
  assert.equal((await app.finance.summary(org)).availableCents, 200);
  const remainingBudget = await request("/api/finance/allocations");
  assert.equal(remainingBudget.status, 200); assert.equal(Number(remainingBudget.data[0].remaining), 300);
  assert.equal((await request("/api/finance/release", { allocationId: allocation.data.id, amountCents: 301, reason: "Spent funds cannot release" }, "s20-release-rejected")).status, 409);
  assert.equal((await request("/api/finance/release", { allocationId: allocation.data.id, amountCents: 300, reason: "Unused budget" }, "s20-release")).status, 200);
  const publicBefore = await (await fetch(app.url + "/api/public")).json(); assert.equal(publicBefore.financeReview, null);
  w.advance(row.purchase.createdAt + 90000);
  assert.equal((await app.worker.execute(p.id)).complete, false);
  await request("/api/finance/source-refresh", {}, "s20-query-partial");
  purchases = (await request("/api/finance/purchases")).data; row = purchases.records[0];
  assert.equal(row.purchase.receivedQuantity, 6); assert.equal(row.reconciliation.physicalReceived, 6);
  let review = (await request("/api/finance/review-snapshot")).data;
  assert.equal((await request("/api/finance/publish-summary", { reviewVersion: review.reviewVersion, reason: "Partial stock receipt reviewed" }, "s20-public-partial")).status, 200);
  assert.equal((await (await fetch(app.url + "/api/public")).json()).financeReview.snapshot.procurement[0].receivedQuantity, 6);
  w.advance(row.purchase.createdAt + 210000);
  assert.equal((await app.worker.execute(p.id)).complete, true);
  await request("/api/finance/source-refresh", {}, "s20-query-final");
  purchases = (await request("/api/finance/purchases")).data; row = purchases.records[0];
  assert.equal(row.reconciliation.physicalReceived, 10); assert.equal(row.purchase.receipts.length, 2);
  assert.equal((await (await fetch(app.url + "/api/public")).json()).financeReview.snapshot.procurement[0].receivedQuantity, 6);
  assert.equal((await request("/api/finance/publish-summary", { reviewVersion: review.reviewVersion, reason: "Stale partial review" }, "s20-public-stale")).status, 409);
  review = (await request("/api/finance/review-snapshot")).data;
  assert.equal((await request("/api/finance/publish-summary", { reviewVersion: review.reviewVersion, reason: "Full organization stock receipt reviewed" }, "s20-public-final")).status, 200);
  const published = (await (await fetch(app.url + "/api/public")).json()).financeReview;
  assert.equal(published.snapshot.procurement[0].receivedQuantity, 10); assert.equal(published.snapshot.procurement[0].pendingQuantity, 0);
  assert.equal(JSON.stringify(published).includes(row.id), false);
  const refund = { org, id: donation.id, state: "refunded", eventId: "s20-unfunded-refund" };
  await assert.rejects(() => app.finance.webhook(refund, app.finance.signature(refund)), e => e.code === "REFUND_FUNDS");
  assert.equal((await request("/api/finance/ledger")).data.filter(x => x.type === "spent").length, 1);
  assert.deepEqual(w.invariants(), []);
  assert.equal((await app.store.query("SELECT COUNT(*) AS n FROM usage")).rows[0].n, 0);
});
