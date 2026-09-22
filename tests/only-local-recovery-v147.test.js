const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const syncSource = fs.readFileSync('js/firebase/sync.js', 'utf8');
const sourcePart = (start, end) => syncSource.slice(syncSource.indexOf(start),
  syncSource.indexOf(end, syncSource.indexOf(start)));
const moneyEqual = (left, right) => Math.abs(Number(left) - Number(right)) < 0.005;

test('auditoria classifica legado com estoque como revisão, não como upload seguro', () => {
  const legacy = { id: 'old-sale', operationId: 'old-operation', clienteId: 'client',
    businessId: 'company', status: 'fiado', formaPagamento: 'fiado', valorFinal: 26,
    saldoAnterior: -104.5, saldoAtual: -130.5, financialVersionAnterior: 0,
    data: '2026-09-16T19:53:34.428Z', itens: [{ produtoId: 'product', quantidade: 2,
      precoFinalUnitario: 13 }] };
  const modern = { ...legacy, id: 'new-sale', operationId: 'new-operation',
    syncPipelineVersion: 2, valorFinal: 20, saldoAnterior: -100,
    saldoAtual: -120, financialVersionAnterior: 10, data: '2026-09-22T12:00:00.000Z',
    itens: [{ itemKind: 'service', produtoId: 'service', quantidade: 1, precoFinalUnitario: 20 }] };
  const data = { vendas: [legacy, modern], clientes: [{ id: 'client', nome: 'Cliente Teste', saldo: -100 }],
    movimentacoesEstoque: [{ id: 'stock-1', vendaId: 'old-sale' }] };
  const audit = { report: { collections: { sales: { onlyLocal: [
    { documentId: 'old-sale' }, { documentId: 'new-sale' }] } } },
  raw: { sales: { remoteItems: [] }, clients: { remoteItems: [
    { id: 'client', saldo: -100, financialVersion: 10 }] } }, remoteFinancialEffects: [] };
  const context = { DB: { carregar: () => data }, currentAuditOrThrow: () => audit,
    readOrphanReviews: () => ({}), isOrphanReviewed: () => false,
    roundedMoney: (value) => Number(Number(value).toFixed(2)),
    sameFinancialMoney: moneyEqual, financialVersionOf: (client) => Number(client.financialVersion || 0),
    balanceEffectId: (type, id) => `${type}:${id}`, Date };
  vm.createContext(context);
  vm.runInContext(sourcePart('const orphanSaleSignature =', 'async function recoverMissingNonFinancial('), context);
  const rows = context.onlyLocalSaleReport();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].classification, 'E');
  assert.equal(rows[0].recoveryMode, '');
  assert.equal(rows[0].localStockMovementCount, 1);
  assert.equal(rows[0].customer, 'Cliente Teste');
  assert.equal(rows[1].classification, 'A');
  assert.equal(rows[1].recoveryMode, 'apply_financial');
});

