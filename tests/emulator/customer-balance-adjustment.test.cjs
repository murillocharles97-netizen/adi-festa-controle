'use strict';
// Fase 3 — comando único de ajuste de saldo no Emulator, com dados fictícios.
// Contas preparadas pela carga da Fase 2; cada operação obrigatória pelo comando novo,
// com a prova do histórico ainda válida para quem depende dela e a conta sombra coerente.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs'), vm = require('node:vm');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {customerAccountBackfillService} = require('../../functions/src/services/customer-account-backfill-service');
const {customerBalanceAdjustmentService} = require('../../functions/src/services/customer-balance-adjustment-service');
const {readHistoryInput} = require('../../functions/src/services/fiado-history-service');
const History = require('../../functions/src/shared/fiado-history-account');
const {harness, bridge} = require('../helpers/fiado-cancellation-harness.cjs');

let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-balance-adjustment'}, 'balance-adjustment'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });

function metered(base) {
  const stats = {docs: 0};
  const wrap = tx => new Proxy(tx, {get(target, key) {
    if (key === 'get') return async ref => { const r = await target.get(ref); stats.docs += Array.isArray(r?.docs) ? r.size : 1; return r; };
    if (key === 'getAll') return async (...refs) => { const r = await target.getAll(...refs); stats.docs += r.length; return r; };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  }});
  return {db: new Proxy(base, {get(target, key) {
    if (key === 'runTransaction') return (fn, options) => target.runTransaction(tx => fn(wrap(tx)), options);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  }}), take() { const n = stats.docs; stats.docs = 0; return n; }};
}

