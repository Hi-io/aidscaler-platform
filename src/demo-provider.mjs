import { AppError, check } from './errors.mjs';
import { OpenRouterProvider } from './provider.mjs';

// One process-wide admission gate; persisted usage remains the cost ledger.
// No public endpoint can raise these budgets or change the configured model.
export class DemoModelGate {
  constructor(store, { concurrency = 2, maxQueue = 8, hourlyUsd = 1, totalUsd = 15 } = {}) {
    Object.assign(this, { store, concurrency, maxQueue, hourlyUsd, totalUsd });
    this.running = 0; this.waiters = []; this.reserved = new Map(); this.sequence = 0;
  }
  async enter(signal) {
    check(this.waiters.length < this.maxQueue, 'DEMO_MODEL_BUSY', 'The shared AI queue is busy. Existing operations continue; please try again shortly.', 429);
    if (this.running >= this.concurrency) await new Promise((resolve, reject) => {
      const item = { resolve, reject };
      const abort = () => { this.waiters = this.waiters.filter(x => x !== item); reject(new AppError('DEMO_CANCELLED', 'The investigation was cancelled.', 499)); };
      item.resolve = () => { signal?.removeEventListener('abort', abort); resolve(); };
      this.waiters.push(item);
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
    else this.running++;
    return () => { const next = this.waiters.shift(); if (next) next.resolve(); else this.running--; };
  }
  async refresh() {
    const totals = (await this.store.query('SELECT COALESCE(SUM(COALESCE(cost_usd,reserved_usd)),0) AS total,COALESCE(SUM(CASE WHEN started_at>$1 THEN COALESCE(cost_usd,reserved_usd) ELSE 0 END),0) AS hourly FROM usage', [Date.now() - 3600000])).rows[0];
    this.charged = Number(totals.total); this.hourly = Number(totals.hourly);
  }
  reserve(amount) {
    // The provider calls reserve synchronously after catalogue resolution.
    // Add outstanding process reservations conservatively to persisted totals.
    const outstanding = [...this.reserved.values()].reduce((sum, x) => sum + x, 0);
    check(this.charged + outstanding + amount <= this.totalUsd && this.hourly + outstanding + amount <= this.hourlyUsd,
      'DEMO_MODEL_BUDGET', 'The shared demo AI allowance is currently paused. You can still inspect evidence, review plans and follow existing operations.', 429);
    const id = ++this.sequence; this.reserved.set(id, amount); return id;
  }
  cancel(id) { this.reserved.delete(id); }
  settle(id, cost) {
    const amount = cost == null ? this.reserved.get(id) ?? 0 : cost;
    this.reserved.delete(id); this.charged += amount; this.hourly += amount;
  }
  status() { return { active: this.running, queued: this.waiters.length, paused: this.charged >= this.totalUsd || this.hourly >= this.hourlyUsd }; }
  provider(store, config, active = () => true) {
    const real = new OpenRouterProvider(store, { ...config, modelBudgetPool: this });
    return {
      complete: async request => {
        check(active(), 'DEMO_AI_IDLE', 'AI investigations resume while a participant is using this workspace. Existing operations continue.', 429);
        const leave = await this.enter(request.signal);
        try {
          await this.refresh();
          check(active(), 'DEMO_AI_IDLE', 'AI investigations are paused for this participant. Existing operations continue.', 429);
          return await real.complete(request);
        }
        finally { leave(); }
      },
      catalogue: () => real.catalogue(),
    };
  }
}
