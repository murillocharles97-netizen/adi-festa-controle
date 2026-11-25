'use strict';
// Auditoria de fluidez e de saldo intermitente (V242.11+).
// App real (laboratório de desempenho do repositório) + dados e servidor FICTÍCIOS.
// Reproduz o uso de um proprietário com Espaço ativo e clientes com dívida histórica
// regularizada por Espaço, que dependem da conta confirmada no servidor:
//   - navegação contínua Clientes → Cobranças (Fiado) → Dashboard → Vendas → Clientes;
//   - sincronização em segundo plano (status, clientes, pagamentos, estado financeiro);
//   - internet lenta e instável (latência variável, falhas, períodos offline);
//   - expiração da confirmação financeira (60 s), troca de Espaço e vendas durante a sincronização.
// Mede: consultas ao servidor (duplicadas e concorrentes), sumiços do saldo confirmado,
// tempo até o saldo aparecer, renderizações, tarefas longas, timers ativos e memória.
// Uso: node scripts/audit-saldo-fluidez.cjs --root <árvore> --label nome --clients 2000 --minutes 3
// Nenhum acesso à nuvem: todo host que não seja 127.0.0.1 é bloqueado.
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const ROOT = path.resolve(option('root', path.join(__dirname, '..')));
const LABEL = option('label', path.basename(ROOT));
const CLIENTS = Number(option('clients', 2000));
const MINUTES = Number(option('minutes', 3));
const SEED = Number(option('seed', 7));
const PROFILE = args.includes('--profile');
const OUT = path.resolve(option('out', path.join(__dirname, '..', 'qa-artifacts', 'saldo-fluidez')));
fs.mkdirSync(OUT, { recursive: true });
const helpers = require(path.join(ROOT, 'scripts', 'performance-lab-helpers.cjs'));
const { routeFixture } = require(path.join(ROOT, 'scripts', 'audit-performance-runtime-c643cc5.cjs'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const REGULARIZED = ['bench-c1', 'bench-c2', 'bench-c5'];

// Volume configurável sem mudar o laboratório: o mesmo gerador, com N clientes.
const fixture = routeFixture.replace('const n = large ? 2000 : 25, salesCount = large ? 5000 : 50, payCount = large ? 1600 : 20;',
  'const n = Number(new URLSearchParams(location.search).get("clients")) || (large ? 2000 : 25), salesCount = Math.round(n * 2.5), payCount = Math.round(n * 0.8);');
if (fixture === routeFixture) throw Error('Gerador do laboratório mudou: não foi possível ajustar o volume.');

// Instrumentação instalada antes do app.
function probeSource() {
  const probe = window.__saldo = {
    t0: performance.now(), calls: [], inflight: 0, maxInflight: 0, timeouts: 0, intervals: new Map(), mutations: 0, balanceSwaps: 0, cardsReplaced: 0,
    renders: { page: 0, card: 0, refresh: 0 }, visits: [], samples: 0, errors: [],
  };
  const nativeSetInterval = window.setInterval, nativeClearInterval = window.clearInterval, nativeSetTimeout = window.setTimeout;
  window.setInterval = function (fn, ms, ...rest) { const id = nativeSetInterval.call(window, fn, ms, ...rest); probe.intervals.set(id, ms); return id; };
  window.clearInterval = function (id) { probe.intervals.delete(id); return nativeClearInterval.call(window, id); };
  window.setTimeout = function (...a) { probe.timeouts++; return nativeSetTimeout.apply(window, a); };
  addEventListener('error', e => probe.errors.push(String(e.message).slice(0, 200)));
  const BAL = '.mobile-client-balance,.client-balance,.client-status';
  new MutationObserver(records => {
    probe.mutations += records.length;
    for (const r of records) for (const node of r.removedNodes) if (node.nodeType === 1) {
      if (node.matches(BAL)) probe.balanceSwaps++;
      if (node.matches('.mobile-swipe-shell,[data-client-id]')) probe.cardsReplaced++;
    }
  }).observe(document, { childList: true, subtree: true });
}

// Servidor, Espaços e dados fictícios.
function stubs(config) {
  let seed = config.seed;
  const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const probe = window.__saldo, delay = ms => new Promise(r => setTimeout(r, ms));
  const today = () => window.InstallmentPlan.today();
  const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const spaces = [{ id: 'space-a', name: 'Espaço A' }, { id: 'space-b', name: 'Espaço B' }];
  let active = 'space-a', epoch = 1;
  const context = window.BusinessContext.get();
  const owned = { ...context, userProfile: { uid: 'fixture-owner', businessId: context.businessId, active: true }, business: { id: context.businessId, ownerId: 'fixture-owner' } };
  window.BusinessContext = { get: () => owned };
  Object.assign(window.SpaceContext, {
    activeId: () => active, viewScope: () => JSON.stringify([epoch, active]), scopesCustomers: () => true, selectionLabel: () => spaces.find(s => s.id === active).name,
    salesSpaces: () => spaces, customerSpaces: () => spaces, homeSpaces: () => spaces, operationalSpaces: () => spaces,
    requireSalesSpace: () => active, recordSpace: row => row?.spaceId || active, salesId: () => active, showsRenewal: () => true,
    contextualData: (data, kind) => kind !== 'clients' ? data : { ...data, clientes: (data.clientes || []).filter(c => (c.customerSpaceIds || []).includes(active)), unassignedCustomers: [] },
  });
  window.__setSpace = id => { active = id; epoch++; dispatchEvent(new Event('veconi-space-context-changed')); };
  // Rede: latência base, modo instável (variação + falhas) e modo offline.
  const net = window.__net = { latency: config.latency, unstable: false, failRate: 0 };
  const accountFor = clientId => {
    const client = DB.carregar().clientes.find(c => c.id === clientId);
    if (!client) return null;
    const cents = Math.round(Math.max(0, -Number(client.saldo || 0)) * 100);
    const space = (client.customerSpaceIds || [])[0] || 'space-a';
    const entries = cents ? [{ saleId: 'origem-' + clientId, number: 1, dueDate: addDays(today(), -10), remainingCents: cents, spaceId: space }] : [];
    return { clientId, version: 2, historyProofVersion: 1, scopedReceiptVersion: 1, financialVersion: Number(client.financialVersion || 0), creditCents: Math.max(0, Math.round(Number(client.saldo || 0) * 100)),
      asOf: today(), dueCents: cents, futureCents: 0, totalCents: cents, entries };
  };
  window.FirebaseCallable = async (name, data) => {
    const started = performance.now(), row = { name, kind: data?.kind, clientId: data?.clientId, at: started - probe.t0, ok: false };
    probe.calls.push(row); probe.inflight++; probe.maxInflight = Math.max(probe.maxInflight, probe.inflight);
    try {
      const wait = net.unstable ? 200 + random() * 2300 : net.latency * (0.8 + random() * 0.4);
      await delay(wait);
      if (navigator.onLine === false || net.unstable && random() < net.failRate) throw Object.assign(Error('Falha de rede simulada.'), { code: 'functions/unavailable' });
      const base = { businessId: DB.getBusinessId(), workspaceGeneration: DB.getWorkspaceGeneration?.() ?? 0 };
      let reply = { data: {} };
      if (data.kind === 'fiado_account') reply = { data: { ...base, account: accountFor(data.clientId) } };
      else if (data.kind === 'fiado_receipt_route') {
        const account = accountFor(data.clientId);
        reply = { data: { ...base, receiptRouteVersion: 1, clientId: data.clientId, spaceId: active, mode: 'space', scopedReceiptVersion: 1, quoteHash: 'a'.repeat(64),
          financialVersion: account.financialVersion, asOf: account.asOf, dueCents: account.dueCents, futureCents: 0, totalCents: account.totalCents, scopedAccount: account } };
      } else if (data.kind === 'fiado_conditions_list') reply = { data: { rows: [], cursor: null } };
      else if (data.kind === 'fiado_conditions') reply = { data: { clientId: data.clientId, configured: false, confirmed: true } };
      row.ok = true;
      return reply;
    } finally { row.ms = performance.now() - started; probe.inflight--; }
  };
  // Clientes: 80% no Espaço A, 20% no B; um em cada quatro do A com Fiado comum;
  // três com dívida histórica regularizada por Espaço (dependem da conta do servidor).
  DB.alterar(db => {
    for (const payment of db.pagamentos || []) Object.assign(payment, { status: 'applied', applicationStatus: 'applied', financialAppliedAt: payment.data });
    db.clientes.forEach(client => {
      if (!String(client.id).startsWith('bench-c')) return;
      const i = Number(client.id.slice(7)), space = i % 5 === 4 ? 'space-b' : 'space-a';
      Object.assign(client, { telefone: '119' + String(10000000 + i).padStart(8, '0'), spaceId: space, customerSpaceIds: [space], totalComprado: 100 + (i % 50) });
      if (config.regularized.includes(client.id)) {
        Object.assign(client, { spaceId: 'space-a', customerSpaceIds: ['space-a'], saldo: -(80 + i * 11.5), financialVersion: 2, fiadoHistoryVersion: 1, totalComprado: 9000 + i,
          fiadoHistoryActivation: { spaceRegularization: { version: 1, at: new Date(Date.now() - 864e5).toISOString(), operationId: 'reg-' + client.id } } });
        return;
      }
      if (space !== 'space-a' || i % 4 !== 0) return;
      const amount = 20 + (i % 30) * 3;
      client.saldo = -amount; client.financialVersion = 1;
      db.vendas.push({ id: 'fiado-' + client.id, clienteId: client.id, clienteNome: client.nome, data: new Date(Date.now() - 20 * 864e5).toISOString(), businessId: DB.getBusinessId(),
        spaceId: 'space-a', financialSpaceId: 'space-a', formaPagamento: 'fiado', status: 'fiado', valorFinal: amount, creditOriginalAmount: amount, creditPaidAmount: 0, creditRemainingAmount: amount, itens: [] });
    });
  });
  // Contagem de renderizações das telas de clientes.
  for (const [object, method, key] of [[window.ClientesPage, 'render', 'page'], [window.ClientesPage, 'refresh', 'refresh'], [window.ClientesMobile, 'renderCard', 'card'], [window.ClientesPage, 'renderCard', 'card']]) {
    const original = object?.[method];
    if (typeof original === 'function') object[method] = function (...a) { probe.renders[key]++; return original.apply(this, a); };
  }
  // Amostragem do saldo dos clientes regularizados enquanto a tela de Clientes está aberta.
  const state = new Map();
  let visit = null;
  setInterval(() => {
    probe.samples++;
    const route = window.Router?.atual?.();
    if (route !== 'clientes') { if (visit) { visit.leftAt = performance.now() - probe.t0; visit = null; } state.clear(); return; }
    if (!visit) { visit = { enteredAt: performance.now() - probe.t0, firstShown: {}, gaps: 0, hiddenMs: 0, staleMarked: 0, longestGapMs: 0 }; probe.visits.push(visit); }
    for (const id of config.regularized) {
      const card = document.querySelector(`[data-swipe-client="${id}"],[data-client-id="${id}"]`);
      if (!card) continue;
      const amount = card.querySelector('.mobile-client-balance strong,.client-balance strong')?.textContent || '';
      const shown = /R\$\s?[\d.]+,\d\d/.test(amount);
      if (card.querySelector('[data-balance-freshness="refreshing"],[data-balance-freshness="stale"]')) visit.staleMarked++;
      const now = performance.now() - probe.t0, s = state.get(id) || { shown: false, everShown: false, hiddenSince: null };
      if (shown && !s.everShown) { visit.firstShown[id] = Math.round(now - visit.enteredAt); s.everShown = true; }
      else if (s.everShown && s.shown && !shown) { visit.gaps++; s.hiddenSince = now; }
      else if (s.everShown && !s.shown && shown && s.hiddenSince !== null) { const gap = now - s.hiddenSince; visit.hiddenMs += gap; visit.longestGapMs = Math.max(visit.longestGapMs, gap); s.hiddenSince = null; }
      s.shown = shown; state.set(id, s);
    }
  }, 200);
  window.__finishVisit = () => {
    const now = performance.now() - probe.t0;
    if (visit) for (const s of state.values()) if (s.hiddenSince !== null) { const gap = now - s.hiddenSince; visit.hiddenMs += gap; visit.longestGapMs = Math.max(visit.longestGapMs, gap); s.hiddenSince = now; }
  };
}

function debugState(ids) {
  const card = id => document.querySelector(`[data-swipe-client="${id}"]`);
  return { route: Router.atual(), appRoute: document.querySelector('#app').dataset.route, local: Clientes.localListBalances?.(), scoped: Clientes.scopedScreen?.(),
    receive: TeamAccess.has?.('customers.receiveDebt'), view: TeamAccess.has?.('customers.view'), role: BusinessContext.get().role, has: ids.map(id => InstallmentCredit.has(id)),
    cards: ids.map(id => !!card(id)), first: [...document.querySelectorAll('[data-swipe-client]')].slice(0, 5).map(n => n.dataset.swipeClient),
    text: ids.map(id => card(id)?.querySelector('.mobile-client-balance')?.textContent.trim().replace(/\s+/g, ' ').slice(0, 80)), viewClients: Clientes.viewData().clientes.length };
}
async function navigate(page, route) {
  return page.evaluate(async route => {
    const start = performance.now(), app = document.querySelector('#app');
    window.__finishVisit?.();
    Router.ir(route);
    while (!(app.dataset.route === route && app.children.length)) { if (performance.now() - start > 8000) return { route, fault: 'rota não abriu' }; await new Promise(r => setTimeout(r, 4)); }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { route, ms: performance.now() - start };
  }, route);
}

async function run() {
  const server = helpers.assetServer(file => file === '/tests/performance-lab-shell.html' ? fixture : null);
  const base = await helpers.listen(server);
  const browser = await require('puppeteer-core').launch({ headless: true, protocolTimeout: 600000, args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'], executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const result = { label: LABEL, clients: CLIENTS, minutes: MINUTES, root: path.basename(ROOT), navigation: [], sales: [], memory: [], faults: [] };
  try {
    const page = await (await browser.createBrowserContext()).newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 200)));
    page.on('dialog', d => d.accept().catch(() => {}));
    const cdp = await helpers.setup(page, { mobile: true, theme: 'light', allowed: [base] });
    await page.evaluateOnNewDocument(probeSource);
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('adiFestaClientSwipeHint_v1', '1'); } catch {} });
    const loadStart = Date.now();
    await page.goto(base + `/tests/performance-lab-shell.html?visual=inicio&volume=large&clients=${CLIENTS}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio', { timeout: 180000, polling: 250 });
    result.loadMs = Date.now() - loadStart;
    await page.evaluate(stubs, { seed: SEED, latency: 450, regularized: REGULARIZED });
    result.fixture = await page.evaluate(() => ({ clients: DB.carregar().clientes.length, sales: DB.carregar().vendas.length, version: window.VECONI_BUILD?.appVersion || null }));
    await page.evaluate(() => { dispatchEvent(new CustomEvent('firebase-sync-status', { detail: { status: 'success' } })); });
    const memory = async tag => { const m = await helpers.metrics(cdp); result.memory.push({ tag, at: Math.round((Date.now() - loadStart) / 1000), heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, scriptS: +m.ScriptDuration.toFixed(2), taskS: +m.TaskDuration.toFixed(2) }); };
    await page.evaluate(() => { window.__saldo.calls.length = 0; window.__saldo.maxInflight = 0; window.__lab.long.length = 0; });
    await memory('início');
    const fire = (type, detail) => page.evaluate((type, detail) => dispatchEvent(new CustomEvent(type, { detail })), type, detail);
    if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
    const end = Date.now() + MINUTES * 60000;
    let minute = 0, sale = 0;
    // Sincronização em segundo plano, independente da navegação.
    let syncing = true;
    const background = (async () => {
      let tick = 0;
      while (syncing) {
        await sleep(5000); tick++;
        try {
          await fire('firebase-sync-status', { status: 'success' });
          if (tick % 4 === 0) await fire('cloud-data-updated', { collection: 'clients', source: 'snapshot' });
          if (tick % 9 === 0) await fire('cloud-data-updated', { collection: 'payments', source: 'snapshot' });
          if (tick % 12 === 0) await fire('financial-state-updated', {});
        } catch { /* página ocupada: o próximo ciclo tenta de novo */ }
      }
    })();
    while (Date.now() < end) {
      minute++;
      // Internet lenta e instável em minutos alternados; offline por 6 s nos minutos 3 e 7.
      await page.evaluate(m => { window.__net.unstable = m % 2 === 0; window.__net.failRate = m % 2 === 0 ? 0.15 : 0; }, minute);
      result.navigation.push(await navigate(page, 'clientes'));
      // Ordem por nome: os clientes regularizados de teste ficam na primeira página da lista.
      await page.evaluate(() => { const sort = document.querySelector('#mobile-client-sort'); if (sort && sort.value !== 'nomeAsc') { sort.value = 'nomeAsc'; sort.dispatchEvent(new Event('change', { bubbles: true })); } });
      await sleep(5000);
      if (process.env.SALDO_DEBUG && minute === 1) console.log(JSON.stringify(await page.evaluate(debugState, REGULARIZED)));
      await page.evaluate(() => scrollTo({ top: 1400, behavior: 'instant' }));
      await sleep(4000);
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      if (minute === 3 || minute === 7) {
        await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await sleep(6000);
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 200000, uploadThroughput: 93750 });
      }
      await sleep(16000);
      if (minute === 5) { await page.evaluate(() => window.__setSpace('space-b')); await sleep(6000); await page.evaluate(() => window.__setSpace('space-a')); await sleep(6000); }
      result.navigation.push(await navigate(page, 'cobrancas'));
      await sleep(8000);
      result.navigation.push(await navigate(page, 'inicio'));
      await sleep(8000);
      result.navigation.push(await navigate(page, 'vender'));
      // Venda registrada durante a sincronização.
      sale++;
      await fire('cloud-data-updated', { collection: 'sales', source: 'snapshot' });
      result.sales.push(await page.evaluate(n => {
        const start = performance.now();
        try {
          Vendas.registrar({ id: 'qa-venda-' + n, operationId: 'qa-op-' + n, spaceId: SpaceContext.activeId(), status: 'pago', formaPagamento: 'pix',
            itens: [{ produtoId: 'bench-p1', nome: 'Produto QA 00001', quantidade: 1, precoOriginal: 10, precoFinalUnitario: 10 }] });
          return { ms: performance.now() - start, ok: true };
        } catch (error) { return { ms: performance.now() - start, ok: false, error: String(error.message).slice(0, 160) }; }
      }, sale));
      await sleep(7000);
      await memory('minuto ' + minute);
    }
    await page.evaluate(() => window.__finishVisit?.());
    if (PROFILE) result.profile = helpers.profiler((await cdp.send('Profiler.stop')).profile);
    syncing = false; await background;
    const probe = await page.evaluate(() => {
      const p = window.__saldo;
      return { calls: p.calls, maxInflight: p.maxInflight, timeouts: p.timeouts, intervals: [...p.intervals.values()], mutations: p.mutations, balanceSwaps: p.balanceSwaps, cardsReplaced: p.cardsReplaced,
        renders: p.renders, visits: p.visits, errors: p.errors, long: window.__lab.long };
    });
    result.pageErrors = pageErrors;
    result.raw = probe;
    result.summary = summarize(result, probe);
  } catch (error) {
    result.faults.push(String(error.stack || error.message).slice(0, 600));
  } finally { await browser.close(); server.close(); }
  const file = path.join(OUT, `${LABEL}-${CLIENTS}-${MINUTES}min.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ label: LABEL, clients: CLIENTS, minutes: MINUTES, summary: result.summary, faults: result.faults, file }));
}

