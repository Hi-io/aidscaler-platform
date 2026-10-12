import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
test("every workspace module imported by the offline shell is precached for a disconnected reload", async () => {
 const worker = await readFile(new URL("../ui/sw.js", import.meta.url), "utf8"), assets = new Set([...worker.matchAll(/"(\/[^"\n]+)"/g)].map(m => m[1])), modules = (await readdir(new URL("../ui/", import.meta.url))).filter(f => f.endsWith(".mjs"));
 for (const module of modules) {
  const text = await readFile(new URL("../ui/" + module, import.meta.url), "utf8");
  for (const match of text.matchAll(/from\s+["']\.\/([^"']+\.mjs)["']/g)) assert.ok(assets.has("/" + match[1]), `Offline module missing: ${match[1]} from ${module}`);
 }
 assert.match(worker, /pathname\.startsWith\("\/api\/"\)/, "Operational APIs must never be cached as public shell assets");
});
