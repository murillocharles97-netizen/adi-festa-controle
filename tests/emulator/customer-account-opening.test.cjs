'use strict';
// Etapa 4 no Emulator: abertura da conta por Espaço para qualquer empresa e Espaço, sem
// política fixa. Cobre a abertura com saldo zero de um cliente cujo histórico antigo não se
// comprova, a abertura de saldo antigo sem eventos dividido entre Espaços, a diferença que
// exige motivo, o isolamento entre empresas e a repetição. Depois da abertura, a próxima
// venda e o recebimento seguem a conta por Espaço. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {customerAccountMigrationService} = require('../../functions/src/services/customer-account-migration-service');
const {customerAccountOpeningService} = require('../../functions/src/services/customer-account-opening-service');
const {decideReceiptRoute} = require('../../functions/src/services/fiado-receipt-route');
const sales = require('../helpers/fiado-cancellation-harness.cjs'), receipts = require('../helpers/owner-receipt-v219.cjs');

let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-general-opening'}, 'general-opening'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v));

async function business() {
  const bid = 'shop-' + crypto.randomUUID(), owner = 'owner-' + (++seq), manager = 'manager-' + seq, root = db.doc('businesses/' + bid);
  const spaces = ['loja-' + seq, 'oficina-' + seq, 'feira-' + seq].map(s => s + '-' + bid);
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  for (const [uid, role] of [[owner, 'owner'], [manager, 'manager']]) {
    await db.doc('users/' + uid).set({uid, businessId: bid, active: true, role});
    await root.collection('members').doc(uid).set({uid, role, status: 'active', spaceAccess: 'all', permissionsVersion: 2,
      permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true}});
  }
  for (const id of spaces) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true, inventory: true}});
  return {bid, owner, manager, root, spaces};
}
async function setup() {
  const b = await business(), other = await business(), {bid, owner, root} = b, [A, B, C] = b.spaces;
  const client = (id, extra) => root.collection('clients').doc(id).set({id, businessId: bid, nome: 'Pessoa QA ' + id, saldo: 0, financialVersion: 0, workspaceGeneration: 0, active: true, ativo: true, spaceId: A, customerSpaceIds: [A, B], ...extra});
  // Zero balance, version 0, and an old adjustment record without any effect: unprovable history.
  await client('c-leftover');
  await root.collection('balanceAdjustments').doc('qa-old-adjustment').set({id: 'qa-old-adjustment', businessId: bid, workspaceGeneration: 0, clienteId: 'c-leftover', clientId: 'c-leftover',
    tipo: 'ajuste_saldo', saldoAnterior: 0, saldoNovo: 0, status: 'applied', data: '2026-10-01T12:00:00.000Z'});
  // An old balance without events, split by the owner between two Spaces.
  await client('c-legacy', {saldo: -100, financialVersion: 1});
  const svc = operationalCommitService(db), shadow = customerAccountService(db, {verify: true});
  const opening = customerAccountOpeningService(db), migration = customerAccountMigrationService(db);
  const ref = (x, col, id) => db.doc(`businesses/${x}/${col}/${id}`);
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const docs = async (col, field, value) => (await root.collection(col).where(field, '==', value).get()).docs.map(d => ({...d.data(), id: d.id}));
  const req = (kind, extra = {}, uid = owner, businessId = bid) => ({auth: {uid}, data: {businessId, workspaceGeneration: 0, kind, ...extra}});
  const open = async (clientId, balances, reason, extra = {}) => {
    const p = await opening.preview(req('customer_account_opening_preview', {clientId, balances, reason}));
    const request = req('customer_account_opening', {clientId, balances: balances || p.parts.map(x => ({spaceId: x.spaceId, totalCents: x.totalCents})), reason, operationId: crypto.randomUUID(),
      reviewHash: p.reviewHash, confirmed: true, queueChecked: true, ...extra});
    return {preview: p, request, result: await opening.commit(request)};
  };
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
  const route = (clientId, spaceId) => svc.receipt(req('fiado_receipt_route', {clientId, spaceId, scopedReceiptVersion: 1, receiptProofVersion: 2}));
  const fullRoute = (clientId, spaceId) => db.runTransaction(async tx => {
    const c = await svc.authorize(tx, req('fiado_receipt_route'), {businessId: bid, userId: owner, workspaceGeneration: 0}, {readOnly: true});
    return decideReceiptRoute({tx, c, ref, clientId, spaceId, now: new Date(), scopedReceiptVersion: 1, receiptProofVersion: 2});
  }, {readOnly: true});
  const receive = async (clientId, space, reais) => {
    const r = await route(clientId, space), h = receipts.harness({businessId: bid, spaceId: space, uid: owner});
    try {
      Object.assign(h.rows(), {clientes: [await read('clients', clientId)], vendas: (await docs('sales', 'clienteId', clientId)).map(plain), pagamentos: [], alocacoesPagamento: []});
      h.w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
      const payment = h.w.Fiados.receber(clientId, reais, 'Pix fictício de QA', {spaceId: space, paymentMethod: 'pix', receiptRoute: r, fiadoAccount: r.scopedAccount});
      await svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: payment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
        payload: {eventKind: 'payment', fiadoHistoryVersion: 1, fiadoReceiptRoute: {version: 1, mode: r.mode, spaceId: space, quoteHash: r.quoteHash, receiptProofVersion: r.receiptProofVersion, scopedReceiptVersion: 1}, writes: h.writes()}}}});
      return {route: r, payment};
    } finally { h.close(); }
  };
  const sync = async () => { for (const d of (await root.collection('balanceEvents').get()).docs) await shadow.applyEvent(bid, d.id, d.data()); };
  return {...b, A, B, C, other, svc, opening, migration, read, docs, req, open, sell, route, fullRoute, receive, sync};
}
const rows = r => r.scopedAccount.entries.map(e => [e.saleId, e.historyEventId, e.remainingCents]);

