import test from "node:test";
import assert from "node:assert/strict";
import { createPublicationControls, publicationProofChoices } from "../ui/publications.mjs";
import { setDisplayContext } from "../ui/labels.mjs";

const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

test("selected correction photos stay selected and visible beyond the ordinary photo-choice limit", () => {
  const proofs = Array.from({ length: 20 }, (_, index) => ({ id: `proof-${index}`, state: "approved" }));
  proofs.push({ id: "private", state: "pending" });
  const shown = publicationProofChoices(proofs, ["proof-18", "proof-19", "private"]);
  assert.equal(shown.length, 12);
  assert.deepEqual(shown.slice(0, 2).map(proof => proof.id), ["proof-18", "proof-19"]);
  assert.equal(shown.some(proof => proof.id === "private"), false);
  assert.equal(new Set(shown.map(proof => proof.id)).size, shown.length);
});

test("text corrections retain their reviewed photo checkboxes and resolve older photo references", async () => {
  const publication = { id: "public-one", status: "received", title: "Water received", area: "Sakura", text: "The shelter received drinking water.", operationIds: ["operation-one"], proofIds: ["older-photo"] };
  const proof = { id: "older-photo", state: "approved", caption: "Reviewed delivery & receipt", operationId: "operation-one" };
  const operations = [{ id: "operation-one", type: "delivery", building: "b41", state: "received", confirmedBySource: true, received: 300 }];
  const documentBefore = globalThis.document, fields = new Map(); let content;
  globalThis.document = { querySelector: selector => { if (!fields.has(selector)) fields.set(selector, {}); return fields.get(selector); } };
  setDisplayContext({ organization: { id: "org0", name: "Relief North" }, geography: { places: [{ id: "b41", use: "shelter", node: "n41" }] } });
  try {
    const controls = createPublicationControls({
      api: async () => {}, escape, state: { user: { role: "publisher", org: "org0" } },
      record: async (kind, id) => kind === "publication" ? publication : kind === "operation" ? id ? operations.find(operation => operation.id === id) : [] : id === proof.id ? proof : [],
      modal: (_, markup) => { content = markup; },
    });
    assert.equal(await controls.run("publication-correct", publication.id), true);
    assert.match(content, /name="proof" value="older-photo" checked/);
    assert.match(content, /Reviewed delivery &amp; receipt/);
    assert.match(content, /Delivery to Sakura Shelter/);
    assert.doesNotMatch(content, /operation-one · received/);
    assert.equal(fields.get('[name="status"]').value, "received");
    assert.equal(fields.get('[name="operation"]').value, "operation-one", "friendly names never change submitted operational identity");
  } finally { globalThis.document = documentBefore; }
});
