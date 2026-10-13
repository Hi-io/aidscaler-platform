import test from 'node:test';
import assert from 'node:assert/strict';
import { receivedStaffCapacity, receivedStaffCalendar, staffCapacityProjection } from '../src/staff-capacity.mjs';
import { staffAvailabilityState, staffAvailabilityBadge, sourceExpiryLabel, simulationClock } from '../ui/staff.mjs';
import { Store } from '../src/store.mjs';
import { assessmentPlan, servicePlan } from '../src/services.mjs';

const staff = () => ({ id: 'crew', type: 'staff', quantity: 3, reserved: 0, floor: 0,
  qualificationProfiles: [{ quantity: 2, qualifications: ['field_assessment', 'shelter_support'] }, { quantity: 1, qualifications: [] }],
  qualificationCounts: { field_assessment: 2, shelter_support: 2 },
  staffCalendar: { version: 1, observedAt: 0, epochAt: 0, shiftMs: 8000, restMs: 1000 } });
test('received anonymous shift caps qualified capacity at rest and at a work duration exceeding current shift', () => {
  const r = staff();
  assert.equal(receivedStaffCapacity(r, ['field_assessment'], 0, { now: 7000, useAt: 8000 }), 2);
  assert.equal(receivedStaffCapacity(r, ['field_assessment'], 0, { now: 7000, useAt: 8001 }), 0);
  assert.equal(receivedStaffCapacity(r, ['field_assessment'], 0, { now: 8000 }), 0);
  assert.equal(receivedStaffCapacity(r, ['field_assessment'], 1, { now: 9000, useAt: 9500 }), 1);
  assert.equal(receivedStaffCalendar(r, { now: 8500 }).nextAvailableAt, 9000);
  assert.equal(receivedStaffCalendar(r, { now: 9000 }).currentShiftEnd, 17000);
  assert.equal(receivedStaffCalendar(r, { now: 7000, useAt: 8100 }).reason, 'staff_shift_too_short');
  assert.equal(receivedStaffCapacity(r, ['field_assessment'], 0, { now: 8500, workAt: 9000, useAt: 11000 }), 2, 'Passive travel during rest may precede qualified on-shift work');
  assert.equal(receivedStaffCapacity(r, ['field_assessment'], 0, { now: 8500, workAt: 8700, useAt: 11000 }), 0);
  const continuous = staff(); continuous.staffCalendar.restMs = 0;
  assert.equal(receivedStaffCapacity(continuous, ['field_assessment'], 0, { now: 7000, useAt: 17000 }), 2, 'No rest interval means no artificial shift-boundary interruption');
});
test('unknown and malformed calendars cannot invent duty; received clock cannot precede the declared observation', () => {
  const legacy = staff(); delete legacy.staffCalendar;
  assert.equal(receivedStaffCalendar(legacy).declared, false);
  assert.equal(receivedStaffCapacity(legacy, ['field_assessment']), 2);
  const r = staff(); r.staffCalendar.observedAt = 9000;
  assert.equal(receivedStaffCapacity(r, ['field_assessment']), 2, 'Received calendar clock is a valid compatibility default');
  assert.equal(receivedStaffCapacity(r, ['field_assessment'], 0, { now: 0 }), 0);
  assert.equal(receivedStaffCapacity(r, ['field_assessment'], 0, { now: 9000, useAt: null }), 0);
  for (const change of [c => c.shiftMs = 0, c => c.restMs = -1, c => c.epochAt = '0', c => c.version = 0, c => c.observedAt = null]) {
    const invalid = staff(); change(invalid.staffCalendar);
    assert.equal(receivedStaffCalendar(invalid, { now: 1000 }).reason, 'staff_calendar_invalid');
    assert.equal(receivedStaffCapacity(invalid, [], 0, { now: 1000 }), 0);
  }
  const later = staff(); later.staffCalendar.epochAt = 10000;
  assert.equal(receivedStaffCalendar(later, { now: 0 }).nextAvailableAt, 10000);
});
test('staff sharing copies only an aggregate calendar and skills, never named shifts/private roster', () => {
  const r = staff(); r.staffCalendar.roster = [{ person: 'private', assignment: 'sensitive' }];
  r.people = ['private']; r.staffReservations = [{ private: 'allocation' }];
  const p = staffCapacityProjection(r);
  assert.deepEqual(p.staffCalendar, { version: 1, observedAt: 0, epochAt: 0, shiftMs: 8000, restMs: 1000 });
  assert.equal(JSON.stringify(p).includes('private'), false);
  assert.equal(receivedStaffCapacity({ ...r, ...p }, ['field_assessment'], 0, { now: 8000 }), 0);
});
test('operator sees a received current shift and next availability without converting a staff calendar into private roster', () => {
  const r = staff();
  for (const now of [0, 7000, 8000, 8999, 9000, 18000])
    assert.equal(staffAvailabilityState(r, now).usable, receivedStaffCalendar(r, { now }).usable);
  const html = staffAvailabilityBadge(r, 8500, { escape: String, time: t => 'Lab +' + t });
  assert.match(html, /Resting/); assert.match(html, /Next shift Lab \+9000/);
  assert.match(staffAvailabilityBadge(r, 1000, { escape: String, time: String }), /Until 8000/);
  assert.equal(staffAvailabilityState(r, null).usable, false);
  const unknown = { ...r }; delete unknown.staffCalendar;
  assert.equal(staffAvailabilityState(unknown, 1000).label, 'Shift unknown');
  assert.equal(staffAvailabilityState({ ...r, staffCalendar: { ...r.staffCalendar, restMs: 0 } }, 30000).usable, true);
  assert.equal(simulationClock(7200000), 'Simulation +2:00');
  assert.equal(sourceExpiryLabel(7200000, 3600000), 'Expires in 60 min · Simulation +2:00');
  assert.equal(sourceExpiryLabel(7200000, 10800000), 'Expired at Simulation +2:00');
  assert.match(sourceExpiryLabel(1000, null), /current source clock/);
});
async function serviceFixture(t) {
  const store = await Store.open(); t.after(() => store.close()); await store.organization('org0');
  await store.upsert('org0', 'source', 'simulator', { simulatedAt: 1000 });
  await store.upsert('org0', 'resource', 'crew', { ...staff(), owner: 'org0', node: 'n0' });
  await store.upsert('org0', 'vehicle', 'van', { owner: 'org0', node: 'n0', state: 'idle', capacity: 2, seats: 2,
    maxCargoKg: 150, volumeM3: .15, driverAvailable: true });
  await store.upsert('org0', 'facility', 'site', { sourceVersion: 1, use: 'shelter', node: 'n0', capacity: 10,
    ownerOrg: 'org0', dependencies: { staff: 1 }, requiredStaffSkills: ['shelter_support'], safe: false });
  return store;
}
const policy = async (store, inspectionMs = 1000, setupMs = 1000, commandMs = 0) => store.upsert('org0', 'context', 'operational', {
  snapshot: { queries: [{ id: 'received-policy', state: 'ready', target: 'policy', completedAt: 1000, result: { observedAt: 1000, version: 1,
    execution: { fieldAssessment: { inspectionMs, commandNominalLatencyMs: commandMs },
      delivery: { commandNominalLatencyMs: commandMs, loadMs: 0, unloadMs: 0 }, service: { setupMs } } } }] } });
