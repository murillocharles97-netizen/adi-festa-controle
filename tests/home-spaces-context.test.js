const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const spacesSource = fs.readFileSync("js/spaces.js", "utf8");
const desktopSource = fs.readFileSync("js/desktop-dashboard.js", "utf8");
const mobileSource = fs.readFileSync("js/home-mobile.js", "utf8");

function fixture() {
  const now = new Date().toISOString();
  return {
    config: {
      nome: "Empresa teste",
      dashboard: {
        dailySalesGoal: 1000,
        dailySalesGoalsBySpaceId: { "space-a": 100, "space-b": 200 },
      },
    },
    vendas: [
      { id: "sale-a", spaceId: "space-a", clienteId: "client-a", clienteNome: "Ana", status: "pago", data: now, valorFinal: 40, lucro: 18, itens: [{ produtoId: "product-all", nome: "Comum", quantidade: 2, subtotalFinal: 40 }] },
      { id: "sale-b", spaceId: "space-b", clienteId: "client-b", clienteNome: "Bia", status: "pago", data: now, valorFinal: 60, lucro: 20, itens: [{ produtoId: "product-b", nome: "B", quantidade: 1, subtotalFinal: 60 }] },
      { id: "sale-legacy", clienteId: "client-legacy", clienteNome: "Legado", status: "pago", data: now, valorFinal: 70, lucro: 25, itens: [] },
      { id: "sale-cancelled", spaceId: "space-a", clienteId: "client-cancelled", status: "cancelada", data: now, valorFinal: 500, lucro: 500, itens: [] },
    ],
    pagamentos: [
      { id: "payment-a", spaceId: "space-a", data: now, valor: 10 },
      { id: "payment-b", spaceId: "space-b", data: now, valor: 20 },
      { id: "payment-legacy", data: now, valor: 5 },
    ],
    clientes: [
      { id: "client-a", nome: "Ana", ativo: true, saldo: 0, criadoEm: now, ultimaCompra: now, totalComprado: 40, quantidadeVendas: 1 },
      { id: "client-b", nome: "Bia", ativo: true, saldo: 0, criadoEm: now, ultimaCompra: now, totalComprado: 60, quantidadeVendas: 1 },
      { id: "client-legacy", nome: "Legado", ativo: true, saldo: 0, criadoEm: now, ultimaCompra: now, totalComprado: 70, quantidadeVendas: 1 },
      { id: "client-cancelled", nome: "Cancelado", ativo: true, saldo: 0, criadoEm: now, ultimaCompra: now, totalComprado: 500, quantidadeVendas: 1 },
    ],
    produtos: [
      { id: "product-all", nome: "Comum", ativo: true, estoqueAtual: 10 },
      { id: "product-a", nome: "A", ativo: true, estoqueAtual: 10, spaceAccessMode: "single_space", defaultSpaceId: "space-a" },
      { id: "product-b", nome: "B", ativo: true, estoqueAtual: 10, spaceAccessMode: "single_space", defaultSpaceId: "space-b" },
    ],
    campanhas: [],
    progressosCampanha: [],
    recompensas: [],
    catalogOrders: [],
  };
}

function runtime(data) {
  const storage = new Map();
  let reads = 0;
  const app = {};
  const sandbox = {
    window: null,
    console,
    performance,
    structuredClone,
    Date,
    Map,
    Set,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    addEventListener() {},
    dispatchEvent() {},
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    DB: {
      carregar() {
        reads++;
        return data;
      },
      getBusinessId: () => "business-a",
    },
    BusinessContext: {
      get: () => ({
        businessId: "business-a",
        business: { name: "Empresa teste" },
      }),
    },
    FirebaseSession: {
      businessId: "business-a",
      user: { uid: "owner-a" },
      profile: { uid: "owner-a", name: "Murillo", role: "owner" },
    },
    Utils: {
      hoje: (value) =>
        new Date(value).toDateString() === new Date().toDateString(),
      dinheiro: (value) => `R$ ${Number(value).toFixed(2)}`,
      escapar: (value) => String(value),
    },
    OperationMode: { enabled: () => false },
    Campanhas: {
      metricas: () => ({ active: 0, participants: 0, redemptions: 0, conversion: 0 }),
      status: () => "",
    },
    CustomerSubscriptions: {
      metrics: () => ({ dueToday: 0, due7: 0, forecastValue: 0 }),
    },
    getProductStockStatus: () => "disponivel",
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    MutationObserver: class MutationObserver {
      observe() {}
    },
    document: {
      querySelector: (selector) => (selector === "#app" ? app : null),
    },
    queueMicrotask() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(spacesSource, sandbox);
  sandbox.SpaceContext.setSpaces([
    { id: "space-a", businessId: "business-a", name: "Unidade A", type: "business", operationalType: "unit", capabilities: { finance: true, sales: true, products: true, goals: true } },
    { id: "space-b", businessId: "business-a", name: "Unidade B", type: "business", operationalType: "unit", capabilities: { finance: true, sales: true, products: true, goals: true } },
  ]);
  vm.runInContext(desktopSource, sandbox);
  vm.runInContext(mobileSource, sandbox);
  return { sandbox, reads: () => reads, resetReads: () => { reads = 0; } };
}

test("Home específica usa apenas dados atribuídos e ignora venda cancelada", () => {
  const { sandbox } = runtime(fixture());
  sandbox.SpaceContext.selectHome("space-a");

  const desktop = sandbox.DesktopDashboard.aggregate(fixture(), "today");
  assert.deepEqual(Array.from(desktop.sales, (sale) => sale.id), ["sale-a"]);
  assert.deepEqual(Array.from(desktop.clients, (client) => client.id), ["client-a"]);
  assert.deepEqual(Array.from(desktop.products, (product) => product.id), ["product-all", "product-a"]);
  assert.equal(desktop.todayRevenue, 40);
  assert.equal(desktop.receivedToday, 10);
  assert.equal(desktop.goal, 100);
  assert.equal(desktop.goalPercent, 40);
  assert.equal(desktop.unassignedLegacySales, 1);

  const mobile = sandbox.MobileHome.model();
  assert.deepEqual(Array.from(mobile.sales, (sale) => sale.id), ["sale-a"]);
  assert.deepEqual(Array.from(mobile.clients, (client) => client.id), ["client-a"]);
  assert.equal(mobile.sold, 40);
  assert.equal(mobile.goal, 100);
  assert.equal(mobile.unassignedLegacySales, 1);
});

test("Todos os espaços mantém legados e usa meta geral independente", () => {
  const data = fixture(), { sandbox, reads, resetReads } = runtime(data);
  sandbox.SpaceContext.selectHome(sandbox.SpaceContext.ALL_SPACES);

  const view = sandbox.DesktopDashboard.aggregate(data, "today");
  assert.deepEqual(Array.from(view.sales, (sale) => sale.id), ["sale-a", "sale-b", "sale-legacy"]);
  assert.equal(view.todayRevenue, 170);
  assert.equal(view.goal, 1000);
  assert.equal(view.goalPercent, 17);
  assert.equal(view.unassignedLegacySales, 1);

  resetReads();
  const html = sandbox.DesktopDashboard.render();
  assert.equal(reads(), 1);
  assert.match(html, /data-space-context="home"/);
  assert.match(html, /Meta geral diária/);
  assert.match(html, /1 venda antiga sem espaço/);
});
