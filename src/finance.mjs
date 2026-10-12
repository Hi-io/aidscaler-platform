import { check, role } from "./errors.mjs";
import { uid } from "./store.mjs";
import { createHmac, timingSafeEqual } from "node:crypto";
export class Finance {
  constructor(store, config) {
    Object.assign(this, { store, config });
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
          amountCents <= Number(row.amount_cents) - released,
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
}
