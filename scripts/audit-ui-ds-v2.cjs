#!/usr/bin/env node
'use strict';
// DS v2 visual regression gate (foundation + Início + isolated fixes).
// Local only: serves the real index.html through docs/ui-audit/harness with
// synthetic data, blocks every non-loopback request and never touches Firebase.
//
//   node scripts/audit-ui-ds-v2.cjs [--shots <dir>]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { serve } = require('../docs/ui-audit/harness/harness.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const results = [];
const check = (name, fn) => results.push({ name, fn });

const textFacts = () => {
  const visible = e => { for (let n = e; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(',').map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const blend = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const background = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none' && !/url\(/.test(s.backgroundImage)) return null; const c = parse(s.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (const l of layers.reverse()) base = blend(l, base); return base; };
  const app = document.querySelector('#app');
  const texts = [...app.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && visible(e));
  const small = texts.filter(e => parseFloat(getComputedStyle(e).fontSize) < 12).map(e => e.textContent.trim().slice(0, 30));
  const contrast = [];
  for (const e of texts) {
    const s = getComputedStyle(e), fg = parse(s.color), bg = background(e); if (!fg || !bg) continue;
    const x = lum(blend(fg, bg)), y = lum(bg), ratio = (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
    const size = parseFloat(s.fontSize), large = size >= 24 || (+s.fontWeight >= 700 && size >= 18.66);
    if (ratio < (large ? 3 : 4.5)) contrast.push(`${e.textContent.trim().slice(0, 24)} ${ratio.toFixed(2)}`);
  }
  return { small, contrast, overflow: document.documentElement.scrollWidth - innerWidth, text: app.innerText };
};

async function open(browser, base, width, { stub } = {}) {
  const mobile = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/audit.html');
  await page.evaluate(() => window.__auditReady).catch(() => {});
  await page.waitForTimeout(900);
  await page.evaluate(() => { document.documentElement.classList.remove('auth-pending'); try { SpaceContext.setSpaces?.([{ id: 'audit-space', businessId: 'audit-business', name: 'Loja Centro', type: 'business', capabilities: { sales: true, products: true, goals: true, inventory: true } }]); } catch {} });
  if (stub) await page.evaluate(stub);
  await page.evaluate(() => { dispatchEvent(new Event('firebase-auth-ready')); const g = document.querySelector('#auth-gate'); if (g) g.style.display = 'none'; });
  await page.addStyleTag({ content: '#toasts{display:none!important}' });
  await page.waitForTimeout(700);
  const go = async route => { errors.length = 0; await page.evaluate(r => { location.hash = '#/' + r; scrollTo(0, 0); }, route); await page.waitForTimeout(1200); await page.evaluate(() => document.fonts.ready); };
  return { ctx, page, errors, go };
}

(async () => {
  const server = serve(ROOT);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  try {
    for (const width of [320, 390, 430, 768, 1024, 1440]) check(`Início ${width}px: 12 px floor, WCAG AA, no overflow, every block present`, async () => {
      const s = await open(browser, base, width); try {
        await s.go('inicio');
        const f = await s.page.evaluate(textFacts);
        assert.deepEqual(f.small, [], 'texts under 12 px'); assert.deepEqual(f.contrast, [], 'AA contrast'); assert.equal(f.overflow, 0); assert.deepEqual(s.errors, []);
        const blocks = await s.page.evaluate(mobile => mobile
          ? { goal: !!document.querySelector('.home-goal-card'), metrics: document.querySelectorAll('.home-main-metrics article').length, shortcuts: document.querySelectorAll('.home-secondary-scroller button').length, priorities: document.querySelectorAll('.home-attention button').length, summary: document.querySelectorAll('.home-quick-summary button').length, filter: !!document.querySelector('.mobile-home-dashboard .space-context-bar button') }
          : { goal: !!document.querySelector('.desktop-space-goal'), kpis: document.querySelectorAll('.desktop-kpi').length, panels: document.querySelectorAll('.desktop-panel').length, actions: document.querySelectorAll('.desktop-quick-actions button').length, placeholder: /placeholder/i.test(document.querySelector('#app').innerText) }, width < 768);
        if (width < 768) assert.deepEqual(blocks, { goal: true, metrics: 2, shortcuts: 3, priorities: 4, summary: 2, filter: true });
        else assert.deepEqual(blocks, { goal: true, kpis: 6, panels: 8, actions: 6, placeholder: false });
        if (width >= 768) {
          const axis = await s.page.evaluate(() => [...document.querySelectorAll('.desktop-chart-axis span')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.getBoundingClientRect()));
          assert.ok(axis.length >= 2, 'chart axis labels visible');
          for (let i = 1; i < axis.length; i++) assert.ok(axis[i].left >= axis[i - 1].right, 'chart axis labels overlap');
        }
        if (SHOTS) await s.page.screenshot({ path: path.join(SHOTS, `inicio-${width}.png`), fullPage: true });
      } finally { await s.ctx.close(); }
    });
    check('V231 compact searches keep their height (Vender 46, Produtos 48, Clientes 48)', async () => {
      const s = await open(browser, base, 390); try {
        const heights = {};
        for (const [route, selector] of [['vender', '#product-search'], ['produtos', '.mobile-product-search input'], ['clientes', '#app input[type=search], #app .client-search input, #app input[placeholder*="Buscar"]']]) {
          await s.go(route); heights[route] = await s.page.evaluate(sel => Math.round(document.querySelector(sel).getBoundingClientRect().height), selector);
        }
        assert.deepEqual(heights, { vender: 46, produtos: 48, clientes: 48 });
      } finally { await s.ctx.close(); }
    });
    check('self-hosted Inter is loaded and used', async () => {
      const s = await open(browser, base, 390); try {
        await s.go('inicio');
        const font = await s.page.evaluate(async () => { await document.fonts.load('600 14px "VECONI Inter"'); return { loaded: document.fonts.check('14px "VECONI Inter"') && [...document.fonts].some(f => f.family.replace(/"/g, '') === 'VECONI Inter' && f.status === 'loaded'), family: getComputedStyle(document.querySelector('.home-goal-card')).fontFamily }; });
        assert.equal(font.loaded, true); assert.match(font.family, /^"?VECONI Inter"?/);
      } finally { await s.ctx.close(); }
    });
    for (const [name, route, stub, expected, forbidden] of [
      ['Equipe permission error', 'equipe', `window.TeamService={listMembers:()=>Promise.reject(Object.assign(new Error('Missing or insufficient permissions.'),{name:'FirebaseError',code:'permission-denied'})),listInvites:()=>Promise.resolve([]),watchCurrentMember:()=>()=>{}};`, 'Seu perfil não tem acesso a esta informação.', 'Missing or insufficient'],
      ['Desempenho internal error', 'relatorios', `window.FirebaseCallable=async()=>{throw Object.assign(new Error('internal'),{name:'FirebaseError',code:'functions/internal'});};`, 'Não foi possível completar a consulta. Tente novamente.', 'consulta. internal'],
      ['Catálogo server message is preserved', 'catalogo', `window.FirebaseCallable=async()=>{throw Object.assign(new Error('Ative o catálogo online nas configurações antes de publicar.'),{name:'FirebaseError',code:'functions/failed-precondition'});};`, 'Ative o catálogo online nas configurações antes de publicar.', 'failed-precondition'],
    ]) check(`${name}: merchant-facing text, error still visible`, async () => {
      const s = await open(browser, base, 390, { stub }); try {
        await s.go(route); await s.page.waitForTimeout(500);
        const text = await s.page.evaluate(() => document.querySelector('#app').innerText);
        assert.ok(text.includes(expected), text.slice(0, 300)); assert.ok(!text.includes(forbidden));
      } finally { await s.ctx.close(); }
    });
    check('Financeiro: zero values are neutral, non-zero expenses stay red', async () => {
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      const fixture = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.writeHead(404).end(); r.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(r); });
      await new Promise(r => fixture.listen(0, '127.0.0.1', r));
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      try {
        await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
        await page.goto(`http://127.0.0.1:${fixture.address().port}/tests/financial-module.fixture.html`); await page.waitForTimeout(1200);
        const rows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.financial-home-summary article')].map(a => [a.querySelector('small').textContent, { value: a.querySelector('strong').textContent.replace(/\s+/g, ' ').trim(), color: getComputedStyle(a.querySelector('strong')).color }])));
        assert.equal(rows['Contas a pagar'].value, 'R$ 0,00'); assert.equal(rows['Contas a pagar'].color, 'rgb(23, 34, 53)');
        assert.equal(rows['Resultado do mês'].color, 'rgb(23, 34, 53)');
        assert.notEqual(rows['Faturas do mês'].color, 'rgb(23, 34, 53)');
      } finally { await page.close(); fixture.close(); }
    });
    let failed = 0;
    for (const { name, fn } of results) { try { await fn(); console.log('ok -', name); } catch (error) { failed++; console.log('not ok -', name, '\n ', error.message.split('\n').slice(0, 6).join('\n  ')); } }
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exitCode = failed ? 1 : 0;
  } finally { await browser.close(); server.close(); }
})();
