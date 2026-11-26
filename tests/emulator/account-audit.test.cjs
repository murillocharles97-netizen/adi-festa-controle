'use strict';
// Etapa 6 no Emulator: a reconstrução completa como auditoria e reconciliação. Uma sequência
// limpa não gera nenhum alerta. Divergências plantadas são acusadas: itens trocados de venda
// (com o mesmo total) são substituídos pelos comprovados; um total errado tira a conta do
// recebimento até o proprietário reconciliar. O gatilho audita por amostra. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {customerAccountAuditService} = require('../../functions/src/services/customer-account-audit-service');
const {decideReceiptRoute} = require('../../functions/src/services/fiado-receipt-route');
const sales = require('../helpers/fiado-cancellation-harness.cjs'), receipts = require('../helpers/owner-receipt-v219.cjs');

let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-account-audit'}, 'account-audit'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v));

async function setup() {
  const bid = 'audit-' + crypto.randomUUID(), owner = 'owner-' + (++seq), manager = 'manager-' + seq, root = db.doc('businesses/' + bid), A = 'space-a-' + bid;
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  for (const [uid, role] of [[owner, 'owner'], [manager, 'manager']]) {
    await db.doc('users/' + uid).set({uid, businessId: bid, active: true, role});
    await root.collection('members').doc(uid).set({uid, role, status: 'active', spaceAccess: 'all', permissionsVersion: 2,
      permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true}});
  }
  await db.doc('financialSpaces/' + A).set({id: A, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true, inventory: true}});
  for (const [id, fv] of [['c-new', 0], ['c-simple', 1]])
    await root.collection('clients').doc(id).set({id, businessId: bid, nome: 'Pessoa QA ' + id, saldo: 0, financialVersion: fv, workspaceGeneration: 0, active: true, ativo: true, spaceId: A, customerSpaceIds: [A]});
  const svc = operationalCommitService(db), audits = customerAccountAuditService(db);
  const ref = (b, col, id) => db.doc(`businesses/${b}/${col}/${id}`);
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const docs = async (col, field, value) => (await root.collection(col).where(field, '==', value).get()).docs.map(d => ({...d.data(), id: d.id}));
  const req = (kind, extra = {}, uid = owner) => ({auth: {uid}, data: {businessId: bid, workspaceGeneration: 0, kind, ...extra}});
  const h = sales.harness({businessId: bid, spaceId: A, uid: owner}), product = h.data().produtos[0];
  Object.assign(product, {id: 'qa-product', estoqueAtual: 9000, estoque: 9000, totalStock: 9000});
  await root.collection('products').doc(product.id).set(sales.bridge(product));
  const sell = async (clientId, reais) => {
    h.data().clientes = [await read('clients', clientId)]; h.data().produtos = [{...(await read('products', 'qa-product')), id: 'qa-product'}];
    const before = sales.bridge(h.data());
    const sale = h.c.Vendas.registrar({id: crypto.randomUUID(), operationId: crypto.randomUUID(), businessId: bid, spaceId: A, clienteId: clientId, status: 'fiado', formaPagamento: 'fiado',
      itens: [{produtoId: 'qa-product', quantidade: 1, precoOriginal: reais, precoFinalUnitario: reais}]});
    await svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: sale.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
      payload: {eventKind: 'sale', fiadoHistoryVersion: 1, writes: sales.bridge(h.c.diffWrites(before, h.data()))}}}});
    return sale;
  };
  const route = clientId => svc.receipt(req('fiado_receipt_route', {clientId, spaceId: A, scopedReceiptVersion: 1}));
  const fullRoute = clientId => db.runTransaction(async tx => {
    const c = await svc.authorize(tx, req('fiado_receipt_route'), {businessId: bid, userId: owner, workspaceGeneration: 0}, {readOnly: true});
    return decideReceiptRoute({tx, c, ref, clientId, spaceId: A, now: new Date(), scopedReceiptVersion: 1});
  }, {readOnly: true});
  const receive = async (clientId, reais) => {
    const r = await route(clientId), w = receipts.harness({businessId: bid, spaceId: A, uid: owner});
    try {
      Object.assign(w.rows(), {clientes: [await read('clients', clientId)], vendas: (await docs('sales', 'clienteId', clientId)).map(plain), pagamentos: [],
        alocacoesPagamento: (await docs('paymentAllocations', 'clientId', clientId)).map(plain)});
      w.w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
      const payment = w.w.Fiados.receber(clientId, reais, 'Pix fictício de QA', {spaceId: A, paymentMethod: 'pix', receiptRoute: r, fiadoAccount: r.scopedAccount});
      await svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: payment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
        payload: {eventKind: 'payment', fiadoHistoryVersion: 1, fiadoReceiptRoute: {version: 1, mode: r.mode, spaceId: A, quoteHash: r.quoteHash, scopedReceiptVersion: 1}, writes: w.writes()}}}});
    } finally { w.close(); }
  };
  const trigger = async options => {
    const shadow = customerAccountService(db, {verify: true, ...options}), out = [];
    for (const d of (await root.collection('balanceEvents').get()).docs) out.push(await shadow.applyEvent(bid, d.id, d.data()));
    return out;
  };
  return {bid, owner, manager, A, root, read, req, audits, sell, receive, route, fullRoute, trigger};
}
const rows = r => r.scopedAccount.entries.map(e => [e.saleId, e.historyEventId, e.remainingCents]);

