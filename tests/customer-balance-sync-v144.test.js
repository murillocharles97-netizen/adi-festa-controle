const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const syncSource = fs.readFileSync('js/firebase/sync.js', 'utf8');

function sourceFunction(name, nextName) {
  const start = syncSource.indexOf(`function ${name}(`);
  const end = syncSource.indexOf(`function ${nextName}(`, start) >= 0
    ? syncSource.indexOf(`function ${nextName}(`, start)
    : syncSource.indexOf(`const ${nextName} =`, start);
  assert.ok(start >= 0 && end > start, `${name} deve existir antes de ${nextName}`);
  return syncSource.slice(start, end);
}

function saleHarness() {
  const data = {
    config: {},
    clientes: [{ id: 'anderson', nome: 'Anderson Chilli', saldo: -12, financialVersion: 2, totalComprado: 12, quantidadeVendas: 1 }],
    produtos: [{ id: 'item', nome: 'Produto', preco: 13, custo: 0, semControleEstoque: true, itemKind: 'service' }],
    variacoesProdutos: [], vendas: [], pagamentos: [], movimentacoes: [], movimentacoesEstoque: [],
  };
  const captures = [];
  const queue = [];
  let directSave = 0, mutations = 0, sequence = 0;
  const context = {
    console, structuredClone, Date, crypto: { randomUUID: () => `uuid-${++sequence}` },
    Utils: { uuid: () => `uuid-${++sequence}` },
    DB: {
      getBusinessId: () => 'adi-festa',
      carregar: () => data,
      salvar() { directSave++; throw Error('gravação direta ignora a fila'); },
      alterar(mutator) {
        const before = structuredClone(data);
        mutator(data);
        mutations++;
        const after = structuredClone(data);
        captures.push({ before, after });
        context.captureChanges(before, after);
        return data;
      },
    },
    SpaceContext: { requireSalesSpace: (id) => id === 'loja' ? id : null },
    Produtos: { obter: (id) => data.produtos.find((item) => item.id === id) },
    Campanhas: { aplicarVendaNoBanco: () => [] },
    CustomerSubscriptions: { applySaleInData: () => [] },
    PlanLimitService: null,
    SOURCES: { clients: 'clientes', sales: 'vendas', payments: 'pagamentos', movements: 'movimentacoes' },
    sourceItems: (snapshot, name) => snapshot[({ clients: 'clientes', sales: 'vendas', payments: 'pagamentos', movements: 'movimentacoes' })[name]] || [],
    applyingCloud: false,
    queueWrites(writes, operationId, eventKind) { queue.push({ writes: structuredClone(writes), operationId, eventKind }); return writes.length; },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    sourceFunction('changedFields', 'diffWrites') + sourceFunction('diffWrites', 'captureChanges') +
      sourceFunction('captureChanges', 'installOfflineFirstStorage'),
    context,
    { filename: 'sync-capture.js' },
  );
  vm.runInContext(fs.readFileSync('js/vendas.js', 'utf8'), context, { filename: 'vendas.js' });
  return { context, data, captures, queue, counts: () => ({ directSave, mutations }) };
}

