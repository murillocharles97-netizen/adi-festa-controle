'use strict';
// Fases 3 e 4 — tela "Ajustar saldo", oferecida só com o saldo do servidor ativo. Servidor simulado,
// dados fictícios. A tela nunca calcula o valor: prévia e confirmação vêm do servidor.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const {JSDOM} = require('jsdom');

function setup({scoped = false, permitted = true, enable = true, fail = null} = {}) {
  const dom = new JSDOM('<div id="app"></div><div id="modal"></div>', {url: 'https://qa.example.invalid', runScripts: 'outside-only'});
  const w = dom.window, calls = [], toasts = [], events = [], reads = [];
  const client = {id: 'fx-client', nome: 'Pessoa fictícia', saldo: -150, customerSpaceIds: ['fx-a', 'fx-b']};
  w.DB = {getBusinessId: () => 'fx-shop', getWorkspaceGeneration: () => 0};
  w.TeamAccess = {has: key => permitted && key === 'customers.adjustBalance'};
  w.SpaceContext = {homeSpaces: () => [{id: 'fx-a', name: 'Espaço A'}, {id: 'fx-b', name: 'Espaço B'}, {id: 'fx-c', name: 'Espaço C'}], activeId: () => 'fx-a'};
  w.Clientes = {obter: id => id === client.id ? client : null, scopedScreen: () => scoped};
  w.Utils = {toast: (text, error) => toasts.push([text, !!error])};
  w.SyncFirebase = {readCanonicalClient: async id => { reads.push(id); }};
  w.addEventListener('financial-state-updated', e => events.push(e.detail));
  const server = {current: 15000, fail};
  w.FirebaseCallable = async (name, data) => {
    calls.push([name, data.kind, data]);
    if (server.fail) { const f = server.fail; server.fail = null; throw Object.assign(Error(f.message), {code: f.code}); }
    if (data.kind === 'customer_balance_adjustment_preview') {
      const next = data.mode === 'increase' ? server.current + data.amountCents : data.mode === 'set' ? data.targetDebtCents : data.mode === 'reverse' ? server.current - 2000 : server.current - data.amountCents;
      return {data: {status: 'preview', currentDebtCents: server.current, newDebtCents: next, quoteHash: 'q'.repeat(64), financialVersion: 4}};
    }
    if (data.kind === 'customer_balance_adjustment_history') return {data: {items: [{operationId: 'fx-op-1', deltaDebtCents: 2000, reason: 'Lançamento fictício', at: '2026-11-20T10:00:00Z', reversible: true},
      {operationId: 'fx-op-0', deltaDebtCents: 500, reason: 'Já estornado', at: '2026-11-19T10:00:00Z', reversible: false}]}};
    if (data.kind === 'customer_balance_adjustment') return {data: {status: 'confirmed', newDebtCents: 17500, operationId: data.operationId}};
    throw Error('kind ' + data.kind);
  };
  w.CustomerSpaceAccounts = {ready: () => enable};
  w.eval(fs.readFileSync('js/customer-balance-adjustment.js', 'utf8'));
  const $ = sel => w.document.querySelector(sel);
  const settle = () => new Promise(r => setTimeout(r, 20));
  return {w, $, calls, toasts, events, reads, server, settle, close: () => w.close()};
}

test('sem o saldo do servidor ativo neste aparelho: não abre e não chama o servidor', () => {
  const s = setup({enable: false});
  assert.equal(s.w.CustomerBalanceAdjustment.available(), false);
  assert.equal(s.w.CustomerBalanceAdjustment.open('fx-client'), null);
  assert.equal(s.calls.length, 0); assert.ok(s.toasts.length);
  s.close();
});

test('Espaços: na tela de um Espaço, só ele; na visão da empresa, os Espaços do cliente', () => {
  let s = setup({scoped: true}); s.w.CustomerBalanceAdjustment.open('fx-client');
  assert.deepEqual([...s.$('select[name=spaceId]').options].map(o => o.value), ['fx-a']); s.close();
  s = setup(); s.w.CustomerBalanceAdjustment.open('fx-client');
  assert.deepEqual([...s.$('select[name=spaceId]').options].map(o => o.value), ['fx-a', 'fx-b']); s.close();
});