async function setup() {
  const bid = 'adjust-' + crypto.randomUUID(), n = ++seq, root = db.doc('businesses/' + bid);
  const owner = 'owner-' + n, manager = 'manager-' + n, cashierA = 'cashier-a-' + n, seller = 'seller-' + n;
  const A = 'space-a-' + bid, B = 'space-b-' + bid;
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  const base = {'customers.view': true, 'customers.receiveDebt': true, 'sales.create': true};
  for (const [uid, role, extra, access] of [[owner, 'owner', {'customers.adjustBalance': true}, {spaceAccess: 'all'}], [manager, 'manager', {'customers.adjustBalance': true}, {spaceAccess: 'all'}],
    [cashierA, 'cashier', {'customers.adjustBalance': true}, {spaceAccess: 'selected', allowedSpaceIds: [A]}], [seller, 'seller', {}, {spaceAccess: 'all'}]]) {
    await db.doc('users/' + uid).set({uid, businessId: bid, active: true, role});
    await root.collection('members').doc(uid).set({uid, role, status: 'active', permissionsVersion: 2, permissions: {...base, ...extra}, ...access});
  }
  for (const id of [A, B]) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true}});
  for (const [clientId, spaces] of [['c-zero', [A, B]], ['c-simple', [A]], ['c-reg', [A, B]]])
    await root.collection('clients').doc(clientId).set({id: clientId, businessId: bid, nome: 'Pessoa QA ' + clientId, saldo: 0, financialVersion: 0, workspaceGeneration: 0, active: true, ativo: true, customerSpaceIds: spaces});
  const svc = operationalCommitService(db), meter = metered(db), adjustments = customerBalanceAdjustmentService(meter.db), shadow = customerAccountService(db);
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const size = async col => (await root.collection(col).get()).size;
  const regularize = async (clientId, total, spaceId) => {
    const r = (kind, extra = {}) => ({auth: {uid: owner}, data: {businessId: bid, workspaceGeneration: 0, spaceId, clientId, kind, ...extra}});
    const q = await svc.receipt(r('fiado_space_regularization_preview'));
    return svc.commit(r('fiado_space_regularization', {operationId: crypto.randomUUID(), quoteHash: q.quoteHash, financialVersion: q.financialVersion, targetDebtCents: total,
      purpose: 'historical_debt', reason: 'Ajuste conferido em anotação fictícia de QA', confirmed: true, localQueueChecked: true}));
  };
  const legacyAdjust = async (clientId, newBalance) => {
    const h = harness({businessId: bid, spaceId: A, uid: owner});
    h.data().clientes = [await read('clients', clientId)]; h.c.PhoneUtils = {normalizeBrazilianPhone: v => v}; h.c.addEventListener = () => {};
    vm.runInContext(fs.readFileSync('js/clientes.js', 'utf8'), h.c);
    const before = bridge(h.data()), adjustment = h.c.Clientes.ajustarSaldo(clientId, newBalance, 'Ajuste antigo fictício de QA');
    return svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: adjustment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
      payload: {eventKind: 'balance_adjustment', fiadoHistoryVersion: 1, writes: [...bridge(h.c.diffWrites(before, h.data())), {entityType: 'balanceAdjustments', entityId: adjustment.id, operation: 'create', data: bridge(adjustment)}]}}}});
  };
  await legacyAdjust('c-simple', -80);
  await regularize('c-reg', 15000, A); await regularize('c-reg', 7000, B);
  const load = customerAccountBackfillService(db);
  let cursor = null;
  do { const r = await load.handle({auth: {uid: owner}, data: {businessId: bid, workspaceGeneration: 0, kind: 'customer_account_backfill_apply', runId: 'run-' + bid, confirmed: true, backupConfirmed: true, rules: ['single_linked_space'], cursor}}); cursor = r.nextCursor; } while (cursor);
  const req = (kind, data, uid = owner) => ({auth: {uid}, data: {businessId: bid, workspaceGeneration: 0, kind, ...data}});
  const preview = (data, uid) => adjustments.preview(req('customer_balance_adjustment_preview', data, uid));
  const adjust = async (data, uid = owner) => {
    const q = await preview(data, uid);
    const request = req('customer_balance_adjustment', {...data, operationId: crypto.randomUUID(), quoteHash: q.quoteHash, expectedFinancialVersion: q.financialVersion, confirmed: true,
      reason: data.reason || 'Ajuste fictício conferido em QA'}, uid);
    return {result: await adjustments.commit(request), request, quote: q};
  };
  const account = id => read('customerAccounts', id);
  const proof = clientId => db.runTransaction(async tx => {
    const client = await read('clients', clientId), scoped = Boolean(client.fiadoOpeningBalance || client.fiadoHistoryActivation?.spaceRegularization?.version === 1);
    return History.project(await readHistoryInput({tx, c: {bid, business: {workspaceGeneration: 0}, owner: true, has: () => true, space: async () => ({})},
      ref: (b, col, id) => db.doc(`businesses/${b}/${col}/${id}`), clientId, client, checkRowAccess: false}), require('../../functions/src/shared/installment-plan').today(), {scoped});
  });
  const spaceOf = (p, s) => p.entries.filter(e => e.spaceId === s).reduce((t, e) => t + e.remainingCents, 0);
  const noSideEffects = async () => {
    for (const col of ['sales', 'payments', 'stockMovements', 'paymentAllocations']) assert.equal(await size(col), 0, col);
    for (const id of [A, B]) assert.equal((await db.collection(`financialSpaces/${id}/entries`).get()).size, 0, 'caixa');
  };
  return {bid, owner, manager, cashierA, seller, A, B, root, svc, adjustments, shadow, meter, read, size, req, preview, adjust, account, proof, spaceOf, noSideEffects};
}

test('aumentar, reduzir e zerar por Espaço, sem venda nem recebimento, com a prova ainda válida', async () => {
  const c = await setup();
  let r = (await c.adjust({clientId: 'c-zero', spaceId: c.A, mode: 'increase', amountCents: 15000})).result;
  assert.equal(r.newDebtCents, 15000); assert.equal((await c.read('clients', 'c-zero')).saldo, -150);
  assert.deepEqual((await c.account('c-zero')).spaces, {[c.A]: 15000});
  r = (await c.adjust({clientId: 'c-reg', spaceId: c.A, mode: 'decrease', amountCents: 5000})).result;
  assert.equal(r.newDebtCents, 10000);
  let p = await c.proof('c-reg'); assert.equal(c.spaceOf(p, c.A), 10000); assert.equal(c.spaceOf(p, c.B), 7000);
  await c.adjust({clientId: 'c-reg', spaceId: c.A, mode: 'set', targetDebtCents: 0});
  p = await c.proof('c-reg'); assert.equal(c.spaceOf(p, c.A), 0); assert.equal(c.spaceOf(p, c.B), 7000, 'o outro Espaço não muda');
  assert.deepEqual((await c.account('c-reg')).spaces, {[c.B]: 7000});
  const client = await c.read('clients', 'c-reg');
  assert.equal(client.saldo, -70); assert.equal(client.fiadoHistoryActivation.spaceRegularization.version, 1, 'regime anterior preservado, sem nova troca');
  await c.noSideEffects();
});

