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
    this.sourceResults = new Map();
    this.sourceResultReads = new Map();
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
  async state() {
    if (this.compactStateSupported === false)
      return this.request("/api/actor/state");
    for (let attempt = 0; ; attempt++) {
      let state;
      try {
        state = await this.request("/api/actor/state?compact=1");
      } catch (error) {
        // Older sources may reject the compact endpoint. Authentication and
        // transport failures must stay visible rather than widening access.
        if (error.status !== 404) throw error;
        this.compactStateSupported = false;
        return this.request("/api/actor/state");
      }
      if (!state.compact) {
        this.compactStateSupported = false;
        return state;
      }
      this.compactStateSupported = true;
      try {
        return await this.hydrateState(state);
      } catch (error) {
        // A result can be revised between its frame and its separate read.
        // Refetch the whole frame once; never substitute a different revision.
        if (attempt || ![404, 409].includes(error.status)) throw error;
      }
    }
  }
  async hydrateState(state) {
    check(
      state.compact.version === 1 &&
        typeof state.organization?.id === "string" &&
        typeof state.runId === "string" &&
        (state.compact.runId === undefined ||
          state.compact.runId === state.runId) &&
        Array.isArray(state.queries) &&
        state.known &&
        typeof state.known === "object",
      "SOURCE_SCHEMA",
      "Unexpected compact state schema. The connector needs a version update.",
      502,
    );
    const scope = JSON.stringify([state.runId, state.organization.id]);
    if (this.sourceResultScope !== scope) {
      this.sourceResultScope = scope;
      this.sourceResults.clear();
      this.sourceResultReads.clear();
    }
    const used = new Set(),
      queries = [];
    for (const query of state.queries) {
      if (!query.resultRef) {
        queries.push(query);
        continue;
      }
      const { id, version } = query.resultRef;
      check(
        id === query.id &&
          typeof id === "string" &&
          id.length &&
          typeof version === "string" &&
          version.length,
        "SOURCE_SCHEMA",
        "Unexpected query result reference. No unscoped data was requested.",
        502,
      );
      // Versions are content digests, shared by identical query results. Each
      // organization and episode has its own cache, including in-flight reads.
      const key = JSON.stringify([scope, version]);
      used.add(key);
      let result = this.sourceResults.get(key);
      if (!this.sourceResults.has(key)) {
        let reading = this.sourceResultReads.get(key);
        if (!reading) {
          reading = this.request(
            "/api/actor/query-result?" + new URLSearchParams({ id, version }),
          ).then((row) => {
            check(
              row.id === id &&
                row.version === version &&
                Object.hasOwn(row, "result"),
              "SOURCE_SCHEMA",
              "The source returned a different query result revision.",
              502,
            );
            this.sourceResults.set(key, row.result);
            return row.result;
          });
          this.sourceResultReads.set(key, reading);
        }
        try {
          result = await reading;
        } finally {
          if (this.sourceResultReads.get(key) === reading)
            this.sourceResultReads.delete(key);
        }
      }
      const { resultRef: _reference, ...rest } = query;
      // Callers receive an independent snapshot, just as with the original
      // JSON response. Their mutations cannot corrupt subsequent receipts.
      queries.push({ ...rest, result: structuredClone(result) });
    }
    const { compact, ...rest } = state;
    const known = { ...state.known };
    if (compact.mapQueryId !== null && compact.mapQueryId !== undefined) {
      const map = queries.find((q) => q.id === compact.mapQueryId);
      check(
        map?.target === "map" && Object.hasOwn(map, "result"),
        "SOURCE_SCHEMA",
        "The compact state references an unavailable map.",
        502,
      );
      known.map = structuredClone(map.result);
    }
    if (this.sourceResultScope === scope)
      for (const key of this.sourceResults.keys())
        if (!used.has(key)) this.sourceResults.delete(key);
    return { ...rest, known, queries };
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
