import test from "node:test";
import assert from "node:assert/strict";
import { selectOriginalSources, parseExplicitCurrentRequest, conventionalInterpret, keywordCandidates } from "../evaluation/conventional-source.mjs";

const places = [{ id: "b1", name: "North School" }, { id: "b2", name: "East Hall" }];
const post = (id, text, extra = {}) => ({ id, text, publishedAt: 1000, source: "public network", ...extra });

test("canonical current requests are free, scoped native-unit inquiry candidates without truth labels", () => {
  for (const [text, type, quantity, unit] of [["North School still needs 600 litres of drinking water.", "water", 600, "L"], ["Requesting 120 meal portions for East Hall.", "food", 120, "portion"], ["The outstanding request at b1 is 30 blankets.", "blankets", 30, "unit"]]) {
    const source = post("source", text, { private: { labels: { location: "b900", quantity: 9999 } } }),
      result = parseExplicitCurrentRequest(source, places);
    assert.ok(result);
    assert.equal(result.resourceType, type);
    assert.equal(result.quantity, quantity);
    assert.equal(result.unit, unit);
    assert.deepEqual(result.sourceIds, ["source"]);
    assert.equal(result.requiresVerification, true);
    assert.equal(result.canEraseNeed, false);
  }
});

test("explicit parsing does not invent locations, aggregate alternatives or convert ambiguous quantities", () => {
  assert.equal(parseExplicitCurrentRequest(post("a", "Unknown Town still needs 300 litres of water.", { private: { location: "b1" } }), places), null);
  assert.equal(parseExplicitCurrentRequest(post("a", "b1 and b2 need 300 litres of water."), places), null);
  assert.equal(parseExplicitCurrentRequest(post("a", "b1 needs 300 litres of water or 600 litres of water."), places), null);
  assert.equal(parseExplicitCurrentRequest(post("a", "b1 needs 1,5 litres of water."), places), null);
  assert.equal(parseExplicitCurrentRequest(post("a", "b1 needs 1,200 litres of water."), places).quantity, 1200);
  assert.equal(publicCandidateLocation("b10 needs 20 blankets."), null);
});
function publicCandidateLocation(text) { return parseExplicitCurrentRequest(post("a", text), places)?.location ?? null; }

test("conventional contextual reading preserves implicit requests and uncertainty without inventing native quantities", () => {
  const result = conventionalInterpret(post("a", "At North School the families have not eaten and cannot keep warm. Please help."), places);
  assert.deepEqual(result.map(o => o.resourceType).sort(), ["blankets", "food"]);
  assert.ok(result.every(o => o.location === "b1" && o.quantity === null && o.requiresVerification));
  const unknown = conventionalInterpret(post("a", "Families at Unknown Town are hungry and need meals."), places);
  assert.equal(unknown[0].location, null);
  assert.equal(unknown[0].kind, "need");
});

test("cancellation and archival posts never erase a current need; old clip corrections do not swallow a current request", () => {
  const cancellations = conventionalInterpret(post("a", "Everyone has been evacuated from North School. No water is needed."), places);
  assert.equal(cancellations[0].kind, "correction");
  assert.equal(cancellations[0].canEraseNeed, false);
  assert.equal(parseExplicitCurrentRequest(post("a", "Archive: North School needs 600 litres of water. Old clip from 2023."), places), null);
  const current = conventionalInterpret(post("a", "That is an old video. North School still needs 600 litres of water today."), places);
  assert.equal(current[0].kind, "need");
  assert.equal(current[0].timeStatus, "current");
  assert.equal(current[0].quantity, 600);
});

test("public repost deduplication retains different places, corrections, independent sources and changed versions", () => {
  const input = [post("original", "b1 needs water."), post("copy", "b1 needs water.", { originalReferences: ["original"] }),
    post("other-place", "b2 needs water.", { originalReferences: ["original"] }),
    post("correction", "b1 still needs water; that clip is old.", { originalReferences: ["original"] }),
    post("independent", "b1 needs water."),
    post("update", "b1 needs 20 blankets.", { version: 1 }), post("update", "b1 needs 30 blankets.", { version: 2 })];
  const selected = selectOriginalSources(input);
  assert.deepEqual(selected.map(s => s.id), ["original", "other-place", "correction", "independent", "update"]);
  assert.equal(selected.at(-1).version, 2);
  assert.equal(input.length, 7);
});

test("B8 cheaply keeps noisy, contradictory and multi-place candidates for the same field checks", () => {
  const falsePositive = keywordCandidates(post("a", "Thinking of the water teams around b1. Sending support."), places);
  assert.equal(falsePositive[0].location, "b1");
  assert.equal(falsePositive[0].resourceType, "water");
  assert.equal(falsePositive[0].quantity, null);
  assert.ok(keywordCandidates(post("b", "North School no longer needs water."), places).length > 0);
  assert.equal(keywordCandidates(post("c", "Archived report: North School needs water."), places).length, 0);
  assert.equal(keywordCandidates(post("d", "Need water at Unknown Town."), places).length, 0);
  assert.deepEqual(keywordCandidates(post("e", "Help at b1 and b2."), places).map(o => o.location), ["b1", "b2"]);
});

test("the zero-attention explicit control gives conventional and keyword references the same actionable locations", () => {
  const sources = [post("a", "b1 needs 600 litres of water."), post("b", "b2 needs 25 blankets.")];
  const conventional = sources.flatMap(s => conventionalInterpret(s, places)), automated = sources.flatMap(s => keywordCandidates(s, places));
  assert.deepEqual(conventional.map(o => [o.location, o.resourceType]), automated.map(o => [o.location, o.resourceType]));
  assert.ok(sources.every(s => parseExplicitCurrentRequest(s, places)));
  assert.ok([...conventional, ...automated].every(o => !o.canEraseNeed && o.requiresVerification));
});

test("a current blanket shortfall survives an old-video explanation in the literal contextual benchmark", () => {
  const source = post("blanket-context", "b1 | 35 people will sleep here tonight. We have twelve blankets, one per person. The remaining people have nothing to cover them. Please help with the shortfall; the old video about an empty shelter is from a different incident.");
  for (const observations of [conventionalInterpret(source, places), keywordCandidates(source, places)]) {
    const request = observations.find(o => o.kind === "need" && o.location === "b1" && o.resourceType === "blankets");
    assert.ok(request, "The existing need must not be discarded because its post mentions an old clip.");
    assert.equal(request.timeStatus, "current");
    assert.equal(request.canEraseNeed, false);
    assert.equal(request.requiresVerification, true);
  }
});

test("the explicit native unit-of-blankets control is parsed without charged semantic reading", () => {
  const source = post("explicit-blankets", "CURRENT REQUEST at b1: 20 unit of blankets are still needed. Please coordinate with a response team."),
    observation = parseExplicitCurrentRequest(source, places);
  assert.ok(observation);
  assert.equal(observation.location, "b1");
  assert.equal(observation.resourceType, "blankets");
  assert.equal(observation.quantity, 20);
  assert.equal(observation.unit, "unit");
  assert.equal(observation.timeStatus, "current");
});
