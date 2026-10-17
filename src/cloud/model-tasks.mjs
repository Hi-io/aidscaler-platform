import { randomUUID } from 'node:crypto';
export class ModelTasks {
  constructor({ store, enqueue, run, now = Date.now }) { Object.assign(this, { store, enqueue, run, now }); }
  async initialize() {
    await this.store.exec('CREATE TABLE IF NOT EXISTS cloud_model_tasks(org text PRIMARY KEY,token text NOT NULL,leased_until bigint NOT NULL,state text NOT NULL)');
  }
  async schedule(org) {
    const token = randomUUID();
    const rows = (await this.store.query("INSERT INTO cloud_model_tasks VALUES($1,$2,$3,'queued') ON CONFLICT(org) DO UPDATE SET token=$2,leased_until=$3,state='queued' WHERE cloud_model_tasks.leased_until<$4 RETURNING token",
      [org, token, this.now() + 600000, this.now()])).rows;
    if (!rows.length) return false;
    try { await this.enqueue({ org, token }); return true; }
    catch (error) {
      await this.store.query("DELETE FROM cloud_model_tasks WHERE org=$1 AND token=$2 AND state='queued'", [org, token]);
      throw error;
    }
  }
  async execute({ org, token }) {
    const claimed = await this.store.transaction(async tx => {
      const row = (await tx.query('SELECT * FROM cloud_model_tasks WHERE org=$1 FOR UPDATE', [org])).rows[0];
      if (!row || row.token !== token || row.state !== 'queued' || Number(row.leased_until) < this.now()) return false;
      await tx.query("UPDATE cloud_model_tasks SET state='running' WHERE org=$1 AND token=$2", [org, token]);
      return true;
    });
    if (!claimed) return false;
    try { return await this.run(org); }
    finally { await this.store.query('DELETE FROM cloud_model_tasks WHERE org=$1 AND token=$2', [org, token]); }
  }
}
