'use strict';
// V242.12: um saldo confirmado pelo servidor não some da tela enquanto é revalidado, e
// continua sem autorizar nada sozinho: recebimentos, cobranças e mensagens exigem a
// confirmação dentro da janela de 60 s, como antes. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const {harness} = require('./helpers/owner-receipt-v219.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

function fixture() {
  const h = harness(), w = h.w;
  const errors = [], close = h.close;
  w.addEventListener('error', e => { errors.push(e.error?.message || e.message); e.preventDefault(); });
  h.close = () => { close(); assert.deepEqual(errors, [], 'no unhandled UI errors'); };
  w.InstallmentPlan = {...w.InstallmentPlan, today: () => '2026-11-09'};
  const client = h.rows().clientes[0];
  Object.assign(client, {saldo: -3047, financialVersion: 13, fiadoHistoryVersion: 1, hasInstallmentFiado: true, telefone: '11999999999'});
  h.rows().vendas = []; h.rows().movimentacoes = []; h.rows().cobrancas = [];
  const result = {version: 2, historyProofVersion: 1, clientId: client.id, asOf: '2026-11-09', financialVersion: 13, dueCents: 52700, futureCents: 252000, totalCents: 304700, creditCents: 0, entries: [{dueDate: '2026-12-09', remainingCents: 28000}]};
  const server = {calls: 0, hang: false, waiting: []};
  w.FirebaseCallable = async () => {
    server.calls++;
    const reply = {data: {businessId: w.DB.getBusinessId(), workspaceGeneration: 0, account: structuredClone(result)}};
    if (server.hang) return new Promise(resolve => server.waiting.push(() => resolve(reply)));
    return reply;
  };
  let offline = false;
  Object.defineProperty(w.navigator, 'onLine', {get: () => !offline, configurable: true});
  w.Utils = {...w.Utils, escapar: s => String(s ?? ''), dinheiro: n => Number(n).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}), somenteNumeros: s => String(s).replace(/\D/g, ''), telefoneWhatsApp: s => '55' + s};
  w.PhoneUtils = {normalizeBrazilianPhone: s => '55' + s}; w.matchMedia = () => ({matches: false, addEventListener() {}});
  w.Cobrancas = {ultimaCliente: () => null, historicoCliente: () => []}; w.Router = {atual: () => 'clientes'};
  w.CustomerSubscriptions = {view: {forClient: () => [], hasUnassigned: () => false, loadForClient: async () => []}, effectiveStatus: () => 'active'};
  w.Modais = {fechar: () => { w.document.querySelector('#modal').innerHTML = ''; }};
  w.DB.readForView = w.DB.carregar; w.SyncFirebase.isReady = () => true; w.SyncFirebase.readCanonicalClient = async () => ({client: structuredClone(client)});
  for (const file of ['js/clientes.js', 'js/client-filter-rules.js', 'js/mensagens.js', 'js/clientes-page.js', 'js/clientes-mobile.js']) w.eval(fs.readFileSync(file, 'utf8'));
  const realNow = w.Date.now.bind(w.Date);
  let shift = 0;
  w.Date.now = () => realNow() + shift;
  const mount = () => { w.document.querySelector('#app').innerHTML = `<section class="clients-page" data-clients-bound="true"><div id="client-list">${w.ClientesPage.renderCard(client, 0)}</div></section>`; };
  const balance = () => w.document.querySelector('.client-balance');
  return {h, w, client, result, server, mount, balance, later: ms => { shift += ms; }, setOffline: value => { offline = value; w.dispatchEvent(new w.Event(value ? 'offline' : 'online')); }};
}
const confirmed = async f => { f.mount(); w(f).document.dispatchEvent(new (w(f).Event)('DOMContentLoaded')); await tick(); assert.match(f.balance().textContent, /527,00/); };
const w = f => f.w;

