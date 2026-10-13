import { check, role } from "./errors.mjs";
import { uid, hash } from "./store.mjs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { persistReceivedPurchases } from "./received-purchases.mjs";
export class Finance {
  constructor(store, config, connector) {
    Object.assign(this, { store, config, connector });
  }
  async checkout(org, { amountCents, currency = "USD" }) {
    check(
      Number.isSafeInteger(amountCents) &&
        amountCents >= 100 &&
        amountCents <= 10000000,
      "AMOUNT",
      "Choose an amount between $1 and $100,000.",
    );
    check(currency === "USD", "CURRENCY", "Local sandbox uses USD.");
    const id = uid("donation");
    await this.store.put(
      org,
      "donation",
      id,
      {
        amountCents,
        currency,
        state: "pending",
        sandbox: true,
        provider: "local-test-provider",
      },
      0,
    );
    return {
      id,
      amountCents,
      currency,
      sandbox: true,
      notice: "Test payment only. No money is collected.",
    };
  }
  signature(body) {
    return createHmac("sha256", this.config.secret)
      .update(JSON.stringify(body))
      .digest("hex");
  }
  async webhook(body, signature) {
    const expected = Buffer.from(this.signature(body)),
      got = Buffer.from(signature ?? "");
    check(
      got.length === expected.length && timingSafeEqual(got, expected),
      "WEBHOOK_SIGNATURE",
      "Payment signature is invalid.",
      401,
    );
    const { org, id, eventId, state } = body;
    check(
      ["settled", "failed", "refunded"].includes(state),
      "PAYMENT_STATE",
      "Invalid payment event.",
    );
    return this.store.command(org, "payment_" + eventId, body, async (tx) => {
      const d = await tx.get(org, "donation", id);
      check(
        (d.state === "pending" && ["settled", "failed"].includes(state)) ||
          (d.state === "settled" && state === "refunded"),
        "PAYMENT_STATE",
        "Invalid payment transition.",
        409,
      );
      const type =
          state === "settled"
            ? "received"
            : state === "refunded"
              ? "refunded"
              : "failed",
        amount = state === "failed" ? 0 : d.amountCents;
      if (state === "refunded")
        check(
          (await this.summary(org, tx)).availableCents >= amount,
          "REFUND_FUNDS",
          "Allocated funds must be released before a refund can settle.",
          409,
        );
      await tx.query(
        "INSERT INTO finance(org,id,provider_event,type,amount_cents,currency,reference,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [org, uid("entry"), eventId, type, amount, d.currency, id, Date.now()],
      );
      const result = await tx.put(
        org,
        "donation",
        id,
        { ...d, state },
        d.version,
      );
      await tx.audit(org, "payment-provider", "payment." + state, id, {
        eventId,
        amountCents: amount,
        sandbox: true,
      });
      return result;
    });
  }
  async allocate(actor, { amountCents, reason }, key) {
    role(actor, ["finance", "commander"]);
    check(
      Number.isSafeInteger(amountCents) &&
        amountCents > 0 &&
        typeof reason === "string" &&
        reason.trim().length > 0 &&
        reason.length <= 1200,
      "AMOUNT",
      "Positive amount required.",
    );
    return this.store.command(
      actor.org,
      key,
      { amountCents, reason },
      async (tx) => {
        const balance = await this.summary(actor.org, tx);
        check(
          balance.availableCents >= amountCents,
          "FUNDS",
          "Available settled funds are insufficient.",
          409,
        );
        const id = uid("allocation");
        await tx.query(
          "INSERT INTO finance(org,id,type,amount_cents,currency,reference,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [actor.org, id, "allocated", amountCents, "USD", reason, Date.now()],
        );
        await tx.audit(actor.org, actor.id, "funds.allocated", id, {
          amountCents,
          reason,
        });
        return { id, amountCents };
      },
    );
  }
  async summary(org, store = this.store) {
    const { rows } = await store.query(
      "SELECT type,SUM(amount_cents) AS amount FROM finance WHERE org=$1 GROUP BY type",
      [org],
    );
    const totals = Object.fromEntries(
      rows.map((r) => [r.type, Number(r.amount)]),
    );
    return {
      sandbox: true,
      currency: "USD",
      receivedCents: totals.received ?? 0,
      refundedCents: totals.refunded ?? 0,
      allocatedCents: (totals.allocated ?? 0) - (totals.released ?? 0),
      grossAllocatedCents: totals.allocated ?? 0,
      releasedCents: totals.released ?? 0,
      availableCents:
        (totals.received ?? 0) -
        (totals.refunded ?? 0) -
        (totals.allocated ?? 0) +
        (totals.released ?? 0),
      spentCents: totals.spent ?? 0,
      unspentAllocatedCents: (totals.allocated ?? 0) - (totals.released ?? 0) - (totals.spent ?? 0),
      notice:
        "Pooled organizational funds. No donation is tied to a specific item.",
    };
  }
  async release(actor, { allocationId, amountCents, reason }, key) {
    role(actor, ["finance", "commander"]);
    check(
      Number.isSafeInteger(amountCents) &&
        amountCents > 0 &&
        typeof reason === "string" &&
        reason.trim(),
      "AMOUNT",
      "A positive amount and release reason are required.",
    );
    return this.store.command(
      actor.org,
      key,
      { allocationId, amountCents, reason },
      async (tx) => {
        const row = (
          await tx.query(
            "SELECT amount_cents FROM finance WHERE org=$1 AND id=$2 AND type='allocated'",
            [actor.org, allocationId],
          )
        ).rows[0];
        check(
          row,
          "ALLOCATION",
          "This allocation is not in your organization.",
        );
        const released = Number(
          (
            await tx.query(
              "SELECT COALESCE(SUM(amount_cents),0) AS total FROM finance WHERE org=$1 AND reference=$2 AND type='released'",
              [actor.org, allocationId],
            )
          ).rows[0].total,
        );
        check(
          amountCents <= Number(row.amount_cents) - released - Number((await tx.query(
            "SELECT COALESCE(SUM(amount_cents),0) AS total FROM finance WHERE org=$1 AND reference=$2 AND type='spent'",
            [actor.org, allocationId],
          )).rows[0].total),
          "RELEASE_AMOUNT",
          "Released funds cannot exceed the remaining allocation.",
          409,
        );
        const id = uid("release");
        await tx.query(
          "INSERT INTO finance(org,id,type,amount_cents,currency,reference,created_at) VALUES($1,$2,'released',$3,'USD',$4,$5)",
          [actor.org, id, amountCents, allocationId, Date.now()],
        );
        await tx.audit(actor.org, actor.id, "funds.released", id, {
          allocationId,
          amountCents,
          reason,
        });
        return { id, allocationId, amountCents };
      },
    );
  }
  async requestPurchases(actor, key) {
    role(actor, ["finance", "commander", "auditor"]);
    check(this.connector && (!this.config.org || actor.org === this.config.org), "FINANCE_SOURCE", "Use your own configured sandbox source.", 403);
    return this.connector.action("query", { target: "finance" }, key);
  }
  async allocations(actor) {
    role(actor, ["finance", "commander", "auditor"]);
    return (await this.store.query(`SELECT a.id,a.reference,a.amount_cents,
      a.amount_cents-COALESCE(SUM(c.amount_cents),0) AS remaining
      FROM finance a LEFT JOIN finance c ON c.org=a.org AND c.reference=a.id AND c.type IN ('released','spent')
      WHERE a.org=$1 AND a.type='allocated' GROUP BY a.id,a.reference,a.amount_cents,a.created_at
      ORDER BY a.created_at DESC LIMIT 200`, [actor.org])).rows;
  }
  async purchases(actor) {
    role(actor, ["finance", "commander", "auditor"]);
    check(this.connector && (!this.config.org || actor.org === this.config.org), "FINANCE_SOURCE", "Use your own configured sandbox source.", 403);
    const state = await this.connector.state();
    const query = await this.store.transaction(tx => persistReceivedPurchases(tx, actor.org, state));
    const records = await this.store.list(actor.org, "source_purchase", 2000), reconciliations = await this.store.list(actor.org, "purchase_reconciliation", 2000);
    return { sandbox: true, sourceUnit: "sandbox_credit", currency: "USD", queryId: query?.id ?? null,
      observedAt: query?.completedAt ?? query?.readyAt ?? null, pendingQueries: (state.queries ?? []).filter(q => q.org === actor.org && q.target === "finance" && q.state !== "ready").map(q => ({ id: q.id, state: q.state })),
      records: records.map(r => ({ ...r, reconciliation: reconciliations.find(v => v.id === r.id) ?? null })),
      notice: "USD test donations and source sandbox credits remain separate. A human may record an explicit accounting conversion; this never creates source credit or certifies aid delivery." };
  }
  async reconcile(actor, { allocationId, purchaseId, sourceVersion, conversion, reason }, key) {
    role(actor, ["finance", "commander"]);
    check(typeof reason === "string" && reason.trim() && reason.length <= 1200, "FINANCE_REASON", "Explain the explicit sandbox accounting conversion.");
    check(conversion?.sourceUnit === "sandbox_credit" && conversion.currency === "USD" &&
      Number.isSafeInteger(conversion.sourceAmount) && conversion.sourceAmount > 0 && Number.isSafeInteger(conversion.amountCents) && conversion.amountCents > 0,
      "FINANCE_CONVERSION", "Explicit positive source credits and USD cents are required; no exchange rate is assumed.");
    await this.purchases(actor);
    return this.store.command(actor.org, key, { allocationId, purchaseId, sourceVersion, conversion, reason }, async tx => {
      const source = await tx.get(actor.org, "source_purchase", purchaseId);
      check(source.confirmedBySource === true && source.sandbox === true && source.purchase?.org === actor.org,
        "FINANCE_OWNER", "Only your source-confirmed sandbox purchase can be reconciled.", 403);
      check(source.sourceVersion === sourceVersion, "FINANCE_VERSION", "The source purchase changed. Review its current financial and physical receipt.", 409);
      check(source.entries.length === 1 && source.entries[0].amount === source.purchase.cost && source.purchase.cost === conversion.sourceAmount,
        "FINANCE_SPEND", "The exact purchase needs a matching received source spending entry; a pledge or purchase ACK is insufficient.", 409);
      const prior = await tx.get(actor.org, "purchase_reconciliation", purchaseId, false);
      if (prior) {
        check(prior.allocationId === allocationId && hash(prior.conversion) === hash(conversion), "FINANCE_RECONCILED",
          "This source purchase is already reconciled. Its allocation and approved conversion cannot be changed or charged again.", 409);
        return prior;
      }
      const allocation = (await tx.query("SELECT amount_cents FROM finance WHERE org=$1 AND id=$2 AND type='allocated'", [actor.org, allocationId])).rows[0];
      check(allocation, "ALLOCATION", "This approved allocation is not in your organization.");
      const consumed = Number((await tx.query("SELECT COALESCE(SUM(amount_cents),0) AS total FROM finance WHERE org=$1 AND reference=$2 AND type IN ('released','spent')", [actor.org, allocationId])).rows[0].total);
      check(conversion.amountCents <= Number(allocation.amount_cents) - consumed, "FINANCE_ALLOCATION", "The unspent approved allocation cannot cover this purchase.", 409);
      const expenseId = uid("expense");
      await tx.query("INSERT INTO finance(org,id,type,amount_cents,currency,reference,created_at) VALUES($1,$2,'spent',$3,'USD',$4,$5)",
        [actor.org, expenseId, conversion.amountCents, allocationId, Date.now()]);
      const record = await tx.put(actor.org, "purchase_reconciliation", purchaseId, {
        allocationId, expenseId, conversion, reason, reconciledBy: actor.id, reconciledAt: Date.now(),
        purchase: source.purchase, approvedPurchase: source.purchase, sourceVersion, approvedSourceVersion: sourceVersion,
        queryId: source.queryId, observedAt: source.observedAt, financialReviewRequired: false,
        financialState: "spent", physicalState: source.purchase.state,
        physicalReceived: Number.isSafeInteger(source.purchase.receivedQuantity) ? source.purchase.receivedQuantity : null,
        physicalReceivedAt: source.purchase.receivedAt ?? null, sandbox: true,
      }, 0);
      await tx.audit(actor.org, actor.id, "funds.purchase_reconciled", purchaseId, { allocationId, expenseId, conversion,
        sourceVersion, queryId: source.queryId, physicalState: source.purchase.state, reason, sandbox: true });
      return record;
    });
  }
  async reviewSnapshot(actor, store = this.store) {
    role(actor, ["finance", "commander", "auditor"]);
    const balance = await this.summary(actor.org, store),
      purchases = await store.list(actor.org, "source_purchase", 2000),
      reconciliations = await store.list(actor.org, "purchase_reconciliation", 2000),
      groups = new Map(), dependencies = [];
    let mappedPurchaseCount = 0, pendingReviewCount = 0;
    for (const source of purchases) {
      const r = reconciliations.find(v => v.id === source.id);
      if (!r || r.financialReviewRequired) { pendingReviewCount++; continue; }
      check(source.confirmedBySource && source.purchase.org === actor.org, "FINANCE_OWNER", "A public summary requires your received source facts.", 403);
      const p = source.purchase, received = Number.isSafeInteger(p.receivedQuantity) ? p.receivedQuantity : null,
        unit = typeof p.unit === "string" ? p.unit : "unit", type = p.type,
        groupKey = JSON.stringify([type, unit]),
        g = groups.get(groupKey) ?? { type, unit, orderedQuantity: 0, receivedQuantity: 0, pendingQuantity: 0,
          orderedOrders: 0, partialOrders: 0, receivedOrders: 0, receiptUnknownOrders: 0 };
      g.orderedQuantity += p.quantity;
      g.receivedQuantity += received ?? 0;
      g.pendingQuantity += p.quantity - (received ?? 0);
      if (received === null) g.receiptUnknownOrders++;
      else if (received === p.quantity && p.state === "received") g.receivedOrders++;
      else if (received > 0) g.partialOrders++;
      else g.orderedOrders++;
      groups.set(groupKey, g); mappedPurchaseCount++;
      dependencies.push({ id: source.id, sourceVersion: source.sourceVersion, conversion: r.conversion,
        allocationId: r.allocationId, financialReviewRequired: r.financialReviewRequired });
    }
    const snapshot = { ...balance, procurement: [...groups.values()].sort((a,b) => JSON.stringify([a.type,a.unit]).localeCompare(JSON.stringify([b.type,b.unit]))),
      mappedPurchaseCount, pendingReviewCount,
      procurementNotice: "Human-reviewed sandbox accounting. Purchase receipts confirm stock received by the organization, not delivery to people. Unknown receipt quantities are not treated as received." };
    return { reviewVersion: hash([snapshot, dependencies.sort((a,b) => a.id.localeCompare(b.id))]), snapshot };
  }
  async publishSummary(actor, { reviewVersion, reason }, key) {
    role(actor, ["finance", "commander"]);
    check(typeof reason === "string" && reason.trim() && reason.length <= 1200, "FINANCE_REASON", "Explain the public financial review.");
    await this.purchases(actor);
    return this.store.command(actor.org, key, { reviewVersion, reason }, async tx => {
      const current = await this.reviewSnapshot(actor, tx);
      check(current.reviewVersion === reviewVersion, "FINANCE_VERSION", "Funds or purchase receipts changed. Review the current aggregate before publishing.", 409);
      const prior = await tx.get(actor.org, "finance_public", "aggregate", false),
        approved = await tx.put(actor.org, "finance_public", "aggregate", { ...current, approvedBy: actor.id, approvedAt: Date.now(), reason }, prior?.version ?? 0);
      await tx.audit(actor.org, actor.id, "funds.aggregate_published", "aggregate", { reviewVersion, reason, sandbox: true });
      return approved;
    });
  }
  async publicSummary(org) {
    const approved = await this.store.get(org, "finance_public", "aggregate", false);
    return approved ? { snapshot: approved.snapshot, approvedAt: approved.approvedAt, sandbox: true,
      notice: "Approved aggregate at the displayed review time; later receipts require a new human review." } : null;
  }
}
