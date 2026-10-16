import test from "node:test";
import assert from "node:assert/strict";
import { SimulatorConnector } from "../src/connector.mjs";

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const geography = () => ({
  topology: "takamatsu",
  extentM: 10000,
  roads: Array.from({ length: 3000 }, (_, i) => ({
    id: `road-${i}`,
    from: `node-${i}`,
    to: `node-${i + 1}`,
  })),
});
const frame = ({
  runId = "run-1",
  org = "org0",
  version = "map-content-1",
  map = true,
} = {}) => ({
  runId,
  organization: { id: org },
  now: 60000,
  known: { resources: {}, needs: {}, vehicles: {}, buildings: {}, edges: {} },
  queries: [
    {
      id: "map-1",
      target: "map",
      state: "ready",
      completedAt: 50000,
      resultRef: { id: "map-1", version },
    },
  ],
  operations: [],
  inspections: [],
  commitments: [],
  compact: { version: 1, runId, mapQueryId: map ? "map-1" : null },
});
const connectorFor = (fetcher) =>
  new SimulatorConnector({
    sourceUrl: "http://127.0.0.1:4329",
    sourceAgentKey: "test-agent-only",
    sourceHumanKey: "test-human-only",
    fetcher,
  });

test("compact polling downloads an identical large map once and restores the exact legacy snapshot", async () => {
  const map = geography(),
    state = frame(),
    calls = [],
    bytes = [];
  state.queries.push({
    ...state.queries[0],
    id: "map-2",
    resultRef: { id: "map-2", version: "map-content-1" },
  });
  state.compact.mapQueryId = "map-2";
  const connector = connectorFor(async (url, options) => {
    const endpoint = new URL(url);
    calls.push(endpoint);
    assert.equal(options.headers.Authorization, "Bearer test-agent-only");
    assert.equal(options.redirect, "error");
    const data =
      endpoint.pathname === "/api/actor/state"
        ? state
        : {
            id: endpoint.searchParams.get("id"),
            version: "map-content-1",
            result: map,
          };
    bytes.push(Buffer.byteLength(JSON.stringify(data)));
    return reply(data);
  });
  const { compact: _compact, ...expected } = structuredClone(state);
  expected.known.map = map;
  expected.queries = expected.queries.map(
    ({ resultRef: _reference, ...q }) => ({ ...q, result: map }),
  );
  assert.deepEqual(await connector.state(), expected);
  const firstBytes = bytes.reduce((a, b) => a + b, 0);
  state.now = 70000;
  expected.now = 70000;
  assert.deepEqual(await connector.state(), expected);
  assert.equal(
    calls.filter((c) => c.pathname === "/api/actor/query-result").length,
    1,
    "content-identical map query results share one scoped payload",
  );
  assert.ok(
    calls
      .filter((c) => c.pathname === "/api/actor/state")
      .every((c) => c.searchParams.get("compact") === "1"),
  );
  assert.ok(
    bytes.at(-1) < Buffer.byteLength(JSON.stringify(expected)) / 100,
    "subsequent updates must not retransmit geography in any result",
  );
  assert.ok(
    firstBytes < Buffer.byteLength(JSON.stringify(expected)),
    "the initial frame also avoids duplicate map copies",
  );
});

test("source result caches cannot leak across organization or episode changes", async () => {
  let state = frame(),
    reads = 0;
  const connector = connectorFor(async (url) => {
    const endpoint = new URL(url);
    return reply(
      endpoint.pathname.endsWith("/state")
        ? state
        : {
            id: "map-1",
            version: "map-content-1",
            result: {
              episode: state.runId,
              owner: state.organization.id,
              read: ++reads,
            },
          },
    );
  });
  assert.equal((await connector.state()).known.map.read, 1);
  state = frame({ runId: "run-2" });
  assert.deepEqual((await connector.state()).known.map, {
    episode: "run-2",
    owner: "org0",
    read: 2,
  });
  state = frame({ runId: "run-2", org: "org1" });
  assert.deepEqual((await connector.state()).known.map, {
    episode: "run-2",
    owner: "org1",
    read: 3,
  });
  assert.equal(reads, 3);
  assert.equal(connector.sourceResults.size, 1);
});

test("new query result revisions are downloaded and retired results leave the bounded cache", async () => {
  let state = frame(),
    reads = 0;
  const connector = connectorFor(async (url) => {
    const endpoint = new URL(url);
    return reply(
      endpoint.pathname.endsWith("/state")
        ? state
        : {
            id: "map-1",
            version: endpoint.searchParams.get("version"),
            result: { revision: ++reads },
          },
    );
  });
  assert.equal((await connector.state()).known.map.revision, 1);
  state = frame({ version: "map-content-2" });
  assert.equal((await connector.state()).known.map.revision, 2);
  assert.equal(connector.sourceResults.size, 1);
  state.queries = [];
  state.compact.mapQueryId = null;
  const noMap = await connector.state();
  assert.equal(Object.hasOwn(noMap.known, "map"), false);
  assert.equal(connector.sourceResults.size, 0);
});

