'use strict';
// Etapa 3 no Emulator: parcelamento na conta por Espaço. A conta guarda as parcelas
// comprovadas; a rota pela conta separa vencidas e futuras no dia do recebimento, aloca às
// parcelas como a rota atual, aceita antecipação e acompanha o passar dos dias sem novo
// evento. A migração de um cliente simples com parcelamento preserva vencimentos, valores e
// alocações. Vendas e recebimentos pelo código real do aparelho. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {customerAccountMigrationService} = require('../../functions/src/services/customer-account-migration-service');
const {decideReceiptRoute} = require('../../functions/src/services/fiado-receipt-route');
const Plan = require('../../functions/src/shared/installment-plan');
const sales = require('../helpers/fiado-cancellation-harness.cjs'), receipts = require('../helpers/owner-receipt-v219.cjs');

let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-installment-account'}, 'installment-account'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v));

async function setup() {
  const bid = 'installments-' + crypto.randomUUID(), owner = 'owner-' + (++seq), root = db.doc('businesses/' + bid), A = 'space-a-' + bid, B = 'space-b-' + bid;
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  await db.doc('users/' + owner).set({uid: owner, businessId: bid, active: true, role: 'owner'});
  await root.collection('members').doc(owner).set({uid: owner, role: 'owner', status: 'active', spaceAccess: 'all', permissionsVersion: 2,
    permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true}});
  for (const id of [A, B]) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true, inventory: true}});
  await root.collection('clients').doc('c-new').set({id: 'c-new', businessId: bid, nome: 'Pessoa QA nova', saldo: 0, financialVersion: 0, workspaceGeneration: 0, active: true, ativo: true, customerSpaceIds: [A, B]});
  await root.collection('clients').doc('c-simple').set({id: 'c-simple', businessId: bid, nome: 'Pessoa QA antiga', saldo: 0, financialVersion: 1, workspaceGeneration: 0, active: true, ativo: true, customerSpaceIds: [A, B]});
  const clock = {days: 0}, now = () => new Date(Date.now() + clock.days * 86400000);
  const svc = operationalCommitService(db, {now}), shadow = customerAccountService(db, {verify: true, now}), migration = customerAccountMigrationService(db, {now});
  const ref = (b, col, id) => db.doc(`businesses/${b}/${col}/${id}`);
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const docs = async (col, field, value) => (await root.collection(col).where(field, '==', value).get()).docs.map(d => ({...d.data(), id: d.id}));
  const req = (kind, extra = {}) => ({auth: {uid: owner}, data: {businessId: bid, workspaceGeneration: 0, kind, ...extra}});
  const shops = {};
  for (const space of [A, B]) {
    const h = sales.harness({businessId: bid, spaceId: space, uid: owner}), product = h.data().produtos[0];
    Object.assign(product, {id: 'qa-product-' + space, estoqueAtual: 500, estoque: 500, totalStock: 500});
    await root.collection('products').doc(product.id).set(sales.bridge(product)); shops[space] = h;
  }
  // A sale built on the device; with `installments`, the device first reads the account from the server.
  const sell = async (clientId, space, reais, installments) => {
    const h = shops[space], client = await read('clients', clientId);
    h.data().clientes = [client];
    h.data().vendas = (await docs('sales', 'clienteId', clientId)).map(plain);
    h.data().produtos = [{...(await read('products', 'qa-product-' + space)), id: 'qa-product-' + space}];
    const extra = installments ? {installmentTerms: {downPayment: 0, count: installments, firstDueDate: Plan.month(Plan.today(), 1)},
      installmentAccount: (await svc.receipt(req('fiado_account', {clientId, fiadoHistoryVersion: 1}))).account} : {};
    const before = sales.bridge(h.data());
    const sale = h.c.Vendas.registrar({id: crypto.randomUUID(), operationId: crypto.randomUUID(), businessId: bid, spaceId: space, clienteId: clientId, status: 'fiado', formaPagamento: 'fiado',
      itens: [{produtoId: 'qa-product-' + space, quantidade: 1, precoOriginal: reais, precoFinalUnitario: reais}], ...extra});
    await svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: sale.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
      payload: {eventKind: 'sale', fiadoHistoryVersion: 1, writes: sales.bridge(h.c.diffWrites(before, h.data()))}}}});
    return sale;
  };
  const route = (clientId, spaceId) => svc.receipt(req('fiado_receipt_route', {clientId, spaceId, scopedReceiptVersion: 1}));
  const fullRoute = (clientId, spaceId) => db.runTransaction(async tx => {
    const c = await svc.authorize(tx, req('fiado_receipt_route'), {businessId: bid, userId: owner, workspaceGeneration: 0}, {readOnly: true});
    return decideReceiptRoute({tx, c, ref, clientId, spaceId, now: now(), scopedReceiptVersion: 1});
  }, {readOnly: true});
  const receive = async (clientId, space, reais, {advance = false} = {}) => {
    const r = await route(clientId, space);
    const h = receipts.harness({businessId: bid, spaceId: space, uid: owner});
    try {
      Object.assign(h.rows(), {clientes: [await read('clients', clientId)], vendas: (await docs('sales', 'clienteId', clientId)).map(plain), pagamentos: [],
        alocacoesPagamento: (await docs('paymentAllocations', 'clientId', clientId)).map(plain)});
      h.w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
      const payment = h.w.Fiados.receber(clientId, reais, 'Pix fictício de QA', {spaceId: space, paymentMethod: 'pix', receiptRoute: r, allowAdvance: advance, ...(r.scopedAccount ? {fiadoAccount: r.scopedAccount} : {})});
      await svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: payment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
        payload: {eventKind: 'payment', fiadoHistoryVersion: 1, fiadoReceiptRoute: {version: 1, mode: r.mode, spaceId: space, quoteHash: r.quoteHash, scopedReceiptVersion: r.scopedReceiptVersion},
          writes: h.writes()}}}});
      return {route: r, payment};
    } finally { h.close(); }
  };
  const sync = async () => { for (const d of (await root.collection('balanceEvents').get()).docs) await shadow.applyEvent(bid, d.id, d.data()); };
  return {bid, owner, A, B, root, clock, svc, migration, read, docs, req, sell, route, fullRoute, receive, sync};
}
const rows = r => r.scopedAccount.entries.map(e => [e.saleId, e.number, e.dueDate, e.remainingCents]);
const parity = async (c, clientId, space) => {
  const fast = await c.route(clientId, space), full = await c.fullRoute(clientId, space);
  assert.equal(fast.source, 'customer_account', 'a rota pela conta decide');
  for (const key of ['mode', 'dueCents', 'futureCents', 'totalCents', 'financialVersion', 'asOf']) assert.deepEqual(fast[key], full[key], key);
  assert.deepEqual(rows(fast), rows(full), 'mesmas parcelas, vencimentos e valores');
  assert.equal(fast.scopedAccount.hasInstallments, full.scopedAccount.hasInstallments);
  return fast;
};