test('cliente com saldo zero e histórico sem prova: a migração recusa; a abertura em zero começa a conta', async () => {
  const c = await setup();
  const blocked = await c.migration.preview(c.req('customer_account_migration_preview', {clientId: 'c-leftover'}));
  assert.deepEqual([blocked.status, blocked.reason], ['blocked', 'history_unproven']);
  const {preview, result} = await c.open('c-leftover');
  assert.deepEqual(preview.spaceIds, [c.A, c.B], 'os Espaços do próprio cliente, o principal primeiro');
  assert.deepEqual([result.status, result.confirmedCents, result.deltaCents], ['confirmed', 0, 0]);
  const client = await c.read('clients', 'c-leftover');
  assert.deepEqual([client.saldo, client.financialVersion, client.fiadoHistoryVersion, client.fiadoOpeningBalance.version], [0, 1, 1, 1]);
  const account = await c.read('customerAccounts', 'c-leftover');
  assert.deepEqual([account.status, account.debtCents, account.verification.status], ['ready', 0, 'match']);
  assert.ok(await c.read('balanceAdjustments', 'qa-old-adjustment'), 'o registro antigo fica guardado como evidência');
  const sale = await c.sell('c-leftover', c.A, 40);
  assert.equal((await c.read('sales', sale.id)).fiadoOpeningHash, client.fiadoOpeningBalance.hash, 'venda nova entra na conta aberta');
  await c.sync();
  const fast = await c.route('c-leftover', c.A);
  assert.equal(fast.source, 'customer_account'); assert.deepEqual(rows(fast), rows(await c.fullRoute('c-leftover', c.A)));
  await c.receive('c-leftover', c.A, 40);
  assert.equal((await c.read('sales', sale.id)).creditSettled, true);
});

