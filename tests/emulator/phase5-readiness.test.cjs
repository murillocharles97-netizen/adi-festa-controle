'use strict';
// Etapa 7 no Emulator: preparação da Fase 5. A consulta da conta usada pelo aparelho (telas e
// crediário) responde da conta por Espaço, igual à reconstrução e com leituras constantes; o
// cancelamento pela Function vale em qualquer Espaço do cliente; e a prontidão mostra o que
// ainda falta para tirar a prova antiga do aparelho. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountAuditService} = require('../../functions/src/services/customer-account-audit-service');
const {customerAccountMigrationService} = require('../../functions/src/services/customer-account-migration-service');
const {saleCancellationService} = require('../../functions/src/services/sale-cancellation-service');
const {loadHistory} = require('../../functions/src/services/fiado-history-service');
const LedgerService = require('../../functions/src/services/customer-account-ledger-service');
const Plan = require('../../functions/src/shared/installment-plan');
const sales = require('../helpers/fiado-cancellation-harness.cjs'), receipts = require('../helpers/owner-receipt-v219.cjs');

let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-phase5'}, 'phase5'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v));
function metered(base) {
  const stats = {docs: 0};
  const wrap = tx => new Proxy(tx, {get(t, k) {
    if (k === 'get') return async r => { const s = await t.get(r); stats.docs += Array.isArray(s?.docs) ? Math.max(1, s.size) : 1; return s; };
    const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
  }});
  return {db: new Proxy(base, {get(t, k) { if (k === 'runTransaction') return (fn, o) => t.runTransaction(tx => fn(wrap(tx)), o); const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; }}),
    take() { const n = stats.docs; stats.docs = 0; return n; }};
}

async function setup() {
  const bid = 'phase5-' + crypto.randomUUID(), owner = 'owner-' + (++seq), root = db.doc('businesses/' + bid), A = 'space-a-' + bid, B = 'space-b-' + bid;
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  await db.doc('users/' + owner).set({uid: owner, businessId: bid, active: true, role: 'owner'});
  await root.collection('members').doc(owner).set({uid: owner, role: 'owner', status: 'active', spaceAccess: 'all', permissionsVersion: 2,
    permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true, 'sales.cancel': true}});
  for (const id of [A, B]) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true, inventory: true}});
  const client = (id, extra = {}) => root.collection('clients').doc(id).set({id, businessId: bid, nome: 'Pessoa QA ' + id, saldo: 0, financialVersion: 0, workspaceGeneration: 0,
    active: true, ativo: true, spaceId: A, customerSpaceIds: [A, B], ...extra});
  const meter = metered(db), svc = operationalCommitService(meter.db), plainSvc = operationalCommitService(db);
  const ref = (b, col, id) => db.doc(`businesses/${b}/${col}/${id}`);
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const docs = async (col, field, value) => (await root.collection(col).where(field, '==', value).get()).docs.map(d => ({...d.data(), id: d.id}));
  const req = (kind, extra = {}) => ({auth: {uid: owner}, data: {businessId: bid, workspaceGeneration: 0, kind, ...extra}});
  const shops = {};
  for (const space of [A, B]) {
    const h = sales.harness({businessId: bid, spaceId: space, uid: owner}), product = h.data().produtos[0];
    Object.assign(product, {id: 'qa-product-' + space, estoqueAtual: 9000, estoque: 9000, totalStock: 9000});
    await root.collection('products').doc(product.id).set(sales.bridge(product)); shops[space] = h;
  }
  const sell = async (clientId, space, reais, installments) => {
    const h = shops[space];
    h.data().clientes = [await read('clients', clientId)]; h.data().produtos = [{...(await read('products', 'qa-product-' + space)), id: 'qa-product-' + space}];
    h.data().vendas = (await docs('sales', 'clienteId', clientId)).map(plain).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const extra = installments ? {installmentTerms: {downPayment: 0, count: installments, firstDueDate: Plan.month(Plan.today(), 1)},
      installmentAccount: (await plainSvc.receipt(req('fiado_account', {clientId, fiadoHistoryVersion: 1}))).account} : {};
    const before = sales.bridge(h.data());
    const sale = h.c.Vendas.registrar({id: crypto.randomUUID(), operationId: crypto.randomUUID(), businessId: bid, spaceId: space, clienteId: clientId, status: 'fiado', formaPagamento: 'fiado',
      itens: [{produtoId: 'qa-product-' + space, quantidade: 1, precoOriginal: reais, precoFinalUnitario: reais}], ...extra});
    await plainSvc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: sale.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
      payload: {eventKind: 'sale', fiadoHistoryVersion: 1, writes: sales.bridge(h.c.diffWrites(before, h.data()))}}}});
    return sale;
  };
  const receive = async (clientId, space, reais) => {
    const r = await plainSvc.receipt(req('fiado_receipt_route', {clientId, spaceId: space, scopedReceiptVersion: 1})), w = receipts.harness({businessId: bid, spaceId: space, uid: owner});
    try {
      Object.assign(w.rows(), {clientes: [await read('clients', clientId)], vendas: (await docs('sales', 'clienteId', clientId)).map(plain), pagamentos: [],
        alocacoesPagamento: (await docs('paymentAllocations', 'clientId', clientId)).map(plain)});
      w.w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
      const payment = w.w.Fiados.receber(clientId, reais, 'Pix fictício de QA', {spaceId: space, paymentMethod: 'pix', receiptRoute: r, fiadoAccount: r.scopedAccount});
      await plainSvc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: payment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
        payload: {eventKind: 'payment', fiadoHistoryVersion: 1, fiadoReceiptRoute: {version: 1, mode: r.mode, spaceId: space, quoteHash: r.quoteHash, scopedReceiptVersion: 1}, writes: w.writes()}}}});
    } finally { w.close(); }
  };
  const lookup = clientId => svc.receipt(req('fiado_account', {clientId, fiadoHistoryVersion: 1}));
  const rebuilt = clientId => db.runTransaction(async tx => {
    const c = await plainSvc.authorize(tx, req('fiado_account'), {businessId: bid, userId: owner, workspaceGeneration: 0}, {readOnly: true});
    return (await loadHistory({tx, c, ref, clientId, client: await read('clients', clientId), day: Plan.today()})).account;
  }, {readOnly: true});
  return {bid, owner, A, B, root, client, read, req, sell, receive, lookup, rebuilt, meter};
}
const view = a => ({...a, source: undefined, entries: a.entries.map(e => [e.spaceId, e.saleId, e.number ?? null, e.historyEventId || null, e.dueDate, e.remainingCents])});

