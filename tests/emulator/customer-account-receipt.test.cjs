'use strict';
// Fase 4c no Emulator: o recebimento usa a conta por Espaço já comprovada pelo servidor.
// Confere que a rota pela conta devolve o mesmo exigível da reconstrução completa, grava o
// mesmo efeito, lê poucos documentos qualquer que seja o histórico e volta à rota completa
// sempre que a conta não está comprovada na versão atual do cliente. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {customerAccountBackfillService} = require('../../functions/src/services/customer-account-backfill-service');
const {customerBalanceAdjustmentService} = require('../../functions/src/services/customer-balance-adjustment-service');
const {decideReceiptRoute} = require('../../functions/src/services/fiado-receipt-route');
const {createOriginEvidenceHandler} = require('../../functions/src/fiado-origin-evidence-handler');
const {harness} = require('../helpers/owner-receipt-v219.cjs');

// Etapa 5: an operation the account does not follow in its own transaction (the trigger path).
const LedgerService = require('../../functions/src/services/customer-account-ledger-service');
const untracked = async fn => { const real = LedgerService.prepare; LedgerService.prepare = async () => null; try { return await fn(); } finally { LedgerService.prepare = real; } };
const measures = [];
let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-account-receipt'}, 'account-receipt'); db = getFirestore(app); });
test.after(async () => {
  if (process.env.VECONI_RECEIPT_REPORT) fs.writeFileSync(process.env.VECONI_RECEIPT_REPORT, JSON.stringify({generatedAt: new Date().toISOString(), measures}, null, 2));
  for (const m of measures) console.log(`[leituras] ${m.flow.padEnd(34)} histórico ${String(m.history).padStart(3)} eventos: ${m.billed} leituras (${m.docs} documentos, ${m.queries} consultas)`);
  await db.terminate(); await deleteApp(app);
});

// Counts what the server reads inside its transactions. An empty query is billed as one read.
function metered(base) {
  const stats = {docs: 0, queries: 0, billed: 0};
  let nextQueryError;
  const wrap = tx => new Proxy(tx, {get(target, key) {
    if (key === 'get') return async ref => {
      if (nextQueryError && typeof ref.limit === 'function') {
        const error = nextQueryError; nextQueryError = null; throw error;
      }
      const r = await target.get(ref);
      if (r && Array.isArray(r.docs)) { stats.queries++; stats.docs += r.size; stats.billed += Math.max(1, r.size); } else { stats.docs++; stats.billed++; } return r; };
    if (key === 'getAll') return async (...refs) => { const r = await target.getAll(...refs); stats.docs += r.length; stats.billed += r.length; return r; };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  }});
  const db = new Proxy(base, {get(target, key) {
    if (key === 'runTransaction') return (fn, options) => target.runTransaction(tx => fn(wrap(tx)), options);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  }});
  return {db, failNextQuery(error) {nextQueryError = error;}, take() { const out = {...stats}; stats.docs = 0; stats.queries = 0; stats.billed = 0; return out; }};
}

