import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { PubSub } from '@google-cloud/pubsub';
import { WIRE_VERSION, encodeWire, decodeWire } from '../../../disaster-response-simulator/sources/cloud-wire.mjs';
import { AppError } from '../errors.mjs';
export class BridgeClient {
  constructor({ store, topic, timeoutMs = 28000, now = Date.now }) { Object.assign(this, { store, topic, timeoutMs, now }); }
  async initialize() {
    await this.store.exec('CREATE TABLE IF NOT EXISTS cloud_bridge_replies(id text PRIMARY KEY,payload jsonb NOT NULL,at bigint NOT NULL)');
  }
  async accept(message) {
    const reply = decodeWire(Buffer.from(message.data, 'base64'));
    await this.store.query('INSERT INTO cloud_bridge_replies VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
      [reply.id, JSON.stringify(reply), this.now()]);
  }
  async request(scope, path, { method = 'GET', body, headers } = {}) {
    const id = randomUUID(), deadline = this.now() + this.timeoutMs;
    await this.topic.publishMessage({ data: encodeWire({ version: WIRE_VERSION, id, deadline, scope, path, method, body, headers }) });
    try {
      while (this.now() < deadline) {
        const reply = (await this.store.query('SELECT payload FROM cloud_bridge_replies WHERE id=$1', [id])).rows[0]?.payload;
        if (reply) return new Response(reply.body, { status: reply.status, headers: reply.headers });
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      throw new AppError('SIMULATOR_RECONNECTING', 'The simulator is reconnecting. Your saved work is retained.', 503);
    } finally { await this.store.query('DELETE FROM cloud_bridge_replies WHERE id=$1', [id]); }
  }
  async loopback() {
    if (this.server?.listening) return 'http://127.0.0.1:' + this.server.address().port;
    this.server = http.createServer(async (req, res) => {
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 * 1024) throw Error('BRIDGE_LIMIT'); chunks.push(chunk); }
        const response = await this.request('actor', req.url, { method: req.method,
          headers: { authorization: req.headers.authorization, 'content-type': req.headers['content-type'],
            'x-aidscaler-source-instance': req.headers['x-aidscaler-source-instance'] },
          body: size ? Buffer.concat(chunks).toString() : undefined });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
      } catch { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"SIMULATOR_RECONNECTING","message":"The simulator is reconnecting."}'); }
    });
    await new Promise(resolve => this.server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + this.server.address().port;
  }
  async close() { if (this.server) await new Promise(resolve => this.server.close(resolve)); }
}
export function bridgePubSub(projectId, topicId) {
  const client = new PubSub({ projectId });
  return { client, topic: client.topic(topicId) };
}
