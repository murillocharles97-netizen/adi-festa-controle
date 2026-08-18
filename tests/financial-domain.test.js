const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function runtime() {
  const data = {
    produtos: [],
    variacoesProdutos: [],
    clientes: [
      {
        id: "client-1",
        nome: "Cliente financeiro",
        saldo: 0,
        totalComprado: 0,
        quantidadeVendas: 0,
      },
    ],
    vendas: [],
    pagamentos: [],
    movimentacoes: [],
    movimentacoesEstoque: [],
  };
  let sequence = 0;
  const context = {
    console,
    structuredClone,
    Date,
    Map,
    Set,
    Error,
    String,
    Number,
    Boolean,
    Array,
    Object,
    JSON,
    Math,
    crypto: { randomUUID: () => `id_${++sequence}` },
    Utils: { uuid: () => `id_${++sequence}` },
    DB: {
      getBusinessId: () => "empresa_teste",
      carregar: () => data,
      alterar(mutator) {
        mutator(data);
        return data;
      },
    },
    PlanLimitService: null,
    BarcodeIndex: { invalidate() {}, assertAvailable() {} },
    normalizeBarcode: (value) => String(value || "").replace(/\s/g, ""),
    Campanhas: {
      aplicarBeneficios: (items) => items,
      aplicarVendaNoBanco: () => [],
      reverterVendaNoBanco() {},
    },
    dispatchEvent() {},
    CustomEvent: function () {},
    PhoneUtils: {
      normalizeBrazilianPhone: (value) => String(value || "").replace(/\D/g, ""),
    },
  };
  context.window = context;
  vm.createContext(context);
  for (const file of [
    "js/financial-concurrency.js",
    "js/clientes.js",
    "js/produtos.js",
    "js/product-variations.js",
    "js/vendas.js",
    "js/fiados.js",
  ])
    vm.runInContext(fs.readFileSync(file, "utf8"), context);
  const product = context.Produtos.salvar({
    nome: "Produto",
    preco: 25,
    custo: 10,
    estoqueAtual: 20,
    semControleEstoque: true,
  });
  const item = {
    produtoId: product.id,
    nome: product.nome,
    quantidade: 1,
    precoOriginal: 25,
    precoFinalUnitario: 25,
  };
  return { context, data, item };
}

test("venda paga não altera o saldo em aberto", () => {
  const { context, data, item } = runtime();
  context.Vendas.registrar({
    operationId: "paid-sale",
    clienteId: "client-1",
    status: "pago",
    itens: [item],
  });
  assert.equal(data.clientes[0].saldo, 0);
});

test("venda fiado aumenta a dívida e retry não duplica", () => {
  const { context, data, item } = runtime(),
    input = {
      operationId: "credit-sale",
      clienteId: "client-1",
      status: "fiado",
      itens: [item],
    };
  const first = context.Vendas.registrar(input),
    second = context.Vendas.registrar(input);
  assert.equal(first.id, second.id);
  assert.equal(data.vendas.length, 1);
  assert.equal(data.clientes[0].saldo, -25);
  assert.equal(data.clientes[0].quantidadeVendas, 1);
  assert.equal(data.clientes[0].atualizadoEm, first.data);
});

test("pagamento parcial reduz dívida e pagamento total zera", () => {
  const { context, data, item } = runtime();
  context.Vendas.registrar({
    operationId: "credit-sale",
    clienteId: "client-1",
    status: "fiado",
    itens: [item],
  });
  const partial = context.Fiados.receber("client-1", 10, "Parcial");
  assert.equal(data.clientes[0].saldo, -15);
  assert.equal(data.clientes[0].atualizadoEm, partial.data);
  context.Fiados.receber("client-1", 15, "Total");
  assert.equal(data.clientes[0].saldo, 0);
  assert.equal(data.pagamentos.length, 2);
});

test("status financeiro compartilhado preserva o sinal oficial", () => {
  const { context } = runtime();
  assert.deepEqual(
    structuredClone(context.Clientes.financialStatus({ saldo: -84 })),
    { saldo: -84, status: "debt", debt: 84, credit: 0 },
  );
  assert.deepEqual(
    structuredClone(context.Clientes.financialStatus({ saldo: 17 })),
    { saldo: 17, status: "credit", debt: 0, credit: 17 },
  );
  assert.equal(context.Clientes.financialStatus({ saldo: 0 }).status, "zero");
});

test("desfazer venda fiado restaura saldo uma única vez", () => {
  const { context, data, item } = runtime();
  context.Vendas.registrar({
    operationId: "credit-sale",
    clienteId: "client-1",
    status: "fiado",
    itens: [item],
  });
  assert.equal(data.clientes[0].saldo, -25);
  context.Vendas.desfazerUltima();
  assert.equal(data.clientes[0].saldo, 0);
  assert.equal(data.vendas.length, 0);
  assert.throws(() => context.Vendas.desfazerUltima(), /Nenhuma venda/);
});
