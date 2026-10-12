import { Store } from "../src/store.mjs";
import { configuration } from "../src/config.mjs";
import { EvidenceStore } from "../src/evidence.mjs";
import { OpenRouterProvider } from "../src/provider.mjs";
import { MediaProcessor } from "../src/media.mjs";
import { buildFingerprint, evaluatorFingerprint } from "../evaluation/harness.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const config = await configuration({ org: "pdf-continuation-test", evidenceDir: ".local/pdf-continuation-evidence", maxCalls: 8, budgetUsd: 0.1 }),
  store = await Store.open(), run = "pdf-bytes-" + Date.now();
await store.organization(config.org);
const evidence = new EvidenceStore(store, config), provider = new OpenRouterProvider(store, config), processor = new MediaProcessor({ store, config, evidence, provider }),
  report = { at: new Date().toISOString(), run, candidateFingerprint: await buildFingerprint(), evaluatorFingerprint: await evaluatorFingerprint(), scope: "23-page internally generated scanned PDF with actual bytes, local page rendering and real configured model transcription. Not independent OCR accuracy.", batches: [] };
const started = performance.now();
try {
 const bytes = await readFile(".local/media-fixtures/continuation-23.pdf"),
  media = await evidence.save({ org: config.org, id: "fixture-owner", role: "field" }, { contentBase64: bytes.toString("base64"), mime: "application/pdf", title: "Synthetic 23-page scan", source: "Permitted internally generated test fixture", observedAt: Date.now() }, run + "-upload");
 report.contentHash = media.contentHash;
 let result = await processor.analyze(config.org, media.id, run);
 report.batches.push({ completedPages: result.result.pages.filter(p => p.text?.trim()).map(p => p.page), pending: result.result.pendingPageNumbers });
 assert.equal(result.result.totalPageCount, 23); assert.ok(result.result.pendingPageNumbers.includes(23));
 for (let i = 0; result.result.pendingPageNumbers.length && i < 8; i++) {
  const pages = result.result.pendingPageNumbers.slice(0, 4);
  result = await processor.analyze(config.org, media.id, run, { pages });
  report.batches.push({ requestedPages: pages, completedPages: result.result.pages.filter(p => p.text?.trim()).map(p => p.page), pending: result.result.pendingPageNumbers });
 }
 assert.equal(result.result.pendingPageNumbers.length, 0); assert.equal(result.result.pages.length, 23);
 assert.ok(result.result.pages.every(p => p.textProvenance === "model_visual_transcription"));
 assert.match(result.result.pages.find(p => p.page === 23).text, /100|water/i);
 report.status = "passed"; report.pageCount = result.result.pages.length;
} catch (e) { report.status = "failed"; report.error = { code: e.code ?? e.name, message: e.message.slice(0, 400) }; process.exitCode = 1; }
finally {
 report.usage = (await store.query("SELECT model,state,input_tokens,output_tokens,cost_usd,reserved_usd,provider_id,wall_ms FROM usage")).rows;
 report.costUsd = report.usage.reduce((s, u) => s + Number(u.cost_usd ?? 0), 0); report.wallMs = performance.now() - started;
 report.candidateChanged = report.candidateFingerprint !== await buildFingerprint();
 await mkdir("reports/runs", { recursive: true }); await writeFile("reports/runs/" + run + ".json", JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ run, status: report.status, pages: report.pageCount, calls: report.usage.length, costUsd: report.costUsd, candidateChanged: report.candidateChanged, error: report.error }));
 await store.close(); if (report.candidateChanged) process.exitCode = 1;
}
