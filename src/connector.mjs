import { AppError, check } from "./errors.mjs";
import { hash } from "./store.mjs";
const decoder = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
export class SimulatorConnector {
  constructor({ sourceUrl, sourceAgentKey, sourceHumanKey, fetcher = fetch }) {
    this.url = sourceUrl.replace(/\/$/, "");
    this.agentKey = sourceAgentKey;
    this.humanKey = sourceHumanKey;
    this.fetcher = fetcher;
    this.transportRetries = 0;
  }
  async request(endpoint, { method = "GET", body, human = false } = {}) {
    check(
      endpoint.startsWith("/api/actor/") ||
        ["/api/feed", "/api/contracts"].some((p) => endpoint.startsWith(p)),
      "SOURCE_SCOPE",
      "This connector cannot access observer data.",
      403,
    );
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${human ? this.humanKey : this.agentKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
    };
    const res = await this.readOrIdempotentFetch(
      endpoint,
      options,
      method === "GET" || Boolean(body?.idempotencyKey),
    );
    const data = await res.json();
    if (!res.ok)
      throw new AppError(
        data.error ?? "SOURCE",
        data.message ?? "Source request failed.",
        res.status,
      );
    return data;
  }
  async readOrIdempotentFetch(endpoint, options, repeatable = false) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetcher(this.url + endpoint, {
          ...options,
          signal: AbortSignal.timeout(10000),
        });
      } catch (e) {
        const code = e.cause?.code ?? e.code ?? e.name;
        if (
          !repeatable ||
          attempt >= 1 ||
          ![
            "ECONNRESET",
            "ECONNREFUSED",
            "ETIMEDOUT",
            "UND_ERR_SOCKET",
            "TimeoutError",
          ].includes(code)
        )
          throw e;
        this.transportRetries++;
        this.lastTransientCode = code;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
  state() {
    return this.request("/api/actor/state");
  }
  async feed(cursor = 0, limit = 100) {
    const result = await this.request(
      "/api/feed?" + new URLSearchParams({ cursor, limit }),
    );
    check(
      Array.isArray(result.posts),
      "SOURCE_SCHEMA",
      "Unexpected feed schema. The connector needs a version update.",
      502,
    );
    return result;
  }
  inbox() {
    return this.request("/api/actor/inbox");
  }
  async scrape(cursor = 0) {
    const r = await this.readOrIdempotentFetch(
      "/feed?cursor=" + cursor,
      {},
      true,
    );
    check(r.ok, "SOURCE_HTTP", "Timeline unavailable.", 502);
    const html = await r.text();
    return {
      html,
      hash: hash(html),
      ids: [...html.matchAll(/data-post-id="([a-f0-9]{24})"/g)].map(
        (m) => m[1],
      ),
      nextCursor: Number(
        html.match(/rel="next" href="\/feed\?cursor=(\d+)"/)?.[1] ?? NaN,
      ),
    };
  }
  action(type, params, key, { human = false, version } = {}) {
    return this.request("/api/actor/action", {
      method: "POST",
      human,
      body: {
        type,
        params,
        idempotencyKey: key,
        ...(version === undefined ? {} : { expectedVersion: version }),
      },
    });
  }
  ack(post, stage, reason) {
    return this.request("/api/actor/ingestion", {
      method: "POST",
      body: {
        id: post.id,
        version: post.version,
        stage,
        reason,
        contentHash: hash(post),
      },
    });
  }
  async ackBatch(posts, stage) {
    if (!posts.length) return [];
    return this.request("/api/actor/ingestion/batch", {
      method: "POST",
      body: {
        items: posts.map((p) => ({
          id: p.id,
          version: p.version,
          stage,
          contentHash: hash(p),
        })),
      },
    });
  }
  startModel(model) {
    return this.request("/api/actor/model/start", {
      method: "POST",
      body: { model },
    });
  }
  async finishModel(id, receipt) {
    const result = await this.request("/api/actor/model/finish", {
      method: "POST",
      body: { id, ...receipt },
    });
    // A received provider response is not yet available to the simulated actor
    // when another organization still holds a modeled-clock barrier.
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      const row = (await this.state()).modelRequests?.find((r) => r.id === id);
      if (row && ["available", "failed"].includes(row.state)) return row;
      await new Promise((r) => setTimeout(r, 80));
    }
    throw new AppError(
      "MODEL_CLOCK_PENDING",
      "The provider response has not become available on the episode clock.",
      409,
    );
  }
}
export class HttpJsonConnector {
  constructor({ url, token, allowedOrigin, fetcher = fetch }) {
    check(
      new URL(url).origin === allowedOrigin,
      "CONNECTOR_ORIGIN",
      "The connector origin must be explicitly approved.",
      403,
    );
    Object.assign(this, { url, token, fetcher });
  }
  async read() {
    const response = await this.fetcher(this.url, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    check(response.ok, "CONNECTOR_HTTP", "Connector is unavailable.", 502);
    return response.json();
  }
}
export { decoder };