async function setup() {
  const bid = 'receipt-' + crypto.randomUUID(), owner = 'owner-' + (++seq), root = db.doc('businesses/' + bid), A = 'space-a-' + bid, B = 'space-b-' + bid;
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  await db.doc('users/' + owner).set({uid: owner, businessId: bid, active: true, role: 'owner'});
  await root.collection('members').doc(owner).set({uid: owner, role: 'owner', status: 'active', spaceAccess: 'all', permissionsVersion: 2,
    permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true}});
  for (const id of [A, B]) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true}});
  for (const [clientId, saldo] of [['c-reg', 0], ['c-open', -190]])
    await root.collection('clients').doc(clientId).set({id: clientId, businessId: bid, nome: 'Pessoa QA ' + clientId, saldo, financialVersion: 0, workspaceGeneration: 0, active: true, ativo: true, customerSpaceIds: [A, B]});
  const meter = metered(db), svc = operationalCommitService(meter.db), plain = operationalCommitService(db);
  const shadow = customerAccountService(db, {verify: true}), backfill = customerAccountBackfillService(db), adjustments = customerBalanceAdjustmentService(db);
  const ref = (b, col, id) => db.doc(`businesses/${b}/${col}/${id}`);
  const req = (kind, extra = {}) => ({auth: {uid: owner}, data: {businessId: bid, workspaceGeneration: 0, kind, ...extra}});
  const regularize = async (clientId, total, spaceId) => {
    const q = await plain.receipt(req('fiado_space_regularization_preview', {clientId, spaceId}));
    return plain.commit(req('fiado_space_regularization', {clientId, spaceId, operationId: crypto.randomUUID(), quoteHash: q.quoteHash, financialVersion: q.financialVersion,
      targetDebtCents: total, purpose: 'historical_debt', reason: 'Ajuste conferido em anotação fictícia de QA', confirmed: true, localQueueChecked: true}));
  };
  // Confirmed opening of a legacy balance, through the server's own opening handler.
  const opening = createOriginEvidenceHandler(db, {access: {enabled: true, openingEnabled: true, ownerUid: owner, businessId: bid, workspaceGeneration: 0, adiSpaceId: A, cardSpaceId: B}});
  const openingApi = (action, extra = {}) => opening({auth: {uid: owner}, data: {action, businessId: bid, workspaceGeneration: 0, clientId: 'c-open', ...extra}});
  const balances = [{spaceId: A, totalCents: 15000}, {spaceId: B, totalCents: 4000}];
  const quote = await openingApi('openingPreview', {balances});
  await openingApi('openingConfirm', {requestId: crypto.randomUUID(), confirmed: true, queueChecked: true, reviewHash: quote.reviewHash, balances});
  await regularize('c-reg', 15000, A); await regularize('c-reg', 7000, B);
  const load = async () => {
    let cursor = null; const runId = 'run-' + crypto.randomUUID();
    do { cursor = (await backfill.handle(req('customer_account_backfill_apply', {runId, confirmed: true, backupConfirmed: true, cursor}))).nextCursor; } while (cursor);
  };
  // What the trigger does in production: apply each new event and verify the account.
  const sync = async () => { for (const d of (await root.collection('balanceEvents').get()).docs) await shadow.applyEvent(bid, d.id, d.data()); };
  const route = (clientId, spaceId) => svc.receipt(req('fiado_receipt_route', {clientId, spaceId, scopedReceiptVersion: 1, receiptProofVersion: 2}));
  const fullRoute = (clientId, spaceId) => meter.db.runTransaction(async tx => {
    const c = await plain.authorize(tx, req('fiado_receipt_route'), {businessId: bid, userId: owner, workspaceGeneration: 0}, {readOnly: true});
    return decideReceiptRoute({tx, c, ref, clientId, spaceId, now: new Date(), scopedReceiptVersion: 1, receiptProofVersion: 2});
  }, {readOnly: true});
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const size = async col => (await root.collection(col).get()).size;
  // The real device code builds the receipt; the server commits it.
  const receive = async (clientId, spaceId, reais, r, local) => {
    const h = harness({businessId: bid, spaceId, uid: owner});
    try {
      Object.assign(h.rows(), {clientes: [local || await read('clients', clientId)], vendas: [], pagamentos: [], alocacoesPagamento: []});
      h.w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
      const payment = h.w.Fiados.receber(clientId, reais, 'Pix fictício de QA', {spaceId, paymentMethod: 'pix', receiptRoute: r, fiadoAccount: r.scopedAccount});
      const request = {auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: payment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
        payload: {eventKind: 'payment', fiadoHistoryVersion: 1, fiadoReceiptRoute: {version: 1, mode: r.mode, spaceId, quoteHash: r.quoteHash, receiptProofVersion: r.receiptProofVersion, scopedReceiptVersion: 1}, writes: h.writes()}}}};
      return {payment, result: await svc.commit(request)};
    } finally { h.close(); }
  };
  return {bid, owner, A, B, root, meter, load, sync, regularize, route, fullRoute, read, size, receive, adjustments, req};
}
const same = (fast, full) => {
  for (const key of ['mode', 'quoteHash', 'receiptProofVersion', 'dueCents', 'futureCents', 'totalCents', 'financialVersion', 'asOf', 'scopedReceiptVersion']) assert.deepEqual(fast[key], full[key], key);
};

