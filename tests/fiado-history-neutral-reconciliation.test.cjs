'use strict';
// Dívida histórica regularizada por Espaço + conciliação neutra de venda antiga
// (legacy_reconciliation, valor 0) + recebimento. Módulos reais do servidor e dados
// fictícios no mesmo formato dos documentos gravados pelos serviços.
const test = require('node:test');
const assert = require('node:assert/strict');
const History = require('../functions/src/shared/fiado-history-account');

const B = 'fx-shop', C = 'fx-client', S = 'fx-space', T1 = '2026-11-20T10:00:00.000Z', T2 = '2026-11-20T12:00:00.000Z', T3 = '2026-11-21T09:00:00.000Z';
const day = '2026-11-21';
function base({saldo = -150, financialVersion = 1} = {}) {
  const client = {id: C, businessId: B, workspaceGeneration: 0, saldo, financialVersion, fiadoHistoryVersion: 1,
    fiadoHistoryActivation: {spaceRegularization: {version: 1, at: T1, operationId: 'fx-reg'}}};
  const regularization = {id: 'fx-reg', operationId: 'fx-reg', businessId: B, workspaceGeneration: 0, clienteId: C, clientId: C, customerId: C,
    tipo: 'ajuste_saldo', spaceId: S, financialSpaceId: S, status: 'applied', applicationStatus: 'applied', purpose: 'historical_debt',
    financialAppliedAt: T1, data: T1, createdAt: T1, saldoAnterior: 0, saldoNovo: -150, deltaDebtCents: 15000, previousSpaceDebtCents: 0,
    newSpaceDebtCents: 15000, expectedFinancialVersion: 0, financialVersionAfter: 1, spaceRegularizationVersion: 1};
  const event = {id: 'balance_adjustment:fx-reg', type: 'balance_adjustment', sourceCollection: 'balanceAdjustments', sourceDocumentId: 'fx-reg',
    operationId: 'fx-reg', businessId: B, workspaceGeneration: 0, clienteId: C, clientId: C, customerId: C, spaceId: S, financialSpaceId: S,
    status: 'applied', applicationStatus: 'applied', appliedAt: T1, createdAt: T1, data: T1, balanceBefore: 0, balanceDelta: -150, balanceAfter: -150, spaceRegularizationVersion: 1};
  const marker = {id: 'fx-reg', status: 'processed', eventKind: 'balance_adjustment', businessId: B, workspaceGeneration: 0, processedAt: T1, spaceRegularizationVersion: 1};
  return {client, collections: {sales: [], payments: [], balanceAdjustments: [regularization], balanceEvents: [event], paymentAllocations: [], processedOperations: [marker]}};
}
const neutral = (extra = {}) => ({id: 'legacy_reconciliation:fx-ride', operationId: 'legacy_reconciliation:fx-ride', businessId: B, workspaceGeneration: 0,
  clienteId: C, clientId: C, spaceId: S, tipo: 'ajuste_saldo', subtipo: 'reconciliacao_operacao_legada', adjustmentType: 'reconciliation',
  motivo: 'Operação antiga não sincronizada', resolutionStatus: 'resolved_by_reconciliation', resolvedSaleId: 'fx-ride', resolvedOperationId: 'fx-ride-op',
  saldoAnterior: -150, saldoNovo: -150, valor: 0, createdAt: T2, resolvedAt: T2, ...extra});
function withPayment(state, amount = 50) {
  const before = state.client.saldo, after = before + amount;
  state.client = {...state.client, saldo: after, financialVersion: state.client.financialVersion + 1};
  state.collections.payments.push({id: 'fx-pay', operationId: 'fx-pay', businessId: B, workspaceGeneration: 0, clienteId: C, clientId: C, spaceId: S, financialSpaceId: S,
    valor: amount, tipo: 'pagamento', status: 'applied', applicationStatus: 'applied', financialAppliedAt: T3, data: T3, createdAt: T3, saldoAnterior: before, saldoNovo: after});
  state.collections.balanceEvents.push({id: 'payment_received:fx-pay', type: 'payment_received', sourceCollection: 'payments', sourceDocumentId: 'fx-pay', operationId: 'fx-pay',
    businessId: B, workspaceGeneration: 0, clientId: C, customerId: C, spaceId: S, status: 'applied', appliedAt: T3, createdAt: T3, balanceDelta: amount, amount});
  state.collections.processedOperations.push({id: 'fx-pay', status: 'processed', eventKind: 'payment', businessId: B, workspaceGeneration: 0, processedAt: T3});
  return state;
}
const project = state => History.project({businessId: B, generation: 0, client: state.client, collections: state.collections, complete: true, stable: true}, day);

test('dívida histórica regularizada por Espaço é exigível no Espaço de origem', () => {
  const account = project(base());
  assert.deepEqual([account.dueCents, account.futureCents, account.totalCents, account.creditCents], [15000, 0, 15000, 0]);
  assert.deepEqual(account.entries.map(e => [e.spaceId, e.remainingCents]), [[S, 15000]]);
});

test('conciliação neutra de venda antiga não bloqueia mais a conta (causa do "A conferir")', () => {
  const state = base(); state.collections.balanceAdjustments.push(neutral());
  const account = project(state);
  assert.equal(account.dueCents, 15000, 'mesmo valor: a conciliação não move saldo');
});

test('recebimento parcial depois da conciliação neutra reduz o exigível uma única vez', () => {
  const state = withPayment((() => { const s = base(); s.collections.balanceAdjustments.push(neutral()); return s; })(), 50);
  const account = project(state);
  assert.equal(account.dueCents, 10000);
  assert.equal(account.financialVersion, 2);
});

test('qualquer ajuste que move saldo continua exigindo evento confirmado', () => {
  const cases = {
    'conciliação com valor': neutral({valor: -10, saldoNovo: -160}),
    'conciliação com saldo diferente': neutral({saldoNovo: -140}),
    'identificador fora do padrão': neutral({id: 'fx-manual', operationId: 'fx-manual'}),
    'sem resolução auditada': neutral({resolutionStatus: 'pending'}),
    'ajuste comum sem evento': {id: 'fx-manual-2', operationId: 'fx-manual-2', businessId: B, workspaceGeneration: 0, clienteId: C, tipo: 'ajuste_saldo', valor: 0, saldoAnterior: -150, saldoNovo: -150, createdAt: T2},
  };
  for (const [name, adjustment] of Object.entries(cases)) {
    const state = base(); state.collections.balanceAdjustments.push(adjustment);
    assert.throws(() => project(state), /source-without-confirmed-effect/, name);
  }
});

test('saldo cadastral diferente da cadeia de eventos continua recusado', () => {
  const state = base({saldo: -200}); state.collections.balanceAdjustments.push(neutral());
  assert.throws(() => project(state), /ledger-current-balance-mismatch/);
});
