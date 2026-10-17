import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { SimulatorConnector } from '../src/connector.mjs';

const origin = 'http://127.0.0.1:4329';
const fromHTML = (html) => new SimulatorConnector({
  sourceUrl: origin,
  fetcher: async (url) => {
    assert.equal(new URL(url).origin, origin);
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  },
});

test('public scrape pagination parses preserved encoded filters, attribute order and safe legacy links', async () => {
  for (const html of [
    '<a rel="next" href="/feed?cursor=30&amp;limit=30">Older</a>',
    '<a href="/feed?q=water+%26+%E6%B0%B4&amp;author=a&amp;cursor=30&amp;limit=30" rel="next">Older</a>',
    "<A href='/feed?limit=5&#38;cursor=30' rel='prev next'>Older</A>",
    '<a rel="NEXT" href="http://127.0.0.1:4329/feed?cursor=30">Older</a>',
  ]) assert.equal((await fromHTML(html).scrape()).nextCursor, 30);
});

test('public scrape navigation cannot widen source authority or accept malformed, duplicate or unbounded cursors', async () => {
  for (const href of [
    'https://attacker.example/feed?cursor=30',
    '//attacker.example/feed?cursor=30',
    '/api/observer/state?cursor=30',
    'javascript:alert(1)',
    'http://user:password@127.0.0.1:4329/feed?cursor=30',
    '/feed?cursor=30#observer',
    '/feed?cursor=-1',
    '/feed?cursor=1.5',
    '/feed?cursor=30&amp;cursor=60',
    '/feed?cursor=9007199254740992',
    '/feed?cursor=' + '1'.repeat(3000),
  ]) assert(Number.isNaN((await fromHTML(`<a href="${href}" rel="next">Older</a>`).scrape()).nextCursor));
  assert(Number.isNaN((await fromHTML('<a data-rel="next" href="/feed?cursor=30">Not navigation</a>').scrape()).nextCursor));
  assert(Number.isNaN((await fromHTML('<p>There are no more posts.</p>').scrape()).nextCursor));
});

const sourceModule = new URL('../../disaster-response-simulator/sources/server.mjs', import.meta.url);
test('actual simulator HTTP pages remain scrapeable across filtered multi-page navigation', {
  skip: !existsSync(sourceModule) && 'Optional simulator checkout is unavailable',
}, async (t) => {
  const { createLabServers } = await import(sourceModule.href);
  const lab = await createLabServers({
    observerPort: 0, sourcePort: 0, persistCredentials: false,
    config: { seed: 'scrape-pagination', grid: 3, extentKm: 2, topology: 'regional',
      hazard: 'none', policy: 'none', postsPerHour: 0, backgroundTraffic: 0, packetLoss: 0 },
  });
  t.after(() => lab.close());
  let author;
  for (let i = 0; i < 12; i++) {
    const post = lab.world.generateSignal('P01', { causeEvent: 'pagination-' + i,
      text: `Need water & 水, report ${i}`, author: 'pagination-resident', location: 'Harbor & 水' });
    author = post.public.authorId;
    lab.world.publishPost(post.public.id);
  }
  lab.world.advance(lab.world.config.sourceIndexMs + 1);
  const sourceUrl = `http://127.0.0.1:${lab.sourcePort}`,
    connector = new SimulatorConnector({ sourceUrl }),
    filters = { q: 'water & 水', author, location: 'Harbor & 水', since: 0, limit: 5 },
    visited = [];
  let cursor = 0;
  for (let page = 0; page < 3; page++) {
    const actual = await connector.scrape(cursor, filters),
      params = new URLSearchParams({ ...filters, cursor }),
      expected = await (await fetch(sourceUrl + '/api/feed?' + params)).json();
    assert.deepEqual(actual.ids, expected.posts.map(post => post.id));
    assert.equal(actual.ids.length, page < 2 ? 5 : 2);
    if (page < 2) {
      assert.equal(actual.nextCursor, cursor + 5);
      assert.match(actual.html, /q=water\+%26\+%E6%B0%B4&amp;/);
      cursor = actual.nextCursor;
    } else assert(Number.isNaN(actual.nextCursor));
    visited.push(...actual.ids);
  }
  assert.equal(new Set(visited).size, 12);
});
