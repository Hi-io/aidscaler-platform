import { readFile, writeFile } from "node:fs/promises";
const names = [
  "layout-dashboard",
  "radio",
  "sparkles",
  "clipboard-check",
  "truck",
  "package",
  "network",
  "globe",
  "wallet",
  "map-pin",
  "settings",
  "shield-check",
  "external-link",
  "arrow-right",
  "arrow-up-right",
  "refresh-cw",
  "circle-alert",
  "inbox",
  "check",
  "clock",
  "video",
  "audio-lines",
  "image",
  "x",
  "send",
  "building-2",
  "lock-keyhole",
  "heart-handshake",
  "package-check",
  'upload','volume-2','play','file-text','plug','message-circle','message-square',
];
const icons = {};
for (const n of names) {
  const source = await readFile(
    `node_modules/lucide-static/icons/${n}.svg`,
    "utf8",
  );
  icons[n] = source
    .slice(
      source.indexOf(">", source.indexOf("<svg")) + 1,
      source.lastIndexOf("</svg>"),
    )
    .trim();
}
await writeFile(
  "ui/icons.mjs",
  "// Lucide icons · ISC license. See LICENSE-LUCIDE.txt.\nexport const icons = " +
    JSON.stringify(icons, null, 2) +
    ";\n",
);
try {
  await writeFile(
    "ui/LICENSE-LUCIDE.txt",
    await readFile("node_modules/lucide-static/LICENSE"),
  );
} catch {
  await writeFile(
    "ui/LICENSE-LUCIDE.txt",
    "Lucide · ISC License\nCopyright (c) Lucide Contributors\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED AS IS WITHOUT WARRANTY OF ANY KIND.",
  );
}