test('prévia do servidor e confirmação: valor vem do servidor, sem venda nem recebimento', async () => {
  const s = setup(); s.w.CustomerBalanceAdjustment.open('fx-client');
  s.$('input[name=amount]').value = '25,00'.replace(',', '.'); s.$('textarea[name=reason]').value = 'Ajuste fictício conferido em QA';
  assert.equal(s.$('[data-adj-confirm]').disabled, true, 'confirmar só depois da prévia');
  s.$('[data-adj-preview]').click(); await s.settle();
  assert.match(s.$('[data-adj-status]').textContent, /Hoje neste Espaço: R\$\s?150,00\. Depois do ajuste: R\$\s?175,00/);
  assert.equal(s.calls[0][2].amountCents, 2500); assert.equal(s.calls[0][2].spaceId, 'fx-a');
  s.$('[data-adj-form]').dispatchEvent(new s.w.Event('submit', {cancelable: true})); await s.settle();
  const commit = s.calls.find(c => c[1] === 'customer_balance_adjustment')[2];
  assert.equal(commit.quoteHash, 'q'.repeat(64)); assert.equal(commit.expectedFinancialVersion, 4); assert.equal(commit.confirmed, true); assert.ok(commit.operationId);
  assert.match(s.$('[data-adj-status]').textContent, /Ajuste confirmado\. Dívida no Espaço: R\$\s?175,00\. Nenhuma venda ou recebimento/);
  assert.deepEqual(s.reads, ['fx-client']); assert.equal(JSON.stringify(s.events), JSON.stringify([{clientId: 'fx-client'}]));
  s.close();
});

test('mudar o valor depois da prévia exige nova prévia; valor inválido não consulta', async () => {
  const s = setup(); s.w.CustomerBalanceAdjustment.open('fx-client');
  s.$('input[name=amount]').value = '10'; s.$('[data-adj-preview]').click(); await s.settle();
  assert.equal(s.$('[data-adj-confirm]').disabled, false);
  s.$('input[name=amount]').value = '11'; s.$('input[name=amount]').dispatchEvent(new s.w.Event('input', {bubbles: true}));
  assert.equal(s.$('[data-adj-confirm]').disabled, true);
  s.$('input[name=amount]').value = '0.001'; const before = s.calls.length;
  s.$('[data-adj-preview]').click(); await s.settle();
  assert.equal(s.calls.length, before); assert.match(s.$('[data-adj-status]').textContent, /valor válido/);
  s.close();
});

test('estornar: lista só ajustes que ainda podem ser estornados', async () => {
  const s = setup(); s.w.CustomerBalanceAdjustment.open('fx-client');
  const reverse = [...s.w.document.querySelectorAll('input[name=mode]')].find(i => i.value === 'reverse');
  reverse.checked = true; reverse.dispatchEvent(new s.w.Event('change', {bubbles: true})); await s.settle();
  const options = [...s.$('select[name=reversesOperationId]').options].map(o => o.value);
  assert.deepEqual(options, ['fx-op-1']);
  assert.equal(s.$('[data-adj-amount]').hidden, true);
  s.$('[data-adj-preview]').click(); await s.settle();
  assert.equal(s.calls.at(-1)[2].reversesOperationId, 'fx-op-1');
  s.close();
});

test('falha de rede guarda o pedido e reenvia igual; recusa definitiva descarta', async () => {
  const s = setup(); s.w.CustomerBalanceAdjustment.open('fx-client');
  s.$('input[name=amount]').value = '5'; s.$('textarea[name=reason]').value = 'Ajuste fictício conferido em QA';
  s.$('[data-adj-preview]').click(); await s.settle();
  s.server.fail = {message: 'Falha de rede simulada.', code: 'functions/unavailable'};
  s.$('[data-adj-form]').dispatchEvent(new s.w.Event('submit', {cancelable: true})); await s.settle();
  assert.equal(s.$('[data-adj-retry]').hidden, false); assert.match(s.$('[data-adj-status]').textContent, /reenviado igual/);
  const first = s.calls.filter(c => c[1] === 'customer_balance_adjustment')[0][2].operationId;
  s.w.CustomerBalanceAdjustment.open('fx-client');
  assert.match(s.$('[data-adj-status]').textContent, /sem confirmação do servidor/);
  s.$('[data-adj-retry]').click(); await s.settle();
  const second = s.calls.filter(c => c[1] === 'customer_balance_adjustment')[1][2].operationId;
  assert.equal(second, first, 'mesmo identificador: o servidor não duplica');
  assert.match(s.$('[data-adj-status]').textContent, /Ajuste confirmado/);
  s.server.fail = {message: 'O saldo mudou.', code: 'functions/aborted'};
  s.$('input[name=amount]').value = '6'; s.$('input[name=amount]').dispatchEvent(new s.w.Event('input', {bubbles: true}));
  s.server.fail = null; s.$('[data-adj-preview]').click(); await s.settle();
  s.server.fail = {message: 'O saldo mudou. Consulte a prévia de novo.', code: 'functions/aborted'};
  s.$('[data-adj-form]').dispatchEvent(new s.w.Event('submit', {cancelable: true})); await s.settle();
  assert.equal(s.$('[data-adj-retry]').hidden, true); assert.equal(s.w.localStorage.getItem('veconi:balance-adjustment:' + JSON.stringify(['fx-shop', 'fx-client'])), null);
  s.close();
});
