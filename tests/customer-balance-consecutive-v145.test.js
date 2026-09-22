const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const syncSource = fs.readFileSync('js/firebase/sync.js', 'utf8');

function harness(initialDebt = 100) {
  const memory = new Map();
  const queue = [];
  let sequence = 0;
  const context = {
    console, Date, structuredClone, crypto: { randomUUID: () => `uuid-${++sequence}` },
    localStorage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
    Utils: {
      uuid: () => `uuid-${++sequence}`,
      dinheiro: (value) => `R$ ${Number(value).toFixed(2).replace('.', ',')}`,
      escapar: (value) => String(value),
    },
    PhoneUtils: { normalizeBrazilianPhone: (value) => String(value || '').replace(/\D/g, '') },
    normalizeBarcode: (value) => String(value || ''),
    SpaceContext: { requireSalesSpace: (id) => id === 'loja' ? id : null },
    Campanhas: { aplicarVendaNoBanco: () => [] },
    CustomerSubscriptions: { applySaleInData: () => [] },
    addEventListener() {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/storage.js', 'utf8'), context);
  context.DB.useBusiness('adi-festa');
  context.DB.salvar({ config: {}, clientes: [{ id: 'nat', nome: 'Nat Stanley', saldo: -initialDebt,
    financialVersion: 10, atualizadoEm: '2026-09-20T00:00:00.000Z' }],
  produtos: [{ id: 'item', nome: 'Produto', preco: 20, custo: 0, semControleEstoque: true, itemKind: 'service' }],
  vendas: [], pagamentos: [], movimentacoes: [], movimentacoesEstoque: [] });
  const originalAlter = context.DB.alterar.bind(context.DB);
  context.DB.alterar = (mutator) => {
    const before = structuredClone(context.DB.carregar());
    const after = originalAlter(mutator);
    const created = after.vendas.filter((sale) => !before.vendas.some((previous) => previous.id === sale.id));
    for (const sale of created) queue.push({ operationId: sale.operationId,
      saleId: sale.id, customerId: sale.clienteId,
      delta: Math.round((Number(after.clientes[0].saldo) - Number(before.clientes[0].saldo)) * 100) });
    return after;
  };
  context.DB.__firebaseSyncWrapped = true;
  context.SyncFirebase = { isReady: () => true };
  context.Produtos = { obter: (id) => context.DB.carregar().produtos.find((item) => item.id === id) };
  vm.runInContext(fs.readFileSync('js/vendas.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/recibos.js', 'utf8'), context);
  const sell = (id, amount) => context.Vendas.registrar({ id, operationId: `op-${id}`,
    spaceId: 'loja', clienteId: 'nat', status: 'fiado',
    itens: [{ produtoId: 'item', nome: 'Produto', quantidade: 1,
      precoOriginal: amount, precoFinalUnitario: amount }] });
  return { context, queue, sell };
}

test('sem reload: duas e três vendas partem do saldo produzido pela anterior, com versões N+1/N+2/N+3', () => {
  const { context, queue, sell } = harness();
  const a = sell('a', 20);
  const b = sell('b', 30);
  const c = sell('c', 40);
  assert.deepEqual([a.saldoAnterior, a.saldoAtual, a.financialVersionAnterior], [-100, -120, 10]);
  assert.deepEqual([b.saldoAnterior, b.saldoAtual, b.financialVersionAnterior], [-120, -150, 11]);
  assert.deepEqual([c.saldoAnterior, c.saldoAtual, c.financialVersionAnterior], [-150, -190, 12]);
  assert.equal(context.DB.carregar().clientes[0].saldo, -190);
  assert.equal(context.DB.carregar().clientes[0].financialVersion, 13);
  assert.equal(queue.length, 3);
  assert.deepEqual(queue.map((item) => item.delta), [-2000, -3000, -4000]);
  assert.equal(sell('a', 20).id, a.id);
  assert.equal(queue.length, 3);
});

test('Nat: 312,84 + 14 + 25 = 351,84 no mesmo aparelho, WhatsApp usa os snapshots da segunda venda', () => {
  const { context, sell } = harness(312.84);
  const a = sell('nat-a', 14);
  const b = sell('nat-b', 25);
  assert.equal(a.saldoAtual, -326.84);
  assert.equal(b.saldoAnterior, -326.84);
  assert.equal(b.saldoAtual, -351.84);
  assert.equal(context.DB.carregar().clientes[0].saldo, -351.84);
  const message = context.Recibos.buildSaleShareMessage({ business: { name: 'VECONI' },
    customer: { nome: 'Nat Stanley' }, sale: b,
    balanceBefore: b.saldoAnterior, balanceAfter: b.saldoAtual });
  assert.match(message, /Saldo anterior:\nR\$ 326,84/);
  assert.match(message, /Total em aberto:\nR\$ 351,84/);
  assert.match(fs.readFileSync('js/recibos.js', 'utf8'), /Total em aberto agora:.*sale\.saldoAtual/);
});

test('offline: duas vendas mantêm projeção local e deltas distintos na fila até convergir', () => {
  const { context, queue, sell } = harness();
  context.navigator = { onLine: false };
  sell('offline-a', 20);
  const second = sell('offline-b', 30);
  assert.equal(second.saldoAnterior, -120);
  assert.equal(context.DB.carregar().clientes[0].saldo, -150);
  assert.equal(queue.reduce((remoteCents, item) => remoteCents + item.delta, -10000), -15000);
});

test('projeção remota velha não permite segunda venda sobre saldo revertido; a primeira venda permanece', () => {
  const { context, queue, sell } = harness(312.84);
  sell('local-a', 14);
  context.DB.salvar({ ...context.DB.carregar(), clientes: [{ ...context.DB.carregar().clientes[0],
    saldo: -312.84, financialVersion: 10, atualizadoEm: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z' }] });
  assert.throws(() => sell('local-b', 25), /saldo local voltou/);
  assert.equal(context.DB.carregar().vendas.length, 1);
  assert.equal(queue.length, 1);
});

test('sem interceptador de sync, venda não é considerada concluída localmente', () => {
  const { context, sell } = harness();
  context.DB.__firebaseSyncWrapped = false;
  assert.throws(() => sell('not-ready', 20), /sincronização ainda não está pronta/);
  assert.equal(context.DB.carregar().vendas.length, 0);
});

test('checkout atualiza pontualmente o cliente remoto, mas bloqueia venda online enquanto houver pendência', async () => {
  const start = syncSource.indexOf('async function prepareCustomerForSale(');
  const end = syncSource.indexOf('function cleanCloudItem(', start);
  assert.ok(start > 0 && end > start);
  const calls = [];
  const queue = [];
  const context = {
    currentUser: { uid: 'owner' }, readOnlyMode: false,
    DB: { __firebaseSyncWrapped: true, carregar: () => ({ vendas: [] }) }, navigator: { onLine: true },
    pendingIds: () => new Set(queue.flatMap((item) => item.payload.writes.map((write) => write.entityId))),
    readQueue: () => queue,
    readKnownOrphanIds: () => new Set(), isOrphanReviewed: () => false,
    processSyncQueue: async () => ({ sent: 0 }),
    getDocFromServer: async () => ({ exists: () => true, data: () => ({ saldo: -120, financialVersion: 11 }) }),
    doc: (...parts) => parts.join('/'), db: {}, activeBusinessId: () => 'adi-festa',
    applyCloudCollection: (...args) => calls.push(args),
    financialVersionOf: (client) => client.financialVersion,
  };
  vm.createContext(context);
  vm.runInContext(syncSource.slice(start, end), context);
  const server = await context.prepareCustomerForSale('nat');
  assert.equal(server.source, 'server');
  assert.equal(server.financialVersion, 11);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'clients');
  queue.push({ status: 'pending', payload: { writes: [{ entityType: 'clients', entityId: 'nat' }] } });
  await assert.rejects(context.prepareCustomerForSale('nat'), /ainda está sincronizando/);
  assert.equal(calls.length, 1);
  context.navigator.onLine = false;
  assert.equal((await context.prepareCustomerForSale('nat')).source, 'local-offline');
  queue[0].status = 'error';
  context.navigator.onLine = true;
  await assert.rejects(context.prepareCustomerForSale('nat'), /erro de sincronização/);
});

test('venda local recente fora da fila bloqueia novo fiado até confirmação idempotente no servidor', async () => {
  const start = syncSource.indexOf('function markLocalCreditSaleConfirmed(');
  const end = syncSource.indexOf('function cleanCloudItem(', start);
  const sale = { id: 'sale-a', operationId: 'op-a', clienteId: 'nat', status: 'fiado',
    data: new Date().toISOString(), saldoAtual: -326.84 };
  const data = { vendas: [sale] };
  let remoteSale = null;
  let clientReads = 0;
  const context = {
    Date, currentUser: { uid: 'owner' }, readOnlyMode: false, applyingCloud: false,
    originalAlter: (mutator) => mutator(data), now: () => new Date().toISOString(),
    DB: { __firebaseSyncWrapped: true, carregar: () => data }, navigator: { onLine: true },
    readQueue: () => [], pendingIds: () => new Set(), processSyncQueue: async () => {},
    readKnownOrphanIds: () => new Set(), isOrphanReviewed: () => false,
    getDocFromServer: async (path) => {
      if (path.endsWith('/sales/sale-a'))
        return { id: 'sale-a', exists: () => Boolean(remoteSale), data: () => remoteSale };
      clientReads += 1;
      return { exists: () => true, data: () => ({ saldo: -326.84, financialVersion: 11 }) };
    },
    doc: (...parts) => parts.join('/'), db: {}, activeBusinessId: () => 'adi-festa',
    cleanCloudItem: (value) => value, applyCloudCollection: () => {},
    financialVersionOf: (value) => value.financialVersion,
  };
  vm.createContext(context);
  vm.runInContext(syncSource.slice(start, end), context);
  assert.throws(() => context.assertSaleTracked(sale), /sem confirmação nem fila/);
  await assert.rejects(context.prepareCustomerForSale('nat'), /somente neste aparelho/);
  assert.equal(clientReads, 0);
  context.navigator.onLine = false;
  await assert.rejects(context.prepareCustomerForSale('nat'), /somente neste aparelho/);
  context.navigator.onLine = true;
  remoteSale = { operationId: 'op-a', financialAppliedAt: new Date().toISOString() };
  assert.equal((await context.prepareCustomerForSale('nat')).source, 'server');
  assert.equal(sale.financialAppliedAt, remoteSale.financialAppliedAt);
  assert.equal(clientReads, 1);
  assert.doesNotThrow(() => context.assertSaleTracked(sale));
});

test('venda fiado repetida só é idempotente se a operação estiver na fila ou confirmada', () => {
  const start = syncSource.indexOf('function assertSaleTracked(');
  const end = syncSource.indexOf('async function prepareCustomerForSale(', start);
  const queue = [];
  const context = { readQueue: () => queue };
  vm.createContext(context);
  vm.runInContext(syncSource.slice(start, end), context);
  const sale = { id: 'sale-a', operationId: 'op-a', clienteId: 'nat', status: 'fiado' };
  assert.throws(() => context.assertSaleTracked(sale), /sem confirmação nem fila/);
  queue.push({ operationId: 'op-a:1', payload: { writes: [{ entityType: 'sales',
    operation: 'create', entityId: 'sale-a', data: { operationId: 'op-a' } },
  { entityType: 'clients', operation: 'update', entityId: 'nat', data: { saldo: -120 } }] } });
  assert.doesNotThrow(() => context.assertSaleTracked(sale));
  queue.length = 0;
  sale.financialAppliedAt = new Date().toISOString();
  assert.doesNotThrow(() => context.assertSaleTracked(sale));
});

test('checkout online só conclui com venda financeira confirmada e recibo usa saldo transacional', async () => {
  const start = syncSource.indexOf('async function confirmCreditSale(');
  const end = syncSource.indexOf('function cleanCloudItem(', start);
  const sale = { id: 'b', operationId: 'op-b', clienteId: 'nat', status: 'fiado',
    formaPagamento: 'fiado', saldoAnterior: -312.84, saldoAtual: -337.84 };
  const cloud = { operationId: 'op-b', status: 'applied', saldoAnterior: -326.84,
    saldoAtual: -351.84, financialVersionAnterior: 11, financialAppliedAt: '2026-09-21T21:35:00.000Z' };
  const calls = [];
  let saleExists = true;
  const context = {
    currentUser: { uid: 'owner' }, readOnlyMode: false, navigator: { onLine: true },
    processSyncQueue: async (options) => calls.push(['queue', options.force]),
    getDocFromServer: async (path) => path.endsWith('/sales/b')
      ? { id: 'b', exists: () => saleExists, data: () => cloud }
      : { id: 'nat', exists: () => true, data: () => ({ saldo: -351.84, financialVersion: 12 }) },
    cleanCloudItem: (value) => value, doc: (...parts) => parts.join('/'),
    db: {}, activeBusinessId: () => 'adi-festa',
    applyCloudCollection: (name, values) => calls.push([name, values[0]]),
  };
  vm.createContext(context);
  vm.runInContext(syncSource.slice(start, end), context);
  const confirmed = await context.confirmCreditSale(sale);
  assert.deepEqual([confirmed.saldoAnterior, confirmed.saldoAtual,
    confirmed.financialVersionAnterior, confirmed.status], [-326.84, -351.84, 11, 'fiado']);
  assert.deepEqual(calls.map((call) => call[0]), ['queue', 'sales', 'clients']);
  assert.equal((await context.confirmCreditSale({ ...sale, status: 'applied' })).status, 'fiado');
  saleExists = false;
  await assert.rejects(context.confirmCreditSale(sale), /sem confirmação financeira/);
  context.navigator.onLine = false;
  assert.equal(await context.confirmCreditSale(sale), sale);
});

test('transação corrige snapshots da venda quando outro dispositivo avançou a versão', () => {
  const start = syncSource.indexOf('function canonicalCreditSaleData(');
  const end = syncSource.indexOf('const sameFinancialMoney', start);
  const context = {
    roundedMoney: (value) => Math.round(Number(value) * 100) / 100,
    financialVersionOf: (client) => Number(client.financialVersion || 0),
  };
  vm.createContext(context);
  vm.runInContext(syncSource.slice(start, end), context);
  const corrected = context.canonicalCreditSaleData(
    { saldoAnterior: -312.84, saldoAtual: -337.84, financialVersionAnterior: 10 },
    { balanceDelta: -25 },
    { saldo: -326.84, financialVersion: 11 },
    { saldo: -312.84, financialVersion: 10 },
  );
  assert.deepEqual([corrected.saldoAnterior, corrected.saldoAtual,
    corrected.financialVersionAnterior], [-326.84, -351.84, 11]);
  assert.match(syncSource, /data = canonicalCreditSaleData\(data, financialEffect/);
});