test("concurrent snapshots share a scoped result fetch while callers cannot mutate the cache", async () => {
  let reads = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const connector = connectorFor(async (url) => {
    const endpoint = new URL(url);
    if (endpoint.pathname.endsWith("/state")) return reply(frame());
    reads++;
    await gate;
    return reply({
      id: "map-1",
      version: "map-content-1",
      result: { roads: [{ id: "intact" }] },
    });
  });
  const first = connector.state(),
    second = connector.state();
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(reads, 1);
  a.queries[0].result.roads[0].id = "local mutation";
  a.known.map.roads[0].id = "other mutation";
  assert.equal(b.known.map.roads[0].id, "intact");
  assert.equal((await connector.state()).known.map.roads[0].id, "intact");
});

test("legacy sources retain their original shape and unsupported compact requests fall back once", async () => {
  const legacy = {
      organization: { id: "org0" },
      known: { map: null },
      queries: [],
    },
    calls = [];
  const connector = connectorFor(async (url) => {
    const endpoint = new URL(url);
    calls.push(endpoint.search);
    return endpoint.search ? reply({ error: "NOT_FOUND" }, 404) : reply(legacy);
  });
  assert.deepEqual(await connector.state(), legacy);
  assert.deepEqual(await connector.state(), legacy);
  assert.deepEqual(calls, ["?compact=1", "", ""]);
  let oldCalls = 0;
  const old = connectorFor(async () => {
    oldCalls++;
    return reply(legacy);
  });
  assert.deepEqual(await old.state(), legacy);
  assert.deepEqual(await old.state(), legacy);
  assert.equal(oldCalls, 2);
  const forbidden = connectorFor(async () =>
    reply({ error: "FORBIDDEN" }, 403),
  );
  await assert.rejects(forbidden.state(), { code: "FORBIDDEN", status: 403 });
  await assert.rejects(connector.request("/api/observer/state"), {
    code: "SOURCE_SCOPE",
  });
});

test("a result revised after the compact frame retries the frame rather than mixing revisions", async () => {
  let frames = 0,
    reads = 0;
  const connector = connectorFor(async (url) => {
    const endpoint = new URL(url);
    if (endpoint.pathname.endsWith("/state"))
      return reply(frame({ version: `map-content-${++frames}` }));
    if (++reads === 1) return reply({ error: "SOURCE_RESULT_CHANGED" }, 409);
    return reply({
      id: "map-1",
      version: endpoint.searchParams.get("version"),
      result: { roads: ["new revision"] },
    });
  });
  assert.deepEqual((await connector.state()).known.map, {
    roads: ["new revision"],
  });
  assert.equal(frames, 2);
  assert.equal(reads, 2);
  const unavailable = connectorFor(async (url) =>
    new URL(url).pathname.endsWith("/state")
      ? reply(frame())
      : reply({ error: "SOURCE_RESULT_CHANGED" }, 409),
  );
  await assert.rejects(unavailable.state(), {
    code: "SOURCE_RESULT_CHANGED",
    status: 409,
  });
});

test("invalid result references and mismatched endpoint revisions fail without using unscoped data", async () => {
  const malformed = frame();
  malformed.queries[0].resultRef.id = "foreign-result";
  let requests = 0;
  const connector = connectorFor(async () => {
    requests++;
    return reply(malformed);
  });
  await assert.rejects(connector.state(), {
    code: "SOURCE_SCHEMA",
    status: 502,
  });
  assert.equal(requests, 1);
  const wrongRevision = connectorFor(async (url) =>
    reply(
      new URL(url).pathname.endsWith("/state")
        ? frame()
        : { id: "map-1", version: "different-revision", result: {} },
    ),
  );
  await assert.rejects(wrongRevision.state(), {
    code: "SOURCE_SCHEMA",
    status: 502,
  });
  const noLegacyMap = frame({ map: false });
  const withoutMap = connectorFor(async (url) =>
    reply(
      new URL(url).pathname.endsWith("/state")
        ? noLegacyMap
        : { id: "map-1", version: "map-content-1", result: { roads: [] } },
    ),
  );
  assert.equal(
    Object.hasOwn((await withoutMap.state()).known, "map"),
    false,
    "query hydration must not invent a legacy known.map field",
  );
});
