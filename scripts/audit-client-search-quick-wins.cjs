'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { routeFixture } = require('./audit-performance-runtime-c643cc5.cjs');
const { assetServer, launch, listen, save, setup } = require('./performance-lab-helpers.cjs');

const reference = process.argv.includes('--baseline');
const referenceFiles = new Map();
if (reference) for (const file of ['app', 'clientes-mobile', 'customer-metrics', 'crm-segment-engine-v2']) {
  const pathname = '/js/' + file + '.js';
  referenceFiles.set(pathname, execFileSync('git', ['show', 'c643cc5:' + pathname.slice(1)], { encoding: 'utf8' }));
}
const route = '/tests/performance-lab-shell.html';
const server = assetServer(file => file === route ? routeFixture : referenceFiles.get(file) ?? null);
const profiles = [
  { mobile: false, theme: 'light' }, { mobile: false, theme: 'dark' },
  { mobile: true, theme: 'light' }, { mobile: true, theme: 'dark' },
];
const onlyMobile = process.env.PERF_SEARCH_ONLY_MOBILE === '1';
const debug = (...args) => { if (process.env.PERF_DEBUG) console.log(...args); };
const rounds = Number(process.env.PERF_ROUNDS || 3);
const results = [];

function driver(page, profile) {
  const search = profile.mobile ? '#mobile-client-search' : '#client-search';
  const cards = profile.mobile ? '[data-mobile-card]' : '#client-list [data-client-id]';
  const list = profile.mobile ? '#mobile-client-list' : '#client-list';
  const attribute = profile.mobile ? 'data-mobile-card' : 'data-client-id';

  async function input(value, start = false) {
    await page.$eval(search, (node, { value, start }) => {
      if (start) window.__quickSearchStart = performance.now();
      node.focus();
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }, { value, start });
  }
  async function visibleIds() {
    return page.$$eval(cards, (nodes, attr) => nodes.map(node => node.getAttribute(attr)), attribute);
  }
  async function rendered(expected) {
    await page.waitForFunction(({ cards, list, attribute, expected, search }) => {
      const items = [...document.querySelectorAll(cards)].map(node => node.getAttribute(attribute));
      if (expected === 'base') return document.querySelector(search)?.value === '' && items.length >= 20;
      if (expected) return items.length === 1 && items[0] === expected;
      return !items.length && /Nenhum cliente (?:encontrado|corresponde)/i.test(document.querySelector(list)?.textContent || '');
    }, { timeout: 2200, polling: 20 }, { cards, list, attribute, expected, search });
  }
  return { search, cards, list, input, visibleIds, rendered };
}

async function localSearch(page, mobile, check) {
  const probe = driver(page, { mobile });
  const samples = [];
  async function timed(name, text, expected) {
    try {
      await probe.input(text, true);
      await probe.rendered(expected);
      const ms = await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - window.__quickSearchStart;
      });
      samples.push({ name, ms });
    } catch (error) {
      samples.push({ name, fault: error.message });
      if (!reference) throw new Error(name + ': ' + error.message, { cause: error });
    }
  }

  await timed('com-resultado', 'Cliente QA 00013', 'bench-c13');
  await timed('sem-resultado', 'QA nome inexistente', null);
  await timed('limpar-digitando', '', 'base');
  if (!mobile || !check) return samples;

  debug('limpar durante debounce');
  await probe.input('QA nome inexistente');
  await page.$eval('.mobile-search-clear', button => button.click());
  await probe.rendered('base');
  await new Promise(resolve => setTimeout(resolve, 380));
  assert.equal(await page.$eval(probe.search, node => node.value), '');
  assert.equal(await page.evaluate(() => ClientesMobile.getState().query), '');
  assert.equal(await page.$('.mobile-client-empty'), null);

  await probe.input('QA nome inexistente');
  await probe.input('Cliente QA 00010');
  await probe.input('Cliente QA 00023');
  await probe.rendered('bench-c23');
  await page.$eval('.mobile-search-clear', button => button.click());
  await probe.rendered('base');

  debug('paginar lista grande');
  const first = await probe.visibleIds();
  assert.ok(first.length >= 20 && first.length < 2001);
  await page.$eval('#mobile-load-sentinel', node => node.scrollIntoView());
  await page.waitForFunction(({ cards, size }) => document.querySelectorAll(cards).length > size,
    { timeout: 2200 }, { cards: probe.cards, size: first.length });
  const next = await probe.visibleIds();
  assert.equal(new Set(next).size, next.length);
  return samples;
}

