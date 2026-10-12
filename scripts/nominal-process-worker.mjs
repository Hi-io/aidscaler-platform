// Private evaluator worker. This IPC channel is never a candidate input source.
import { createPlatform } from "../server.mjs";
let app;
process.on("message", async ({ id, type, data }) => {
  try {
    let result;
    if (type === "init") {
      app = await createPlatform({
        port: 0,
        org: data.org,
        sourceUrl: data.sourceUrl,
        sourceAgentKey: data.sourceAgentKey,
        autoIngest: false,
        autoInvestigate: false,
        startWorker: false,
        writeAccessFile: false,
        apiKey: undefined,
        provider: {
          async complete() {
            throw Error("Model calls are outside this transport-only probe.");
          },
        },
        bootstrapPassword: "evaluation-password",
      });
      result = { url: app.url, org: app.config.org, pollMs: app.config.pollMs };
    } else if (type === "ingest") {
      const began = performance.now();
      await app.ingestion.sync();
      const missing = [],
        delays = [];
      for (const sourceId of data.ids) {
        const source = await app.store.get(
          app.config.org,
          "signal",
          sourceId,
          false,
        );
        if (!source) missing.push(sourceId);
        else delays.push(Math.max(0, Date.now() - data.availableAt));
      }
      result = {
        batch: data.batch,
        org: app.config.org,
        expected: data.ids.length,
        durable: data.ids.length - missing.length,
        missing,
        ingestionWallMs: performance.now() - began,
        availableToDurableMs: delays,
      };
    } else if (type === "commands") {
      const signal = (await app.store.list(app.config.org, "signal", 1))[0];
      result = [];
      for (let i = 0; i < 30; i++) {
        const began = performance.now();
        await app.domain.createClaim(
          { org: app.config.org, id: "flow-analyst", role: "analyst" },
          {
            text: "Unverified performance probe; no operational authority",
            state: "pending",
            references: [signal.id],
          },
          data.run + "-command-" + i,
        );
        result.push(performance.now() - began);
      }
    } else if (type === "close") {
      await app?.close();
      app = null;
      result = { closed: true };
    } else throw Error("Unknown evaluator command.");
    process.send({ id, result });
    if (type === "close") process.disconnect();
  } catch (e) {
    process.send({
      id,
      error: { code: e.code ?? e.name, message: e.message.slice(0, 300) },
    });
  }
});
process.on("disconnect", () => app?.close());
