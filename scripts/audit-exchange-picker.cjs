'use strict';
// Runs the existing exchange fixture in Chrome with synthetic data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer');

const root = path.resolve(__dirname, '..');
const fixture = '/tests/fixtures/sale-exchanges.html';
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const styles = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<link\s+rel="stylesheet"\s+href="\.(\/css\/[^"?]+)[^"]*"/g)].map(match => match[1]);
const assets = new Set([fixture, '/js/sale-exchanges.js', '/js/barcode.js', '/js/recibos.js',
  ...styles]);
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!assets.has(pathname)) return response.writeHead(404).end();
  const file = path.join(root, pathname);
  response.setHeader('Content-Type', mime[path.extname(file)] + '; charset=utf-8');
  fs.createReadStream(file).pipe(response);
});

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await puppeteer.launch({
    executablePath: process.env.VECONI_QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  try {
    for (const width of [320, 390, 1366]) {
      const page = await browser.newPage();
      try {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith(origin + '/') ? request.continue() : request.abort());
        await page.setViewport({ width, height: 840, isMobile: width < 600, hasTouch: width < 600 });
        await page.goto(origin + fixture + '?large', { waitUntil: 'domcontentloaded' });
        await page.$eval('link[href*="sale-exchanges.css"]', link => link.remove());
        for (const style of styles) await page.addStyleTag({ url: origin + style });
        await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/recibos.js'), 'utf8').split('(function(){')[0] });
        await page.evaluate(async () => {
          await window.fixtureReady;
          document.querySelector('[data-ex-close]').click();
          await document.querySelector('[data-fixture-open]').onclick();
        });
        const tap = async selector => {
          await page.$eval(selector, element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
          await page.waitForFunction(selector => {
            const element = document.querySelector(selector), box = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
          }, { timeout: 2000 }, selector);
          if (width < 600) await page.tap(selector);
          else await page.click(selector);
        };
        const count = selector => page.$$eval(selector, nodes => nodes.length);
        const search = '[data-ex-search]', result = '[data-ex-result]', quantity = '[data-quantity]';
        const query = async value => page.$eval(search, (input, value) => {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        const read = async value => { await query(value); await page.focus(search); await page.keyboard.press('Enter'); };
        assert.equal(await count(result), 0);
        assert.equal(await count(quantity), 0);
        await tap('[data-ex-add]');
        assert.equal(await page.$eval(search, el => document.activeElement === el), true);
        await page.type(search, 'Serum');
        assert.match(await page.$eval(result, el => el.textContent), /Sérum iluminador/);
        await query('vermelho');
        assert.match(await page.$eval(result, el => el.textContent), /Batom luminoso.*Vermelho.*BAT-VER/);
        await query('BAT-NU');
        assert.equal(await count(result), 1);
        assert.match(await page.$eval(result, el => el.textContent), /Nude/);
        await query('SER-01');
        assert.equal(await count(result), 1);
        await query('produto extra');
        assert.equal(await count(result), 12);
        assert.match(await page.$eval('[data-ex-picker-status]', el => el.textContent), /12 de 1000/);
        await query('EXTRA-1000');
        assert.equal(await count(result), 1);
        assert.match(await page.$eval(result, el => el.textContent), /Produto extra 1000/);

        await query('0789 123456789');
        assert.match(await page.$eval(result, el => el.textContent), /Sérum/);
        await page.focus(search);
        await page.keyboard.press('Enter');
        assert.equal(await count(quantity), 1);
        await page.keyboard.type('0789123456789');
        await page.keyboard.press('Enter');
        assert.equal(await page.$eval(quantity, input => input.value), '2');
        await read('7891234567888');
        assert.match(await page.$eval('[data-ex-new]', el => el.textContent), /Rosa/);
        await read('7891234567895');
        assert.equal(await count(result), 2);
        assert.equal(await count(quantity), 2);
        await tap('[data-ex-result="1"]');
        assert.equal(await count(quantity), 3);
        await read('9999999999999');
        await page.waitForFunction(() => document.querySelector('[data-ex-picker-status]').textContent.includes('não encontrado'));
        assert.equal(await page.$eval(search, el => el.value), '');
        assert.deepEqual(await page.evaluate(() => fixtureCalls.map(call => call.name)), ['listSaleExchanges', 'listSaleExchanges']);

        await page.evaluate(() => {
          BarcodeScannerService.startScanner = async options => {
            window.fixtureScan = options.onDetected;
            options.onReady({ devices: [], torch: false });
          };
          BarcodeScannerService.stopScanner = () => {};
        });
        await tap('[data-ex-scan]');
        await page.evaluate(() => window.fixtureScan({ value: '7891234567888' }));
        await page.waitForFunction(() => !document.querySelector('#barcode-root'));
        assert.equal(await page.$$eval(quantity, inputs => inputs[1].value), '2');
        await tap('[data-ex-scan]');
        await page.waitForFunction(() => document.activeElement?.matches('#barcode-root [data-barcode-close]'), { timeout: 2000 });
        await tap('[data-barcode-manual]');
        await page.type('#barcode-root [name="barcode"]', '0789123456789');
        assert.equal(await page.$eval('#barcode-root [name="barcode"]', input => input.value), '0789123456789');
        await tap('#barcode-root .barcode-manual button');
        await page.waitForFunction(() => !document.querySelector('#barcode-root'));
        assert.equal(await page.$eval(quantity, input => input.value), '3');

        await page.evaluate(() => {
          document.querySelector('[data-return="0"]').value = '1';
          document.querySelector('[data-restock="0"]').checked = true;
          document.querySelector('[name="reasonType"]').value = 'Preferência do cliente';
          document.querySelector('[name="paymentMethod"]').value = 'pix';
          document.querySelector('[data-quantity]').value = '99';
          document.querySelector('[data-ex-form]').requestSubmit();
        });
        await page.waitForFunction(() => document.querySelector('[data-ex-error]').textContent.includes('Estoque disponível insuficiente'));
        await page.$eval(quantity, input => { input.value = '2'; });
        await page.$eval('[data-ex-form]', form => form.requestSubmit());
        await page.waitForSelector('.exchange-difference');
        const quote = await page.evaluate(() => fixtureCalls.filter(call => call.name === 'quoteSaleExchange').at(-1).data);
        assert.deepEqual(quote.replacements, [
          { productId: 'qa-serum', variantId: null, quantity: 2 },
          { productId: 'qa-lipstick', variantId: 'qa-pink', quantity: 2 },
          { productId: 'qa-lipstick', variantId: 'qa-nude', quantity: 1 },
        ]);
        assert.deepEqual(quote.returns, [{ line: 0, quantity: 1, restock: true }]);
        assert.equal(quote.paymentMethod, 'pix');
        assert.equal(quote.reason, 'Preferência do cliente');
        const metrics = await page.$eval('.exchange-sheet', el => ({ fits: el.scrollWidth <= el.clientWidth + 1, width: el.clientWidth }));
        assert.ok(metrics.fits);
        await tap('[data-ex-received]');
        assert.equal(await page.$eval('[data-ex-received]', input => input.checked), true);
        await tap('[data-ex-confirm]');
        await page.waitForFunction(() => document.querySelector('.exchange-success') || document.querySelector('[data-ex-error]').textContent, { timeout: 4000 });
        assert.equal(await page.$eval('[data-ex-error]', element => element.textContent), '');
        assert.equal(await count('.exchange-success'), 1);
        assert.match(await page.$eval('[data-ex-history]', element => element.textContent), /Troca #1.*Confirmada/);
        assert.equal(await page.evaluate(() => fixtureCalls.filter(call => call.name === 'confirmSaleExchange').length), 1);

        await page.evaluate(async () => {
          document.querySelector('[data-ex-close]').click();
          await document.querySelector('[data-fixture-open]').onclick();
          window.SyncFirebase = {
            findProductVariantByBarcode: async code => {
              const variant = { id: code, parentProductId: 'qa-lipstick', barcode: code, displayName: 'Variação remota' };
              if (code === '8888888888888') variant.spaceId = 'qa-other-space';
              if (code === '7777777777777') await new Promise(resolve => { window.releaseFixtureLookup = resolve; });
              variants.push(variant);
            }
          };
        });
        await read('8888888888888');
        await page.waitForFunction(() => document.querySelector('[data-ex-picker-status]').textContent.includes('não encontrado'));
        assert.equal(await count(quantity), 0);
        await read('6666666666666');
        await page.waitForSelector(quantity);
        assert.match(await page.$eval('[data-ex-new]', el => el.textContent), /Variação remota/);
        await read('7777777777777');
        await page.waitForFunction(() => window.releaseFixtureLookup);
        await query('creme');
        await page.evaluate(() => window.releaseFixtureLookup());
        assert.match(await page.$eval(result, el => el.textContent), /Creme facial/);
        assert.equal(await count(quantity), 1);
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}px: 1.005 SKUs, busca, leitor, câmera/manual, estoque e confirmação única`);
      } catch (error) {
        console.error(await page.evaluate(() => ({
          active: document.activeElement?.outerHTML.slice(0, 250),
          scanner: Boolean(document.querySelector('#barcode-root')),
          status: document.querySelector('[data-ex-picker-status]')?.textContent,
          problem: document.querySelector('[data-ex-error]')?.textContent,
        })));
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