test('rota pela conta: mesmo exigível da reconstrução, por Espaço, na abertura e na regularização', async () => {
  const c = await setup(); await c.load();
  for (const [clientId, spaceId, due] of [['c-reg', c.A, 15000], ['c-reg', c.B, 7000], ['c-open', c.A, 15000], ['c-open', c.B, 4000]]) {
    const fast = await c.route(clientId, spaceId), full = await c.fullRoute(clientId, spaceId);
    assert.equal(fast.source, 'customer_account', `${clientId} ${spaceId}`); assert.equal(full.source, undefined);
    same(fast, full); assert.equal(fast.dueCents, due);
    assert.deepEqual(fast.scopedAccount.entries.map(e => [e.spaceId, e.remainingCents, e.saleId]), [[spaceId, due, null]]);
  }
});

test('sondagem da conta sem índice cai no histórico completo com o mesmo exigível', async () => {
  const c = await setup();
  await c.load();
  const fast = await c.route('c-reg', c.A);
  assert.equal(fast.source,'customer_account');
  const indexUnavailable = () => c.meter.failNextQuery(Object.assign(Error('Índice de QA indisponível'),{code:9}));
  indexUnavailable();
  const expected = await c.route('c-reg', c.A);
  assert.equal(expected.source,undefined);
  assert.deepEqual(expected,await c.fullRoute('c-reg', c.A));
  assert.equal(expected.quoteHash,fast.quoteHash);
  assert.equal(expected.dueCents,15000);
  assert.equal(await c.size('payments'),0);
  indexUnavailable();
  const receipt = await c.receive('c-reg', c.A, 10, fast);
  assert.notEqual(receipt.result.replayed,true);
  assert.equal(await c.size('payments'),1);
});

test('leituras da rota pela conta não crescem com o histórico', async () => {
  const c = await setup(); await c.load();
  let events = 2;
  const totals = [16000, 15000];
  for (const target of [2, 12, 32]) {
    while (events < target) { await c.regularize('c-reg', totals[events % 2], c.A); events++; }
    await c.sync();
    c.meter.take(); const fast = await c.route('c-reg', c.A); const m = c.meter.take();
    assert.equal(fast.source, 'customer_account');
    measures.push({flow: 'rota pela conta', history: events, ...m});
    c.meter.take(); await c.fullRoute('c-reg', c.A); measures.push({flow: 'rota completa (antes da 4c)', history: events, ...c.meter.take()});
  }
  const r = await c.route('c-reg', c.A); c.meter.take(); await c.receive('c-reg', c.A, 10, r);
  measures.push({flow: 'confirmação do recebimento pela conta', history: events, ...c.meter.take()});
  const billed = measures.filter(m => m.flow === 'rota pela conta').map(m => m.billed);
  assert.equal(new Set(billed.slice(-3)).size, 1, 'mesmo número de leituras com 2, 12 e 32 eventos');
  assert.ok(billed.at(-1) <= 14, 'no máximo 14 leituras: ' + billed.at(-1));
  const commit = measures.filter(m => m.flow === 'confirmação do recebimento pela conta').at(-1).billed;
  assert.ok(commit <= 30, 'confirmação com 32 eventos em até 30 leituras: ' + commit);
});

test('recebimento pela conta: mesmo efeito, sem alocação, e a conta segue comprovada', async () => {
  const c = await setup(); await c.load();
  const r = await c.route('c-reg', c.A); assert.equal(r.source, 'customer_account');
  c.meter.take();
  const {payment, result} = await c.receive('c-reg', c.A, 50, r);
  const m = c.meter.take(); measures.push({flow: 'confirmação do recebimento pela conta', history: 2, ...m});
  assert.notEqual(result.replayed, true);
  const client = await c.read('clients', 'c-reg'), stored = await c.read('payments', payment.id);
  assert.equal(client.saldo, -170);
  assert.equal(stored.legacyAmount, 50); assert.equal(stored.allocatedAmount, 0); assert.equal(await c.size('paymentAllocations'), 0);
  const event = (await c.root.collection('balanceEvents').where('type', '==', 'payment_received').get()).docs[0].data();
  assert.equal(event.spaceId, c.A); assert.equal(event.balanceDelta, 50);
  // Etapa 5: the account follows the receipt in the same transaction; no wait for the trigger.
  const before = await c.route('c-reg', c.A);
  assert.equal(before.source, 'customer_account'); assert.equal(before.dueCents, 10000);
  await c.sync();
  const account = await c.read('customerAccounts', 'c-reg');
  assert.deepEqual([account.spaces[c.A], account.spaces[c.B], account.clientFinancialVersion], [10000, 7000, client.financialVersion]);
  const fast = await c.route('c-reg', c.A); assert.equal(fast.source, 'customer_account'); same(fast, await c.fullRoute('c-reg', c.A));
  const second = await c.receive('c-reg', c.A, 100, fast);
  assert.notEqual(second.result.replayed, true);
  assert.equal((await c.read('clients', 'c-reg')).saldo, -70, 'recebe o restante do Espaço A; o B continua');
});

