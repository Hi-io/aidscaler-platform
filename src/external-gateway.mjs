/** A contractor bridge, not a AidScaler instance: no LLM, intake or shared workspace.
 * Its owner approves a typed request against its own scoped system of record.
 * Requests, decisions, retries and physical receipts survive process restart.
 */
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Store, hash, uid } from "./store.mjs";
import { Auth } from "./auth.mjs";
import { sign } from "./network.mjs";
import { check, role, AppError } from "./errors.mjs";
import { actionSchema } from "./contracts.mjs";
import { validatePlan } from "./planning.mjs";
const terminal = new Set(["received", "completed", "service"]);
const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
};
async function input(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    check(
      Buffer.byteLength(text) <= 1000000,
      "BODY_LIMIT",
      "Request too large.",
      413,
    );
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new AppError("JSON", "Invalid JSON.");
  }
}
export async function createExternalGateway({
  org,
  connector,
  peers = [],
  port = 0,
  store: providedStore,
  dataDir,
  bootstrapPassword,
  startWorker = false,
} = {}) {
  check(
    org && connector,
    "CONFIG",
    "A scoped organization and operational connector are required.",
  );
  const store = providedStore ?? (await Store.open({ dataDir })),
    config = { org, peers },
    auth = new Auth(store);
  await store.organization(org, "External response contractor");
  if (
    !(await store.query("SELECT id FROM users WHERE org=$1", [org])).rows.length
  )
    await auth.create(null, {
      org,
      email: `owner@${org}.partner.local`,
      name: "External operations owner",
      role: "commander",
      password: bootstrapPassword ?? randomBytes(24).toString("base64url"),
    });
  let timer,
    stopping = false,
    loopPromise;
  async function observe() {
    const s = await connector.state();
    check(
      s.organization.id === org,
      "SOURCE_ORG",
      "The source credential belongs to another contractor.",
      403,
    );
    for (const [kind, items] of [
      ["resource", s.known.resources],
      ["vehicle", s.known.vehicles],
      ["need", s.known.needs],
      ["facility", s.known.buildings],
      ["road", s.known.edges],
    ])
      for (const [id, r] of Object.entries(items ?? {}))
        if (
          hash(
            (await store.get(org, kind, r.id ?? id, false))?.sourceSnapshot ??
              {},
          ) !== hash(r)
        )
          await store.upsert(org, kind, r.id ?? id, {
            ...r,
            id: r.id ?? id,
            owner: r.owner ?? org,
            reserved: r.reserved ?? 0,
            floor: r.floor ?? 0,
            sourceSnapshot: r,
          });
    if (s.known.map)
      await store.upsert(org, "context", "geography", { map: s.known.map });
    // The map is a read returned by the actor gateway, never observer truth.
    const maps = s.queries?.filter(
      (q) => q.target === "map" && q.state === "ready",
    );
    const map = maps?.at(-1)?.result?.map ?? maps?.at(-1)?.result;
    if (map?.roads) await store.upsert(org, "context", "geography", { map });
    return s;
  }
  async function queueReceipt(work, state, operation = {}) {
    const m = {
      id: `external_receipt_${hash([work.id, state, operation]).slice(0, 32)}`,
      from: org,
      to: work.from,
      kind: "response_receipt",
      entityId: work.entityId,
      version: work.version,
      permissionVersion: 1,
      at: Date.now(),
      expiresAt: Date.now() + 86400000,
      revoke: false,
      projection: {
        originProposal: work.originProposal,
        originStep: work.originStep,
        state,
        operation,
        owner: org,
      },
    };
    await store.enqueue(
      org,
      "external_send",
      { to: work.from, message: m },
      "send_" + m.id,
    );
  }
  async function receive(from, signature, envelope) {
    const peer = peers.find((p) => p.org === from);
    check(
      peer && typeof signature === "string",
      "PEER_AUTH",
      "Partner authentication failed.",
      401,
    );
    const expected = Buffer.from(sign(peer.key, envelope)),
      actual = Buffer.from(signature);
    check(
      actual.length === expected.length && timingSafeEqual(actual, expected),
      "PEER_AUTH",
      "Partner authentication failed.",
      401,
    );
    const m = envelope.message;
    check(
      m &&
        m.from === from &&
        m.to === org &&
        typeof m.id === "string" &&
        m.id.length <= 240 &&
        Number.isSafeInteger(m.version) &&
        Number.isSafeInteger(m.permissionVersion) &&
        Math.abs(Date.now() - envelope.sentAt) < 60000 &&
        m.expiresAt > Date.now(),
      "PEER_WINDOW",
      "Invalid, expired or misaddressed request.",
      403,
    );
    check(
      m.kind === "response_request",
      "PARTNER_SCOPE",
      "This contractor bridge only accepts typed work requests.",
    );
    const a = m.revoke ? null : actionSchema.parse(m.projection?.action);
    check(
      !a || (a.type === "dispatch" && a.owner === org),
      "PARTNER_SCOPE",
      "The contractor only handles its own delivery requests.",
      403,
    );
    return store.transaction(async (tx) => {
      if (
        (
          await tx.query(
            "SELECT message_id FROM inbox WHERE org=$1 AND message_id=$2",
            [org, m.id],
          )
        ).rows.length
      )
        return { duplicate: true };
      await tx.query(
        "INSERT INTO inbox(org,message_id,sender,received_at) VALUES($1,$2,$3,$4)",
        [org, m.id, from, Date.now()],
      );
      const id = from + "_" + m.entityId,
        old = await tx.get(org, "external_work", id, false);
      if (
        old &&
        (m.permissionVersion < old.permissionVersion ||
          (m.permissionVersion === old.permissionVersion &&
            m.version <= old.sourceVersion))
      )
        return { stale: true };
      check(
        !old?.issued || m.revoke,
        "PHYSICAL_SCOPE",
        "Issued work cannot be replaced by a new request.",
        409,
      );
      const record = {
        ...old,
        from,
        entityId: m.entityId,
        sourceVersion: m.version,
        permissionVersion: m.permissionVersion,
        expiresAt: m.expiresAt,
        state: m.revoke ? "requires_review" : "awaiting_review",
        authorization: null,
        changedReason: m.revoke
          ? "Origin withdrew the request; already issued physical work remains visible."
          : null,
        ...(!m.revoke
          ? {
              action: a,
              title: String(m.projection.title).slice(0, 150),
              originProposal: m.projection.originProposal,
              originStep: m.projection.originStep,
              targetNeed: m.projection.targetNeed ?? null,
            }
          : {}),
        receivedAt: Date.now(),
      };
      await tx.upsert(org, "external_work", id, record);
      await tx.audit(org, "peer:" + from, "external.request_received", id, {
        revoked: !!m.revoke,
        sourceVersion: m.version,
      });
      return { accepted: true };
    });
  }
  async function decision(actor, { id, version, decision, note }, key) {
    role(actor, ["commander"]);
    check(
      actor.org === org,
      "OWNER",
      "Only this contractor owner can decide.",
      403,
    );
    check(
      ["approve", "reject"].includes(decision) &&
        typeof note === "string" &&
        note.trim(),
      "DECISION",
      "A decision and reason are required.",
    );
    // Real read latency and owner review remain charged by the source system.
    for (const target of ["inventory", "vehicles", "map"])
      await connector.action("query", { target }, uid("external_read"));
    await observe();
    return store.command(
      org,
      key,
      { id, version, decision, note },
      async (tx) => {
        const w = await tx.get(org, "external_work", id);
        check(
          w.version === version,
          "VERSION_CONFLICT",
          "Request changed. Read it again.",
          409,
        );
        check(
          w.state === "awaiting_review" && w.expiresAt > Date.now(),
          "REQUEST_STATE",
          "This request is not currently approvable.",
          409,
        );
        if (w.targetNeed && w.action.params.need === w.targetNeed.id)
          await tx.upsert(org, "need", w.targetNeed.id, {
            ...w.targetNeed,
            sharedBy: w.from,
          });
        const checked =
          decision === "approve"
            ? await validatePlan(tx, org, {
                id: w.id,
                actions: [w.action],
                conditions: [],
              })
            : [];
        const authorization =
          decision === "approve"
            ? {
                by: actor.id,
                name: actor.name,
                note,
                at: Date.now(),
                expiresAt: Math.min(w.expiresAt, Date.now() + 1800000),
                planHash: hash(w.action),
              }
            : null;
        const result = await tx.put(
          org,
          "external_work",
          id,
          {
            ...w,
            state: decision === "approve" ? "authorized" : "rejected",
            authorization,
            checked,
          },
          version,
        );
        await tx.audit(org, actor.id, "external." + decision, id, {
          version,
          note,
          scope: authorization?.planHash,
        });
        if (authorization)
          await tx.enqueue(
            org,
            "external_execute",
            { id },
            "external_execute_" + id + "_" + result.version,
          );
        return result;
      },
    );
  }
  async function execute(id) {
    let w = await store.get(org, "external_work", id),
      s = await observe();
    if (w.issued) {
      const o = s.operations.find(
        (o) => o.id === (w.issued.operation ?? w.issued.id),
      );
      if (o && terminal.has(o.state)) {
        await store.upsert(org, "external_work", id, {
          state: "completed",
          receipt: { ...o, confirmedBySource: true },
        });
        await queueReceipt(w, "completed", {
          id: o.id,
          type: o.type,
          org: o.org,
          need: o.need,
          building: o.building,
          destination: o.destination,
          vehicle: o.vehicle,
          resource: o.resource,
          resourceType: o.resourceType,
          quantity: o.quantity,
          received: o.received,
          times: o.times,
          unit: o.unit,
          state: o.state,
          observedAt: s.now,
          confirmedBySource: true,
        });
        return { completed: true };
      }
      if (o && ["failed", "cancelled"].includes(o.state)) {
        await store.upsert(org, "external_work", id, {
          state: "requires_review",
          authorization: null,
          changedReason:
            "The owner operational source reports failed or cancelled delivery.",
        });
        await queueReceipt(w, "failed", {
          id: o.id,
          state: o.state,
          confirmedBySource: true,
        });
        return { failed: true };
      }
      return { pending: true };
    }
    if (w.state !== "authorized") return { skipped: true };
    if (
      !w.authorization ||
      w.authorization.expiresAt <= Date.now() ||
      w.authorization.planHash !== hash(w.action)
    ) {
      await store.upsert(org, "external_work", id, {
        state: "requires_review",
        authorization: null,
        changedReason: "Owner authorization expired or changed.",
      });
      return { requiresReview: true };
    }
    await validatePlan(store, org, {
      id: w.id,
      actions: [w.action],
      conditions: [],
    });
    const p = await connector.action(
      "propose",
      {
        title: w.title,
        plan: { actions: [w.action] },
        references: [],
        conditions: [],
      },
      "external_propose_" + id,
    );
    await connector.action(
      "review",
      { id: p.id, decision: "approve" },
      "external_review_" + id,
      { human: true },
    );
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      s = await connector.state();
      if (s.proposals.find((x) => x.id === p.id)?.state === "authorized") break;
      await new Promise((r) => setTimeout(r, 120));
    }
    check(
      s.proposals.find((x) => x.id === p.id)?.state === "authorized",
      "REVIEW_PENDING",
      "The owner review has not yet reached its system.",
      409,
    );
    w = await store.get(org, "external_work", id);
    check(
      w.state === "authorized" && w.authorization?.expiresAt > Date.now(),
      "OWNER_AUTHORITY",
      "The request changed before dispatch.",
      409,
    );
    const issued = await connector.action(
      "dispatch",
      { ...w.action.params, proposal: p.id },
      "external_issue_" + id,
      { human: true },
    );
    await store.upsert(org, "external_work", id, {
      state: "in_transit",
      issued,
    });
    await queueReceipt(w, "in_transit", {
      id: issued.id,
      state: issued.state,
      confirmedBySource: false,
    });
    return { issued };
  }
  async function send({ to, message }) {
    const peer = peers.find((p) => p.org === to);
    check(peer, "PEER", "Partner is unavailable.");
    const envelope = { message, sentAt: Date.now() },
      response = await fetch(peer.url + "/api/network/inbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AIDSCALER-From": org,
          "X-AIDSCALER-Signature": sign(peer.key, envelope),
        },
        body: JSON.stringify(envelope),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    check(
      response.ok,
      "PEER_HTTP",
      "Partner could not acknowledge the message.",
      502,
    );
    return response.json();
  }
  async function share(actor, { kind, id, to, revoke = false }, key) {
    role(actor, ["commander"]);
    check(
      actor.org === org &&
        ["resource", "vehicle"].includes(kind) &&
        peers.some((p) => p.org === to),
      "SHARING_SCOPE",
      "An owner-scoped resource or vehicle and registered partner are required.",
    );
    await observe();
    return store.command(org, key, { kind, id, to, revoke }, async (tx) => {
      const r = await tx.get(org, kind, id);
      check(
        r.owner === org,
        "OWNER",
        "This asset is not owned by the contractor.",
        403,
      );
      const permissionId = `${kind}_${id}_${to}`,
        previous = await tx.get(
          org,
          "external_permission",
          permissionId,
          false,
        );
      const permissionVersion = (previous?.permissionVersion ?? 0) + 1;
      const projection = revoke
        ? null
        : kind === "resource"
          ? {
              id: r.id,
              owner: org,
              type: r.type,
              node: r.node,
              unit: r.unit,
              available: Math.max(
                0,
                r.quantity - (r.reserved ?? 0) - (r.floor ?? 0),
              ),
              compatibility: r.compatibility,
            }
          : Object.fromEntries(
              [
                "id",
                "owner",
                "node",
                "state",
                "capacity",
                "weightKg",
                "speedMps",
                "maxCargoKg",
                "volumeM3",
                "seats",
                "fuelMlPerKm",
                "fuel",
                "maxWaterDepth",
                "shiftEnd",
              ]
                .filter((k) => r[k] !== undefined)
                .map((k) => [k, r[k]]),
            );
      const m = {
        id: uid("external_offer"),
        from: org,
        to,
        kind,
        entityId: id,
        version: r.version,
        permissionVersion,
        at: Date.now(),
        expiresAt: Date.now() + 3600000,
        projection,
        revoke,
      };
      await tx.upsert(org, "external_permission", permissionId, {
        kind,
        recordId: id,
        to,
        active: !revoke,
        permissionVersion,
        expiresAt: m.expiresAt,
        lastSharedVersion: r.version,
        actorId: actor.id,
      });
      await tx.enqueue(
        org,
        "external_send",
        { to, message: m },
        "send_" + m.id,
      );
      await tx.audit(
        org,
        actor.id,
        revoke ? "external.capability_revoked" : "external.capability_shared",
        id,
        {
          to,
          kind,
        },
      );
      return { queued: true };
    });
  }
  async function drain(limit = 20) {
    await observe();
    for (const p of await store.list(org, "external_permission", 2000)) {
      if (!p.active) continue;
      if (p.expiresAt <= Date.now()) {
        await store.upsert(org, "external_permission", p.id, { active: false });
        continue;
      }
      const row = await store.get(org, p.kind, p.recordId, false);
      if (row && row.version !== p.lastSharedVersion) {
        const owner = (
          await store.query(
            "SELECT id,org,name,role FROM users WHERE org=$1 AND id=$2",
            [org, p.actorId],
          )
        ).rows[0];
        if (owner)
          await share(
            owner,
            { kind: p.kind, id: p.recordId, to: p.to },
            `refresh-${p.id}-${row.version}`,
          );
      }
    }
    const asOf = Date.now();
    let processed = 0;
    while (processed < limit) {
      const job = await store.lease(org, 180000, asOf);
      if (!job) break;
      try {
        const r =
          job.kind === "external_send"
            ? await send(job.payload)
            : job.kind === "external_execute"
              ? await execute(job.payload.id)
              : { unsupported: true };
        await store.finishJob(job.id, r);
      } catch (e) {
        await store.failJob(job, e);
      }
      processed++;
    }
    for (const w of await store.list(org, "external_work", 1000)) {
      if (w.state === "rejected" && !w.rejectionNotified) {
        await queueReceipt(w, "rejected", {
          reason: "The external owner declined the request.",
        });
        await store.upsert(org, "external_work", w.id, {
          rejectionNotified: true,
        });
      }
      if (w.issued && w.state === "in_transit") await execute(w.id);
    }
    return { processed };
  }
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "same-origin");
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api/network/inbox") {
        check(req.method === "POST", "METHOD", "POST required.", 405);
        return json(
          res,
          200,
          await receive(
            req.headers["x-aidscaler-from"],
            req.headers["x-aidscaler-signature"],
            await input(req),
          ),
        );
      }
      if (req.method !== "GET" && req.headers.origin)
        check(
          [
            "http://127.0.0.1:" + server.address().port,
            "http://localhost:" + server.address().port,
          ].includes(req.headers.origin),
          "ORIGIN",
          "Cross-origin mutation denied.",
          403,
        );
      if (url.pathname === "/api/login") {
        check(req.method === "POST", "METHOD", "POST required.", 405);
        const b = await input(req),
          session = await auth.login(
            b.email,
            b.password,
            req.socket.remoteAddress,
          );
        check(session.user.org === org, "OWNER", "Wrong contractor.", 403);
        res.setHeader(
          "Set-Cookie",
          `external=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        return json(res, 200, { user: session.user, csrf: session.csrf });
      }
      if (url.pathname.startsWith("/api/")) {
        const actor = await auth.session(
          req.headers.cookie?.match(/(?:^|; )external=([^;]+)/)?.[1],
        );
        check(
          actor?.org === org,
          "AUTHENTICATION",
          "Sign in as the contractor owner.",
          401,
        );
        if (req.method !== "GET")
          check(
            req.headers["x-csrf-token"] === actor.csrf,
            "CSRF",
            "Refresh your session.",
            403,
          );
        if (url.pathname === "/api/requests" && req.method === "GET")
          return json(res, 200, {
            user: actor,
            requests: await store.list(org, "external_work", 1000),
            peers: peers.map((p) => ({ org: p.org })),
            permissions: await store.list(org, "external_permission", 2000),
            capabilities: {
              resources: Object.values(
                (await connector.state()).known.resources ?? {},
              ).filter((r) => r.owner === org),
              vehicles: Object.values(
                (await connector.state()).known.vehicles ?? {},
              ).filter((v) => v.owner === org),
            },
          });
        check(req.method === "POST", "METHOD", "POST required.", 405);
        const b = await input(req),
          key = req.headers["idempotency-key"];
        if (url.pathname === "/api/decision")
          return json(res, 200, await decision(actor, b, key));
        if (url.pathname === "/api/share")
          return json(res, 202, await share(actor, b, key));
        throw new AppError("NOT_FOUND", "Endpoint not found.", 404);
      }
      if (url.pathname === "/" || url.pathname === "/partner.js") {
        res.writeHead(200, {
          "Content-Type":
            url.pathname === "/"
              ? "text/html; charset=utf-8"
              : "text/javascript; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
        });
        return res.end(
          await readFile(
            new URL(
              url.pathname === "/" ? "../ui/partner.html" : "../ui/partner.mjs",
              import.meta.url,
            ),
          ),
        );
      }
      throw new AppError("NOT_FOUND", "Page not found.", 404);
    } catch (e) {
      json(res, e.status ?? 400, {
        error: e.code ?? "ERROR",
        message: e.code ? e.message : "Unable to process the request.",
      });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  if (startWorker) {
    const loop = async () => {
      try {
        await drain();
      } catch {
      } finally {
        if (!stopping)
          timer = setTimeout(() => {
            loopPromise = loop();
          }, 1000);
      }
    };
    loopPromise = loop();
  }
  return {
    org,
    store,
    auth,
    config,
    connector,
    url: "http://127.0.0.1:" + server.address().port,
    receive,
    decision,
    share,
    execute,
    drain,
    observe,
    async close() {
      stopping = true;
      clearTimeout(timer);
      await loopPromise;
      await new Promise((r) => server.close(r));
      if (!providedStore) await store.close();
    },
  };
}
