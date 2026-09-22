const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, runTransaction, setDoc, serverTimestamp } = require('firebase/firestore');

const projectId = 'adi-festa-variations-test';
const businessId = 'only-local-recovery-rules';
const ownerId = 'recovery-owner';
const clientId = 'recovery-client';
const spaceId = 'recovery-sales-space';
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'businesses', businessId), {
      id: businessId, ownerId, active: true,
      subscription: { planId: 'internal', status: 'active' },
    });
    await setDoc(doc(db, 'users', ownerId), {
      uid: ownerId, businessId, role: 'owner', active: true,
    });
    await setDoc(doc(db, 'financialSpaces', spaceId), {
      id: spaceId, type: 'business', linkedBusinessId: businessId,
      active: true, status: 'active', capabilities: { sales: true },
    });
    await setDoc(doc(db, 'businesses', businessId, 'clients', clientId), {
      id: clientId, businessId, ownerId, nome: 'Cliente controlado',
      saldo: 0, financialVersion: 0, totalComprado: 0, quantidadeVendas: 0,
    });
  });
});

test.after(async () => env?.cleanup());

async function recover(db, saleId, operationId, amount, expectedBalance, expectedVersion) {
  const base = ['businesses', businessId];
  const saleRef = doc(db, ...base, 'sales', saleId);
  const effectRef = doc(db, ...base, 'balanceEvents', `credit_sale:${saleId}`);
  const markerRef = doc(db, ...base, 'processedOperations', operationId);
  const clientRef = doc(db, ...base, 'clients', clientId);
  return runTransaction(db, async (transaction) => {
    const [sale, marker, effect, client] = await Promise.all([
      transaction.get(saleRef), transaction.get(markerRef),
      transaction.get(effectRef), transaction.get(clientRef),
    ]);
    if (sale.exists()) {
      assert.equal(sale.data().operationId, operationId);
      return { idempotent: true };
    }
    if (marker.exists() || effect.exists() || !client.exists() ||
      client.data().saldo !== expectedBalance ||
      client.data().financialVersion !== expectedVersion)
      throw new Error('recovery-precondition-failed');
    transaction.set(saleRef, {
      id: saleId, businessId, ownerId, spaceId, operationId,
      idempotencyKey: operationId, clienteId: clientId,
      formaPagamento: 'fiado', status: 'applied', valorFinal: amount,
      saldoAnterior: expectedBalance, saldoAtual: expectedBalance - amount,
      financialVersionAnterior: expectedVersion,
      applicationStatus: 'applied', financialAppliedAt: serverTimestamp(),
      syncConfirmedAt: serverTimestamp(), schemaVersion: 3,
    });
    transaction.set(clientRef, {
      saldo: expectedBalance - amount,
      financialVersion: expectedVersion + 1,
      totalComprado: client.data().totalComprado + amount,
      quantidadeVendas: client.data().quantidadeVendas + 1,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    transaction.set(effectRef, {
      id: `credit_sale:${saleId}`, operationId,
      idempotencyKey: `credit_sale:${saleId}`, businessId, ownerId,
      customerId: clientId, clientId, saleId,
      sourceCollection: 'sales', sourceDocumentId: saleId,
      type: 'credit_sale', direction: 'debit', amount,
      balanceDelta: -amount, eventKind: 'sale', status: 'applied',
      appliedAt: serverTimestamp(), schemaVersion: 3,
    });
    transaction.set(markerRef, {
      id: operationId, idempotencyKey: operationId, businessId, ownerId,
      eventKind: 'sale', status: 'processed',
      createdAtLocal: '2026-09-22T12:00:00.000Z',
      processedAt: serverTimestamp(), schemaVersion: 3,
    });
    return { idempotent: false };
  });
}

test('recovery transacional aplica R$10, depois R$5, e replay não duplica', async () => {
  const db = env.authenticatedContext(ownerId).firestore();
  assert.deepEqual(await assertSucceeds(recover(db, 'sale-10', 'op-10', 10, 0, 0)),
    { idempotent: false });
  assert.deepEqual(await assertSucceeds(recover(db, 'sale-5', 'op-5', 5, -10, 1)),
    { idempotent: false });
  assert.deepEqual(await assertSucceeds(recover(db, 'sale-10', 'op-10', 10, 0, 0)),
    { idempotent: true });
  const client = (await getDoc(doc(db, 'businesses', businessId, 'clients', clientId))).data();
  assert.equal(client.saldo, -15);
  assert.equal(client.financialVersion, 2);
  assert.equal(client.quantidadeVendas, 2);
  assert.equal((await getDoc(doc(db, 'businesses', businessId, 'balanceEvents', 'credit_sale:sale-10'))).data().balanceDelta, -10);
  assert.equal((await getDoc(doc(db, 'businesses', businessId, 'balanceEvents', 'credit_sale:sale-5'))).data().balanceDelta, -5);
});

test('versão financeira desatualizada aborta sem venda, evento ou marcador', async () => {
  const db = env.authenticatedContext(ownerId).firestore();
  await assert.rejects(recover(db, 'sale-stale', 'op-stale', 7, 0, 0),
    /recovery-precondition-failed/);
  for (const [collection, id] of [
    ['sales', 'sale-stale'], ['balanceEvents', 'credit_sale:sale-stale'],
    ['processedOperations', 'op-stale'],
  ]) assert.equal((await getDoc(doc(db, 'businesses', businessId, collection, id))).exists(), false);
});