test('Anderson: venda fiado de R$ 13 entra no capturador com saldo -12 → -25 e ID único', () => {
  const { context, data, captures, queue, counts } = saleHarness();
  const input = { id: 'sale-13', operationId: 'op-13', spaceId: 'loja', clienteId: 'anderson', status: 'fiado', itens: [
    { produtoId: 'item', nome: 'Produto', quantidade: 1, precoOriginal: 13, precoFinalUnitario: 13 },
  ] };
  const first = context.Vendas.registrar(input);
  const second = context.Vendas.registrar(input);
  assert.equal(first.id, second.id);
  assert.deepEqual(counts(), { directSave: 0, mutations: 1 });
  assert.equal(captures.length, 1);
  assert.equal(captures[0].before.clientes[0].saldo, -12);
  assert.equal(captures[0].after.clientes[0].saldo, -25);
  assert.equal(captures[0].after.clientes[0].financialVersion, 3);
  assert.equal(captures[0].after.vendas.length, 1);
  assert.equal(captures[0].after.vendas[0].operationId, 'op-13');
  assert.equal(captures[0].after.vendas[0].clienteId, 'anderson');
  assert.equal(data.clientes[0].saldo, -25);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].operationId, 'op-13');
  assert.equal(queue[0].eventKind, 'sale');
  assert.equal(queue[0].writes.find((write) => write.entityType === 'sales').operation, 'create');
  assert.equal(queue[0].writes.find((write) => write.entityType === 'clients').data.saldo, -25);
  const effectContext = {
    writes: queue[0].writes,
    roundedMoney: (value) => Math.round(Number(value || 0) * 100) / 100,
    balanceEffectId: (type, sourceId) => `${type}:${sourceId}`,
    now: () => '2026-09-21T00:00:00.000Z',
  };
  vm.createContext(effectContext);
  vm.runInContext(
    `${sourceFunction('financialEffectFromWrites', 'readSignalVersions')}\n` +
      'globalThis.effect = financialEffectFromWrites(writes, "adi-festa", "op-13", "sale");',
    effectContext,
  );
  assert.equal(effectContext.effect.customerId, 'anderson');
  assert.equal(effectContext.effect.balanceDelta, -13);
  assert.equal(effectContext.effect.id, 'credit_sale:sale-13');
});

test('Nat: capturador real enfileira duas vendas consecutivas sem reutilizar saldo ou versão', () => {
  const { context, data, queue, counts } = saleHarness();
  data.clientes[0].saldo = -312.84;
  data.clientes[0].financialVersion = 10;
  const sale = (id, amount) => context.Vendas.registrar({ id, operationId: `op-${id}`,
    spaceId: 'loja', clienteId: 'anderson', status: 'fiado',
    itens: [{ produtoId: 'item', nome: 'Produto', quantidade: 1,
      precoOriginal: amount, precoFinalUnitario: amount }] });
  const first = sale('nat-14', 14);
  const second = sale('nat-25', 25);
  assert.equal(first.saldoAtual, -326.84);
  assert.equal(second.saldoAnterior, -326.84);
  assert.equal(second.saldoAtual, -351.84);
  assert.equal(second.financialVersionAnterior, 11);
  assert.equal(data.clientes[0].financialVersion, 12);
  assert.equal(queue.length, 2);
  assert.deepEqual(queue.map((item) => item.eventKind), ['sale', 'sale']);
  assert.deepEqual(queue.map((item) => item.writes.find((write) =>
    write.entityType === 'clients').data.saldo), [-326.84, -351.84]);
  assert.deepEqual(counts(), { directSave: 0, mutations: 2 });
  assert.equal(sale('nat-25', 25).id, second.id);
  assert.equal(queue.length, 2);
});

test('normalização local preserva financialVersion e metadados financeiros no reload', () => {
  const memory = new Map();
  const localStorage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
  const context = {
    localStorage, structuredClone, Date,
    Utils: { uuid: () => 'uuid' },
    PhoneUtils: { normalizeBrazilianPhone: (value) => String(value || '').replace(/\D/g, '') },
    normalizeBarcode: (value) => String(value || ''),
    addEventListener() {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/storage.js', 'utf8'), context, { filename: 'storage.js' });
  context.DB.useBusiness('adi-festa');
  context.DB.salvar({ config: {}, clientes: [{ id: 'anderson', nome: 'Anderson Chilli', saldo: -25, financialVersion: 3, legacyBalance: 12, financialRevision: 'op-13' }] });
  context.DB.alterar((data) => { data.clientes[0].observacoes = 'teste'; });
  const client = context.DB.carregar().clientes[0];
  assert.equal(client.saldo, -25);
  assert.equal(client.financialVersion, 3);
  assert.equal(client.legacyBalance, 12);
  assert.equal(client.financialRevision, 'op-13');
});
