import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ENGINE_BUILD } from "../../disaster-response-simulator/contracts/config.mjs";
import { digest } from "../../disaster-response-simulator/engine/determinism.mjs";
import {
  simulatorFingerprint,
  checkFinalBuilds,
  requireLoadedSimulatorBuild,
} from "../evaluation/simulator-build.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "nexo-build-integrity-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = pathToFileURL(dir + path.sep);
  for (const name of [
    "contracts",
    "engine",
    "generators",
    "content",
    "scenarios",
    "sources",
    "adapters",
    "evaluation",
    "viewer",
  ])
    await mkdir(new URL(name + "/", root));
  const files = [
    "contracts/config.mjs",
    "engine/physics.mjs",
    "generators/posts.mjs",
    "content/templates.mjs",
    "scenarios/earthquake.mjs",
    "sources/server.mjs",
    "adapters/reference.mjs",
    "evaluation/metrics.mjs",
    "viewer/geometry.js",
  ];
  for (const file of files)
    await writeFile(
      new URL(file, root),
      `// ${file}\nexport const version = 1;\n`,
    );
  return { root, files };
}

test("fresh simulator fingerprint exactly matches the loaded canonical ENGINE_BUILD", async () => {
  assert.equal(await simulatorFingerprint(), ENGINE_BUILD);
  assert.equal(await requireLoadedSimulatorBuild(), ENGINE_BUILD);
});

test("campaign startup refuses source bytes that differ from the simulator loaded in memory", async (t) => {
  const { root } = await fixture(t);
  const loadedBuild = await simulatorFingerprint({ root });
  assert.equal(
    await requireLoadedSimulatorBuild({ root, loadedBuild }),
    loadedBuild,
  );
  await writeFile(
    new URL("engine/physics.mjs", root),
    "export const version = 2;",
  );
  await assert.rejects(
    requireLoadedSimulatorBuild({ root, loadedBuild }),
    (e) => e.code === "SIMULATOR_BUILD_STALE",
  );
});

test("simulator fingerprint normalizes LF and includes behavior modules and every recursive viewer asset", async (t) => {
  const { root, files } = await fixture(t);
  const original = await simulatorFingerprint({ root });
  for (const file of files) {
    const url = new URL(file, root);
    await writeFile(
      url,
      (await readFile(url, "utf8")).replaceAll("\n", "\r\n"),
    );
  }
  assert.equal(await simulatorFingerprint({ root }), original);
  await writeFile(new URL("engine/notes.txt", root), "not behavior");
  await mkdir(new URL("engine/nested/", root));
  await writeFile(
    new URL("engine/nested/ignored.mjs", root),
    "nested file excluded by canonical manifest",
  );
  assert.equal(await simulatorFingerprint({ root }), original);
  await writeFile(
    new URL("engine/new-queue.mjs", root),
    "export const behavior = 2;",
  );
  assert.notEqual(await simulatorFingerprint({ root }), original);
  await rm(new URL("engine/new-queue.mjs", root));
  assert.equal(await simulatorFingerprint({ root }), original);
  await writeFile(
    new URL("viewer/geometry.js", root),
    "export const geometry = 2;",
  );
  assert.notEqual(await simulatorFingerprint({ root }), original);
  await writeFile(new URL("viewer/geometry.js", root), `// viewer/geometry.js\nexport const version = 1;\n`);
  assert.equal(await simulatorFingerprint({ root }), original);
  await mkdir(new URL("viewer/nested/", root));
  for (const file of ["viewer/app.js", "viewer/nested/panel.mjs", "viewer/nested/index.html", "viewer/nested/style.css"]) {
    await writeFile(new URL(file, root), "viewer behavior");
    assert.notEqual(await simulatorFingerprint({ root }), original, file + " must be pinned");
    await rm(new URL(file, root));
    assert.equal(await simulatorFingerprint({ root }), original);
  }
  await writeFile(new URL("viewer/nested/readme.txt", root), "not a runtime asset");
  assert.equal(await simulatorFingerprint({ root }), original);
});

test("final gates detect independent candidate, evaluator and simulator fixture edits without touching live code", async (t) => {
  const { root } = await fixture(t);
  await writeFile(new URL("candidate.txt", root), "candidate-v1");
  await writeFile(new URL("evaluator.txt", root), "evaluator-v1");
  const readers = {
    candidate: async () =>
      digest(await readFile(new URL("candidate.txt", root), "utf8")),
    evaluator: async () =>
      digest(await readFile(new URL("evaluator.txt", root), "utf8")),
    simulator: () => simulatorFingerprint({ root }),
  };
  const initial = Object.fromEntries(
    await Promise.all(
      Object.entries(readers).map(async ([key, read]) => [key, await read()]),
    ),
  );
  const unchanged = await checkFinalBuilds(initial, readers);
  assert.equal(unchanged.invalidStatus, null);
  assert.deepEqual(unchanged.errors, []);
  for (const key of Object.keys(readers))
    assert.equal(unchanged[key + "Changed"], false);
  const changes = {
    candidate: ["candidate.txt", "candidate-v2", "candidate-v1"],
    evaluator: ["evaluator.txt", "evaluator-v2", "evaluator-v1"],
    simulator: [
      "engine/physics.mjs",
      "export const version = 2;",
      await readFile(new URL("engine/physics.mjs", root), "utf8"),
    ],
  };
  for (const [key, [file, changed, restored]] of Object.entries(changes)) {
    await writeFile(new URL(file, root), changed);
    const gate = await checkFinalBuilds(initial, readers);
    assert.equal(gate.invalidStatus, `invalid_${key}_changed`);
    for (const other of Object.keys(readers))
      assert.equal(gate[other + "Changed"], other === key);
    assert.deepEqual(gate.errors, [
      { phase: "manifest", code: key.toUpperCase() + "_CHANGED_DURING_RUN" },
    ]);
    await writeFile(new URL(file, root), restored);
  }
});

test("removed simulator source invalidates the final report instead of discarding its measured outcomes", async (t) => {
  const { root } = await fixture(t);
  const initial = {
    candidate: "candidate",
    evaluator: "evaluator",
    simulator: await simulatorFingerprint({ root }),
  };
  await rm(new URL("evaluation/metrics.mjs", root));
  const gate = await checkFinalBuilds(initial, {
    candidate: async () => initial.candidate,
    evaluator: async () => initial.evaluator,
    simulator: () => simulatorFingerprint({ root }),
  });
  assert.equal(gate.invalidStatus, "invalid_simulator_changed");
  assert.equal(gate.simulatorChanged, true);
  assert.equal(gate.finalEngineBuild, null);
  assert.deepEqual(gate.errors, [
    {
      phase: "manifest",
      code: "SIMULATOR_CHANGED_DURING_RUN",
      unreadable: true,
    },
  ]);
});
