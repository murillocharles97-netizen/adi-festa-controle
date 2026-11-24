'use strict';
// Auditoria de fluidez da tela de Clientes (V242.7).
// Usa o laboratório de desempenho (app real + dados fictícios) e mede:
//   - recriação de cartões e animações de entrada disparadas por atualizações automáticas;
//   - quadros em que cartões visíveis ficam transparentes (piscada);
//   - preservação de busca, foco, rolagem, modal e filtro;
//   - tempos por fase (renderização, processamento local, espera do servidor simulado).
// Uso: node scripts/audit-clientes-fluidez.cjs [--root <worktree>] [--label nome] [--latency 350]
// Todos os dados são fictícios e gerados aqui. Nenhum acesso à nuvem é permitido.
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const ROOT = path.resolve(option('root', path.join(__dirname, '..')));
const LABEL = option('label', 'candidate');
const LATENCY = Number(option('latency', 350));
const OUT = path.resolve(option('out', path.join(__dirname, '..', 'qa-artifacts', 'clientes-fluidez')));
const ONLY = option('only', '');
const SHOTS = args.includes('--screenshots');
const helpers = require(path.join(ROOT, 'scripts', 'performance-lab-helpers.cjs'));
const { routeFixture } = require(path.join(ROOT, 'scripts', 'audit-performance-runtime-c643cc5.cjs'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...items) => { if (process.env.FLUIDEZ_DEBUG) console.log(new Date().toISOString().slice(11, 19), ...items); };

// Instrumentação injetada na página antes do app carregar.
function probeSource() {
  const CARD = '.mobile-swipe-shell,#client-list>[data-client-id]';
  const probe = window.__fluidez = {
    counts: { cardsAdded: 0, cardsRemoved: 0, pageReplaced: 0, listReplaced: 0, animations: 0, blinkFrames: 0, frames: 0 },
    server: [], sampling: false,
    reset() { for (const key of Object.keys(this.counts)) this.counts[key] = 0; this.server = []; },
    snapshot() { return { ...this.counts, serverCalls: this.server.length, serverMs: Math.round(this.server.reduce((n, c) => n + c.ms, 0)) }; },
  };
  const cardsIn = node => node.nodeType !== 1 ? 0 : (node.matches(CARD) ? 1 : 0) + node.querySelectorAll(CARD).length;
  new MutationObserver(records => {
    for (const record of records) {
      let added = 0, removed = 0;
      record.addedNodes.forEach(node => { added += cardsIn(node); });
      record.removedNodes.forEach(node => { removed += cardsIn(node); if (node.nodeType === 1 && node.matches('.clients-page')) probe.counts.pageReplaced++; });
      probe.counts.cardsAdded += added; probe.counts.cardsRemoved += removed;
      if (removed && record.target.matches?.('#mobile-client-list,#client-list')) probe.counts.listReplaced++;
    }
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener('animationstart', event => {
    if (event.target.matches?.('.mobile-swipe-shell,.professional-client-card,[data-client-id]')) probe.counts.animations++;
  }, true);
  function frame() {
    if (probe.sampling) {
      probe.counts.frames++;
      const cards = [...document.querySelectorAll('#app .mobile-swipe-shell,#app #client-list>[data-client-id]')].slice(0, 60);
      const blinking = cards.some(card => {
        const box = card.getBoundingClientRect();
        if (box.bottom < 0 || box.top > innerHeight) return false;
        return Number(getComputedStyle(card).opacity) < 0.98;
      });
      if (blinking) probe.counts.blinkFrames++;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Stubs de servidor e de espaço com latência configurável (somente dados fictícios).
function serverStubs(latency) {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const today = () => window.InstallmentPlan.today();
  const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const spaceId = 'fixture-space';
  window.__toasts = [];
  const context = window.BusinessContext.get();
  const owned = { ...context, userProfile: { uid: 'fixture-owner', businessId: context.businessId, active: true }, business: { id: context.businessId, ownerId: 'fixture-owner' } };
  window.BusinessContext = { get: () => owned };
  const toast = window.Utils.toast;
  window.Utils.toast = (message, error) => { window.__toasts.push({ message: String(message), error: !!error }); return toast?.call(window.Utils, message, error); };
  let scope = 'scope-a';
  window.__setFixtureScope = value => { scope = value; };
  Object.assign(window.SpaceContext, {
    activeId: () => spaceId, viewScope: () => scope, scopesCustomers: () => false, selectionLabel: () => 'Espaço fixture',
    salesSpaces: () => [{ id: spaceId, name: 'Espaço fixture' }], customerSpaces: () => [{ id: spaceId, name: 'Espaço fixture' }],
    homeSpaces: () => [{ id: spaceId, name: 'Espaço fixture' }], requireSalesSpace: () => spaceId, recordSpace: () => spaceId, showsRenewal: () => true,
  });
  const accountFor = clientId => {
    const client = DB.carregar().clientes.find(c => c.id === clientId);
    const sale = DB.carregar().vendas.find(s => s.id === 'fiado-' + clientId);
    if (!client || !sale) return null;
    const entries = window.InstallmentPlan.rows(sale, today()).filter(row => row.remainingCents > 0).map(row => ({ saleId: sale.id, number: row.number, dueDate: row.dueDate, remainingCents: row.remainingCents, spaceId }));
    const dueCents = entries.filter(e => e.dueDate <= today()).reduce((n, e) => n + e.remainingCents, 0);
    const futureCents = entries.filter(e => e.dueDate > today()).reduce((n, e) => n + e.remainingCents, 0);
    return { clientId, version: 2, historyProofVersion: 1, scopedReceiptVersion: 1, financialVersion: Number(client.financialVersion || 0), creditCents: 0,
      asOf: today(), dueCents, futureCents, totalCents: dueCents + futureCents, entries };
  };
  window.__fixtureServer = { latency, confirmAfterMs: latency, fail: false, hang: false, payments: [] };
  const queue = [];
  Object.assign(window.SyncFirebase, {
    assertFiadoReceiptQueueClear() {}, async assertFiadoReceiptWriter() {}, assertCustomerPaymentReview() {}, assertPaymentTracked() {},
    createPaymentOperation(_before, after, payment) { queue.push(payment.operationId); DB.salvar(after); window.__fixtureServer.payments.push({ id: payment.id, at: performance.now() }); },
  });
  window.FirebaseCallable = async (name, data) => {
    const started = performance.now(), server = window.__fixtureServer;
    try {
      if (server.hang) await new Promise(() => {});
      await delay(server.latency);
      if (server.fail || navigator.onLine === false) throw Object.assign(Error('Falha de rede simulada.'), { code: 'functions/unavailable' });
      const base = { businessId: DB.getBusinessId(), workspaceGeneration: DB.getWorkspaceGeneration?.() ?? 0 };
      if (data.kind === 'fiado_receipt_route') {
        const account = accountFor(data.clientId);
        if (!account) return { data: { ...base, receiptRouteVersion: 1, clientId: data.clientId, spaceId, mode: 'blocked', reason: 'no_debt' } };
        return { data: { ...base, receiptRouteVersion: 1, clientId: data.clientId, spaceId, mode: 'space', scopedReceiptVersion: 1, quoteHash: 'a'.repeat(64),
          financialVersion: account.financialVersion, asOf: account.asOf, dueCents: account.dueCents, futureCents: account.futureCents, totalCents: account.totalCents, scopedAccount: account } };
      }
      if (data.kind === 'fiado_account') return { data: { ...base, account: accountFor(data.clientId) } };
      if (data.kind === 'fiado_conditions_list') return { data: { rows: [], cursor: null } };
      if (data.kind === 'fiado_conditions') return { data: { clientId: data.clientId, configured: false, confirmed: true } };
      if (data.kind === 'payment_confirmation') {
        const payment = DB.carregar().pagamentos.find(p => p.id === data.paymentId);
        const sent = server.payments.find(p => p.id === data.paymentId);
        if (!payment || !sent || performance.now() - sent.at < server.confirmAfterMs) return { data: { confirmed: false, status: 'awaiting_confirmation' } };
        const client = DB.carregar().clientes.find(c => c.id === data.clientId);
        return { data: { ...base, confirmed: true, paymentId: payment.id, operationId: payment.operationId, clientId: data.clientId, amount: payment.valor,
          balance: Number(client.saldo), futureAmount: 0, totalOutstanding: Math.max(0, -Number(client.saldo)), businessName: 'Empresa fixture', clientName: client.nome,
          paymentDate: payment.data, paymentMethod: payment.paymentMethod, checkedAt: new Date().toISOString() } };
      }
      return { data: {} };
    } finally {
      window.__fluidez.server.push({ name, kind: data?.kind, ms: performance.now() - started });
    }
  };
  // Lista paginada da nuvem (mesmo contrato de SyncFirebase.queryClientsPage), ordenada a partir do cache local.
  window.SyncFirebase.queryClientsPage = async params => {
    const started = performance.now();
    await delay(latency);
    const norm = v => window.ClientFilterRules.normalize(v);
    let list = DB.carregar().clientes.filter(c => c.ativo !== false);
    if (params.search) list = list.filter(c => norm(c.nome).includes(norm(params.search)));
    if (params.filter === 'debito') list = list.filter(c => Number(c.saldo) < 0);
    const debt = c => Math.max(0, -Number(c.saldo || 0));
    list.sort(params.sort === 'maiorDebito' ? (a, b) => debt(b) - debt(a) : (a, b) => norm(a.nome).localeCompare(norm(b.nome), 'pt-BR'));
    const start = Number(params.cursor || 0), items = list.slice(start, start + params.limit).map(c => ({ ...c }));
    window.__fluidez.server.push({ name: 'queryClientsPage', ms: performance.now() - started });
    return { items, cursor: String(start + items.length), hasMore: start + items.length < list.length, documentsRead: items.length, pendingClientIds: [] };
  };
  // Clientes devedores fictícios com Fiado parcelado (parcela vencida + parcelas futuras).
  DB.alterar(db => {
    const day = today();
    // Pagamentos antigos da fixture já foram aplicados no servidor.
    for (const payment of db.pagamentos || []) Object.assign(payment, { status: 'applied', applicationStatus: 'applied', financialAppliedAt: payment.data });
    db.clientes.forEach(client => {
      if (!String(client.id).startsWith('bench-c')) return;
      const i = Number(client.id.slice(7));
      client.telefone = '119' + String(10000000 + i).padStart(8, '0');
      if (i % 3 !== 0) return;
      const future = i % 6 === 0 ? 3000 : 0, due = future ? 3000 : 2000 + (i % 40) * 150;
      client.saldo = -(due + future) / 100; client.financialVersion = 1; client.hasInstallmentFiado = true;
      const installmentPlan = window.InstallmentPlan.create({ total: (due + future) / 100, count: future ? 2 : 1, saleDate: addDays(day, -33), firstDueDate: addDays(day, -3) });
      db.vendas.push({ id: 'fiado-' + client.id, clienteId: client.id, clienteNome: client.nome, data: new Date(Date.now() - 33 * 864e5).toISOString(), businessId: DB.getBusinessId(), spaceId, financialSpaceId: spaceId,
        formaPagamento: 'fiado', status: 'fiado', valorFinal: (due + future) / 100, creditOriginalAmount: (due + future) / 100, creditPaidAmount: 0, creditRemainingAmount: (due + future) / 100,
        installmentPlan, itens: [] });
    });
  });
}

let currentResult = null;
const RECEIVE_ID = 'bench-c3';      // devedor sem parcelas futuras
const FUTURE_ID = 'bench-c6';       // devedor com parcela futura

async function scenario(page, profile, volume) {
  const mobile = profile.mobile;
  const S = mobile ? { search: '#mobile-client-search', list: '#mobile-client-list', card: '.mobile-swipe-shell', receive: id => `[data-mobile-receive="${id}"]` }
    : { search: '#client-search', list: '#client-list', card: '#client-list>[data-client-id]', receive: id => `[data-receive-client="${id}"]` };
  const result = currentResult = { profile: (mobile ? 'android-390' : 'desktop-1366'), volume, label: LABEL, checks: {}, timings: {}, events: {} };
  const paint = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const counts = async (fn, settle = 1400) => {
    await page.evaluate(() => { window.__fluidez.reset(); window.__fluidez.sampling = true; });
    await fn();
    await sleep(settle);
    return page.evaluate(() => { window.__fluidez.sampling = false; return window.__fluidez.snapshot(); });
  };
  const state = () => page.evaluate(S => {
    const input = document.querySelector(S.search), modal = document.querySelector('#modal');
    return { focused: document.activeElement === input && !!input, value: input?.value ?? null, caret: input?.selectionStart ?? null, scrollY: Math.round(scrollY),
      modalOpen: !!modal?.children.length, modalInput: modal?.querySelector('[name=valor]')?.value ?? null,
      cards: document.querySelectorAll(S.card).length, firstCard: document.querySelector(S.card)?.dataset.swipeClient || document.querySelector(S.card)?.dataset.clientId || null };
  }, S);

  log('passo 1');
  // 1. Abrir Clientes.
  await page.evaluate(() => { window.__fluidez.reset(); window.__fluidez.sampling = true; });
  const open = await page.evaluate(async S => {
    const start = performance.now();
    Router.ir('clientes');
    while (!document.querySelector(S.list + ' ' + (S.card.includes('>') ? '[data-client-id]' : S.card))) await new Promise(r => setTimeout(r, 4));
    const rendered = performance.now() - start;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { renderMs: rendered, paintedMs: performance.now() - start };
  }, S);
  await sleep(2200);
  const openCounts = await page.evaluate(() => { window.__fluidez.sampling = false; return window.__fluidez.snapshot(); });
  result.timings.abrirClientes = { ...open, ...openCounts };
  if (SHOTS) await page.screenshot({ path: path.join(OUT, `${LABEL}-${result.profile}-${volume}-lista.png`) });

  log('passo 2');
  // 2. Pesquisar (com o teclado aberto: foco no campo).
  const search = await page.evaluate(async S => {
    const input = document.querySelector(S.search);
    input.focus(); input.value = 'Cliente QA 00013'; input.setSelectionRange(16, 16);
    const start = performance.now();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    while (true) {
      const target = document.querySelector(S.list);
      const ids = [...target.querySelectorAll('[data-swipe-client],[data-client-id]')].map(n => n.dataset.swipeClient || n.dataset.clientId);
      if (ids.length && ids.every(id => /^bench-c13\d*$/.test(id))) break;
      if (performance.now() - start > 4000) return { fault: 'busca nao atualizou' };
      await new Promise(r => setTimeout(r, 4));
    }
    const rendered = performance.now() - start;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { renderMs: rendered, paintedMs: performance.now() - start };
  }, S);
  await sleep(900);
  result.timings.pesquisar = search;
  result.checks.searchKeepsFocus = await state();

  log('passo 3');
  // 3. Eventos automáticos com busca digitada e teclado aberto.
  const automatic = [
    ['financial-state-updated', () => page.evaluate(() => dispatchEvent(new CustomEvent('financial-state-updated', { detail: {} })))],
    ['cloud-clients-updated', () => page.evaluate(() => dispatchEvent(new CustomEvent('cloud-data-updated', { detail: { collection: 'clients', source: 'snapshot' } })))],
    ['cloud-payments-updated', () => page.evaluate(() => dispatchEvent(new CustomEvent('cloud-data-updated', { detail: { collection: 'payments', source: 'snapshot' } })))],
    ['fiado-conditions-updated', () => page.evaluate(() => dispatchEvent(new Event('fiado-conditions-updated')))],
    ['message-history-updated', () => page.evaluate(() => dispatchEvent(new Event('message-history-updated')))],
    ['firebase-sync-status', () => page.evaluate(() => dispatchEvent(new CustomEvent('firebase-sync-status', { detail: { status: 'synced' } })))],
  ];
  for (const [name, fire] of automatic) {
    await page.evaluate(S => { const i = document.querySelector(S.search); i.focus(); i.setSelectionRange(16, 16); }, S);
    const before = await state();
    const c = await counts(fire);
    const after = await state();
    result.events['busca+' + name] = { ...c, before, after,
      keptFocus: before.focused && after.focused, keptValue: before.value === after.value, keptCaret: before.caret === after.caret };
  }

  log('passo 4');
  // 4. Lista grande sem busca: rolagem preservada durante atualização de saldo.
  await page.evaluate(S => { const i = document.querySelector(S.search); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); }, S);
  await sleep(900);
  await page.evaluate(() => scrollTo({ top: 1500 }));
  await sleep(900);
  await page.evaluate(() => scrollTo({ top: 1500 }));
  await sleep(300);
  {
    const before = await state();
    const c = await counts(() => page.evaluate(id => {
      DB.alterar(db => { const client = db.clientes.find(x => x.id === id); client.saldo = Number(client.saldo) - 7; client.financialVersion = Number(client.financialVersion || 0) + 1; });
      dispatchEvent(new CustomEvent('financial-state-updated', { detail: {} }));
    }, 'bench-c9'));
    const after = await state();
    const shown = await page.evaluate(S => {
      const card = document.querySelector(`[data-swipe-client="bench-c9"],[data-client-id="bench-c9"]`);
      return card ? (card.querySelector('.mobile-client-balance strong,.client-balance strong')?.textContent || '') : null;
    }, S);
    result.events['rolagem+saldo-atualizado'] = { ...c, before, after, scrollDelta: after.scrollY - before.scrollY, cardBalanceAfter: shown };
  }
  // Atualização da nuvem (lista de clientes) com a lista rolada.
  {
    const before = await state();
    const c = await counts(() => page.evaluate(() => dispatchEvent(new CustomEvent('cloud-data-updated', { detail: { collection: 'clients', source: 'snapshot' } }))));
    const after = await state();
    result.events['rolagem+cloud-clients'] = { ...c, before, after, scrollDelta: after.scrollY - before.scrollY };
  }
  await page.evaluate(() => scrollTo({ top: 0 }));
  await sleep(400);

  log('passo 5');
  // Toque no corpo do cartão: quantas vezes o perfil é montado.
  result.checks.cardTapProfileBuilds = await page.evaluate(async S => {
    let builds = 0; const original = window.CRMCliente?.build;
    if (original) window.CRMCliente.build = (...a) => { builds++; return original.apply(window.CRMCliente, a); };
    const body = document.querySelector(S.card.includes('>') ? '#client-list>[data-client-id] .client-facts' : '.mobile-swipe-shell .mobile-client-facts');
    body?.click();
    await new Promise(r => setTimeout(r, 300));
    if (original) window.CRMCliente.build = original;
    const opened = !!document.querySelector('#modal')?.children.length; Modais.fechar();
    return { builds, opened };
  }, S);
  await sleep(300);

  // 5. Abrir o cadastro (edição).
  result.timings.abrirCadastro = await page.evaluate(async id => {
    const start = performance.now();
    ClientesPage.clientForm(id);
    const ok = !!document.querySelector('#modal input[name=nome]');
    const local = performance.now() - start;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = { renderMs: local, paintedMs: performance.now() - start, ok };
    Modais.fechar();
    return out;
  }, 'bench-c13');
  await sleep(300);

  log('passo 6');
  // 6. Consultar o saldo (perfil + conta de Fiado apurada no servidor).
  result.timings.consultarSaldo = await page.evaluate(async id => {
    window.__fluidez.reset();
    const start = performance.now();
    ClientesPage.profile(id);
    const local = performance.now() - start;
    while (!/Exigível agora/.test(document.querySelector('#modal')?.textContent || '')) {
      if (performance.now() - start > 6000) return { fault: 'saldo nao apareceu', localMs: local };
      await new Promise(r => setTimeout(r, 4));
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const total = performance.now() - start, server = window.__fluidez.snapshot().serverMs;
    Modais.fechar();
    return { localMs: local, paintedMs: total, serverMs: server, renderAfterServerMs: Math.max(0, total - local - server) };
  }, FUTURE_ID);
  await sleep(300);

  log('passo 7');
  // 7. Abrir o recebimento pelo cartão.
  const openReceive = async id => page.evaluate(async (selector, id) => {
    window.__fluidez.reset();
    const waitFrom = performance.now();
    while (!document.querySelector(selector) && performance.now() - waitFrom < 5000) await new Promise(r => setTimeout(r, 20));
    const button = document.querySelector(selector);
    if (!button) return { fault: 'botao Receber ausente', listed: [...document.querySelectorAll('[data-swipe-client],[data-client-id]')].map(n => n.dataset.swipeClient || n.dataset.clientId).slice(0, 12) };
    button.scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 50));
    if (button.disabled) return { fault: 'botao Receber desabilitado' };
    const start = performance.now();
    button.click();
    const local = performance.now() - start;
    while (!document.querySelector('#modal form [name=valor]')) {
      if (performance.now() - start > 6000) return { fault: 'formulario nao abriu', localMs: local, toasts: window.__toasts.slice(-3), modal: document.querySelector('#modal')?.textContent.slice(0, 200), server: window.__fluidez.server, html: button.outerHTML.slice(0, 200), connected: button.isConnected };
      await new Promise(r => setTimeout(r, 4));
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const total = performance.now() - start, snap = window.__fluidez.snapshot();
    return { clickMs: local, paintedMs: total, serverMs: snap.serverMs, serverCalls: snap.serverCalls, localAfterServerMs: Math.max(0, total - local - snap.serverMs) };
  }, S.receive(id), id);
  await page.evaluate(S => { const i = document.querySelector(S.search); i.value = 'Cliente QA 00003'; i.dispatchEvent(new Event('input', { bubbles: true })); }, S);
  await sleep(900);
  result.timings.abrirRecebimento = await openReceive(RECEIVE_ID);
  result.checks.receiveForm = await page.evaluate(() => {
    const form = document.querySelector('#modal form');
    return form && { value: form.elements.valor.value, max: form.elements.valor.max, kindRadios: form.querySelectorAll('[name=kind]').length, outcomeKind: form.querySelector('[data-receive-outcome]')?.dataset.kind || null,
      text: form.querySelector('.modal-body').innerText.replace(/\s+/g, ' ').slice(0, 600) };
  });
  if (SHOTS) await page.screenshot({ path: path.join(OUT, `${LABEL}-${result.profile}-${volume}-recebimento.png`) });
  // Modal aberto: atualizações automáticas não podem fechar nem limpar o formulário.
  if (result.checks.receiveForm) {
    await page.evaluate(() => { const v = document.querySelector('#modal [name=valor]'); v.value = '12.34'; v.dispatchEvent(new Event('input', { bubbles: true })); });
    const c = await counts(async () => {
      await page.evaluate(() => dispatchEvent(new CustomEvent('financial-state-updated', { detail: {} })));
      await page.evaluate(() => dispatchEvent(new CustomEvent('cloud-data-updated', { detail: { collection: 'clients' } })));
      await page.evaluate(() => dispatchEvent(new Event('fiado-conditions-updated')));
    });
    result.events['modal+atualizacoes'] = { ...c, after: await state() };
  }
  // Recebimento parcial: o sistema identifica o tipo e mostra o que fica em aberto.
  result.checks.partialPreview = await page.evaluate(() => {
    const form = document.querySelector('#modal form');
    return form && { text: form.querySelector('.modal-body').innerText.replace(/\s+/g, ' ').slice(0, 600), checkedKind: form.querySelector('[name=kind]:checked')?.value || null, outcomeKind: form.querySelector('[data-receive-outcome]')?.dataset.kind || null };
  });
  log('passo 8');
  // 8. Confirmar o pagamento parcial (servidor responde após a latência).
  result.timings.confirmarPagamento = await page.evaluate(async () => {
    window.__fluidez.reset();
    const form = document.querySelector('#modal form'), start = performance.now();
    form.requestSubmit(form.querySelector('[data-receive-confirm]'));
    const local = performance.now() - start;
    let pendingAt = null;
    while (!/Pagamento recebido/.test(document.querySelector('#modal')?.textContent || '')) {
      const text = document.querySelector('#modal')?.textContent || '';
      if (pendingAt === null && /Aguardando confirmação/.test(text)) pendingAt = performance.now() - start;
      const error = document.querySelector('#modal [data-receive-feedback]')?.textContent;
      if (error) return { fault: error, localMs: local };
      if (performance.now() - start > 12000) return { fault: 'recibo nao confirmado', localMs: local, pendingAt };
      await new Promise(r => setTimeout(r, 4));
    }
    const total = performance.now() - start, snap = window.__fluidez.snapshot();
    const balance = document.querySelector('[data-receipt-balance]')?.textContent || '';
    return { submitMs: local, pendingShownMs: pendingAt, confirmedMs: total, serverMs: snap.serverMs, serverCalls: snap.serverCalls, balanceShown: balance };
  });
  await page.evaluate(() => Modais.fechar());
  await sleep(600);
  result.events['apos-recibo'] = await counts(async () => {});

  log('passo 9');
  // 9. Recebimento integral e parcelas futuras (prévia).
  await page.evaluate(S => { const i = document.querySelector(S.search); i.value = 'Cliente QA 00006'; i.dispatchEvent(new Event('input', { bubbles: true })); }, S);
  await sleep(900);
  result.timings.abrirRecebimentoFuturas = await openReceive(FUTURE_ID);
  result.checks.futureForm = await page.evaluate(() => {
    const form = document.querySelector('#modal form');
    if (!form) return null;
    const read = () => form.querySelector('.modal-body').innerText.replace(/\s+/g, ' ');
    const out = { initial: read(), value: form.elements.valor.value, max: form.elements.valor.max };
    form.elements.advance.checked = true; form.elements.advance.dispatchEvent(new Event('change'));
    out.advance = { value: form.elements.valor.value, max: form.elements.valor.max, text: read() };
    form.elements.advance.checked = false; form.elements.advance.dispatchEvent(new Event('change'));
    out.advanceOff = { value: form.elements.valor.value, max: form.elements.valor.max };
    return out;
  });
  if (SHOTS) await page.screenshot({ path: path.join(OUT, `${LABEL}-${result.profile}-${volume}-futuras.png`) });
  // Falha de conexão no envio: sem sucesso falso, formulário preservado.
  result.checks.connectionFailure = await page.evaluate(async () => {
    window.__fixtureServer.fail = true;
    const form = document.querySelector('#modal form');
    form.requestSubmit(form.querySelector('[data-receive-confirm]'));
    const start = performance.now();
    while (!document.querySelector('#modal [data-receive-feedback]')?.textContent && performance.now() - start < 6000) await new Promise(r => setTimeout(r, 10));
    window.__fixtureServer.fail = false;
    return { feedback: document.querySelector('#modal [data-receive-feedback]')?.textContent || null, formOpen: !!document.querySelector('#modal form [name=valor]'),
      success: /Pagamento recebido/.test(document.querySelector('#modal')?.textContent || ''), payments: window.__fixtureServer.payments.length };
  });
  // Resposta pendente: o recibo não é mostrado antes da confirmação do servidor.
  result.checks.pendingResponse = await page.evaluate(async () => {
    const server = window.__fixtureServer; server.confirmAfterMs = 60000;
    const form = document.querySelector('#modal form');
    form.requestSubmit(form.querySelector('[data-receive-confirm]'));
    const start = performance.now();
    while (!/Aguardando confirmação|Pagamento recebido/.test(document.querySelector('#modal')?.textContent || '') && performance.now() - start < 8000) await new Promise(r => setTimeout(r, 10));
    const text = document.querySelector('#modal')?.textContent || '';
    server.confirmAfterMs = server.latency;
    return { pending: /Aguardando confirmação/.test(text), successBeforeReceipt: /Pagamento recebido/.test(text) };
  });
  await page.evaluate(() => Modais.fechar());
  await sleep(500);

  log('passo 10');
  // 10. Mudança de espaço: uma única remontagem, busca da tela anterior não vaza.
  result.events['mudanca-de-espaco'] = await counts(() => page.evaluate(() => { window.__setFixtureScope('scope-b'); dispatchEvent(new Event('veconi-space-context-changed')); }), 1800);
  result.checks.afterSpace = await state();
  log('passo 11');
  // 11. Filtro e ordenação preservados após atualização.
  await page.evaluate(mobile => { (mobile ? document.querySelector('[data-mobile-filter="debito"]') : document.querySelector('[data-client-chip="debito"]'))?.click(); }, mobile);
  await sleep(900);
  const filtered = await page.evaluate(mobile => ({ active: document.querySelector(mobile ? '.mobile-filter-chip.active' : '.client-chip.active')?.textContent.trim(), sort: document.querySelector(mobile ? '#mobile-client-sort' : '#client-sort')?.value }), mobile);
  const c = await counts(() => page.evaluate(() => dispatchEvent(new CustomEvent('financial-state-updated', { detail: {} }))));
  const after = await page.evaluate(mobile => ({ active: document.querySelector(mobile ? '.mobile-filter-chip.active' : '.client-chip.active')?.textContent.trim(), sort: document.querySelector(mobile ? '#mobile-client-sort' : '#client-sort')?.value }), mobile);
  result.events['filtro+financial'] = { ...c, before: filtered, after, kept: JSON.stringify(filtered) === JSON.stringify(after) };
  return result;
}

async function main() {
  const server = helpers.assetServer(file => file === '/tests/performance-lab-shell.html' ? routeFixture : null);
  const base = await helpers.listen(server);
  const browser = await require('puppeteer-core').launch({ headless: true, protocolTimeout: 180000, args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'], executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const results = [];
  const profiles = [{ mobile: true, theme: 'light' }, { mobile: false, theme: 'light' }].filter(p => !ONLY || ONLY === (p.mobile ? 'mobile' : 'desktop'));
  try {
    for (const profile of profiles) for (const volume of ['large']) {
      const ctx = await browser.createBrowserContext(), page = await ctx.newPage(), errors = [];
      try {
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 300)));
        page.on('dialog', d => d.accept().catch(() => {}));
        await helpers.setup(page, { ...profile, allowed: [base] });
        if (!profile.mobile) await page.setViewport({ width: 1366, height: 900 });
        await page.evaluateOnNewDocument(probeSource);
        await page.evaluateOnNewDocument(() => { try { localStorage.setItem('adiFestaClientSwipeHint_v1', '1'); } catch {} });
        await page.goto(base + '/tests/performance-lab-shell.html?visual=inicio&volume=' + volume, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio', { timeout: 30000, polling: 200 });
        await page.evaluate(serverStubs, LATENCY);
        let row;
        try { row = await scenario(page, profile, volume); }
        catch (error) { row = currentResult || {}; row.fault = String(error.message).slice(0, 300); if (SHOTS) await page.screenshot({ path: path.join(OUT, `${LABEL}-${profile.mobile ? 'mobile' : 'desktop'}-falha.png`) }).catch(() => {}); }
        row.errors = errors;
        results.push(row);
        console.log(JSON.stringify({ profile: row.profile, errors: errors.length }));
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); server.close(); }
  const file = path.join(OUT, `${LABEL}.json`);
  fs.writeFileSync(file, JSON.stringify({ label: LABEL, latencyMs: LATENCY, root: path.basename(ROOT), results }, null, 2));
  console.log('Relatório: ' + path.relative(process.cwd(), file));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