function recoveryHarness(mode = 'apply_financial') {
  const sale = { id: 'sale-1', operationId: 'operation-1', clienteId: 'client-1',
    businessId: 'company', status: 'fiado', formaPagamento: 'fiado', valorFinal: 20,
    saldoAnterior: -100, saldoAtual: -120, financialVersionAnterior: 10,
    data: '2026-09-22T12:00:00.000Z', itens: [] };
  const data = { vendas: [sale] }, remoteSales = [], documents = new Map(),
    path = (collection, id) => `businesses/company/${collection}/${id}`;
  documents.set(path('clients', 'client-1'), { id: 'client-1', saldo: mode === 'publish_only' ? -120 : -100,
    financialVersion: mode === 'publish_only' ? 11 : 10, totalComprado: 80,
    quantidadeVendas: 4 });
  if (mode === 'publish_only') documents.set(path('balanceEvents', 'credit_sale:sale-1'), {
    id: 'credit_sale:sale-1', operationId: 'operation-1', sourceDocumentId: 'sale-1',
    customerId: 'client-1', balanceDelta: -20, appliedAt: '2026-09-22T12:01:00.000Z' });
  const audit = { raw: { sales: { remoteItems: remoteSales } },
    remoteFinancialEffects: mode === 'publish_only'
      ? [documents.get(path('balanceEvents', 'credit_sale:sale-1'))] : [] };
  let backups = 0, transactions = 0;
  const snapshot = (key) => ({ exists: () => documents.has(key), data: () => documents.get(key) });
  const context = { DB: { carregar: () => data }, Date,
    currentUser: { uid: 'owner' }, readOnlyMode: false, navigator: { onLine: true },
    state: { userProfile: { role: 'owner' } }, activeBusinessId: () => 'company',
    compareDeviceWithCloud: async () => {}, currentAuditOrThrow: () => audit,
    onlyLocalSaleReport: () => remoteSales.length ? [] : [{ saleId: 'sale-1', classification: 'A',
      recoveryMode: mode, reason: 'safe' }],
    automaticRecoveryBackup: () => { backups++; },
    doc: (_db, ...parts) => parts.join('/'), db: {},
    runTransaction: async (_db, callback) => {
      transactions++;
      const writes = [];
      const result = await callback({ get: async (key) => snapshot(key),
        set: (key, value, options) => writes.push({ key, value, options }) });
      for (const write of writes) documents.set(write.key,
        write.options?.merge ? { ...documents.get(write.key), ...write.value } : write.value);
      const effect = documents.get(path('balanceEvents', 'credit_sale:sale-1'));
      audit.remoteFinancialEffects = effect ? [effect] : [];
      return result;
    },
    getDocFromServer: async (key) => snapshot(key),
    cloudPayload: (_name, _id, value) => value,
    serverTimestamp: () => '2026-09-22T12:02:00.000Z',
    sanitizeForFirestore: (value) => value,
    roundedMoney: (value) => Number(Number(value).toFixed(2)),
    sameFinancialMoney: moneyEqual,
    financialVersionOf: (client) => Number(client.financialVersion || 0),
    balanceEffectId: (type, id) => `${type}:${id}`,
    legacyReconciliationOperationId: (id) => `legacy_reconciliation:${id}`,
    checksumValue: () => 'checksum', deviceId: () => 'device-a',
    now: () => '2026-09-22T12:02:00.000Z',
    cleanCloudItem: (value) => value,
    applyCloudCollection: (name, values) => {
      if (name === 'sales' && !remoteSales.length) remoteSales.push(values[0]);
    },
  };
  vm.createContext(context);
  vm.runInContext(sourcePart('async function recoverOnlyLocalSale(', 'async function reconcileFinancialBalances('), context);
  return { context, documents, path, sale, get backups() { return backups; },
    get transactions() { return transactions; } };
}

test('recovery segura usa mesmo saleId/operationId e aplica efeito uma vez, inclusive no retry', async () => {
  const h = recoveryHarness();
  const first = await h.context.recoverOnlyLocalSale('sale-1');
  assert.equal(first.recovered, true);
  assert.equal(first.recoveryMode, 'apply_financial');
  assert.equal(h.documents.get(h.path('clients', 'client-1')).saldo, -120);
  assert.equal(h.documents.get(h.path('clients', 'client-1')).financialVersion, 11);
  assert.equal(h.documents.get(h.path('balanceEvents', 'credit_sale:sale-1')).operationId, 'operation-1');
  assert.equal(h.documents.get(h.path('sales', 'sale-1')).operationId, 'operation-1');
  assert.equal(h.documents.get(h.path('processedOperations', 'operation-1')).idempotencyKey, 'operation-1');
  const second = await h.context.recoverOnlyLocalSale('sale-1');
  assert.equal(second.idempotent, true);
  assert.equal(h.documents.get(h.path('clients', 'client-1')).saldo, -120);
  assert.equal(h.transactions, 1);
  assert.equal(h.backups, 1);
});

test('efeito já aplicado permite publicar só a venda sem cobrar novamente', async () => {
  const h = recoveryHarness('publish_only');
  const result = await h.context.recoverOnlyLocalSale('sale-1');
  assert.equal(result.recoveryMode, 'publish_only');
  assert.equal(h.documents.get(h.path('clients', 'client-1')).saldo, -120);
  assert.equal(h.documents.get(h.path('balanceEvents', 'credit_sale:sale-1')).appliedAt,
    '2026-09-22T12:01:00.000Z');
  assert.equal(h.documents.get(h.path('sales', 'sale-1')).financialOperationId, 'credit_sale:sale-1');
});

test('versão ou saldo remoto alterado cancela recovery sem escrita financeira', async () => {
  const h = recoveryHarness();
  h.documents.get(h.path('clients', 'client-1')).financialVersion = 11;
  await assert.rejects(h.context.recoverOnlyLocalSale('sale-1'), /saldo ou a versão/);
  assert.equal(h.documents.has(h.path('sales', 'sale-1')), false);
  assert.equal(h.documents.has(h.path('balanceEvents', 'credit_sale:sale-1')), false);
  assert.equal(h.documents.get(h.path('clients', 'client-1')).saldo, -100);
});

