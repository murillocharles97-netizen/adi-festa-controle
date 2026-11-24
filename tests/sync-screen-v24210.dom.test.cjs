'use strict';
// Tela "Sincronização dos dados" reorganizada (força-tarefa V242.10), com a
// interface real em JSDOM e dados fictícios no formato da conta auditada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {harness} = require('./helpers/sync-status-v223.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
function screen({findings = true, deliver, supportExport, batch, confirm = () => true} = {}) {
  const h = harness();
  h.resolve(0); h.resolve(1);
  h.s.state.integrityStatus = 'completed';
  h.s.state.lastSync = '2026-11-24T21:41:00.000Z';
  h.s.state.dataAudit = {businessId: 'qa-shop', generatedAt: '2026-11-24T21:45:00.000Z', collections: {sales: {onlyLocal: [], onlyRemote: [], divergent: [], equal: []}}, financial: {}};
  const d = h.dom(), w = d.w, calls = [];
  w.eval(fs.readFileSync('js/sync-findings.js', 'utf8'));
  w.eval(fs.readFileSync('js/export-center.js', 'utf8'));
  w.SaleRecoveryExport = {candidateCount: async () => 0};
  w.confirm = confirm;
  w.Clientes = {obter: id => ({'fx-client-b': {nome: 'Cliente fictício B'}})[id] || null};
  if (findings) {
    const rec = (id, extra = {}) => ({documentId: id, operationId: '', active: true, deleted: false, ...extra});
    const audit = {businessId: 'qa-shop', generatedAt: '2026-11-24T21:45:00.000Z', collections: {
      clients: {equal: [rec('c1'), rec('c2')], onlyLocal: [], onlyRemote: [rec('fx-ina-1', {active: false}), rec('fx-ina-2', {active: false})], divergent: []},
      sales: {equal: [rec('s1')], divergent: [], onlyRemote: [],
        onlyLocal: [{documentId: 'fx-ride-1', classification: 'A', queueOperationId: 'fx-op-1'}, {documentId: 'fx-sale-2', operationId: 'fx-op-2', classification: 'B'}]}}};
    const queue = [{operationId: 'fx-op-1', category: 'error', canRetry: false, replayBlocked: true, reviewReason: 'service_configuration_missing', collection: 'sales', createdAt: '2026-11-19T23:12:00.000Z'}];
    const saleReport = [{saleId: 'fx-ride-1', classification: 'A', recoveryMode: 'sale_only', amount: 120, customerId: 'fx-client-b'}, {saleId: 'fx-sale-2', classification: 'A', recoveryMode: 'sale_only', amount: 45}];
    w.SyncFirebase.syncFindings = () => w.SyncFindings.build({audit, queue, retained: [], saleReport, remoteById: () => ({active: false})});
  }
  w.SyncFirebase.supportExport = supportExport || (async (kind) => { calls.push(['supportExport', kind]); return {kind, content: kind === 'summary' ? 'resumo fictício' : {ok: 1}, filename: kind + '.json', mime: kind === 'summary' ? 'text/plain' : 'application/json', personal: kind === 'backup'}; });
  if (deliver) w.VeconiExport = {...w.VeconiExport, deliver: async (args) => { calls.push(['deliver', args.mode, args.filename]); return deliver(args); }, capabilities: () => ({share: true})};
  w.SyncFirebase.runSafeRecoveryBatch = batch || (async (keys, options) => { calls.push(['batch', keys]); options.onProgress({done: 1, total: 1}); return {backupId: 'bk-1', results: [{key: 'k', status: 'recovered', documentId: 'fx-sale-2', message: 'Registrada e confirmada na nuvem.'}]}; });
  d.details();
  return {d, w, root: w.document.querySelector('#modal'), calls, close: () => d.close()};
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('ordem: estado, decisões, recuperáveis, sincronizados, explicadas, exportação e detalhes técnicos fechados', async () => {
  const s = screen();
  const body = s.root.querySelector('.modal-body');
  const order = [...body.children].map(node => node.className.split(' ')[0]);
  assert.deepEqual(plain(order), ['sync-overview', 'sync-findings-stack', 'sync-export', 'sync-technical-all']);
  const stack = [...body.querySelector('.sync-findings-stack').children].map(node => node.className);
  assert.deepEqual(plain(stack), ['sync-findings is-blocked', 'sync-findings is-recoverable', 'sync-findings is-synced', 'sync-findings is-explained']);
  const technical = body.querySelector('.sync-technical-all');
  assert.equal(technical.open, false);
  assert.ok(technical.querySelector('.firebase-sync-grid'), 'o conteúdo técnico anterior continua disponível');
  assert.match(s.root.querySelector('.sync-overview').textContent, /Última confirmação do servidor24\/11/);
  s.close();
});

test('bloqueada oferece decisão individual e nunca o botão de recuperação em lote', () => {
  const s = screen();
  const blocked = s.root.querySelector('.sync-findings.is-blocked');
  assert.match(blocked.textContent, /Cliente fictício B · R\$\s?120,00 · 19\/11/);
  assert.ok(blocked.querySelector('[data-finding-sale="fx-ride-1"]'));
  assert.equal(blocked.querySelector('[data-finding-recover]'), null);
  const recoverable = s.root.querySelector('.sync-findings.is-recoverable');
  assert.equal(recoverable.querySelectorAll('[data-finding-recover]').length, 1);
  assert.ok(!recoverable.innerHTML.includes('fx-op-1'));
  s.close();
});

test('lote mostra andamento e resultado por item', async () => {
  const s = screen();
  s.root.querySelector('[data-recover-all]').click();
  await settle();
  assert.deepEqual(plain(s.calls.find(c => c[0] === 'batch')), ['batch', []]);
  assert.match(s.root.querySelector('.sync-batch-status').textContent, /1 concluída\(s\), 0 não recuperada\(s\)\. Backup salvo/);
  assert.match(s.root.querySelector('.sync-batch-results').textContent, /Recuperada #fx-sale-.*Registrada e confirmada/);
  s.close();
});

test('lote com falha deixa os botões ativos de novo e mostra o que ficou para trás', async () => {
  const s = screen({batch: async () => { throw Object.assign(Error('A sessão mudou durante a recuperação. Nada mais foi enviado.'), {recoveryResults: [{status: 'stopped', message: 'parou'}]}); }});
  const button = s.root.querySelector('[data-recover-all]');
  button.click(); await settle();
  assert.equal(button.disabled, false);
  assert.match(s.root.querySelector('.sync-batch-status').textContent, /A sessão mudou/);
  assert.match(s.root.querySelector('.sync-batch-results').textContent, /Interrompida/);
  s.close();
});

test('exportação mostra o resultado real; cópia falha vira texto para copiar manualmente', async () => {
  const s = screen({deliver: async (args) => args.mode === 'copy' ? {ok: false, manual: true, content: 'resumo fictício', message: 'Não foi possível copiar automaticamente.'} : {ok: true, method: 'share', message: 'diagnostic.json foi entregue ao aplicativo escolhido.'}});
  assert.equal(s.root.querySelector('[data-export-manual] textarea'), null, 'sem caixa de cópia até ser necessária');
  s.root.querySelector('[data-export-kind="diagnostic"][data-export-mode="share"]').click(); await settle();
  assert.equal(s.root.querySelector('.sync-export-status').textContent, 'diagnostic.json foi entregue ao aplicativo escolhido.');
  s.root.querySelector('[data-export-kind="summary"]').click(); await settle();
  assert.equal(s.root.querySelector('[data-export-manual] textarea').value, 'resumo fictício');
  assert.ok(s.root.querySelector('.sync-export-status').classList.contains('is-error'));
  s.close();
});

test('backup completo pede confirmação por conter dados pessoais', async () => {
  const s = screen({confirm: () => false, deliver: async () => ({ok: true, message: 'ok'})});
  s.root.querySelector('[data-export-kind="backup"]').click(); await settle();
  assert.equal(s.root.querySelector('.sync-export-status').textContent, 'Backup não baixado.');
  assert.ok(!s.calls.some(c => c[0] === 'supportExport'));
  s.close();
});

test('versão sem classificação continua com as ações anteriores (compatibilidade)', () => {
  const s = screen({findings: false});
  assert.ok(s.root.querySelector('.sync-overview [data-export-diagnostic]'));
  s.close();
});

test('corrida recusada oferece "Encerrar sem efeitos" com confirmação; recusar não envia nada', async () => {
  const s = screen(), calls = [];
  s.w.SyncFirebase.closeOnlyLocalSaleWithoutEffects = async (id) => { calls.push(id); return {idempotent: false}; };
  const button = s.root.querySelector('.sync-findings.is-blocked [data-finding-close="fx-ride-1"]');
  assert.ok(button, 'a ação aparece na linha bloqueada');
  assert.equal(s.root.querySelector('.sync-findings.is-recoverable [data-finding-close]'), null, 'nunca no lote');
  s.w.confirm = () => false;
  button.click(); await settle();
  assert.deepEqual(calls, []);
  let question = '';
  s.w.confirm = (text) => { question = text; return true; };
  button.click(); await settle();
  assert.deepEqual(calls, ['fx-ride-1']);
  assert.match(question, /saldo do cliente na nuvem fica exatamente como está/);
  assert.match(question, /backup/);
  s.close();
});
