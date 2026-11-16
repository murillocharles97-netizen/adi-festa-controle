'use strict';
// D5 — produto travado por edição de estoque recusada (incidente de 16/11/2026).
// Reproduz o diagnóstico real com IDs fictícios: 1 edição recusada (erro ativo),
// 1 venda em preparo retida e 1 entrada de estoque retida (revisões manuais).
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { queueRuntime, fakeServer, section } = require('./helpers/sync-queue-runtime.cjs');

const BID = 'qa-shop', UID = 'qa-owner', PRODUCT = 'qa-product-locked';
const base = (id, extra) => ({ queueId: id, operationId: id, businessId: BID, userId: UID, workspaceGeneration: 0, syncProtocolVersion: 1, payloadVersion: 4, ...extra });
const blocker = () => base('op-rejected-edit', { status: 'error', attempts: 1, lastAttemptAt: '2026-11-13T14:01:49Z',
  lastErrorCode: 'permission-denied', lastErrorMessage: 'Estoque sem movimento autorizado.', lastErrorStage: 'server_operational_commit',
  payload: { eventKind: 'simple', writes: [{ entityType: 'products', entityId: PRODUCT, operation: 'update',
    data: { estoqueAtual: 7, estoque: 7 }, before: { estoqueAtual: 5, estoque: 5, controlaEstoque: true } }] } });
const heldSale = () => base('op-held-sale', { status: 'local_preparing', payload: { eventKind: 'sale', writes: [
  { entityType: 'sales', entityId: 'sale-1', operation: 'create', data: { operationId: 'op-held-sale', spaceId: 's1', formaPagamento: 'pix', status: 'pago', itens: [{ produtoId: PRODUCT, quantidade: 1 }] } },
  { entityType: 'stockMovements', entityId: 'mov-1', operation: 'create', data: { produtoId: PRODUCT, quantidade: -1, vendaId: 'sale-1' } },
  { entityType: 'products', entityId: PRODUCT, operation: 'update', data: { estoqueAtual: 6 } }] } });
const stockEntry = () => base('op-stock-entry', { status: 'pending', payload: { eventKind: 'stock_entry', writes: [
  { entityType: 'products', entityId: PRODUCT, operation: 'update', data: { estoqueAtual: 10 } },
  { entityType: 'stockMovements', entityId: 'mov-2', operation: 'create', data: { produtoId: PRODUCT, quantidade: 4, tipo: 'entrada' } }] } });

function scenario({ marker = false, productExists = true, role = 'owner', online = true } = {}) {
  const stores = new Map([[`${UID}:${BID}`, JSON.stringify([blocker(), heldSale(), stockEntry()])]]);
  const h = queueRuntime(stores, { server: fakeServer(), uid: UID, businessId: BID }), c = h.context;
  const local = new Map(), applied = [], reads = [];
  Object.assign(c, {
    localStorage: { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, v) },
    queueKey: () => `adiFesta:${UID}:${BID}:syncQueue`, readQueueArchive: () => null,
    DB: { getWorkspaceGeneration: () => 0, flush: async () => {}, carregar: () => ({ produtos: [{ id: PRODUCT, controlaEstoque: true }] }) },
    db: {}, validateUser: async () => {}, doc: (_db, ...path) => path.join('/'),
    getDocFromServer: async (path) => { reads.push(path); const id = path.split('/').pop();
      if (path.includes('/processedOperations/')) return { exists: () => marker, data: () => ({}) };
      return { id, exists: () => productExists, data: () => ({ id, estoqueAtual: 5, estoque: 5, controlaEstoque: true }) }; },
    applyCloudCollection: (name, docs) => applied.push([name, docs.map((d) => d.id)]),
    assertCustomerPaymentReview: () => {},
  });
  c.navigator.onLine = online;
  c.window.BusinessContext = { get: () => ({ businessId: BID, role, business: { ownerId: role === 'owner' ? UID : 'other' } }) };
  vm.runInContext(section('async function resolveRejectedStockEdit(', 'async function archiveQuarantinedOperation('), c);
  const newSale = () => c.assertSaleQueueDependencies({ id: 'sale-new', itens: [{ produtoId: PRODUCT }] },
    [{ entityType: 'sales', data: { id: 'sale-new', itens: [{ produtoId: PRODUCT, quantidade: 1 }] } }]);
  return { h, c, local, applied, reads, newSale, stores };
}

