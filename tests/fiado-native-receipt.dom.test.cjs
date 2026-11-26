'use strict';
// Etapa 1 no aparelho: um recebimento por Espaço aloca às vendas na ordem da conta, marca a
// venda paga e confirma os pontos da campanha que esperavam o pagamento. Recebimento parcial
// não confirma. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict');
const {harness} = require('./helpers/owner-receipt-v219.cjs');
const Plan = require('../functions/src/shared/installment-plan');

function fixture() {
  const h = harness({businessId: 'qa-business', spaceId: 'qa-space', uid: 'qa-owner'}), w = h.w, rows = h.rows(), day = Plan.today();
  const client = {id: 'qa-native', businessId: 'qa-business', nome: 'Pessoa fictícia', ativo: true, saldo: -100, financialVersion: 2, fiadoHistoryVersion: 1,
    fiadoHistoryActivation: {spaceRegularization: {version: 1, origin: 'native'}}};
  const sale = (id, value, at) => ({id, businessId: 'qa-business', spaceId: 'qa-space', financialSpaceId: 'qa-space', clienteId: client.id, clientId: client.id, status: 'fiado', formaPagamento: 'fiado',
    valorFinal: value, valorTotal: value, creditOriginalAmount: value, creditPaidAmount: 0, creditRemainingAmount: value, creditSettled: false, data: at, createdAt: at, financialAppliedAt: at,
    itens: [{produtoId: 'qa-product', nome: 'Item', quantidade: 1, precoFinalUnitario: value, subtotal: value}]});
  const s1 = sale('qa-s1', 70, day + 'T10:00:00.000Z'), s2 = sale('qa-s2', 30, day + 'T11:00:00.000Z');
  const campaign = w.CampaignEngineV2.normalizeCampaign({id: 'qa-points', name: 'Pontos', type: 'points', rule: {pointsAmount: 1, pointsAward: 1}, startsAt: '2026-01-01T00:00:00.000Z'});
  Object.assign(rows, {clientes: [client], vendas: [s1, s2], pagamentos: [], alocacoesPagamento: [], campanhas: [campaign], progressosCampanha: [], eventosCampanha: [], resgatesCampanha: []});
  w.CampaignEngineV2.applySale(rows, s1); w.CampaignEngineV2.applySale(rows, s2);
  w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
  const route = remaining => {
    const entries = remaining.map(([s, cents]) => ({saleId: s.id, number: null, historyEventId: 'credit_sale:' + s.id, dueDate: day, createdAt: s.data, remainingCents: cents, spaceId: 'qa-space'}));
    const total = entries.reduce((n, e) => n + e.remainingCents, 0), c = rows.clientes[0];
    const account = {version: 2, historyProofVersion: 1, clientId: c.id, asOf: day, financialVersion: c.financialVersion, dueCents: total, futureCents: 0, totalCents: total, creditCents: 0,
      hasInstallments: false, entries, scopedReceiptVersion: 1};
    return {receiptRouteVersion: 1, businessId: 'qa-business', workspaceGeneration: 0, clientId: c.id, spaceId: 'qa-space', mode: 'space', quoteHash: 'a'.repeat(64),
      financialVersion: c.financialVersion, asOf: day, dueCents: total, futureCents: 0, totalCents: total, scopedReceiptVersion: 1, scopedAccount: account};
  };
  const receive = (reais, r) => w.Fiados.receber(client.id, reais, 'Pix fictício de QA', {spaceId: 'qa-space', paymentMethod: 'pix', receiptRoute: r, fiadoAccount: r.scopedAccount});
  return {h, w, rows: () => h.rows(), s1, s2, route, receive};
}

test('recebimento parcial por Espaço aloca à venda mais antiga sem confirmar os pontos', () => {
  const f = fixture();
  try {
    const p = f.receive(50, f.route([[f.s1, 7000], [f.s2, 3000]]));
    const sale = f.rows().vendas.find(s => s.id === f.s1.id);
    assert.deepEqual([sale.creditPaidAmount, sale.creditRemainingAmount, sale.creditSettled], [50, 20, false]);
    assert.deepEqual([p.legacyAmount, p.allocatedAmount], [0, 50]);
    assert.equal(f.rows().eventosCampanha.filter(e => e.transition === 'confirmed').length, 0, 'venda ainda não paga');
  } finally { f.h.close(); }
});

test('recebimento que quita a venda confirma os pontos; a venda seguinte recebe o restante', () => {
  const f = fixture();
  try {
    const p = f.receive(80, f.route([[f.s1, 7000], [f.s2, 3000]]));
    const [a, b] = [f.s1, f.s2].map(s => f.rows().vendas.find(x => x.id === s.id));
    assert.deepEqual([a.creditSettled, a.creditPaidAmount], [true, 70]);
    assert.deepEqual([b.creditSettled, b.creditPaidAmount, b.creditRemainingAmount], [false, 10, 20]);
    assert.deepEqual(JSON.parse(JSON.stringify(p.allocations.map(x => [x.saleId, x.amount, x.settledSale]))), [[f.s1.id, 70, true], [f.s2.id, 10, false]]);
    const confirmed = f.rows().eventosCampanha.filter(e => e.transition === 'confirmed');
    assert.deepEqual(JSON.parse(JSON.stringify(confirmed.map(e => e.saleId))), [f.s1.id], 'só a venda paga confirma pontos');
    const progress = f.rows().progressosCampanha[0];
    assert.deepEqual([progress.availablePoints, progress.pendingPoints], [70, 30]);
  } finally { f.h.close(); }
});