test('a consulta da conta responde da conta por Espaço, igual à reconstrução e com leituras constantes', async () => {
  const c = await setup(); await c.client('c-new');
  const counts = [];
  await c.sell('c-new', c.A, 30); await c.sell('c-new', c.A, 300, 3);
  for (let i = 0; i < 4; i++) {
    await c.sell('c-new', i % 2 ? c.A : c.B, 10 + i); await c.receive('c-new', c.A, 5);
    c.meter.take(); const fast = (await c.lookup('c-new')).account; counts.push(c.meter.take());
    assert.equal(fast.source, 'customer_account');
    assert.deepEqual(view(fast), view(await c.rebuilt('c-new')), 'mesma conta, itens e parcelas');
  }
  assert.equal(new Set(counts).size, 1, 'mesmo número de leituras com o histórico crescendo: ' + counts.join(','));
  const real = LedgerService.prepare; LedgerService.prepare = async () => null;
  try { await c.sell('c-new', c.A, 7); } finally { LedgerService.prepare = real; }
  const stale = (await c.lookup('c-new')).account;
  assert.equal(stale.source, undefined, 'conta atrasada: reconstrução, como antes');
  assert.deepEqual(view(stale), view(await c.rebuilt('c-new')));
});

test('cancelamento pela Function vale no Espaço secundário do cliente e a conta acompanha', async () => {
  const c = await setup(); await c.client('c-new');
  await c.sell('c-new', c.A, 20);
  const sale = await c.sell('c-new', c.B, 15);
  const cancel = saleCancellationService(db, {allowNewCancellations: true}), data = {businessId: c.bid, workspaceGeneration: 0, spaceId: c.B, saleId: sale.id};
  const p = await cancel.preview({auth: {uid: c.owner}, data});
  await cancel.confirm({auth: {uid: c.owner}, data: {...data, operationId: p.operationId, fingerprint: p.fingerprint, reason: 'Cancelamento fictício de QA', confirmed: true, refundHandling: 'not_applicable'}});
  assert.equal((await c.read('clients', 'c-new')).saldo, -20);
  const account = await c.read('customerAccounts', 'c-new');
  assert.deepEqual([account.spaces, account.clientFinancialVersion], [{[c.A]: 2000}, (await c.read('clients', 'c-new')).financialVersion]);
  assert.deepEqual(view((await c.lookup('c-new')).account), view(await c.rebuilt('c-new')));
});

test('prontidão para a Fase 5: mostra o que falta e libera só quando tudo está na conta', async () => {
  const c = await setup();
  await c.client('c-new'); await c.client('c-simple', {financialVersion: 1}); await c.client('c-empty'); await c.client('c-gone', {active: false, ativo: false});
  await c.sell('c-new', c.A, 30); await c.sell('c-simple', c.A, 40);
  const audits = customerAccountAuditService(db);
  await c.root.collection('customerAccounts').doc('c-new').update({debtCents: 3100, [`spaces.${c.A}`]: 3100});
  await audits.audit(c.req('customer_account_audit', {clientId: 'c-new'})); // planted finding
  let r = await audits.readiness(c.req('customer_account_readiness'));
  const state = () => Object.fromEntries(r.items.map(i => [i.clientId, i.state]));
  assert.deepEqual(state(), {'c-empty': 'no_history', 'c-gone': 'archived', 'c-new': 'finding', 'c-simple': 'needs_migration'});
  assert.deepEqual([r.readyForPhase5, r.blocking], [false, 2]);
  await audits.reconcile(c.req('customer_account_reconcile', {clientId: 'c-new', operationId: crypto.randomUUID(), confirmed: true}));
  const migration = customerAccountMigrationService(db), q = await migration.preview(c.req('customer_account_migration_preview', {clientId: 'c-simple'}));
  await migration.commit(c.req('customer_account_migration', {clientId: 'c-simple', operationId: crypto.randomUUID(), quoteHash: q.quoteHash, confirmed: true}));
  r = await audits.readiness(c.req('customer_account_readiness'));
  assert.deepEqual(state(), {'c-empty': 'no_history', 'c-gone': 'archived', 'c-new': 'ledger_current', 'c-simple': 'ledger_current'});
  assert.deepEqual([r.readyForPhase5, r.blocking], [true, 0]);
});
