'use strict';
// Fase 4 no Emulator: o servidor publica um documento por cliente e Espaço (para as telas)
// a partir da carga, do comando de ajuste e de cada evento do razão, e retira os documentos
// de uma conta que deixa de estar pronta. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {loadApprovedAccounts} = require('../helpers/selective-account-load.cjs');
const {customerAccountBackfillService} = require('../../functions/src/services/customer-account-backfill-service');
const {customerBalanceAdjustmentService} = require('../../functions/src/services/customer-balance-adjustment-service');

let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-space-accounts'}, 'space-accounts'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });

async function setup() {
  const bid = 'published-' + crypto.randomUUID(), owner = 'owner-' + (++seq), root = db.doc('businesses/' + bid), A = 'space-a-' + bid, B = 'space-b-' + bid;
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  await db.doc('users/' + owner).set({uid: owner, businessId: bid, active: true, role: 'owner'});
  await root.collection('members').doc(owner).set({uid: owner, role: 'owner', status: 'active', spaceAccess: 'all', permissionsVersion: 2,
    permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true}});
  for (const id of [A, B]) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true}});
  for (const clientId of ['c-reg', 'c-zero', 'c-open'])
    await root.collection('clients').doc(clientId).set({id: clientId, businessId: bid, nome: 'Pessoa QA ' + clientId, saldo: 0, financialVersion: 0, workspaceGeneration: 0, active: true, ativo: true, customerSpaceIds: [A, B]});
  const svc = operationalCommitService(db), shadow = customerAccountService(db, {verify: false}), adjust = customerBalanceAdjustmentService(db);
  const regularize = async (clientId, total, spaceId) => {
    const r = (kind, extra = {}) => ({auth: {uid: owner}, data: {businessId: bid, workspaceGeneration: 0, spaceId, clientId, kind, ...extra}});
    const q = await svc.receipt(r('fiado_space_regularization_preview'));
    return svc.commit(r('fiado_space_regularization', {operationId: crypto.randomUUID(), quoteHash: q.quoteHash, financialVersion: q.financialVersion, targetDebtCents: total,
      purpose: 'historical_debt', reason: 'Ajuste conferido em anotação fictícia de QA', confirmed: true, localQueueChecked: true}));
  };
  await regularize('c-reg', 15000, A); await regularize('c-reg', 7000, B);
  await root.collection('clients').doc('c-open').update({saldo: -190});
  const load = () => loadApprovedAccounts(db, bid, owner, 'run-' + crypto.randomUUID());
  const published = async () => Object.fromEntries((await root.collection('customerSpaceAccounts').get()).docs.map(d => [d.id, d.data()]).sort(([a], [b]) => a.localeCompare(b)));
  const command = async (data) => {
    const req = (kind, extra) => ({auth: {uid: owner}, data: {businessId: bid, workspaceGeneration: 0, kind, ...extra}});
    const q = await adjust.preview(req('customer_balance_adjustment_preview', data));
    return adjust.commit(req('customer_balance_adjustment', {...data, operationId: crypto.randomUUID(), quoteHash: q.quoteHash, expectedFinancialVersion: q.financialVersion, confirmed: true, reason: 'Ajuste fictício conferido em QA'}));
  };
  return {bid, owner, A, B, root, svc, shadow, regularize, load, published, command};
}

test('a carga publica só contas prontas, um documento por Espaço', async () => {
  const c = await setup(); await c.load();
  const docs = await c.published();
  assert.deepEqual(Object.keys(docs), ['c-reg__' + c.A, 'c-reg__' + c.B]);
  assert.equal(docs['c-reg__' + c.A].debtCents, 15000); assert.equal(docs['c-reg__' + c.B].debtCents, 7000);
  assert.equal(docs['c-reg__' + c.A].spaceId, c.A); assert.equal(docs['c-reg__' + c.A].businessId, c.bid); assert.equal(docs['c-reg__' + c.A].status, 'ready');
  assert.ok(!Object.keys(docs).some(id => id.startsWith('c-open')), 'conta que precisa de abertura não é publicada');
});

test('o comando de ajuste atualiza o Espaço publicado; zerar deixa o Espaço com zero', async () => {
  const c = await setup();
  await c.regularize('c-zero', 1000, c.B);
  await c.regularize('c-zero', 0, c.B);
  await c.load();
  await c.command({clientId: 'c-reg', spaceId: c.A, mode: 'set', targetDebtCents: 0});
  await c.command({clientId: 'c-zero', spaceId: c.B, mode: 'increase', amountCents: 2500});
  const docs = await c.published();
  assert.equal(docs['c-reg__' + c.A].debtCents, 0, 'Espaço zerado continua publicado com zero');
  assert.equal(docs['c-reg__' + c.B].debtCents, 7000);
  assert.equal(docs['c-zero__' + c.B].debtCents, 2500);
});

test('cada evento do razão atualiza o Espaço publicado pela conta sombra', async () => {
  const c = await setup(); await c.load();
  await c.regularize('c-reg', 9000, c.A);
  const events = (await c.root.collection('balanceEvents').get()).docs.map(d => ({id: d.id, data: d.data()}));
  for (const e of events) await c.shadow.applyEvent(c.bid, e.id, e.data);
  assert.equal((await c.published())['c-reg__' + c.A].debtCents, 9000);
});

test('recomposição atualiza uma projeção sem versão sem repetir a carga original', async () => {
  const c = await setup(); await c.load();
  const {FieldValue} = require('firebase-admin/firestore');
  const accountRef = c.root.collection('customerAccounts').doc('c-reg');
  await accountRef.update({spaceProjectionVersion: FieldValue.delete()});
  const documents = await c.root.collection('customerSpaceAccounts').get();
  await Promise.all(documents.docs.map(doc => doc.ref.update({financialVersion: FieldValue.delete()})));
  const service = customerAccountBackfillService(db, {projectionScope: c.bid + ':0'});
  const call = () => service.handle({auth: {uid: c.owner}, data: {
    kind: 'customer_account_backfill_catchup', businessId: c.bid, workspaceGeneration: 0, clientIds: ['c-reg']
  }});
  assert.equal((await call()).items[0].status, 'current');
  const version = (await c.root.collection('clients').doc('c-reg').get()).data().financialVersion;
  assert.ok(Object.values(await c.published()).every(row => row.financialVersion === version));
  const refreshed = await accountRef.get();
  await call();
  assert.ok(refreshed.updateTime.isEqual((await accountRef.get()).updateTime));
  assert.equal((await c.root.collection('customerAccountBackfills').get()).size, 1);
});

test('conta que deixa de estar pronta tem os documentos retirados', async () => {
  const c = await setup(); await c.load();
  await c.root.collection('clients').doc('c-reg').update({saldo: -999});
  const service = customerAccountBackfillService(db, {projectionScope: c.bid + ':0'});
  const result = await service.handle({auth: {uid: c.owner}, data: {
    kind: 'customer_account_backfill_catchup', businessId: c.bid, workspaceGeneration: 0, clientIds: ['c-reg']
  }});
  assert.equal(result.items[0].status, 'needs_review');
  assert.ok(!Object.keys(await c.published()).some(id => id.startsWith('c-reg__')), 'nenhum saldo antigo fica publicado');
});
