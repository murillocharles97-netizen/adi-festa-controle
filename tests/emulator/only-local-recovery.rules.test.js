const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, runTransaction, setDoc, serverTimestamp } = require('firebase/firestore');

const projectId = 'adi-festa-variations-test';
const businessId = 'only-local-recovery-rules';
const ownerId = 'recovery-owner';
const clientId = 'recovery-client';
const reconciliationClientId = 'legacy-reconciliation-client';
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
    await setDoc(doc(db, 'businesses', businessId, 'clients', reconciliationClientId), {
      id: reconciliationClientId, businessId, ownerId, nome: 'Bruna controlada',
      saldo: 0, openBalance: 0, financialVersion: 0, totalComprado: 0,
      quantidadeVendas: 0,
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

async function reconcileLegacy(db, saleId, originalOperationId, correctDebt) {
  const base = ['businesses', businessId];
  const operationId = `legacy_reconciliation:${saleId}`;
  const adjustmentRef = doc(db, ...base, 'balanceAdjustments', operationId);
  const markerRef = doc(db, ...base, 'processedOperations', operationId);
  const clientRef = doc(db, ...base, 'clients', reconciliationClientId);
  const saleRef = doc(db, ...base, 'sales', saleId);
  const originalEffectRef = doc(db, ...base, 'balanceEvents', `credit_sale:${saleId}`);
  const adjustmentEffectRef = doc(db, ...base, 'balanceEvents', `balance_adjustment:${operationId}`);
  return runTransaction(db, async (transaction) => {
    const [adjustment, marker, client, sale, originalEffect, adjustmentEffect] = await Promise.all([
      transaction.get(adjustmentRef), transaction.get(markerRef), transaction.get(clientRef),
      transaction.get(saleRef), transaction.get(originalEffectRef),
      transaction.get(adjustmentEffectRef),
    ]);
    if (adjustment.exists()) {
      assert.equal(adjustment.data().resolvedSaleId, saleId);
      assert.equal(adjustment.data().resolvedOperationId, originalOperationId);
      return { idempotent: true };
    }
    if (marker.exists() || sale.exists() || originalEffect.exists() || adjustmentEffect.exists() ||
      !client.exists()) throw new Error('reconciliation-precondition-failed');
    const before = client.data().saldo;
    const after = -correctDebt;
    const nextVersion = client.data().financialVersion + 1;
    transaction.set(clientRef, {
      saldo: after, openBalance: correctDebt, financialVersion: nextVersion,
      financialRevision: operationId, updatedAt: serverTimestamp(),
    }, { merge: true });
    transaction.set(adjustmentRef, {
      id: operationId, operationId, idempotencyKey: operationId,
      businessId, ownerId, actorUid: ownerId,
      clienteId: reconciliationClientId, clientId: reconciliationClientId,
      clienteNome: 'Bruna controlada', tipo: 'ajuste_saldo',
      subtipo: 'reconciliacao_operacao_legada', adjustmentType: 'reconciliation',
      reasonCode: 'legacy_sale_not_synced', source: 'owner_manual_reconciliation',
      motivo: 'Operação antiga não sincronizada', saldoAnterior: before,
      saldoNovo: after, valor: after - before, expectedFinancialVersion: 0,
      financialVersionAfter: nextVersion, resolvedSaleId: saleId,
      resolvedOperationId: originalOperationId,
      resolvedCustomerId: reconciliationClientId, resolvedSaleAmount: correctDebt,
      resolutionStatus: 'resolved_by_reconciliation', resolvedAt: serverTimestamp(),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), schemaVersion: 3,
    });
    transaction.set(adjustmentEffectRef, {
      id: `balance_adjustment:${operationId}`, operationId,
      idempotencyKey: `balance_adjustment:${operationId}`, businessId, ownerId,
      customerId: reconciliationClientId, clientId: reconciliationClientId,
      sourceCollection: 'balanceAdjustments', sourceDocumentId: operationId,
      type: 'balance_adjustment', direction: 'debit', amount: correctDebt,
      balanceDelta: after - before, eventKind: 'balance_reconciliation',
      reasonCode: 'legacy_sale_not_synced', source: 'owner_manual_reconciliation',
      status: 'applied', appliedAt: serverTimestamp(), createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(), schemaVersion: 3,
    });
    transaction.set(markerRef, {
      id: operationId, idempotencyKey: operationId, businessId, ownerId,
      eventKind: 'balance_reconciliation', status: 'processed',
      createdAtLocal: '2026-09-22T14:20:00.000Z',
      processedAt: serverTimestamp(), schemaVersion: 3,
    });
    return { idempotent: false };
  });
}

test('dois aparelhos conciliam uma vez e a próxima venda parte de R$26 para R$51', async () => {
  const deviceA = env.authenticatedContext(ownerId, { device: 'a' }).firestore();
  const deviceB = env.authenticatedContext(ownerId, { device: 'b' }).firestore();
  const oldSaleId = 'legacy-bruna-26';
  const oldOperationId = 'legacy-bruna-operation';
  assert.deepEqual(await assertSucceeds(reconcileLegacy(
    deviceA, oldSaleId, oldOperationId, 26)), { idempotent: false });
  assert.deepEqual(await assertSucceeds(reconcileLegacy(
    deviceB, oldSaleId, oldOperationId, 26)), { idempotent: true });

  const base = ['businesses', businessId];
  const newSaleId = 'new-bruna-25';
  const newOperationId = 'new-bruna-operation';
  await assertSucceeds(runTransaction(deviceB, async (transaction) => {
    const clientRef = doc(deviceB, ...base, 'clients', reconciliationClientId);
    const resolutionRef = doc(deviceB, ...base, 'balanceAdjustments',
      `legacy_reconciliation:${oldSaleId}`);
    const saleRef = doc(deviceB, ...base, 'sales', newSaleId);
    const effectRef = doc(deviceB, ...base, 'balanceEvents', `credit_sale:${newSaleId}`);
    const markerRef = doc(deviceB, ...base, 'processedOperations', newOperationId);
    const [client, resolution, sale, effect, marker] = await Promise.all([
      transaction.get(clientRef), transaction.get(resolutionRef), transaction.get(saleRef),
      transaction.get(effectRef), transaction.get(markerRef),
    ]);
    assert.equal(resolution.data().resolutionStatus, 'resolved_by_reconciliation');
    assert.equal(client.data().saldo, -26);
    assert.equal(sale.exists() || effect.exists() || marker.exists(), false);
    transaction.set(saleRef, {
      id: newSaleId, businessId, ownerId, spaceId, operationId: newOperationId,
      idempotencyKey: newOperationId, clienteId: reconciliationClientId,
      formaPagamento: 'fiado', status: 'applied', valorFinal: 25,
      saldoAnterior: -26, saldoAtual: -51, financialVersionAnterior: 1,
      applicationStatus: 'applied', financialAppliedAt: serverTimestamp(),
      syncConfirmedAt: serverTimestamp(), schemaVersion: 3,
    });
    transaction.set(clientRef, {
      saldo: -51, openBalance: 51, financialVersion: 2,
      totalComprado: 25, quantidadeVendas: 1, updatedAt: serverTimestamp(),
    }, { merge: true });
    transaction.set(effectRef, {
      id: `credit_sale:${newSaleId}`, operationId: newOperationId,
      idempotencyKey: `credit_sale:${newSaleId}`, businessId, ownerId,
      customerId: reconciliationClientId, clientId: reconciliationClientId,
      saleId: newSaleId, sourceCollection: 'sales', sourceDocumentId: newSaleId,
      type: 'credit_sale', direction: 'debit', amount: 25, balanceDelta: -25,
      eventKind: 'sale', status: 'applied', appliedAt: serverTimestamp(), schemaVersion: 3,
    });
    transaction.set(markerRef, {
      id: newOperationId, idempotencyKey: newOperationId, businessId, ownerId,
      eventKind: 'sale', status: 'processed',
      createdAtLocal: '2026-09-22T14:30:00.000Z', processedAt: serverTimestamp(),
      schemaVersion: 3,
    });
  }));

  const [clientFromA, clientFromB, oldSale, adjustment, newSale] = await Promise.all([
    getDoc(doc(deviceA, ...base, 'clients', reconciliationClientId)),
    getDoc(doc(deviceB, ...base, 'clients', reconciliationClientId)),
    getDoc(doc(deviceA, ...base, 'sales', oldSaleId)),
    getDoc(doc(deviceA, ...base, 'balanceAdjustments', `legacy_reconciliation:${oldSaleId}`)),
    getDoc(doc(deviceA, ...base, 'sales', newSaleId)),
  ]);
  assert.equal(clientFromA.data().saldo, -51);
  assert.equal(clientFromB.data().saldo, -51);
  assert.equal(oldSale.exists(), false);
  assert.equal(adjustment.data().saldoAnterior, 0);
  assert.equal(adjustment.data().saldoNovo, -26);
  assert.equal(newSale.data().saldoAnterior, -26);
  assert.equal(newSale.data().saldoAtual, -51);
});
