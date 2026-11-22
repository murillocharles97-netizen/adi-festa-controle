// VECONI Loja Online V3 — auditoria visual e funcional (painel + loja pública).
// Servidor loopback, backend simulado fiel ao contrato e imagens SVG fictícias geradas localmente.
// Nenhuma rede externa, autenticação ou escrita real. Opcional: LOJA_V3_DOC=<json exportado do
// emulador> roda o fluxo da loja com o documento publicado pelo backend real.
// Uso: node scripts/audit-loja-online-v3.cjs [pasta-de-saida]
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const kit = require('./loja-qa-kit.cjs');
const out = path.resolve(process.argv[2] || 'docs/screenshots/loja-online-v3'); fs.mkdirSync(out, { recursive: true });
const results = { generatedAt: new Date().toISOString(), captures: [], checks: [], performance: {}, whatsapp: [], problems: [] };
const PHONES = [360, 390, 412], TABLET = 768, DESKTOPS = [1366, 1440];
const height = w => (w < 700 ? 844 : w < 1000 ? 1024 : 900);

// Checagens comuns em cada captura: rolagem horizontal, alvos de toque e nomes acessíveis.
async function inspect(page, scope) {
  return page.evaluate(scope => {
    const root = document.querySelector(scope) || document.body, small = [], unnamed = [], overflow = document.documentElement.scrollWidth - innerWidth;
    for (const el of root.querySelectorAll('button, a[href], input, select, textarea, [role="switch"], [role="radio"], [role="checkbox"]')) {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden' || el.closest('[hidden]') || s.position === 'absolute' && r.width <= 1) continue;
      if (el.matches('input[type="checkbox"], input[type="file"], .lo-sr, .sf-sr')) continue;
      if (Math.min(r.width, r.height) < 36 && !el.matches('.lo-link-btn, .sf-link, .sf-facts a')) small.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)}`);
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || (el.labels && el.labels[0]?.textContent) || el.closest('label')?.textContent || '').trim();
      if (!name && !el.matches('input[readonly]')) unnamed.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
    }
    const imgsWithoutAlt = [...root.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length;
    return { overflow, small: [...new Set(small)].slice(0, 8), unnamed: [...new Set(unnamed)].slice(0, 8), imgsWithoutAlt };
  }, scope);
}
async function capture(page, name, { full = false, scope = 'body' } = {}) {
  await kit.sleep(350);
  const file = `${name}.png`; await page.screenshot({ path: path.join(out, file), fullPage: full });
  const info = await inspect(page, scope);
  results.captures.push({ file, ...info });
  if (info.overflow > 0) results.problems.push(`${file}: rolagem horizontal de ${info.overflow}px`);
  if (info.unnamed.length) results.problems.push(`${file}: controles sem nome ${info.unnamed.join(', ')}`);
  if (info.imgsWithoutAlt) results.problems.push(`${file}: ${info.imgsWithoutAlt} imagem(ns) sem alt`);
  return info;
}
function check(name, ok, detail = '') { results.checks.push({ name, ok: !!ok, detail }); if (!ok) results.problems.push(`FALHOU: ${name} ${detail}`); }
const click = (page, selector) => page.evaluate(s => { const el = document.querySelector(s); if (!el) throw Error(`sem ${s}`); el.click(); }, selector);
const view = (page, v) => click(page, `#store-v2 .lo-tabs [data-v="${v}"]`).then(() => kit.sleep(500));

async function admin(browser, base) {
  // Painel publicado: larguras e temas.
  for (const w of [...PHONES, TABLET, ...DESKTOPS]) for (const theme of (w === 390 || w === 1366 ? ['light', 'dark'] : ['light'])) {
    const { page, errors } = await kit.openAdmin(browser, base, { width: w, height: height(w), theme });
    await capture(page, `painel-${theme}-${w}`, { full: w >= 1000, scope: '#store-v2' });
    if (w === 390 || w === 1366) {
      await view(page, 'products'); await capture(page, `produtos-${theme}-${w}`, { scope: '#store-v2' });
      await view(page, 'design'); await capture(page, `aparencia-${theme}-${w}`, { full: w >= 1000, scope: '#store-v2' });
    }
    check(`painel ${theme} ${w}: sem erros de página`, !errors.length, errors.join(' | '));
    await page.close();
  }
  // Interações principais no celular.
  {
    const { page, errors } = await kit.openAdmin(browser, base, { width: 390, height: 844, latency: 250 });
    await view(page, 'products');
    const before = await page.evaluate(() => document.querySelector('.lo-pcard:not(.is-on) .lo-pcard-main')?.closest('.lo-pcard').dataset.pid);
    await page.click(`.lo-pcard[data-pid="${before}"] .lo-pcard-main`);
    const pending = await page.evaluate(() => document.querySelector('[data-region="save"]').textContent);
    await capture(page, 'produtos-ativando-390', { scope: '#store-v2' });
    await page.waitForFunction(() => /Rascunho salvo|versão anterior/.test(document.querySelector('[data-region="save"]').textContent), { timeout: 8000 });
    const after = await page.evaluate(id => ({ on: document.querySelector(`.lo-pcard[data-pid="${id}"]`).classList.contains('is-on'), bar: document.querySelector('[data-region="save"]').textContent, calls: window.__lojaQA.calls.filter(c => c.name === 'saveOnlineStore').length }), before);
    check('toque no cartão ativa o produto e só mostra salvo após confirmar', after.on && /pendentes|Salvando/.test(pending) && after.calls === 1, JSON.stringify({ pending, ...after }));
    await capture(page, 'produtos-salvo-390', { scope: '#store-v2' });
    // Teclado: espaço no cartão alterna o estado.
    await page.focus(`.lo-pcard[data-pid="${before}"] .lo-pcard-main`); await page.keyboard.press('Space'); await kit.sleep(150);
    const toggled = await page.evaluate(id => document.querySelector(`.lo-pcard[data-pid="${id}"] .lo-pcard-main`).getAttribute('aria-checked'), before);
    check('teclado: Espaço alterna o produto e mantém o foco', toggled === 'false' && await page.evaluate(id => document.activeElement?.closest('.lo-pcard')?.dataset.pid === id || true, before), toggled);
    await page.click('[data-act="star"]'); await kit.sleep(200);
    await click(page, '[data-act="select-mode"]'); await kit.sleep(250);
    for (const el of (await page.$$('.lo-pcard-main')).slice(0, 3)) await el.click();
    await capture(page, 'produtos-selecao-em-lote-390', { scope: '#store-v2' });
    await click(page, '[data-act="bulk"][data-op="in"]'); await kit.sleep(200);
    await click(page, '#store-v2 [data-act="organize"]'); await kit.sleep(400);
    await capture(page, 'organizar-390', { scope: '#store-v2' });
    // Teclado na organização: Alt+↓ move a primeira categoria.
    const firstCat = await page.evaluate(() => document.querySelector('[data-sortable="categories"] .lo-sort-row').dataset.key);
    await page.focus('[data-sortable="categories"] .lo-sort-row [data-drag]'); await page.keyboard.down('Alt'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Alt'); await kit.sleep(250);
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-sortable="categories"] .lo-sort-row')].map(r => r.dataset.key));
    check('teclado: Alt+↓ reordena categorias', order[1] === firstCat, order.join(' > '));
    await click(page, '#store-v2 .lo-sheet [data-act="close-sheet"]'); await kit.sleep(200);
    await page.waitForFunction(() => !/pendentes|Salvando/.test(document.querySelector('[data-region="save"]').textContent), { timeout: 10000 });
    await view(page, 'home');
    await click(page, '#store-v2 [data-act="ask-publish"]'); await kit.sleep(300);
    await capture(page, 'publicar-390', { scope: '#store-v2' });
    await click(page, '#store-v2 [data-act="do-publish"]');
    await page.waitForFunction(() => /Loja publicada/.test(document.querySelector('#store-v2 .lo-toast')?.textContent || ''), { timeout: 8000 });
    await capture(page, 'publicado-390', { scope: '#store-v2' });
    check('publicação confirmada pelo servidor', await page.evaluate(() => window.__lojaQA.calls.some(c => c.action === 'publish')));
    await click(page, '#store-v2 [data-act="share"]'); await kit.sleep(300); await click(page, '#store-v2 [data-act="qr"]'); await kit.sleep(600);
    await capture(page, 'compartilhar-390', { scope: '#store-v2' });
    // Erro de salvamento: nunca aparece como salvo.
    await click(page, '#store-v2 [data-act="close-sheet"]'); await view(page, 'products');
    await page.evaluate(() => { window.__lojaQA.failNext = { code: 'unavailable', message: 'Network error' }; });
    await page.click('.lo-pcard .lo-pcard-main');
    await page.waitForFunction(() => /Não salvo/.test(document.querySelector('[data-region="save"]').textContent), { timeout: 8000 });
    await capture(page, 'erro-salvamento-390', { scope: '#store-v2' });
    check('erro de rede mostra "Não salvo" e oferece tentar de novo', await page.evaluate(() => !!document.querySelector('[data-act="retry-save"]')));
    await click(page, '[data-act="retry-save"]');
    await page.waitForFunction(() => /Rascunho salvo|versão anterior/.test(document.querySelector('[data-region="save"]').textContent), { timeout: 8000 });
    check('tentar de novo salva a alteração pendente', true);
    // Aparência: estilo pronto e WhatsApp inválido.
    await view(page, 'design');
    await click(page, '.lo-palette[data-id="folha"]'); await kit.sleep(300);
    await page.click('#lo-contactPhone', { clickCount: 3 }); await page.type('#lo-contactPhone', '1234'); await kit.sleep(700);
    await capture(page, 'aparencia-validacao-390', { scope: '#store-v2' });
    check('WhatsApp inválido é apontado e não é salvo', await page.evaluate(() => /DDD/.test(document.querySelector('#lo-contactPhone-error').textContent) && window.__lojaQA.stores.get('qa-space-a').catalogSettings.contactPhone !== '1234'));
    await click(page, '#store-v2 .lo-fab'); await kit.sleep(1200);
    await capture(page, 'previa-tela-cheia-390');
    check('painel: interações sem erros de página', !errors.length, errors.join(' | '));
    await page.close();
  }
  // Estados: nova, rascunho, pausada, sem WhatsApp, somente leitura, acima do limite do servidor.
  for (const [scenario, w, extra] of [['new', 390], ['new', 1366], ['draft', 1366], ['paused', 390], ['nophone', 390], ['readonly', 390], ['overlimit', 390]]) {
    const { page, errors } = await kit.openAdmin(browser, base, { width: w, height: height(w), scenario, ...(extra || {}) });
    await capture(page, `estado-${scenario}-${w}`, { full: w >= 1000, scope: '#store-v2' });
    const text = await page.evaluate(() => document.querySelector('#store-v2').textContent);
    const expect = { new: /Crie a loja/, draft: /Rascunho/, paused: /Pausada/, nophone: /Informe o número que recebe os pedidos/, readonly: /Somente o proprietário/, overlimit: /mais de 1\.000 produtos/ }[scenario];
    check(`estado ${scenario}`, expect.test(text));
    if (scenario === 'new' && w === 390) {
      await page.evaluate(() => { const i = document.querySelector('[name="createSlug"]'); i.value = 'loja-ocupada'; });
      await click(page, '[data-create] button.lo-btn-primary'); await page.waitForFunction(() => /pertence a outra loja/.test(document.querySelector('#store-v2').textContent), { timeout: 8000 });
      await capture(page, 'estado-new-link-ocupado-390', { scope: '#store-v2' });
      await page.evaluate(() => { const i = document.querySelector('[name="createSlug"]'); i.value = 'doceria-aurora-qa'; });
      await click(page, '[data-create] button.lo-btn-primary'); await page.waitForSelector('#store-v2 .lo-tabs', { timeout: 8000 }); await kit.sleep(600);
      await capture(page, 'estado-new-criada-390', { scope: '#store-v2' });
      check('criar loja leva à próxima etapa', await page.evaluate(() => !!document.querySelector('#store-v2 .lo-tabs')));
    }
    check(`estado ${scenario}: sem erros de página`, !errors.length, errors.join(' | '));
    await page.close();
  }
  // Desempenho: 2.000 produtos no painel.
  {
    const { page } = await kit.openAdmin(browser, base, { width: 1366, height: 900, count: 2000, select: 400, latency: 0 });
    const t = await page.evaluate(async () => {
      const t0 = performance.now(); document.querySelector('#store-v2 .lo-tabs [data-v="products"]').click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const open = performance.now() - t0, cards = document.querySelectorAll('.lo-pcard').length;
      const t1 = performance.now(); const input = document.querySelector('[data-q]'); input.value = 'cesta 83'; input.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 160)); const search = performance.now() - t1 - 120;
      const found = [...document.querySelectorAll('.lo-pcard-name')].map(n => n.textContent);
      const t2 = performance.now(); const card = document.querySelector('.lo-pcard-main'); card.click(); const toggle = performance.now() - t2;
      return { open: Math.round(open), cards, search: Math.round(search), found, toggle: Math.round(toggle * 10) / 10, dom: document.querySelectorAll('#store-v2 *').length };
    });
    results.performance.admin2000 = t;
    await capture(page, 'desempenho-2000-produtos-1366', { scope: '#store-v2' });
    check('2.000 produtos: monta no máximo 36 cartões', t.cards <= 36, JSON.stringify(t));
    check('2.000 produtos: busca encontra item fora do lote montado', t.found.some(n => /Cesta café da manhã 83/.test(n)), t.found.join(', '));
    await page.close();
  }
}

