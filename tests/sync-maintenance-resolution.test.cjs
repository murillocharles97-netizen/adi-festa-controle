'use strict';
// Força-tarefa V242.10: decisão de manutenção financeira reconhecida de novo a
// partir da prova do servidor quando o registro local dela se perdeu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createHash} = require('node:crypto');

const source = fs.readFileSync('js/firebase/sync.js', 'utf8');
const section = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return source.slice(a, b); };
const checksum = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const HASH = 'a'.repeat(64);

function item(extra = {}) {
  return {operationId: 'fx-op-1', queueId: 'fx-op-1', businessId: 'fx-shop', userId: 'fx-owner', workspaceGeneration: 0, status: 'error', lastErrorCode: 'failed-precondition',
    payload: {eventKind: 'sale', writes: [{entityType: 'sales', entityId: 'fx-sale-1', operation: 'create', data: {spaceId: 'fx-space', operationId: 'fx-op-1'}}]}, ...extra};
}
function reconciliation(extra = {}) {
  return {
    'businesses/fx-shop/balanceAdjustments/legacy_reconciliation:fx-sale-1': {resolutionStatus: 'resolved_by_reconciliation', resolvedSaleId: 'fx-sale-1', resolvedOperationId: 'fx-op-1', businessId: 'fx-shop', workspaceGeneration: 0, spaceId: 'fx-space', resolvedAt: '2026-11-24T21:40:41.915Z', actorUid: 'fx-owner', ...extra.adjustment},
    'businesses/fx-shop/processedOperations/legacy_reconciliation:fx-sale-1': {status: 'processed', eventKind: 'balance_reconciliation', businessId: 'fx-shop', workspaceGeneration: 0, maintenanceRequestHash: HASH, ...extra.marker},
  };
}
function harness({queue = [item()], docs = reconciliation(), fail = false, onRead = null} = {}) {
  const storage = new Map(), reads = [];
  const context = vm.createContext({
    console, JSON, Math, Object, Array, String, Number, Set, Map, Error, Promise, Date, Boolean,
    currentUser: {uid: 'fx-owner'}, activeBusinessId: () => 'fx-shop', DB: {getWorkspaceGeneration: () => 0}, db: {},
    now: () => '2026-11-24T22:00:00.000Z', checksumValue: checksum, readQueue: () => queue,
    recoveryResolutionKey: q => 'resolution:' + q.operationId,
    localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v)},
    doc: (_db, ...parts) => parts.join('/'),
    getDocFromServer: async path => { reads.push(path); if (fail) throw Error('offline'); if (onRead && reads.length === 1) onRead(queue); return {exists: () => Object.hasOwn(docs, path), data: () => structuredClone(docs[path])}; },
    brandCreateIds: () => [], brandRejectedItem: () => false, rejectedProductStockUpdate: () => false, globalThis: {}, window: {},
  });
  vm.runInContext(section('function readRecoveryResolution(', 'async function refreshRecoveryResolutions(') + ';this.api={refreshMaintenanceResolutions,readRecoveryResolution};', context);
  return {api: context.api, storage, reads, queue, docs};
}

test('conciliação registrada no servidor volta a valer no aparelho, com a mesma validação local', async () => {
  const h = harness();
  assert.equal(await h.api.refreshMaintenanceResolutions(() => true), 1);
  const saved = h.api.readRecoveryResolution(h.queue[0]);
  assert.ok(saved, 'a resolução gravada passa na validação usada pela fila');
  assert.equal(saved.serverDecision, 'resolved_by_reconciliation');
  assert.equal(saved.source, 'server_evidence');
  assert.equal(saved.auditHash, HASH);
});

test('venda recuperada pela manutenção também é reconhecida', async () => {
  const docs = {
    'businesses/fx-shop/sales/fx-sale-1': {recoverySource: 'reviewed_only_local_sale', operationId: 'fx-op-1', businessId: 'fx-shop', workspaceGeneration: 0, spaceId: 'fx-space', recoveredAt: '2026-11-24T21:00:00.000Z', recoveredByUid: 'fx-owner'},
    'businesses/fx-shop/processedOperations/fx-op-1': {status: 'processed', eventKind: 'sale', businessId: 'fx-shop', maintenanceRequestHash: HASH},
  };
  const h = harness({docs});
  assert.equal(await h.api.refreshMaintenanceResolutions(() => true), 1);
  assert.equal(h.api.readRecoveryResolution(h.queue[0]).serverDecision, 'recovered');
});

test('qualquer prova incompleta ou diferente mantém a operação bloqueada', async () => {
  const cases = {
    'sem marcador': (() => { const d = reconciliation(); delete d['businesses/fx-shop/processedOperations/legacy_reconciliation:fx-sale-1']; return d; })(),
    'outra operação': reconciliation({adjustment: {resolvedOperationId: 'fx-op-outra'}}),
    'outro espaço': reconciliation({adjustment: {spaceId: 'fx-outro-espaco'}}),
    'outra empresa': reconciliation({adjustment: {businessId: 'fx-outra'}}),
    'outra geração': reconciliation({marker: {workspaceGeneration: 1}}),
    'hash inválido': reconciliation({marker: {maintenanceRequestHash: 'abc'}}),
    'ainda não processada': reconciliation({marker: {status: 'pending'}}),
  };
  for (const [name, docs] of Object.entries(cases)) {
    const h = harness({docs});
    assert.equal(await h.api.refreshMaintenanceResolutions(() => true), 0, name);
    assert.equal(h.storage.size, 0, name);
  }
});

test('operações de outro usuário, de outra empresa ou já resolvidas não são consultadas', async () => {
  const queue = [item({userId: 'fx-outro'}), item({operationId: 'fx-op-2', businessId: 'fx-outra'}), item({operationId: 'fx-op-3', status: 'pending'})];
  const h = harness({queue});
  assert.equal(await h.api.refreshMaintenanceResolutions(() => true), 0);
  assert.equal(h.reads.length, 0);
});

test('original alterado durante a leitura, falha de rede ou sessão trocada não resolvem nada', async () => {
  const h = harness({onRead: queue => { queue[0] = {...queue[0], payload: {...queue[0].payload, writes: [{...queue[0].payload.writes[0], data: {...queue[0].payload.writes[0].data, valorFinal: 999}}]}}; }});
  assert.equal(await h.api.refreshMaintenanceResolutions(() => true), 0, 'pacote mudou entre a leitura e a gravação');
  assert.equal(h.storage.size, 0);
  const offline = harness({fail: true});
  assert.equal(await offline.api.refreshMaintenanceResolutions(() => true), 0);
  assert.equal(offline.storage.size, 0);
  const retired = harness();
  assert.equal(await retired.api.refreshMaintenanceResolutions(() => false), 0);
  assert.equal(retired.storage.size, 0);
});

test('a revalidação roda antes das demais conferências da fila e é somente leitura', () => {
  const body = section('async function refreshMaintenanceResolutions(', 'async function refreshRecoveryResolutions(');
  assert.doesNotMatch(body, /FirebaseCallable|saveQueue|setDoc|updateDoc|writeBatch|runTransaction/);
  const refresh = section('async function refreshRecoveryResolutions(', 'function readQueueArchive(');
  assert.ok(refresh.indexOf('refreshMaintenanceResolutions') < refresh.indexOf("typeof window.FirebaseCallable!=='function'"));
});
