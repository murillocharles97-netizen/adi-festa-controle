'use strict';
// Rota real de recebimento do servidor (fiado-receipt-route) para uma dívida histórica
// regularizada por Espaço, com e sem a conciliação neutra de venda antiga. Firestore em
// memória sobre dados fictícios; nenhuma rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const {decideReceiptRoute} = require('../functions/src/services/fiado-receipt-route');

const B = 'fx-shop', C = 'fx-client', S = 'fx-space', T1 = '2026-11-20T10:00:00.000Z', T2 = '2026-11-20T12:00:00.000Z';
function store({neutral = false, marker = true} = {}) {
  const docs = new Map();
  const put = (col, id, data) => docs.set(`${col}/${id}`, {id, ...data});
  put('clients', C, {businessId: B, workspaceGeneration: 0, saldo: -150, financialVersion: 1, fiadoHistoryVersion: 1, spaceId: S, customerSpaceIds: [S],
    fiadoHistoryActivation: {spaceRegularization: {version: 1, at: T1, operationId: 'fx-reg'}}});
  put('balanceAdjustments', 'fx-reg', {operationId: 'fx-reg', businessId: B, workspaceGeneration: 0, clienteId: C, clientId: C, customerId: C, tipo: 'ajuste_saldo', spaceId: S,
    financialSpaceId: S, status: 'applied', applicationStatus: 'applied', purpose: 'historical_debt', financialAppliedAt: T1, data: T1, createdAt: T1, saldoAnterior: 0, saldoNovo: -150,
    deltaDebtCents: 15000, previousSpaceDebtCents: 0, newSpaceDebtCents: 15000, expectedFinancialVersion: 0, financialVersionAfter: 1, spaceRegularizationVersion: 1});
  put('balanceEvents', 'balance_adjustment:fx-reg', {type: 'balance_adjustment', sourceCollection: 'balanceAdjustments', sourceDocumentId: 'fx-reg', operationId: 'fx-reg', businessId: B,
    workspaceGeneration: 0, clienteId: C, clientId: C, customerId: C, spaceId: S, financialSpaceId: S, status: 'applied', applicationStatus: 'applied', appliedAt: T1, createdAt: T1,
    balanceBefore: 0, balanceDelta: -150, balanceAfter: -150, spaceRegularizationVersion: 1});
  put('processedOperations', 'fx-reg', {status: 'processed', eventKind: 'balance_adjustment', businessId: B, workspaceGeneration: 0, processedAt: T1});
  if (neutral) {
    const id = 'legacy_reconciliation:fx-ride';
    put('balanceAdjustments', id, {operationId: id, businessId: B, workspaceGeneration: 0, clienteId: C, clientId: C, spaceId: S, tipo: 'ajuste_saldo', subtipo: 'reconciliacao_operacao_legada',
      adjustmentType: 'reconciliation', motivo: 'Operação antiga não sincronizada', resolutionStatus: 'resolved_by_reconciliation', resolvedSaleId: 'fx-ride', resolvedOperationId: 'fx-ride-op',
      saldoAnterior: -150, saldoNovo: -150, valor: 0, createdAt: T2, resolvedAt: T2});
    if (marker) put('processedOperations', id, {status: 'processed', eventKind: 'balance_reconciliation', businessId: B, workspaceGeneration: 0, processedAt: T2});
  }
  const snap = row => ({id: row?.id, exists: Boolean(row), data: () => row ? {...row} : undefined});
  const query = (col, filters = [], cap = Infinity) => ({
    where: (field, op, value) => query(col, [...filters, [field, op, value]], cap),
    limit: n => query(col, filters, n), orderBy: () => query(col, filters, cap),
    run: () => [...docs.entries()].filter(([k]) => k.startsWith(col + '/')).map(([, v]) => v)
      .filter(row => filters.every(([f, op, v]) => op === '==' ? row[f] === v : op === 'in' ? v.includes(row[f]) : true)).slice(0, cap),
  });
  const ref = (bid, col, id) => ({path: `${col}/${id}`, col, id, parent: query(col)});
  const tx = {
    get: async target => target.run ? (rows => ({docs: rows.map(snap), size: rows.length, empty: !rows.length}))(target.run()) : snap(docs.get(target.path)),
    getAll: async (...refs) => refs.map(r => snap(docs.get(r.path))),
  };
  const c = {bid: B, uid: 'fx-owner', owner: true, member: {role: 'owner', status: 'active', spaceAccess: 'all'}, business: {workspaceGeneration: 0, ownerId: 'fx-owner'},
    access: {spaceAccess: 'all', canMutate: true}, has: () => true, space: async id => ({id, capabilities: {sales: true, fiado: true}})};
  return {tx, c, ref};
}
const route = s => decideReceiptRoute({...s, clientId: C, spaceId: S, now: new Date('2026-11-21T09:00:00.000Z'), includeAccount: true});

test('recebimento: dívida histórica regularizada tem rota e exigível de R$ 150,00', async () => {
  const result = await route(store());
  assert.ok(result, 'a rota foi decidida');
  assert.equal(JSON.stringify(result).includes('15000'), true, JSON.stringify(result).slice(0, 400));
});

test('recebimento: depois da conciliação neutra comprovada, a mesma rota e o mesmo exigível', async () => {
  const before = await route(store()), after = await route(store({neutral: true}));
  assert.equal(JSON.stringify(after).includes('15000'), true, JSON.stringify(after).slice(0, 400));
  assert.equal(after.route ?? after.kind ?? '', before.route ?? before.kind ?? '');
});

test('recebimento: conciliação sem marcador processado continua bloqueada para revisão', async () => {
  const result = await route(store({neutral: true, marker: false}));
  assert.equal(result.mode, 'blocked');
  assert.equal(result.reason, 'history_review');
});
