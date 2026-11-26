'use strict';
// Etapa 5 no Emulator: a conta por Espaço acompanha cada operação na mesma transação, sem o
// gatilho e sem reconstruir o histórico. Depois de cada operação, a rota pela conta é igual à
// reconstrução completa (mesmos itens, Espaços e saldo), numa sequência fixa e numa aleatória.
// O gatilho reconhece os eventos já aplicados e não reconstrói. Quando a conta não acompanha,
// a rota completa decide e a conferência a refaz. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {customerBalanceAdjustmentService} = require('../../functions/src/services/customer-balance-adjustment-service');
const {saleCancellationService} = require('../../functions/src/services/sale-cancellation-service');
const {decideReceiptRoute} = require('../../functions/src/services/fiado-receipt-route');
const LedgerService = require('../../functions/src/services/customer-account-ledger-service');
const Plan = require('../../functions/src/shared/installment-plan');
const sales = require('../helpers/fiado-cancellation-harness.cjs'), receipts = require('../helpers/owner-receipt-v219.cjs');

let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-transactional'}, 'transactional'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v));

async function setup() {
  const bid = 'tx-' + crypto.randomUUID(), owner = 'owner-' + (++seq), root = db.doc('businesses/' + bid), A = 'space-a-' + bid, B = 'space-b-' + bid;
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  await db.doc('users/' + owner).set({uid: owner, businessId: bid, active: true, role: 'owner'});
  await root.collection('members').doc(owner).set({uid: owner, role: 'owner', status: 'active', spaceAccess: 'all', permissionsVersion: 2,
    permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true, 'sales.cancel': true}});
  for (const id of [A, B]) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true, inventory: true}});
  await root.collection('clients').doc('c-new').set({id: 'c-new', businessId: bid, nome: 'Pessoa QA', saldo: 0, financialVersion: 0, workspaceGeneration: 0, active: true, ativo: true, spaceId: A, customerSpaceIds: [A, B]});
  const who = {id: 'c-new'};
  const svc = operationalCommitService(db), shadow = customerAccountService(db, {verify: true}), adjust = customerBalanceAdjustmentService(db);
  const cancel = saleCancellationService(db, {allowNewCancellations: true});
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
  const load = async space => {
    const h = shops[space];
    h.data().clientes = [await read('clients', who.id)];
    h.data().vendas = (await docs('sales', 'clienteId', who.id)).map(plain).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    h.data().alocacoesPagamento = (await docs('paymentAllocations', 'clientId', who.id)).map(plain);
    h.data().produtos = [{...(await read('products', 'qa-product-' + space)), id: 'qa-product-' + space}];
    return h;
  };
  const commitPacket = packet => svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {...packet, workspaceGeneration: 0, payload: {...packet.payload, fiadoHistoryVersion: 1}}}});
  const sell = async (space, reais, installments) => {
    const h = await load(space), before = sales.bridge(h.data());
    const extra = installments ? {installmentTerms: {downPayment: 0, count: installments, firstDueDate: Plan.month(Plan.today(), 1)},
      installmentAccount: (await svc.receipt(req('fiado_account', {clientId: who.id, fiadoHistoryVersion: 1}))).account} : {};
    const sale = h.c.Vendas.registrar({id: crypto.randomUUID(), operationId: crypto.randomUUID(), businessId: bid, spaceId: space, clienteId: who.id, status: 'fiado', formaPagamento: 'fiado',
      itens: [{produtoId: 'qa-product-' + space, quantidade: 1, precoOriginal: reais, precoFinalUnitario: reais}], ...extra});
    await commitPacket({operationId: sale.operationId, businessId: bid, userId: owner, payloadVersion: 4, payload: {eventKind: 'sale', writes: sales.bridge(h.c.diffWrites(before, h.data()))}});
    return sale;
  };
  const undoLast = async space => { const h = await load(space), u = h.undo(h.data().vendas.at(-1).id); await commitPacket(u.packet); return u.removed; };
  const route = (spaceId) => svc.receipt(req('fiado_receipt_route', {clientId: who.id, spaceId, scopedReceiptVersion: 1}));
  const fullRoute = spaceId => db.runTransaction(async tx => {
    const c = await svc.authorize(tx, req('fiado_receipt_route'), {businessId: bid, userId: owner, workspaceGeneration: 0}, {readOnly: true});
    return decideReceiptRoute({tx, c, ref, clientId: who.id, spaceId, now: new Date(), scopedReceiptVersion: 1});
  }, {readOnly: true});
  const receive = async (space, reais, advance = false) => {
    const r = await route(space), h = receipts.harness({businessId: bid, spaceId: space, uid: owner});
    try {
      Object.assign(h.rows(), {clientes: [await read('clients', who.id)], vendas: (await docs('sales', 'clienteId', who.id)).map(plain), pagamentos: [],
        alocacoesPagamento: (await docs('paymentAllocations', 'clientId', who.id)).map(plain)});
      h.w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
      const payment = h.w.Fiados.receber(who.id, reais, 'Pix fictício de QA', {spaceId: space, paymentMethod: 'pix', receiptRoute: r, allowAdvance: advance, fiadoAccount: r.scopedAccount});
      await svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: payment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
        payload: {eventKind: 'payment', fiadoHistoryVersion: 1, fiadoReceiptRoute: {version: 1, mode: r.mode, spaceId: space, quoteHash: r.quoteHash, scopedReceiptVersion: 1}, writes: h.writes()}}}});
      return {route: r, payment};
    } finally { h.close(); }
  };
  const adjustCommand = async (space, mode, amountCents) => {
    const data = {clientId: who.id, spaceId: space, mode, amountCents};
    const q = await adjust.preview(req('customer_balance_adjustment_preview', data));
    return adjust.commit(req('customer_balance_adjustment', {...data, operationId: crypto.randomUUID(), quoteHash: q.quoteHash, expectedFinancialVersion: q.financialVersion, confirmed: true, reason: 'Ajuste fictício conferido em QA'}));
  };
  const cancelSale = async sale => {
    const data = {businessId: bid, workspaceGeneration: 0, spaceId: sale.spaceId, saleId: sale.id};
    const p = await cancel.preview({auth: {uid: owner}, data});
    return cancel.confirm({auth: {uid: owner}, data: {...data, operationId: p.operationId, fingerprint: p.fingerprint, reason: 'Cancelamento fictício de QA', confirmed: true, refundHandling: 'not_applicable'}});
  };
  const triggerAll = async () => { const out = {}; for (const d of (await root.collection('balanceEvents').get()).docs) { const r = await shadow.applyEvent(bid, d.id, d.data()); out[r.status] = (out[r.status] || 0) + 1; } return out; };
  const use = id => { who.id = id; };
  return {bid, owner, A, B, root, svc, read, docs, req, sell, undoLast, route, fullRoute, receive, adjustCommand, cancelSale, triggerAll, use, who};
}
const rows = r => r.scopedAccount.entries.map(e => [e.spaceId, e.saleId, e.number, e.historyEventId || null, e.dueDate, e.remainingCents]);
// The account kept by the transactions alone equals the full reconstruction, Space by Space.
async function parity(c, step) {
  const client = await c.read('clients', c.who.id), account = await c.read('customerAccounts', c.who.id);
  assert.equal(account?.clientFinancialVersion, client.financialVersion, step + ': conta em dia com o cliente');
  assert.equal(account.debtCents, -Math.round(client.saldo * 100), step + ': total igual ao saldo');
  for (const space of [c.A, c.B]) {
    const debt = account.spaces[space] || 0;
    if (!debt) continue;
    const fast = await c.route(space), full = await c.fullRoute(space);
    assert.equal(fast.source, 'customer_account', step + ': rota pela conta');
    for (const key of ['dueCents', 'futureCents', 'totalCents', 'financialVersion']) assert.equal(fast[key], full[key], step + ': ' + key);
    assert.deepEqual(rows(fast), rows(full), step + ': mesmos itens em aberto');
  }
}

