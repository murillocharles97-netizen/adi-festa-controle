'use strict';
// Recuperação individual e em lote (força-tarefa V242.10), com o código real de
// js/firebase/sync.js e um servidor fictício idempotente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Findings = require('../js/sync-findings.js');
const plain = value => JSON.parse(JSON.stringify(value));

const source = fs.readFileSync('js/firebase/sync.js', 'utf8');
const section = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return source.slice(a, b); };

function harness({localSales = ['s-1', 's-2'], queue = [], failOn = new Set(), dropBeforeBatch = new Set()} = {}) {
  const server = new Map(), calls = [], downloads = [];
  let audits = 0, generation = 1;
  const auditFor = () => {
    const onlyLocal = localSales.filter(id => !server.has(id) && !dropBeforeBatch.has(id)).map(id => ({documentId: id, operationId: 'op-' + id, classification: 'B', category: 'local_only'}));
    return {businessId: 'qa-shop', generatedAt: `2026-11-24T22:0${audits}:00.000Z`, collections: {sales: {localTotal: localSales.length, remoteTotal: server.size, equal: [...server.keys()].map(id => ({documentId: id})), onlyLocal, onlyRemote: [], divergent: []}}};
  };
  const context = vm.createContext({
    globalThis: null, console, JSON, Math, Object, Array, String, Number, Set, Map, Error, Promise, Date, Boolean,
    navigator: {onLine: true}, readOnlyMode: false, currentUser: {uid: 'qa-owner'},
    activeBusinessId: () => 'qa-shop', now: () => '2026-11-24T22:00:00.000Z',
    state: {dataAudit: null, lastSync: '2026-11-24T21:59:00.000Z'}, lastDataAuditRaw: null,
    validateUser: async () => {},
    compareDeviceWithCloud: async () => { audits++; context.state.dataAudit = auditFor(); context.lastDataAuditRaw = {businessId: 'qa-shop', raw: {sales: {remoteItems: []}}}; return context.state.dataAudit; },
    queueDiagnostics: () => queue.map(row => ({...row})), retainedClientBalances: () => [],
    onlyLocalSaleReport: () => (context.state.dataAudit?.collections.sales.onlyLocal || []).map(row => ({saleId: row.documentId, classification: 'A', recoveryMode: 'sale_only', amount: 10})),
    readQueue: () => queue, classifyQueueOperation: item => ({category: item.category}),
    synchronizeNow: async (options) => { calls.push(['synchronizeNow', options]); for (const item of queue) if (item.category === 'error' && item.canRetry) item.category = item.next || 'resolved'; },
    recoverOnlyLocalSale: async (id) => {
      calls.push(['recover', id]);
      context.automaticRecoveryBackup();
      if (failOn.has(id)) { failOn.delete(id); throw Object.assign(Error('Versão/saldo original não permite novo débito.'), {code: 'failed-precondition'}); }
      if (context.__retireOn === id) context.syncSessionGeneration++;
      const idempotent = server.has(id); server.set(id, true); return {saleId: id, idempotent};
    },
    recoverMissingNonFinancial: async () => { calls.push(['recoverLocal']); },
    exportLocalDiagnostic: async () => ({businessId: 'qa-shop', nome: 'Fulano'}),
    downloadJsonFile: (value, filename) => { downloads.push(filename); return {ok: true}; },
    DB: {criarBackup: () => ({backupId: 'bk-' + (downloads.length + 1)})},
    window: {}, syncSessionGeneration: generation,
  });
  context.globalThis = context; context.SyncFindings = Findings;
  vm.runInContext([
    section('function automaticRecoveryBackup(', 'const currentAuditOrThrow'),
    section('// Força-tarefa V242.10: one read-only classification', 'async function exportLocalDiagnostic('),
    'this.api={syncFindings,supportExport,runSafeRecoveryBatch,lastServerConfirmation,automaticRecoveryBackup};',
  ].join('\n'), context);
  return {api: context.api, context, server, calls, downloads, audits: () => audits};
}

test('o lote revalida antes de enviar e não envia o que a nova comparação não comprova', async () => {
  const h = harness({dropBeforeBatch: new Set(['s-2'])});
  const result = await h.api.runSafeRecoveryBatch(['recover_sale:sales:s-1', 'recover_sale:sales:s-2']);
  assert.equal(h.calls[0][0], 'recover', 'a primeira escrita vem depois da comparação');
  assert.ok(h.audits() >= 2, 'compara antes e depois');
  assert.deepEqual(h.calls.filter(c => c[0] === 'recover').map(c => c[1]), ['s-1']);
  assert.equal(result.results.find(r => r.key === 'recover_sale:sales:s-2').status, 'no_longer_recoverable');
});

test('um único backup por lote, mesmo com várias vendas', async () => {
  const h = harness({localSales: ['s-1', 's-2', 's-3']});
  const result = await h.api.runSafeRecoveryBatch();
  assert.equal(h.downloads.length, 1);
  assert.equal(result.backupId, 'bk-1');
  assert.deepEqual(plain(result.results.map(r => r.status)), ['recovered', 'recovered', 'recovered']);
  h.api.automaticRecoveryBackup();
  assert.equal(h.downloads.length, 2, 'fora do lote, cada recuperação volta a ter seu backup');
});

