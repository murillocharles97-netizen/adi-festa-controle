'use strict';
// V242.10: encerrar sem efeitos uma venda antiga recusada pela nuvem, e releitura
// completa dos clientes quando um aviso do servidor diz que saldos foram ajustados.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/firebase/sync.js', 'utf8').replace(/\r\n/g, '\n');
const section = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return source.slice(a, b); };

function harness(preview) {
  const calls = [];
  const context = vm.createContext({
    Number, String, Error, Promise, Math,
    compareDeviceWithCloud: async () => { calls.push(['compare']); },
    onlyLocalSaleReport: () => (preview ? [preview] : []),
    roundedMoney: value => Math.round(Number(value) * 100) / 100,
    reconcileOnlyLocalSaleBalance: async (id, debt, reason) => { calls.push(['reconcile', id, debt, reason]); return {operationId: 'legacy_reconciliation:' + id}; },
  });
  vm.runInContext(section('async function closeOnlyLocalSaleWithoutEffects(', 'async function recoverMissingNonFinancial(') + ';this.close=closeOnlyLocalSaleWithoutEffects;', context);
  return {close: context.close, calls};
}
const sale = extra => ({saleId: 'fx-ride', customerId: 'fx-client', remoteCurrentBalance: 0, resolved: false, ...extra});

test('encerrar mantém exatamente o saldo atual da nuvem (ajuste zero)', async () => {
  for (const [balance, debt] of [[0, 0], [-1234.5, 1234.5]]) {
    const h = harness(sale({remoteCurrentBalance: balance}));
    await h.close('fx-ride');
    const call = h.calls.find(c => c[0] === 'reconcile');
    assert.equal(call[1], 'fx-ride');
    assert.equal(call[2], debt, 'a dívida informada é a da nuvem, então o alvo é o saldo atual');
    assert.match(call[3], /encerrada sem efeitos/);
    assert.equal(h.calls[0][0], 'compare', 'compara com a nuvem antes de decidir');
  }
});

test('já encerrada é idempotente e não envia nada', async () => {
  const h = harness(sale({resolved: true, resolutionId: 'legacy_reconciliation:fx-ride'}));
  assert.equal((await h.close('fx-ride')).idempotent, true);
  assert.ok(!h.calls.some(c => c[0] === 'reconcile'));
});

test('sem prova suficiente nada é enviado', async () => {
  const cases = {
    'não pendente': null,
    'sem cliente': sale({customerId: ''}),
    'cliente não lido na nuvem': sale({remoteCurrentBalance: null}),
    'cliente com crédito': sale({remoteCurrentBalance: 25}),
  };
  for (const [name, preview] of Object.entries(cases)) {
    const h = harness(preview);
    await assert.rejects(h.close('fx-ride'), /Nada foi alterado|Compare com a nuvem/, name);
    assert.ok(!h.calls.some(c => c[0] === 'reconcile'), name);
  }
});

test('aviso com ajuste de saldo relê os clientes completos; vendas comuns continuam incrementais', () => {
  const download = section('async function download() {', 'const time=now();');
  assert.match(download, /const adjustedBalances=cloudNames\.includes\('clients'\)&&changed\.includes\('balanceAdjustments'\);/);
  assert.match(download, /pullCloudCollections\(\{force:true,names:adjustedBalances\?cloudNames\.filter\(name=>name!=='clients'\):cloudNames\}\)/);
  assert.match(download, /if\(adjustedBalances&&isCurrent\(\)\)await pullCloudCollections\(\{force:true,full:true,names:\['clients'\]\}\);/);
});

test('a regularização do servidor realmente não atualiza updatedAt (motivo da releitura)', () => {
  const service = fs.readFileSync('functions/src/services/fiado-space-regularization.js', 'utf8');
  const update = service.match(/tx\.update\(clientRef,\{[^}]+\}\)/)[0];
  assert.match(update, /atualizadoEm:at/);
  assert.doesNotMatch(update, /updatedAt/);
  const repository = fs.readFileSync('js/firebase/firestore-repository.js', 'utf8');
  assert.match(repository, /where\('updatedAt','>=',value\)/);
});

test('aparelho offline durante a regularização: ao voltar, o aviso acumulado dispara a releitura completa', () => {
  // Real signal handler body from startCloudSubscriptions.
  const start = "const unsubscribe=syncSignalRepository.subscribeById('last-sync',(signal,metadata)=>{";
  const body = section(start, '},error=>{').slice(start.length);
  const enqueued = new Map();
  const context = vm.createContext({
    String, Object, CustomEvent: class {}, window: {}, businessId: 'fx-shop', generation: 0,
    isCurrent: () => true, rememberSnapshotMetadata() {}, emit() {}, persist() {}, publishState() {}, schedule() {}, fail() {},
    DEFAULT_PULL_NAMES: ['sales'], signalCollections: {get size() { return enqueued.size; }, [Symbol.iterator]: () => enqueued.keys()},
    enqueue: (name, revision) => enqueued.set(name, revision),
    // What this device read before going offline.
    readSignalVersions: () => ({clients: 'server:fx-sale-before', balanceAdjustments: 'server:fx-old-adjustment', balanceEvents: 'server:fx-sale-before', sales: 'server:fx-sale-before'}),
  });
  vm.runInContext(`this.handler=(signal,metadata)=>{${body}};`, context);
  // Production shape: collectionVersions is merged across operations; a later sale did
  // not erase the regularization's versions for clients and balanceAdjustments.
  context.handler({businessId: 'fx-shop', workspaceGeneration: 0, revision: 'server:fx-later-sale', changedCollections: ['sales', 'clients'],
    collectionVersions: {clients: 'server:fx-later-sale', balanceAdjustments: 'server:fx-regularization', balanceEvents: 'server:fx-regularization', sales: 'server:fx-later-sale'}}, {});
  const changed = [...enqueued.keys()];
  assert.ok(changed.includes('balanceAdjustments') && changed.includes('clients'), JSON.stringify(changed));
  const cloudNames = changed;
  const adjustedBalances = cloudNames.includes('clients') && changed.includes('balanceAdjustments');
  assert.equal(adjustedBalances, true, 'the download step reads customers completely');
  const download = section('async function download() {', 'const time=now();');
  assert.match(download, /const adjustedBalances=cloudNames\.includes\('clients'\)&&changed\.includes\('balanceAdjustments'\);/);
});
