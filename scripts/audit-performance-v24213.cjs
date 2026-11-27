'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { routeFixture } = require('./audit-performance-runtime-c643cc5.cjs');
const { assetServer, launch, setup, metrics, delta, profiler, listen, save } = require('./performance-lab-helpers.cjs');

// Existing UI fixture, with a deterministic mix of debtors and collection notes.
const anchor = 'data.campanhas = [];';
assert.ok(routeFixture.includes(anchor));
const fixture = routeFixture.replace(anchor, `
  data.clientes.forEach((client, i) => {
    client.saldo = i % 5 === 0 ? 0 : -(i * 377 % 9001 + 100) / 100;
  });
  const notes = data.clientes.length > 100 ? 1600 : 20;
  data.cobrancas = Array.from({length: notes}, (_, i) => ({
    id: 'qa-charge-' + i, clienteId: data.clientes[i % data.clientes.length].id,
    data: iso(i % 30 + 1), status: 'ignorado'
  }));
` + anchor);
const baseRef = process.env.PERF_BASE_REF;
const baselineModules = new Map();
if (baseRef) {
  for (const file of ['js/app.js', 'js/cobrancas.js', 'js/business-cache.js'])
    baselineModules.set('/' + file, execFileSync('git', ['show', baseRef + ':' + file], {encoding:'utf8'}));
}
const server = assetServer(url => url === '/tests/perf-v24213.html' ? fixture : baselineModules.get(url) ?? null);
const rounds = Number(process.env.PERF_ROUNDS || 3);
const storageOnly = process.env.PERF_STORAGE_ONLY === '1';
const target = process.env.PERF_RUNTIME_OUTPUT || (storageOnly ? 'v24213-storage.json' : 'v24213-runtime.json');
const profiles = [
  {mobile:true, theme:'light', volume:'large'},
  {mobile:true, theme:'light', volume:'small'},
  {mobile:true, theme:'dark', volume:'large'},
];
const routes = ['clientes', 'cobrancas', 'inicio', 'vender', 'produtos', 'historico', 'relatorios']
  .filter(route => !process.env.PERF_ROUTES || process.env.PERF_ROUTES.split(',').includes(route));

async function navigate(page, route) {
  return page.evaluate(async route => {
    const app = document.querySelector('#app');
    if (app.dataset.route === route) throw Error('Selecione uma rota diferente para medir a navegação');
    const start = performance.now();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(Error('Rota não montada: ' + route));
      }, 3000);
      const observer = new MutationObserver(() => {
        if (app.dataset.route !== route || !app.children.length) return;
        clearTimeout(timer);
        observer.disconnect();
        resolve();
      });
      observer.observe(app, {attributes:true, childList:true});
      Router.ir(route);
    });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const end = performance.now();
    return {
      ms:end-start, nodes:app.querySelectorAll('*').length,
      chargeCards:app.querySelectorAll('.charge-card').length,
      productCards:app.querySelectorAll('.pos-product,.desktop-pos-card').length,
      long:window.__lab.long.filter(e => e.at >= start && e.at < end),
      error:app.querySelector('.boot-recovery')?.textContent.trim(),
    };
  }, route);
}

async function storage(page) {
  return page.evaluate(async () => {
    const prototype = IDBDatabase.prototype, original = prototype.transaction;
    let storageMs = 0, transactions = 0;
    prototype.transaction = function (...args) {
      const tx = Reflect.apply(original,this,args);
      if (this.name === 'veconi-local-records' && tx.mode === 'readwrite') {
        const start = performance.now();
        transactions++;
        tx.addEventListener('complete', () => { storageMs += performance.now() - start; }, {once:true});
      }
      return tx;
    };
    const start = performance.now();
    let oneChange, noChange, reopenOk, bytes;
    try {
      const current = DB.carregar();
      const changedName = current.produtos[0].nome + ' QA alterado';
      DB.alterar(data => { data.produtos[0].nome = changedName; });
      const synchronousMs = performance.now() - start;
      await DB.flush();
      const savedAt = performance.now();
      oneChange = {ms:savedAt-start, synchronousMs, storageMs, transactions};
      await new Promise(resolve => setTimeout(resolve,0));
      oneChange.long = window.__lab.long.filter(e => e.at >= start && e.at < savedAt);
      oneChange.commit = (await DB.businessCache.diagnostic()).lastCommit;
      const noChangeStarted = performance.now(), before = transactions;
      DB.alterar(() => {});
      await DB.flush();
      noChange = {ms:performance.now()-noChangeStarted, transactions:transactions-before};
      bytes = new TextEncoder().encode(JSON.stringify(DB.carregar())).length;
      await DB.businessCache.release();
      await DB.useBusiness('desktop-shell-fixture');
      reopenOk = DB.carregar().produtos[0].nome === changedName;
    } finally {
      prototype.transaction = original;
    }
    return {oneChange, noChange, bytes, reopenOk, long:window.__lab.long.filter(e => e.at >= start)};
  });
}

