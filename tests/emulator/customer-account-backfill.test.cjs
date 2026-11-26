'use strict';
// Conta por Espaço — Fase 2 no Emulator: prévia (só leitura) e carga auditada das
// contas, com clientes fictícios em cada situação. Confere que nada além das contas e do
// relatório é gravado e que a conta sombra continua acompanhando os eventos depois da carga.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs'), vm = require('node:vm');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {customerAccountBackfillService, applyLoadedEvent} = require('../../functions/src/services/customer-account-backfill-service');
const {harness, bridge} = require('../helpers/fiado-cancellation-harness.cjs');

// Etapa 5: an operation the account does not follow in its own transaction (the trigger path).
const LedgerService = require('../../functions/src/services/customer-account-ledger-service');
const untracked = async fn => { const real = LedgerService.prepare; LedgerService.prepare = async () => null; try { return await fn(); } finally { LedgerService.prepare = real; } };
let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-account-backfill'}, 'account-backfill'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });

const CLIENTS = {
  'c1-zero': {spaces: 'ab'}, 'c2-regularized': {spaces: 'ab'}, 'c3-legacy-one': {spaces: 'a'},
  'c4-legacy-two': {spaces: 'ab'}, 'c5-unexplained': {spaces: 'a'}, 'c6-credit': {spaces: 'a'},
};
async function setup() {
  const bid = 'backfill-' + crypto.randomUUID(), owner = 'owner-' + (++seq), seller = 'seller-' + seq, root = db.doc('businesses/' + bid);
  const A = 'space-a-' + bid, B = 'space-b-' + bid;
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  for (const [uid, role] of [[owner, 'owner'], [seller, 'seller']]) {
    await db.doc('users/' + uid).set({uid, businessId: bid, active: true, role});
    await root.collection('members').doc(uid).set({uid, role, status: 'active', spaceAccess: 'all', permissionsVersion: 2,
      permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true, 'settings.manage': true}});
  }
  for (const id of [A, B]) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true}});
  for (const [clientId, spec] of Object.entries(CLIENTS))
    await root.collection('clients').doc(clientId).set({id: clientId, businessId: bid, nome: 'Pessoa QA ' + clientId, saldo: 0, financialVersion: 0, workspaceGeneration: 0, active: true, ativo: true,
      customerSpaceIds: spec.spaces === 'a' ? [A] : [A, B]});
  const svc = operationalCommitService(db), backfill = customerAccountBackfillService(db, {loadScope: bid+ ':0', projectionScope: bid+ ':0'}), shadow = customerAccountService(db);
  const regularize = async (clientId, total, spaceId = A) => {
    const r = (kind, extra = {}) => ({auth: {uid: owner}, data: {businessId: bid, workspaceGeneration: 0, spaceId, clientId, kind, ...extra}});
    const q = await svc.receipt(r('fiado_space_regularization_preview'));
    return svc.commit(r('fiado_space_regularization', {operationId: crypto.randomUUID(), quoteHash: q.quoteHash, financialVersion: q.financialVersion, targetDebtCents: total,
      purpose: 'historical_debt', reason: 'Ajuste conferido em anotação fictícia de QA', confirmed: true, localQueueChecked: true}));
  };
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const legacyAdjust = async (clientId, newBalance) => {
    const h = harness({businessId: bid, spaceId: A, uid: owner});
    h.data().clientes = [await read('clients', clientId)]; h.c.PhoneUtils = {normalizeBrazilianPhone: v => v}; h.c.addEventListener = () => {};
    vm.runInContext(fs.readFileSync('js/clientes.js', 'utf8'), h.c);
    const before = bridge(h.data()), adjustment = h.c.Clientes.ajustarSaldo(clientId, newBalance, 'Ajuste antigo fictício de QA');
    return svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: adjustment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
      payload: {eventKind: 'balance_adjustment', fiadoHistoryVersion: 1, writes: [...bridge(h.c.diffWrites(before, h.data())), {entityType: 'balanceAdjustments', entityId: adjustment.id, operation: 'create', data: bridge(adjustment)}]}}}});
  };
  await regularize('c2-regularized', 15000); await regularize('c2-regularized', 7000, B);
  await legacyAdjust('c3-legacy-one', -80);
  await legacyAdjust('c4-legacy-two', -50);
  await root.collection('clients').doc('c5-unexplained').update({saldo: -190});
  await legacyAdjust('c6-credit', 50);
  const call = (kind, extra = {}, uid = owner) => backfill.handle({auth: {uid}, data: {businessId: bid, workspaceGeneration: 0, kind, ...extra}});
  const all = async (kind, extra = {}) => {
    const items = []; let cursor = null, pages = 0;
    do { const r = await call(kind, {...extra, cursor, limit: 2}); items.push(...r.items); cursor = r.nextCursor; pages++; } while (cursor);
    return {items: Object.fromEntries(items.map(i => [i.clientId, i])), pages};
  };
  const snapshot = async () => {
    const out = {};
    for (const col of ['clients', 'sales', 'payments', 'balanceAdjustments', 'balanceEvents', 'paymentAllocations', 'processedOperations', 'stockMovements'])
      out[col] = (await root.collection(col).get()).docs.map(d => [d.id, d.data()]).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(out);
  };
  const size = async col => (await root.collection(col).get()).size;
  return {bid, owner, seller, A, B, root, svc, backfill, shadow, regularize, read, legacyAdjust, call, all, snapshot, size};
}

