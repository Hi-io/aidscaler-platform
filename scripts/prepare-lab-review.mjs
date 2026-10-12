// Populate the existing private local lab with a REAL model investigation.
// Synthetic owner accounts consent to sharing only their own projections.
// Leaves authorization to the operator; never publishes or spends real funds.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { buildFingerprint } from "../evaluation/harness.mjs";

const run = "lab-review-" + Date.now(),
  skipShare = process.argv.includes("--skip-share"),
  candidate = await buildFingerprint(),
  sessions = [],
  shares = [],
  errors = [];
async function signIn(org) {
  const access = JSON.parse(
      await readFile(".local/access-" + org + ".json", "utf8"),
    ),
    base = "http://127.0.0.1:" + (4400 + Number(org.slice(3))),
    email = access.users.find((user) => user.role === "commander").email;
  const response = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password: access.password }),
  });
  const login = await response.json();
  if (!response.ok)
    throw Error(
      "Private lab sign-in failed: " + (login.error ?? response.status),
    );
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const session = {
    org,
    base,
    async request(url, data) {
      const r = await fetch(base + url, {
        method: data ? "POST" : "GET",
        headers: {
          Cookie: cookie,
          ...(data
            ? {
                "Content-Type": "application/json",
                "X-CSRF-Token": login.csrf,
                "Idempotency-Key": randomUUID(),
                Origin: base,
              }
            : {}),
        },
        body: data ? JSON.stringify(data) : undefined,
      });
      const value = await r.json();
      if (!r.ok)
        throw Object.assign(Error(value.message ?? "Lab request failed."), {
          code: value.error ?? String(r.status),
        });
      return value;
    },
  };
  sessions.push(session);
  return session;
}
let activity,
  failure = null;
try {
  for (let i = 0; i < (skipShare ? 1 : 4); i++) {
    const session = await signIn("org" + i);
    if (skipShare) continue;
    for (const kind of ["resource", "vehicle"]) {
      const records = await session.request("/api/records?kind=" + kind);
      for (const record of records.filter((row) => row.owner === session.org)) {
        const targets = i === 0 ? ["org1", "org2", "org3"] : ["org0"];
        for (const to of targets) {
          const result = await session.request("/api/share", {
            kind,
            id: record.id,
            version: record.version,
            to,
          });
          shares.push({
            from: session.org,
            to,
            kind,
            id: record.id,
            queued: result.queued,
          });
        }
      }
    }
  }
  const session = sessions[0],
    limit = Date.now() + 20000;
  while (Date.now() < limit) {
    const offers = await session.request("/api/records?kind=peer_offer");
    if (
      new Set(offers.filter((offer) => offer.active).map((offer) => offer.from))
        .size === 3
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const needs = await session.request("/api/records?kind=need"),
    need = needs.find(
      (row) => row.type === "shelter" && row.quantity > (row.served ?? 0),
    );
  if (!need)
    throw Error(
      "No unmet shelter need exists in the current lab. Use a fresh S19 lab.",
    );
  const queued = await session.request("/api/investigate", { needId: need.id });
  console.log(
    JSON.stringify({
      run,
      shares: shares.length,
      focusedNeed: need.id,
      activityId: queued.id,
      state: "queued",
    }),
  );
  const deadline = Date.now() + 1200000;
  while (Date.now() < deadline) {
    activity = await session.request(
      "/api/records?kind=activity&id=" + encodeURIComponent(queued.id),
    );
    if (!["queued", "reading", "checking"].includes(activity.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (["queued", "reading", "checking"].includes(activity.state))
    throw Error("Lab investigation still pending at the probe deadline.");
} catch (e) {
  failure = { code: e.code ?? e.name, message: e.message.slice(0, 250) };
  errors.push(failure);
} finally {
  for (const session of sessions)
    await session.request("/api/logout", {}).catch(() => {});
}
const report = {
  at: new Date().toISOString(),
  run,
  candidateFingerprint: candidate,
  candidateChanged: candidate !== (await buildFingerprint()),
  actor: "Scripted synthetic commander accounts; no real operator study",
  world: "Existing local S19 laboratory; no observer truth is passed to NEXO",
  purpose:
    "Real evidence/tool activity and an independently reviewed pending decision visible in the operator workspace",
  shares,
  existingOwnerConsentReused: skipShare,
  failure,
  errors,
  activity: activity
    ? {
        id: activity.id,
        state: activity.state,
        model: activity.model,
        proposalId: activity.proposalId,
        steps: (activity.steps ?? []).map((step) => ({
          tool: step.tool,
          state: step.state,
          summary: step.summary,
          at: step.at,
        })),
      }
    : null,
  authorization:
    "Not granted by this script. Operators review the exact version.",
};
await mkdir("reports/lab", { recursive: true });
await writeFile(
  "reports/lab/" + run + ".json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    run,
    state: activity?.state ?? "failed",
    proposalId: activity?.proposalId ?? null,
    failure,
    candidateChanged: report.candidateChanged,
    shares: shares.length,
  }),
);
if (failure || report.candidateChanged || activity?.state !== "ready")
  process.exitCode = 1;
