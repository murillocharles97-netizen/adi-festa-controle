'use strict';
// Etapa 1 no Emulator: o cliente novo nasce na conta por Espaço na primeira venda Fiado, e
// o recebimento por Espaço aloca às vendas na ordem do histórico (venda paga, recebimento
// parcial, campanhas). Vendas e recebimentos são montados pelo código real do aparelho e
// confirmados pelo servidor. Confere a paridade entre a rota pela conta e a reconstrução
// completa depois de cada operação. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {decideReceiptRoute} = require('../../functions/src/services/fiado-receipt-route');
const {readHistoryInput} = require('../../functions/src/services/fiado-history-service');
const History = require('../../functions/src/shared/fiado-history-account');
const Plan = require('../../functions/src/shared/installment-plan');
const sales = require('../helpers/fiado-cancellation-harness.cjs'), receipts = require('../helpers/owner-receipt-v219.cjs');

let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-native-account'}, 'native-account'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });

async function setup() {
  const bid = 'native-' + crypto.randomUUID(), owner = 'owner-' + (++seq), root = db.doc('businesses/' + bid), A = 'space-a-' + bid, B = 'space-b-' + bid;
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  await db.doc('users/' + owner).set({uid: owner, businessId: bid, active: true, role: 'owner'});
  await root.collection('members').doc(owner).set({uid: owner, role: 'owner', status: 'active', spaceAccess: 'all', permissionsVersion: 2,
    permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true}});
  for (const id of [A, B]) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true, inventory: true}});
  const client = (id, extra = {}) => root.collection('clients').doc(id).set({id, businessId: bid, nome: 'Pessoa QA ' + id, saldo: 0, financialVersion: 0, workspaceGeneration: 0, active: true, ativo: true, customerSpaceIds: [A, B], ...extra});
  await client('c-new'); await client('c-touched', {financialVersion: 2}); await client('c-reg');
  const svc = operationalCommitService(db), shadow = customerAccountService(db, {verify: true});
  const ref = (b, col, id) => db.doc(`businesses/${b}/${col}/${id}`);
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const docs = async (col, field, value) => (await root.collection(col).where(field, '==', value).get()).docs.map(d => ({...d.data(), id: d.id}));
  const req = (kind, extra = {}) => ({auth: {uid: owner}, data: {businessId: bid, workspaceGeneration: 0, kind, ...extra}});
  // One sale harness per Space, each with its own product.
  const shops = {};
  for (const space of [A, B]) {
    const h = sales.harness({businessId: bid, spaceId: space, uid: owner}), product = h.data().produtos[0];
    Object.assign(product, {id: 'qa-product-' + space, estoqueAtual: 500, estoque: 500, totalStock: 500});
    await root.collection('products').doc(product.id).set(sales.bridge(product)); shops[space] = h;
  }
  // Builds the sale on the device from the server's current client (or a stale local copy)
  // and returns the queue item, so tests can commit it now or later (offline queue).
  const prepareSale = async (clientId, space, reais, local) => {
    const h = shops[space];
    if (local !== 'device') h.data().clientes = [local || await read('clients', clientId)];
    const product = (await read('products', 'qa-product-' + space)); h.data().produtos = [{...product, id: 'qa-product-' + space}];
    const before = sales.bridge(h.data());
    const sale = h.c.Vendas.registrar({id: crypto.randomUUID(), operationId: crypto.randomUUID(), businessId: bid, spaceId: space, clienteId: clientId, status: 'fiado', formaPagamento: 'fiado',
      itens: [{produtoId: 'qa-product-' + space, quantidade: 1, precoOriginal: reais, precoFinalUnitario: reais}]});
    return {sale, request: {auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: sale.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
      payload: {eventKind: 'sale', fiadoHistoryVersion: 1, writes: sales.bridge(h.c.diffWrites(before, h.data()))}}}}};
  };
  const sell = async (clientId, space, reais) => { const p = await prepareSale(clientId, space, reais); await svc.commit(p.request); return p.sale; };
  const sync = async () => { for (const d of (await root.collection('balanceEvents').get()).docs) await shadow.applyEvent(bid, d.id, d.data()); };
  const route = (clientId, spaceId) => svc.receipt(req('fiado_receipt_route', {clientId, spaceId, scopedReceiptVersion: 1, receiptProofVersion: 2}));
  const fullRoute = (clientId, spaceId) => db.runTransaction(async tx => {
    const c = await svc.authorize(tx, req('fiado_receipt_route'), {businessId: bid, userId: owner, workspaceGeneration: 0}, {readOnly: true});
    return decideReceiptRoute({tx, c, ref, clientId, spaceId, now: new Date(), scopedReceiptVersion: 1, receiptProofVersion: 2});
  }, {readOnly: true});
  const project = clientId => db.runTransaction(async tx => {
    const client = await read('clients', clientId);
    return History.project(await readHistoryInput({tx, c: {bid, business: {workspaceGeneration: 0}, owner: true, has: () => true, space: async () => ({})}, ref, clientId, client, checkRowAccess: false}), Plan.today(), {scoped: true});
  });
  // The real device receipt, with the client's sales loaded, committed by the server.
  const prepareReceipt = async (clientId, space, reais, r) => {
    const h = receipts.harness({businessId: bid, spaceId: space, uid: owner});
    Object.assign(h.rows(), {clientes: [await read('clients', clientId)], vendas: (await docs('sales', 'clienteId', clientId)).map(plain), pagamentos: [], alocacoesPagamento: (await docs('paymentAllocations', 'clientId', clientId)).map(plain)});
    h.w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
    const payment = h.w.Fiados.receber(clientId, reais, 'Pix fictício de QA', {spaceId: space, paymentMethod: 'pix', receiptRoute: r, fiadoAccount: r.scopedAccount});
    const request = {auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: payment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
      payload: {eventKind: 'payment', fiadoHistoryVersion: 1, fiadoReceiptRoute: {version: 1, mode: r.mode, spaceId: space, quoteHash: r.quoteHash, receiptProofVersion: r.receiptProofVersion, scopedReceiptVersion: 1}, writes: h.writes()}}}};
    h.close();
    return {payment, request};
  };
  const receive = async (clientId, space, reais) => { const r = await route(clientId, space); const p = await prepareReceipt(clientId, space, reais, r); return {route: r, ...p, result: await svc.commit(p.request)}; };
  const regularize = async (clientId, total, spaceId) => {
    const q = await svc.receipt(req('fiado_space_regularization_preview', {clientId, spaceId}));
    return svc.commit(req('fiado_space_regularization', {clientId, spaceId, operationId: crypto.randomUUID(), quoteHash: q.quoteHash, financialVersion: q.financialVersion,
      targetDebtCents: total, purpose: 'historical_debt', reason: 'Ajuste conferido em anotação fictícia de QA', confirmed: true, localQueueChecked: true}));
  };
  return {bid, owner, A, B, root, svc, read, docs, sell, prepareSale, sync, route, fullRoute, project, prepareReceipt, receive, regularize, shops};
}
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v));
const rows = route => route.scopedAccount.entries.map(e => [e.spaceId, e.saleId, e.historyEventId, e.remainingCents]);
const parity = async (c, clientId, space) => {
  const fast = await c.route(clientId, space), full = await c.fullRoute(clientId, space);
  if (fast.source !== 'customer_account') { const a = await c.read('customerAccounts', clientId), cl = await c.read('clients', clientId);
    console.log('[conta]', JSON.stringify({status: a?.status, debt: a?.debtCents, spaces: a?.spaces, unattributed: a?.unattributedCents, baseline: !!a?.baseline,
      verification: a?.verification && {...a.verification, items: a.verification.items?.length, differences: a.verification.differences}, clientVersion: cl.financialVersion, saldo: cl.saldo, fast: {mode: fast.mode, reason: fast.reason}})); }
  assert.equal(fast.source, 'customer_account', 'a rota pela conta decide'); assert.equal(full.source, undefined);
  for (const key of ['mode', 'dueCents', 'futureCents', 'totalCents', 'financialVersion', 'asOf']) assert.deepEqual(fast[key], full[key], key);
  assert.deepEqual(rows(fast), rows(full), 'mesmos itens abertos, na mesma ordem');
  return fast;
};

