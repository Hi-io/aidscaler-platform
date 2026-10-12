import { spawnSync } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import path from "node:path";
const directory = path.resolve(".local/asr-venv");
const python = path.join(
  directory,
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
await mkdir(".local", { recursive: true });
const run = (command, args) => {
  const p = spawnSync(command, args, { stdio: "inherit", windowsHide: true });
  if (p.status !== 0) throw new Error("Local media setup did not complete.");
};
try {
  await access(python);
} catch {
  run(
    process.env.NEXO_PYTHON ??
      (process.platform === "win32" ? "python" : "python3"),
    ["-m", "venv", directory],
  );
}
run(python, ["-m", "pip", "install", "-r", "requirements-media.txt"]);
console.log(
  "Local ASR, document and sampled-frame decoder installed. The first audio call downloads model weights.",
);
