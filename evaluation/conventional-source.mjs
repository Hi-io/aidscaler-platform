/** Competent, auditable source-reading references. These helpers accept only
 * received public records and the public place directory. They never read world
 * needs, truth labels, private metadata or future events, and never dispatch.
 * The evaluator charges finite reading time separately from this parser.
 * This is a reproducible laboratory approximation, not calibrated human skill.
 */
const normalize = (text) => String(text ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const cleanText = (source) => String(source?.text ?? "");
const sourceIds = (source) => typeof source?.id === "string" ? [source.id] : [];
const boundary = (word) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`, "i");
const activeOperations = /\b(?:need(?:s|ed)?|request(?:s|ed|ing)?|shortfall|outstanding|waiting for|nearly gone|ran out|running out|without|no clean|no drinking|empty containers|stranded|trapped|displaced|freezing|hungry|haven.t eaten|have not eaten|cannot keep warm)\b/i;
const supportOnly = /\b(?:thinking of|sending strength|sending love|sending encouragement|wishing|hope everyone|thoughts and prayers|thank.you)\b/i;
const capacityLanguage = /\b(?:we can (?:provide|share|send)|we have (?:spare|available)|offering|spare (?:stock|capacity)|available (?:stock|capacity)|can help with|ready to supply)\b/i;
const cancellationLanguage = /\b(?:no longer need(?:s|ed)?|do(?:es)? not need|don.t need|no (?:help|aid|water|food|blankets) (?:is )?needed|already evacuated|everyone (?:has|have) been evacuated|request (?:is )?(?:fulfilled|cancelled|canceled)|all needs (?:are )?covered)\b/i;
const explicitArchive = /\b(?:archive|archived|old (?:video|clip|photo|report)|last year|previous disaster|recorded before|from 20(?:0\d|1\d|2[0-5]))\b/i;
const explicitCurrent = /\b(?:today|tonight|right now|currently|current (?:request|shortfall|need)|still (?:need(?:s|ed)?|waiting|here|at)|remains outstanding|remaining (?:people|requirement|request)|latest from)\b/i;

const resources = [
  ["water", /\b(?:water|drinking|potable|hydration|h2o)\b/i],
  ["food", /\b(?:food|meals?|portions?|rations?|hungry|feeding|haven.t eaten|have not eaten)\b/i],
  ["blankets", /\b(?:blankets?|quilts?|bedding|freezing|keep warm|warmth|cold night)\b/i],
  ["shelter", /\b(?:shelter|displaced|temporary housing|sleep outdoors|sleeping outside|nowhere to sleep|roof over)\b/i],
  ["medicine", /\b(?:medicines?|medications?|insulin|medical supplies|pills?)\b/i],
  ["energy", /\b(?:energy|power|electricity|generators?)\b/i],
  ["sanitation", /\b(?:sanitation|toilets?|latrines?|sewage)\b/i],
  ["staff", /\b(?:staff|personnel|volunteers?|qualified team)\b/i],
  ["rescue", /\b(?:rescue|trapped|collapsed building|under rubble)\b/i],
  ["transport", /\b(?:transport|trucks?|vehicles?|stranded|rides?)\b/i],
  ["communication", /\b(?:communication|radio|internet|network|phone signal|connectivity)\b/i],
];
const quantityPatterns = {
  water: [/(\d+(?:[.,]\d+)?)\s*(litres?|liters?|l)\b(?:\s+of)?(?:\s+drinking)?\s*water\b/i],
  food: [/(\d+(?:[.,]\d+)?)\s*(meal portions?|meals?|portions?|rations?)\b/i],
  blankets: [/(\d+(?:[.,]\d+)?)\s*(?:units?\s+of\s+)?(blankets?|quilts?)\b/i],
  shelter: [/(\d+(?:[.,]\d+)?)\s*(shelter places?|places?|beds?)\b/i],
  medicine: [/(\d+(?:[.,]\d+)?)\s*(units?)\s+of\s+medicine\b/i],
  energy: [/(\d+(?:[.,]\d+)?)\s*(energy units?)\b/i],
  sanitation: [/(\d+(?:[.,]\d+)?)\s*(sanitation units?)\b/i],
  staff: [/(\d+(?:[.,]\d+)?)\s*(staff members?|personnel|volunteers?)\b/i],
  rescue: [/(\d+(?:[.,]\d+)?)\s*(rescue units?)\b/i],
  transport: [/(\d+(?:[.,]\d+)?)\s*(transport units?|vehicles?|trucks?)\b/i],
};
const canonicalUnits = { water: "L", food: "portion", blankets: "unit", shelter: "place", medicine: "unit", energy: "unit", sanitation: "unit", staff: "person", rescue: "unit", transport: "unit" };

/** Resolve only identifiers/names supplied in a received public directory.
 * Metadata location is a lead, never proof that a need exists there. */
export function publicLocations(source, places = []) {
  const text = cleanText(source), matches = new Set();
  for (const place of places) {
    if (!place || typeof place.id !== "string") continue;
    if (source?.location === place.id || boundary(place.id).test(text) ||
      typeof place.name === "string" && place.name.length >= 3 && boundary(place.name).test(text)) matches.add(place.id);
  }
  return [...matches];
}

function timeStatus(source) {
  const text = cleanText(source);
  // Current demand survives a reference to an old misleading clip. An explicit
  // archival post by itself is not a present request. No numeric year is inferred
  // from the evaluator clock or a private template label.
  if (explicitCurrent.test(text)) return "current";
  if (explicitArchive.test(text) || source?.timeStatus === "historical") return "historical";
  return "unknown";
}

function quantityFor(text, resourceType, { demand = false } = {}) {
  const matches = (quantityPatterns[resourceType] ?? []).flatMap((pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    return [...text.matchAll(new RegExp(pattern.source, flags))];
  });
  // Do not combine two quoted quantities, different deliveries or alternatives.
  if (matches.length !== 1) return { quantity: null, unit: null };
  const match = matches[0], before = text.slice(0, match.index), after = text.slice(match.index + match[0].length),
    clauseBefore = before.split(/[.;!?|\n]/).at(-1), clauseAfter = after.split(/[.;!?|\n]/)[0],
    explicitDemand = /\b(?:need(?:s|ed)?|request(?:s|ed|ing)?|shortfall|require(?:s|d)?|waiting for|additional|another|outstanding)\b/i.test(clauseBefore) ||
      /^\s*(?:are |is |still )?(?:needed|required|outstanding|short)\b/i.test(clauseAfter),
    stockAfterQuantity = /^\s*(?:(?:are|is) )?(?:still )?(?:left|remaining|available|in stock|already delivered)\b/i.test(clauseAfter),
    availability = /\b(?:we have|only|stock|available|remaining|already (?:received|delivered)|provided|donated|delivered)\b/i.test(clauseBefore) ||
      stockAfterQuantity;
  // A general plea earlier in this clause does not turn "15 meals left" into
  // a request for 15 meals. A direct "only 15 meals needed" remains demand.
  if (demand && (stockAfterQuantity || !explicitDemand))
    return { quantity: null, unit: null, ...(availability ? { quantityRole: "available_stock" } : {}) };
  const literal = matches[0][1];
  // A thousands separator is common; an ambiguous decimal comma remains
  // unresolved instead of silently changing the native quantity.
  const parsed = /^\d{1,3},\d{3}$/.test(literal) ? Number(literal.replace(",", "")) :
    literal.includes(",") ? NaN : Number(literal);
  return Number.isFinite(parsed) && parsed > 0 ? { quantity: parsed, unit: canonicalUnits[resourceType] } : { quantity: null, unit: null };
}

function observation(source, { kind = "need", location = null, resourceType = null, quantity = null, unit = null, status = timeStatus(source) } = {}) {
  return { kind, location, resourceType, quantity, unit, timeStatus: status, sourceIds: sourceIds(source),
    text: cleanText(source).slice(0, 600), state: "unverified", requiresVerification: true, canEraseNeed: false };
}

/** Deduplicate explicit public repost lineage for identical content only.
 * Corrections, different places, changed text and independent witnesses survive.
 * Without lineage, identical wording does not imply one original witness. */
export function selectOriginalSources(sources = []) {
  const latest = new Map();
  for (const [position, source] of sources.entries()) {
    if (!source || typeof source.id !== "string" || source.deleted || source.state === "erased") continue;
    const previous = latest.get(source.id),
      version = source.sourceVersion ?? source.version ?? 1;
    if (!previous || Number(version) > Number(previous.version)) latest.set(source.id, { source, version, position });
  }
  const representatives = new Map();
  for (const entry of [...latest.values()].sort((a, b) => a.position - b.position)) {
    const { source } = entry,
      explicitRoot = source.repostOf ?? source.originalId ?? source.originalReference ??
        (Array.isArray(source.originalReferences) ? source.originalReferences[0] : null) ??
        (source.repost === true && Array.isArray(source.references) ? source.references[0] : null),
      root = typeof explicitRoot === "string" ? explicitRoot : source.id,
      text = normalize(cleanText(source)).replace(/^(?:repost|shared|rt)\s*:\s*/, ""),
      key = JSON.stringify([root, source.location ?? null, text]);
    const previous = representatives.get(key);
    if (!previous || source.id === root) representatives.set(key, entry);
  }
  return [...representatives.values()].sort((a, b) => a.position - b.position).map((entry) => entry.source);
}

/** Free conventional ingestion of explicit current requests. This intentionally
 * handles canonical templates and simple natural wording without a model.
 * Its output is a targeted inquiry candidate, never a confirmed need. */
export function parseExplicitCurrentRequest(source, places = []) {
  const text = cleanText(source), locations = publicLocations(source, places),
    types = resources.filter(([, pattern]) => pattern.test(text)).map(([type]) => type),
    status = timeStatus(source);
  if (!sourceIds(source).length || locations.length !== 1 || types.length !== 1 ||
    status === "historical" || cancellationLanguage.test(text) || capacityLanguage.test(text) ||
    supportOnly.test(text) && !activeOperations.test(text) || !activeOperations.test(text)) return null;
  const quantity = quantityFor(text, types[0], { demand: true });
  // "Only 15 meals left" is stock, never a request for 15 meals. A plainly
  // current shortage still supplies a cheap location lead for the same owner
  // inquiry; that inquiry, rather than this parser, establishes real demand.
  if (quantity.quantity === null && quantity.quantityRole !== "available_stock") return null;
  return { ...observation(source, { location: locations[0], resourceType: types[0], ...quantity, status: "current" }),
    ...(quantity.quantityRole ? { quantityRole: quantity.quantityRole } : {}) };
}

/** Approximation of a competent finite-attention reader. It recognizes common
 * paraphrases and urgency but never fabricates quantities or map identifiers.
 * Negative/archival/support/capacity reports remain visible observations; no
 * cancellation, popularity or absence deletes a received operational need. */
export function conventionalInterpret(source, places = []) {
  if (!sourceIds(source).length) return [];
  const text = cleanText(source), locations = publicLocations(source, places),
    types = resources.filter(([, pattern]) => pattern.test(text)).map(([type]) => type),
    status = timeStatus(source), explicit = parseExplicitCurrentRequest(source, places);
  if (explicit) return [explicit];
  if (cancellationLanguage.test(text)) return [observation(source, { kind: "correction", location: locations.length === 1 ? locations[0] : null, status })];
  if (status === "historical") return [observation(source, { kind: "uncertainty", location: locations.length === 1 ? locations[0] : null, status })];
  if (capacityLanguage.test(text)) return (types.length ? types : [null]).map(resourceType => observation(source, { kind: "capacity", location: locations.length === 1 ? locations[0] : null, resourceType, ...quantityFor(text, resourceType), status }));
  if (supportOnly.test(text) && !activeOperations.test(text)) return [observation(source, { kind: "uncertainty", location: locations.length === 1 ? locations[0] : null, status })];
  if (!activeOperations.test(text) || !types.length) return [observation(source, { kind: "uncertainty", location: locations.length === 1 ? locations[0] : null, status })];
  // Several named places can be checked conservatively, but the same quoted
  // quantity is not assigned to every place. Field results determine demand.
  const relevantLocations = locations.length ? locations : [null];
  return relevantLocations.flatMap(location => types.map(resourceType => observation(source, {
    location, resourceType, ...(locations.length === 1 ? quantityFor(text, resourceType, { demand: true }) : {}), status,
  })));
}

/** Strong automated B8 reference: broad keyword/location candidates cost no
 * semantic reading time. It tolerates false positives and requests the same
 * responsible field check. Only explicitly labelled archival content is held
 * aside; unclear/current contradictions stay candidates for review. */
export function keywordCandidates(source, places = []) {
  if (!sourceIds(source).length) return [];
  const text = cleanText(source), status = timeStatus(source),
    locations = publicLocations(source, places),
    types = resources.filter(([, pattern]) => pattern.test(text)).map(([type]) => type);
  if (!locations.length || status === "historical") return [];
  const candidates = types.length ? types : /\b(?:help|aid|support|emergency)\b/i.test(text) ? [null] : [];
  return locations.flatMap(location => candidates.map(resourceType => observation(source, { location, resourceType, status })));
}
export const keyword_candidates = keywordCandidates;
