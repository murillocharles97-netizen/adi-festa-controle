'use strict';
// Etapa 4 — tela "Conta por Espaço" do proprietário. Servidor simulado, dados fictícios. A
// tela não decide nada: mostra a prévia do servidor e envia a confirmação, igual em reenvio.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const {JSDOM} = require('jsdom');

function setup({role = 'owner', migration = 'eligible', fail = null} = {}) {
  const dom = new JSDOM('<div id="app"></div><div id="modal"></div>', {url: 'https://qa.example.invalid', runScripts: 'outside-only'});
  const w = dom.window, calls = [], events = [], reads = [];
  const client = {id: 'fx-client', nome: 'Pessoa fictícia', saldo: -100, customerSpaceIds: ['fx-a', 'fx-b']};
  w.DB = {getBusinessId: () => 'fx-shop', getWorkspaceGeneration: () => 0};
  w.BusinessContext = {get: () => ({role})};
  w.TeamAccess = {has: key => key === 'customers.adjustBalance'};
  w.SpaceContext = {homeSpaces: () => [{id: 'fx-a', name: 'Loja'}, {id: 'fx-b', name: 'Oficina'}]};
  w.Clientes = {obter: id => id === client.id ? client : null};
  w.Utils = {toast: () => {}};
  w.SyncFirebase = {readCanonicalClient: async id => { reads.push(id); }};
  w.addEventListener('financial-state-updated', e => events.push(e.detail));
  const server = {fail};
  w.FirebaseCallable = async (name, data) => {
    calls.push([name, data.kind, JSON.parse(JSON.stringify(data))]);
    if (server.fail && data.kind === server.fail.kind) { const f = server.fail; server.fail = null; throw Object.assign(Error(f.message), {code: f.code}); }
    if (data.kind === 'customer_account_migration_preview') return {data: migration === 'eligible'
      ? {clientId: client.id, status: 'eligible', bookCents: 10000, spaces: {'fx-a': 6000, 'fx-b': 4000}, quoteHash: 'q'.repeat(64)}
      : {clientId: client.id, status: 'blocked', reason: migration}};
    if (data.kind === 'customer_account_migration') return {data: {status: 'migrated', clientId: client.id}};
    if (data.kind === 'customer_account_opening_preview') {
      const parts = data.balances || [{spaceId: 'fx-a', totalCents: 10000}, {spaceId: 'fx-b', totalCents: 0}];
      const confirmed = parts.reduce((n, p) => n + p.totalCents, 0);
      return {data: {reviewHash: 'r'.repeat(64), bookCents: 10000, confirmedCents: confirmed, deltaCents: confirmed - 10000, parts, spaceIds: ['fx-a', 'fx-b']}};
    }
    if (data.kind === 'customer_account_opening') return {data: {status: 'confirmed', confirmedCents: data.balances.reduce((n, p) => n + p.totalCents, 0)}};
    throw Error('kind ' + data.kind);
  };
  w.eval(fs.readFileSync('js/customer-account-setup.js', 'utf8'));
  const $ = sel => w.document.querySelector(sel);
  const settle = () => new Promise(r => setTimeout(r, 20));
  return {w, $, client, calls, events, reads, server, settle, close: () => w.close()};
}
const text = s => s.$('[data-setup-status]').textContent;

test('só o proprietário vê a ação, e só para cliente fora da conta por Espaço', () => {
  const owner = setup(), seller = setup({role: 'seller'});
  assert.equal(owner.w.CustomerAccountSetup.needed(owner.client), true);
  assert.equal(owner.w.CustomerAccountSetup.needed({...owner.client, fiadoOpeningBalance: {version: 1, hash: 'h'}}), false);
  assert.equal(owner.w.CustomerAccountSetup.needed({...owner.client, fiadoHistoryActivation: {spaceRegularization: {version: 1}}}), false);
  assert.equal(owner.w.CustomerAccountSetup.needed({...owner.client, ativo: false}), false);
  assert.equal(seller.w.CustomerAccountSetup.needed(seller.client), false);
  assert.equal(seller.w.CustomerAccountSetup.open('fx-client'), null);
  assert.equal(seller.calls.length, 0);
  owner.close(); seller.close();
});

test('cliente elegível: mostra os Espaços e migra com o código da prévia', async () => {
  const s = setup();
  s.w.CustomerAccountSetup.open('fx-client'); await s.settle();
  assert.match(s.$('[data-setup-spaces]').textContent, /Loja.*60,00.*Oficina.*40,00/s);
  s.$('[data-setup-migrate]').click(); await s.settle();
  const sent = s.calls.find(c => c[1] === 'customer_account_migration')[2];
  assert.deepEqual([sent.clientId, sent.quoteHash, sent.confirmed, sent.businessId], ['fx-client', 'q'.repeat(64), true, 'fx-shop']);
  assert.match(text(s), /migrado/i);
  assert.deepEqual(JSON.parse(JSON.stringify([s.reads, s.events])), [['fx-client'], [{clientId: 'fx-client'}]]);
  s.close();
});

test('histórico sem prova: abre a conta com o saldo de cada Espaço, depois do resumo e da conferência das filas', async () => {
  const s = setup({migration: 'history_unproven'});
  s.w.CustomerAccountSetup.open('fx-client'); await s.settle();
  assert.match(s.$('[data-setup-body]').textContent, /não comprova/);
  s.$('[data-setup-opening]').click(); await s.settle();
  const [a, b] = s.w.document.querySelectorAll('[data-space]');
  assert.deepEqual([a.dataset.space, a.value, b.value], ['fx-a', '100.00', '0.00']);
  a.value = '70'; b.value = '30'; a.dispatchEvent(new s.w.Event('input', {bubbles: true}));
  assert.equal(s.$('[data-setup-open]').disabled, true, 'sem resumo não confirma');
  s.$('[data-setup-review]').click(); await s.settle();
  assert.match(text(s), /confirmado: R\$\s*100,00/);
  s.$('[data-setup-open]').click(); await s.settle();
  assert.match(text(s), /Confira as operações pendentes/, 'exige a conferência das filas');
  s.$('[name="queueChecked"]').checked = true;
  s.$('[data-setup-open]').click(); await s.settle();
  const sent = s.calls.find(c => c[1] === 'customer_account_opening')[2];
  assert.deepEqual([sent.balances, sent.reviewHash, sent.confirmed, sent.queueChecked], [[{spaceId: 'fx-a', totalCents: 7000}, {spaceId: 'fx-b', totalCents: 3000}], 'r'.repeat(64), true, true]);
  assert.match(text(s), /Conta aberta/);
  s.close();
});

test('resposta perdida: o pedido guardado é reenviado igual, com o mesmo identificador', async () => {
  const s = setup({fail: {kind: 'customer_account_migration', code: 'functions/unavailable', message: 'Sem resposta.'}});
  s.w.CustomerAccountSetup.open('fx-client'); await s.settle();
  s.$('[data-setup-migrate]').click(); await s.settle();
  assert.match(text(s), /reenviado igual/);
  s.$('[data-setup-retry]').click(); await s.settle();
  const sends = s.calls.filter(c => c[1] === 'customer_account_migration').map(c => c[2].operationId);
  assert.equal(sends.length, 2); assert.equal(sends[0], sends[1], 'mesmo identificador');
  assert.match(text(s), /migrado/i);
  s.close();
});