async function inspectChargeAndHome(page) {
  return page.evaluate(() => {
    const source = DB.carregar();
    const original = Clientes.financialStatus;
    let checks = 0;
    Clientes.financialStatus = (...args) => { checks++; return original(...args); };
    try {
      const listStart = performance.now();
      const ids = Cobrancas.listar('naoHoje').map(c => c.id);
      const list = {ms:performance.now()-listStart, checks, clients:ids.length};

      // Diagnostic counterfactual: memoize the SAME call for the duration of a
      // single synchronous list build. The original function still decides.
      const statuses = new Map();
      checks = 0;
      Clientes.financialStatus = (c, scope, options) => {
        if (!statuses.has(c)) {
          checks++;
          statuses.set(c, original(c, scope, options));
        }
        return statuses.get(c);
      };
      const cachedStart = performance.now();
      const cached = Cobrancas.listar('naoHoje').map(c => c.id);
      const memoized = {ms:performance.now()-cachedStart, checks};
      if (ids.join(',') !== cached.join(',')) throw Error('Diagnóstico alterou a lista');

      checks = 0;
      Clientes.financialStatus = (...args) => { checks++; return original(...args); };
      const homeStart = performance.now();
      const markup = MobileHome.render();
      const dashboard = {ms:performance.now()-homeStart, checks, htmlBytes:markup.length, sales:source.vendas.length};
      return {list, memoized, dashboard};
    } finally {
      Clientes.financialStatus = original;
    }
  });
}

async function cycle(page, cdp) {
  const input = '#mobile-client-search';
  const history = [];
  for (let n=0; n<5; n++) {
    const go = await navigate(page, 'clientes');
    if (go.error) throw Error(go.error);
    const instances = await page.evaluate(input => {
      const el = document.querySelector(input);
      return {buttons:document.querySelectorAll('#app button').length, hasSearch:!!el};
    }, input);
    const counters = await metrics(cdp);
    // CDP counts handlers on mounted as well as detached nodes until GC.
    const heap = await cdp.send('Runtime.evaluate', {expression:'window',objectGroup:'qa'});
    const listeners = await cdp.send('DOMDebugger.getEventListeners', {objectId:heap.result.objectId});
    await cdp.send('Runtime.releaseObjectGroup', {objectGroup:'qa'});
    const watched = ['hashchange', 'financial-state-updated', 'firebase-auth-ready', 'firebase-sync-status', 'operational-remote-invalidation', 'sale-exchange-metrics-updated'];
    history.push({...instances, nodes:counters.Nodes, domListeners:counters.JSEventListeners, heapMB:counters.JSHeapUsedSize/1048576,
      windowListeners:Object.fromEntries(watched.map(type => [type, listeners.listeners.filter(listener => listener.type===type).length]))});
    await navigate(page, 'inicio');
    await cdp.send('HeapProfiler.collectGarbage');
  }
  return history;
}

