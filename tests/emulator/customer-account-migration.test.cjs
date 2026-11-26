'use strict';
// Etapa 2 no Emulator: o proprietário migra um cliente do regime simples para a conta por
// Espaço sem mudar nada financeiro — saldo, versão, vendas, recebimentos, alocações e
// eventos ficam iguais — e o próximo recebimento já usa a conta. Casos que mudariam o
// histórico são recusados sem gravar. Vendas e recebimentos pelo código real do aparelho.
// Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {customerAccountMigrationService} = require('../../functions/src/services/customer-account-migration-service');
const {decideReceiptRoute} = require('../../functions/src/services/fiado-receipt-route');
const sales = require('../helpers/fiado-cancellation-harness.cjs'), receipts = require('../helpers/owner-receipt-v219.cjs');

let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-migration'}, 'migration'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v));

async function setup() {
  const bid = 'migration-' + crypto.randomUUID(), owner = 'owner-' + (++seq), manager = 'manager-' + seq, root = db.doc('businesses/' + bid), A = 'space-a-' + bid, B = 'space-b-' + bid;
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  for (const [uid, role] of [[owner, 'owner'], [manager, 'manager']]) {
    await db.doc('users/' + uid).set({uid, businessId: bid, active: true, role});
    await root.collection('members').doc(uid).set({uid, role, status: 'active', spaceAccess: 'all', permissionsVersion: 2,
      permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true}});
  }
  for (const id of [A, B]) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true, inventory: true}});
  // financialVersion 1: an existing customer of the simple regime (not opened natively by Etapa 1).
  for (const id of ['c-simple', 'c-other', 'c-empty'])
    await root.collection('clients').doc(id).set({id, businessId: bid, nome: 'Pessoa QA ' + id, saldo: 0, financialVersion: 1, workspaceGeneration: 0, active: true, ativo: true, customerSpaceIds: [A, B]});
  const svc = operationalCommitService(db), shadow = customerAccountService(db, {verify: true}), migration = customerAccountMigrationService(db);
  const ref = (b, col, id) => db.doc(`businesses/${b}/${col}/${id}`);
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const docs = async (col, field, value) => (await root.collection(col).where(field, '==', value).get()).docs.map(d => ({...d.data(), id: d.id}));
  const req = (kind, extra = {}, uid = owner) => ({auth: {uid}, data: {businessId: bid, workspaceGeneration: 0, kind, ...extra}});
  const shops = {};
  for (const space of [A, B]) {
    const h = sales.harness({businessId: bid, spaceId: space, uid: owner}), product = h.data().produtos[0];
    Object.assign(product, {id: 'qa-product-' + space, estoqueAtual: 500, estoque: 500, totalStock: 500});
    await root.collection('products').doc(product.id).set(sales.bridge(product)); shops[space] = h;
  }
  const sell = async (clientId, space, reais) => {
    const h = shops[space];
    h.data().clientes = [await read('clients', clientId)];
    h.data().produtos = [{...(await read('products', 'qa-product-' + space)), id: 'qa-product-' + space}];
    const before = sales.bridge(h.data());
    const sale = h.c.Vendas.registrar({id: crypto.randomUUID(), operationId: crypto.randomUUID(), businessId: bid, spaceId: space, clienteId: clientId, status: 'fiado', formaPagamento: 'fiado',
      itens: [{produtoId: 'qa-product-' + space, quantidade: 1, precoOriginal: reais, precoFinalUnitario: reais}]});
    await svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: sale.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
      payload: {eventKind: 'sale', fiadoHistoryVersion: 1, writes: sales.bridge(h.c.diffWrites(before, h.data()))}}}});
    return sale;
  };
  const route = (clientId, spaceId) => svc.receipt(req('fiado_receipt_route', {clientId, spaceId, scopedReceiptVersion: 1}));
  const fullRoute = (clientId, spaceId) => db.runTransaction(async tx => {
    const c = await svc.authorize(tx, req('fiado_receipt_route'), {businessId: bid, userId: owner, workspaceGeneration: 0}, {readOnly: true});
    return decideReceiptRoute({tx, c, ref, clientId, spaceId, now: new Date(), scopedReceiptVersion: 1});
  }, {readOnly: true});
  const receive = async (clientId, space, reais) => {
    const r = await route(clientId, space);
    const h = receipts.harness({businessId: bid, spaceId: space, uid: owner});
    try {
      Object.assign(h.rows(), {clientes: [await read('clients', clientId)], vendas: (await docs('sales', 'clienteId', clientId)).map(plain), pagamentos: [],
        alocacoesPagamento: (await docs('paymentAllocations', 'clientId', clientId)).map(plain)});
      h.w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
      const payment = h.w.Fiados.receber(clientId, reais, 'Pix fictício de QA', {spaceId: space, paymentMethod: 'pix', receiptRoute: r, ...(r.scopedAccount ? {fiadoAccount: r.scopedAccount} : {})});
      await svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: payment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
        payload: {eventKind: 'payment', fiadoHistoryVersion: 1, fiadoReceiptRoute: {version: 1, mode: r.mode, spaceId: space, quoteHash: r.quoteHash, scopedReceiptVersion: r.scopedReceiptVersion},
          writes: h.writes()}}}});
      return {route: r, payment};
    } finally { h.close(); }
  };
  const sync = async () => { for (const d of (await root.collection('balanceEvents').get()).docs) await shadow.applyEvent(bid, d.id, d.data()); };
  const preview = (clientId, uid) => migration.preview(req('customer_account_migration_preview', clientId === undefined ? {} : {clientId}, uid));
  const migrate = async (clientId, extra = {}) => {
    const q = await preview(clientId);
    const request = req('customer_account_migration', {clientId, operationId: crypto.randomUUID(), quoteHash: q.quoteHash, confirmed: true, ...extra});
    return {quote: q, request, result: await migration.commit(request)};
  };
  // Every financial record of a customer, to prove a migration changed none of them.
  const snapshot = async clientId => {
    const client = await read('clients', clientId);
    return plain({saldo: client.saldo, financialVersion: client.financialVersion,
      sales: (await docs('sales', 'clienteId', clientId)).map(s => [s.id, s.creditOriginalAmount, s.creditPaidAmount, s.creditRemainingAmount, s.creditSettled]).sort(),
      payments: (await docs('payments', 'clienteId', clientId)).map(p => [p.id, p.valor, p.legacyAmount, p.allocatedAmount]).sort(),
      allocations: (await docs('paymentAllocations', 'clientId', clientId)).map(a => [a.id, a.amount]).sort(),
      events: (await docs('balanceEvents', 'customerId', clientId)).map(e => [e.id, e.balanceDelta, e.spaceId]).sort()});
  };
  return {bid, owner, manager, A, B, root, svc, migration, read, docs, sell, route, fullRoute, receive, sync, preview, migrate, snapshot};
}
const rows = route => route.scopedAccount.entries.map(e => [e.spaceId, e.saleId, e.remainingCents]);

