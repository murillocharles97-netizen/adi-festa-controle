'use strict';

const {HttpsError} = require('firebase-functions/v2/https');
const {status} = require('./payment-recovery-policy');

const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const incomplete = operationId => ({confirmed: false, status: 'incomplete_evidence', operationId});

async function recognizePreservedPayment({tx, c, d, ref}) {
  if (!c.owner || c.business.ownerId !== c.uid)
    throw new HttpsError('permission-denied', 'A conferência exige o proprietário da operação.');
  const id = d.operationId;
  const read = (collection, key) => tx.get(ref(c.bid, collection, key));
  const scoped = doc => doc?.businessId === c.bid &&
    (doc.workspaceGeneration ?? 0) === (c.business.workspaceGeneration ?? 0);
  if (Object.keys(d).some(key => !['operationId', 'clientId', 'originalPayloadHash', 'businessId', 'workspaceGeneration'].includes(key)) ||
      !uuid.test(id) || !uuid.test(d.clientId) || !hash.test(d.originalPayloadHash))
    throw new HttpsError('invalid-argument', 'Identificação do original incompleta.');

  const receipt = await status({tx, c, d: {...d, paymentId: id}, ref});
  if (!receipt.confirmed) return receipt;
  const auditId = 'payment_reconciliation_' + id;
  if (receipt.auditId !== auditId || receipt.paymentMethod !== 'pix') return incomplete(id);

  const eventId = 'payment_received:' + id;
  const [payment, marker, audit, client, event] = (await Promise.all([
    read('payments', id), read('processedOperations', id), read('auditLogs', auditId),
    read('clients', d.clientId), read('balanceEvents', eventId)
  ])).map(snap => snap.data());
  const recovery = marker.paymentRecovery;
  if (!scoped(audit) || !scoped(client) || client.deletedAt || client.active === false ||
      audit.type !== 'original_payment_reconciliation' || audit.auditId !== auditId ||
      audit.operationId !== id || audit.clientId !== d.clientId || audit.originalActorUid !== c.uid ||
      audit.localExecution?.channel !== 'local-admin' || !uuid.test(audit.localExecution.id) ||
      audit.originalDate !== receipt.paymentDate || audit.method !== receipt.paymentMethod ||
      !payment.spaceId || audit.spaceId !== payment.spaceId || event.spaceId !== payment.spaceId ||
      payment.id !== id || payment.idempotencyKey !== id || marker.id !== id || marker.operationId !== id ||
      event.id !== eventId || event.sourceCreatedAt !== receipt.paymentDate ||
      recovery.version !== 1 || recovery.originalPayloadHash !== d.originalPayloadHash ||
      audit.originalPayloadHash !== d.originalPayloadHash || !hash.test(audit.originalFileHash) ||
      !hash.test(audit.originalPacketHash) || !hash.test(audit.reviewHash) ||
      !hash.test(audit.effectivePayloadHash) || audit.effectivePayloadHash !== recovery.effectivePayloadHash)
    return incomplete(id);

  const {before, after, allocations} = audit;
  if (!Number.isSafeInteger(before?.financialVersion) || after?.financialVersion !== before.financialVersion + 1 ||
      payment.expectedFinancialVersion !== before.financialVersion || payment.financialVersionAfter !== after.financialVersion ||
      payment.saldoAnterior !== before.saldo || payment.expectedBalance !== before.saldo ||
      payment.saldoNovo !== after.saldo || client.saldo !== after.saldo || client.financialVersion !== after.financialVersion ||
      !Number.isFinite(before.saldo) || !Number.isFinite(after.saldo) ||
      Math.round(after.saldo * 100) - Math.round(before.saldo * 100) !== Math.round(receipt.amount * 100) ||
      audit.amount !== receipt.amount || audit.legacyAmount !== payment.legacyAmount ||
      audit.allocatedAmount !== payment.allocatedAmount || !Array.isArray(allocations) || !allocations.length ||
      allocations.length !== payment.allocations.length ||
      new Set(allocations.map(row => row?.saleId)).size !== allocations.length ||
      !allocations.every(row => row?.settledSale === true && uuid.test(row.saleId) &&
        payment.allocations.some(p => p.saleId === row.saleId && p.amount === row.amount)))
    return incomplete(id);

  const checkAliases = async (collection, fields, ids) => {
    const docs = await Promise.all(fields.map(field =>
      tx.get(ref(c.bid, collection, '_').parent.where(field, '==', id).limit(ids.length + 1))));
    return docs.every(result => result.docs.every(doc => ids.includes(doc.id)));
  };
  const [sales, rows, duplicateEvent, ...unique] = await Promise.all([
    Promise.all(allocations.map(row => read('sales', row.saleId))),
    Promise.all(allocations.map(row => read('paymentAllocations', id + '__' + row.saleId))),
    read('balanceEvents', 'credit_payment:' + id),
    checkAliases('payments', ['id', 'operationId', 'idempotencyKey'], [id]),
    checkAliases('balanceEvents', ['operationId', 'sourceDocumentId'], [eventId]),
    checkAliases('processedOperations', ['id', 'operationId'], [id]),
    checkAliases('paymentAllocations', ['operationId'], allocations.map(row => id + '__' + row.saleId)),
    checkAliases('auditLogs', ['operationId'], [auditId]),
  ]);
  if (duplicateEvent.exists || !unique.every(Boolean) || !allocations.every(({saleId, amount}, index) => {
    const sale = sales[index].data(), row = rows[index].data();
    return scoped(sale) && scoped(row) && sale.id === saleId && sale.clienteId === d.clientId &&
      sale.formaPagamento === 'fiado' && sale.active !== false && !sale.deletedAt && !sale.cancelledAt &&
      !sale.desfeita && !sale.financialReversedAt && sale.creditSettled === true && sale.creditRemainingAmount === 0 &&
      sale.creditPaidAmount === amount && row.operationId === id && row.amount === amount && row.settledSale === true;
  })) return incomplete(id);

  return {...receipt, recognitionVersion: 1, reviewHash: audit.reviewHash, spaceId: payment.spaceId,
    allocationCount: allocations.length, before, after};
}

module.exports = {recognizePreservedPayment};
