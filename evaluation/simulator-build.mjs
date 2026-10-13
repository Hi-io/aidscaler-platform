import { readdir, readFile } from "node:fs/promises";
import { digest } from "../../disaster-response-simulator/engine/determinism.mjs";
import { ENGINE_BUILD } from "../../disaster-response-simulator/contracts/config.mjs";

const SIMULATOR_ROOT = new URL(
  "../../disaster-response-simulator/",
  import.meta.url,
);
// Match contracts/config.mjs ENGINE_BUILD. Read disk afresh: importing its
// ENGINE_BUILD again would return Node's cached value after an in-run edit.
const DIRECTORIES = [
  "contracts",
  "engine",
  "generators",
  "content",
  "scenarios",
  "sources",
];
const EXTRA_FILES = [
  "adapters/reference.mjs",
  "evaluation/metrics.mjs",
];

export async function simulatorFingerprint({ root = SIMULATOR_ROOT } = {}) {
  const files = (
    await Promise.all(
      DIRECTORIES.map(async (dir) =>
        (await readdir(new URL(`${dir}/`, root)))
          .filter((name) => name.endsWith(".mjs"))
          .map((name) => `${dir}/${name}`),
      ),
    )
  )
    .flat()
    .concat(
      (await readdir(new URL("viewer/", root), { recursive: true }))
        .filter((name) => /\.(?:m?js|html|css)$/.test(name))
        .map((name) => "viewer/" + name.replaceAll("\\", "/")),
      EXTRA_FILES,
    )
    .sort();
  return digest(
    Object.fromEntries(
      await Promise.all(
        files.map(async (file) => [
          file,
          (await readFile(new URL(file, root), "utf8")).replaceAll(
            "\r\n",
            "\n",
          ),
        ]),
      ),
    ),
  );
}

export async function requireLoadedSimulatorBuild({
  loadedBuild = ENGINE_BUILD,
  ...options
} = {}) {
  const fresh = await simulatorFingerprint(options);
  if (fresh !== loadedBuild)
    throw Object.assign(
      new Error(
        "Loaded simulator differs from current source bytes; restart before launching a study.",
      ),
      { code: "SIMULATOR_BUILD_STALE" },
    );
  return fresh;
}

/** Final integrity gates retain the report even if a source file disappeared.
 * Readers are injectable so tests can change private fixtures, never live code. */
export async function checkFinalBuilds(
  initial,
  { candidate, evaluator, simulator = simulatorFingerprint },
) {
  const keys = ["candidate", "evaluator", "simulator"];
  const results = await Promise.allSettled(
    [candidate, evaluator, simulator].map((read) =>
      Promise.resolve().then(read),
    ),
  );
  const errors = [];
  const changed = {};
  const current = {};
  for (const [i, key] of keys.entries()) {
    const result = results[i];
    current[key] = result.status === "fulfilled" ? result.value : null;
    changed[`${key}Changed`] =
      result.status !== "fulfilled" || initial[key] !== current[key];
    if (changed[`${key}Changed`])
      errors.push({
        phase: "manifest",
        code: `${key.toUpperCase()}_CHANGED_DURING_RUN`,
        ...(result.status === "rejected" ? { unreadable: true } : {}),
      });
  }
  const firstChanged = keys.find((key) => changed[`${key}Changed`]);
  return {
    ...changed,
    finalCandidateFingerprint: current.candidate,
    finalEvaluatorFingerprint: current.evaluator,
    finalEngineBuild: current.simulator,
    invalidStatus: firstChanged ? `invalid_${firstChanged}_changed` : null,
    errors,
  };
}
