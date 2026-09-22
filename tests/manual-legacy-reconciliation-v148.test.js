const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const syncSource = fs.readFileSync('js/firebase/sync.js', 'utf8');
const checkoutSource = fs.readFileSync('js/checkout.js', 'utf8');
const uiSource = fs.readFileSync('js/firebase/firebase-ui.js', 'utf8');
const clientsSource = fs.readFileSync('js/clientes-page.js', 'utf8');
const sourcePart = (start, end) => syncSource.slice(syncSource.indexOf(start),
  syncSource.indexOf(end, syncSource.indexOf(start)));
const sameMoney = (left, right) => Math.abs(Number(left) - Number(right)) < 0.005;

function reconciliationHarness() {
  const sale = {
    id: 'sale-bruna-26', operationId: 'operation-bruna-26',
    clienteId: 'bruna', clienteNome: 'Bruna', businessId: 'company',
    status: 'fiado', formaPagamento: 'fiado', valorFinal: 26,
    saldoAnterior: -104.5, saldoAtual: -130.5,
    data: '2026-09-16T19:53:34.428Z', itens: [],
  };
  const data = { vendas: [sale], clientes: [
    { id: 'bruna', nome: 'Bruna', saldo: 0, financialVersion: 7 },
  ], movimentacoes: [] };
  const documents = new Map();
  const path = (collection, id) => `businesses/company/${collection}/${id}`;
  documents.set(path('clients', 'bruna'), {
    id: 'bruna', businessId: 'company', ownerId: 'owner', nome: 'Bruna',
    saldo: 0, openBalance: 0, financialVersion: 7, version: 2,
  });
  let queue = [{
    queueId: 'queue-orphan', operationId: sale.operationId,
    payload: { writes: [{ entityType: 'sales', operation: 'create', entityId: sale.id }] },
  }];
  const storage = new Map();
  let backups = 0;
  const snapshot = (key) => ({
    exists: () => documents.has(key),
    data: () => documents.get(key),
  });
  const preview = () => ({
    saleId: sale.id, operationId: sale.operationId, customerId: 'bruna',
    customer: 'Bruna', amount: 26, date: sale.data, status: 'fiado',
    remoteCurrentBalance: 0, remoteFinancialVersion: 7, resolved: false,
  });
  const context = {
    DB: { carregar: () => data }, Date,
    currentUser: { uid: 'owner' }, readOnlyMode: false,
    navigator: { onLine: true }, state: { userProfile: { role: 'owner' } },
    activeBusinessId: () => 'company', compareDeviceWithCloud: async () => {},
    onlyLocalSaleReport: () => [preview()],
    roundedMoney: (value) => Number(Number(value).toFixed(2)),
    financialVersionOf: (client) => Number(client.financialVersion || 0),
    sameFinancialMoney: sameMoney,
    legacyReconciliationOperationId: (id) => `legacy_reconciliation:${id}`,
    balanceEffectId: (type, id) => `${type}:${id}`,
    automaticRecoveryBackup: () => { backups++; },
    doc: (_db, ...parts) => parts.join('/'), db: {},
    runTransaction: async (_db, callback) => {
      const writes = [];
      const result = await callback({
        get: async (key) => snapshot(key),
        set: (key, value, options) => writes.push({ key, value, options }),
      });
      for (const write of writes) documents.set(write.key,
        write.options?.merge ? { ...documents.get(write.key), ...write.value } : write.value);
      return result;
    },
    getDocFromServer: async (key) => snapshot(key),
    serverTimestamp: () => '2026-09-22T14:20:00.000Z',
    increment: (value) => value,
    sanitizeForFirestore: (value) => value,
    cleanCloudItem: (value) => value,
    now: () => '2026-09-22T14:20:00.000Z',
    checksumValue: () => 'sale-checksum',
    readQueueStrict: () => queue,
    saveQueue: (next) => { queue = next; },
    readOrphanReviews: () => JSON.parse(storage.get('reviews') || '{}'),
    orphanReviewKey: () => 'reviews',
    localStorage: {
      setItem: (key, value) => storage.set(key, String(value)),
      getItem: (key) => storage.get(key) || null,
    },
    applyCloudCollectionBatch: (entries) => {
      for (const entry of entries) {
        if (entry.name === 'clients') Object.assign(data.clientes[0], entry.documents[0]);
        if (entry.name === 'balanceAdjustments') {
          const item = entry.documents[0];
          const index = data.movimentacoes.findIndex((value) => value.id === item.id);
          if (index >= 0) data.movimentacoes[index] = item; else data.movimentacoes.push(item);
        }
      }
    },
    dispatchEvent: () => {}, CustomEvent: class { constructor(type, options) {
      this.type = type; this.detail = options?.detail;
    } },
    safePublishSyncSignal: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(sourcePart('function archiveResolvedSaleQueue(',
    'async function recoverMissingNonFinancial('), context);
  return { context, data, documents, path, storage,
    get queue() { return queue; }, get backups() { return backups; } };
}

test('conciliação manual corrige R$0 para R$26, audita e remove somente a fila órfã', async () => {
  const h = reconciliationHarness();
  const result = await h.context.reconcileOnlyLocalSaleBalance(
    'sale-bruna-26', 26, 'Operação antiga não sincronizada');
  const resolutionId = 'legacy_reconciliation:sale-bruna-26';
  const adjustment = h.documents.get(h.path('balanceAdjustments', resolutionId));
  assert.equal(result.idempotent, false);
  assert.equal(result.balanceBefore, 0);
  assert.equal(result.balanceAfter, -26);
  assert.equal(h.documents.get(h.path('clients', 'bruna')).saldo, -26);
  assert.equal(h.data.clientes[0].saldo, -26);
  assert.equal(adjustment.adjustmentType, 'reconciliation');
  assert.equal(adjustment.reasonCode, 'legacy_sale_not_synced');
  assert.equal(adjustment.source, 'owner_manual_reconciliation');
  assert.equal(adjustment.actorUid, 'owner');
  assert.equal(adjustment.businessId, 'company');
  assert.equal(adjustment.clienteId, 'bruna');
  assert.equal(adjustment.resolvedSaleId, 'sale-bruna-26');
  assert.equal(adjustment.resolvedOperationId, 'operation-bruna-26');
  assert.equal(adjustment.resolutionStatus, 'resolved_by_reconciliation');
  assert.equal(h.documents.has(h.path('sales', 'sale-bruna-26')), false);
  assert.equal(h.queue.length, 0);
  assert.equal(JSON.parse(h.storage.get('reviews'))['sale-bruna-26'].decision,
    'resolved_by_reconciliation');
  assert.equal(h.data.movimentacoes.filter((item) => item.id === resolutionId).length, 1);
  assert.equal(-26 - 25, -51, 'a próxima venda fiado de R$25 parte do saldo reconciliado');
});

test('retry da mesma reconciliação é idempotente e não cria segundo ajuste', async () => {
  const h = reconciliationHarness();
  await h.context.reconcileOnlyLocalSaleBalance('sale-bruna-26', 26, 'Primeira confirmação');
  const second = await h.context.reconcileOnlyLocalSaleBalance(
    'sale-bruna-26', 26, 'Repetição no mesmo aparelho');
  assert.equal(second.idempotent, true);
  assert.equal(h.documents.get(h.path('clients', 'bruna')).saldo, -26);
  assert.equal([...h.documents.keys()].filter((key) => key.includes('/balanceAdjustments/')).length, 1);
  assert.equal(h.backups, 2);
});

test('interface exige saldo total, preserva carrinho e expõe histórico auditável', () => {
  assert.match(uiSource, /Resolver agora/);
  assert.match(uiSource, /Corrigir saldo manualmente/);
  assert.match(uiSource, /Saldo correto total em aberto/);
  assert.match(uiSource, /não apenas o valor desta venda/);
  assert.match(uiSource, /reconcileOnlyLocalSaleBalance/);
  assert.match(uiSource, /fromCart:true/);
  assert.match(checkoutSource, /function resumeAfterReconciliation\(customerId\)/);
  assert.match(checkoutSource, /activeConflict = null;[\s\S]*refreshClients\(\);[\s\S]*drawCart\(\);[\s\S]*saveDraft\(\)/);
  assert.match(clientsSource, /Ajuste de reconciliação/);
  assert.match(clientsSource, /Saldo corrigido de/);
});

test('fila e recuperação original consultam o tombstone antes de publicar a venda', () => {
  assert.match(syncSource, /sale-resolved-by-reconciliation/);
  assert.match(syncSource, /balanceAdjustments", legacyReconciliationOperationId\(write\.entityId\)/);
  assert.match(syncSource, /resolutionRef = doc\([\s\S]*legacyReconciliationOperationId\(id\)/);
  assert.match(syncSource, /Esta operação já foi conciliada manualmente/);
});
