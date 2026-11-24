'use strict';
// V242.7: the mobile client list is patched in place. An automatic update keeps
// the search field (same node, focus, caret), every unchanged card node and the
// open sheet; only the card whose data changed is replaced, without replaying
// the entrance animation. Fictitious data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function mount({ desktop = false } = {}) {
  const dom = new JSDOM('<main id="app"></main><div id="modal"></div>', { url: 'https://qa.example.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const data = {
    config: { nome: 'Loja QA' }, vendas: [], pagamentos: [], cobrancas: [], messageHistory: [],
    clientes: Array.from({ length: 8 }, (_, i) => ({ id: 'qa-' + i, nome: 'Cliente QA ' + i, telefone: '1190000000' + i, saldo: i % 2 ? -10 * (i + 1) : 0, ativo: true })),
  };
  w.matchMedia = () => ({ matches: !desktop, addEventListener() {} });
  w.scrollTo = () => {};
  w.Router = { atual: () => 'clientes', ir() {} };
  w.Utils = { dinheiro: v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','), escapar: v => String(v ?? '').replace(/[&<>"']/g, ''), toast() {}, uuid: () => 'qa' };
  w.DB = { carregar: () => data };
  const status = client => { const saldo = Number(client.saldo || 0); return { saldo, futureCents: 0, status: saldo < 0 ? 'debt' : saldo > 0 ? 'credit' : 'zero', debt: Math.max(0, -saldo), credit: Math.max(0, saldo) }; };
  w.Clientes = { viewData: () => data, listar: () => data.clientes, obter: id => data.clientes.find(c => c.id === id), financialStatus: status, listFinancialStatus: status, prepareList() {}, scopedScreen: () => false };
  w.Mensagens = { latestCharge: () => null, chargeBand: () => '', formatLastChargeDate: () => 'Nunca', wasChargedToday: () => false, canSend: () => false };
  w.Cobrancas = { ultimaCliente: () => null };
  w.CustomerSubscriptions = { list: () => [] };
  w.Modais = { fechar() {} };
  let iconRuns = 0;
  w.lucide = { createIcons() { iconRuns++; } };
  for (const file of ['js/client-filter-rules.js', 'js/clientes-page.js', 'js/clientes-mobile.js']) w.eval(fs.readFileSync(file, 'utf8'));
  w.document.querySelector('#app').innerHTML = w.ClientesPage.render();
  return { w, data, dom, iconRuns: () => iconRuns };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('automatic update keeps the search node, focus, caret and unchanged cards', async () => {
  const { w, data, dom } = mount();
  try {
    await tick();
    const page = w.document.querySelector('.clients-mobile-page');
    const search = w.document.querySelector('#mobile-client-search');
    const cards = new Map([...w.document.querySelectorAll('[data-swipe-client]')].map(node => [node.dataset.swipeClient, node]));
    assert.equal(cards.size, 8);
    search.focus(); search.value = 'Cliente'; search.setSelectionRange(3, 3);
    w.ClientesMobile.setSearchTerm('Cliente');
    data.clientes[3].saldo = -99; // a payment changed one balance
    w.ClientesPage.refresh();
    assert.equal(w.document.querySelector('.clients-mobile-page'), page, 'page rebuilt');
    assert.equal(w.document.querySelector('#mobile-client-search'), search, 'search field rebuilt');
    assert.equal(w.document.activeElement, search);
    assert.equal(search.selectionStart, 3);
    assert.equal(search.value, 'Cliente');
    for (const [id, node] of cards) {
      const current = w.document.querySelector(`[data-swipe-client="${id}"]`);
      if (id === 'qa-3') {
        assert.notEqual(current, node, 'changed card must be rendered again');
        assert.match(current.querySelector('.mobile-client-balance strong').textContent, /99,00/);
      } else assert.equal(current, node, 'unchanged card ' + id + ' was recreated');
    }
    assert.equal(page.dataset.cardsSettled, 'true', 'entrance animation must not replay');
    assert.equal(page.querySelector('.mobile-search-clear') !== null, true);
  } finally { await tick(); dom.window.close(); }
});

test('sorting and filters reorder without recreating cards; the sheet keeps its nodes', async () => {
  const { w, dom } = mount();
  try {
    await tick();
    const page = w.document.querySelector('.clients-mobile-page');
    const before = new Map([...page.querySelectorAll('[data-swipe-client]')].map(node => [node.dataset.swipeClient, node]));
    const sheet = page.querySelector('.mobile-filter-sheet');
    page.querySelector('#mobile-open-filters').click();
    assert.equal(page.querySelector('.mobile-filter-sheet'), sheet);
    assert.equal(sheet.classList.contains('open'), true);
    page.querySelector('[data-close-mobile-sheet]').click();
    assert.equal(sheet.classList.contains('open'), false);
    const sort = page.querySelector('#mobile-client-sort');
    sort.value = 'nomeDesc'; sort.dispatchEvent(new w.Event('change', { bubbles: true }));
    const ids = [...page.querySelectorAll('[data-swipe-client]')].map(node => node.dataset.swipeClient);
    assert.deepEqual(ids, ['qa-7', 'qa-6', 'qa-5', 'qa-4', 'qa-3', 'qa-2', 'qa-1', 'qa-0']);
    for (const id of ids) assert.equal(page.querySelector(`[data-swipe-client="${id}"]`), before.get(id));
    page.querySelector('[data-mobile-filter="debito"]').click();
    const debtors = [...page.querySelectorAll('[data-swipe-client]')];
    assert.deepEqual(debtors.map(node => node.dataset.swipeClient), ['qa-7', 'qa-5', 'qa-3', 'qa-1']);
    for (const node of debtors) assert.equal(node, before.get(node.dataset.swipeClient));
    assert.equal(page.querySelector('.mobile-filter-chip.active')?.dataset.mobileFilter, 'debito');
  } finally { await tick(); dom.window.close(); }
});

test('a card edited in place by another module is rendered again on the next update', async () => {
  const { w, dom } = mount();
  try {
    await tick();
    const card = w.document.querySelector('[data-swipe-client="qa-1"]');
    card.querySelector('.mobile-client-balance strong').textContent = 'Consultando…';
    await tick(); // MutationObserver delivery
    w.ClientesPage.refresh();
    const current = w.document.querySelector('[data-swipe-client="qa-1"]');
    assert.notEqual(current, card);
    assert.match(current.querySelector('.mobile-client-balance strong').textContent, /20,00/);
  } finally { await tick(); dom.window.close(); }
});

test('desktop rebuild keeps the search typed during the debounce, focus and caret', async () => {
  const { w, dom } = mount({ desktop: true });
  try {
    await tick();
    const search = w.document.querySelector('#client-search');
    search.focus(); search.value = 'Cliente QA 3'; search.setSelectionRange(5, 5);
    w.ClientesPage.refresh();
    const current = w.document.querySelector('#client-search');
    assert.equal(w.document.activeElement, current);
    assert.equal(current.value, 'Cliente QA 3');
    assert.equal(current.selectionStart, 5);
  } finally { await tick(); dom.window.close(); }
});