test('falha parcial: as demais continuam; a nova rodada não duplica a que já entrou', async () => {
  const h = harness({failOn: new Set(['s-2'])});
  const first = await h.api.runSafeRecoveryBatch();
  assert.deepEqual(plain(first.results.map(r => [r.documentId, r.status])), [['s-1', 'recovered'], ['s-2', 'failed']]);
  assert.match(first.results[1].message, /Versão\/saldo/);
  const second = await h.api.runSafeRecoveryBatch();
  assert.deepEqual(plain(second.results.map(r => [r.documentId, r.status])), [['s-2', 'recovered']]);
  assert.equal(h.calls.filter(c => c[0] === 'recover' && c[1] === 's-1').length, 1, 's-1 enviada uma única vez');
  assert.equal(h.server.size, 2);
});

test('a mesma operação nunca entra duas vezes no lote', async () => {
  const h = harness();
  h.context.onlyLocalSaleReport = () => (h.context.state.dataAudit?.collections.sales.onlyLocal || []).map(row => ({saleId: row.documentId, classification: 'A', recoveryMode: 'sale_only'}));
  const original = h.context.compareDeviceWithCloud;
  h.context.compareDeviceWithCloud = async () => { const audit = await original(); for (const row of audit.collections.sales.onlyLocal) row.operationId = 'op-shared'; return audit; };
  const result = await h.api.runSafeRecoveryBatch();
  assert.equal(h.calls.filter(c => c[0] === 'recover').length, 1);
  assert.ok(result.results.some(r => r.status === 'skipped_duplicate'));
});

test('troca de sessão no meio do lote interrompe sem enviar mais nada', async () => {
  const h = harness({localSales: ['s-1', 's-2', 's-3']});
  h.context.__retireOn = 's-1';
  await assert.rejects(h.api.runSafeRecoveryBatch(), error => {
    assert.equal(error.code, 'sync-session-retired');
    assert.ok(error.recoveryResults.some(r => r.status === 'stopped'));
    return true;
  });
  assert.deepEqual(h.calls.filter(c => c[0] === 'recover').map(c => c[1]), ['s-1']);
});

test('operações bloqueadas nunca entram no lote, mesmo pedidas pela chave', async () => {
  const queue = [{operationId: 'op-ride', category: 'error', canRetry: false, replayBlocked: true, reviewReason: 'service_configuration_missing', collection: 'sales'}];
  const h = harness({localSales: [], queue});
  const result = await h.api.runSafeRecoveryBatch(['op:op-ride']);
  assert.equal(h.calls.length, 0);
  assert.equal(result.results[0].status, 'no_longer_recoverable');
});

test('falhas temporárias: um único reenvio seguro da fila, com resultado por operação', async () => {
  const queue = [
    {operationId: 'op-a', category: 'error', canRetry: true, replayBlocked: false, collection: 'products'},
    {operationId: 'op-b', category: 'error', canRetry: true, replayBlocked: false, collection: 'payments', next: 'pending'},
  ];
  const h = harness({localSales: [], queue});
  const result = await h.api.runSafeRecoveryBatch();
  assert.deepEqual(plain(h.calls), [['synchronizeNow', {manualRetry: true}]]);
  assert.deepEqual(plain(result.results.map(r => [r.operationId, r.status]).sort()), [['op-a', 'confirmed'], ['op-b', 'still_pending']]);
});

test('sem conexão ou com outro lote em andamento, nada é enviado', async () => {
  const offline = harness(); offline.context.navigator.onLine = false;
  await assert.rejects(offline.api.runSafeRecoveryBatch(), /exige conexão/);
  assert.equal(offline.calls.length, 0);
  const busy = harness();
  const first = busy.api.runSafeRecoveryBatch();
  await assert.rejects(busy.api.runSafeRecoveryBatch(), /já está em andamento/);
  await first;
});

test('exportações para suporte são redigidas; o backup é marcado como pessoal', async () => {
  const h = harness();
  await h.context.compareDeviceWithCloud();
  const diagnostic = await h.api.supportExport('diagnostic');
  assert.equal(diagnostic.content.nome, '[removido]');
  assert.equal(diagnostic.personal, false);
  assert.ok(Array.isArray(diagnostic.content.divergences.findings));
  const summary = await h.api.supportExport('summary', {stateTitle: 'Diferenças encontradas'});
  assert.equal(summary.mime, 'text/plain');
  assert.match(summary.content, /Última sincronização confirmada pelo servidor: 2026-11-24T21:59:00.000Z/);
  const backup = await h.api.supportExport('backup');
  assert.equal(backup.personal, true);
  h.context.window.TeamAccess = {has: () => false};
  await assert.rejects(h.api.supportExport('backup'), /não permite/);
});
