const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/activity-center.js', 'utf8');
const syncSource = fs.readFileSync('js/firebase/sync.js', 'utf8');
const repositorySource = fs.readFileSync('js/firebase/firestore-repository.js', 'utf8');
const functionsSource = fs.readFileSync('functions/src/index.js', 'utf8');

function sandbox(data, pending = []) {
  const value = {
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    document: { querySelector: () => null, querySelectorAll: () => [] },
    DB: { carregar: () => data },
    SyncFirebase: { pendingActivityEvents: () => pending },
    Utils: { escapar: (input) => String(input ?? '') },
  };
  value.window = value;
  vm.createContext(value);
  vm.runInContext(source, value, { filename: 'activity-center.js' });
  return value;
}

test('cloud vence pendência local pelo eventId e operationId sem duplicar', () => {
  const date = '2026-09-22T19:15:00.957Z';
  const data = {
    vendas: [{ id: 'sale-1', operationId: 'operation-1', clienteId: 'client-1', clienteNome: 'Bruna', valorFinal: 25, formaPagamento: 'fiado', data: date }],
    pagamentos: [], movimentacoes: [], movimentacoesEstoque: [], eventosCampanha: [],
    customerSubscriptionEvents: [], catalogOrders: [], clientes: [], produtos: [], campanhas: [],
  };
  const app = sandbox(data, [{ eventId: 'sale:sale-1', operationId: 'operation-1', status: 'pending' }]);
  const cloud = [{
    eventId: 'sale:sale-1', type: 'sale', entityId: 'sale-1', operationId: 'operation-1',
    createdAt: date, status: 'confirmed', spaceId: 'store-1', actorUid: 'cashier-1',
    summary: { customerId: 'client-1', customerName: 'Bruna', amount: 25, paymentMethod: 'fiado' },
  }];
  const events = app.ActivityCenter.events(cloud);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'sale:sale-1');
  assert.notEqual(events[0].status, 'Aguardando sincronização');
  assert.equal(events[0].raw.actorUid, 'cashier-1');
  assert.equal(events[0].raw.spaceId, 'store-1');
});

test('venda offline permanece visível como aguardando sincronização', () => {
  const data = {
    vendas: [{ id: 'sale-offline', operationId: 'op-offline', clienteNome: 'Japa', valorFinal: 10, formaPagamento: 'fiado', data: '2026-09-22T19:20:32.159Z' }],
    pagamentos: [], movimentacoes: [], movimentacoesEstoque: [], eventosCampanha: [],
    customerSubscriptionEvents: [], catalogOrders: [], clientes: [], produtos: [], campanhas: [],
  };
  const app = sandbox(data, [{ eventId: 'sale:sale-offline', operationId: 'op-offline', status: 'pending' }]);
  const events = app.ActivityCenter.events([]);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'Aguardando sincronização');
  assert.equal(events[0].statusTone, 'warning');
});

test('listener do Histórico é limitado, paginado e não integra o pull global', () => {
  assert.match(repositorySource, /orderBy\("createdAt", "desc"\), limit\(max\)/);
  assert.match(syncSource, /subscribeRecentActivityEvents/);
  assert.match(syncSource, /activityEventsRepository\.listPage/);
  assert.match(source, /loadMore\(50\)/);
  assert.doesNotMatch(syncSource, /activityEvents:\s*\{\s*key:/);
});

test('vendas, pagamentos e demais fontes projetam o mesmo ledger do business', () => {
  for (const collection of ['sales', 'payments', 'balanceAdjustments', 'stockMovements', 'campaignEvents', 'customerSubscriptionEvents', 'catalogOrders'])
    assert.match(functionsSource, new RegExp(`sourceCollection:'${collection}'|projectActivity\\('${collection}'`));
  assert.match(functionsSource, /reconcileBusinessActivityEvents/);
});