test('sequência fixa: vendas, parcelas, recebimentos, desfazer, cancelar e ajustar seguem a conta na mesma transação', async () => {
  const c = await setup();
  const s1 = await c.sell(c.A, 30); await parity(c, 'primeira venda (conta criada na ativação)');
  const plan = await c.sell(c.A, 300, 3); await parity(c, 'venda parcelada');
  await c.sell(c.B, 45); await parity(c, 'venda em outro Espaço');
  await c.receive(c.A, 20); await parity(c, 'recebimento parcial');
  await c.receive(c.A, 130, true); await parity(c, 'antecipação');
  const s4 = await c.sell(c.A, 12); await parity(c, 'venda nova');
  await c.undoLast(c.A); await parity(c, 'desfazer a última venda');
  await c.adjustCommand(c.B, 'increase', 1500); await parity(c, 'ajuste pelo comando');
  await assert.rejects(c.adjustCommand(c.A, 'decrease', 500), /parcelas/, 'o ajuste não consome parcelas, como antes');
  await c.adjustCommand(c.B, 'decrease', 500); await parity(c, 'redução pelo comando');
  const s5 = await c.sell(c.A, 25); await parity(c, 'mais uma venda');
  await c.cancelSale(s5); await parity(c, 'cancelamento pela Function');
  assert.equal((await c.read('sales', s1.id)).creditSettled, true);
  assert.ok(plan && s4);
  const trigger = await c.triggerAll();
  assert.deepEqual(trigger, {duplicate: Object.values(trigger).reduce((n, v) => n + v, 0)}, 'o gatilho não reconstrói nenhum evento: ' + JSON.stringify(trigger));
});