function pct(list, p) { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); }
function summarize(result, probe) {
  const fiado = probe.calls.filter(c => c.kind === 'fiado_account');
  let duplicates = 0;
  const last = new Map();
  for (const c of fiado) { const prev = last.get(c.clientId); if (prev !== undefined && c.at - prev < 10000) duplicates++; last.set(c.clientId, c.at); }
  const visits = probe.visits.filter(v => v.leftAt !== undefined || true);
  const firstShown = visits.flatMap(v => Object.values(v.firstShown));
  const nav = route => result.navigation.filter(n => n.route === route && n.ms).map(n => n.ms);
  const minutes = result.minutes;
  const long = probe.long.filter(t => t.at > 0);
  const heap = result.memory.map(m => m.heapMB);
  return {
    serverCalls: probe.calls.length, fiadoAccountCalls: fiado.length, fiadoCallsPerMinute: +(fiado.length / minutes).toFixed(1), duplicateFiadoCallsWithin10s: duplicates,
    failedCalls: probe.calls.filter(c => !c.ok).length, maxConcurrentCalls: probe.maxInflight,
    balanceGaps: visits.reduce((n, v) => n + v.gaps, 0), balanceHiddenSeconds: +(visits.reduce((n, v) => n + v.hiddenMs, 0) / 1000).toFixed(1),
    longestGapSeconds: +(Math.max(0, ...visits.map(v => v.longestGapMs)) / 1000).toFixed(1), staleMarkerSamples: visits.reduce((n, v) => n + v.staleMarked, 0),
    timeToBalanceMs: { p50: pct(firstShown, 0.5), p95: pct(firstShown, 0.95), samples: firstShown.length },
    renders: probe.renders, balanceSwaps: probe.balanceSwaps, cardsReplaced: probe.cardsReplaced, mutationsPerMinute: Math.round(probe.mutations / minutes),
    longTasks: long.length, longTaskMs: Math.round(long.reduce((n, t) => n + t.ms, 0)), longestTaskMs: Math.round(Math.max(0, ...long.map(t => t.ms))),
    navigationMs: Object.fromEntries(['clientes', 'cobrancas', 'inicio', 'vender'].map(r => [r, { p50: pct(nav(r), 0.5), p95: pct(nav(r), 0.95) }])),
    saleMs: { p50: pct(result.sales.map(s => s.ms), 0.5), max: Math.round(Math.max(0, ...result.sales.map(s => s.ms))), failed: result.sales.filter(s => !s.ok).length },
    heapMB: { start: heap[0], end: heap[heap.length - 1], max: Math.max(...heap) }, nodesEnd: result.memory.at(-1)?.nodes, listenersEnd: result.memory.at(-1)?.listeners,
    activeIntervals: probe.intervals.length, timeoutsPerMinute: Math.round(probe.timeouts / minutes), pageErrors: (result.pageErrors || []).length,
  };
}
run().catch(error => { console.error(error); process.exitCode = 1; });
