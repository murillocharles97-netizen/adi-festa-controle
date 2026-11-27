'use strict';
// Fase 4: com o saldo por Espaço publicado pelo servidor, a tela de Clientes mostra o
// valor sem consultar a conta de cada cliente; se o publicado não bate com o saldo
// cadastral, volta às fontes de antes. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const {harness} = require('./helpers/owner-receipt-v219.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

function fixture() {
  const h = harness(), w = h.w, errors = [], close = h.close;
  w.addEventListener('error', e => { errors.push(e.error?.message || e.message); e.preventDefault(); });
  h.close = () => { close(); assert.deepEqual(errors, [], 'no unhandled UI errors'); };
  w.InstallmentPlan = {...w.InstallmentPlan, today: () => '2026-11-09'};
  const client = h.rows().clientes[0];
  // Regularized historical debt: today the card needs the server account to show it.
  Object.assign(client, {saldo: -3047, financialVersion: 13, fiadoHistoryVersion: 1, hasInstallmentFiado: false, telefone: '11999999999',
    fiadoHistoryActivation: {spaceRegularization: {version: 1}}});
  h.rows().vendas = []; h.rows().movimentacoes = []; h.rows().cobrancas = [];
  let calls = 0;
  w.FirebaseCallable = async (name, data) => { calls++;
    return {data: {businessId: w.DB.getBusinessId(), workspaceGeneration: 0, account: {version: 2, historyProofVersion: 1, clientId: client.id, asOf: '2026-11-09', financialVersion: 13,
      dueCents: 304700, futureCents: 0, totalCents: 304700, creditCents: 0, entries: [{dueDate: '2026-11-01', remainingCents: 304700, spaceId: 'qa-space'}]}}}; };
  w.Utils = {...w.Utils, escapar: s => String(s ?? ''), dinheiro: n => Number(n).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}), somenteNumeros: s => String(s).replace(/\D/g, ''), telefoneWhatsApp: s => '55' + s};
  w.PhoneUtils = {normalizeBrazilianPhone: s => '55' + s}; w.matchMedia = () => ({matches: false, addEventListener() {}});
  w.Cobrancas = {ultimaCliente: () => null, historicoCliente: () => []}; w.Router = {atual: () => 'clientes'};
  w.CustomerSubscriptions = {view: {forClient: () => [], hasUnassigned: () => false, loadForClient: async () => []}, effectiveStatus: () => 'active'};
  w.Modais = {fechar: () => {}}; w.DB.readForView = w.DB.carregar; w.SyncFirebase.isReady = () => true;
  w.SyncFirebase.confirmedClientFinancialVersion = client => client?.customerDirectoryOnly ? null : client?.financialVersion;
  w.eval(fs.readFileSync('js/customer-space-accounts.js', 'utf8'));
  for (const file of ['js/clientes.js', 'js/client-filter-rules.js', 'js/mensagens.js', 'js/clientes-page.js', 'js/clientes-mobile.js']) w.eval(fs.readFileSync(file, 'utf8'));
  const mount = () => { w.document.querySelector('#app').innerHTML = `<section class="clients-page" data-clients-bound="true"><div id="client-list">${w.ClientesPage.renderCard(client, 0)}</div></section>`; };
  const balance = () => w.document.querySelector('.client-balance').textContent;
  const publish = (rows, {complete = true, live = true} = {}) => {
    const store = w.CustomerSpaceAccounts;
    if (!store.scope()) store.reset({uid: 'qa-owner', businessId: w.DB.getBusinessId(), generation: 0, complete, spaces: rows.map(([id])=>id)});
    store.apply(w.DB.getBusinessId(), rows.map(([space, debtCents, financialVersion = client.financialVersion]) => ({type: 'added', id: `${client.id}__${space || 'sem-espaco'}`,
      data: {businessId: w.DB.getBusinessId(), workspaceGeneration: 0, clientId: client.id, spaceId: space, debtCents, financialVersion, status: 'ready'}})), {fromServer: live});
  };
  return {h, w, client, mount, balance, publish, calls: () => calls};
}

test('saldo publicado aparece no card sem consultar a conta do cliente', async () => {
  const f = fixture();
  try {
    f.publish([['qa-space', 304700]]);
    f.mount(); f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded')); await tick();
    await f.w.InstallmentCredit.hydrateVisible(); await tick();
    assert.match(f.balance(), /3\.047,00/);
    assert.equal(f.calls(), 0, 'nenhuma consulta de conta para exibir');
    assert.equal(f.w.Clientes.financialStatus(f.client, undefined, {display: true}).debt, 3047);
    assert.equal(f.h.commits(), 0);
  } finally { f.h.close(); }
});

test('publicado diferente do saldo cadastral: a tela volta à consulta de antes', async () => {
  const f = fixture();
  try {
    f.publish([['qa-space', 200000]]);
    f.mount(); f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded')); await tick();
    assert.equal(f.calls(), 1, 'sem saldo confiável, consulta a conta como hoje');
    assert.match(f.balance(), /3\.047,00/);
  } finally { f.h.close(); }
});

