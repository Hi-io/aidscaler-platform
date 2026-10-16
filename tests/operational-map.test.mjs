import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalMap } from '../ui/map.mjs';

const data = (geography) => ({ geography, needs: [], vehicles: [], roads: [] });
const directory = (extra = {}) => ({
  nodes: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 10000, z: 0 }, { id: 'c', x: 0, z: 10000 }],
  roads: [{ id: 'east', from: 'a', to: 'b' }, { id: 'south', from: 'a', to: 'c' }],
  places: [], ...extra,
});
const paths = html => [...html.matchAll(/<polyline points="([^"]+)"/g)].map(match => match[1].split(' ').map(pair => pair.split(',').map(Number)));

test('Takamatsu is identified from received geography and retains equal distance on both axes', () => {
  const geo = directory({ extentM: 10000, geography: {
    name: 'Takamatsu, Kagawa, Japan', extentM: 10000, projection: { northUp: true },
    attribution: 'Map data © OpenStreetMap contributors',
  } });
  const html = operationalMap(data(geo));
  assert.match(html, /<strong>Takamatsu, Kagawa, Japan<\/strong>/);
  assert.match(html, /Received geography · 10 × 10 km · North up/);
  assert.match(html, /Map data © OpenStreetMap contributors/);
  assert.match(html, /viewBox="0 0 920 920"/);
  const [east, south] = paths(html);
  assert.equal(east[1][0] - east[0][0], south[1][1] - south[0][1]);
  for (const path of [east, south]) for (const [x, y] of path) {
    assert.ok(x >= 20 && x <= 900 && y >= 20 && y <= 900);
  }
});

test('the operational map keeps source road curves and supports negative coordinate origins', () => {
  const geo = directory({ nodes: [{id:'a', x:-100, z:-100}, {id:'b', x:100, z:100}],
    roads: [{id:'curve',name:'Harbor Road',from:'a',to:'b',points:[{x:-100,z:-100},{x:0,z:-25},{x:100,z:100}]}] });
  const html = operationalMap(data(geo)), [curve] = paths(html);
  assert.equal(curve.length, 3);
  assert.match(html, /Harbor Road · No current condition report/);
  assert.ok(curve.every(([x, y]) => x >= 20 - 1e-8 && x <= 900 + 1e-8 && y >= 20 - 1e-8 && y <= 900 + 1e-8));
  assert.match(html, /Received source map/);
  assert.doesNotMatch(html, /Takamatsu|North up/);
});

test('map height follows rectangular geography and the reference view keeps case actions without pan controls', () => {
  const geo = directory({ nodes: [{id:'a',x:0,z:0},{id:'b',x:20000,z:0},{id:'c',x:0,z:10000}],
    places: [{id:'shelter',node:'a',name:'Central Shelter'}] });
  const html = operationalMap({ ...data(geo), needs: [{id:'water',building:'shelter',type:'water',quantity:600,served:0,unit:'L'}] });
  assert.match(html, /width="920" height="480" viewBox="0 0 920 480"/);
  assert.match(html, /data-action="need" data-id="water"/);
  assert.doesNotMatch(html, /data-map=|Zoom in|Zoom out|Reset view/);
});

test('map identity is escaped and missing geography does not invent a map', () => {
  const html = operationalMap(data(directory({geography:{name:'<b>Source</b>',attribution:'<script>bad</script>'}})));
  assert.match(html, /&lt;b&gt;Source&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(operationalMap(data(null)), /No map has arrived from an authorized source/);
});