test('sale remota sem evento financeiro não é declarada recuperada', async () => {
  const h = recoveryHarness();
  h.context.applyCloudCollection('sales', [{ id: 'sale-1', operationId: 'operation-1',
    financialAppliedAt: '2026-09-22T12:02:00.000Z' }]);
  await assert.rejects(h.context.recoverOnlyLocalSale('sale-1'), /confirmação financeira está incompleta/);
  assert.equal(h.transactions, 0);
});

test('ack da fila não remove venda só por marcador de início ou transação sem documento', async () => {
  let remoteSale = null, remoteEffect = null;
  const context = { activeBusinessId: () => 'company', db: {},
    doc: (_db, ...parts) => parts.join('/'),
    getDocFromServer: async (reference) => {
      const record = reference.includes('/balanceEvents/') ? remoteEffect : remoteSale;
      return { exists: () => Boolean(record), data: () => record };
    },
    roundedMoney: (value) => Number(Number(value || 0).toFixed(2)),
    sameFinancialMoney: moneyEqual,
    balanceEffectId: (type, id) => `${type}:${id}` };
  vm.createContext(context);
  vm.runInContext(sourcePart('async function verifySaleQueueCommit(', 'function rollbackPaymentConflict('), context);
  const queued = { operationId: 'operation-1', payload: { writes: [
    { entityType: 'sales', operation: 'create', entityId: 'sale-1',
      data: { operationId: 'operation-1', status: 'fiado', clienteId: 'client-1', valorFinal: 20 } }] } };
  await assert.rejects(context.verifySaleQueueCommit(queued),
    (error) => error.code === 'sale-remote-ack-missing');
  remoteSale = { operationId: 'operation-1', financialAppliedAt: '2026-09-22T12:00:00.000Z' };
  remoteEffect = { operationId: 'operation-1', sourceDocumentId: 'sale-1',
    customerId: 'client-1', balanceDelta: -19 };
  await assert.rejects(context.verifySaleQueueCommit(queued),
    (error) => error.code === 'sale-financial-ack-missing');
  remoteEffect.balanceDelta = -20;
  await assert.doesNotReject(context.verifySaleQueueCommit(queued));
  assert.match(syncSource, /await verifySaleQueueCommit\(live\[position\]\);[\s\S]*markLocalSaleConfirmed/);
});

test('guard bloqueia somente cliente da órfã conhecida e libera após revisão explícita', async () => {
  const oldSale = { id: 'old-sale', operationId: 'old-op', clienteId: 'bruna',
    status: 'fiado', data: '2026-09-16T19:53:34.428Z' };
  const data = { vendas: [oldSale], clientes: [
    { id: 'bruna', nome: 'Bruna' }, { id: 'other', nome: 'Outro cliente' }] };
  let reviewed = false;
  const context = { Date, currentUser: { uid: 'owner' }, readOnlyMode: false,
    DB: { __firebaseSyncWrapped: true, carregar: () => data },
    navigator: { onLine: true }, readQueue: () => [],
    readKnownOrphanIds: () => new Set(['old-sale']),
    isOrphanReviewed: () => reviewed, pendingIds: () => new Set(),
    getDocFromServer: async (reference) => reference.endsWith('/sales/old-sale')
      ? { exists: () => false }
      : { exists: () => true, data: () => ({ saldo: 0, financialVersion: 3 }) },
    doc: (_db, ...parts) => parts.join('/'), db: {},
    activeBusinessId: () => 'company', financialVersionOf: (client) => client.financialVersion,
    applyCloudCollection: () => {}, processSyncQueue: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(sourcePart('async function prepareCustomerForSale(', 'async function confirmCreditSale('), context);
  await assert.rejects(context.prepareCustomerForSale('bruna'),
    (error) => error.code === 'customer-credit-orphan' && error.saleId === 'old-sale');
  assert.equal((await context.prepareCustomerForSale('other')).source, 'server');
  reviewed = true;
  assert.equal((await context.prepareCustomerForSale('bruna')).source, 'server');
});

test('carrinho mostra um aviso com ação de comparar e não tenta reenviar fila vazia', () => {
  const checkout = fs.readFileSync('js/checkout.js', 'utf8');
  const ui = fs.readFileSync('js/firebase/firebase-ui.js', 'utf8');
  assert.match(checkout, /error\.code === "customer-credit-orphan"/);
  assert.match(checkout, /setSubmissionState\("conflict", message\)/);
  assert.match(checkout, /data-resolve-sale/);
  assert.match(checkout, /activeConflict && document\.querySelector\("#sale-payment-method"\)\?\.value === "fiado"/);
  assert.match(ui, /else retryAll\.remove\(\)/);
  assert.doesNotMatch(ui, /data-recover-financial/);
  assert.match(ui, /resolve-sale-conflict/);
});
