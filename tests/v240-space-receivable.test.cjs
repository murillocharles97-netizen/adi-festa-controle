'use strict';
// V240 — "A receber" of one space uses the canonical per-space receivable.
// Synthetic data only.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {harness} = require('./helpers/owner-receipt-v219.cjs');
const sleep = () => new Promise(resolve => setTimeout(resolve, 30));
const ADI = 'business_adi-festa', TAXI = 'space-taxi-qa';

function fixture() {
  const h = harness({businessId: 'adi-festa'}), {w} = h, db = h.rows();
  w.Router = {atual: () => 'home'}; w.scrollTo = () => {};
  w.Utils = {...w.Utils, escapar: String, dinheiro: n => String(n)};
  w.Cobrancas = {ultimaCliente: () => null, historicoCliente: () => []};
  w.IntersectionObserver = class { observe() {} disconnect() {} };
  w.matchMedia = () => ({matches: false, addEventListener() {}});
  w.DB.readForView = w.DB.carregar;
  db.vendas = [];
  db.clientes = [{id: 'pai', businessId: 'adi-festa', nome: 'Pessoa QA', ativo: true, saldo: -1889, financialVersion: 1,
    spaceId: TAXI, customerSpaceIds: [TAXI], fiadoHistoryVersion: 1,
    fiadoHistoryActivation: {spaceRegularization: {version: 1, operationId: 'qa-op'}}}];
  for (const file of ['spaces', 'clientes']) w.eval(fs.readFileSync('js/' + file + '.js', 'utf8'));
  w.SpaceContext.setSpaces([
    {id: ADI, name: 'Loja QA', businessId: 'adi-festa', linkedBusinessId: 'adi-festa', type: 'business', active: true, status: 'active', ownerUid: 'qa-owner', capabilities: {sales: true, finance: true}},
    {id: TAXI, name: 'Táxi QA', businessId: 'adi-festa', linkedBusinessId: null, type: 'other', active: true, status: 'active', ownerUid: 'qa-owner',
      capabilities: {sales: true, finance: true}},
  ]);
  w.BusinessContext.canAccessSpace = id => [ADI, TAXI].includes(id);
  w.SpaceContext.selectActive(TAXI);
  let read;
  w.FirebaseCallable = async (name, data) => { if (read) return read(name, data); throw Error('Unexpected remote read'); };
  return {h, w, db, setRead: fn => read = fn, close: async () => { await sleep(); h.close(); }};
}
const account = (w, entries) => ({version: 2, historyProofVersion: 1, clientId: 'pai', asOf: w.InstallmentPlan.today(),
  financialVersion: 1, creditCents: 0, hasInstallments: entries.some(e => Number.isInteger(e.number)),
  dueCents: entries.filter(e => e.dueDate <= w.InstallmentPlan.today()).reduce((n, e) => n + e.remainingCents, 0),
  futureCents: entries.filter(e => e.dueDate > w.InstallmentPlan.today()).reduce((n, e) => n + e.remainingCents, 0),
  totalCents: entries.reduce((n, e) => n + e.remainingCents, 0), entries});

test('regularized balance is "a conferir" until the server confirms it, then counts only in its own space', async () => {
  const f = fixture();
  try {
    const before = f.w.Clientes.spaceReceivable(TAXI);
    assert.equal(before.dueCents, 0); assert.equal(before.partial, true); assert.deepEqual([...before.unknownIds], ['pai']);
    const today = f.w.InstallmentPlan.today();
    f.setRead(async (name, data) => {
      assert.equal(name, 'getOperationalSyncReceipt'); assert.equal(data.kind, 'fiado_account');
      return {data: {businessId: 'adi-festa', workspaceGeneration: 0, account: account(f.w, [
        {spaceId: TAXI, remainingCents: 188900, dueDate: today, historyEventId: 'balance_adjustment:qa-op', number: null, saleId: null}])}};
    });
    await f.w.InstallmentCredit.refresh('pai'); f.w.Clientes.prepareList();
    const after = f.w.Clientes.spaceReceivable(TAXI);
    assert.equal(after.dueCents, 188900); assert.equal(after.futureCents, 0); assert.equal(after.partial, false);
    assert.equal(f.w.Clientes.spaceReceivable(ADI).dueCents, 0, 'never redirected to another space');
  } finally { await f.close(); }
});