test('cliente novo com parcelamento nasce na conta por Espaço; vencidas e futuras iguais à reconstrução', async () => {
  const c = await setup();
  const plainSale = await c.sell('c-new', c.A, 50), plan = await c.sell('c-new', c.A, 300, 3);
  const client = await c.read('clients', 'c-new');
  assert.deepEqual([client.fiadoHistoryVersion, client.hasInstallmentFiado, client.fiadoHistoryActivation.spaceRegularization.origin], [1, true, 'native']);
  await c.sync();
  const fast = await parity(c, 'c-new', c.A);
  assert.deepEqual([fast.dueCents, fast.futureCents, fast.totalCents], [5000, 30000, 35000]);
  assert.deepEqual(rows(fast).map(r => [r[0], r[1], r[3]]), [[plainSale.id, null, 5000], [plan.id, 1, 10000], [plan.id, 2, 10000], [plan.id, 3, 10000]]);
});

test('recebimento do vencido e antecipação de parcelas alocam como a rota atual', async () => {
  const c = await setup();
  const plainSale = await c.sell('c-new', c.A, 50), plan = await c.sell('c-new', c.A, 300, 3);
  await c.sync();
  await c.receive('c-new', c.A, 50);
  assert.equal((await c.read('sales', plainSale.id)).creditSettled, true);
  await c.sync(); await parity(c, 'c-new', c.A);
  const advance = await c.receive('c-new', c.A, 120, {advance: true});
  assert.equal(advance.route.source, 'customer_account');
  const sale = await c.read('sales', plan.id);
  assert.deepEqual([sale.creditPaidAmount, sale.creditRemainingAmount, sale.creditSettled], [120, 180, false]);
  const allocation = (await c.docs('paymentAllocations', 'paymentId', advance.payment.id))[0];
  assert.deepEqual(allocation.scheduleRows.map(r => [r.number, r.amountCents, r.anticipated]), [[1, 10000, true], [2, 2000, true]]);
  await c.sync();
  const fast = await parity(c, 'c-new', c.A);
  assert.deepEqual(rows(fast).map(r => [r[1], r[3]]), [[2, 8000], [3, 10000]]);
  await assert.rejects(c.receive('c-new', c.A, 20), /excede|exigível/i, 'sem antecipação, parcela futura não é cobrada');
});

test('com o passar dos dias as parcelas vencem e a rota pela conta acompanha sem novo evento', async () => {
  const c = await setup();
  await c.sell('c-new', c.A, 300, 3);
  await c.sync();
  assert.deepEqual([(await parity(c, 'c-new', c.A)).dueCents], [0]);
  c.clock.days = 40;
  assert.deepEqual([(await parity(c, 'c-new', c.A)).dueCents], [10000], 'primeira parcela vencida');
  c.clock.days = 100;
  const later = await parity(c, 'c-new', c.A);
  assert.deepEqual([later.dueCents, later.futureCents], [30000, 0], 'todas vencidas');
});

test('migração de cliente simples com parcelamento preserva vencimentos, valores e alocações', async () => {
  const c = await setup();
  const plan = await c.sell('c-simple', c.A, 240, 4), other = await c.sell('c-simple', c.B, 30);
  const regime = await c.read('clients', 'c-simple');
  assert.equal(regime.fiadoHistoryActivation, undefined, 'cliente antigo não é aberto pela venda');
  await c.receive('c-simple', c.A, 60, {advance: true});
  const before = rows(await c.fullRoute('c-simple', c.A)), saleBefore = plain(await c.read('sales', plan.id));
  const q = await c.migration.preview(c.req('customer_account_migration_preview', {clientId: 'c-simple'}));
  assert.equal(q.status, 'eligible', q.reason); assert.deepEqual(q.spaces, {[c.A]: 18000, [c.B]: 3000});
  await c.migration.commit(c.req('customer_account_migration', {clientId: 'c-simple', operationId: crypto.randomUUID(), quoteHash: q.quoteHash, confirmed: true}));
  assert.deepEqual(plain(await c.read('sales', plan.id)), saleBefore, 'venda parcelada intacta');
  const fast = await parity(c, 'c-simple', c.A);
  assert.deepEqual(rows(fast), before, 'mesmas parcelas antes e depois da migração');
  await parity(c, 'c-simple', c.B);
  assert.equal((await c.read('sales', other.id)).creditRemainingAmount, 30);
});
