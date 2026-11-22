'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const selling = process.argv.includes('--selling');
const artifactDir = path.join(root, selling ? 'qa-artifacts/v2423' : 'qa-artifacts/v2422');
const site = path.resolve(process.env.VECONI_PWA_SITE || path.join(artifactDir, 'public'));
const oldRef = selling ? '65ea4bb' : 'c643cc5';
const syncPanel = { cache: 'veconi-v2421-sync-panel-v1', release: '242', appVersion: '242.1' };
const quickWins = { cache: 'veconi-v2422-performance-quick-wins-v1', release: '242', appVersion: '242.2' };
const previous = selling ? quickWins : syncPanel;
const next = selling ? { cache: 'veconi-v2423-performance-selling-v1', release: '242', appVersion: '242.3' } : quickWins;
const scriptsAt = (files, version) => files.map(file => '/js/' + file + '.js?v=' + version);
const quickWinsScripts = ['clientes-mobile', 'customer-metrics', 'crm-segment-engine-v2'];
const pinned = selling
  ? [
      ...scriptsAt(['build-info', 'app', 'barcode', 'checkout', 'checkout-mobile', 'desktop-sales'], '2423'),
      '/css/checkout-mobile.css?v=2423',
      ...scriptsAt(quickWinsScripts, '2422'),
    ]
  : scriptsAt(['build-info', 'app', ...quickWinsScripts], '2422');
const oldFiles = new Map();
const changed = new Set(execFileSync('git', ['diff', '--name-only', oldRef], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/));
const scope = 'adiFestaDB_v1:qa-v2422:qa-owner:owner';
const queueKey = 'adiFesta:qa-v2422:qa-owner:owner:syncQueue';
const operations = [
  { operationId: 'qa-pending', status: 'pending', payload: { value: 10 } },
  ...[0, 1, 2].map(id => ({
    operationId: 'qa-historical-' + id, documentId: 'qa-sale-' + id,
    status: 'error', replayBlocked: true, canRetry: false, reviewReason: 'service_configuration_missing',
  })),
];
const queue = JSON.stringify(operations);
const data = { vendas: [{ id: 'qa-sale', valorFinal: 10 }], pagamentos: [{ id: 'qa-payment', valor: 20 }] };
let candidate = false;
let offline = false;

function bytes(file, current = candidate) {
  const resolved = path.resolve(site, file);
  if (!resolved.startsWith(site + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  if (current || !changed.has(file)) return fs.readFileSync(resolved);
  if (!oldFiles.has(file)) oldFiles.set(file, execFileSync('git', ['show', oldRef + ':' + file], { cwd: root }));
  return oldFiles.get(file);
}

const media = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  if (offline) return res.destroy();
  const { pathname } = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/qa-upgrade') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const index = bytes('index.html').toString();
    const build = index.match(/src="(\.\/js\/build-info\.js\?v=\d+)"/)[1];
    return res.end(`<!doctype html><html><head><link rel="manifest" href="./manifest.json">
    <link rel="stylesheet" href="./css/veconi-fluxo.css?v=242">
    <script src="${build}"></script><script src="./js/veconi-fluxo.js?v=242"></script></head>
    <body><button data-theme-toggle>Alternar</button><main id="app" data-route="clientes"></main>
    <script>window.DB={};window.confirm=()=>true;</script>
    <script src="./js/local-records.js"></script><script src="./js/business-cache.js"></script>
    <script src="./js/pwa-update.js"></script><script>PwaUpdate.register();</script></body></html>`);
  }
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const content = bytes(file);
  if (!content) return res.writeHead(404).end();
  res.setHeader('Content-Type', media[path.extname(file)] || 'application/octet-stream');
  res.end(content);
});

function workerVersion(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(Error('GET_VERSION timeout')), 5000);
    channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
    navigator.serviceWorker.controller.postMessage('GET_VERSION', [channel.port2]);
  }));
}

async function verify(page) {
  assert.deepEqual(await workerVersion(page), next);
  const result = await page.evaluate(async ({ scope, queueKey, next, pinned }) => {
    const saved = await DB.businessCache.open(scope, [], () => ({}));
    const queue = DB.businessCache.keyValue.peekItem(queueKey);
    await DB.businessCache.release();
    const cache = await caches.open(next.cache);
    const artifact = await (await cache.match('/index.html')).text();
    const hashes = {};
    for (const asset of pinned) {
      const pathname = asset.split('?')[0];
      const matches = [...artifact.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)]
        .map(([, url]) => url.slice(1)).filter(url => url.split('?')[0] === pathname);
      if (matches.length !== 1 || matches[0] !== asset) throw Error('Referência ausente ou duplicada: ' + asset);
      const response = await cache.match(asset);
      if (!response?.ok) throw Error('Recurso fora do cache: ' + asset);
      hashes[asset] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
    }
    return { saved, queue, hashes, theme: document.documentElement.dataset.theme, preference: localStorage.getItem('veconi-theme'), caches: await caches.keys() };
  }, { scope, queueKey, next, pinned });
  assert.deepEqual(result.saved, data);
  assert.equal(result.queue, queue);
  assert.equal(result.theme, 'dark');
  assert.equal(result.preference, 'dark');
  assert.ok(result.caches.includes(previous.cache));
  for (const asset of pinned) {
    const expected = createHash('sha256').update(bytes(asset.split('?')[0].slice(1), true)).digest('hex');
    assert.equal(result.hashes[asset], expected, asset);
  }
}

async function main() {
  assert.ok(fs.existsSync(path.join(site, 'index.html')), 'Build the allowlisted package before testing');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/qa-upgrade';
  const userDataDir = fs.mkdtempSync(path.join(artifactDir, 'browser-'));
  const options = {
    headless: true, userDataDir, protocolTimeout: 30000,
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],
  };
  let browser;
  try {
    browser = await puppeteer.launch(options);
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    assert.deepEqual(await workerVersion(page), previous);
    assert.equal(await page.evaluate(() => AdiFestaBuild.appVersion), previous.appVersion);
    await page.evaluate(async ({ scope, queueKey, data, queue }) => {
      await DB.businessCache.open(scope, [], () => ({}));
      DB.businessCache.stage(data, scope);
      DB.businessCache.keyValue.setItem(queueKey, queue);
      localStorage.setItem('veconi-theme', 'dark');
      await DB.flush();
    }, { scope, queueKey, data, queue });
    candidate = true;
    await Promise.all([
      page.waitForNavigation(),
      page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); }),
    ]);
    await page.waitForFunction(version => AdiFestaBuild.appVersion === version && navigator.serviceWorker.controller, {}, next.appVersion);
    await verify(page);
    await browser.close();
    offline = true;
    browser = await puppeteer.launch(options);
    const reopened = await browser.newPage();
    await reopened.setOfflineMode(true);
    await reopened.goto(url);
    await reopened.waitForFunction(version => AdiFestaBuild.appVersion === version && navigator.serviceWorker.controller, {}, next.appVersion);
    await verify(reopened);
    console.log(JSON.stringify({ previous, next, verifiedAssets: pinned.length, persistedDocuments: 2, intactOperations: operations.length, theme: 'dark', offlineAfterRestart: true }));
  } finally {
    await browser?.close();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
