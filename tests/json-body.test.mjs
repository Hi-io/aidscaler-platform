import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { jsonBody } from '../src/json-body.mjs';

test('network chunk boundaries preserve Japanese locations and all UTF-8 report text', async () => {
  const report = { location: '高松市・中央通り', text: 'Water needed at 高松駅. 家族 👨‍👩‍👧‍👦 · ayuda', quantity: 600 };
  const bytes = Buffer.from(JSON.stringify(report));
  const stream = Readable.from(Array.from(bytes, byte => Buffer.from([byte])));
  assert.deepEqual(await jsonBody(stream), report);
});

test('JSON request limits count received bytes and malformed input stays an error', async () => {
  const bytes = Buffer.from(JSON.stringify({ place: '高松市' }));
  assert.ok(bytes.length > bytes.toString('utf8').length);
  await assert.rejects(jsonBody(Readable.from([bytes]), bytes.length - 1), { code: 'BODY_LIMIT', status: 413 });
  assert.deepEqual(await jsonBody(Readable.from([bytes]), bytes.length), { place: '高松市' });
  await assert.rejects(jsonBody(Readable.from(['{bad'])), { code: 'JSON' });
  assert.deepEqual(await jsonBody(Readable.from([])), {});
});
