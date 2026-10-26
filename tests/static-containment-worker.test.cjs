'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../service-worker.js'), 'utf8');
const origin = 'https://veconi.invalid';
function harness({offline = false} = {}) {
  const events = {}, calls = [], cache = new Map();
  let claims = 0, skipped = 0;
  const cacheApi = {
    addAll: async requests => { calls.push(['addAll', requests]); },
    match: async request => cache.get(typeof request === 'string' ? request : request.url),
    put: async (request, response) => cache.set(request.url, response),
  };
  const context = {
    URL, Response,
    Request: class extends Request { constructor(input, init) { super(new URL(input, origin), init); } },
    location: {origin},
    self: {addEventListener: (name, handler) => { events[name] = handler; }, clients: {claim: async () => { claims++; }}, skipWaiting: () => { skipped++; }},
    caches: {
      open: async name => { calls.push(['open', name]); return cacheApi; },
      match: async () => { throw Error('Must never search older caches'); },
      delete: async () => { throw Error('Must not delete user storage'); },
      keys: async () => { throw Error('Must not enumerate or erase previous caches'); },
    },
    fetch: async request => { calls.push(['fetch', request.url]); if (offline) throw Error('offline'); return new Response('CURRENT_PUBLIC_RESOURCE'); },
  };
  vm.runInNewContext(source, context);
  return {
    events, calls, cache,
    get claims() { return claims; }, get skipped() { return skipped; },
    async request(path, extra = {}) {
      let result;
      events.fetch({request: {url: new URL(path, origin).href, method: 'GET', destination: 'script', mode: 'cors', ...extra}, respondWith: promise => { result = promise; }});
      return result && await result;
    },
  };
}
for (const path of ['/js/kyteData.js', '/js/kyteBalances.js', '/js/saldoCorrecoes.js', '/js/kyteBootstrap.js', '/js/cleanupDemo.js', '/js/financeMigration.js', '/js/kyteData.js?old=1', '/js/kyte%44ata.js', '/js/KYTEDATA.JS', '/js/kyteData.js/']) {
  test('retired URL cannot serve old cached data, even offline: ' + path, async () => {
    const h = harness({offline: true});
    const response = await h.request(path);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(await response.text(), '');
    assert.deepEqual(h.calls, []);
  });
}
test('retired data is blocked online without a network request, including navigation', async () => {
  const h = harness();
  assert.equal((await h.request('/js/kyteData.js', {mode: 'navigate'})).status, 404);
  assert.deepEqual(h.calls, []);
});
test('installation caches only current operational resources and bypasses browser HTTP cache', async () => {
  const h = harness(); let done;
  h.events.install({waitUntil: promise => { done = promise; }}); await done;
  const requests = h.calls.find(call => call[0] === 'addAll')[1];
  assert.ok(requests.length > 150);
  assert.ok(requests.every(request => request.cache === 'reload'));
  assert.ok(requests.every(request => !/kyte|cleanupDemo|saldoCorrecoes|financeMigration/i.test(request.url)));
});
test('activation does not delete caches, IndexedDB, queues, localStorage or sessions', async () => {
  const h = harness(); let done;
  h.events.activate({waitUntil: promise => { done = promise; }}); await done;
  assert.equal(h.claims, 1); assert.deepEqual(h.calls, []);
  assert.doesNotMatch(source, /indexedDB|localStorage|sessionStorage|caches\.delete|caches\.keys|signOut/);
});
test('new cache never falls back to any older cache during offline reload', async () => {
  const h = harness({offline: true});
  h.cache.set('./index.html', new Response('CURRENT_SAFE_INDEX'));
  const response = await h.request('/new-route', {mode: 'navigate'});
  assert.equal(await response.text(), 'CURRENT_SAFE_INDEX');
  assert.ok(h.calls.filter(call => call[0] === 'open').every(call => /^veconi-v205-customer-dependencies(?:-compatible)?$/.test(call[1])));
});
test('catalog route keeps its current offline fallback', async () => {
  const h = harness({offline: true});
  h.cache.set('./catalogo.html', new Response('CURRENT_CATALOG'));
  assert.equal(await (await h.request('/catalogo/store', {mode: 'navigate'})).text(), 'CURRENT_CATALOG');
});
test('normal script requests still use network and cache the current response', async () => {
  const h = harness();
  assert.equal(await (await h.request('/js/app.js')).text(), 'CURRENT_PUBLIC_RESOURCE');
  assert.ok(h.cache.has(origin + '/js/app.js'));
});
test('normal images keep current-cache-first behavior', async () => {
  const h = harness();
  h.cache.set(origin + '/assets/icon.png', new Response('SAFE_ICON'));
  assert.equal(await (await h.request('/assets/icon.png', {destination: 'image'})).text(), 'SAFE_ICON');
  assert.equal(h.calls.some(call => call[0] === 'fetch'), false);
});
test('cross-origin Firestore/Auth requests and non-GET mutations are not intercepted', async () => {
  const h = harness();
  assert.equal(await h.request('https://firestore.googleapis.com/v1/test'), undefined);
  assert.equal(await h.request('/operation', {method: 'POST'}), undefined);
  assert.deepEqual(h.calls, []);
});
test('worker reports V205 without changing commercial code or login state', () => {
  const h = harness(); let version;
  h.events.message({data: 'GET_VERSION', ports: [{postMessage: value => { version = value; }}]});
  assert.equal(version.release, '205');
  h.events.message({data: 'SKIP_WAITING'}); assert.equal(h.skipped, 1);
});