test('cliente novo: a primeira venda Fiado abre a conta por Espaço; cliente já movimentado continua como estava', async () => {
  const c = await setup();
  const sale = await c.sell('c-new', c.A, 30);
  const client = await c.read('clients', 'c-new');
  assert.equal(client.fiadoHistoryVersion, 1);
  assert.deepEqual([client.fiadoHistoryActivation.spaceRegularization.version, client.fiadoHistoryActivation.spaceRegularization.origin], [1, 'native']);
  assert.equal(client.saldo, -30);
  assert.equal((await c.read('processedOperations', sale.operationId)).nativeSpaceAccount.spaceId, c.A);
  assert.deepEqual((await c.project('c-new')).entries.map(e => [e.spaceId, e.saleId, e.remainingCents]), [[c.A, sale.id, 3000]]);
  await c.sell('c-touched', c.A, 10);
  const touched = await c.read('clients', 'c-touched');
  assert.equal(touched.fiadoHistoryVersion, undefined, 'cliente com versão financeira anterior não muda de regime');
  assert.equal(touched.fiadoHistoryActivation, undefined);
});

test('recebimento parcial e total alocam às vendas do Espaço na ordem, marcam a venda paga e mantêm a paridade', async () => {
  const c = await setup();
  const s1 = await c.sell('c-new', c.A, 30), s2 = await c.sell('c-new', c.A, 20), s3 = await c.sell('c-new', c.B, 15);
  await c.sync();
  let fast = await parity(c, 'c-new', c.A);
  assert.deepEqual(rows(fast), [[c.A, s1.id, 'credit_sale:' + s1.id, 3000], [c.A, s2.id, 'credit_sale:' + s2.id, 2000]]);
  const partial = await c.receive('c-new', c.A, 40);
  assert.equal(partial.route.source, 'customer_account');
  const [v1, v2, v3] = await Promise.all([s1, s2, s3].map(s => c.read('sales', s.id)));
  assert.deepEqual([v1.creditPaidAmount, v1.creditRemainingAmount, v1.creditSettled], [30, 0, true], 'venda mais antiga paga');
  assert.deepEqual([v2.creditPaidAmount, v2.creditRemainingAmount, v2.creditSettled], [10, 10, false], 'recebimento parcial na seguinte');
  assert.equal(Number(v3.creditPaidAmount || 0), 0, 'Espaço B intocado');
  const allocations = await c.docs('paymentAllocations', 'paymentId', partial.payment.id);
  assert.deepEqual(allocations.map(a => [a.saleId, a.amount, a.settledSale]).sort(), [[s1.id, 30, true], [s2.id, 10, false]].sort());
  const payment = await c.read('payments', partial.payment.id);
  assert.deepEqual([payment.legacyAmount, payment.allocatedAmount], [0, 40]);
  await c.sync();
  fast = await parity(c, 'c-new', c.A);
  assert.deepEqual(rows(fast), [[c.A, s2.id, 'credit_sale:' + s2.id, 1000]]);
  await parity(c, 'c-new', c.B);
  await c.receive('c-new', c.A, 10);
  assert.equal((await c.read('sales', s2.id)).creditSettled, true, 'recebimento total quita a venda');
  assert.equal((await c.read('clients', 'c-new')).saldo, -15);
  await c.sync();
  const account = await c.read('customerAccounts', 'c-new');
  assert.deepEqual([account.spaces[c.A] || 0, account.spaces[c.B], account.clientFinancialVersion], [0, 1500, (await c.read('clients', 'c-new')).financialVersion]);
});

