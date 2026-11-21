// VECONI Visual 1C — capturas e auditoria de Vender, Clientes, Produtos e Financeiro (claro/escuro).
// Servidor loopback com fixtures locais; dados 100% fictícios; nenhuma rede externa,
// nenhuma autenticação e nenhuma escrita em produção.
// Uso: node scripts/audit-veconi-telas-1c.cjs <pasta-de-saida> [--before] [--no-assert]
//   VF_ROUTES=vender,clientes,produtos,financeiro  VF_W=390,1440  VF_T=light,dark  VF_MODALS=0  VF_EMPTY=1
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
let puppeteer; try { puppeteer = require('puppeteer'); } catch { puppeteer = require('puppeteer-core'); }
const root = process.cwd(), args = process.argv.slice(2), before = args.includes('--before'), strict = !before && !args.includes('--no-assert');
const out = path.resolve(args.find(a => !a.startsWith('--')) || 'artifacts/veconi-telas-1c'); fs.mkdirSync(out, { recursive: true });
const index = fs.readFileSync('index.html', 'utf8').replace(/\r/g, '');
const css = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(x => x[0].replace('href="./', 'href="../')).join('');
const headScripts = [...index.matchAll(/<script src="\.\/js\/veconi-[^"]+"><\/script>/g)].map(x => x[0].replace('src="./', 'src="../')).join('');
const sidebar = index.match(/<aside class="sidebar"[\s\S]*?<\/aside>/)[0];
const topbar = index.match(/<header class="topbar">[\s\S]*?<\/header>/)[0].replace(/src="\.\//g, 'src="../');
const bottomNav = index.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)[0];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'), file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  if (url.pathname.endsWith('desktop-shell-content.fixture.html')) {
    const html = fs.readFileSync(file, 'utf8').replace('</head>', css + headScripts + '</head>')
      .replace(/<aside class="sidebar"[\s\S]*?<\/aside>/, sidebar)
      .replace(/<header class="topbar">[\s\S]*?<\/header>/, topbar)
      .replace(/<nav class="bottom-nav"[\s\S]*?<\/nav>/, bottomNav);
    return res.end(html);
  }
  if (url.pathname.endsWith('financial-module.fixture.html')) {
    // Mesmo CSS do app + tema; nomes neutros nos espaços (sem segmento específico nas capturas).
    let html = fs.readFileSync(file, 'utf8')
      .replace("name:'Táxi',type:'other',icon:'car'", "name:'Projetos',type:'other',icon:'folder'")
      .replace('PrimeLine 3D', 'Espaço Teste').replace(/Adi Festa/g, 'Empresa QA')
      .replace('<style>', css + headScripts + '<style>')
      .replace(/<aside class="fixture-sidebar">[\s\S]*?<\/aside>/, sidebar)
      .replace('<div class="fixture-shell">', '<div class="shell">')
      .replace(/<header class="topbar fixture-topbar">[\s\S]*?<\/header>/, topbar.replace('>Início<', '>Financeiro<'))
      .replace(/<nav class="fixture-bottom">[\s\S]*?<\/nav>/, bottomNav)
      .replace("app.innerHTML=FinanceiroUI.render();", "app.dataset.route='financeiro';document.querySelectorAll('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route==='financeiro'));app.innerHTML=FinanceiroUI.render();");
    return res.end(html);
  }
  fs.createReadStream(file).pipe(res);
});
const ROUTES = (process.env.VF_ROUTES || 'vender,clientes,produtos,financeiro').split(',');
const WIDTHS = (process.env.VF_W || '390,1440').split(',').map(Number);
const THEMES = (process.env.VF_T || 'light,dark').split(',');
const MODALS = process.env.VF_MODALS !== '0';
const EMPTY = process.env.VF_EMPTY === '1'; // VF_EMPTY=1: sem clientes, produtos e vendas (estados vazios)