test('a rota completa decide quando a conta não está comprovada na versão atual', async () => {
  const c = await setup(); await c.load();
  await untracked(() => c.regularize('c-reg', 9000, c.A));
  let r = await c.route('c-reg', c.A); assert.equal(r.source, undefined, 'evento não acompanhado e ainda não verificado'); assert.equal(r.dueCents, 9000);
  await c.sync();
  assert.equal((await c.route('c-reg', c.A)).source, 'customer_account');
  const pending = c.root.collection('payments').doc('qa-pending');
  await pending.set({id: 'qa-pending', businessId: c.bid, workspaceGeneration: 0, clienteId: 'c-reg', clientId: 'c-reg', spaceId: c.A, financialSpaceId: c.A, valor: 10, status: 'conflict', applicationStatus: 'conflict'});
  r = await c.route('c-reg', c.A); assert.equal(r.source, undefined); assert.deepEqual([r.mode, r.reason], ['blocked', 'pending_payment']);
  await pending.delete();
  await c.root.collection('clients').doc('c-reg').update({hasInstallmentFiado: true});
  assert.notEqual((await c.route('c-reg', c.A)).source, 'customer_account', 'conta com parcelas');
  await c.root.collection('clients').doc('c-reg').update({hasInstallmentFiado: false});
  await c.root.collection('customerAccounts').doc('c-reg').update({'verification.financialVersion': 0, clientFinancialVersion: 0});
  assert.equal((await c.route('c-reg', c.A)).source, undefined, 'conta e verificação de outra versão');
  const fv = (await c.read('clients', 'c-reg')).financialVersion;
  await c.root.collection('customerAccounts').doc('c-reg').update({'verification.financialVersion': fv, clientFinancialVersion: fv, 'verification.receiptRisk': 'history_review'});
  assert.equal((await c.route('c-reg', c.A)).source, undefined, 'conferência do recebimento pendente');
});

test('prévia por uma fonte e confirmação pela outra: aceita sem mudança financeira, recusa com mudança', async () => {
  const c = await setup(); await c.load();
  await untracked(() => c.regularize('c-reg', 12000, c.A));
  const old = await c.route('c-reg', c.A); assert.equal(old.source, undefined);
  await c.sync(); // the account is proven while the user is still on the receipt screen
  assert.notEqual((await c.receive('c-reg', c.A, 20, old)).result.replayed, true);
  await c.sync();
  const fast = await c.route('c-reg', c.A), local = await c.read('clients', 'c-reg'); assert.equal(fast.source, 'customer_account');
  await c.regularize('c-reg', 8000, c.B); // another device changes the balance in Space B
  await assert.rejects(c.receive('c-reg', c.A, 20, fast, local), e => e.code === 'failed-precondition');
  assert.equal((await c.read('clients', 'c-reg')).saldo, -(10000 + 8000) / 100);
});

test('ajuste pelo comando deixa a conta comprovada para o próximo recebimento', async () => {
  const c = await setup(); await c.load();
  const req = (kind, data) => c.req(kind, data);
  const data = {clientId: 'c-reg', spaceId: c.A, mode: 'increase', amountCents: 3000};
  const q = await c.adjustments.preview(req('customer_balance_adjustment_preview', data));
  await c.adjustments.commit(req('customer_balance_adjustment', {...data, operationId: crypto.randomUUID(), quoteHash: q.quoteHash, expectedFinancialVersion: q.financialVersion, confirmed: true, reason: 'Ajuste fictício conferido em QA'}));
  const fast = await c.route('c-reg', c.A);
  assert.equal(fast.source, 'customer_account'); assert.equal(fast.dueCents, 18000); same(fast, await c.fullRoute('c-reg', c.A));
});