test('migra cliente simples com vendas em dois Espaços e recebimento parcial, sem mudar nada financeiro', async () => {
  const c = await setup();
  const s1 = await c.sell('c-simple', c.A, 30), s2 = await c.sell('c-simple', c.A, 20), s3 = await c.sell('c-simple', c.B, 15);
  assert.equal((await c.read('clients', 'c-simple')).fiadoHistoryVersion, undefined, 'cliente existente continua simples na venda');
  await c.receive('c-simple', c.A, 35);
  const before = await c.snapshot('c-simple');
  assert.deepEqual(before.sales.find(s => s[0] === s1.id).slice(2), [30, 0, true]);
  const {quote, result} = await c.migrate('c-simple');
  assert.equal(quote.status, 'eligible'); assert.deepEqual(quote.spaces, {[c.A]: 1500, [c.B]: 1500});
  assert.equal(result.status, 'migrated');
  assert.deepEqual(await c.snapshot('c-simple'), before, 'saldo, versão, vendas, recebimentos, alocações e eventos iguais');
  const client = await c.read('clients', 'c-simple');
  assert.deepEqual([client.fiadoHistoryVersion, client.fiadoHistoryActivation.spaceRegularization.origin], [1, 'migration']);
  const account = await c.read('customerAccounts', 'c-simple');
  assert.deepEqual([account.status, account.verification.status, account.verification.financialVersion, account.spaces], ['ready', 'match', client.financialVersion, {[c.A]: 1500, [c.B]: 1500}]);
  const audit = await c.read('customerAccountMigrations', 'c-simple');
  assert.deepEqual([audit.before.regime, audit.before.bookCents, audit.after.regime], ['simples', 3000, 'conta_por_espaco']);
  // Right away, without waiting for the trigger: the receipt uses the account, equal to the full history.
  const fast = await c.route('c-simple', c.A), full = await c.fullRoute('c-simple', c.A);
  assert.equal(fast.source, 'customer_account'); assert.deepEqual(rows(fast), rows(full)); assert.deepEqual(rows(fast), [[c.A, s2.id, 1500]]);
  await c.receive('c-simple', c.A, 15);
  assert.equal((await c.read('sales', s2.id)).creditSettled, true);
  assert.equal((await c.read('sales', s3.id)).creditSettled, false, 'Espaço B intocado');
  await c.sync();
  const again = await c.route('c-simple', c.B);
  assert.equal(again.source, 'customer_account'); assert.deepEqual(rows(again), rows(await c.fullRoute('c-simple', c.B)));
});

