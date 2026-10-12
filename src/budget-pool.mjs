import { check } from "./errors.mjs";

/** Optional shared cap for one evaluator-owned episode. Production owner
 * limits remain independently enforced by each provider/database. */
export class ModelBudgetPool {
  constructor({ budgetUsd, calls }) {
    check(
      Number.isFinite(budgetUsd) &&
        budgetUsd > 0 &&
        Number.isSafeInteger(calls) &&
        calls > 0,
      "MODEL_POOL_CONFIG",
      "Invalid shared inference cap.",
    );
    this.budgetUsd = budgetUsd;
    this.callLimit = calls;
    this.entries = new Map();
    this.next = 0;
  }
  get chargedUsd() {
    return [...this.entries.values()].reduce((sum, v) => sum + v.charged, 0);
  }
  reserve(estimate) {
    check(
      Number.isFinite(estimate) && estimate >= 0,
      "MODEL_POOL_CONFIG",
      "Invalid inference reservation.",
    );
    check(
      this.entries.size < this.callLimit,
      "MODEL_CALL_BUDGET",
      "The shared episode call cap is exhausted.",
      429,
    );
    check(
      this.chargedUsd + estimate <= this.budgetUsd,
      "MODEL_BUDGET",
      "The shared episode inference budget is exhausted.",
      429,
    );
    const id = ++this.next;
    this.entries.set(id, { charged: estimate, state: "reserved" });
    return id;
  }
  cancel(id) {
    if (this.entries.get(id)?.state === "reserved") this.entries.delete(id);
  }
  settle(id, cost) {
    const entry = this.entries.get(id);
    if (!entry || entry.state !== "reserved") return;
    if (
      cost !== null &&
      cost !== undefined &&
      Number.isFinite(cost) &&
      cost >= 0
    )
      entry.charged = cost;
    entry.state =
      cost === null || cost === undefined ? "unknown_cost" : "settled";
  }
}
