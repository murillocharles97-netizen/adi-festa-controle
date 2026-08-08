const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/crm-dashboard.js", "utf8");
const DAY = 86400000;
const isoDaysAgo = (days) => new Date(Date.now() - days * DAY).toISOString();

function setup() {
  const clients = [
    { id: "a", nome: "Cliente A", telefone: "17999990001", ativo: true, totalComprado: 200, quantidadeVendas: 4, ultimaCompra: isoDaysAgo(0), dataNascimento: new Date().toISOString().slice(0, 10) },
    { id: "b", nome: "Cliente B", telefone: "17999990002", ativo: true, totalComprado: 100, quantidadeVendas: 2, ultimaCompra: isoDaysAgo(35) },
    { id: "c", nome: "Cliente C", telefone: "17999990003", ativo: true, totalComprado: 50, quantidadeVendas: 1, ultimaCompra: isoDaysAgo(70) },
    { id: "d", nome: "Cliente D", telefone: "", ativo: true, totalComprado: 0, quantidadeVendas: 0, ultimaCompra: null },
  ];
  const sales = [
    { id: "sa", clienteId: "a", valorFinal: 200, data: isoDaysAgo(0), itens: [] },
    { id: "sb", clientId: "b", valorFinal: 100, data: isoDaysAgo(35), itens: [] },
    { id: "sc", customerId: "c", valorFinal: 50, data: isoDaysAgo(70), itens: [] },
  ];
  const data = {
    clientes: clients,
    vendas: sales,
    produtos: [],
    contatosCliente: [{ id: "contact-a", clienteId: "a", data: isoDaysAgo(2) }],
    messageHistory: [],
    metricasClientes: [],
    progressosCampanha: [{ id: "reward-b", clientId: "b", availableRewards: 1 }],
  };
  const context = {
    window: null,
    DB: { carregar: () => structuredClone(data), alterar() {} },
    Utils: { dinheiro: (value) => `R$ ${Number(value).toFixed(2)}`, escapar: (value) => String(value), uuid: () => "id" },
    OperationMode: { enabled: () => true },
    Date, Map, Set, Math, Number, String, Array, Object, JSON, Blob,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    document: { querySelector: () => null, createElement: () => ({ click() {} }) },
    matchMedia: () => ({ matches: false }),
    prompt: () => null,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

const ids = (snapshot) => snapshot.list.map((row) => row.client.id);

test("Melhores clientes usa compras do período e não exige classificação VIP", () => {
  const context = setup();
  context.CRMDashboard.state.period = "all";
  context.CRMDashboard.state.segment = "top";
  context.CRMDashboard.invalidate();
  assert.deepEqual(ids(context.CRMDashboard.snapshot()), ["a", "b", "c"]);
});

test("segmentos de 30 e 60 dias ignoram quem nunca comprou", () => {
  const context = setup();
  context.CRMDashboard.state.period = "all";
  context.CRMDashboard.state.segment = "inactive30";
  context.CRMDashboard.invalidate();
  assert.deepEqual(ids(context.CRMDashboard.snapshot()), ["b", "c"]);
  context.CRMDashboard.state.segment = "inactive60";
  assert.deepEqual(ids(context.CRMDashboard.snapshot()), ["c"]);
});

test("novos, aniversariantes, sem contato e recompensas usam dados reais", () => {
  const context = setup();
  context.CRMDashboard.state.period = "30d";
  context.CRMDashboard.state.segment = "new";
  context.CRMDashboard.invalidate();
  assert.deepEqual(ids(context.CRMDashboard.snapshot()), ["a"]);
  context.CRMDashboard.state.segment = "birthday";
  assert.deepEqual(ids(context.CRMDashboard.snapshot()), ["a"]);
  context.CRMDashboard.state.segment = "reward";
  assert.deepEqual(ids(context.CRMDashboard.snapshot()), ["b"]);
  context.CRMDashboard.state.segment = "no-contact";
  assert.deepEqual(new Set(ids(context.CRMDashboard.snapshot())), new Set(["b", "c", "d"]));
});

test("aliases de cliente nas vendas alimentam o mesmo CRM", () => {
  const context = setup();
  context.CRMDashboard.state.period = "all";
  context.CRMDashboard.state.segment = "";
  context.CRMDashboard.invalidate();
  const rows = new Map(context.CRMDashboard.snapshot().results.map((row) => [row.client.id, row]));
  assert.equal(rows.get("a").period.spent, 200);
  assert.equal(rows.get("b").period.spent, 100);
  assert.equal(rows.get("c").period.spent, 50);
  assert.equal(rows.get("b").metric.availableRewards, 1);
});

test("CRM mobile é exclusivo do breakpoint e reutiliza ClientActions", () => {
  const mobileSource = fs.readFileSync("js/crm-mobile.js", "utf8");
  const css = fs.readFileSync("css/crm-mobile.css", "utf8");
  assert.match(mobileSource, /max-width:767px/);
  assert.match(mobileSource, /ClientActions\?\.openSheet/);
  assert.match(mobileSource, /current\.limit\s*\+=\s*20/);
  assert.match(css, /@media \(max-width:767px\)/);
});

test("desktop preserva o dashboard existente", () => {
  const context = setup();
  const html = context.CRMDashboard.render();
  assert.match(html, /crm-dashboard-page/);
  assert.match(html, /crm-dashboard-kpis/);
  assert.doesNotMatch(html, /crm-mobile-page/);
});
