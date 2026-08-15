const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync("js/storage.js", "utf8");

function fixture(clientCount = 2000, saleCount = 5000) {
  const now = "2026-08-08T12:00:00.000Z";
  return {
    versao: 13,
    config: { nome: "Empresa de teste", appSchemaVersion: 2 },
    clientes: Array.from({ length: clientCount }, (_, index) => ({
      id: `c${index}`,
      nome: `Cliente ${index}`,
      telefone: `1799${String(index).padStart(7, "0")}`,
      saldo: index % 3 ? 0 : -25,
      criadoEm: now,
      atualizadoEm: now,
    })),
    produtos: [],
    variacoesProdutos: [],
    vendas: Array.from({ length: saleCount }, (_, index) => ({
      id: `v${index}`,
      operationId: `v${index}`,
      clienteId: `c${index % clientCount}`,
      clienteNome: `Cliente ${index % clientCount}`,
      data: now,
      valorFinal: 10,
      valorTotal: 10,
      status: "pago",
      itens: [],
    })),
    pagamentos: [],
    movimentacoes: [],
    movimentacoesEstoque: [],
    cobrancas: [],
    campanhas: [],
    progressosCampanha: [],
    recompensas: [],
    messageHistory: [],
    messageTemplates: [],
    messageSequences: [],
    contatosCliente: [],
    metricasClientes: [],
    metricasClientesMensais: [],
    segmentosClientes: [],
    visitas: [],
    catalogOrders: [],
  };
}

function storageSandbox(data) {
  const businessId = "biz_boot_perf";
  const key = `adiFestaDB_v1:${businessId}`;
  const memory = new Map([
    ["adiFestaActiveBusinessId", businessId],
    [key, JSON.stringify(data)],
  ]);
  const writes = [];
  const localStorage = {
    getItem: (name) => (memory.has(name) ? memory.get(name) : null),
    setItem: (name, value) => {
      writes.push(name);
      memory.set(name, String(value));
    },
    removeItem: (name) => memory.delete(name),
  };
  const sandbox = {
    window: null,
    localStorage,
    structuredClone,
    crypto: webcrypto,
    Utils: { uuid: () => webcrypto.randomUUID() },
    PhoneUtils: {
      normalizeBrazilianPhone: (value) => String(value || "").replace(/\D/g, ""),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "storage.js" });
  return { DB: sandbox.DB, writes, key, raw: memory.get(key) };
}

test("leituras repetidas reutilizam a base em memória sem regravar localStorage", () => {
  const environment = storageSandbox(fixture());
  const firstStarted = performance.now();
  const first = environment.DB.carregar();
  const firstMs = performance.now() - firstStarted;
  const cachedStarted = performance.now();
  for (let index = 0; index < 250; index++)
    assert.strictEqual(environment.DB.carregar(), first);
  const cachedMs = performance.now() - cachedStarted;

  assert.equal(environment.writes.filter((key) => key === environment.key).length, 0);
  console.log(
    `[storage benchmark] initial=${firstMs.toFixed(2)}ms cached-250=${cachedMs.toFixed(2)}ms`,
  );
});

test("alteração persiste uma vez e troca de empresa invalida o cache", () => {
  const environment = storageSandbox(fixture(20, 40));
  environment.DB.carregar();
  environment.DB.alterar((data) => {
    data.config.telefone = "17999999999";
  });
  assert.equal(environment.writes.filter((key) => key === environment.key).length, 1);

  environment.DB.useBusiness("biz_other_company");
  assert.equal(environment.DB.carregar().clientes.length, 0);
  environment.DB.useBusiness("biz_boot_perf");
  assert.equal(environment.DB.carregar().clientes.length, 20);
  assert.equal(environment.DB.carregar().config.telefone, "17999999999");
});

