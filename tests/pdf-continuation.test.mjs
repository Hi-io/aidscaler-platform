import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { Store } from "../src/store.mjs";
import { EvidenceStore } from "../src/evidence.mjs";
import { MediaProcessor } from "../src/media.mjs";
test("PDF batches preserve page provenance, resume pages beyond the first twenty, and do not reinterpret finished pages", async (t) => {
  const store = await Store.open(); t.after(() => store.close()); await store.organization("org0");
  const evidenceDir = await mkdtemp(path.resolve(".local/pdf-contract-")), config = { evidenceDir }, evidence = new EvidenceStore(store, config);
  const m = await evidence.save({ org: "org0", id: "owner", role: "field" }, { contentBase64: Buffer.from("contract-only-pdf").toString("base64"), mime: "application/pdf", title: "Contract fixture, not a perception benchmark", source: "permitted synthetic source" }, "upload");
  let calls = 0;
  const processor = new MediaProcessor({ store, config, evidence, decoder: async (_, request) => {
    const numbers = request.pages ?? Array.from({ length: 20 }, (_, i) => i + 1), pages = [];
    for (const [i, page] of numbers.entries()) {
      const renderPath = path.resolve(evidenceDir, "p" + page + ".png"); await writeFile(renderPath, Buffer.from("contract-frame"));
      pages.push({ page, text: "", ...(i < 4 ? { renderPath } : {}), textProvenance: "embedded_pdf_text", ocrState: "pending_context_limit" });
    }
    return { pages, totalPageCount: 24 };
  }, provider: { complete: async ({ messages }) => {
    calls++; const pages = messages[0].content.filter((p) => p.type === "text" && p.text.startsWith("Source PDF page ")).map((p) => ({ page: Number(p.text.split(" ").at(-1)), text: "Observed page " + p.text.split(" ").at(-1), uncertainties: [] }));
    return { model: "contract-fixture", usage: {}, message: { content: JSON.stringify({ pages }) } };
  } } });
  const initial = await processor.analyze("org0", m.id);
  assert.equal(initial.result.pendingPageNumbers.length, 20);
  for (const pages of [[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20],[21,22,23,24]]) await processor.analyze("org0", m.id, "batch-" + pages[0], { pages });
  const result = await store.get("org0", "media_analysis", m.id);
  assert.equal(result.result.pages.length, 24); assert.equal(result.result.pendingPageNumbers.length, 0);
  assert.equal(result.result.pages[23].page, 24); assert.equal(result.requiresHumanVerification, true);
  assert.equal(calls, 6);
  await processor.analyze("org0", m.id, "duplicate", { pages: [21,22,23,24] }); assert.equal(calls, 6);
  await assert.rejects(processor.analyze("org0", m.id, "bad", { pages: [25] }), (e) => e.code === "PDF_PAGES");
});