test('sequência limpa: a auditoria da empresa não acusa nada', async () => {
  const c = await setup();
  await c.sell('c-new', 30); await c.sell('c-new', 20); await c.receive('c-new', 35); await c.sell('c-new', 12);
  const all = await c.audits.audit(c.req('customer_account_audit'));
  assert.deepEqual(all.summary, {match: 1}, JSON.stringify(all.items));
  assert.deepEqual([all.items[0].itemsCheck, all.items[0].lastFinding], ['match', null]);
  const fast = await c.route('c-new'); assert.equal(fast.source, 'customer_account'); assert.deepEqual(rows(fast), rows(await c.fullRoute('c-new')));
});

test('itens trocados de venda com o mesmo total: a auditoria acusa e substitui pelos comprovados', async () => {
  const c = await setup();
  const s1 = await c.sell('c-new', 30), s2 = await c.sell('c-new', 20);
  const account = await c.read('customerAccounts', 'c-new'), items = account.ledger.items.map(i => ({...i}));
  items.find(i => i.saleId === s1.id).remainingCents -= 1000; items.find(i => i.saleId === s2.id).remainingCents += 1000;
  await c.root.collection('customerAccounts').doc('c-new').update({'ledger.items': items}); // planted divergence
  assert.notDeepEqual(rows(await c.route('c-new')), rows(await c.fullRoute('c-new')));
  const r = await c.audits.audit(c.req('customer_account_audit', {clientId: 'c-new'}));
  assert.deepEqual([r.status, r.totals, r.itemsCheck, r.lastFinding.kind, r.lastFinding.action], ['items_divergent', 'match', 'divergent', 'items_divergent', 'items_replaced_by_proof']);
  assert.ok(r.lastFinding.kept && r.lastFinding.proven, 'o registro guarda os dois lados');
  const fast = await c.route('c-new'); assert.equal(fast.source, 'customer_account'); assert.deepEqual(rows(fast), rows(await c.fullRoute('c-new')));
});

test('total divergente: a conta sai do recebimento até a reconciliação do proprietário', async () => {
  const c = await setup();
  await c.sell('c-new', 30);
  await c.root.collection('customerAccounts').doc('c-new').update({debtCents: 3500, [`spaces.${c.A}`]: 3500}); // planted divergence
  const r = await c.audits.audit(c.req('customer_account_audit', {clientId: 'c-new'}));
  assert.deepEqual([r.status, r.totals, r.lastFinding.action], ['account_mismatch', 'mismatch', 'ledger_withdrawn']);
  const stale = await c.route('c-new'); assert.equal(stale.source, undefined, 'a rota completa decide'); assert.equal(stale.dueCents, 3000);
  const request = c.req('customer_account_reconcile', {clientId: 'c-new', operationId: crypto.randomUUID(), confirmed: true});
  const done = await c.audits.reconcile(request);
  assert.deepEqual([done.status, done.debtCents, done.previous.debtCents], ['reconciled', 3000, 3500]);
  assert.equal((await c.audits.reconcile(request)).replayed, true);
  const fast = await c.route('c-new'); assert.equal(fast.source, 'customer_account'); assert.deepEqual(rows(fast), rows(await c.fullRoute('c-new')));
  assert.equal((await c.audits.audit(c.req('customer_account_audit', {clientId: 'c-new'}))).status, 'match');
});

test('o gatilho audita por amostra os eventos já aplicados na transação', async () => {
  const c = await setup();
  await c.sell('c-new', 10); await c.sell('c-new', 15); await c.sell('c-new', 5);
  const none = await c.trigger({auditEvery: 0});
  assert.deepEqual(none.map(r => [r.status, Boolean(r.verification)]).filter(([, v]) => v).length, 1, 'só a primeira auditoria de uma conta nunca auditada');
  const again = await c.trigger({auditEvery: 0});
  assert.ok(again.every(r => r.status === 'duplicate' && !r.verification), 'auditoria recente: nada reconstruído');
  const all = await c.trigger({auditEvery: 1});
  assert.ok(all.every(r => r.status === 'duplicate' && r.verification?.status === 'match'), 'amostra total: todos auditados');
  const aged = await c.trigger({auditEvery: 0, auditMaxAgeMs: -1});
  assert.ok(aged.every(r => r.verification), 'auditoria vencida: auditada de novo');
});

test('só o proprietário audita e reconcilia; cliente fora da conta por Espaço vai para a migração', async () => {
  const c = await setup();
  await c.sell('c-new', 10); await c.sell('c-simple', 10);
  await assert.rejects(c.audits.audit(c.req('customer_account_audit', {}, c.manager)), e => e.code === 'permission-denied');
  await assert.rejects(c.audits.reconcile(c.req('customer_account_reconcile', {clientId: 'c-new', operationId: crypto.randomUUID(), confirmed: true}, c.manager)), e => e.code === 'permission-denied');
  await assert.rejects(c.audits.reconcile(c.req('customer_account_reconcile', {clientId: 'c-simple', operationId: crypto.randomUUID(), confirmed: true})), /migração ou a abertura/);
});
