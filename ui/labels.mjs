/** Display labels only: identifiers, source text and command payloads never change. */
const demoOrganizations = ['Relief North', 'Community East', 'Rescue South', 'Medical West', 'Independent contractor'];
const districts = ['Cedar', 'Maple', 'River', 'Sora', 'Hana', 'Sakura', 'Aoba', 'Mori', 'Harbor', 'Willow', 'Pine', 'Lake'];
const uses = { residential: 'Homes', shelter: 'Shelter', school: 'School', clinic: 'Clinic', warehouse: 'Depot', water: 'Water Station', hospital: 'Hospital', power: 'Power Station' };
const types = { water: 'Drinking water', food: 'Food', fuel: 'Fuel', blankets: 'Blankets', energy: 'Power equipment', sanitation: 'Sanitation supplies', staff: 'Response crew', rescue: 'Rescue equipment', medicine: 'Medical supplies' };
const labels = new Map();
let demo = false;
export function setDisplayContext({ organization, geography } = {}) {
  if (organization) {
    labels.clear();
    demo = /^org\d+$/.test(organization.id) && demoOrganizations.includes(organization.name);
    if (demo) demoOrganizations.forEach((name, i) => labels.set(`org${i}`, name));
    labels.set(organization.id, organization.name);
  }
  if (geography) {
    const assigned = new Map();
    for (const place of [...(geography.places ?? [])].sort((a,b) => a.id.localeCompare(b.id, 'en', {numeric:true}))) {
      const index = /^b(\d+)$/.exec(place.id)?.[1];
      const base = demo && index ? `${districts[Number(index) % districts.length]} ${uses[place.use] || 'Site'}` : null;
      const ordinal = (assigned.get(base) ?? 0) + 1;
      assigned.set(base, ordinal);
      const name = place.name || place.label || (base ? base + (ordinal > 1 ? ' ' + ordinal : '') : null);
      if (name) labels.set(place.id, name);
      if (name && place.node && !labels.has(place.node)) labels.set(place.node, `${name} access`);
    }
    for (const node of geography.nodes ?? []) if (node.name) labels.set(node.id, node.name);
  }
}
export function entityLabel(value) {
  const id = String(value ?? '');
  if (labels.has(id)) return labels.get(id);
  const vehicle = /^v-(org\d+)-(\d+)$/.exec(id);
  if (demo && vehicle) return `${entityLabel(vehicle[1])} · Vehicle ${Number(vehicle[2]) + 1}`;
  const resource = /^r-(org\d+)-([a-z_]+)(.*)$/.exec(id);
  if (demo && resource) return (types[resource[2]] || humanLabel(resource[2])) + (resource[3] ? ' · ' + resource[3].replace(/^[-_]/, '') : '');
  if (demo && /^need-[a-z]+/.test(id)) return humanLabel(id.replace(/^need-/, '').replaceAll('-', ' ')) + ' request';
  return id;
}
export function humanLabel(value) {
  const s = String(value ?? '').replaceAll('_', ' ');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}
export function resourceLabel(record) { return record.label || record.name || types[record.type] || entityLabel(record.id); }
export function registerDisplayRecords(kind, records) {
  for (const record of Array.isArray(records) ? records : records ? [records] : []) {
    if (!record.id) continue;
    if (kind === 'need') labels.set(record.id, `${humanLabel(record.type)} at ${entityLabel(record.building ?? record.node) || 'unconfirmed location'}`);
    else if (kind === 'resource') labels.set(record.id, resourceLabel(record));
    else if (['vehicle', 'facility'].includes(kind) && (record.label || record.name)) labels.set(record.id, record.label || record.name);
  }
}
/** Use for UI summaries, never for quoted source evidence or raw JSON. */
export function readableText(value) {
  return String(value ?? '').replace(/\b(?:need-[\w-]+|r-org\d+-[a-z_]+(?:-\w+)?|v-org\d+-\d+|org\d+|b\d+|n\d+)\b/g, entityLabel);
}
export function labelHints() { return demo ? 'Sample place names are display aliases for this laboratory map. Original identifiers remain in source records.' : ''; }
