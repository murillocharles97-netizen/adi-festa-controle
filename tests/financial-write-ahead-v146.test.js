const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const syncSource = fs.readFileSync('js/firebase/sync.js', 'utf8');
const sourcePart = (start, end) => syncSource.slice(syncSource.indexOf(start), syncSource.indexOf(end, syncSource.indexOf(start)));

function harness() {
  const memory = new Map();
  let sequence = 0;
  let failWrite = null;
  const context = {
    console, Date, structuredClone, setTimeout: () => 0,
    crypto: { randomUUID: () => `uuid-${++sequence}` },
    localStorage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        if (failWrite?.(key)) throw Error('simulated storage failure');
        memory.set(key, String(value));
      },
      removeItem: (key) => memory.delete(key),
    },
    Utils: { uuid: () => `uuid-${++sequence}`,
      dinheiro: (value) => Number(value).toLocaleString('pt-BR',
        { style: 'currency', currency: 'BRL' }) },
    PhoneUtils: { normalizeBrazilianPhone: (value) => String(value || '').replace(/\D/g, '') },
    normalizeBarcode: (value) => String(value || ''),
    SpaceContext: { requireSalesSpace: (id) => id === 'loja' ? id : null },
    Campanhas: { aplicarVendaNoBanco: () => [], aplicarBeneficios: (items) => items },
    CustomerSubscriptions: { applySaleInData: () => [] },
    FinancialConcurrency: { context: (client) => ({ expectedBalance: client.saldo,
      expectedFinancialVersion: client.financialVersion }) },
    navigator: { onLine: false },
    dispatchEvent() {}, CustomEvent: function (_type, detail) { this.detail = detail?.detail; },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    updateQueueState() {},
    scheduleImmediate() {},
    queueKey: () => 'test-sync-queue',
    activeBusinessId: () => 'test-business',
    deviceId: () => 'device-a',
    queueSubtype: () => 'financial',
    now: () => new Date().toISOString(),
    sanitizeForFirestore: (value) => value,
    financialVersionOf: (client) => Number(client?.financialVersion || 0),
    MAX_WRITES: 350, PAYLOAD_VERSION: 3,
    currentUser: { uid: 'owner' }, readOnlyMode: false,
    state: { dataAudit: null },
    diffWrites: (before, after) => {
      const writes = [];
      for (const [localKey, cloudName] of [['vendas', 'sales'], ['pagamentos', 'payments']])
        for (const entry of after[localKey] || [])
          if (!(before[localKey] || []).some((previous) => previous.id === entry.id))
            writes.push({ entityType: cloudName, entityId: entry.id,
              operation: 'create', data: entry });
      for (const client of after.clientes || []) {
        const previous = (before.clientes || []).find((entry) => entry.id === client.id);
        if (previous && (previous.saldo !== client.saldo ||
          previous.financialVersion !== client.financialVersion))
          writes.push({ entityType: 'clients', entityId: client.id,
            operation: 'update', before: previous,
            data: { saldo: client.saldo, financialVersion: client.financialVersion } });
      }
      return writes;
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/storage.js', 'utf8'), context);
  context.DB.useBusiness('test-business');
  context.DB.salvar({ config: {}, clientes: [{ id: 'client', nome: 'Cliente', saldo: -100,
    financialVersion: 10, atualizadoEm: '2026-09-20T00:00:00.000Z' }],
  produtos: [{ id: 'product', nome: 'Serviço', preco: 20, custo: 0,
    semControleEstoque: true, itemKind: 'service' }],
  vendas: [], pagamentos: [], movimentacoes: [], movimentacoesEstoque: [] });
  context.DB.__firebaseSyncWrapped = true;
  context.Produtos = { obter: (id) => context.DB.carregar().produtos.find((item) => item.id === id) };
  context.ProductVariations = { get: () => null };
  vm.runInContext(sourcePart('const readQueue =', 'const queueErrorBreakdown ='), context);
  vm.runInContext(sourcePart('function queueWrites(', 'function changedFields('), context);
  vm.runInContext(sourcePart('function assertSaleTracked(', 'async function prepareCustomerForSale('), context);
  context.SyncFirebase = vm.runInContext('({ isReady: () => true, createSaleOperation, createPaymentOperation, assertSaleTracked, assertPaymentTracked })', context);
  vm.runInContext(fs.readFileSync('js/vendas.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/fiados.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/recibos.js', 'utf8'), context);
  const sale = (id, amount) => context.Vendas.registrar({ id, operationId: `op-${id}`,
    spaceId: 'loja', clienteId: 'client', status: 'fiado', formaPagamento: 'fiado',
    itens: [{ produtoId: 'product', quantidade: 1, precoOriginal: amount,
      precoFinalUnitario: amount }] });
  const queue = () => JSON.parse(memory.get('test-sync-queue') || '[]');
  return { context, memory, sale, queue, setFailure: (predicate) => { failWrite = predicate; } };
}

