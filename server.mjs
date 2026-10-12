import http from "node:http";
import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { configuration } from "./src/config.mjs";
import { Store, uid, hash } from "./src/store.mjs";
import { Auth } from "./src/auth.mjs";
import { Domain } from "./src/domain.mjs";
import { SimulatorConnector } from "./src/connector.mjs";
import { OpenRouterProvider } from "./src/provider.mjs";
import { Ingestion } from "./src/ingestion.mjs";
import { Investigator } from "./src/investigation.mjs";
import { Network } from "./src/network.mjs";
import { Finance } from "./src/finance.mjs";
import { Worker } from "./src/worker.mjs";
import { EvidenceStore } from "./src/evidence.mjs";
import { Memory } from "./src/memory.mjs";
import { AppError, check, role } from "./src/errors.mjs";
import { resolveEvidence } from "./src/citations.mjs";
import { Integrations } from "./src/integrations.mjs";
import { handleMcp } from "./src/mcp-server.mjs";
import { MediaProcessor } from "./src/media.mjs";
import { Intake } from "./src/intake.mjs";
import { Workforce } from "./src/workforce.mjs";
import { PublicEvidence } from "./src/public-evidence.mjs";
import { Casework } from "./src/casework.mjs";
import { Organization } from "./src/organization.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
};
async function body(req, limit = 1_000_000) {
  let s = "";
  for await (const chunk of req) {
    s += chunk;
    check(
      Buffer.byteLength(s) <= limit,
      "BODY_LIMIT",
      "Request is too large.",
      413,
    );
  }
  try {
    return JSON.parse(s || "{}");
  } catch {
    throw new AppError("JSON", "Invalid JSON.");
  }
}
const cookie = (req) => req.headers.cookie?.match(/(?:^|; )nexo=([^;]+)/)?.[1];
const KINDS = [
  "signal",
  "claim",
  "need",
  "proposal",
  "operation",
  "resource",
  "vehicle",
  "facility",
  "road",
  "peer_offer",
  "commitment",
  "publication",
  "source",
  "verification",
  "report",
  "pattern",
  "activity",
  "permission",
  "query",
  "integration",
  "external",
  "media",
  "media_analysis",
  "public_evidence",
  "evidence_group",
  "group_history",
  "claim_history",
];
export async function createPlatform(overrides = {}) {
  const config = await configuration(overrides),
    store = overrides.store ?? (await Store.open(config));
  await store.organization(config.org, config.orgName);
  const auth = new Auth(store),
    domain = new Domain(store, config),
    casework = new Casework(store, domain),
    organization = new Organization(store, config),
    workforce = new Workforce(store, domain),
    connector = overrides.connector ?? new SimulatorConnector(config),
    provider = overrides.provider ?? new OpenRouterProvider(store, config),
    ingestion = new Ingestion(store, connector, config),
    network = new Network(store, config, overrides.networkFetcher ?? fetch),
    finance = new Finance(store, config),
    investigator = new Investigator({
      store,
      domain,
      connector,
      provider,
      config,
    }),
    worker = new Worker({
      store,
      domain,
      connector,
      ingestion,
      investigator,
      network,
      config,
    });
  if (
    !(await store.query("SELECT id FROM users WHERE org=$1", [config.org])).rows
      .length
  ) {
    const password =
        config.bootstrapPassword ?? randomBytes(18).toString("base64url"),
      users = [];
    for (const r of [
      "admin",
      "commander",
      "dispatcher",
      "analyst",
      "field",
      "publisher",
      "finance",
      "auditor",
    ])
      users.push(
        await auth.create(null, {
          org: config.org,
          email: `${r}@${config.org}.nexo.local`,
          name:
            {
              commander: "Alex Morgan",
              analyst: "Sam Chen",
              field: "Taylor Field",
              publisher: "Jamie Park",
            }[r] ?? r[0].toUpperCase() + r.slice(1),
          role: r,
          password,
        }),
      );
    if (config.writeAccessFile !== false) {
      await mkdir(path.resolve(".local"), { recursive: true });
      await writeFile(
        path.resolve(".local", `access-${config.org}.json`),
        JSON.stringify(
          {
            users: users.map(({ email, role }) => ({ email, role })),
            password,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
  }
  const evidence = new EvidenceStore(store, config),
    memory = new Memory(store),
    communityLimits = new Map();
  const publicEvidence = new PublicEvidence(
    store,
    evidence,
    config,
    overrides.publicImageDecoder,
  );
  const integrations = new Integrations(store, config);
  const intake = new Intake(store, config);
  ingestion.intake = intake;
  domain.intake = intake;
  worker.intake = intake;
  investigator.integrations = integrations;
  const media = new MediaProcessor({
    store,
    config,
    evidence,
    provider,
    connector,
  });
  worker.media = media;
  media.intake = intake;
  investigator.media = media;
  investigator.ingestKnown = () => ingestion.sync({ sources: false });
  ingestion.afterSync = async () => {
    await network.refresh();
    await integrations.pollDue();
    await intake.kick();
  };
  integrations.afterRead = async (signals) => {
    for (const s of signals) await intake.stage(config.org, s);
    await intake.kick();
  };
  let pollTimer;
  const server = http.createServer(async (req, res) => {
    const began = performance.now();
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
      );
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/mcp") {
        check(
          req.headers.authorization === `Bearer ${config.mcpReadKey}`,
          "MCP_AUTH",
          "Read-only MCP credentials are required.",
          401,
        );
        if (req.method === "DELETE") {
          res.writeHead(204);
          return res.end();
        }
        check(req.method === "POST", "METHOD", "POST required.", 405);
        const result = await handleMcp(store, config.org, await body(req));
        if (result == null) {
          res.writeHead(202);
          return res.end();
        }
        return json(res, 200, result);
      }
      if (url.pathname === "/api/health")
        return json(res, 200, {
          status: "ok",
          storage: store.postgres ? "PostgreSQL" : "embedded PostgreSQL",
          version: "0.1.0",
        });
      if (url.pathname === "/api/network/inbox") {
        check(req.method === "POST", "METHOD", "POST required.", 405);
        return json(
          res,
          200,
          await network.receive(
            req.headers["x-nexo-from"],
            req.headers["x-nexo-signature"],
            await body(req),
          ),
        );
      }
      if (url.pathname === "/api/finance/webhook") {
        check(req.method === "POST", "METHOD", "POST required.", 405);
        return json(
          res,
          200,
          await finance.webhook(
            await body(req),
            req.headers["x-payment-signature"],
          ),
        );
      }
      if (req.method !== "GET" && req.headers.origin)
        check(
          req.headers.origin === `http://127.0.0.1:${server.address().port}` ||
            req.headers.origin === `http://localhost:${server.address().port}`,
          "ORIGIN",
          "Cross-origin mutation denied.",
          403,
        );
      if (url.pathname === "/api/public") {
        check(req.method === "GET", "METHOD", "GET required.", 405);
        const publications = (
          await store.list(config.org, "publication", 100)
        ).filter((p) => ["published", "retracted"].includes(p.state));
        const approved = [];
        for (const p of publications) {
          const proofs = [];
          if (p.state === "published")
            for (const id of p.proofIds ?? []) {
              const proof = await store.get(
                config.org,
                "public_evidence",
                id,
                false,
              );
              if (proof?.state === "approved")
                proofs.push({
                  id,
                  caption: proof.caption,
                  approvedAt: proof.approvedAt,
                  url: "/api/public/media?id=" + encodeURIComponent(id),
                });
            }
          approved.push({
            id: p.id,
            title: p.state === "retracted" ? "Update withdrawn" : p.title,
            text: p.state === "retracted" ? p.retractionNotice : p.text,
            area: p.area,
            status: p.state === "retracted" ? "retracted" : p.status,
            publishedAt: p.retractedAt ?? p.publishedAt,
            corrected: !!p.corrects,
            proofs,
          });
        }
        return json(res, 200, {
          organization: { id: config.org, name: config.orgName },
          updates: approved,
          finance: await finance.summary(config.org),
          sandbox: true,
          privacy: "Approved, aggregate updates only.",
        });
      }
      if (url.pathname === "/api/public/media") {
        check(req.method === "GET", "METHOD", "GET required.", 405);
        const image = await publicEvidence.publiclyVisible(
          config.org,
          url.searchParams.get("id"),
        );
        check(
          image,
          "PUBLIC_MEDIA",
          "This evidence is not publicly available.",
          404,
        );
        res.writeHead(200, {
          "Content-Type": image.mime,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(image.bytes);
      }
      if (url.pathname === "/api/contribute") {
        check(req.method === "POST", "METHOD", "POST required.", 405);
        return json(
          res,
          201,
          await finance.checkout(config.org, await body(req)),
        );
      }
      if (url.pathname === "/api/community/report") {
        check(req.method === "POST", "METHOD", "POST required.", 405);
        const k =
            req.socket.remoteAddress + "-" + Math.floor(Date.now() / 3600000),
          n = (communityLimits.get(k) ?? 0) + 1;
        check(
          n <= 20,
          "COMMUNITY_RATE",
          "This device has reached the reporting limit for this hour.",
          429,
        );
        communityLimits.set(k, n);
        const input = await body(req, 3_000_000);
        check(
          Number.isSafeInteger(input.observedAt) && input.observedAt >= 0,
          "REPORT_TIME",
          "A stable observation timestamp is required so retries preserve the same report.",
        );
        // Public media is stored, never analyzed or made operational before
        // moderation. One bounded attachment avoids unlimited anonymous costs.
        let mediaRef;
        if (input.attachment) {
          const file = input.attachment;
          check(
            ["image/png", "image/jpeg", "audio/wav", "audio/mpeg"].includes(
              file.mime,
            ),
            "COMMUNITY_MEDIA",
            "Use a photo or audio recording.",
          );
          check(
            Buffer.from(file.contentBase64 ?? "", "base64").length <= 2_000_000,
            "COMMUNITY_MEDIA_SIZE",
            "Community attachments are limited to 2 MB.",
            413,
          );
          check(
            typeof input.clientId === "string" &&
              input.clientId.length >= 3 &&
              input.clientId.length <= 180,
            "REPORT_ID",
            "A stable report identifier is required.",
          );
          mediaRef = await evidence.save(
            { org: config.org, id: "community-public", role: "field" },
            {
              ...file,
              title: "Community attachment",
              source: "Community report awaiting moderation",
              observedAt: input.observedAt,
            },
            "community_media_" + hash(input.clientId),
          );
        }
        const r = await domain.report(
          { org: config.org, id: "community-public", role: "field" },
          {
            clientId: input.clientId,
            text:
              input.text?.trim() ||
              (mediaRef
                ? "Community source media; interpretation and location require review."
                : ""),
            kind: mediaRef?.mime.startsWith("audio/") ? "voice" : "need",
            location: input.location,
            observedAt: input.observedAt,
            references: mediaRef ? [mediaRef.id] : [],
          },
          "community_" + input.clientId,
        );
        return json(res, 201, {
          id: r.id,
          state: "received_for_review",
          notice:
            "Recorded for review by the organization. This is not a dispatch confirmation.",
        });
      }
      if (url.pathname === "/api/login") {
        check(req.method === "POST", "METHOD", "POST required.", 405);
        const b = await body(req),
          session = await auth.login(
            b.email,
            b.password,
            req.socket.remoteAddress,
          );
        check(
          session.user.org === config.org,
          "FORBIDDEN",
          "Account is not part of this instance.",
          403,
        );
        res.setHeader(
          "Set-Cookie",
          `nexo=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        return json(res, 200, { user: session.user, csrf: session.csrf });
      }
      if (url.pathname.startsWith("/api/")) {
        const actor = await auth.session(cookie(req));
        check(
          actor?.org === config.org,
          "AUTHENTICATION",
          "Sign in to your response workspace.",
          401,
        );
        if (req.method !== "GET")
          check(
            req.headers["x-csrf-token"] === actor.csrf,
            "CSRF",
            "Refresh your session before making this change.",
            403,
          );
        if (url.pathname === "/api/me")
          return json(res, 200, {
            user: actor,
            delegatedReviews: (await workforce.grants(actor))
              .filter(
                (g) =>
                  g.to === actor.id &&
                  g.state === "active" &&
                  g.expiresAt > Date.now(),
              )
              .map((g) => g.proposal),
            model: config.modelId,
            intake: await intake.summary(),
            organization: { id: config.org, name: config.orgName },
            provider: config.provider,
          });
        if (url.pathname === "/api/logout") {
          await auth.logout(cookie(req));
          res.setHeader(
            "Set-Cookie",
            "nexo=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          );
          return json(res, 200, { signedOut: true });
        }
        if (actor.role === "field") {
          const permitted = [
            "/api/tasks",
            "/api/task/update",
            "/api/handovers",
            "/api/handover/acknowledge",
            "/api/report",
            "/api/media",
            "/api/media/upload",
            "/api/media/analyze",
            "/api/records",
          ];
          check(
            permitted.includes(url.pathname),
            "FIELD_SCOPE",
            "Field access is limited to assigned tasks, reports and source media.",
            403,
          );
          if (url.pathname === "/api/records")
            check(
              ["report", "media", "media_analysis"].includes(
                url.searchParams.get("kind"),
              ),
              "FIELD_SCOPE",
              "This operational record is outside field access.",
              403,
            );
        }
        if (url.pathname === "/api/people" && req.method === "GET")
          return json(res, 200, await workforce.people(actor));
        if (url.pathname === "/api/tasks" && req.method === "GET")
          return json(res, 200, await workforce.tasks(actor));
        if (url.pathname === "/api/delegations" && req.method === "GET")
          return json(res, 200, await workforce.grants(actor));
        if (url.pathname === "/api/handovers" && req.method === "GET")
          return json(res, 200, await workforce.handovers(actor));
        if (url.pathname === "/api/dashboard") {
          const kinds = [
            "need",
            "proposal",
            "operation",
            "resource",
            "peer_offer",
            "source",
            "activity",
          ];
          const rows = Object.fromEntries(
            await Promise.all(
              kinds.map(async (k) => [k, await store.list(actor.org, k, 100)]),
            ),
          );
          return json(res, 200, {
            ...rows,
            decisionCount: (await store.decisionPage(actor.org, { limit: 4 }))
              .total,
            activeNeedCount: Number(
              (
                await store.query(
                  "SELECT COUNT(*) AS n FROM entities WHERE org=$1 AND kind='need' AND (data->>'quantity')::numeric > COALESCE((data->>'served')::numeric,0)",
                  [actor.org],
                )
              ).rows[0].n,
            ),
            activeOperationCount: Number(
              (
                await store.query(
                  "SELECT COUNT(*) AS n FROM entities WHERE org=$1 AND kind='operation' AND COALESCE(data->>'state','unknown') NOT IN ('received','service','operating','completed','failed','cancelled')",
                  [actor.org],
                )
              ).rows[0].n,
            ),
            signalCount: Number(
              (
                await store.query(
                  "SELECT COUNT(*) AS n FROM entities WHERE org=$1 AND kind='signal'",
                  [actor.org],
                )
              ).rows[0].n,
            ),
            model: config.modelId,
            organization: config.orgName,
            previewLimit: 100,
            simulatedAt:
              (await store.get(actor.org, "source", "simulator", false))
                ?.simulatedAt ?? null,
          });
        }
        if (url.pathname === "/api/automation" && req.method === "GET")
          return json(res, 200, await intake.summary());
        if (url.pathname === "/api/organization" && req.method === "GET")
          return json(res, 200, await organization.read(actor.org));
        if (url.pathname === "/api/export" && req.method === "GET")
          return json(
            res,
            200,
            await organization.export(actor, {
              kind: url.searchParams.get("kind"),
              offset: Number(url.searchParams.get("offset") ?? 0),
            }),
          );
        if (url.pathname === "/api/decision-queue" && req.method === "GET")
          return json(
            res,
            200,
            await store.decisionPage(actor.org, {
              offset: Number(url.searchParams.get("offset") ?? 0),
              limit: 12,
              history: url.searchParams.get("history") === "true",
            }),
          );
        if (url.pathname === "/api/finance/ledger" && req.method === "GET") {
          role(actor, ["finance", "commander", "auditor"]);
          return json(
            res,
            200,
            (
              await store.query(
                "SELECT id,type,amount_cents,currency,reference,created_at FROM finance WHERE org=$1 ORDER BY created_at DESC LIMIT 200",
                [actor.org],
              )
            ).rows,
          );
        }
        if (url.pathname === "/api/context")
          return json(
            res,
            200,
            (await store.get(actor.org, "context", "operational", false))
              ?.snapshot ?? null,
          );
        if (url.pathname === "/api/evidence" && req.method === "GET") {
          const found = await resolveEvidence(
            store,
            actor.org,
            url.searchParams.get("id"),
          );
          check(found, "NOT_FOUND", "Evidence is not accessible.", 404);
          return json(res, 200, found);
        }
        if (url.pathname === "/api/map")
          return json(res, 200, {
            geography:
              (await store.get(actor.org, "context", "geography", false))
                ?.map ?? null,
            needs: await store.list(actor.org, "need", 1000),
            vehicles: await store.list(actor.org, "vehicle", 1000),
            roads: await store.list(actor.org, "road", 5000),
            facilities: await store.list(actor.org, "facility", 1000),
          });
        if (url.pathname === "/api/media" && req.method === "GET") {
          const { metadata, bytes } = await evidence.read(
            actor.org,
            url.searchParams.get("id"),
          );
          res.writeHead(200, {
            "Content-Type": metadata.mime,
            "Cache-Control": "no-store",
            "Content-Disposition": "inline",
          });
          return res.end(bytes);
        }
        if (url.pathname === "/api/records" && req.method === "GET") {
          const kind = url.searchParams.get("kind");
          check(KINDS.includes(kind), "KIND", "Unknown record type.");
          const id = url.searchParams.get("id");
          return json(
            res,
            200,
            id
              ? await store.get(actor.org, kind, id)
              : await store.list(
                  actor.org,
                  kind,
                  Math.min(2000, Number(url.searchParams.get("limit") ?? 250)),
                ),
          );
        }
        if (url.pathname === "/api/audit") {
          role(actor, ["auditor", "admin", "commander"]);
          return json(
            res,
            200,
            (
              await store.query(
                "SELECT sequence,actor,action,entity,detail,occurred_at,previous_hash,hash FROM audit WHERE org=$1 ORDER BY sequence DESC LIMIT 300",
                [actor.org],
              )
            ).rows,
          );
        }
        if (url.pathname === "/api/jobs")
          return json(
            res,
            200,
            (
              await store.query(
                "SELECT id,kind,state,attempts,last_error,created_at,result FROM jobs WHERE org=$1 ORDER BY created_at DESC LIMIT 100",
                [actor.org],
              )
            ).rows,
          );
        if (url.pathname === "/api/usage")
          return json(
            res,
            200,
            (
              await store.query(
                "SELECT id,episode,model,state,started_at,wall_ms,input_tokens,output_tokens,cost_usd,provider_id,error FROM usage WHERE org=$1 ORDER BY started_at DESC LIMIT 200",
                [actor.org],
              )
            ).rows,
          );
        if (url.pathname === "/api/users") {
          role(actor, ["admin"]);
          if (req.method === "GET")
            return json(
              res,
              200,
              (
                await store.query(
                  "SELECT id,email,name,role,active FROM users WHERE org=$1",
                  [actor.org],
                )
              ).rows,
            );
          const b = await body(req);
          if (b.revoke)
            return json(res, 200, {
              revoked: await auth.revoke(actor, b.revoke),
            });
          return json(
            res,
            201,
            await auth.create(actor, { ...b, org: actor.org }),
          );
        }
        check(req.method === "POST", "METHOD", "POST required.", 405);
        const b = await body(
            req,
            url.pathname === "/api/media/upload" ? 14_000_000 : 1_000_000,
          ),
          key = req.headers["idempotency-key"] ?? b.idempotencyKey;
        if (url.pathname === "/api/sync") {
          role(actor, ["admin", "analyst", "commander", "dispatcher"]);
          await store.enqueue(
            actor.org,
            "ingest",
            {},
            "ingest_" + Math.floor(Date.now() / 1000),
          );
          return json(res, 202, { queued: true });
        }
        if (url.pathname === "/api/automation")
          return json(res, 200, await intake.configure(actor, b, key));
        if (url.pathname === "/api/organization")
          return json(res, 200, await organization.configure(actor, b, key));
        if (url.pathname === "/api/task/assign")
          return json(res, 201, await workforce.assign(actor, b, key));
        if (url.pathname === "/api/task/update")
          return json(res, 200, await workforce.update(actor, b, key));
        if (url.pathname === "/api/handover")
          return json(res, 201, await workforce.handover(actor, b, key));
        if (url.pathname === "/api/handover/acknowledge")
          return json(
            res,
            200,
            await workforce.acknowledgeHandover(actor, b, key),
          );
        if (url.pathname === "/api/delegation")
          return json(res, 201, await workforce.delegate(actor, b, key));
        if (url.pathname === "/api/delegation/revoke")
          return json(res, 200, await workforce.revoke(actor, b, key));
        if (url.pathname === "/api/investigation/stop") {
          role(actor, ["analyst", "commander", "dispatcher"]);
          const activity = await store.get(actor.org, "activity", b.id);
          check(
            ["queued", "reading", "checking"].includes(activity.state),
            "ACTIVITY_STATE",
            "This investigation has already ended.",
            409,
          );
          await store.upsert(actor.org, "activity", b.id, {
            cancelRequested: true,
            stoppedBy: actor.id,
          });
          await store.audit(
            actor.org,
            actor.id,
            "investigation.stop_requested",
            b.id,
            {},
          );
          return json(res, 202, {
            stopRequested: true,
            notice:
              "The current provider call may finish and incur cost. No further tools will be requested.",
          });
        }
        if (url.pathname === "/api/investigate") {
          role(actor, ["analyst", "commander", "dispatcher"]);
          const id = uid("investigation");
          await store.put(
            actor.org,
            "activity",
            id,
            {
              state: "queued",
              model: config.modelId,
              steps: [],
              startedAt: Date.now(),
              proposalId: null,
            },
            0,
          );
          await store.enqueue(
            actor.org,
            "investigate",
            {
              ids: b.ids ?? [],
              repairOf: b.repairOf ?? null,
              needId: b.needId ?? null,
              facilityId: b.facilityId ?? null,
            },
            id,
          );
          return json(res, 202, { queued: true, id });
        }
        if (url.pathname === "/api/propose") {
          const { repairOf, ...draft } = b;
          return json(
            res,
            201,
            await domain.propose(actor, draft, key, { repairOf }),
          );
        }
        if (url.pathname === "/api/review") {
          const result = await domain.review(actor, b.id, b, key);
          if (b.decision === "reject" && result.originPartner)
            await network.response(result, "rejected", {
              rejectedBy: actor.id,
              reason: b.note,
            });
          return json(res, 200, result);
        }
        if (url.pathname === "/api/proposal/revise")
          return json(
            res,
            200,
            await domain.revise(
              actor,
              b.id,
              Object.fromEntries(Object.entries(b).filter(([k]) => k !== "id")),
              key,
            ),
          );
        if (url.pathname === "/api/condition")
          return json(res, 200, await domain.satisfy(actor, b.id, b, key));
        if (url.pathname === "/api/resource")
          return json(res, 200, await domain.resource(actor, b, key));
        if (url.pathname === "/api/reserve")
          return json(res, 200, await domain.reserve(actor, b, key));
        if (url.pathname === "/api/commitment")
          return json(res, 200, await domain.commitment(actor, b.id, b, key));
        if (url.pathname === "/api/report")
          return json(res, 201, await domain.report(actor, b, key));
        if (url.pathname === "/api/report/moderate") {
          role(actor, ["analyst", "commander", "dispatcher"]);
          const r = await store.get(actor.org, "report", b.id);
          check(
            ["accept", "reject"].includes(b.decision),
            "DECISION",
            "Choose accept or reject.",
          );
          check(
            typeof b.reason === "string" &&
              b.reason.trim().length >= 3 &&
              b.reason.length <= 600,
            "MODERATION_REASON",
            "Record the reason and any verification still needed.",
          );
          const result = await store.command(actor.org, key, b, async (tx) => {
            const updated = await tx.put(
              actor.org,
              "report",
              r.id,
              {
                ...r,
                state: b.decision === "accept" ? "observed" : "rejected",
                moderatedBy: actor.id,
                moderationReason: b.reason,
                moderatedAt: Date.now(),
              },
              b.version,
            );
            await domain.stageReport(tx, actor.org, updated);
            await tx.audit(
              actor.org,
              actor.id,
              "community." + b.decision,
              r.id,
              { reason: b.reason },
            );
            return updated;
          });
          return json(res, 200, result);
        }
        if (url.pathname === "/api/integration/configure")
          return json(res, 201, await integrations.configure(actor, b, key));
        if (url.pathname === "/api/integration/read") {
          role(actor, ["admin", "analyst", "commander", "dispatcher"]);
          return json(res, 200, await integrations.read(actor.org, b.id, b));
        }
        if (url.pathname === "/api/media/analyze") {
          role(actor, ["field", "analyst", "commander", "dispatcher"]);
          const result = await store.command(
            actor.org,
            key,
            { id: b.id },
            async (tx) => {
              const original = await tx.get(actor.org, "media", b.id);
              if (original.moderationRequired) {
                const reviewed = (
                  await tx.query(
                    "SELECT id FROM entities WHERE org=$1 AND kind='report' AND data->>'state'='observed' AND data->'references' @> $2::jsonb LIMIT 1",
                    [actor.org, JSON.stringify([b.id])],
                  )
                ).rows[0];
                check(
                  reviewed,
                  "MEDIA_MODERATION",
                  "Review the community report before spending analysis budget on its attachment.",
                  409,
                );
              }
              const prior = await tx.get(
                actor.org,
                "media_analysis",
                b.id,
                false,
              );
              if (prior) return { completed: true, id: b.id };
              const pending = (
                await tx.query(
                  "SELECT id FROM jobs WHERE org=$1 AND kind='analyze_media' AND payload->>'id'=$2 AND state IN ('queued','running','retry')",
                  [actor.org, b.id],
                )
              ).rows[0];
              if (pending) return { queued: true, id: pending.id };
              const id = uid("mediajob");
              await tx.upsert(actor.org, "media", b.id, {
                state: "queued",
                error: null,
              });
              await tx.enqueue(actor.org, "analyze_media", { id: b.id }, id);
              await tx.audit(
                actor.org,
                actor.id,
                "media.analysis_requested",
                b.id,
                { job: id },
              );
              return { queued: true, id };
            },
          );
          return json(res, 202, result);
        }
        if (url.pathname === "/api/media/upload")
          return json(res, 201, await evidence.save(actor, b, key));
        if (url.pathname === "/api/memory")
          return json(res, 201, await memory.record(actor, b, key));
        if (url.pathname === "/api/claim")
          return json(res, 201, await domain.createClaim(actor, b, key));
        if (url.pathname === "/api/claim/correct")
          return json(res, 200, await casework.correctClaim(actor, b, key));
        if (url.pathname === "/api/evidence/group")
          return json(res, 201, await casework.group(actor, b, key));
        if (url.pathname === "/api/evidence/split")
          return json(res, 200, await casework.split(actor, b, key));
        if (url.pathname === "/api/evidence/group/restore")
          return json(res, 200, await casework.restoreGrouping(actor, b, key));
        if (url.pathname === "/api/invalidate")
          return json(
            res,
            200,
            await domain.invalidate(actor, b.dependency, b.reason, key),
          );
        if (url.pathname === "/api/share")
          return json(res, 202, await network.share(actor, b, key));
        if (url.pathname === "/api/publication/draft")
          return json(res, 201, await domain.draftPublication(actor, b, key));
        if (url.pathname === "/api/publication/publish")
          return json(res, 200, await domain.publish(actor, b.id, b, key));
        if (url.pathname === "/api/publication/retract")
          return json(res, 200, await domain.retractPublication(actor, b, key));
        if (url.pathname === "/api/publication/proof")
          return json(res, 201, await publicEvidence.approve(actor, b, key));
        if (url.pathname === "/api/finance/release")
          return json(res, 200, await finance.release(actor, b, key));
        if (url.pathname === "/api/finance/allocate")
          return json(res, 200, await finance.allocate(actor, b, key));
        if (url.pathname === "/api/verify") {
          role(actor, ["analyst", "commander", "dispatcher"]);
          check(
            ["need", "building", "resource", "road"].includes(b.target),
            "TARGET",
            "Invalid verification target.",
          );
          const result = await connector.action(
            "verify",
            { target: b.target, id: b.id },
            key ?? uid("verify"),
          );
          await store.transaction((tx) =>
            tx.audit(actor.org, actor.id, "verification.requested", result.id, {
              target: b.target,
              id: b.id,
            }),
          );
          return json(res, 202, result);
        }
        if (url.pathname === "/api/query") {
          role(actor, ["analyst", "commander", "dispatcher"]);
          const result = await connector.action(
            "query",
            { target: b.target, id: b.id, org: b.org },
            key ?? uid("query"),
          );
          return json(res, 202, result);
        }
        throw new AppError("NOT_FOUND", "Endpoint not found.", 404);
      }
      const filename =
        url.pathname === "/" ||
        url.pathname === "/public" ||
        url.pathname === "/field" ||
        url.pathname === "/community"
          ? "index.html"
          : url.pathname.slice(1);
      check(
        !filename.includes("..") && !filename.includes("\\"),
        "PATH",
        "Invalid path.",
        403,
      );
      let data;
      try {
        data = await readFile(path.join(root, "ui", filename));
      } catch {
        throw new AppError("NOT_FOUND", "File not found.", 404);
      }
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
      };
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      res.writeHead(200, {
        "Content-Type":
          mime[path.extname(filename)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    } catch (e) {
      const status =
        e instanceof AppError ? e.status : e.name === "ZodError" ? 400 : 500;
      json(res, status, {
        error:
          e.code ?? (e.name === "ZodError" ? "VALIDATION" : "SERVER_ERROR"),
        message:
          status === 500
            ? "The request could not be completed. Your saved work is retained."
            : e.message,
      });
    } finally {
      server.lastRequestMs = performance.now() - began;
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  if (config.startWorker !== false) worker.start();
  if (config.autoIngest && config.sourceAgentKey)
    pollTimer = setInterval(async () => {
      try {
        const pending = (
          await store.query(
            "SELECT id FROM jobs WHERE org=$1 AND kind='ingest' AND state IN ('queued','running','retry') LIMIT 1",
            [config.org],
          )
        ).rows.length;
        if (!pending) await store.enqueue(config.org, "ingest", {});
      } catch {}
    }, config.pollMs);
  return {
    server,
    store,
    auth,
    domain,
    workforce,
    connector,
    ingestion,
    provider,
    investigator,
    worker,
    network,
    finance,
    evidence,
    media,
    integrations,
    intake,
    memory,
    config,
    url: `http://${config.host}:${server.address().port}`,
    async close() {
      clearInterval(pollTimer);
      await worker.stop();
      await new Promise((r) => server.close(r));
      if (!overrides.store) await store.close();
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createPlatform();
  console.log(
    `NEXO: ${app.url}\nPublic portal: ${app.url}/public\nRole credentials: ignored .local/access-${app.config.org}.json\nModel: ${app.config.modelId} (${app.config.provider})`,
  );
  for (const s of ["SIGINT", "SIGTERM"])
    process.on(s, async () => {
      await app.close();
      process.exit(0);
    });
}
