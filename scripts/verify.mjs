import { spawn, execFileSync } from "node:child_process";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { verificationPassed } from "./verification-gates.mjs";
import {
  buildFingerprint,
  evaluatorFingerprint,
} from "../evaluation/harness.mjs";

const root = process.cwd(),
  id = Date.now();
const folder = path.join(root, "reports", "verifications");
await mkdir(folder, { recursive: true });
await mkdir(path.join(root, ".local", "verification"), { recursive: true });
const testFiles = async (cwd) =>
  (await readdir(path.join(cwd, "tests")))
    .filter((f) => f.endsWith(".test.mjs"))
    .sort()
    .map((f) => path.join("tests", f));
const simulator = path.resolve(root, "..", "disaster-response-simulator");
// A fresh process avoids ESM caching a simulator build loaded before tests.
const simulatorFingerprint = () => execFileSync(process.execPath,
  ["--input-type=module", "-e", "import { ENGINE_BUILD } from './contracts/config.mjs'; process.stdout.write(ENGINE_BUILD)"],
  { cwd: simulator, encoding: "utf8", windowsHide: true });
const cases = [
  { name: "platform-syntax", cwd: root, args: ["scripts/check.mjs"] },
  {
    name: "platform-tests",
    cwd: root,
    args: [
      "--test",
      "--test-reporter=tap",
      "--test-concurrency=1",
      ...(await testFiles(root)),
    ],
  },
  {
    name: "simulator-syntax-contracts",
    cwd: simulator,
    args: ["scripts/check.mjs"],
  },
  {
    name: "simulator-tests",
    cwd: simulator,
    args: ["--test", "--test-reporter=tap", ...(await testFiles(simulator))],
  },
];
const gitRevision = (cwd) =>
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
const report = {
  at: new Date().toISOString(),
  candidateFingerprint: await buildFingerprint(),
  evaluatorFingerprint: await evaluatorFingerprint(),
  simulatorFingerprint: simulatorFingerprint(),
  gitRevisions: {
    platform: gitRevision(root),
    simulator: gitRevision(simulator),
  },
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  hardware: {
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
  },
  cases: [],
  scope:
    "Automated local mechanism verification, no paid model calls and no human or field validation.",
};
for (const item of cases) {
  console.log("Checking " + item.name);
  const started = performance.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, item.args, {
      cwd: item.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (b) => {
      output += b;
    });
    child.stderr.on("data", (b) => {
      output += b;
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) =>
      resolve({ exitCode, signal, output }),
    );
  });
  const count = (name) =>
    Number(
      result.output.match(new RegExp("^# " + name + " (\\d+)$", "m"))?.[1] ?? 0,
    );
  const row = {
    name: item.name,
    exitCode: result.exitCode,
    signal: result.signal,
    wallMs: performance.now() - started,
  };
  if (item.name.endsWith("tests"))
    row.tests = Object.fromEntries(
      ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((name) => [
        name,
        count(name),
      ]),
    );
  else row.summary = result.output.trim().split(/\r?\n/).slice(-3);
  await writeFile(
    path.join(root, ".local", "verification", id + "-" + item.name + ".log"),
    result.output,
  );
  report.cases.push(row);
  console.log(JSON.stringify(row));
}
report.candidateFinalFingerprint = await buildFingerprint();
report.evaluatorFinalFingerprint = await evaluatorFingerprint();
report.simulatorFinalFingerprint = simulatorFingerprint();
report.candidateChanged = report.candidateFingerprint !== report.candidateFinalFingerprint;
report.evaluatorChanged = report.evaluatorFingerprint !== report.evaluatorFinalFingerprint;
report.simulatorChanged = report.simulatorFingerprint !== report.simulatorFinalFingerprint;
report.passed = verificationPassed(report);
await writeFile(
  path.join(folder, id + ".json"),
  JSON.stringify(report, null, 2),
);
await writeFile(
  path.join(root, "reports", "verification-latest.json"),
  JSON.stringify(report, null, 2),
);
if (!report.passed) process.exitCode = 1;
console.log(
  JSON.stringify({
    passed: report.passed,
    report: "reports/verifications/" + id + ".json",
  }),
);
