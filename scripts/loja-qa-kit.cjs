// Kit compartilhado da QA da Loja Online V3: servidor loopback, imagens fictícias
// (SVG gerado, servido por interceptação de https://qa-images.veconi.test/) e abertura
// do painel dentro do shell real da V242. Nenhuma rede externa, autenticação ou escrita real.
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const verifiedPages = process.env.VECONI_VERIFIED_PAGES && path.resolve(process.env.VECONI_VERIFIED_PAGES);
const storefrontFiles = new Set(['/catalogo.html','/css/catalogo.css','/css/online-store.css','/js/loja/store-kit.js',
  '/js/online-store-ui.js','/js/catalogo-publico.js','/js/build-info.js','/js/firebase/catalog-bridge.js']);
let puppeteer; try { puppeteer = require('puppeteer'); } catch { puppeteer = require('puppeteer-core'); }
const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/\r/g, '');
const css = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(x => x[0].replace('href="./', 'href="../')).join('');
const headScripts = [...index.matchAll(/<script src="\.\/js\/veconi-[^"]+"><\/script>/g)].map(x => x[0].replace('src="./', 'src="../')).join('');
const sidebar = index.match(/<aside class="sidebar"[\s\S]*?<\/aside>/)[0];
const topbar = index.match(/<header class="topbar">[\s\S]*?<\/header>/)[0].replace(/src="\.\//g, 'src="../');
const bottomNav = index.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)[0];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.gif': 'image/gif' };

function serve(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file; try { file = path.resolve(root, '.' + decodeURIComponent(url.pathname)); } catch { return res.writeHead(400).end(); }
    if (url.pathname === '/' ) file = path.join(root, 'catalogo.html');
    if (/^\/catalogo\/[^/]+\/?$/.test(url.pathname)) {
      res.writeHead(404, { 'Content-Type': types['.html'] });
      return fs.createReadStream(path.join(root, '404.html')).pipe(res);
    }
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname.endsWith('desktop-shell-content.fixture.html')) {
      const html = fs.readFileSync(file, 'utf8').replace('</head>', css + headScripts + '</head>')
        .replace(/<aside class="sidebar"[\s\S]*?<\/aside>/, sidebar)
        .replace(/<header class="topbar">[\s\S]*?<\/header>/, topbar)
        .replace(/<nav class="bottom-nav"[\s\S]*?<\/nav>/, bottomNav);
      return res.end(html);
    }
    const fromPages=verifiedPages&&storefrontFiles.has(url.pathname)?path.join(verifiedPages,url.pathname.slice(1)):null;
    if(fromPages&&!fs.existsSync(fromPages))return res.writeHead(503).end('Missing verified Pages asset');
    fs.createReadStream(fromPages||file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

/* ---------- Imagens fictícias ---------- */
const PALETTE = { Doces: ['#f6d7c3', '#5b2d1a'], Bolos: ['#f9e3ea', '#b8456b'], Tortas: ['#fff1c9', '#d59a1a'], Biscoitos: ['#f3e2cc', '#8a5a2b'], Bebidas: ['#dcefee', '#1f7a74'], Presentes: ['#e8e3f6', '#6a4fb3'] };
function art(category, variant) {
  const [bg, ink] = PALETTE[category] || ['#e6eef0', '#33505a'], v = Number(variant) || 0, hue = v * 9 - 18;
  const shapes = {
    Doces: `<ellipse cx="200" cy="252" rx="96" ry="22" fill="#000" opacity=".08"/><path d="M118 196h164l-18 58H136z" fill="#fff" opacity=".9"/><path d="M118 196h164" stroke="${ink}" stroke-opacity=".25" stroke-width="3"/><circle cx="200" cy="168" r="62" fill="${ink}"/>${Array.from({ length: 16 }, (_, i) => `<rect x="${150 + (i * 37) % 100}" y="${120 + (i * 23) % 80}" width="9" height="3.5" rx="1.7" fill="${['#ffd166', '#ef476f', '#06d6a0', '#fff'][i % 4]}" transform="rotate(${i * 31} ${154 + (i * 37) % 100} ${122 + (i * 23) % 80})"/>`).join('')}`,
    Bolos: `<ellipse cx="200" cy="262" rx="120" ry="20" fill="#000" opacity=".08"/><rect x="104" y="170" width="192" height="86" rx="14" fill="#fff8f2"/><rect x="104" y="196" width="192" height="16" fill="${ink}" opacity=".85"/><rect x="104" y="226" width="192" height="12" fill="${ink}" opacity=".55"/><path d="M104 184c0-20 12-28 32-28h128c20 0 32 8 32 28 0 12-10 12-14 4-6-12-14 6-22 8s-10-14-20-6-14 18-24 10-12-16-22-8-14 16-24 8-10-14-20-6-12 18-22 8-12-8-16 2-8 4-8-20z" fill="${ink}"/><circle cx="200" cy="140" r="14" fill="#e63946"/><path d="M200 126c4-10 12-14 18-12" stroke="#2a9d8f" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    Tortas: `<ellipse cx="200" cy="258" rx="118" ry="20" fill="#000" opacity=".08"/><path d="M96 238 L300 238 L250 136 Z" fill="#fff6dc"/><path d="M96 238 L300 238 L300 252 L96 252 Z" fill="#c98a3c"/><path d="M250 136 L300 238" stroke="#c98a3c" stroke-width="10" stroke-linecap="round"/><path d="M120 214 L280 214" stroke="${ink}" stroke-width="18" stroke-linecap="round" opacity=".55"/><circle cx="228" cy="176" r="10" fill="${ink}"/><circle cx="196" cy="196" r="8" fill="${ink}" opacity=".8"/>`,
    Biscoitos: `<ellipse cx="200" cy="256" rx="104" ry="18" fill="#000" opacity=".08"/><circle cx="200" cy="170" r="84" fill="#d9a05b"/><circle cx="200" cy="170" r="84" fill="none" stroke="${ink}" stroke-opacity=".25" stroke-width="6"/>${[[170, 140], [232, 150], [190, 196], [244, 202], [150, 186], [212, 118], [170, 228]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="${ink}"/>`).join('')}`,
    Bebidas: `<ellipse cx="200" cy="262" rx="70" ry="14" fill="#000" opacity=".08"/><path d="M148 104h104l-14 154h-76z" fill="#fff" opacity=".85"/><path d="M154 150h92l-10 104h-72z" fill="${ink}" opacity=".75"/><rect x="214" y="70" width="8" height="96" rx="4" fill="#ef476f" transform="rotate(14 218 118)"/><circle cx="182" cy="182" r="9" fill="#fff" opacity=".7"/><circle cx="210" cy="206" r="6" fill="#fff" opacity=".6"/>`,
    Presentes: `<ellipse cx="200" cy="262" rx="110" ry="18" fill="#000" opacity=".08"/><rect x="112" y="138" width="176" height="118" rx="12" fill="${ink}"/><rect x="104" y="116" width="192" height="34" rx="10" fill="${ink}" opacity=".85"/><rect x="188" y="116" width="24" height="140" fill="#ffd166"/><path d="M200 116c-22-34-58-26-44-2 8 14 44 2 44 2zm0 0c22-34 58-26 44-2-8 14-44 2-44 2z" fill="#ffd166"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><defs><radialGradient id="g" cx="35%" cy="25%" r="90%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${bg}"/></radialGradient></defs><rect width="400" height="300" fill="url(#g)"/><g transform="rotate(${hue / 6} 200 170)">${shapes[category] || shapes.Doces}</g></svg>`;
}
function svgFor(pathname) {
  const parts = decodeURIComponent(pathname).split('/').filter(Boolean);
  if (parts[0] === 'logo') return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" rx="56" fill="#c23b6a"/><circle cx="120" cy="120" r="78" fill="none" stroke="#fbe7ee" stroke-width="5" opacity=".55"/><path d="M76 168 112 70h16l36 98h-20l-9-26H105l-9 26zm34-44h30l-15-46z" fill="#fff"/><circle cx="168" cy="72" r="8" fill="#ffd166"/></svg>`;
  if (parts[0] === 'cover') return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600"><rect width="1600" height="600" fill="#f7dbe5"/>${Array.from({ length: 26 }, (_, i) => `<circle cx="${(i * 197) % 1600}" cy="${(i * 113) % 600}" r="${40 + (i * 17) % 90}" fill="${['#f2b8cb', '#fbe7ee', '#e994b2', '#fff'][i % 4]}" opacity=".7"/>`).join('')}<path d="M0 470 C 400 400 800 560 1600 450 L1600 600 L0 600Z" fill="#e7a3bb" opacity=".6"/></svg>`;
  return art(parts[0], (parts[1] || '0').replace('.svg', ''));
}
async function interceptImages(page) {
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.startsWith('https://qa-images.veconi.test/')) return request.respond({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: svgFor(new URL(url).pathname) });
    const stub = Object.keys(FIREBASE_STUBS).find(name => url.startsWith(`https://www.gstatic.com/firebasejs/10.13.2/${name}`));
    if (stub) return request.respond({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: FIREBASE_STUBS[stub] });
    if (!url.startsWith('http://127.0.0.1') && !url.startsWith('data:') && !url.startsWith('blob:')) return request.respond({ status: 204, body: '' });
    request.continue();
  });
}

// Firebase da loja pública simulado: lê documentos de window.__QA_DOCS__ e chama window.__QA_CALL__.
const FIREBASE_STUBS = {
  'firebase-app.js': 'export const initializeApp=()=>({});export const getApp=()=>({});export const getApps=()=>[];',
  'firebase-auth.js': 'export const getAuth=()=>({});export const setPersistence=async()=>true;export const browserLocalPersistence={};',
  'firebase-firestore.js': 'export const initializeFirestore=()=>({});export const memoryLocalCache=()=>({});export const onSnapshot=()=>()=>{};export const doc=(db,...s)=>({path:s.join("/"),id:s[s.length-1]});export const getDoc=async r=>{window.__QA_READS__=(window.__QA_READS__||0)+1;const d=(window.__QA_DOCS__||{})[r.path];if(window.__QA_OFFLINE__)throw Object.assign(Error("offline"),{code:"unavailable"});return {id:r.id,exists:()=>!!d,data:()=>d?structuredClone(d):undefined};};',
  'firebase-functions.js': 'export const getFunctions=()=>({});export const httpsCallable=(f,name)=>async data=>{(window.__QA_CALLS__=window.__QA_CALLS__||[]).push(name);if(!window.__QA_CALL__)throw Object.assign(Error("sem backend"),{code:"functions/unavailable"});return window.__QA_CALL__(name,data);};',
};

async function openStore(browser, base, { width = 390, height = 844, slug = 'doceria-aurora', doc = null, query = '', route, offline = false, fresh = true } = {}) {
  // Cada abertura usa um contexto anônimo: carrinho e dados do cliente não vazam entre cenários.
  const ctx = fresh ? await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext()) : browser;
  const page = await ctx.newPage(), errors = [];
  page.once('close', () => { if (fresh) ctx.close().catch(() => {}); });
  page.on('pageerror', e => errors.push(String(e.stack || e.message).split(/\n/).slice(0, 3).join(' | ')));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|Public catalog load/.test(m.text())) errors.push(m.text()); });
  await interceptImages(page);
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768 });
  await page.evaluateOnNewDocument((slug, doc, offline) => {
    let published = doc; try { published = published || JSON.parse(localStorage.getItem(`loja-qa-public:${slug}`) || 'null'); } catch {}
    window.__QA_DOCS__ = published ? { [`publicCatalogSlugs/${slug}`]: { catalogToken: published.catalogToken, businessId: published.businessId }, [`publicCatalogs/${published.catalogToken}`]: published } : {};
    window.__QA_OFFLINE__ = offline;
    window.__QA_OPENED__ = [];
    const open = window.open; window.open = (...a) => { window.__QA_OPENED__.push(String(a[0])); return open.apply(window, a); };
  }, slug, doc, offline);
  await page.goto(base + (route || `/catalogo.html?loja=${slug}${query}`), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sf, .sf-state', { timeout: 20000 });
  await sleep(400);
  return { page, errors };
}