test('crédito: liberado para conta simples, recusado onde a prova ainda decide', async () => {
  const c = await setup();
  const r = (await c.adjust({clientId: 'c-zero', spaceId: c.A, mode: 'credit', amountCents: 3000})).result;
  assert.equal(r.newDebtCents, -3000); assert.equal((await c.read('clients', 'c-zero')).saldo, 30);
  assert.equal((await c.account('c-zero')).debtCents, -3000);
  await assert.rejects(c.preview({clientId: 'c-reg', spaceId: c.A, mode: 'credit', amountCents: 20000}), /Crédito para contas com histórico comprovado/);
  await assert.rejects(c.preview({clientId: 'c-zero', spaceId: c.B, mode: 'decrease', amountCents: 100}), /Use "Conceder crédito"/);
});

test('estorno de um ajuste errado, uma única vez, com o histórico listando o que pode ser estornado', async () => {
  const c = await setup();
  const wrong = (await c.adjust({clientId: 'c-reg', spaceId: c.A, mode: 'increase', amountCents: 2000, reason: 'Lançamento fictício errado de QA'})).result;
  let list = await c.adjustments.history(c.req('customer_balance_adjustment_history', {clientId: 'c-reg', spaceId: c.A}));
  assert.ok(list.items.find(i => i.operationId === wrong.operationId)?.reversible);
  const fix = (await c.adjust({clientId: 'c-reg', spaceId: c.A, mode: 'reverse', reversesOperationId: wrong.operationId})).result;
  assert.equal(fix.newDebtCents, 15000);
  const stored = await c.read('balanceAdjustments', fix.operationId);
  assert.equal(stored.reversesOperationId, wrong.operationId); assert.equal(stored.adjustmentMode, 'reverse');
  await assert.rejects(c.preview({clientId: 'c-reg', spaceId: c.A, mode: 'reverse', reversesOperationId: wrong.operationId}), /já foi estornado/);
  await assert.rejects(c.preview({clientId: 'c-reg', spaceId: c.B, mode: 'reverse', reversesOperationId: wrong.operationId}), /Espaço do ajuste original/);
  list = await c.adjustments.history(c.req('customer_balance_adjustment_history', {clientId: 'c-reg', spaceId: c.A}));
  assert.equal(list.items.find(i => i.operationId === wrong.operationId).reversible, false);
  assert.equal(c.spaceOf(await c.proof('c-reg'), c.A), 15000);
});

test('ajustes consecutivos: prévia antiga recusada, reenvio idempotente e identificador não reaproveitável', async () => {
  const c = await setup();
  const stale = await c.preview({clientId: 'c-simple', spaceId: c.A, mode: 'increase', amountCents: 1000});
  const first = await c.adjust({clientId: 'c-simple', spaceId: c.A, mode: 'increase', amountCents: 1000});
  await c.adjust({clientId: 'c-simple', spaceId: c.A, mode: 'decrease', amountCents: 500});
  await assert.rejects(c.adjustments.commit(c.req('customer_balance_adjustment', {clientId: 'c-simple', spaceId: c.A, mode: 'increase', amountCents: 1000, operationId: crypto.randomUUID(),
    quoteHash: stale.quoteHash, expectedFinancialVersion: stale.financialVersion, confirmed: true, reason: 'Prévia antiga fictícia de QA'})), e => e.code === 'aborted');
  assert.equal((await c.adjustments.commit(first.request)).replayed, true);
  await assert.rejects(c.adjustments.commit({...first.request, data: {...first.request.data, amountCents: 9999}}), e => e.code === 'already-exists');
  const client = await c.read('clients', 'c-simple');
  assert.equal(client.saldo, -85); assert.equal((await c.account('c-simple')).spaces[c.A], 8500);
});

