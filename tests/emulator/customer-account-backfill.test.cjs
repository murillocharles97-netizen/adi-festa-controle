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
const {customerAccountBackfillService} = require('../../functions/src/services/customer-account-backfill-service');
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
  const svc = operationalCommitService(db), backfill = customerAccountBackfillService(db), shadow = customerAccountService(db);
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

test('gravação: só o proprietário, com confirmação, cópia e regras explícitas', async () => {
  const c = await setup(), runId = 'run-' + crypto.randomUUID();
  await assert.rejects(c.call('customer_account_backfill_preview', {}, c.seller), e => e.code === 'permission-denied');
  await assert.rejects(c.call('customer_account_backfill_apply', {runId, confirmed: true, backupConfirmed: true}, c.seller), e => e.code === 'permission-denied');
  await assert.rejects(c.call('customer_account_backfill_apply', {runId, confirmed: true}), e => e.code === 'invalid-argument');
  await assert.rejects(c.call('customer_account_backfill_apply', {runId, backupConfirmed: true}), e => e.code === 'invalid-argument');
  await assert.rejects(c.call('customer_account_backfill_preview', {rules: ['inventada']}), e => e.code === 'invalid-argument');
  await assert.rejects(c.call('customer_account_backfill_preview', {rules: ['fallback_space'], fallbackSpaceId: 'space-' + crypto.randomUUID()}));
  assert.equal(await c.size('customerAccounts'), 0);
});

test('gravação grava contas e relatório, repete sem mudar e preserva os dados existentes', async () => {
  const c = await setup(), before = await c.snapshot(), runId = 'run-' + crypto.randomUUID(), args = {runId, confirmed: true, backupConfirmed: true, rules: ['single_linked_space']};
  const first = await c.all('customer_account_backfill_apply', args);
  assert.ok(Object.values(first.items).every(i => i.change === 'created'));
  assert.equal(await c.size('customerAccounts'), 6);
  const account = await c.read('customerAccounts', 'c3-legacy-one');
  assert.equal(account.status, 'ready_by_rule'); assert.deepEqual(account.spaces, {[c.A]: 8000}); assert.equal(account.backfill.runId, runId);
  assert.equal((await c.read('customerAccounts', 'c5-unexplained')).status, 'needs_opening');
  assert.equal((await c.root.collection('customerAccountBackfills').doc(runId).collection('items').get()).size, 6);
  const report = await c.read('customerAccountBackfills', runId);
  assert.ok(report.finishedAt); assert.equal(report.actorUid, c.owner); assert.deepEqual(report.rules, ['single_linked_space']);
  const again = await c.all('customer_account_backfill_apply', args);
  assert.ok(Object.values(again.items).every(i => i.change === 'unchanged'), JSON.stringify(Object.values(again.items).map(i => i.change)));
  await assert.rejects(c.call('customer_account_backfill_apply', {...args, rules: []}), e => e.code === 'already-exists');
  assert.equal(await c.snapshot(), before, 'clientes, vendas, pagamentos, ajustes e eventos intactos');
});

test('conta sombra existente é substituída com a versão anterior no relatório; eventos seguintes continuam', async () => {
  const c = await setup();
  const events = (await c.root.collection('balanceEvents').get()).docs.filter(d => d.data().customerId === 'c2-regularized' || d.data().clientId === 'c2-regularized');
  for (const e of events) await c.shadow.applyEvent(c.bid, e.id, e.data());
  await c.root.collection('customerAccounts').doc('c2-regularized').update({debtCents: 1});
  const runId = 'run-' + crypto.randomUUID();
  const {items} = await c.all('customer_account_backfill_apply', {runId, confirmed: true, backupConfirmed: true});
  assert.equal(items['c2-regularized'].change, 'replaced'); assert.equal(items['c2-regularized'].previous.debtCents, 1);
  assert.equal((await c.read('customerAccounts', 'c2-regularized')).debtCents, 22000);
  await untracked(() => c.regularize('c2-regularized', 9000));
  const newest = (await c.root.collection('balanceEvents').get()).docs.map(d => ({id: d.id, data: d.data()})).filter(e => e.data.customerId === 'c2-regularized' && !events.some(x => x.id === e.id));
  assert.equal(newest.length, 1);
  const applied = await c.shadow.applyEvent(c.bid, newest[0].id, newest[0].data);
  assert.equal(applied.status, 'applied'); assert.equal(applied.verification.status, 'match', JSON.stringify(applied.verification.differences));
  const after = await c.read('customerAccounts', 'c2-regularized');
  assert.deepEqual(after.spaces, {[c.A]: 9000, [c.B]: 7000}); assert.equal(after.status, 'ready', 'a classificação da carga é preservada');
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