test('future installments are kept apart from the exigível amount', async () => {
  const f = fixture();
  try {
    const today = f.w.InstallmentPlan.today(), next = f.w.InstallmentPlan.addMonths?.(today, 1) || '2099-01-01';
    f.db.clientes[0].saldo = -300;
    f.setRead(async () => ({data: {businessId: 'adi-festa', workspaceGeneration: 0, account: account(f.w, [
      {spaceId: TAXI, remainingCents: 10000, dueDate: today, historyEventId: 'e1', number: null, saleId: null},
      {spaceId: TAXI, remainingCents: 20000, dueDate: next, historyEventId: null, number: 2, saleId: 's1'}])}}));
    await f.w.InstallmentCredit.refresh('pai'); f.w.Clientes.prepareList();
    const r = f.w.Clientes.spaceReceivable(TAXI);
    assert.equal(r.dueCents, 10000); assert.equal(r.futureCents, 20000);
  } finally { await f.close(); }
});

test('profiles without owner proof get no canonical value (dashboard keeps its previous fallback)', async () => {
  const f = fixture();
  try {
    const role = f.w.BusinessContext.get; f.w.BusinessContext.get = () => ({...role(), role: 'seller'});
    assert.equal(f.w.Clientes.spaceReceivable(TAXI), null);
  } finally { await f.close(); }
});

function dashboard({receivable, sales = []}) {
  const source = fs.readFileSync('js/desktop-dashboard.js', 'utf8');
  const db = {vendas: sales, pagamentos: [], clientes: [], produtos: [], campanhas: [], progressosCampanha: [], recompensas: []};
  const sandbox = {DB: {carregar: () => db}, Utils: {hoje: () => false, dinheiro: v => `R$ ${Number(v).toFixed(2)}`, escapar: String},
    OperationMode: {enabled: k => k === 'creditSales'},
    SpaceContext: {ALL_SPACES: 'all_spaces', contextualData: d => ({...d, spaceSelectionId: TAXI})},
    Clientes: {spaceReceivable: id => (assert.equal(id, TAXI), receivable)}, document: {querySelector: () => null}, navigator: {onLine: true}};
  sandbox.window = sandbox; vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const api = sandbox.DesktopDashboard;
  return {render: () => api.render(), aggregate: () => api.aggregate(db)};
}

test('dashboard of one space shows the canonical receivable, never the Fiado-sales-only sum', () => {
  const fiado = {id: 'v1', spaceId: TAXI, status: 'fiado', formaPagamento: 'fiado', valorFinal: 180, data: '2026-11-19T12:00:00.000Z'};
  const d = dashboard({receivable: {dueCents: 188900, futureCents: 5000, partial: false, unknown: 0, unknownIds: []}, sales: [fiado]});
  const view = d.aggregate();
  assert.equal(view.openBalance, 1889); assert.equal(view.receivableFuture, 50);
  const html = d.render();
  assert.match(html, /A receber/); assert.match(html, /R\$ 1889\.00/); assert.match(html, /parcelas futuras/);
  // Historical debt is not revenue nor cash: the receivable never changes "Recebido".
  assert.equal(view.receivedToday, 0);
});

test('dashboard says "a conferir" when an account of the space is not proven', () => {
  const d = dashboard({receivable: {dueCents: 0, futureCents: 0, partial: true, unknown: 1, unknownIds: ['pai']}});
  assert.match(d.render(), /1 conta\(s\) a conferir no servidor/);
});

test('without canonical proof the previous Fiado-sales fallback is unchanged', () => {
  const fiado = {id: 'v1', spaceId: TAXI, status: 'fiado', formaPagamento: 'fiado', valorFinal: 180, data: '2026-11-19T12:00:00.000Z'};
  assert.equal(dashboard({receivable: null, sales: [fiado]}).aggregate().openBalance, 180);
});