async function seed(page) {
  await page.evaluate(async empty => {
    SpaceContext.setSpaces([
      { id: 'qa-a', businessId: 'desktop-shell-fixture', name: 'Espaço Demonstração', type: 'business', capabilities: { sales: true, products: true, goals: true } },
      { id: 'qa-b', businessId: 'desktop-shell-fixture', name: 'Espaço Teste', type: 'business', capabilities: { sales: true, products: true, goals: true } },
    ]);
    const day = (offset, hour = 11) => { const d = new Date(); d.setDate(d.getDate() - offset); d.setHours(hour, 15, 0, 0); return d.toISOString(); };
    DB.alterar(d => {
      d.clientes = Array.from({ length: 6 }, (_, n) => ({ id: 'qa-c' + n, nome: 'Cliente QA ' + (n + 1), telefone: '1199990000' + n, ativo: true, saldo: n === 1 ? -60 : n === 4 ? 25 : 0, totalComprado: 120 + n * 45, quantidadeVendas: 1 + n, ultimaCompra: day(n), criadoEm: day(30 + n) }));
      d.produtos = Array.from({ length: 8 }, (_, n) => ({ id: 'qa-p' + n, nome: 'Item QA ' + (n + 1), categoria: n % 2 ? 'Categoria A' : 'Categoria B', ativo: true, estoqueAtual: [0, 1, 6, 12, 3, 20, 2, 9][n], estoqueMinimo: 3, preco: 15 + n * 7.5, custo: 6 + n * 3, codigoBarras: '789000000000' + n }));
      d.vendas = [[0, 130], [0, 125], [1, 40], [2, 150]].map(([offset, value], n) => ({ id: 'qa-sale-' + n, spaceId: 'qa-a', clienteId: 'qa-c' + n, clienteNome: 'Cliente QA ' + (n + 1), data: day(offset, 9 + n), status: n === 2 ? 'fiado' : 'pago', valorFinal: value, lucro: Math.round(value * .35), custoTotal: Math.round(value * .65), itens: [{ produtoId: 'qa-p2', nome: 'Item QA 3', quantidade: 1 + n, subtotalFinal: value }] }));
      d.pagamentos = [{ id: 'qa-pay-1', clienteId: 'qa-c0', spaceId: 'qa-a', data: day(0, 10), valor: 130 }];
      if (empty) { d.clientes = []; d.produtos = []; d.vendas = []; d.pagamentos = []; } // estados vazios
    });
    await DB.flush();
    SpaceContext.selectHome('qa-a');
  }, EMPTY);
}
async function preparePage(browser, width, theme, reducedMotion = false) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', r => new URL(r.url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  const mobile = width < 768;
  await page.setViewport({ width, height: mobile ? 800 : 900, isMobile: mobile, hasTouch: mobile });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }]);
  await page.evaluateOnNewDocument(t => { try { localStorage.setItem('veconi-theme', t); } catch {} window.Consignments = { mountHome() {}, mount() {} }; }, theme);
  return { page, errors };
}
async function openRoute(browser, base, route, width, theme) {
  const { page, errors } = await preparePage(browser, width, theme);
  if (route === 'financeiro') {
    await page.goto(base + '/tests/financial-module.fixture.html');
    await page.waitForFunction(() => window.__financialReady === true, { timeout: 15000 });
  } else {
    await page.goto(base + '/tests/desktop-shell-content.fixture.html?visual=inicio');
    await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio');
    await page.addScriptTag({ url: base + '/js/spaces.js' });
    // Módulos que o app carrega e a fixture do shell não: necessários para abrir Clientes.
    for (const src of ['/functions/src/shared/permission-policy.js', '/functions/src/shared/installment-plan.js', '/js/installment-credit.js']) await page.addScriptTag({ url: base + src });
    await seed(page);
    await page.evaluate(r => { document.querySelector('#modal').innerHTML = ''; Router.ir(r); }, route);
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    await page.evaluate(r => { if (r === 'vender' && innerWidth < 768 && !document.querySelector('.pos-page, .checkout-mobile, [data-checkout]')) { document.querySelector('#app').innerHTML = Checkout.view(); Checkout.bindDesktop(); } }, route);
  }
  await page.evaluate(() => new Promise(r => setTimeout(r, 900)));
  return { page, errors };
}

