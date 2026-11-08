'use strict';

const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {test, after} = require('node:test');
const requireFunctions = require('node:module').createRequire(require.resolve('../../functions/package.json'));
const {initializeApp, deleteApp} = requireFunctions('firebase-admin/app');
const {getFirestore} = requireFunctions('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {harness} = require('../helpers/fiado-cancellation-harness.cjs');

const projectId = 'demo-veconi-payment-recognition';
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
assert.equal(process.env.GCLOUD_PROJECT, projectId);
const app = initializeApp({projectId});
const db = getFirestore(app);
after(() => deleteApp(app));
const service = operationalCommitService(db);
const payloadHash = 'a'.repeat(64);
const effectivePayloadHash = 'b'.repeat(64);
const reviewHash = 'c'.repeat(64);
const date = '2026-11-01T02:20:13.192Z';

async function fixture(generation = 1) {
  const businessId = randomUUID(), clientId = randomUUID(), operationId = randomUUID();
  const owner = randomUUID(), employee = randomUUID(), spaceId = randomUUID();
  const eventId = 'payment_received:' + operationId, auditId = 'payment_reconciliation_' + operationId;
  const root = db.collection('businesses').doc(businessId);
  const ref = (col, id) => root.collection(col).doc(id);
  const space = db.collection('financialSpaces').doc(spaceId);
  const scoped = {businessId, workspaceGeneration: generation};
  const common = {...scoped, operationId, actorUid: owner, ownerId: owner};
  const before = {saldo: -81, financialVersion: 3}, after = {saldo: 0, financialVersion: 4};
  const allocations = [25, 27, 29].map(amount => ({saleId: randomUUID(), amount, settledSale: true}));
  const financial = {amount: 81, allocatedAmount: 81, legacyAmount: 0, allocations};
  const payment = ref('payments', operationId), client = ref('clients', clientId), audit = ref('auditLogs', auditId);
  const event = ref('balanceEvents', eventId), marker = ref('processedOperations', operationId);
  const sale = allocations.map(row => ref('sales', row.saleId));
  const allocation = allocations.map(row => ref('paymentAllocations', operationId + '__' + row.saleId));
  const batch = db.batch();
  batch.set(root, {...scoped, active: true, ownerId: owner, subscription: {planId: 'internal', status: 'active'}});
  for (const [uid, role] of [[owner, 'owner'], [employee, 'cashier']]) {
    batch.set(db.collection('users').doc(uid), {businessId, active: true, role});
    batch.set(ref('members', uid), {status: 'active', role});
  }
  batch.set(space, {businessId, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, inventory: true}});
  batch.set(client, {...scoped, id: clientId, ...after});
  batch.set(payment, {...common, ...financial, id: operationId, idempotencyKey: operationId, clienteId: clientId,
    valor: 81, spaceId, data: date, paymentMethod: 'pix', status: 'applied', applicationStatus: 'applied',
    financialAppliedAt: date, financialOperationId: eventId, saldoAnterior: -81, saldoNovo: 0,
    expectedBalance: -81, expectedFinancialVersion: 3, financialVersionAfter: 4});
  batch.set(event, {...common, id: eventId, spaceId, customerId: clientId, sourceDocumentId: operationId,
    sourceCollection: 'payments', status: 'applied', type: 'payment_received', amount: 81, balanceDelta: 81, sourceCreatedAt: date});
  batch.set(marker, {...common, id: operationId, requestHash: payloadHash, authorizationVersion: 1, status: 'processed',
    eventKind: 'payment', paymentRecovery: {version: 1, originalPayloadHash: payloadHash, effectivePayloadHash, auditId}});
  batch.set(audit, {...common, ...financial, auditId, before, after, clientId, spaceId,
    type: 'original_payment_reconciliation', originalActorUid: owner, originalDate: date, method: 'pix',
    originalPayloadHash: payloadHash, originalFileHash: 'd'.repeat(64), originalPacketHash: 'e'.repeat(64),
    effectivePayloadHash, reviewHash, localExecution: {channel: 'local-admin', id: randomUUID()}});
  allocations.forEach((row, index) => {
    batch.set(sale[index], {...scoped, id: row.saleId, clienteId: clientId, formaPagamento: 'fiado',
      creditSettled: true, creditRemainingAmount: 0, creditPaidAmount: row.amount});
    batch.set(allocation[index], {...common, ...row, clientId, paymentId: operationId});
  });
  const cash = space.collection('entries');
  batch.set(cash.doc('credit_payment_' + operationId), {sourceId: operationId, amount: 81});
  await batch.commit();
  const data = {businessId, workspaceGeneration: generation, operationId, clientId, originalPayloadHash: payloadHash};
  const read = (patch = {}, uid = owner) => service.recognizePreservedPayment({auth: uid ? {uid} : null, data: {...data, ...patch}});
  return {read, businessId, spaceId, owner, clientId, client, event, payment, marker, audit, sale, allocation, cash, ref, operationId, employee,
    checked: [payment, client, audit, event, marker, ...sale, ...allocation]};
}

