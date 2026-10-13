import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHarness } from "../evaluation/harness.mjs";
import { Store } from "../src/store.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const helper = fileURLToPath(
  new URL("./fixtures/crash-platform-worker.mjs", import.meta.url),
);

async function launch(config, h, phase) {
  const child = spawn(process.execPath, [helper], {
    cwd: root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      OPENROUTER_API_KEY: "",
      DATABASE_URL: "",
      NEXO_LOCAL_DIR: config.localDir,
    },
  });
  // Do not echo stdout/stderr: bootstrap/source credentials are private even in a failed fixture.
  child.stdout.resume();
  child.stderr.resume();
  let checkpoint, complete;
  const exit = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Crash fixture exceeded bounded wall time"));
    }, 60000);
    child.on("error", reject);
    child.on("message", (message) => {
      if (message.phase === "tick") {
        h.lab.world.advance(h.lab.world.now + 60000);
        child.send({ continue: true });
      } else if (message.phase === phase) {
        checkpoint = message;
        child.kill("SIGKILL");
      } else if (message.phase === "completed") complete = message;
      else if (message.phase === "error") complete = message;
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, checkpoint, complete });
    });
  });
  // Keys are transferred only through the pipe and are not persisted by configuration.
  child.stdin.end(JSON.stringify(config));
  return exit;
}

for (const phase of [
  "before_dispatch",
  "after_dispatch_ack",
  "after_local_receipt",
])
  test(
    `real process death ${phase} replays one authorized load from durable DB without duplicate effects`,
    { timeout: 150000 },
    async (t) => {
      const base = path.join(root, ".local");
      await mkdir(base, { recursive: true });
      const temp = await mkdtemp(path.join(base, "crash-recovery-"));
      assert.ok(path.resolve(temp).startsWith(path.resolve(base) + path.sep));
      t.after(() => rm(temp, { recursive: true, force: true }));
      const h = await createHarness({
        config: {
          reviewMs: 1000,
          loadMs: 1000,
          unloadMs: 1000,
          grid: 5,
          extentKm: 2,
        },
      });
      t.after(() => h.close());
      h.lab.world.advance(60000);
      const initialStock = h.lab.world.resource("r-org0-water").quantity;
      const source = h.apps[0].connector;
      // This parent HTTP transport releases only ordinary query/review queue events,
      // exactly as the normal harness does. Physical advancement happens on the child's tick.
      const proxy = createServer(async (req, res) => {
        try {
          let body = "";
          for await (const part of req) body += part;
          const forwarded = await source.fetcher(source.url + req.url, {
            method: req.method,
            headers: req.headers,
            ...(body ? { body } : {}),
          });
          res.writeHead(forwarded.status, {
            "Content-Type": "application/json",
          });
          res.end(await forwarded.text());
        } catch {
          res.writeHead(502);
          res.end('{"error":"FIXTURE_PROXY"}');
        }
      });
      await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      t.after(() => new Promise((resolve) => proxy.close(resolve)));
      const config = {
        dataDir: path.join(temp, "pgdata"),
        localDir: path.join(temp, "configuration"),
        sourceUrl: "http://127.0.0.1:" + proxy.address().port,
        sourceAgentKey: source.agentKey,
        sourceHumanKey: source.humanKey,
      };
      const killed = await launch({ ...config, crashAt: phase }, h, phase);
      assert.ok(
        killed.checkpoint,
        "Process reached the actual emission/persistence boundary: " +
          (killed.complete?.code ?? "no checkpoint"),
      );
      assert.notEqual(
        killed.code,
        0,
        "Process died without graceful platform/DB close",
      );
      assert.ok(
        (await readdir(config.dataDir)).length > 0,
        "The child used filesystem-backed database files",
      );
      const physicalBefore = h.lab.world.state.operations.filter(
        (o) => o.type === "delivery",
      );
      assert.equal(physicalBefore.length, phase === "before_dispatch" ? 0 : 1);
      const firstOperation = physicalBefore[0]?.id;
      const db = await Store.open({ dataDir: config.dataDir });
      const saved = await db.get(
        "org0",
        "proposal",
        killed.checkpoint.proposalId,
      );
      assert.ok(
        saved.authorization?.by,
        "Human authorization survived the ungraceful death",
      );
      assert.equal(saved.authorization.planHash, killed.checkpoint.planHash);
      assert.equal(
        saved.executionResults?.length ?? 0,
        phase === "after_local_receipt" ? 1 : 0,
      );
      const proposalCount = (await db.list("org0", "proposal", 20)).length;
      assert.equal(proposalCount, 1);
      await db.close();
      const recovered = await launch(config, h, "unused");
      assert.equal(
        recovered.code,
        0,
        recovered.complete?.code ?? "Child recovery failed",
      );
      assert.equal(recovered.complete.state, "completed");
      assert.equal(recovered.complete.proposalId, killed.checkpoint.proposalId);
      assert.equal(recovered.complete.planHash, killed.checkpoint.planHash);
      assert.equal(recovered.complete.executionResults.length, 1);
      assert.equal(recovered.complete.usage, 0);
      const physicalAfter = h.lab.world.state.operations.filter(
        (o) => o.type === "delivery",
      );
      assert.equal(physicalAfter.length, 1);
      assert.equal(h.lab.world.state.proposals.length, 1);
      if (firstOperation) assert.equal(physicalAfter[0].id, firstOperation);
      assert.equal(
        h.lab.world.resource("r-org0-water").quantity,
        initialStock - 300,
        "A replay never deducts or reserves another physical load",
      );
      assert.equal(h.lab.world.need("need-water-main").served, 300);
      assert.equal(physicalAfter[0].received, 300);
      assert.deepEqual(h.lab.world.invariants(), []);
      const final = await Store.open({ dataDir: config.dataDir });
      assert.equal((await final.list("org0", "proposal", 20)).length, 1);
      assert.equal((await final.list("org0", "operation", 20)).length, 1);
      assert.equal(
        (
          await final.query(
            "SELECT COUNT(*)::int AS n FROM audit WHERE action='proposal.approve'",
          )
        ).rows[0].n,
        1,
        "Restart never manufactures another operator approval",
      );
      await final.close();
    },
  );