test('saldo antigo sem eventos: o proprietário divide entre Espaços; a conta e a rota seguem a divisão', async () => {
  const c = await setup();
  assert.equal((await c.migration.preview(c.req('customer_account_migration_preview', {clientId: 'c-legacy'}))).status, 'blocked');
  const balances = [{spaceId: c.A, totalCents: 6000}, {spaceId: c.B, totalCents: 4000}];
  const {result} = await c.open('c-legacy', balances);
  assert.deepEqual([result.bookCents, result.confirmedCents, result.deltaCents], [10000, 10000, 0]);
  const account = await c.read('customerAccounts', 'c-legacy');
  assert.deepEqual(account.spaces, {[c.A]: 6000, [c.B]: 4000});
  const published = (await c.root.collection('customerSpaceAccounts').where('clientId', '==', 'c-legacy').get()).docs.map(d => [d.data().spaceId, d.data().debtCents]).sort();
  assert.deepEqual(published, [[c.A, 6000], [c.B, 4000]].sort());
  for (const [space, due] of [[c.A, 6000], [c.B, 4000]]) {
    const fast = await c.route('c-legacy', space), full = await c.fullRoute('c-legacy', space);
    assert.equal(fast.source, 'customer_account'); assert.equal(fast.dueCents, due); assert.deepEqual(rows(fast), rows(full));
  }
  await c.receive('c-legacy', c.A, 40);
  assert.equal((await c.read('clients', 'c-legacy')).saldo, -60);
  await c.sync();
  assert.deepEqual((await c.read('customerAccounts', 'c-legacy')).spaces, {[c.A]: 2000, [c.B]: 4000}, 'o recebimento reduz só o Espaço dele');
});

test('diferença em relação ao cadastro exige motivo; Espaço ou cliente de outra empresa e outro perfil são recusados', async () => {
  const c = await setup();
  await assert.rejects(c.open('c-legacy', [{spaceId: c.A, totalCents: 8000}, {spaceId: c.B, totalCents: 0}]), /Explique a diferença/);
  await assert.rejects(c.open('c-legacy', [{spaceId: c.other.spaces[0], totalCents: 10000}, {spaceId: c.B, totalCents: 0}]), /saldo válido/);
  await assert.rejects(c.opening.preview(c.req('customer_account_opening_preview', {clientId: 'c-legacy'}, c.manager)), e => e.code === 'permission-denied');
  await assert.rejects(c.opening.preview(c.req('customer_account_opening_preview', {clientId: 'c-legacy'}, c.other.owner)), e => e.code === 'permission-denied', 'dono de outra empresa');
  await assert.rejects(c.opening.preview(c.req('customer_account_opening_preview', {clientId: 'c-legacy'}, c.other.owner, c.other.bid)), e => e.code === 'permission-denied', 'cliente de outra empresa');
  assert.equal((await c.read('clients', 'c-legacy')).fiadoOpeningBalance, undefined, 'nada gravado');
  const {result} = await c.open('c-legacy', [{spaceId: c.A, totalCents: 8000}, {spaceId: c.B, totalCents: 0}], 'Saldo conferido no caderno fictício de QA');
  assert.deepEqual([result.deltaCents, (await c.read('clients', 'c-legacy')).saldo, (await c.read('clients', 'c-legacy')).financialVersion], [-2000, -80, 2]);
});

test('abertura é idempotente e única por cliente', async () => {
  const c = await setup();
  const first = await c.open('c-legacy', [{spaceId: c.A, totalCents: 10000}, {spaceId: c.B, totalCents: 0}]);
  assert.equal((await c.opening.commit(first.request)).status, 'replayed');
  await assert.rejects(c.opening.commit({...first.request, data: {...first.request.data, operationId: crypto.randomUUID()}}), /Já existe abertura/);
  await assert.rejects(c.opening.preview(c.req('customer_account_opening_preview', {clientId: 'c-legacy'})), /já tem uma abertura/);
  assert.equal((await c.migration.preview(c.req('customer_account_migration_preview', {clientId: 'c-legacy'}))).status, 'already_space');
});
