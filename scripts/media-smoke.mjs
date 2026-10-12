import { Store } from "../src/store.mjs";
import { configuration } from "../src/config.mjs";
import { EvidenceStore } from "../src/evidence.mjs";
import { OpenRouterProvider } from "../src/provider.mjs";
import { MediaProcessor } from "../src/media.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const config = await configuration({
  org: "media-test",
  evidenceDir: ".local/media-test-evidence",
  maxCalls: 4,
  episodeBudgetUsd: 0.25,
});
const store = await Store.open();
await store.organization(config.org);
const evidence = new EvidenceStore(store, config),
  provider = new OpenRouterProvider(store, config),
  processor = new MediaProcessor({ store, config, evidence, provider });
const report = {
  at: new Date().toISOString(),
  kind: "synthetic-byte-integration",
  notAccuracyValidation: true,
  model: config.modelId,
  results: [],
};
try {
  for (const [filename, mime] of [
    ["return-note.wav", "audio/wav"],
    ["water-storage.png", "image/png"],
    ["access.mp4", "video/mp4"],
    ["field-note.pdf", "application/pdf"],
  ]) {
    const bytes = await readFile(".local/media-fixtures/" + filename);
    const media = await evidence.save(
      { org: config.org, id: "fixture-owner", role: "field" },
      {
        contentBase64: bytes.toString("base64"),
        mime,
        title: filename,
        source: "Synthetic integration fixture",
        observedAt: Date.now(),
      },
      "upload-" + filename,
    );
    const result = await processor.analyze(config.org, media.id, "byte-smoke");
    assert.equal(result.requiresHumanVerification, true);
    assert.equal(result.contentHash, media.contentHash);
    if (mime.startsWith("audio"))
      assert.match(result.result.text, /300|three hundred/i);
    if (mime.startsWith("image"))
      assert.equal(result.result.engine, "model-image-input");
    if (mime.startsWith("video")) assert.ok(result.result.frames.length > 1);
    if (mime === "application/pdf") assert.ok(result.result.pages.length === 1);
    report.results.push({
      filename,
      mime,
      contentHash: media.contentHash,
      engine: result.result.engine,
      result: result.result,
      passed: true,
    });
    console.log("Processed actual bytes:", filename);
  }
} catch (e) {
  report.error = e.code ?? e.name;
  process.exitCode = 1;
} finally {
  report.usage = (
    await store.query(
      "SELECT model,state,wall_ms,input_tokens,output_tokens,cost_usd,provider_id FROM usage",
    )
  ).rows;
  // Temporary decoder filenames are not portable evidence identifiers.
  for (const r of report.results)
    for (const f of r.result.frames ?? []) delete f.path;
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/media-byte-smoke.json",
    JSON.stringify(report, null, 2),
  );
  await store.close();
}