// Ações que abrem um modal representativo de cada área (somente interface; nada é salvo).
const MODAL_OPENERS = {
  vender: ['.pos-product[data-add]', '[data-add]'],
  clientes: ['[data-new-client]', '[data-action="new-client"]', 'button[data-client-new]', '#novo-cliente', '.clients-new-button'],
  produtos: ['[data-new-product]', '[data-action="new-product"]', '#novo-produto', '.products-new-button'],
};
async function openModal(page, route, shot) {
  if (route === 'vender') {
    await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.querySelector('.pos-product.stock-available [data-add], .pos-product.stock-disponivel .pos-product-hit')?.click(); await wait(300);
      document.querySelector('.desktop-cart-fab, .pos-bag')?.click(); await wait(600);
    });
    await shot('-carrinho');
    // Guarda de regressão: no passo do carrinho, os campos de pagamento ficam ocultos.
    const cartStep = await page.evaluate(() => {
      const visible = n => Boolean(n && n.offsetParent && getComputedStyle(n).display !== 'none');
      return { fieldsVisible: visible(document.querySelector('.desktop-checkout-fields')), finishVisible: visible(document.querySelector('.desktop-checkout-fields #finish-sale')), desktop: innerWidth >= 768 };
    });
    const via = await page.evaluate(async () => {
      const button = [...document.querySelectorAll('button')].find(n => n.offsetParent && /continuar venda|concluir venda/i.test(n.textContent));
      button?.click(); await new Promise(r => setTimeout(r, 700));
      return button?.textContent.trim().replace(/\s+/g, ' ').slice(0, 30);
    });
    return { opened: Boolean(via), via, cartStepLeak: cartStep.desktop && (cartStep.fieldsVisible || cartStep.finishVisible) };
  }
  return page.evaluate(async (route, openers) => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const byText = (re) => [...document.querySelectorAll('#app button, #app a, .bottom-nav button')].find(b => b.offsetParent && re.test(b.textContent.trim()));
    if (route === 'vender') {
      document.querySelector('.pos-product[data-add], [data-add]')?.click(); await wait(250);
      document.querySelector('.pos-product[data-add], [data-add]')?.click(); await wait(250);
      const finish = byText(/^(finalizar|cobrar|continuar|ir para pagamento)/i); finish?.click(); await wait(500);
      return { opened: Boolean(document.querySelector('#modal > *, .checkout-sheet, .pos-payment')), via: finish?.textContent.trim().slice(0, 30) || 'carrinho' };
    }
    if (route === 'financeiro') {
      window.FinanceiroUI.openEntryForm('out'); await wait(500);
      document.querySelector('#modal [data-action-space]')?.click(); await wait(700);
      return { opened: /Passo 1/.test(document.querySelector('#modal')?.textContent || ''), via: 'Nova despesa' };
    }
    let el = openers[route].map(s => document.querySelector(s)).find(n => n && n.offsetParent);
    if (!el) el = byText(route === 'clientes' ? /novo cliente|adicionar cliente|cadastrar cliente/i : route === 'produtos' ? /novo produto|adicionar produto|cadastrar produto/i : /novo lançamento|nova despesa|lançar|adicionar/i);
    if (!el) return { opened: false };
    el.click(); await wait(600);
    return { opened: Boolean(document.querySelector('#modal > *, .modal-bg, .financial-modal-bg')), via: el.textContent.trim().slice(0, 30) };
  }, route, MODAL_OPENERS);
}

