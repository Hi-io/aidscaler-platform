import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../.local/", import.meta.url));
const script = fileURLToPath(
  new URL("../scripts/hygiene.mjs", import.meta.url),
);
test("commit hygiene rejects a staged credential even when the working copy was redacted", async () => {
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "hygiene-fixture-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
      cwd: dir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const run = () =>
    spawnSync(process.execPath, [script, "--staged"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
    });
  try {
    git("init", "--quiet");
    // Construct a nonfunctional test string; no real credentials are used.
    const fake = ["sk", "or", "v1", "0".repeat(64)].join("-");
    await writeFile(path.join(dir, "config.txt"), fake);
    git("add", "--", "config.txt");
    await writeFile(path.join(dir, "config.txt"), "redacted working copy");
    let r = run();
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /Credential pattern detected in tracked file: config.txt/,
    );
    assert.ok(!r.stdout.includes(fake) && !r.stderr.includes(fake));
    git("add", "--", "config.txt");
    assert.equal(run().status, 0);
    await writeFile(path.join(dir, "AGENTS.md"), "private agent configuration");
    git("add", "-f", "--", "AGENTS.md");
    r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Private artifact would be tracked: AGENTS.md/);
  } finally {
    const resolved = path.resolve(dir),
      boundary = path.resolve(root) + path.sep;
    if (!resolved.startsWith(boundary))
      throw Error("Invalid fixture cleanup path");
    await rm(resolved, { recursive: true, force: true });
  }
});