test('migração é idempotente; prévia vencida é recusada; cliente já migrado não migra de novo', async () => {
  const c = await setup();
  await c.sell('c-simple', c.A, 30);
  const first = await c.migrate('c-simple');
  assert.equal((await c.migration.commit(first.request)).replayed, true);
  await assert.rejects(c.migration.commit({...first.request, data: {...first.request.data, quoteHash: 'f'.repeat(64)}}), e => e.code === 'already-exists');
  assert.equal((await c.preview('c-simple')).status, 'already_space');
  await assert.rejects(c.migration.commit({...first.request, data: {...first.request.data, operationId: crypto.randomUUID()}}), e => e.code === 'failed-precondition' && /já está na conta/.test(e.message));
  await c.sell('c-other', c.A, 10);
  const stale = await c.preview('c-other');
  await c.sell('c-other', c.A, 5);
  await assert.rejects(c.migration.commit({auth: {uid: c.owner}, data: {businessId: c.bid, workspaceGeneration: 0, kind: 'customer_account_migration', clientId: 'c-other',
    operationId: crypto.randomUUID(), quoteHash: stale.quoteHash, confirmed: true}}), e => e.code === 'aborted');
  assert.equal((await c.read('clients', 'c-other')).fiadoHistoryVersion, undefined);
});

test('recusas sem gravar: indicador de parcelamento sem venda parcelada, venda com restante divergente, pendência, outro perfil e cliente sem movimento', async () => {
  const c = await setup();
  const sale = await c.sell('c-simple', c.A, 30);
  const before = await c.snapshot('c-simple');
  const blocked = async (reason, uid) => {
    const q = await c.preview('c-simple', uid);
    assert.deepEqual([q.status, q.reason], ['blocked', reason]);
    assert.equal((await c.read('clients', 'c-simple')).fiadoHistoryVersion, undefined);
    assert.equal(await c.read('customerAccountMigrations', 'c-simple'), undefined);
  };
  await c.root.collection('clients').doc('c-simple').update({hasInstallmentFiado: true}); await blocked('history_review'); // flag sem venda parcelada (Etapa 3)
  await c.root.collection('clients').doc('c-simple').update({hasInstallmentFiado: false});
  await c.root.collection('sales').doc(sale.id).update({creditRemainingAmount: 12}); await blocked('sale_history_mismatch');
  await c.root.collection('sales').doc(sale.id).update({creditRemainingAmount: 30});
  const pending = c.root.collection('payments').doc('qa-pending');
  await pending.set({id: 'qa-pending', businessId: c.bid, workspaceGeneration: 0, clienteId: 'c-simple', clientId: 'c-simple', spaceId: c.A, valor: 5, status: 'conflict', applicationStatus: 'conflict'});
  const q = await c.preview('c-simple'); assert.equal(q.status, 'blocked'); assert.ok(['pending', 'history_review'].includes(q.reason), q.reason);
  await pending.delete();
  await assert.rejects(c.preview('c-simple', c.manager), e => e.code === 'permission-denied');
  assert.equal((await c.preview('c-empty')).status, 'nothing_to_migrate');
  assert.deepEqual(await c.snapshot('c-simple'), before);
  assert.equal((await c.preview('c-simple')).status, 'eligible', 'sem os impedimentos, a migração fica disponível');
});

test('prévia da empresa lista cada cliente com a situação e o motivo', async () => {
  const c = await setup();
  await c.sell('c-simple', c.A, 30);
  await c.sell('c-other', c.B, 10); await c.root.collection('clients').doc('c-other').update({hasInstallmentFiado: true});
  const all = await c.preview();
  const by = Object.fromEntries(all.items.map(i => [i.clientId, i.status === 'blocked' ? 'blocked:' + i.reason : i.status]));
  assert.deepEqual(by, {'c-empty': 'nothing_to_migrate', 'c-other': 'blocked:history_review', 'c-simple': 'eligible'});
  assert.deepEqual(all.summary, {nothing_to_migrate: 1, 'blocked:history_review': 1, eligible: 1});
  assert.equal(all.nextCursor, null);
  assert.ok(all.items.every(i => !('internal' in i)), 'a prévia não expõe o histórico');
});