const certify = async store => {
  await store.upsert('org0', 'facility', 'site', { safe: true });
  await store.upsert('org0', 'verification', 'check', { org: 'org0', reportTo: 'org0', target: 'building', entity: 'site', state: 'completed',
    targetVersion: 1, method: 'field', purpose: 'facility_safety', confirmedBySource: true, completedAt: 1000, observedAt: 1000,
    result: { safe: true, version: 1, assessment: { method: 'field', purpose: 'facility_safety', competent: true, qualifications: ['field_assessment'],
      staffResource: 'crew', vehicle: 'van', operation: 'physical-assessment', targetVersion: 1, inspectorOrg: 'org0', observedAt: 1000, validUntil: 30000 } } });
};
test('assessment compiler requires received work timing, preserves unknown calendar, and refuses a crew whose field work crosses rest', async t => {
  const store = await serviceFixture(t);
  let plan = await assessmentPlan(store, 'org0', 'site');
  assert.equal(plan.readyToDraft, false); assert.equal(plan.staffCalendars[0].reason, 'staff_calendar_clock');
  await policy(store, 7001);
  plan = await assessmentPlan(store, 'org0', 'site');
  assert.equal(plan.readyToDraft, false); assert.equal(plan.staffCalendars[0].reason, 'staff_shift_too_short');
  await policy(store, 1000); plan = await assessmentPlan(store, 'org0', 'site');
  assert.equal(plan.readyToDraft, true); assert.equal(plan.staffCalendar.currentShiftEnd, 8000);
  await store.upsert('org0', 'vehicle', 'van', { driverAvailable: false });
  assert.equal((await assessmentPlan(store, 'org0', 'site')).readyToDraft, false, 'A qualified assessor without a driver is not a mobile crew');
  assert.equal((await store.list('org0', 'operation')).length, 0, 'A draft cannot create physical work');
});
test('service compiler distinguishes shift duration from competence and allows passive transfer into next valid shift', async t => {
  const store = await serviceFixture(t); await certify(store); await policy(store, 1000, 7001);
  let plan = await servicePlan(store, 'org0', 'site');
  assert.equal(plan.readyToDraft, false);
  let d = plan.missing.find(x => x.type === 'staff').diagnostics[0];
  assert.equal(d.reason, 'staff_calendar'); assert.equal(d.staffCalendar.reason, 'staff_shift_too_short');
  await store.upsert('org0', 'source', 'simulator', { simulatedAt: 8500 }); await policy(store, 1000, 1000, 500);
  plan = await servicePlan(store, 'org0', 'site');
  assert.equal(plan.readyToDraft, true); assert.equal(plan.actions[0].params.quantity, 1);
  assert.deepEqual(plan.actions[0].params.staffSkills, ['shelter_support']);
  await policy(store, 1000, 1000, 0); plan = await servicePlan(store, 'org0', 'site');
  assert.equal(plan.readyToDraft, false);
  d = plan.missing.find(x => x.type === 'staff').diagnostics[0];
  assert.equal(d.reason, 'staff_calendar'); assert.equal(d.staffCalendar.reason, 'staff_resting');
});