test('prévia: classifica cada situação e não grava nada', async () => {
  const c = await setup(), before = await c.snapshot();
  const {items, pages} = await c.all('customer_account_backfill_preview');
  assert.equal(pages, 3, 'páginas de 2 clientes');
  assert.equal(items['c1-zero'].status, 'ready');
  assert.equal(items['c2-regularized'].status, 'ready'); assert.equal(items['c2-regularized'].split, 'scoped');
  assert.deepEqual(items['c2-regularized'].spaces, {[c.A]: 15000, [c.B]: 7000});
  assert.equal(items['c3-legacy-one'].status, 'needs_attribution'); assert.equal(items['c3-legacy-one'].unattributedCents, 8000);
  assert.equal(items['c4-legacy-two'].status, 'needs_attribution');
  assert.equal(items['c5-unexplained'].status, 'needs_opening'); assert.equal(items['c5-unexplained'].unexplainedCents, 19000);
  assert.equal(items['c6-credit'].status, 'needs_attribution'); assert.equal(items['c6-credit'].debtCents, -5000);
  assert.equal(await c.snapshot(), before, 'nenhum dado existente mudou');
  for (const col of ['customerAccounts', 'customerAccountBackfills']) assert.equal(await c.size(col), 0, col);
});

test('regras aprovadas resolvem a atribuição sem tocar o que já é comprovado nem a abertura', async () => {
  const c = await setup();
  const {items} = await c.all('customer_account_backfill_preview', {rules: ['single_linked_space', 'fallback_space'], fallbackSpaceId: c.B});
  assert.equal(items['c3-legacy-one'].status, 'ready_by_rule'); assert.deepEqual(items['c3-legacy-one'].spaces, {[c.A]: 8000}); assert.deepEqual(items['c3-legacy-one'].rules, ['single_linked_space']);
  assert.equal(items['c4-legacy-two'].status, 'ready_by_rule'); assert.deepEqual(items['c4-legacy-two'].spaces, {[c.B]: 5000}); assert.deepEqual(items['c4-legacy-two'].rules, ['fallback_space']);
  assert.equal(items['c6-credit'].status, 'ready_by_rule'); assert.deepEqual(items['c6-credit'].spaces, {[c.A]: -5000});
  assert.deepEqual(items['c2-regularized'].rules, []); assert.deepEqual(items['c2-regularized'].spaces, {[c.A]: 15000, [c.B]: 7000});
  assert.equal(items['c5-unexplained'].status, 'needs_opening');
});


test('carga exige aprovação vigente por cliente e recusa empresa, geração e Espaço divergentes', async () => {
  const c = await setup(), runId = 'run-' + crypto.randomUUID(), clientId = 'c2-regularized';
  const {items} = await c.all('customer_account_backfill_preview');
  const approval = items[clientId].approval;
  assert.ok(approval);
  assert.equal(items['c5-unexplained'].approval, null);
  assert.equal(items['c6-credit'].approval, null);
  const args = {runId, pageId: 'page-1', confirmed: true, backupConfirmed: true, items: [approval]};
  await assert.rejects(c.call('customer_account_backfill_apply', args, c.seller), {code:'permission-denied'});
  await assert.rejects(c.call('customer_account_backfill_apply', {...args, backupConfirmed: false}), {code:'invalid-argument'});
  await assert.rejects(c.call('customer_account_backfill_apply', {...args, items: []}), {code:'invalid-argument'});
  await assert.rejects(c.call('customer_account_backfill_apply', {...args, rules: ['single_linked_space']}), {code:'invalid-argument'});
  await assert.rejects(c.call('customer_account_backfill_apply', {...args, workspaceGeneration: 1}), {code:'failed-precondition'});
  await assert.rejects(c.call('customer_account_backfill_apply', {...args, businessId: 'qa-other-company'}), {code:'failed-precondition'});
  await db.doc('financialSpaces/' + c.B).update({linkedBusinessId:'qa-other-company'});
  const rejected = await c.call('customer_account_backfill_apply', args);
  assert.equal(rejected.items[0].reason, 'espaco-fora-do-escopo');
  assert.equal(await c.size('customerAccounts'), 0);
  await assert.rejects(c.call('customer_account_backfill_preview', {rules:['inventada']}), {code:'invalid-argument'});
  await assert.rejects(c.call('customer_account_backfill_preview', {rules:['fallback_space'], fallbackSpaceId:'qa-missing-space'}));
});