test('antes: o produto está travado — 1 erro ativo, venda em preparo e entrada de estoque retidas', () => {
  const s = scenario(), [b, sale, entry] = s.h.queue();
  assert.throws(s.newSale, { code: 'sale-stock-review-required' });
  assert.equal(s.c.classifyQueueOperation(b).reviewReason, 'product_stock_review_required');
  assert.equal(s.c.stockQueueDependsOnRejection(sale, s.h.queue()), true);
  assert.equal(s.c.stockQueueDependsOnRejection(entry, s.h.queue()), true);
});

test('liberar: confere a nuvem, preserva a fila byte a byte e destrava novas vendas', async () => {
  const s = scenario(), before = s.stores.get(`${UID}:${BID}`);
  const r = await s.c.resolveRejectedStockEdit('op-rejected-edit');
  assert.equal(r.status, 'closed_without_effects'); assert.equal(r.serverProcessed, false); assert.equal(r.serverStock, 5);
  assert.deepEqual(s.reads.sort(), [`businesses/${BID}/processedOperations/op-rejected-edit`, `businesses/${BID}/products/${PRODUCT}`].sort());
  assert.equal(s.stores.get(`${UID}:${BID}`), before, 'nenhum pacote foi alterado ou removido');
  assert.equal(JSON.stringify(s.applied), JSON.stringify([['products', [PRODUCT]]]), 'só o produto volta a usar o estoque da nuvem');
  const [b, sale, entry] = s.h.queue();
  assert.equal(s.c.classifyQueueOperation(b).category, 'resolved');
  assert.equal(s.c.classifyQueueOperation(b).activeError, false);
  assert.doesNotThrow(s.newSale, 'novas vendas do produto voltam a ser permitidas');
  assert.equal(s.c.stockQueueDependsOnRejection(sale, s.h.queue()), false);
  assert.equal(s.c.classifyQueueOperation(sale).category, 'preparing', 'a venda em preparo continua intocada');
  assert.equal(s.c.stockQueueDependsOnRejection(entry, s.h.queue()), false, 'a entrada de estoque do usuário segue o fluxo normal');
});

test('a edição recusada nunca é reenviada, mesmo depois de liberada', async () => {
  const s = scenario();
  await s.c.resolveRejectedStockEdit('op-rejected-edit');
  assert.equal(s.c.classifyQueueOperation(s.h.queue()[0]).replayBlocked, true);
  assert.equal(vm.runInContext('canAttempt', s.c)(s.h.queue()[0], true, true), false);
});

test('bloqueios mantidos: marcador na nuvem, produto ausente, não proprietário ou offline não liberam nada', async () => {
  for (const [opts, message] of [[{ marker: true }, /registra esta operação/], [{ productExists: false }, /não existe na nuvem/],
    [{ role: 'seller' }, /Somente o proprietário/], [{ online: false }, /Conecte-se/]]) {
    const s = scenario(opts);
    await assert.rejects(s.c.resolveRejectedStockEdit('op-rejected-edit'), message);
    assert.equal(s.local.size, 0, JSON.stringify(opts)); assert.equal(s.applied.length, 0);
    assert.throws(s.newSale, { code: 'sale-stock-review-required' });
  }
});

test('evidência adulterada não libera', async () => {
  const s = scenario();
  const r = await s.c.resolveRejectedStockEdit('op-rejected-edit');
  const key = [...s.local.keys()][0];
  for (const tamper of [{ payloadChecksum: 'fnv1a:00000000' }, { serverProcessed: true }, { productId: 'other' }, { actorUid: 'x' }, { status: 'applied' }]) {
    s.local.set(key, JSON.stringify({ ...r, ...tamper }));
    assert.throws(s.newSale, { code: 'sale-stock-review-required' }, JSON.stringify(tamper));
  }
});

test('só edições de estoque recusadas podem ser liberadas por esta ação', async () => {
  const s = scenario();
  await assert.rejects(s.c.resolveRejectedStockEdit('op-stock-entry'), /não é uma edição de estoque recusada/);
  await assert.rejects(s.c.resolveRejectedStockEdit('op-held-sale'), /não é uma edição de estoque recusada/);
  await s.c.resolveRejectedStockEdit('op-rejected-edit');
  await assert.rejects(s.c.resolveRejectedStockEdit('op-rejected-edit'), /não é uma edição de estoque recusada/);
});
