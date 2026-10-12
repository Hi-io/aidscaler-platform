import { Store } from "../src/store.mjs";
import { configuration } from "../src/config.mjs";
import { EvidenceStore } from "../src/evidence.mjs";
import { OpenRouterProvider } from "../src/provider.mjs";
import { MediaProcessor } from "../src/media.mjs";
import { PublicEvidence } from "../src/public-evidence.mjs";
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
  const image = (await store.list(config.org, "media", 20)).find(
    (m) => m.mime === "image/png",
  );
  // Explicit synthetic receipt fixture: tests actual image transformation,
  // not a delivery, visual privacy detector or clinical evidence.
  await store.put(
    config.org,
    "operation",
    "byte-smoke-receipt",
    {
      state: "completed",
      confirmedBySource: true,
      syntheticFixture: true,
      received: 1,
    },
    0,
  );
  const publicEvidence = new PublicEvidence(store, evidence, config);
  const proof = await publicEvidence.approve(
    { org: config.org, id: "fixture-reviewer", role: "publisher" },
    {
      mediaId: image.id,
      operationId: "byte-smoke-receipt",
      privacyReviewed: true,
      caption: "Synthetic container image for byte integration",
    },
    "byte-public-proof",
  );
  const rendition = await readFile(
    config.evidenceDir + "/" + config.org + "/" + proof.publicHash,
  );
  assert.equal(rendition.subarray(1, 4).toString(), "PNG");
  assert.equal(proof.metadataStripped, true);
  assert.ok(proof.dimensions.width <= 1600 && proof.dimensions.height <= 1600);
  assert.equal(
    await publicEvidence.publiclyVisible(config.org, proof.id),
    null,
  );
  report.results.push({
    filename: "reviewed-public-rendition.png",
    engine: "local-PIL-metadata-free-rendition",
    syntheticReceiptFixture: true,
    metadataStripped: proof.metadataStripped,
    dimensions: proof.dimensions,
    publicHash: proof.publicHash,
    notPublishedByDefault: true,
    passed: true,
  });
  console.log(
    "Processed actual bytes: reviewed public image rendition (private by default)",
  );
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
    for (const f of r.result?.frames ?? []) delete f.path;
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/media-byte-smoke.json",
    JSON.stringify(report, null, 2),
  );
  await store.close();
}
