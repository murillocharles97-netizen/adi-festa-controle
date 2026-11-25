'use strict';
// "Consultar saldo": um toque sempre responde (consultando, resultado ou motivo), e a
// dívida histórica regularizada é consultada sozinha nos cards visíveis. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

function setup({scoped = true, inView = true, online = true, permitted = true, reply} = {}) {
  const dom = new JSDOM(`<div id="app"><section class="clients-page"><article data-client-id="fx-client"><span>A conferir</span><button type="button" data-fiado-lookup="fx-client">Consultar saldo</button></article></section>
    <section class="fiado-list"><article class="fiado-card"><div class="balance"><b>Exigível a conferir</b></div><button type="button" data-fiado-lookup="fx-client">Consultar saldo</button></article></section></div><div id="modal"></div>`,
    {url: 'https://qa.example.invalid', runScripts: 'outside-only'});
  const w = dom.window, toasts = [], calls = [];
  Object.defineProperty(w.navigator, 'onLine', {get: () => online, configurable: true});
  w.eval(fs.readFileSync('functions/src/shared/installment-plan.js', 'utf8').replace(/module\.exports\s*=/, 'window.__plan='));
  w.InstallmentPlan = w.InstallmentPlan || w.__plan;
  const today = w.InstallmentPlan.today();
  const client = {id: 'fx-client', nome: 'Pessoa fictícia', saldo: -150, financialVersion: 1, fiadoHistoryVersion: 1,
    fiadoHistoryActivation: {spaceRegularization: {version: 1}}};
  w.DB = {carregar: () => ({clientes: [client], vendas: []}), getBusinessId: () => 'fx-shop', getWorkspaceGeneration: () => 0};
  w.TeamAccess = {has: () => permitted, captureSession: () => 'fx-session', assertSession() {}};
  w.SpaceContext = {viewScope: () => 'fx-space', activeId: () => 'fx-space', scopesCustomers: () => scoped};
  w.Router = {atual: () => 'clientes'};
  w.Utils = {toast: (text, error) => toasts.push([text, Boolean(error)])};
  w.Clientes = {scopedScreen: () => scoped, viewClient: id => inView && id === 'fx-client' ? client : null, localListBalances: () => false,
    financialStatus: () => ({status: 'unverified', saldo: NaN, debt: 0, credit: 0}), prepareList() {}, accountBelongsTo: () => true};
  w.FirebaseCallable = async (name, data) => {
    calls.push([name, data.kind, data.clientId]);
    if (reply instanceof Error) throw reply;
    return {data: {businessId: 'fx-shop', workspaceGeneration: 0, account: {clientId: 'fx-client', version: 2, historyProofVersion: 1, financialVersion: 1,
      dueCents: 15000, futureCents: 0, totalCents: 15000, creditCents: 0, asOf: today, entries: [{spaceId: 'fx-space', remainingCents: 15000}]}}};
  };
  w.eval(fs.readFileSync('js/installment-credit.js', 'utf8'));
  return {w, toasts, calls, close: () => dom.window.close()};
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const status = (w, root = '.clients-page') => w.document.querySelector(root + ' [data-fiado-lookup-status]');

test('toque mostra "Consultando…" e depois o saldo confirmado pelo servidor', async () => {
  const s = setup(), button = s.w.document.querySelector('.clients-page [data-fiado-lookup]');
  button.click();
  assert.equal(button.textContent, 'Consultando…');
  assert.equal(button.disabled, true);
  await settle();
  assert.match(status(s.w).textContent, /Saldo confirmado no servidor: R\$\s?150,00 exigível\./);
  assert.equal(button.disabled, false);
  assert.deepEqual(s.calls[0], ['getOperationalSyncReceipt', 'fiado_account', 'fx-client']);
  s.close();
});

test('erro do servidor aparece no card, não some em silêncio', async () => {
  const s = setup({reply: Object.assign(Error('Histórico financeiro sem prova suficiente: fictício'), {code: 'failed-precondition'})});
  s.w.document.querySelector('.clients-page [data-fiado-lookup]').click(); await settle();
  assert.match(status(s.w).textContent, /sem prova suficiente/);
  assert.ok(status(s.w).classList.contains('is-error'));
  assert.ok(s.toasts.some(([, error]) => error));
  s.close();
});

test('sem conexão, sem permissão ou fora do Espaço: explica e não consulta', async () => {
  for (const [options, pattern] of [[{online: false}, /Sem conexão/], [{permitted: false}, /não pode consultar/], [{inView: false}, /Espaço ativo/]]) {
    const s = setup(options);
    await settle(); s.calls.length = 0; // automatic loading of visible cards is covered below
    s.w.document.querySelector('.clients-page [data-fiado-lookup]').click(); await settle();
    assert.match(status(s.w).textContent, pattern);
    assert.equal(s.calls.length, 0);
    s.close();
  }
});

test('Central de Fiado: o card mostra o exigível confirmado', async () => {
  const s = setup({scoped: false});
  s.w.document.querySelector('.fiado-card [data-fiado-lookup]').click(); await settle();
  assert.match(s.w.document.querySelector('.fiado-card .balance b').textContent, /R\$\s?150,00/);
  s.close();
});

test('tela filtrada por Espaço consulta sozinha a dívida regularizada visível', async () => {
  const s = setup();
  await s.w.InstallmentCredit.hydrateVisible(); await settle();
  assert.deepEqual(s.calls.map(c => c[2]), ['fx-client']);
  assert.ok(s.w.InstallmentCredit.confirmedAccount('fx-client'), 'conta confirmada disponível para o card');
  s.close();
});
