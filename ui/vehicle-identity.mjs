/** Presentation only. Demo registrations never enter source records or commands. */
const canonicalNumber = '(0|[1-9]\\d*)';
const fleetId = new RegExp(`^v-org${canonicalNumber}-${canonicalNumber}$`);
const trafficId = new RegExp(`^traffic-${canonicalNumber}$`);

function plateText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function receivedPlate(record) {
  for (const value of [record.licensePlate, record.registrationPlate, record.plate,
    record.registration, record.registration?.number, record.registration?.plate]) {
    const text = plateText(value);
    if (text) return text;
  }
  return '';
}

function demoPlate(id) {
  const fleet = fleetId.exec(id);
  // Separate numeric components make this injective, including fleets over 9,999 vehicles.
  if (fleet) return `TK-${String(BigInt(fleet[1]) + 1n).padStart(2, '0')}-${String(BigInt(fleet[2]) + 1n).padStart(4, '0')}`;
  const traffic = trafficId.exec(id);
  if (traffic) return `TK-T-${String(BigInt(traffic[1]) + 1n).padStart(4, '0')}`;
  return '';
}

export function vehicleIdentity(record = {}, { demo = false } = {}) {
  const id = String(record.id ?? '');
  const declared = receivedPlate(record);
  const plate = declared || (demo ? demoPlate(id) : '');
  const isDemo = Boolean(plate && !declared);
  const isBackground = record.background === true || Boolean(demo && trafficId.test(id));
  const fleet = fleetId.exec(id);
  const name = record.label || record.name || (fleet ? `Vehicle ${BigInt(fleet[2]) + 1n}` : id || 'Vehicle');
  const label = plate && !String(name).includes(plate) ? `${name} · ${plate}` : String(name);
  return { label, plate, isDemo, isBackground, registrationLabel: isDemo ? 'Demo registration' : 'Registration' };
}