test('recebimento depois do ajuste usa o exigível novo; histórico e sincronização registram tudo', async () => {
  const c = await setup();
  const {result} = await c.adjust({clientId: 'c-reg', spaceId: c.A, mode: 'increase', amountCents: 3000});
  const route = await c.svc.receipt(c.req('fiado_receipt_route', {clientId: 'c-reg', spaceId: c.A, scopedReceiptVersion: 1}));
  assert.equal(route.mode, 'space'); assert.equal(route.dueCents, 18000);
  const adjustment = await c.read('balanceAdjustments', result.operationId);
  for (const key of ['motivo', 'actorUid', 'actorNameSnapshot', 'saldoAnterior', 'saldoNovo', 'previousSpaceDebtCents', 'newSpaceDebtCents', 'deltaDebtCents', 'adjustmentMode', 'spaceId'])
    assert.ok(adjustment[key] !== undefined, key);
  const signal = await c.read('syncMetadata', 'last-sync');
  for (const name of ['clients', 'balanceAdjustments', 'balanceEvents']) assert.equal(signal.collectionVersions[name], 'server:' + result.operationId);
});

test('perfis: quem tem a permissão ajusta nos Espaços que acessa; os demais são recusados', async () => {
  const c = await setup();
  assert.equal((await c.adjust({clientId: 'c-zero', spaceId: c.A, mode: 'increase', amountCents: 1000}, c.manager)).result.status, 'confirmed');
  assert.equal((await c.adjust({clientId: 'c-zero', spaceId: c.A, mode: 'increase', amountCents: 1000}, c.cashierA)).result.status, 'confirmed');
  await assert.rejects(c.preview({clientId: 'c-zero', spaceId: c.B, mode: 'increase', amountCents: 1000}, c.cashierA), /Espaço não autorizado/);
  await assert.rejects(c.preview({clientId: 'c-zero', spaceId: c.A, mode: 'increase', amountCents: 1000}, c.seller), e => e.code === 'permission-denied');
  await assert.rejects(c.preview({clientId: 'c-simple', spaceId: c.B, mode: 'increase', amountCents: 1000}), /Vincule o cliente/);
  const adjustment = (await c.root.collection('balanceAdjustments').where('clienteId', '==', 'c-zero').get()).docs.map(d => d.data()).find(a => a.actorUid === c.cashierA);
  assert.equal(adjustment.actorRoleSnapshot, 'cashier');
});

test('conta não preparada ou divergente do saldo cadastral bloqueia sem gravar', async () => {
  const c = await setup();
  await c.root.collection('customerAccounts').doc('c-simple').delete();
  await assert.rejects(c.preview({clientId: 'c-simple', spaceId: c.A, mode: 'increase', amountCents: 100}), /ainda não foi preparada/);
  await c.root.collection('clients').doc('c-zero').update({saldo: -1});
  await assert.rejects(c.preview({clientId: 'c-zero', spaceId: c.A, mode: 'increase', amountCents: 100}), /não confere com o saldo cadastral/);
  assert.equal((await c.root.collection('balanceAdjustments').get()).size, 3, 'só os ajustes da preparação');
});

test('conta sombra: o evento do comando já está aplicado e confere com o histórico', async () => {
  const c = await setup();
  const {result} = await c.adjust({clientId: 'c-reg', spaceId: c.B, mode: 'decrease', amountCents: 2000});
  const event = await c.read('balanceEvents', 'balance_adjustment:' + result.operationId);
  assert.equal((await c.shadow.applyEvent(c.bid, 'balance_adjustment:' + result.operationId, event)).status, 'duplicate');
  const v = await c.shadow.verifyClient(c.bid, 'c-reg');
  assert.equal(v.status, 'match', JSON.stringify(v.differences));
});

test('leituras do comando: conta simples não relê o histórico', async () => {
  const c = await setup(), rows = {};
  for (const clientId of ['c-zero', 'c-reg']) {
    c.meter.take(); const q = await c.preview({clientId, spaceId: c.A, mode: 'increase', amountCents: 100}); const previewDocs = c.meter.take();
    await c.adjustments.commit(c.req('customer_balance_adjustment', {clientId, spaceId: c.A, mode: 'increase', amountCents: 100, operationId: crypto.randomUUID(), quoteHash: q.quoteHash,
      expectedFinancialVersion: q.financialVersion, confirmed: true, reason: 'Medição fictícia de leituras em QA'}));
    rows[clientId] = {preview: previewDocs, commit: c.meter.take()};
  }
  console.log('[ajuste] leituras', JSON.stringify(rows));
  assert.ok(rows['c-zero'].preview <= 8 && rows['c-zero'].commit <= 9, JSON.stringify(rows['c-zero']));
  assert.ok(rows['c-reg'].commit > rows['c-zero'].commit, 'conta que ainda depende da prova lê o histórico');
});