test('aceite sem reload: 100 + 20 + 30 - 40 = 110 no saldo, WhatsApp e total aberto', () => {
  const { context, sale, queue } = harness();
  sale('a', 20);
  const second = sale('b', 30);
  assert.deepEqual([second.saldoAnterior, second.saldoAtual], [-120, -150]);
  const message = context.Recibos.buildSaleShareMessage({ business: { name: 'Loja' },
    customer: { nome: 'Cliente' }, sale: second,
    balanceBefore: second.saldoAnterior, balanceAfter: second.saldoAtual });
  assert.match(message, /Saldo anterior:\nR\$\s120,00/);
  assert.match(message, /Total em aberto:\nR\$\s150,00/);
  const payment = context.Fiados.receber('client', 40, 'Parcial', { operationId: 'pay-40' });
  assert.deepEqual([payment.saldoAnterior, payment.saldoNovo], [-150, -110]);
  assert.equal(context.Fiados.listar().reduce((sum, client) => sum + Math.abs(client.saldo), 0), 110);
  assert.equal(queue().length, 3);
  const clientsPage = fs.readFileSync('js/clientes-page.js', 'utf8');
  const app = fs.readFileSync('js/app.js', 'utf8');
  assert.match(clientsPage, /function topDebtors\(\).*Clientes\.listar\(\)/);
  assert.match(app, /addEventListener\("financial-state-updated"/);
  assert.match(app, /window\.ClientesPage\?\.refresh\?\.\(\)/);
});

test('duas e três vendas offline mantêm snapshots, versões e uma fila por operação; recebimento mantém 110', () => {
  const { context, sale, queue } = harness();
  const first = sale('first', 20), second = sale('second', 30), third = sale('third', 40);
  assert.deepEqual([first.saldoAnterior, second.saldoAnterior, third.saldoAnterior], [-100, -120, -150]);
  assert.equal(context.DB.carregar().clientes[0].saldo, -190);
  assert.equal(context.DB.carregar().clientes[0].financialVersion, 13);
  const payment = context.Fiados.receber('client', 40, 'Recebimento', { operationId: 'pay-1' });
  assert.deepEqual([payment.saldoAnterior, payment.saldoNovo], [-190, -150]);
  assert.equal(context.DB.carregar().clientes[0].financialVersion, 14);
  assert.deepEqual(queue().map((item) => item.status), ['pending', 'pending', 'pending', 'pending']);
  assert.equal(new Set(queue().map((item) => item.operationId)).size, 4);
  assert.equal(sale('first', 20).id, first.id);
  assert.equal(context.Fiados.receber('client', 40, 'Recebimento', { operationId: 'pay-1' }).id, payment.id);
  assert.equal(queue().length, 4);
});

test('falha ao gravar fila impede venda e saldo locais', () => {
  const { context, sale, queue, setFailure } = harness();
  setFailure((key) => key === 'test-sync-queue');
  assert.throws(() => sale('blocked', 20), /simulated storage failure/);
  assert.equal(context.DB.carregar().vendas.length, 0);
  assert.equal(context.DB.carregar().clientes[0].saldo, -100);
  assert.equal(queue().length, 0);
});

test('falha ao gravar fila impede também recebimento e preserva o saldo da venda', () => {
  const { context, sale, queue, setFailure } = harness();
  sale('credit', 20);
  setFailure((key) => key === 'test-sync-queue');
  assert.throws(() => context.Fiados.receber('client', 10, 'Parcial',
    { operationId: 'pay-blocked' }), /simulated storage failure/);
  assert.equal(context.DB.carregar().pagamentos.length, 0);
  assert.equal(context.DB.carregar().clientes[0].saldo, -120);
  assert.equal(queue().length, 1);
});

test('falha após preparar fila preserva operação para diagnóstico, sem enviar venda inexistente', () => {
  const { context, memory, sale, queue, setFailure } = harness();
  const dataKey = [...memory.keys()].find((key) => key.includes('DB') && key !== 'test-sync-queue');
  assert.ok(dataKey);
  setFailure((key) => key === dataKey);
  assert.throws(() => sale('interrupted', 20), /simulated storage failure/);
  assert.equal(context.DB.carregar().vendas.length, 0);
  assert.equal(queue()[0].status, 'local_preparing');
  setFailure(null);
  vm.runInContext('resumePreparedSales()', context);
  assert.equal(queue()[0].status, 'error');
  assert.equal(queue()[0].lastErrorCode, 'local-operation-missing');
  sale('interrupted', 20);
  assert.equal(queue()[0].status, 'pending');
  assert.equal(context.DB.carregar().clientes[0].saldo, -120);
});

test('queda entre persistir dados e ativar fila retoma a operação existente sem duplicar', () => {
  const { context, sale, queue, setFailure } = harness();
  let queueWrites = 0;
  setFailure((key) => key === 'test-sync-queue' && ++queueWrites === 2);
  assert.throws(() => sale('restart', 20), /simulated storage failure/);
  assert.equal(context.DB.carregar().clientes[0].saldo, -120);
  assert.equal(queue()[0].status, 'local_preparing');
  setFailure(null);
  vm.runInContext('resumePreparedSales()', context);
  assert.equal(queue()[0].status, 'pending');
  assert.equal(sale('restart', 20).id, 'restart');
  assert.equal(context.DB.carregar().vendas.length, 1);
});

test('fila ilegível bloqueia nova venda sem sobrescrever o registro corrompido', () => {
  const { context, memory, sale } = harness();
  memory.set('test-sync-queue', '{broken');
  assert.throws(() => sale('corrupt', 20), /fila local está corrompida/);
  assert.equal(memory.get('test-sync-queue'), '{broken');
  assert.equal(context.DB.carregar().vendas.length, 0);
  assert.equal(vm.runInContext('queueCounts().errors', context), 1);
  assert.equal(vm.runInContext('queueCounts().total', context), 1);
});

test('detecção local assinala venda sem fila mesmo quando pendentes chega a zero', () => {
  const { context, memory, sale } = harness();
  sale('orphan', 20);
  memory.set('test-sync-queue', '[]');
  assert.equal(vm.runInContext('queueCounts().pending', context), 0);
  const integrity = vm.runInContext('saleIntegrityDiagnostics()', context);
  assert.equal(integrity.count, 1);
  assert.equal(integrity.localWithoutQueue[0].saleId, 'orphan');
});

test('envio ignora preparação e a tela diferencia órfãs de zero pendentes', () => {
  assert.match(syncSource, /if \(queued\.status === "local_preparing"\) continue/);
  assert.match(syncSource, /orphanOperations: saleIntegrity\.count \+ paymentIntegrity\.count/);
  const ui = fs.readFileSync('js/firebase/firebase-ui.js', 'utf8');
  assert.match(ui, /firebase-orphans/);
  assert.match(ui, /data-cloud-orphans/);
});