test('carga seletiva recupera a mesma página após resposta perdida e concorrência', async () => {
  const c = await setup(), before = await c.snapshot(), clientId = 'c2-regularized', runId = 'run-' + crypto.randomUUID();
  const {items} = await c.all('customer_account_backfill_preview');
  const approval = items[clientId].approval;
  const args = {runId, pageId:'page-1', confirmed:true, backupConfirmed:true, items:[approval]};
  const accountRef = c.root.collection('customerAccounts').doc(clientId);
  const prior = {debtCents: 1, spaces: {}, workspaceGeneration: 0, clientId};
  await accountRef.set(prior);
  const fault = failingTransaction(db, 3);
  const service = customerAccountBackfillService(fault, {loadScope: c.bid + ':0'});
  await assert.rejects(service.handle({auth:{uid:c.owner},data:{kind:'customer_account_backfill_apply',businessId:c.bid,...args}}), /QA interrupted/);
  const run = c.root.collection('customerAccountBackfills').doc(runId);
  assert.equal((await run.get()).data().pages, 0);
  assert.equal((await run.collection('items').doc(clientId).get()).data().result.status,'applied');
  const afterFirst = await accountRef.get();
  const [resumed, concurrent] = await Promise.all([
    c.call('customer_account_backfill_apply', args), c.call('customer_account_backfill_apply', args)
  ]);
  assert.deepEqual(concurrent, resumed);
  assert.equal(resumed.items[0].status, 'applied');
  assert.equal(resumed.items[0].previous.debtCents, 1);
  assert.equal((await run.get()).data().pages, 1);
  assert.equal((await run.get()).data().applied, 1);
  assert.equal((await accountRef.get()).updateTime.isEqual(afterFirst.updateTime), true);
  assert.equal(await c.size('customerAccounts'), 1);
  assert.equal((await run.collection('items').get()).size, 1);
  assert.equal((await run.collection('pages').get()).size, 1);
  await assert.rejects(c.call('customer_account_backfill_apply', {...args, pageId:'duplicate-client'}), {code:'already-exists'});
  await assert.rejects(c.call('customer_account_backfill_apply', {...args, items:[{...approval, proofHash:'0'.repeat(64)}]}), {code:'already-exists'});
  assert.equal(await c.snapshot(), before);
});

test('uma movimentação após a prévia gera revisão e preserva os demais aprovados', async () => {
  const c = await setup();
  await c.regularize('c1-zero', 5000);
  const {items} = await c.all('customer_account_backfill_preview');
  await c.regularize('c2-regularized', 9000);
  const result = await c.call('customer_account_backfill_apply', {runId:'qa-stale', pageId:'page-1', confirmed:true, backupConfirmed:true,
    items:[items['c1-zero'].approval,items['c2-regularized'].approval]});
  assert.deepEqual(result.items.map(row=>row.status),['applied','needs_review']);
  assert.equal(result.items[1].reason,'previa-alterada');
  assert.equal(await c.read('customerAccounts','c2-regularized'),undefined);
});

function failingTransaction(database, ordinal) {
  let count = 0;
  return new Proxy(database,{get(target,key) {
    if(key==='runTransaction')return (...args)=>++count===ordinal ?
      Promise.reject(new Error('QA interrupted')) : target.runTransaction(...args);
    const value=target[key];
    return typeof value==='function'?value.bind(target):value;
  }});
}

