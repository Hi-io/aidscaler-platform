import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const staged = process.argv.includes("--staged"),
  files = execFileSync("git", ["ls-files", ...(staged ? ["--cached"] : [])], {
    encoding: "utf8",
    windowsHide: true,
  })
    .trim()
    .split("\n")
    .filter(Boolean);
const privateFile =
  /(^|\/)(?:\.local|\.codex|\.agents|node_modules)(?:\/|$)|(?:^|\/)agents(?:\..*)?\.md$|(?:^|\/)\.env(?:\..*)?$/i;
const secret =
  /sk-or-v1-[a-z0-9]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i;
let bad = 0;
for (const file of files) {
  if (file !== ".env.example" && privateFile.test(file)) {
    console.error("Private artifact would be tracked:", file);
    bad++;
  }
  try {
    const content = readFileSync(file, "utf8");
    if (secret.test(content)) {
      console.error("Credential pattern detected in tracked file:", file);
      bad++;
    }
  } catch {}
}
if (bad) process.exit(1);
console.log(
  `Repository hygiene passed for ${files.length} tracked files; no credentials or Codex artifacts detected.`,
);