test('complete recognition is idempotent and writes none of the eleven records or the cash entry', async () => {
  const f = await fixture();
  const before = await db.getAll(...f.checked);
  const cashBefore = (await f.cash.get()).docs.map(doc => [doc.id, doc.updateTime]);
  const receipt = await f.read();
  assert.equal(receipt.confirmed, true);
  assert.equal(receipt.allocationCount, 3);
  assert.equal(receipt.reviewHash, reviewHash);
  assert.equal(receipt.amount, 81);
  assert.deepEqual(receipt.before, {saldo: -81, financialVersion: 3});
  assert.deepEqual(receipt.after, {saldo: 0, financialVersion: 4});
  assert.deepEqual(await f.read(), receipt);
  const after = await db.getAll(...f.checked);
  assert.equal(after.length, 11);
  assert.deepEqual(after.map(doc => doc.updateTime), before.map(doc => doc.updateTime));
  assert.deepEqual((await f.cash.get()).docs.map(doc => [doc.id, doc.updateTime]), cashBefore);
  assert.equal((await f.ref('payments', '_').parent.get()).size, 1);
});

test('absence, mismatched original, actor, client, workspace or enterprise fail closed', async () => {
  const f = await fixture();
  assert.equal((await f.read({operationId: randomUUID()})).status, 'not_confirmed');
  for (const patch of [{clientId: randomUUID()}, {originalPayloadHash: 'f'.repeat(64)},
    {workspaceGeneration: 0}, {businessId: (await fixture()).businessId}, {action: 'apply'}]) {
    await assert.rejects(f.read(patch), error => ['permission-denied', 'failed-precondition', 'invalid-argument'].includes(error.code));
  }
  await assert.rejects(f.read({}, f.employee), {code: 'permission-denied'});
  await assert.rejects(f.read({}, ''), {code: 'unauthenticated'});
});

test('duplicates and incomplete or superseded proof keep manual review', async () => {
  const f = await fixture();
  const duplicate = f.ref('payments', randomUUID());
  const requireHold = async () => assert.equal((await f.read()).status, 'incomplete_evidence');
  await duplicate.set({operationId: f.operationId});
  await requireHold();
  await duplicate.delete();
  const allocation = (await f.allocation[0].get()).data();
  await f.allocation[0].delete();
  await assert.rejects(f.read(), {code: 'failed-precondition'});
  await f.allocation[0].set(allocation);
  await f.sale[0].update({creditSettled: false});
  await requireHold();
  await f.sale[0].update({creditSettled: true});
  await f.client.update({financialVersion: 5});
  await requireHold();
  await f.client.update({financialVersion: 4});
  await f.audit.delete();
  await requireHold();
  assert.equal((await f.cash.get()).size, 1);
});

test('a subsequent traditional Fiado sale commits from version 4 and leaves the reconciled Pix alone', async () => {
  const f = await fixture(0);
  assert.equal((await f.read()).confirmed, true);
  const h = harness({businessId: f.businessId, spaceId: f.spaceId, uid: f.owner});
  h.data().clientes = [(await f.client.get()).data()];
  const product = h.data().produtos[0];
  await f.ref('products', product.id).set(product);
  const before = structuredClone(h.data()), operationId = randomUUID(), id = randomUUID();
  h.c.Vendas.registrar({id, operationId, businessId: f.businessId, spaceId: f.spaceId, clienteId: f.clientId,
    status: 'fiado', formaPagamento: 'fiado', itens: [{produtoId: product.id, nome: 'QA', quantidade: 1,
      precoOriginal: 14, precoFinalUnitario: 14}]});
  const item = {operationId, businessId: f.businessId, userId: f.owner, workspaceGeneration: 0,
    payloadVersion: 4, status: 'pending', payload: {eventKind: 'sale', writes: h.c.diffWrites(before, h.data())}};
  await service.commit({auth: {uid: f.owner}, data: {businessId: f.businessId, clientRelease: 227, syncProtocolVersion: 1, item}});
  const client = (await f.client.get()).data();
  assert.equal(client.saldo, -14);
  assert.equal(client.financialVersion, 5);
  assert.equal((await f.ref('products', product.id).get()).data().estoqueAtual, 2);
  assert.equal((await f.ref('payments', '_').parent.get()).size, 1);
  assert.equal((await f.payment.get()).data().valor, 81);
  assert.equal((await f.cash.get()).size, 1);
});