test('após os 60 s o saldo confirmado continua no card, mas não autoriza recebimento nem cobrança', async () => {
  const f = fixture();
  try {
    await confirmed(f);
    f.server.hang = true; f.later(61000);
    void f.w.InstallmentCredit.hydrateVisible(); await tick();
    assert.equal(f.server.calls, 2, 'revalida em segundo plano');
    assert.match(f.balance().textContent, /527,00/, 'o valor confirmado não some durante a revalidação');
    assert.equal(f.w.InstallmentCredit.confirmedAccount(f.client.id), null, 'a prova vencida não vale para operações');
    assert.equal(f.w.Clientes.financialStatus(f.client).status, 'unverified', 'cobrança e mensagens leem o estado estrito');
    assert.equal(f.w.Clientes.listFinancialStatus(f.client).status, 'unverified');
    assert.equal(f.w.Clientes.financialStatus(f.client, undefined, {display: true}).debt, 527, 'somente a exibição usa o último valor');
    f.later(40000); f.w.InstallmentCredit.hydrateVisible(); await tick();
    const note = f.balance().querySelector('[data-balance-freshness]');
    assert.equal(note?.dataset.balanceFreshness, 'refreshing', 'revalidação demorada aparece como atualizando');
    f.server.waiting.splice(0).forEach(resolve => resolve()); await tick();
    assert.equal(f.balance().querySelector('[data-balance-freshness]'), null, 'confirmado de novo, sem aviso');
    assert.equal(f.w.Clientes.financialStatus(f.client).debt, 527);
    assert.equal(f.h.commits(), 0);
  } finally { f.h.close(); }
});

test('um cliente cujo saldo mudou não fica com o valor antigo na tela', async () => {
  const f = fixture();
  try {
    await confirmed(f);
    f.server.hang = true;
    f.client.saldo = -2947; f.client.financialVersion = 14;
    Object.assign(f.result, {financialVersion: 14, dueCents: 42700, totalCents: 294700});
    f.w.dispatchEvent(new f.w.CustomEvent('financial-state-updated', {detail: {clientId: f.client.id}})); await tick();
    assert.doesNotMatch(f.balance().textContent, /527,00/, 'o valor de antes da mudança não é mostrado');
    f.server.waiting.splice(0).forEach(resolve => resolve()); await tick();
    assert.match(f.balance().textContent, /427,00/);
  } finally { f.h.close(); }
});

test('resposta anterior a uma mudança financeira é descartada e refeita na hora, sem esperar 15 s', async () => {
  const f = fixture();
  try {
    f.server.hang = true; f.mount();
    f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded')); await tick();
    assert.equal(f.server.calls, 1);
    f.w.dispatchEvent(new f.w.CustomEvent('financial-state-updated')); await tick();
    f.server.waiting.shift()(); await tick(); await tick();
    assert.equal(f.server.calls, 2, 'a resposta superada gera nova consulta imediata');
    f.server.waiting.splice(0).forEach(resolve => resolve()); await tick();
    assert.match(f.balance().textContent, /527,00/);
  } finally { f.h.close(); }
});

test('troca de sessão ou de empresa não mostra o saldo guardado de outro escopo', async () => {
  const f = fixture();
  try {
    await confirmed(f);
    f.h.setContext({businessId: 'qa-other-business'});
    assert.equal(f.w.InstallmentCredit.displayAccount(f.client.id), null);
    f.h.setContext({businessId: 'qa-business'});
    assert.equal(f.w.InstallmentCredit.displayAccount(f.client.id), null, 'voltar ao escopo anterior não reaproveita o valor');
  } finally { f.h.close(); }
});

test('sem conexão o valor fica marcado como desatualizado e não autoriza nada', async () => {
  const f = fixture();
  try {
    await confirmed(f);
    f.setOffline(true); await tick();
    assert.match(f.balance().textContent, /527,00/);
    assert.match(f.balance().textContent, /sem conexão · confirmado às \d\d:\d\d/);
    assert.equal(f.w.InstallmentCredit.confirmedAccount(f.client.id), null);
    assert.equal(f.w.Clientes.financialStatus(f.client).status, 'unverified');
  } finally { f.h.close(); }
});
