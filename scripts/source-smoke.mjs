import { Store } from "../src/store.mjs";
import { Integrations } from "../src/integrations.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const store = await Store.open();
try {
  await store.organization("org0", "Integration verification");
  const integrations = new Integrations(store, {}),
    url = "https://goadmin.ifrc.org/api/v2/event/?limit=2";
  await integrations.configure(
    { org: "org0", id: "local-admin", role: "admin" },
    {
      id: "ifrc-go",
      name: "IFRC GO disaster events",
      type: "http_json",
      url,
      allowedOrigin: "https://goadmin.ifrc.org",
      purpose:
        "Read contextual disaster reports. These are not automatically actionable operational needs.",
      license:
        "Verify source attribution and applicable event material terms; https://go-wiki.ifrc.org/en/go-api/api-overview",
    },
    "configure-ifrc",
  );
  const result = await integrations.read("org0", "ifrc-go");
  const report = {
    at: new Date().toISOString(),
    source: url,
    documentation: "https://go-wiki.ifrc.org/en/go-api/api-overview",
    httpRead: true,
    records: result.data.results.length,
    contentHash: result.contentHash,
    sourceTypes: result.data.results.map((e) => e.dtype?.name),
    notes: [
      "Public read integration only. No institutional partnership, current stock access or field validation is implied.",
      "Real source data is kept out of simulation KPI experiments.",
    ],
  };
  await mkdir("reports", { recursive: true });
  await writeFile("reports/real-source.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await store.close();
}
