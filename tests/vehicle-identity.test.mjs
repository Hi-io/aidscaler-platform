import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleIdentity } from '../ui/vehicle-identity.mjs';
import { setDisplayContext, registerDisplayRecords, entityLabel, readableText, vehicleDisplayIdentity } from '../ui/labels.mjs';

test('received registrations take precedence over fictional demo identity', () => {
  for (const fields of [
    { licensePlate: 'Kagawa 100 A 12-34' },
    { registrationPlate: 'AB-1234' },
    { plate: 'XY-5678' },
    { registration: 'ACTUAL-91' },
    { registration: { number: 'ACTUAL-92' } },
    { registration: { plate: 'ACTUAL-93' } },
  ]) {
    const record = { id: 'v-org0-0', name: 'Supply truck', ...fields };
    const before = structuredClone(record);
    const identity = vehicleIdentity(record, { demo: true });
    assert.equal(identity.isDemo, false);
    assert.equal(identity.registrationLabel, 'Registration');
    assert.ok(!identity.plate.startsWith('TK-'));
    assert.ok(identity.label.includes(identity.plate));
    assert.deepEqual(record, before);
  }
  assert.equal(vehicleIdentity({ licensePlate: 'A-1', plate: 'B-2' }).plate, 'A-1');
  assert.equal(vehicleIdentity({ name: 'Truck A-1', plate: 'A-1' }).label, 'Truck A-1');
});

test('fictional registrations are deterministic and unique across large fleets and background traffic', () => {
  const records = [];
  for (let owner = 0; owner < 4; owner++) for (let vehicle = 0; vehicle < 11000; vehicle++)
    records.push({ id: `v-org${owner}-${vehicle}`, name: 'Relief vehicle' });
  for (let vehicle = 0; vehicle < 11000; vehicle++) records.push({ id: `traffic-${vehicle}`, background: true });
  const registrations = records.map(record => vehicleIdentity(record, { demo: true }));
  assert.equal(new Set(registrations.map(identity => identity.plate)).size, records.length);
  assert.ok(registrations.every(identity => identity.isDemo && /^TK-(?:\d+|T)-\d+$/.test(identity.plate)));
  assert.equal(vehicleIdentity(records[0], { demo: true }).plate, 'TK-01-0001');
  assert.equal(vehicleIdentity(records[0], { demo: true }).registrationLabel, 'Demo registration');
  const reversed = records.toReversed().map(record => vehicleIdentity(record, { demo: true }).plate).reverse();
  assert.deepEqual(reversed, registrations.map(identity => identity.plate));
});

test('unknown and real data receives no invented registration', () => {
  for (const record of [{ id: 'v-org0-0', name: 'Van A' }, { id: 'vehicle-1', name: 'Van A' }]) {
    const identity = vehicleIdentity(record);
    assert.equal(identity.plate, '');
    assert.equal(identity.label, 'Van A');
    assert.equal(identity.isDemo, false);
  }
  for (const id of ['unknown', 'v-org00-1', 'v-org0-01', 'traffic-01'])
    assert.equal(vehicleIdentity({ id }, { demo: true }).plate, '');
  assert.equal(vehicleIdentity({ registration: {}, licensePlate: ' ', plate: null }).plate, '');
});

test('background classification is independent of whether its registration is received or fictional', () => {
  const received = vehicleIdentity({ id: 'traffic-7', plate: 'ACTUAL-77' }, { demo: true });
  assert.equal(received.isDemo, false);
  assert.equal(received.isBackground, true);
  assert.equal(vehicleIdentity({ id: 'traffic-7' }, { demo: true }).isBackground, true);
  assert.equal(vehicleIdentity({ id: 'traffic-7', plate: 'ACTUAL-77' }).isBackground, false);
  assert.equal(vehicleIdentity({ id: 'external-7', background: true, plate: 'ACTUAL-77' }).isBackground, true);
  assert.equal(vehicleIdentity({ id: 'traffic-07' }, { demo: true }).isBackground, false);
  assert.equal(vehicleIdentity({ id: 'v-org0-0' }, { demo: true }).isBackground, false);
});

test('display record registration distinguishes identical source vehicle names without altering raw records', () => {
  setDisplayContext({ organization: { id: 'org0', name: 'Relief North' } });
  const records = [{ id: 'traffic-0', name: 'Relief North Vehicle' }, { id: 'traffic-1', name: 'Relief North Vehicle' },
    { id: 'v-org0-0', name: 'Relief North - Vehicle 1' }, { id: 'v-org1-0', name: 'Community East - Vehicle 1' }];
  const before = structuredClone(records);
  registerDisplayRecords('vehicle', records);
  assert.equal(new Set(records.map(record => entityLabel(record.id))).size, records.length);
  assert.equal(entityLabel('traffic-0'), 'Relief North Vehicle · TK-T-0001');
  assert.match(readableText('Observe traffic-1'), /TK-T-0002/);
  assert.match(readableText('Dispatch v-org0-0'), /TK-01-0001/);
  assert.equal(vehicleDisplayIdentity(records[0]).isDemo, true);
  assert.deepEqual(records, before);
  setDisplayContext({ organization: { id: 'real-team', name: 'Harbor Response' } });
  registerDisplayRecords('vehicle', { id: 'v-org0-0', name: 'Harbor truck' });
  assert.equal(entityLabel('v-org0-0'), 'Harbor truck');
  assert.equal(vehicleDisplayIdentity(records[0]).plate, '');
});