test('cliente regularizado antes também passa a marcar a venda paga; o saldo antigo é consumido primeiro', async () => {
  const c = await setup();
  await c.regularize('c-reg', 5000, c.A);
  const sale = await c.sell('c-reg', c.A, 25);
  await c.sync();
  const fast = await parity(c, 'c-reg', c.A);
  assert.deepEqual(rows(fast).map(r => [r[1], r[3]]), [[null, 5000], [sale.id, 2500]], 'ajuste antigo antes da venda');
  const r = await c.receive('c-reg', c.A, 60);
  const stored = await c.read('payments', r.payment.id), paid = await c.read('sales', sale.id);
  assert.deepEqual([stored.legacyAmount, stored.allocatedAmount], [50, 10]);
  assert.deepEqual([paid.creditPaidAmount, paid.creditRemainingAmount, paid.creditSettled], [10, 15, false]);
  await c.sync();
  assert.deepEqual(rows(await parity(c, 'c-reg', c.A)).map(x => [x[1], x[3]]), [[sale.id, 1500]]);
});

test('fila offline: vendas montadas no mesmo estado local entram em ordem; a ativação acontece uma vez', async () => {
  const c = await setup();
  // Offline: the second sale is built on this device right after the first, before any sync.
  const first = await c.prepareSale('c-new', c.A, 12), second = await c.prepareSale('c-new', c.A, 8, 'device');
  await c.svc.commit(first.request);
  const activation = (await c.read('clients', 'c-new')).fiadoHistoryActivation;
  await c.svc.commit(second.request);
  const client = await c.read('clients', 'c-new');
  assert.equal(client.saldo, -20);
  assert.deepEqual(client.fiadoHistoryActivation, activation, 'a segunda venda não reativa');
  assert.equal((await c.svc.commit(second.request)).replayed, true, 'reenvio idempotente');
  assert.equal((await c.read('clients', 'c-new')).saldo, -20);
  await c.sync(); await parity(c, 'c-new', c.A);
});