async function launch() { return puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--font-render-hinting=none', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] }); }

async function openAdmin(browser, base, { width = 390, height = 844, theme = 'light', scenario = 'published', count = 24, latency = 120, select } = {}) {
  const fresh = typeof browser.createBrowserContext === 'function'
    ? await browser.createBrowserContext() : null;
  const page = await (fresh || browser).newPage(), errors = [];
  if (fresh) page.once('close', () => fresh.close().catch(() => {}));
  page.on('pageerror', e => errors.push(String(e.stack || e.message).split(/\n/).slice(0, 3).join(' | ')));
  // "[BOOT] app mount failed" (mountHome) já acontece no fixture do shell sem este módulo: ignorado.
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|404|\[BOOT\] app mount failed/.test(m.text())) errors.push(m.text()); });
  await interceptImages(page);
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(theme => { try { localStorage.setItem('veconi-theme', theme); } catch {} }, theme);
  await page.goto(base + '/tests/desktop-shell-content.fixture.html?visual=inicio');
  await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio', { timeout: 20000 });
  for (const src of ['/functions/src/shared/online-store.js', '/js/loja/store-kit.js']) await page.addScriptTag({ url: base + src });
  await page.evaluate(qa => { window.__LOJA_QA__ = qa; }, { scenario, count, latency, ...(select != null ? { select } : {}) });
  await page.addScriptTag({ url: base + '/tests/fixtures/online-store-v3-backend.js' });
  await page.addScriptTag({ url: base + '/js/online-store-ui.js' });
  await page.evaluate(theme => {
    const spaces = window.__lojaQASpaces;
    window.BusinessContext = { ...window.BusinessContext, getCurrentBusinessId: () => 'loja-qa-business', get: () => ({ businessId: 'loja-qa-business', role: 'owner', status: 'active', spaceAccess: 'all', permissions: ['*'] }) };
    window.FirebaseSession = { ...window.FirebaseSession, businessId: 'loja-qa-business', user: { uid: 'loja-qa-owner' } };
    window.SpaceContext = { ...window.SpaceContext, salesSpaces: () => spaces, salesId: () => spaces[0].id, list: () => spaces };
    DB.alterar(d => { d.produtos = window.__lojaQA.raw.map(p => ({ ...p })); d.variacoesProdutos = window.__lojaQA.variants.map(v => ({ ...v })); });
    window.OnlineStorePreviewUrl = '/catalogo.html?preview=1'; window.OnlineStoreAssetBase = '/';
    window.VeconiFluxo?.theme?.set?.(theme); document.documentElement.dataset.theme = theme;
    document.querySelector('#modal').innerHTML = '';
    Router.ir('catalogo');
  }, theme);
  await page.waitForSelector('#store-v2 .lo-head, #store-v2 .lo-create, #store-v2 .lo-fatal', { timeout: 20000 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  return { page, errors };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { root, serve, launch, openAdmin, openStore, interceptImages, svgFor, sleep };