async function remoteRefresh(page) {
  return page.evaluate(async () => {
    const app = document.querySelector('#app'), first = app.firstElementChild;
    const original = app.dataset.pageInstance, route = app.dataset.route;
    const start = performance.now();
    const refresh = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(Error('Atualização de tela não observada'));
      }, 3000);
      const observer = new MutationObserver(() => {
        if (app.dataset.pageInstance === original) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(performance.now()-start);
      });
      observer.observe(app,{attributes:true,attributeFilter:['data-page-instance']});
    });
    for (let i=0; i<3; i++) dispatchEvent(new CustomEvent('cloud-data-updated',{detail:{collection:'products'}}));
    const mountMs = await refresh;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const end = performance.now();
    return {route,mountMs,ms:end-start,remounts:Number(app.dataset.pageInstance)-Number(original),
      previousRootReplaced:!first.isConnected,long:window.__lab.long.filter(e => e.at >= start && e.at < end)};
  });
}

async function main() {
  const base = await listen(server), browser = await launch(), rows = [];
  try {
    for (const profile of profiles) {
      if (process.env.PERF_PROFILE && !process.env.PERF_PROFILE.split(',').includes(profile.theme + '-' + profile.volume)) continue;
      for (let run=0; run<rounds; run++) {
        const scope = await browser.createBrowserContext(), page = await scope.newPage(), errors = [];
        try {
          page.on('pageerror', error => errors.push(error.message));
          const cdp = await setup(page, {...profile, allowed:[base]});
          await page.evaluateOnNewDocument(theme => localStorage.setItem('veconi-theme',theme), profile.theme);
          await page.goto(base + '/tests/perf-v24213.html?visual=inicio&volume=' + profile.volume, {waitUntil:'domcontentloaded',timeout:55000});
          await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio', {timeout:15000,polling:200});
          await cdp.send('HeapProfiler.collectGarbage');
          const counts = await page.evaluate(() => ({
            ...window.__fixtureLengths,
            notes:DB.carregar().cobrancas.length,
            theme:document.documentElement.dataset.theme,
          }));
          assert.equal(counts.theme, profile.theme);
          if (storageOnly) {
            const before = await metrics(cdp);
            const persistence = {...await storage(page),...delta(before,await metrics(cdp))};
            assert.ok(persistence.reopenOk);
            assert.equal(persistence.oneChange.transactions,1);
            assert.equal(persistence.noChange.transactions,0);
            rows.push({...profile,run,counts,persistence});
            save(target,rows);
            console.log(JSON.stringify({run,profile,counts,persistence}));
            continue;
          }
          const navigations = [];
          for (const visit of ['first', 'return']) {
            for (const route of routes) {
              const before = await metrics(cdp), errorCount = errors.length;
              const result = await navigate(page,route);
              navigations.push({route,visit,...result,...delta(before,await metrics(cdp)),errors:errors.slice(errorCount)});
            }
          }
          const beforeStorage = await metrics(cdp);
          const persistence = {...await storage(page),...delta(beforeStorage,await metrics(cdp))};
          assert.ok(persistence.reopenOk);
          const inspection = await inspectChargeAndHome(page);
          const remote = [];
          for (const route of ['cobrancas','inicio']) {
            await navigate(page,route);
            const before = await metrics(cdp);
            remote.push({...await remoteRefresh(page),...delta(before,await metrics(cdp))});
          }
          const profilesByOperation = {};
          let repeated = [];
          if (profile.volume === 'large' && run === 0) {
            await cdp.send('Profiler.enable');
            for (const operation of ['cobrancas','inicio','storage']) {
              await cdp.send('Profiler.start');
              if (operation === 'storage') await storage(page);
              else await navigate(page, operation);
              const raw = (await cdp.send('Profiler.stop')).profile;
              profilesByOperation[operation] = profiler(raw);
              save('v24213-cpu-' + profile.theme + '-' + operation + '.cpuprofile', raw);
            }
            repeated = await cycle(page,cdp);
          }
          rows.push({...profile,run,counts,navigations,persistence,inspection,remote,profilesByOperation,repeated,errors});
          save(target,rows);
          console.log(JSON.stringify({run,profile,counts,routeFaults:navigations.filter(row => row.error || row.errors.length).map(row => row.route),errors}));
        } finally { await scope.close(); }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

module.exports = { fixture };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