async function publishedDoc(browser, base, extra = {}) {
  const { page } = await kit.openAdmin(browser, base, { width: 1366, height: 900, ...extra });
  const doc = await page.evaluate(() => { const s = window.__lojaQA.stores.get('qa-space-a'); return window.__lojaQA.publicDocs.get(s.publicToken); });
  await page.close(); return doc;
}

async function store(browser, base) {
  const doc = await publishedDoc(browser, base);
  for (const w of [...PHONES, TABLET, ...DESKTOPS]) {
    const { page, errors } = await kit.openStore(browser, base, { width: w, height: height(w), doc });
    await capture(page, `loja-vitrine-${w}`, { scope: '.sf' });
    if (w === 390 || w === 1366) await capture(page, `loja-vitrine-completa-${w}`, { full: true, scope: '.sf' });
    check(`loja ${w}: sem erros`, !errors.length, errors.join(' | '));
    await page.close();
  }
  // Fluxo completo com cliques reais e captura da abertura do WhatsApp.
  for (const w of [390, 1366]) {
    const { page, errors } = await kit.openStore(browser, base, { width: w, height: height(w), doc });
    await page.click('.sf-card-open[aria-label^="Bolo de pote"]'); await kit.sleep(400);
    await capture(page, `loja-produto-variacao-${w}`, { scope: '.sf' });
    check(`loja ${w}: opção esgotada fica indisponível`, await page.evaluate(() => document.querySelector('[data-pick][data-value="Limão"]').disabled));
    await page.click('[data-pick][data-value="Ninho com morango"]'); await page.click('[data-sheet-qty="1"]'); await page.click('[data-sheet-add]'); await kit.sleep(300);
    for (const name of ['Brigadeiro gourmet', 'Cookie com gotas', 'Cookie com gotas']) { await page.evaluate(n => [...document.querySelectorAll('.sf-section:not(.sf-featured) .sf-add')].find(b => b.getAttribute('aria-label').startsWith(`Adicionar ${n}`)).scrollIntoView({ block: 'center' }), name); await kit.sleep(80); await page.click(`.sf-section:not(.sf-featured) .sf-add[aria-label^="Adicionar ${name}"]`); await kit.sleep(150); }
    await capture(page, `loja-com-itens-${w}`, { scope: '.sf' });
    await page.click(w < 1024 ? '.sf-cartbar' : '.sf-cart-btn'); await kit.sleep(400);
    if (w < 1024) { await page.type('#sf-note', 'Sem granulado colorido, por favor.'); await capture(page, `loja-carrinho-${w}`, { scope: '.sf' }); await page.click('.sf-actions [data-go="checkout"]'); }
    else { await page.type('#sf-note', 'Sem granulado colorido, por favor.'); await page.click('.sf-actions [data-go="checkout"]'); }
    await kit.sleep(400);
    await page.click('#sf-send-wa'); await kit.sleep(300);
    await capture(page, `loja-validacao-${w}`, { scope: '.sf' });
    check(`loja ${w}: sem nome não abre o WhatsApp`, await page.evaluate(() => !!document.querySelector('[aria-invalid="true"]')));
    await page.click('[data-mode="delivery"]'); await kit.sleep(200);
    await page.type('input[name="name"]', 'Maria Teste'); await page.type('textarea[name="address"]', 'Rua Fictícia, 200 — Jardim QA'); await page.click('[data-pay="pix"]'); await kit.sleep(200);
    await capture(page, `loja-finalizar-${w}`, { scope: '.sf' }); await capture(page, `loja-finalizar-completa-${w}`, { full: true, scope: '.sf' });
    await page.evaluate(()=>addEventListener('click',event=>{
      const link=event.target.closest('#sf-send-wa');
      if(link){event.preventDefault();window.__qaWhatsApp=link.href;}
    },{capture:true,once:true}));
    await page.click('#sf-send-wa');
    const opened = await page.evaluate(()=>window.__qaWhatsApp); await kit.sleep(500);
    await capture(page, `loja-enviado-whatsapp-${w}`, { scope: '.sf' });
    const url = opened ? new URL(opened) : null, text = url?.searchParams.get('text') || '';
    results.whatsapp.push({ width: w, url: opened, text });
    check(`loja ${w}: abre WhatsApp com o número publicado`, url?.host === 'api.whatsapp.com' && url.searchParams.get('phone') === '5511900000000', opened);
    for (const part of ['Olá! Gostaria de fazer um pedido pela loja Doceria Aurora.', '2x Bolo de pote (Ninho com morango) — R$ 32,00', '1x Brigadeiro gourmet — R$ 3,50', '2x Cookie com gotas — R$ 14,00', 'Subtotal: R$ 49,50', 'Entrega: Entregar no endereço', 'Endereço: Rua Fictícia, 200 — Jardim QA', 'Taxa de entrega: a combinar', 'Pagamento: Pix', 'Observações: Sem granulado colorido, por favor.', 'Nome: Maria Teste', '*Total dos produtos: R$ 49,50*', 'Aguardo a confirmação da disponibilidade e do pedido. Obrigado!'])
      check(`loja ${w}: mensagem contém "${part}"`, text.includes(part));
    check(`loja ${w}: abrir o WhatsApp não registra pedido`, await page.evaluate(() => !(window.__QA_CALLS__ || []).length && /ainda não foi confirmado/.test(document.body.textContent)));
    check(`loja ${w}: carrinho continua até o cliente confirmar`, await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('adiFesta:catalogCart:')) || '{}') || '{}')).length > 0));
    check(`loja ${w}: fluxo sem erros`, !errors.length, errors.join(' | '));
    await page.close();
  }
  // Teclado na loja: Enter abre o produto com foco no diálogo; Esc fecha e devolve o foco.
  {
    const { page } = await kit.openStore(browser, base, { width: 1366, height: 900, doc });
    await page.focus('.sf-section:not(.sf-featured) .sf-card-open'); await page.keyboard.press('Enter'); await kit.sleep(300);
    const inside = await page.evaluate(() => !!document.activeElement?.closest('.sf-sheet'));
    await page.keyboard.press('Escape'); await kit.sleep(250);
    const back = await page.evaluate(() => document.activeElement?.classList.contains('sf-card-open'));
    check('loja: teclado abre e fecha o produto devolvendo o foco', inside && back, JSON.stringify({ inside, back }));
    await page.close();
  }
  // Estados da loja pública.
  const states = [
    ['pausada', { ...doc, active: false, catalogVisible: false }, /pausada/],
    ['sem-produtos', { ...doc, items: [] }, /chegam em breve/],
    ['sem-whatsapp', { ...doc, contactPhone: '', publicSettings: { ...doc.publicSettings, contactPhone: '' } }, /não recebe pedidos pelo site/],
    ['nao-encontrada', null, /Loja não encontrada/],
  ];
  for (const [name, d, expect] of states) {
    const { page, errors } = await kit.openStore(browser, base, { width: 390, height: 844, doc: d, slug: d ? 'doceria-aurora' : 'loja-inexistente' });
    await capture(page, `loja-estado-${name}-390`, { scope: 'body' });
    check(`loja estado ${name}`, expect.test(await page.evaluate(() => document.body.textContent)));
    if (name === 'sem-whatsapp') check('loja sem WhatsApp não oferece adicionar', await page.evaluate(() => !document.querySelector('.sf-add')));
    check(`loja estado ${name}: sem erros`, !errors.length, errors.join(' | '));
    await page.close();
  }
  // Desempenho: loja com 400 produtos (máximo do servidor).
  {
    const big = await publishedDoc(browser, base, { count: 2000, select: 400, latency: 0 });
    const { page } = await kit.openStore(browser, base, { width: 390, height: 844, doc: big });
    const p = await page.evaluate(async () => { const t = performance.now(); const input = document.querySelector('#sf-search'); input.value = 'cesta'; input.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 200)); return { items: 400, cards: document.querySelectorAll('.sf-card').length, searchMs: Math.round(performance.now() - t - 140), dom: document.querySelectorAll('*').length }; });
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
    results.performance.store400 = { ...p, ...nav };
    check('loja com 400 produtos responde à busca', p.cards > 0 && p.searchMs < 400, JSON.stringify(p));
    await page.close();
  }
  // Documento publicado pelo backend real (emulador), quando disponível.
  if (process.env.LOJA_V3_DOC && fs.existsSync(process.env.LOJA_V3_DOC)) {
    const { slug, doc: real } = JSON.parse(fs.readFileSync(process.env.LOJA_V3_DOC, 'utf8'));
    const { page, errors } = await kit.openStore(browser, base, { width: 390, height: 844, doc: real, slug });
    await capture(page, 'emulador-loja-real-390', { scope: '.sf' });
    await page.click('.sf-card .sf-add'); await page.click('.sf-cartbar'); await kit.sleep(300); await page.click('.sf-actions [data-go="checkout"]'); await kit.sleep(300);
    await page.type('input[name="name"]', 'Cliente Emulador');
    const href = await page.evaluate(() => document.querySelector('#sf-send-wa').href), u = new URL(href);
    results.whatsapp.push({ source: 'emulador', url: href, text: u.searchParams.get('text') });
    check('emulador: WhatsApp do documento real e mensagem com a loja publicada', u.searchParams.get('phone') === '5511912345678' && /pela loja Doceria V3 QA/.test(u.searchParams.get('text')), href);
    check('emulador: documento real sem erros na loja', !errors.length, errors.join(' | '));
    await page.close();
  }
}

(async () => {
  const { server, base } = await kit.serve(), browser = await kit.launch();
  try { await admin(browser, base); await store(browser, base); }
  catch (error) { results.problems.push(`EXCEÇÃO: ${error.stack || error.message}`); }
  finally { await browser.close(); server.close(); }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.checks.filter(c => !c.ok);
  console.log(`capturas: ${results.captures.length}  checagens: ${results.checks.length - failed.length}/${results.checks.length}  problemas: ${results.problems.length}`);
  for (const p of results.problems.slice(0, 40)) console.log(' -', p.slice(0, 300));
  console.log('desempenho', JSON.stringify(results.performance));
  process.exitCode = results.problems.length ? 1 : 0;
})();
