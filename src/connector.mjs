import { AppError, check } from "./errors.mjs";
import { hash } from "./store.mjs";
import { deepFreezeJson, rememberImmutableSourceResult, immutableSourceResult } from './immutable-source-result.mjs';
import { SOURCE_INSTANCE_HEADER, SOURCE_RESPONSE_CHANGED, assertConnectionRecord } from './source-connection.mjs';
const decoder = (s) => s.replace(/&(?:quot|apos|lt|gt|amp|#\d{1,7}|#x[0-9a-f]{1,6});/gi, entity => {
  const token = entity.slice(1, -1).toLowerCase(),
    named = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };
  if (Object.hasOwn(named, token)) return named[token];
  const point = token.startsWith('#x') ? Number.parseInt(token.slice(2), 16) : Number(token.slice(1));
  return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
    ? String.fromCodePoint(point) : entity;
});
function nextFeedCursor(html, sourceUrl) {
  const origin = new URL(sourceUrl).origin;
  // A public document may offer navigation, never a new source authority.
  // Bound each candidate and parse its query rather than depending on the
  // cursor's position or on whether other preserved filters follow it.
  for (const anchor of html.matchAll(/<a\b([^>]{0,4096})>/gi)) {
    const attrs = new Map();
    for (const match of anchor[1].matchAll(/(?:^|\s)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const name = match[1].toLowerCase();
      if (!attrs.has(name)) attrs.set(name, decoder(match[2] ?? match[3]));
    }
    if (!attrs.get('rel')?.toLowerCase().split(/\s+/).includes('next')) continue;
    const href = attrs.get('href');
    if (!href || href.length > 2048) continue;
    try {
      const next = new URL(href, sourceUrl);
      if (next.origin !== origin || next.pathname !== '/feed' || next.username || next.password || next.hash) continue;
      const values = next.searchParams.getAll('cursor'), cursor = values[0];
      if (values.length === 1 && /^\d{1,16}$/.test(cursor) && Number.isSafeInteger(Number(cursor))) return Number(cursor);
    } catch { /* A malformed public link is not an available next page. */ }
  }
  return NaN;
}
const legacyResultSnapshot = (state, immutableResults) => {
  if (immutableResults) {
    for (const query of state.queries ?? []) if (Object.hasOwn(query,'result')) deepFreezeJson(query.result);
    if (state.known && Object.hasOwn(state.known,'map')) deepFreezeJson(state.known.map);
  }
  return state;
};
export class SimulatorConnector {
  constructor({ sourceUrl, sourceAgentKey, sourceHumanKey, fetcher = fetch }) {
    this.url = sourceUrl.replace(/\/$/, "");
    this.agentKey = sourceAgentKey;
    this.humanKey = sourceHumanKey;
    this.fetcher = fetcher;
    this.transportRetries = 0;
    this.sourceResults = new Map();
    this.sourceResultJson = new Map();
    this.sourceResultReads = new Map();
    this.sourceReadOrdinal = 0;
    this.latestSourceRead = 0;
  }
  configureSourceConnection(boundary) { this.sourceBoundary = boundary; }
  async checkSourceBoundary() {
    const bound = assertConnectionRecord(await this.sourceBoundary?.load());
    if (!this.sourceBoundary || (!bound && !this.agentKey)) return bound;
    try { await this.request('/api/actor/state?compact=1'); }
    catch (error) { if (error.status !== 404) throw error; await this.request('/api/actor/state'); }
    return assertConnectionRecord(await this.sourceBoundary.load());
  }
  async request(endpoint, { method = "GET", body, human = false, _sourceSerialized = false } = {}) {
    const actorState = endpoint.split('?')[0] === '/api/actor/state';
    if (this.sourceBoundary && actorState && !_sourceSerialized && !this.sourceBoundary.inTransaction?.()) {
      const pending = (this.sourceStateTail ?? Promise.resolve()).then(() => this.request(endpoint, { method, body, human, _sourceSerialized: true }));
      this.sourceStateTail = pending.catch(() => {});
      return pending;
    }
    check(
      endpoint.startsWith("/api/actor/") ||
        ["/api/feed", "/api/contracts"].some((p) => endpoint.startsWith(p)),
      "SOURCE_SCOPE",
      "This connector cannot access observer data.",
      403,
    );
    let bound = assertConnectionRecord(await this.sourceBoundary?.load());
    if (method !== 'GET' && this.sourceBoundary && (!bound || !bound.sourceInstance))
      bound = await this.checkSourceBoundary();
    const sourceReadOrdinal = actorState ? ++this.sourceReadOrdinal : null;
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${human ? this.humanKey : this.agentKey}`,
        ...(bound?.sourceInstance ? { [SOURCE_INSTANCE_HEADER]: bound.sourceInstance } : {}),
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
    const sourceInstance = res.headers?.get?.(SOURCE_INSTANCE_HEADER);
    if (this.sourceBoundary) {
      if (res.status === 409 && data.error === SOURCE_RESPONSE_CHANGED)
        await this.sourceBoundary.observe({ rejected: true, sourceInstance });
      if (res.ok && (endpoint.startsWith('/api/actor/') || sourceInstance != null)) {
        if (actorState) check(data.organization?.id === this.sourceBoundary.org,
          'SOURCE_ORG', 'The source key belongs to a different organization.', 403);
        // A transaction-local read must not wait behind an outside read whose
        // database observation is itself waiting for that transaction. Track
        // actual request order so an earlier concurrent HTTP reply cannot
        // falsely turn its older clock into a reset. Identity checks still run.
        const olderConcurrentRead = actorState && sourceReadOrdinal < this.latestSourceRead;
        if (actorState) this.latestSourceRead = Math.max(this.latestSourceRead, sourceReadOrdinal);
        await this.sourceBoundary.observe({ sourceInstance,
          ...(actorState ? { runId: data.runId, ...(olderConcurrentRead ? {} : { now: data.now }) } : {}) });
      }
    }
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
  async state({ immutableResults = false } = {}) {
    if (this.compactStateSupported === false)
      return legacyResultSnapshot(await this.request("/api/actor/state"), immutableResults);
    for (let attempt = 0; ; attempt++) {
      let state;
      try {
        state = await this.request("/api/actor/state?compact=1");
      } catch (error) {
        // Older sources may reject the compact endpoint. Authentication and
        // transport failures must stay visible rather than widening access.
        if (error.status !== 404) throw error;
        this.compactStateSupported = false;
        return legacyResultSnapshot(await this.request("/api/actor/state"), immutableResults);
      }
      if (!state.compact) {
        this.compactStateSupported = false;
        return legacyResultSnapshot(state, immutableResults);
      }
      this.compactStateSupported = true;
      try {
        return await this.hydrateState(state, { immutableResults });
      } catch (error) {
        // A result can be revised between its frame and its separate read.
        // Refetch the whole frame once; never substitute a different revision.
        if (attempt || ![404, 409].includes(error.status)) throw error;
      }
    }
  }
  async hydrateState(state, { immutableResults = false } = {}) {
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
      this.sourceResultJson.clear();
      this.sourceResultReads.clear();
    }
    const used = new Set(),
      queries = [];
    for (const query of state.queries) {
      if (!query.resultRef) {
        if (immutableResults && Object.hasOwn(query,'result')) deepFreezeJson(query.result);
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
        const transactionLocalRead = Boolean(this.sourceBoundary?.inTransaction?.());
        let reading = transactionLocalRead ? null : this.sourceResultReads.get(key);
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
            const document = JSON.stringify(row.result);
            rememberImmutableSourceResult(row.result, version, document);
            if (this.sourceResultScope === scope) {
              this.sourceResults.set(key, row.result);
              this.sourceResultJson.set(key, document);
            }
            return row.result;
          });
          if (!transactionLocalRead) this.sourceResultReads.set(key, reading);
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
      // These documents came from response.json(), so their wire type is
      // strictly JSON. Parse a retained immutable wire document instead of
      // traversing a city map with structuredClone on every polling cycle.
      // Each returned query and known-map copy remains independently mutable.
      const document = this.sourceResultJson.get(key) ?? JSON.stringify(result);
      queries.push({ ...rest, result: immutableResults && immutableSourceResult(result)
        ? result : immutableResults ? deepFreezeJson(JSON.parse(document)) : JSON.parse(document) });
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
      const reference = state.queries.find(q=>q.id===compact.mapQueryId).resultRef,
        document = reference && this.sourceResultJson.get(JSON.stringify([scope,reference.version]));
      known.map = immutableResults ? map.result
        : document === undefined ? JSON.parse(JSON.stringify(map.result)) : JSON.parse(document);
    }
    if (this.sourceResultScope === scope)
      for (const key of this.sourceResults.keys())
        if (!used.has(key)) { this.sourceResults.delete(key); this.sourceResultJson.delete(key); }
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
  async scrape(cursor = 0, query = {}) {
    const params = new URLSearchParams({ cursor: String(cursor) });
    for (const name of ['q', 'author', 'location', 'since', 'limit'])
      if (query[name] !== undefined && query[name] !== null && String(query[name]) !== '')
        params.set(name, String(query[name]));
    const r = await this.readOrIdempotentFetch(
      "/feed?" + params,
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
      nextCursor: nextFeedCursor(html, this.url),
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
