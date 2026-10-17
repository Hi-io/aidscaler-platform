import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Store } from '../src/store.mjs';

test('idle PostgreSQL errors are handled without leaking their attached Client or credentials', async () => {
  class Pool extends EventEmitter {
    async query() { return { rows: [{ ready: 1 }] }; }
    async end() {}
  }
  const pool = new Pool(), logs = [];
  const store = await Store.open({ databaseUrl: 'postgresql://fixture:private-fixture@localhost/db', poolFactory: options => {
    assert.equal(options.connectionTimeoutMillis, 5000); return pool;
  }, databaseLogger: line => logs.push(line) });
  try {
    const failure = Object.assign(Error('private-fixture must never be printed'), { code: '57P01', client: { password: 'private-fixture', secretKey: 'private-client-secret' } });
    assert.doesNotThrow(() => pool.emit('error', failure, failure.client));
    assert.equal(pool.aidscalerConnectionError.code, '57P01');
    assert.equal(logs.length, 1); assert.match(logs[0], /57P01/);
    assert.ok(!logs.join().includes('private-fixture')); assert.ok(!logs.join().includes('private-client-secret'));
    assert.equal((await store.query('SELECT 1 AS ready')).rows[0].ready, 1, 'a healthy subsequent query can reconnect normally');
    pool.emit('error', Object.assign(Error('another credential-bearing message'), { code: 'untrusted-secret-code' }));
    assert.equal(pool.aidscalerConnectionError.code, 'PG_CONNECTION_ERROR');
  } finally { await store.close(); }
});

test('a checked-out transaction connection error is handled and a failed rollback does not replace the original error', async () => {
  class Client extends EventEmitter {
    async query(sql) { if (sql === 'ROLLBACK') throw Error('secondary rollback failure'); return { rows: [] }; }
    release(error) { this.releasedWith = error; }
  }
  class Pool extends EventEmitter {
    constructor() { super(); this.client = new Client(); }
    async query() { return { rows: [] }; }
    async connect() { return this.client; }
    async end() {}
  }
  const pool = new Pool(), logs = [], original = Object.assign(Error('private original error'), { code: 'ECONNRESET' });
  const store = await Store.open({ databaseUrl: 'postgresql://fixture@localhost/db', poolFactory: () => pool, databaseLogger: line => logs.push(line) });
  try {
    await assert.rejects(store.transaction(async () => { pool.client.emit('error', original); throw original; }), error => error === original);
    assert.equal(pool.client.releasedWith.message, 'PG_CONNECTION_ERROR');
    assert.equal(pool.client.listenerCount('error'), 0);
    assert.match(logs[0], /ECONNRESET/); assert.ok(!logs[0].includes('private original'));
    assert.equal((await store.query('SELECT 1')).rows.length, 0);
  } finally { await store.close(); }
});