test('sequência aleatória de 30 operações mantém a paridade depois de cada uma', async () => {
  const c = await setup();
  let seed = 20261126;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = list => list[Math.floor(rnd() * list.length)];
  await c.sell(c.A, 50);
  const done = {};
  for (let i = 0; i < 30; i++) {
    const space = pick([c.A, c.B]), op = pick(['sell', 'sell', 'installments', 'receive', 'receive', 'advance', 'undo', 'increase', 'decrease']);
    try {
      if (op === 'sell') await c.sell(space, 5 + Math.floor(rnd() * 60));
      if (op === 'installments') await c.sell(space, 30 * (2 + Math.floor(rnd() * 4)), 3);
      if (op === 'receive' || op === 'advance') {
        const r = await c.route(space), max = (op === 'advance' ? r.totalCents : r.dueCents) || 0;
        if (max <= 0) continue;
        await c.receive(space, Math.max(1, Math.floor(rnd() * max)) / 100, op === 'advance');
      }
      if (op === 'undo') await c.undoLast(space);
      if (op === 'increase' || op === 'decrease') await c.adjustCommand(space, op, 100 + Math.floor(rnd() * 900));
    } catch (error) { done['recusada:' + op] = (done['recusada:' + op] || 0) + 1; continue; } // refused by the device or the server, as today
    done[op] = (done[op] || 0) + 1;
    await parity(c, `operação ${i + 1} (${op})`);
  }
  assert.ok(Object.keys(done).filter(k => !k.startsWith('recusada')).length >= 5, JSON.stringify(done));
});

test('quando a conta não acompanha uma operação, a rota completa decide e a conferência a refaz', async () => {
  const c = await setup();
  await c.sell(c.A, 30);
  const original = LedgerService.prepare;
  LedgerService.prepare = async () => null; // an operation the account could not follow
  try { await c.sell(c.A, 20); } finally { LedgerService.prepare = original; }
  const stale = await c.route(c.A);
  assert.equal(stale.source, undefined, 'conta atrasada: rota completa'); assert.equal(stale.dueCents, 5000);
  await c.triggerAll(); // the trigger applies the missed event and the verification rebuilds the open items
  await parity(c, 'depois da conferência');
  await c.sell(c.A, 10); await parity(c, 'volta a acompanhar na transação');
});

test('conta vinda da migração e da abertura também segue cada operação na transação', async () => {
  const c = await setup();
  const migration = require('../../functions/src/services/customer-account-migration-service').customerAccountMigrationService(db);
  const opening = require('../../functions/src/services/customer-account-opening-service').customerAccountOpeningService(db);
  const client = (id, extra) => c.root.collection('clients').doc(id).set({id, businessId: c.bid, nome: 'Pessoa QA ' + id, saldo: 0, financialVersion: 1, workspaceGeneration: 0,
    active: true, ativo: true, spaceId: c.A, customerSpaceIds: [c.A, c.B], ...extra});
  await client('c-simple'); c.use('c-simple');
  await c.sell(c.A, 40); await c.sell(c.B, 20);
  const q = await migration.preview(c.req('customer_account_migration_preview', {clientId: 'c-simple'}));
  await migration.commit(c.req('customer_account_migration', {clientId: 'c-simple', operationId: crypto.randomUUID(), quoteHash: q.quoteHash, confirmed: true}));
  await parity(c, 'migrado');
  await c.sell(c.A, 15); await parity(c, 'migrado: venda');
  await c.undoLast(c.A); await parity(c, 'migrado: desfazer a venda logo depois');
  await c.receive(c.A, 30); await parity(c, 'migrado: recebimento parcial');
  await client('c-legacy', {saldo: -100}); c.use('c-legacy');
  const balances = [{spaceId: c.A, totalCents: 7000}, {spaceId: c.B, totalCents: 3000}];
  const p = await opening.preview(c.req('customer_account_opening_preview', {clientId: 'c-legacy', balances}));
  await opening.commit(c.req('customer_account_opening', {clientId: 'c-legacy', balances, operationId: crypto.randomUUID(), reviewHash: p.reviewHash, confirmed: true, queueChecked: true}));
  await parity(c, 'aberto');
  await c.sell(c.B, 10); await parity(c, 'aberto: venda');
  await c.receive(c.A, 70); await parity(c, 'aberto: Espaço A quitado');
  const trigger = await c.triggerAll();
  assert.ok(!trigger.applied && !trigger.baseline, 'nenhum evento reconstruído pelo gatilho: ' + JSON.stringify(trigger));
});
