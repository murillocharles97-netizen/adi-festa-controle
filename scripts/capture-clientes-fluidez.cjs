'use strict';
// Capturas da tela de Clientes e do novo formulário de recebimento (V242.7) em
// 360, 390, 412, tablet e desktop, temas claro e escuro. Dados fictícios.
// Uso: node scripts/capture-clientes-fluidez.cjs [--out pasta]
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const OUT = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(__dirname, '..', 'docs', 'screenshots', 'clientes-fluidez-v2427'));
const helpers = require('./performance-lab-helpers.cjs');
const { routeFixture } = require('./audit-performance-runtime-c643cc5.cjs');
const source = fs.readFileSync(path.join(__dirname, 'audit-clientes-fluidez.cjs'), 'utf8');
// Reutiliza exatamente os mesmos stubs fictícios da auditoria.
const serverStubs = new Function('return (' + source.slice(source.indexOf('function serverStubs'), source.indexOf('let currentResult')).trim() + ')')();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const viewports = [[360, 800, true], [390, 844, true], [412, 915, true], [768, 1024, false], [1366, 900, false]];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = helpers.assetServer(file => file === '/tests/performance-lab-shell.html' ? routeFixture : null);
  const base = await helpers.listen(server);
  const browser = await require('puppeteer-core').launch({ headless: true, protocolTimeout: 180000, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'], executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const files = [];
  try {
    for (const theme of ['light', 'dark']) for (const [width, height, mobile] of viewports) {
      const ctx = await browser.createBrowserContext(), page = await ctx.newPage();
      try {
        await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
        await page.setRequestInterception(true);
        page.on('request', r => { const u = new URL(r.url()); return ['blob:', 'data:'].includes(u.protocol) || u.origin === base ? r.continue() : r.abort(); });
        await page.evaluateOnNewDocument(theme => { window.__fluidez = { server: [] }; try { localStorage.setItem('veconi-theme', theme); localStorage.setItem('adiFestaClientSwipeHint_v1', '1'); } catch {} }, theme);
        await page.goto(base + '/tests/performance-lab-shell.html?visual=inicio&volume=small', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio', { timeout: 30000 });
        await page.evaluate(serverStubs, 120);
        // The fixture has no terminal-payment server; hide its unrelated connection toast.
        await page.addStyleTag({ content: '#toasts{display:none!important}' });
        await page.evaluate(() => Router.ir('clientes'));
        await sleep(1800);
        const name = (kind) => `${kind}-${width}-${theme}.png`;
        await page.screenshot({ path: path.join(OUT, name('clientes')) }); files.push(name('clientes'));
        for (const [id, label, value] of [['bench-c3', 'recebimento-integral', null], ['bench-c3', 'recebimento-parcial', '10'], ['bench-c6', 'recebimento-parcelas-futuras', null]]) {
          await page.evaluate(async id => { await ClientesPage.receive(id); }, id);
          await page.waitForSelector('#modal form [name=valor]', { timeout: 8000 });
          if (value) await page.evaluate(v => { const i = document.querySelector('#modal [name=valor]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, value);
          await page.evaluate(() => document.querySelector('#modal [data-receive-outcome]')?.scrollIntoView({ block: 'center' }));
          await sleep(250);
          await page.screenshot({ path: path.join(OUT, name(label)) }); files.push(name(label));
          await page.evaluate(() => Modais.fechar());
          await sleep(150);
        }
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); server.close(); }
  console.log(JSON.stringify({ out: path.relative(process.cwd(), OUT), files: files.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
