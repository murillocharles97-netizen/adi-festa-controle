// VECONI Fluxo V1 (proposta 1B: geometria em camadas) — auditoria visual isolada da tela
// Início (claro/escuro, 5 larguras).
// Servidor loopback com a fixture do shell; dados 100% fictícios; nenhuma rede externa,
// nenhuma autenticação e nenhuma escrita em produção.
// Uso: node scripts/audit-veconi-fluxo-v1.cjs [pasta-de-saida] [--before]
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
let puppeteer; try { puppeteer = require('puppeteer'); } catch { puppeteer = require('puppeteer-core'); }
const root = process.cwd(), args = process.argv.slice(2), before = args.includes('--before');
const out = path.resolve(args.find(a => !a.startsWith('--')) || 'artifacts/veconi-fluxo-v1'); fs.mkdirSync(out, { recursive: true });
const index = fs.readFileSync('index.html', 'utf8').replace(/\r/g, '');
const css = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(x => x[0].replace('href="./', 'href="../')).join('');
const headScripts = [...index.matchAll(/<script src="\.\/js\/veconi-[^"]+"><\/script>/g)].map(x => x[0].replace('src="./', 'src="../')).join('');
const sidebar = index.match(/<aside class="sidebar"[\s\S]*?<\/aside>/)[0];
const topbar = index.match(/<header class="topbar">[\s\S]*?<\/header>/)[0].replace(/src="\.\//g, 'src="../');
const bottomNav = index.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)[0];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'), file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  if (url.pathname.endsWith('desktop-shell-content.fixture.html')) {
    let html = fs.readFileSync(file, 'utf8');
    html = html.replace('</head>', css + headScripts + '</head>')
      .replace(/<aside class="sidebar"[\s\S]*?<\/aside>/, sidebar)
      .replace(/<header class="topbar">[\s\S]*?<\/header>/, topbar)
      .replace(/<nav class="bottom-nav"[\s\S]*?<\/nav>/, bottomNav);
    return res.end(html);
  }
  fs.createReadStream(file).pipe(res);
});
const WIDTHS = [360, 390, 768, 1024, 1440];
const THEMES = ['light', 'dark'];