async function remoteSearch(page) {
  const probe = driver(page, { mobile: true });
  await page.evaluate(() => {
    window.__quickRequests = {};
    window.SyncFirebase.queryClientsPage = ({search}) => new Promise(resolve => {
      window.__quickRequests[search] = resolve;
    });
  });
  const request = value => page.waitForFunction(value => typeof window.__quickRequests[value] === 'function', { timeout: 2200 }, value);
  const resolve = (query, items) => page.evaluate(({ query, items }) => {
    window.__quickRequests[query]({ items, cursor: null, hasMore: false });
  }, { query, items });

  await probe.input('QA remoto antigo');
  await request('QA remoto antigo');
  assert.match(await page.$eval(probe.list, node => node.textContent), /Buscando/);
  await probe.input('QA remoto novo');
  await request('QA remoto novo');
  await resolve('QA remoto novo', [{ id: 'remote-new', nome: 'QA remoto novo', ativo: true, saldo: 0 }]);
  await probe.rendered('remote-new');
  await resolve('QA remoto antigo', [{ id: 'remote-old', nome: 'QA remoto antigo', ativo: true, saldo: 0 }]);
  assert.deepEqual(await probe.visibleIds(), ['remote-new']);

  await probe.input('QA remoto vazio');
  await request('QA remoto vazio');
  await resolve('QA remoto vazio', []);
  await probe.rendered(null);

  await page.evaluate(() => {
    window.SpaceContext.scopesCustomers = () => true;
    window.SpaceContext.viewScope = () => 'fixture-space:clients';
    ClientesMobile.applyFilter('debito');
  });
  await probe.input('QA inexistente neste espaço');
  await page.waitForFunction(() => /Nenhum débito confirmado/.test(document.querySelector('#mobile-client-list')?.textContent || ''), { timeout: 2400, polling: 30 });
  assert.equal(await page.evaluate(() => Object.hasOwn(window.__quickRequests, 'QA inexistente neste espaço')), false);
}

async function main() {
  const origin = await listen(server), browser = await launch();
  try {
    for (const profile of profiles) {
      if (process.env.PERF_PROFILE && process.env.PERF_PROFILE !== (profile.mobile ? 'mobile-' : 'desktop-') + profile.theme) continue;
      if (!profile.mobile && (reference || onlyMobile)) continue;
      for (const volume of ['small', 'large'].filter(volume => !process.env.PERF_VOLUME || process.env.PERF_VOLUME === volume)) {
        for (let run = 0; run < (profile.mobile ? rounds : 1); run++) {
          const context = await browser.createBrowserContext(), page = await context.newPage();
          const errors = [];
          try {
            page.on('pageerror', error => errors.push(error.message));
            await setup(page, { ...profile, allowed: [origin] });
            await page.evaluateOnNewDocument(theme => localStorage.setItem('veconi-theme', theme), profile.theme);
            debug('fixture', profile, volume, run);
            await page.goto(origin + route + '?visual=inicio&volume=' + volume, { waitUntil: 'domcontentloaded', timeout: 55000 });
            await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio', { timeout: 24000, polling: 100 });
            await page.evaluate(() => Router.ir('clientes'));
            await page.waitForSelector(profile.mobile ? '#mobile-client-search' : '#client-search', { visible: true, timeout: 15000 });
            const actual = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, clients: window.__fixtureLengths.clients }));
            assert.equal(actual.theme, profile.theme);
            assert.equal(actual.clients, volume === 'large' ? 2001 : 26);
            const checkMobile = !reference && volume === 'large' && run === 0;
            debug('busca local');
            const samples = await localSearch(page, profile.mobile, checkMobile);
            if (profile.mobile && checkMobile) { debug('busca remota'); await remoteSearch(page); }
            if (!reference) assert.deepEqual(errors, []);
            results.push({ ...profile, volume, run, samples, errors });
            save(reference ? 'search-before.json' : 'search-after.json', results);
            console.log(JSON.stringify({ ...profile, volume, run, samples, errors }));
          } finally { await context.close(); }
        }
      }
    }
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