test('dois recebimentos sobre a mesma consulta: um confirma, o outro é recusado; reenvio não duplica', async () => {
  const c = await setup();
  await c.sell('c-new', c.A, 30); await c.sync();
  const r = await c.route('c-new', c.A);
  const a = await c.prepareReceipt('c-new', c.A, 20, r), b = await c.prepareReceipt('c-new', c.A, 20, r);
  const results = await Promise.allSettled([c.svc.commit(a.request), c.svc.commit(b.request)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1, JSON.stringify(results.map(x => x.reason?.message)));
  const winner = results[0].status === 'fulfilled' ? a : b;
  assert.equal((await c.svc.commit(winner.request)).replayed, true);
  assert.equal((await c.read('clients', 'c-new')).saldo, -10);
  assert.equal((await c.docs('paymentAllocations', 'clientId', 'c-new')).length, 1);
});

test('cancelamento: venda sem recebimento é desfeita; venda já paga exige revisão', async () => {
  const c = await setup();
  const s1 = await c.sell('c-new', c.A, 30), unpaid = {sale: plain(await c.read('sales', s1.id)), client: plain(await c.read('clients', 'c-new'))};
  await c.sync(); await c.receive('c-new', c.A, 30);
  const undo = async (sale, stale) => {
    const h = c.shops[c.A];
    h.data().clientes = [stale ? stale.client : await c.read('clients', 'c-new')];
    h.data().vendas = stale ? [{...stale.sale, id: sale.id}] : (await c.docs('sales', 'clienteId', 'c-new')).map(plain).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    h.data().alocacoesPagamento = stale ? [] : (await c.docs('paymentAllocations', 'clientId', 'c-new')).map(plain);
    const u = h.undo(sale.id); u.packet.payload.fiadoHistoryVersion = 1;
    return c.svc.commit({auth: {uid: c.owner}, data: {businessId: c.bid, clientRelease: 238, item: u.packet}});
  };
  await assert.rejects(undo(s1), /possui recebimento|concilia/i, 'o aparelho não desfaz venda paga');
  // Another device still sees the sale unpaid: the server refuses the cancellation.
  await assert.rejects(undo(s1, unpaid), e => e.code === 'failed-precondition' && /recebeu pagamento|recebida|concilia|revis/i.test(e.message), 'o servidor recusa');
  assert.equal((await c.read('sales', s1.id)).creditSettled, true);
  const s2 = await c.sell('c-new', c.A, 20);
  await undo(s2);
  assert.equal((await c.read('clients', 'c-new')).saldo, 0);
  await c.sync();
  const account = await c.read('customerAccounts', 'c-new');
  assert.deepEqual([account.debtCents, account.clientFinancialVersion], [0, (await c.read('clients', 'c-new')).financialVersion]);
});