test('projeção selecionada recompõe eventos da janela e suporta concorrência e reentrega', async () => {
  const c = await setup(), clientId = 'c2-regularized', projectionScope = c.bid + ':0';
  const {items} = await c.all('customer_account_backfill_preview');
  await c.call('customer_account_backfill_apply', {runId:'qa-gap',pageId:'page-1',confirmed:true,backupConfirmed:true,items:[items[clientId].approval]});
  const before = await c.read('customerAccounts',clientId);
  const existing = new Set((await c.root.collection('balanceEvents').get()).docs.map(d=>d.id));
  await untracked(() => c.regularize(clientId, 9000));
  const event = (await c.root.collection('balanceEvents').get()).docs.find(d=>!existing.has(d.id));
  assert.ok(event);
  assert.equal((await applyLoadedEvent(db,c.bid,event.id,{projectionScope:null})).status,'disabled');
  assert.equal((await c.read('customerAccounts',clientId)).clientFinancialVersion,before.clientFinancialVersion);
  const route = await c.svc.receipt({auth:{uid:c.owner},data:{kind:'fiado_receipt_route',
    businessId:c.bid, workspaceGeneration:0, clientId, spaceId:c.A, scopedReceiptVersion:1, receiptProofVersion:2}});
  assert.equal(route.mode,'space');
  assert.equal(route.dueCents,9000);
  assert.notEqual(route.source,'customer_account');
  await assert.rejects(applyLoadedEvent(failingTransaction(db,1),c.bid,event.id,{projectionScope}), /QA interrupted/);
  const args = {clientIds:[clientId,'c5-unexplained']};
  const results = await Promise.all([
    c.call('customer_account_backfill_catchup',args),
    applyLoadedEvent(db,c.bid,event.id,{projectionScope}),
    applyLoadedEvent(db,c.bid,event.id,{projectionScope})
  ]);
  assert.equal(results[0].items[1].status,'outside-cohort');
  const account = await c.read('customerAccounts',clientId);
  assert.deepEqual(account.spaces,{[c.A]:9000,[c.B]:7000});
  assert.equal(account.clientFinancialVersion,(await c.read('clients',clientId)).financialVersion);
  const markers=c.root.collection('customerAccounts').doc(clientId).collection('appliedEvents');
  assert.equal((await markers.get()).size, 1);
  assert.equal(await c.size('customerAccounts'),1);
  assert.equal((await applyLoadedEvent(db,'qa-other-company',event.id,{projectionScope})).status,'disabled');
  assert.equal((await c.call('customer_account_backfill_catchup',args)).items[0].status,'current');
  assert.deepEqual(await c.read('customerAccounts',clientId),account);
});

test('a retentativa do gatilho retoma a verificação interrompida sem aplicar o valor novamente', async () => {
  const c = await setup(), clientId = 'c2-regularized';
  const {items} = await c.all('customer_account_backfill_preview');
  await c.call('customer_account_backfill_apply', {runId:'qa-retry',pageId:'page-1',confirmed:true,backupConfirmed:true,items:[items[clientId].approval]});
  const existing = new Set((await c.root.collection('balanceEvents').get()).docs.map(d=>d.id));
  await untracked(() => c.regularize(clientId, 9000));
  const event = (await c.root.collection('balanceEvents').get()).docs.find(d=>!existing.has(d.id));
  const faulty = customerAccountService(failingTransaction(db,2));
  await assert.rejects(faulty.applyEvent(c.bid,event.id,event.data()),/QA interrupted/);
  const before=await c.read('customerAccounts',clientId), version=(await c.read('clients',clientId)).financialVersion;
  assert.ok(before.clientFinancialVersion<version);
  const resumed=await c.shadow.applyEvent(c.bid,event.id,event.data());
  assert.equal(resumed.status,'duplicate');
  assert.equal(resumed.verification.status,'match');
  const account=await c.read('customerAccounts',clientId);
  assert.equal(account.clientFinancialVersion,version);
  assert.equal(account.debtCents,before.debtCents);
});

test('histórico ilegível vai para revisão sem parar a página, e o gatilho da conta sombra não fica tentando de novo', async () => {
  const c = await setup();
  // An activation record that does not match its audit makes the history unreadable on purpose.
  await c.root.collection('clients').doc('c1-zero').update({fiadoHistoryVersion: 1, fiadoHistoryActivation: {version: 1, source: 'fiado_history_regularization', activationId: 'forjada', originLinksDigest: 'x', financialVersion: 0}});
  const {items} = await c.all('customer_account_backfill_preview');
  assert.equal(items['c1-zero'].status, 'needs_review'); assert.match(items['c1-zero'].unprovableReason, /Ativação histórica inválida/);
  assert.equal(items['c2-regularized'].status, 'ready', 'os outros clientes continuam');
  const event = {type: 'balance_adjustment', status: 'applied', businessId: c.bid, workspaceGeneration: 0, customerId: 'c1-zero', balanceDelta: -10, appliedAt: new Date().toISOString(), spaceId: c.A};
  assert.equal((await c.shadow.applyEvent(c.bid, 'qa-unreadable-1', event)).status, 'needs_review');
  assert.equal((await c.shadow.applyEvent(c.bid, 'qa-unreadable-2', event)).status, 'needs_review');
  assert.equal((await c.shadow.applyEvent(c.bid, 'qa-unreadable-2', event)).status, 'duplicate');
  const stub = await c.read('customerAccounts', 'c1-zero');
  assert.equal(stub.status, 'needs_review'); assert.equal(stub.debtCents, null); assert.match(stub.reviewReason, /Ativação histórica inválida/);
  assert.equal((await c.shadow.verifyClient(c.bid, 'c1-zero')).status, 'needs_review');
});
