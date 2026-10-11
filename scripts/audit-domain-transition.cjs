'use strict';
// Local-only rehearsal. Fresh browser contexts; all non-local traffic is blocked.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '..');
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'};
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname.startsWith('/adi-festa-controle/')) pathname = pathname.slice('/adi-festa-controle'.length);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({headless:true});
  try {
    for (const base of ['/', '/adi-festa-controle/']) {
      const context = await browser.createBrowserContext(), page = await context.newPage(), missing = [];
      try {
        await page.setRequestInterception(true);
        page.on('request', request => {
          if (request.url().startsWith(origin + '/')) request.continue(); else request.abort();
        });
        page.on('response', response => { if (response.url().startsWith(origin + '/') && response.status() >= 400) missing.push(response.url()); });
        page.on('dialog', dialog => dialog.dismiss());
        await page.setViewport({width:390, height:844});
        await page.goto(origin + base + '#/planos', {waitUntil:'domcontentloaded'});
        assert.equal(await page.title(), 'VECONI');
        await page.evaluate(() => navigator.serviceWorker.register('./service-worker.js'));
        await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {timeout:30000});
        const result = await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          const version = await new Promise(resolve => {
            const channel = new MessageChannel(); channel.port1.onmessage = event => resolve(event.data);
            registration.active.postMessage('GET_VERSION', [channel.port2]);
          });
          const manifestURL = document.querySelector('link[rel="manifest"]').href;
          const manifest = await (await fetch(manifestURL)).json();
          const cache = await caches.open(version.cache);
          return {scope:registration.scope, startURL:new URL(manifest.start_url, manifestURL).href,
            manifestScope:new URL(manifest.scope, manifestURL).href, cachedRequests:(await cache.keys()).length, version};
        });
        assert.equal(result.scope, origin + base);
        assert.equal(result.manifestScope, origin + base);
        assert.equal(result.startURL, origin + base + 'index.html');
        assert.ok(result.cachedRequests > 100);
        await page.setOfflineMode(true);
        await page.reload({waitUntil:'domcontentloaded'});
        assert.equal(await page.title(), 'VECONI');
        assert.equal(new URL(page.url()).hash, '#/planos');
        assert.deepEqual(missing, []);
        console.log(JSON.stringify({base, ...result, offlineShellReload:true, missingLocalAssets:missing.length, externalRequestsBlocked:true}));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => server.close());
