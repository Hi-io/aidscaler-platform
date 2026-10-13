# S20: support funding, supplier order and physical receipt

This closes a local functional gap: previously an approved USD test allocation and a source purchase existed in separate circuits, without an auditable expense mapping. A purchase acknowledgment could also finish an operation without a physical supplier receipt. This implementation does **not** claim comparative time advantage or independent financial validation.

## Two deliberately separate accounting domains

- Local signed test-payment events settle donations in USD cents. A financial reviewer approves an organizational allocation from settled funds.
- The simulator's own treasury spends integer `sandbox_credit` units. Its balance comes from the configured initial treasury or source-settled simulated donations. It is never topped up by local USD donations or reconciliation.
- An ordinary owner-scoped `query(finance)` supplies the exact spending entry and purchase. The platform waits for a delivered query; a pending query or action acknowledgment is not evidence.
- A human reviewer explicitly approves `{sourceUnit:"sandbox_credit", sourceAmount, currency:"USD", amountCents}` for one exact source purchase and one approved local allocation. No rate or monetary equivalence is inferred by a model.

This is sandbox accounting to demonstrate the workflow. It is not a foreign-exchange service, payment integration, procurement certification or claim that real dollars bought a particular item.

## Expense, availability and authority

`Finance.reconcile` is limited to the finance and commander roles. The model, publisher and auditor cannot approve a conversion or post an expense. The exact source owner, spending entry, cost, material purchase version and remaining approved allocation are checked in the command transaction.

A single append-only `spent` ledger entry references its allocation. The durable `purchase_reconciliation` binds that expense to the source purchase, approved conversion and human reason. Concurrent requests and retries cannot charge the purchase twice or remap it to another allocation/conversion. A write failure rolls back the expense, reconciliation and idempotency record together; the same command can then be retried.

Available local funds remain `settled − refunded − allocated + released`. Spending inside an allocation is not subtracted again. Unspent approved budget is `allocated − released − spent`. Releases cannot free spent funds; a refund still requires enough uncommitted settled funds. These are pooled organizational funds, not promises to deliver a particular donor's item.

## Received evidence and material versions

`src/received-purchases.mjs` accepts only an ordinary ready finance query from the configured owner. It preserves source purchase and expense facts in `source_purchase`, with the query identity, observed source clock, material hash, source finance version, source purchase version and a platform material `sourceVersion`.

Repeated identical queries do not create a new material purchase version. An older purchase or finance version arriving later cannot regress a receipt, including equal-clock and outage-reordered cases. A fresh physical receipt updates the original reconciliation's physical state without another expense. A changed source cost/spending entry preserves the original human approval and marks the reconciliation for financial review rather than silently changing its conversion.

Ingestion calls this helper inside its existing synchronization transaction. Finance review can also read the latest already delivered source queries. `Worker` separately waits for the exact owner purchase's physical quantity receipt and cannot complete from ETA, payment or a partial receipt. Supplier partial receipts and source treasury conservation are implemented in the simulator; they apply to every method, not only the model-assisted arm.

## Physical states and public transparency

The exogenous test supplier profile delivers a ten-litre order as six litres followed by four litres. Source records expose native type/unit/quantity, received quantity, receipts, version and arrival metadata. The purchaser cannot provide a delivery schedule or fabricate a receipt. An incomplete or backordered order remains pending; supplier arrival updates usable stock only by the received delta.

Payment is not stock arrival. Stock arrival at an organization is not delivery to people. Neither is reported as the other. Partial six-of-ten and full ten-of-ten are displayed distinctly.

The financial workspace uses closed disclosure sections for budgets, source purchases, public review and history. Each purchase shows its financial state next to its physical native quantity. A reviewer opens one purchase to approve the explicit mapping. An auditor has read-only financial access and no accounting/publication forms.

The public procurement aggregate requires a separate financial human approval of the exact material snapshot. Its version includes current fund totals, relevant source purchase versions and approved mappings. A stale view cannot be published. Only aggregate type/unit, ordered/received/pending native quantities and reviewed financial totals are public. Purchase IDs, suppliers, private locations, source URLs and reviewer IDs stay internal.

The approved public snapshot does not refresh automatically. A later private ten-of-ten receipt leaves a previously approved public six-of-ten snapshot visible with its review time until another human review publishes the newer facts. The live settled-fund ledger and deliberately approved procurement snapshot are separate fields. No unsupported `en_route` status is invented from a paid or ordered purchase.

## Local API

Read roles are finance, commander and auditor:

- `GET /api/finance/ledger`: append-only ledger history.
- `GET /api/finance/allocations`: exact remaining allocation after all releases and spending, independent of the limited history page.
- `POST /api/finance/source-refresh`: requests an ordinary own finance query; acknowledgment remains pending evidence.
- `GET /api/finance/purchases`: persisted source-confirmed purchases with their financial reconciliation and separate physical receipt state.
- `GET /api/finance/review-snapshot`: current aggregate and material approval version.

Financial mutation roles are finance and commander:

- `POST /api/finance/allocate` and `/api/finance/release` retain the existing authenticated, CSRF-protected, idempotent audit workflow.
- `POST /api/finance/reconcile` requires exact allocation, purchase and source version plus explicit human conversion and reason.
- `POST /api/finance/publish-summary` requires exact aggregate version and review reason.

`GET /api/public` adds the latest deliberately approved `financeReview` aggregate, or `null` before human publication. It never exposes the internal source purchase ledger.

## Evidence and limits

Focused tests: `tests/finance-purchases.test.mjs` cover delivered-only owner evidence, material versions, late/stale queries, role/explicit conversion/budget checks, once-only concurrent spending, expense rollback and same-key retry, source cost changes, release/refund constraints, approved partial public snapshot, stale publication and privacy, collapsed/read-only UI, and a real local HTTP source/payment/platform journey from ordered zero-of-ten to six-of-ten to ten-of-ten. The final subset passed 12/12: nine financial tests and three purchase Worker receipt tests. They do not invoke a provider.

Compatibility subset before the last added source guard: 21/21 PASS, including existing financial release/refund, authenticated HTTP, physical recovery and the two supplier receipt Worker tests. The final full gate must repeat the source-covered tests on one frozen candidate; these counts are mechanism checks, not a time KPI.

Actual Chromium journey: `node scripts/finance-journey.mjs`. The successful run at `reports/finance-journey/1791848259532/result.json` records 12 browser workflow/layout checks, desktop 1920 and mobile 390 screenshots, zero operational console errors, zero usage calls, USD 500 cents recorded once, and native supplier quantities `[0,6,10]`. The anonymous login page's expected `/api/me` 401 is recorded separately rather than hidden or treated as a financial failure. Screenshot inspection confirmed the collapsed financial workspace and readable partial public aggregate.

That UI run's candidate was `64206955b3ce535d3bccc3a435bbe4109bb2863ab3e8623c4d0202cc668ae2db`; evaluator `bf3d048588e3a386e534b308b4e87778b19ee0c3791d1f83325d965ee4d4a1d5`. It checks source fingerprints before and after the run. The simulator source is the current S20 procurement version; root's full gate records the combined final source hashes. Do not attribute older campaign results to this candidate.

Remaining external work stays explicit: real payment-provider onboarding, institutional procurement/audit policy, any real currency conversion, independent human comprehension testing and actual disaster validity. No model autonomy over money, supplier schedules or delivery certification is introduced by this local stage.