test('saldo publicado depois da montagem atualiza o card sozinho', async () => {
  const f = fixture();
  try {
    f.w.FirebaseCallable = () => new Promise(() => {}); // the account lookup never answers
    f.mount(); f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded')); await tick();
    assert.match(f.balance(), /a conferir/i);
    f.publish([['qa-space', 304700]]); await tick();
    assert.match(f.balance(), /3\.047,00/);
  } finally { f.h.close(); }
});

test('crédito publicado aparece como crédito; quem não vê todos os Espaços usa só o seu', async () => {
  const f = fixture();
  try {
    f.client.saldo = 25;
    f.publish([['qa-space', -2500]]);
    const status = f.w.Clientes.financialStatus(f.client, undefined, {display: true});
    assert.equal(status.status, 'credit'); assert.equal(status.credit, 25);
    f.w.CustomerSpaceAccounts.reset(null);
    f.client.saldo = -3047;
    f.w.SpaceContext.scopesCustomers = () => true;
    f.w.SpaceContext.activeId = () => 'qa-space';
    f.publish([['qa-space', 100000]], {complete: false});
    assert.equal(f.w.Clientes.financialStatus(f.client, undefined, {display: true}).debt, 1000, 'sem a soma completa, mostra o que o Espaço publica');
  } finally { f.h.close(); }
});

test('acesso parcial descarta versão antiga, saldo sem confirmação e Espaço fora da seleção', () => {
  const f = fixture();
  try {
    f.w.SpaceContext.scopesCustomers = () => true;
    f.w.SpaceContext.activeId = () => 'qa-space';
    f.publish([['qa-space', 100000, 12]], {complete: false});
    assert.equal(f.w.Clientes.sharedAccount(f.client), null);
    f.publish([['qa-space', 100000, 13]], {complete: false});
    assert.equal(f.w.Clientes.sharedAccount(f.client).spaces['qa-space'], 100000);
    f.w.SpaceContext.activeId = () => 'qa-other-space';
    assert.equal(f.w.Clientes.sharedAccount(f.client), null);
    f.w.SpaceContext.activeId = () => 'qa-space';
    f.w.SyncFirebase.confirmedClientFinancialVersion = () => null;
    assert.equal(f.w.Clientes.sharedAccount(f.client), null);
  } finally { f.h.close(); }
});

test('Ajustar saldo novo só aparece com o saldo do servidor ativo neste aparelho', async () => {
  const f = fixture();
  try {
    f.w.SpaceContext.homeSpaces = () => [{id: 'qa-space', name: 'Espaço QA'}];
    f.w.eval(fs.readFileSync('js/customer-balance-adjustment.js', 'utf8'));
    assert.equal(f.w.CustomerBalanceAdjustment.available(), false, 'sem saldo publicado');
    f.publish([['qa-space', 304700]], {live: false});
    assert.equal(f.w.CustomerBalanceAdjustment.available(), false, 'cópia local ainda não confirmada');
    f.publish([], {live: true});
    assert.equal(f.w.CustomerBalanceAdjustment.available(), true);
  } finally { f.h.close(); }
});

test('a ausência de documento publicado não é usada para comprovar saldo zero', async () => {
  const f = fixture();
  try {
    f.client.saldo = 0;
    f.w.CustomerSpaceAccounts.reset({uid: 'qa-owner', businessId: f.w.DB.getBusinessId(), generation: 0, complete: true});
    f.w.CustomerSpaceAccounts.apply(f.w.DB.getBusinessId(), [], {fromServer: true});
    assert.equal(f.w.Clientes.sharedAccount(f.client), null);
    f.w.CustomerSpaceAccounts.reset(null);
    assert.equal(f.w.Clientes.sharedAccount(f.client), null, 'sem o saldo do servidor, volta à fonte de antes');
  } finally { f.h.close(); }
});

test('Etapa 7: com o saldo do servidor ativo, nenhum regime consulta a conta para exibir', async () => {
  const regimes = {
    abertura: {fiadoOpeningBalance: {version: 1, hash: 'qa-hash'}, fiadoHistoryVersion: 1, fiadoHistoryActivation: undefined},
    regularizado: {fiadoHistoryVersion: 1, fiadoHistoryActivation: {spaceRegularization: {version: 1}}},
    nativo: {fiadoHistoryVersion: 1, fiadoHistoryActivation: {spaceRegularization: {version: 1, origin: 'native'}}},
    migrado: {fiadoHistoryVersion: 1, fiadoHistoryActivation: {spaceRegularization: {version: 1, origin: 'migration'}}},
    simples: {fiadoHistoryVersion: undefined, fiadoHistoryActivation: undefined, hasInstallmentFiado: false},
  };
  for (const [name, flags] of Object.entries(regimes)) {
    const f = fixture();
    try {
      Object.assign(f.client, flags);
      f.publish([['qa-space', 304700]]);
      f.mount(); f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded')); await tick();
      await f.w.InstallmentCredit.hydrateVisible(); await tick();
      assert.equal(f.calls(), 0, name + ': nenhuma consulta de conta');
      assert.match(f.balance(), /3\.047,00/, name + ': saldo publicado no card');
    } finally { f.h.close(); }
  }
});