// Varre superfícies claras deixadas no tema escuro e textos com contraste baixo.
async function inspect(page, theme) {
  return page.evaluate(theme => {
    // color-mix() devolve color(srgb r g b) com canais de 0 a 1.
    const parse = c => { const n = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? [n[0] * 255, n[1] * 255, n[2] * 255, ...(n.length > 3 ? [n[3]] : [])] : n; };
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const opaqueBg = n => { const c = parse(getComputedStyle(n).backgroundColor); return (c.length === 3 || (c.length === 4 && c[3] > .85)) ? c.slice(0, 3) : null; };
    const bgOf = el => { for (let n = el; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.backgroundImage !== 'none' && !opaqueBg(n)) return null; const c = opaqueBg(n); if (c) return c; } return parse(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
    const sig = n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + [...n.classList].slice(0, 3).map(c => '.' + c).join('');
    const scope = [...document.querySelectorAll('#app *, #modal *, .modal-bg *, .financial-modal-bg *')].filter(n => n.offsetParent || getComputedStyle(n).position === 'fixed');
    const light = new Map();
    if (theme === 'dark') for (const n of scope) {
      const c = opaqueBg(n); if (!c || lum(c) < .6) continue; if (n.closest('.vac-card')) continue; // cartões de banco: cores da instituição nos dois temas
      const r = n.getBoundingClientRect(); if (r.width * r.height < 900) continue;
      const k = sig(n); light.set(k, (light.get(k) || 0) + 1);
    }
    const low = new Map();
    for (const n of scope) {
      if (!n.childNodes.length || ![...n.childNodes].some(t => t.nodeType === 3 && t.textContent.trim())) continue;
      const s = getComputedStyle(n); if (s.visibility === 'hidden' || +s.opacity < .5) continue; if (n.closest(':disabled, [aria-disabled="true"]')) continue; // controles desativados não entram no critério de contraste
      const fg = parse(s.color); if (fg.length === 4 && fg[3] < .5) continue;
      const bg = bgOf(n); if (!bg) continue;
      const a = lum(fg.slice(0, 3)), b = lum(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const large = parseFloat(s.fontSize) >= 18.6 || (parseFloat(s.fontSize) >= 14 && +s.fontWeight >= 700);
      if (ratio < (large ? 3 : 4.5)) { const k = sig(n) + ' «' + n.textContent.trim().slice(0, 18) + '»'; if (!low.has(k)) low.set(k, +ratio.toFixed(2)); }
    }
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      lightSurfaces: [...light].sort((a, b) => b[1] - a[1]).slice(0, 40),
      lowContrast: [...low].slice(0, 40),
    };
  }, theme);
}

async function main() {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const report = { mode: before ? 'before' : 'after', shots: [] };
  const failures = [];
  try {
    for (const route of ROUTES) for (const theme of THEMES) for (const width of WIDTHS) {
      const { page, errors } = await openRoute(browser, base, route, width, theme);
      const name = `${before ? 'antes' : 'depois'}-${route}${EMPTY ? '-vazio' : ''}-${theme}-${width}`;
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(out, name + '-dobra.png') });
      { const h = Math.min(6000, await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight))); const vp = page.viewport(); await page.setViewport({ ...vp, height: h }); await page.evaluate(() => new Promise(r => setTimeout(r, 700))); await page.screenshot({ path: path.join(out, name + '-completa.png') }); await page.setViewport(vp); }
      const pageCheck = await inspect(page, theme);
      let modal = null;
      if (MODALS) {
        const opened = await openModal(page, route, async suffix => { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(out, name + suffix + '.png') }); });
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(out, name + '-modal.png') });
        modal = { ...opened, ...(await inspect(page, theme)) };
      }
      const entry = { name, route, theme, width, page: pageCheck, modal, errors };
      report.shots.push(entry);
      if (strict) {
        if (pageCheck.overflow) failures.push(`${name}: rolagem horizontal`);
        if (theme === 'dark' && pageCheck.lightSurfaces.length) failures.push(`${name}: superfícies claras no escuro ${JSON.stringify(pageCheck.lightSurfaces.slice(0, 6))}`);
        if (pageCheck.lowContrast.length) failures.push(`${name}: contraste baixo ${JSON.stringify(pageCheck.lowContrast.slice(0, 6))}`);
        if (modal?.opened && theme === 'dark' && modal.lightSurfaces.length) failures.push(`${name}: modal com superfícies claras ${JSON.stringify(modal.lightSurfaces.slice(0, 6))}`);
        if (modal?.opened && modal.lowContrast.length) failures.push(`${name}: modal com contraste baixo ${JSON.stringify(modal.lowContrast.slice(0, 6))}`);
        if (errors.length) failures.push(`${name}: erros de página ${errors.slice(0, 2).join(' | ')}`);
        if (modal?.cartStepLeak) failures.push(`${name}: campos de pagamento visíveis no passo do carrinho`);
      }
      console.log(name, JSON.stringify({ overflow: pageCheck.overflow, light: pageCheck.lightSurfaces.length, low: pageCheck.lowContrast.length, modal: modal && { opened: modal.opened, via: modal.via, light: modal.lightSurfaces.length, low: modal.lowContrast.length }, errors: errors.length }));
      await page.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
    else console.log(JSON.stringify({ ok: true, out, shots: report.shots.length }));
  } finally { await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
