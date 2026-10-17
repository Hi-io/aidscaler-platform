import { hash } from './store.mjs';
import { check } from './errors.mjs';

const received = new WeakMap();
const frozen = new WeakSet();
const object = value => value !== null && typeof value === 'object';

export function deepFreezeJson(value) {
  if (!object(value) || frozen.has(value)) return value;
  frozen.add(value);
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

// Only authenticated, content-checked connector receipts receive a reusable
// identity. The metadata is outside the source JSON and cannot be forged by a
// source field, a same-version silent edit or an arbitrary frozen object.
export function rememberImmutableSourceResult(value, revision, json) {
  if (!/^[a-f0-9]{64}$/.test(revision)) return deepFreezeJson(value);
  const digest = typeof value === 'string' ? hash(JSON.stringify(value)) : hash(value);
  check(digest === revision, 'SOURCE_RESULT_INTEGRITY',
    'The received query result does not match its declared content revision.', 502);
  deepFreezeJson(value);
  if (object(value)) received.set(value, Object.freeze({ digest, json }));
  return value;
}

export const immutableSourceResult = value => object(value) ? received.get(value) : undefined;