async function seed(page, scenario) {
  await page.evaluate(async scenario => {
    SpaceContext.setSpaces([
      { id: 'qa-a', businessId: 'desktop-shell-fixture', name: 'Espaço Demonstração', type: 'business', capabilities: { sales: true, products: true, goals: true } },
      { id: 'qa-b', businessId: 'desktop-shell-fixture', name: 'Espaço Teste', type: 'business', capabilities: { sales: true, products: true, goals: true } },
    ]);
    const day = (offset, hour = 11) => { const d = new Date(); d.setDate(d.getDate() - offset); d.setHours(hour, 15, 0, 0); return d.toISOString(); };
    DB.alterar(d => {
      d.config.dashboard = { dailySalesGoal: 900, dailySalesGoalsBySpaceId: { 'qa-a': 400 } };
      d.clientes = [
        { id: 'qa-c1', nome: 'Cliente QA 1', ativo: true, saldo: -60, totalComprado: 320, quantidadeVendas: 4, ultimaCompra: day(1), criadoEm: day(40) },
        { id: 'qa-c2', nome: 'Cliente QA 2', ativo: true, saldo: 0, totalComprado: 180, quantidadeVendas: 3, ultimaCompra: day(0), criadoEm: day(3) },
      ];
      d.produtos = [{ id: 'qa-p1', nome: 'Item QA', ativo: true, estoqueAtual: 0, estoqueMinimo: 2, preco: 20 }, { id: 'qa-p2', nome: 'Item QA 2', ativo: true, estoqueAtual: 1, estoqueMinimo: 3, preco: 35 }];
      if (scenario === 'empty') { d.vendas = []; d.pagamentos = []; d.config.dashboard = { dailySalesGoal: 0, dailySalesGoalsBySpaceId: {} }; return; }
      const values = [[6, 120], [5, 80], [5, 45], [4, 210], [3, 60], [2, 150], [2, 95], [1, 40], [0, 130], [0, 125]];
      d.vendas = values.map(([offset, value], n) => ({ id: 'qa-sale-' + n, spaceId: 'qa-a', clienteId: n % 2 ? 'qa-c1' : 'qa-c2', clienteNome: n % 2 ? 'Cliente QA 1' : 'Cliente QA 2', data: day(offset, 9 + n), status: n === 7 ? 'fiado' : 'pago', valorFinal: value, lucro: Math.round(value * .35), custoTotal: Math.round(value * .65), itens: [{ produtoId: 'qa-p1', nome: 'Item QA', quantidade: 1 + (n % 3), subtotalFinal: value }] }));
      d.vendas.push(...Array.from({ length: 12 }, (_, n) => ({ id: 'qa-legacy-' + n, data: '2024-01-01T12:00:00Z', status: 'pago', valorFinal: 10, itens: [] })));
      d.pagamentos = [{ id: 'qa-pay-1', clienteId: 'qa-c2', spaceId: 'qa-a', data: day(0, 10), valor: 130 }, { id: 'qa-pay-2', clienteId: 'qa-c1', spaceId: 'qa-a', data: day(2), valor: 60 }];
    });
    await DB.flush();
    SpaceContext.selectHome(scenario === 'all' ? 'all_spaces' : 'qa-a');
  }, scenario);
}
async function openHome(page) {
  await page.evaluate(() => { document.querySelector('#modal').innerHTML = ''; window.AppPageRuntime?.mount ? AppPageRuntime.mount('inicio') : Router.ir('inicio'); if (window.MobileHome?.isMobile()) MobileHome.refresh(); });
  try { await page.waitForSelector('.mobile-home-dashboard, [data-desktop-dashboard]', { timeout: 8000 }); }
  catch (error) { console.error(await page.evaluate(() => ({ route: Router.atual(), app: document.querySelector('#app').textContent.slice(0, 300), diag: JSON.stringify(window.AppBootDiagnostics?.snapshot?.() || window.__desktopErrors || '').slice(0, 800) }))); throw error; }
  await page.evaluate(() => new Promise(r => setTimeout(r, 1400)));
}
async function boot(browser, base, width, theme, { reducedMotion = false, scenario = 'data' } = {}) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && process.env.VF_DEBUG) Promise.all(m.args().map(a => a.evaluate(x => x && (x.stack || x.message) ? (x.stack || x.message) : JSON.stringify(x)).catch(() => '?'))).then(v => console.error('[console]', m.text().slice(0, 60), v.join(' | ').slice(0, 600))); });
  await page.setRequestInterception(true);
  page.on('request', r => new URL(r.url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  const mobile = width < 768;
  await page.setViewport({ width, height: mobile ? 800 : 900, isMobile: mobile, hasTouch: mobile });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }]);
  await page.evaluateOnNewDocument(t => { try { localStorage.setItem('veconi-theme', t); } catch {} window.Consignments = { mountHome() {}, mount() {} }; }, theme);
  await page.goto(base + '/tests/desktop-shell-content.fixture.html?visual=inicio');
  await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio');
  await page.addScriptTag({ url: base + '/js/spaces.js' });
  await seed(page, scenario);
  await openHome(page);
  return { page, errors };
}
async function main() {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const report = { mode: before ? 'before' : 'after', shots: [], checks: [] };
  try {
    for (const theme of before ? ['light'] : THEMES) for (const width of WIDTHS) {
      const { page, errors } = await boot(browser, base, width, theme);
      const name = `${before ? 'antes' : 'depois'}-${theme}-${width}`;
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(out, name + '-dobra.png') });
      { const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight)); const vp = page.viewport(); await page.setViewport({ ...vp, height: h }); await page.evaluate(() => new Promise(r => setTimeout(r, 1600))); await page.screenshot({ path: path.join(out, name + '-completa.png') }); await page.setViewport(vp); }
      const layout = await page.evaluate(() => {
        const home = document.querySelector('.mobile-home-dashboard, [data-desktop-dashboard]');
        const text = home.textContent;
        const toggle = document.querySelector('[data-theme-toggle]');
        const tr = toggle?.getBoundingClientRect();
        const kpiTop = document.querySelector('.desktop-kpis, .home-main-metrics')?.getBoundingClientRect().top;
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          theme: document.documentElement.dataset.theme || null,
          toggleVisible: Boolean(tr && tr.width >= 40 && tr.height >= 40 && tr.top >= 0 && tr.top < 120),
          kpisInFirstFold: kpiTop !== undefined && kpiTop < innerHeight * .8,
          legacyNotice: /antigas sem espaço/.test(text),
          geoArt: Boolean(document.querySelector('.vf-hero .vf-geo .vf-geo-v')) && !document.querySelector('.vf-flow'),
          dateOneLine: (() => { const d = document.querySelector('#date'); return !d || (d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().height < 22); })(),
          prioritiesTop: Math.round(document.querySelector('.home-attention')?.getBoundingClientRect().top || 0),
        };
      });
      assert.equal(layout.overflow, false, `${name}: rolagem horizontal`);
      if (!before) {
        assert.equal(layout.theme, theme, `${name}: tema aplicado`);
        assert.ok(layout.toggleVisible, `${name}: alternador visível com 40px+`);
        assert.ok(layout.kpisInFirstFold, `${name}: indicadores na primeira dobra`);
        assert.ok(layout.geoArt, `${name}: assinatura geométrica presente (sem linhas do fluxo 1A)`);
        if (width < 768) {
          assert.ok(layout.dateOneLine, `${name}: data do cabeçalho numa linha, sem corte`);
          assert.ok(layout.prioritiesTop > 0 && layout.prioritiesTop < 800 * .8, `${name}: prioridades visíveis na primeira tela`);
        }
      }
      if (width >= 768) assert.ok(layout.legacyNotice, `${name}: aviso de vendas antigas preservado`);
      assert.deepEqual(errors, [], `${name}: erros de página`);
      report.shots.push({ name, ...layout });
      await page.close();
    }
    if (!before) {
      // Estado vazio: sem curva inventada nem meta fictícia.
      for (const width of [390, 1440]) for (const theme of THEMES) {
        const { page, errors } = await boot(browser, base, width, theme, { scenario: 'empty' });
        const name = `depois-vazio-${theme}-${width}`;
        await page.evaluate(() => new Promise(r => setTimeout(r, 2200)));
        await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
        if (width >= 768) {
          const empty = await page.evaluate(() => ({ state: Boolean(document.querySelector('[data-chart-empty]')), line: Boolean(document.querySelector('.desktop-sales-chart .chart-line')) }));
          assert.ok(empty.state && !empty.line, `${name}: estado vazio sem curva`);
        }
        assert.deepEqual(errors, []);
        report.shots.push({ name });
        await page.close();
      }
      // Preferência persistente + respeito ao sistema.
      {
        const page = await browser.newPage();
        await page.setRequestInterception(true); page.on('request', r => new URL(r.url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
        await page.setViewport({ width: 1440, height: 900 });
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await page.goto(base + '/tests/desktop-shell-content.fixture.html?visual=inicio');
        await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio');
        const system = await page.evaluate(() => { localStorage.removeItem('veconi-theme'); VeconiFluxo.theme.apply(); return document.documentElement.dataset.theme; });
        assert.equal(system, 'dark', 'segue o sistema sem escolha');
        await page.click('[data-theme-toggle]');
        const chosen = await page.evaluate(() => ({ attr: document.documentElement.dataset.theme, stored: localStorage.getItem('veconi-theme'), pressed: document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed'), meta: document.querySelector('meta[name="theme-color"]')?.content }));
        assert.equal(chosen.attr, 'light'); assert.equal(chosen.stored, 'light');
        await page.reload(); await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio');
        const persisted = await page.evaluate(() => document.documentElement.dataset.theme);
        assert.equal(persisted, 'light', 'preferência persiste após recarregar');
        // Teclado: o alternador recebe foco visível.
        await page.focus('[data-theme-toggle]');
        const focus = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' || s.boxShadow !== 'none'; });
        assert.ok(focus, 'foco de teclado visível no alternador');
        report.checks.push({ systemDefault: system, afterClick: chosen, persisted, focusVisible: focus });
        await page.close();
      }
      // Movimento reduzido: nenhuma animação em execução.
      {
        const { page } = await boot(browser, base, 1440, 'dark', { reducedMotion: true });
        const running = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length);
        assert.equal(running, 0, 'prefers-reduced-motion sem animações');
        report.checks.push({ reducedMotionRunningAnimations: running });
        await page.close();
      }
      // Registro das animações: quadros da entrada (desktop escuro e mobile claro).
      for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) {
        const { page } = await boot(browser, base, width, theme);
        // Reabre a tela com a entrada liberada de novo (só na auditoria), para registrar os quadros.
        // Espera o temporizador da primeira entrada terminar antes de liberar.
        await page.waitForFunction(() => document.documentElement.classList.contains('vf-entered'), { timeout: 5000 });
        await page.evaluate(() => { document.querySelector('#app').innerHTML = ''; document.documentElement.classList.remove('vf-entered'); });
        await page.evaluate(() => { window.AppPageRuntime?.mount ? AppPageRuntime.mount('inicio') : Router.ir('inicio'); if (window.MobileHome?.isMobile()) MobileHome.refresh(); });
        for (const ms of [60, 260, 520, 1100]) {
          await page.evaluate(t => new Promise(r => setTimeout(r, t)), ms === 60 ? 60 : ms - [60, 260, 520, 1100][[60, 260, 520, 1100].indexOf(ms) - 1]);
          await page.screenshot({ path: path.join(out, `animacao-${theme}-${width}-${String(ms).padStart(4, '0')}ms.png`) });
        }
        // Depois da entrada, nada continua se mexendo (sem animação infinita).
        await page.evaluate(() => new Promise(r => setTimeout(r, 1600)));
        const still = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length);
        assert.equal(still, 0, `${width}/${theme}: animações ainda rodando após a entrada`);
        report.checks.push({ width, theme, runningAfterEntrance: still });
        // Tooltip do gráfico (desktop) por teclado.
        if (width >= 768) {
          const point = await page.$('[data-chart-point]');
          if (point) { await page.evaluate(() => document.querySelector('[data-chart-point][tabindex="0"]').focus()); await page.evaluate(() => new Promise(r => setTimeout(r, 250))); await page.screenshot({ path: path.join(out, `tooltip-${theme}-${width}.png`) }); const tip = await page.$eval('[data-chart-tooltip]', n => !n.hidden && n.textContent.trim().length > 0); assert.ok(tip, 'tooltip acessível por teclado'); report.checks.push({ chartTooltipKeyboard: tip }); }
        }
        await page.close();
      }
      // Contraste dos textos-chave nos dois temas.
      for (const theme of THEMES) for (const width of [1440, 390]) {
        const { page } = await boot(browser, base, width, theme);
        const ratios = await page.evaluate(() => {
          const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
          const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
          // Fundos em gradiente: usa o tom mais claro (pior caso para texto claro).
          const bgOf = el => { if (el.closest('.sidebar')) return [8, 28, 35]; if (el.closest('.home-goal-card')) return document.documentElement.dataset.theme === 'dark' ? [18, 58, 63] : [16, 52, 59]; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > .9)) return c.slice(0, 3); } return [255, 255, 255]; };
          return [...document.querySelectorAll('.desktop-kpi strong, .desktop-kpi small, .desktop-kpi em, .desktop-finance small, .desktop-finance b, .desktop-panel-head h3, .vf-hero h2, .vf-hero p, .desktop-nav-section, #nav a, .home-goal-card header span, .home-goal-card header strong, .goal-values strong, .goal-values span, .goal-footer p, .goal-footer button, .home-main-metrics small, .home-main-metrics strong, .home-attention b')].filter(n => n.offsetParent && n.textContent.trim()).map(n => {
            const a = lum(parse(getComputedStyle(n).color).slice(0, 3)), b = lum(bgOf(n));
            return { sel: n.className || n.tagName, text: n.textContent.trim().slice(0, 24), ratio: +((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2) };
          });
        });
        const low = ratios.filter(r => r.ratio < 4.5);
        report.checks.push({ theme, width, contrastChecked: ratios.length, below45: low });
        assert.deepEqual(low, [], `${theme}/${width}: contraste abaixo de 4,5:1`);
        await page.close();
      }
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, out, shots: report.shots.length, checks: report.checks }, null, 2));
  } finally { await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
