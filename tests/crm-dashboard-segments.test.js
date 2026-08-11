const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/crm-dashboard.js", "utf8");
const metricsSource = fs.readFileSync("js/customer-metrics.js", "utf8");
const DAY = 86400000;
const isoDaysAgo = (days) => new Date(Date.now() - days * DAY).toISOString();

function setup(customize) {
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
  customize?.(data);
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
  vm.runInContext(metricsSource, context);
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
  context.CRMDashboard.state.period = "30d";
  context.CRMDashboard.state.segment = "inactive30";
  context.CRMDashboard.invalidate();
  assert.deepEqual(ids(context.CRMDashboard.snapshot()), ["b", "c"]);
  context.CRMDashboard.state.segment = "inactive60";
  const inactive60 = context.CRMDashboard.snapshot();
  assert.deepEqual(ids(inactive60), ["c"]);
  assert.equal(inactive60.summary.inactive, 1, "quem nunca comprou não entra no KPI de inatividade");
});

test("clientes recuperados reutilizam o histórico central de compras", () => {
  const context = setup((data) => {
    data.clientes.push({ id: "recovered", nome: "Cliente recuperado", ativo: true });
    data.vendas.push(
      { id: "recovered-old", clienteId: "recovered", valorFinal: 10, data: isoDaysAgo(70), itens: [] },
      { id: "recovered-new", clienteId: "recovered", valorFinal: 20, data: isoDaysAgo(5), itens: [] },
    );
  });
  context.CRMDashboard.state.period = "30d";
  context.CRMDashboard.invalidate();
  assert.equal(context.CRMDashboard.snapshot().summary.recovered, 1);
});

test("período analítico não limita o universo dos segmentos de inatividade", () => {
  const context = setup();
  for (const period of ["today", "7d", "30d", "month"]) {
    context.CRMDashboard.state.period = period;
    context.CRMDashboard.state.segment = "inactive30";
    context.CRMDashboard.invalidate();
    assert.deepEqual(ids(context.CRMDashboard.snapshot()), ["b", "c"], period);
  }
});

test("CRM mobile e desktop compartilham a mesma seleção central", () => {
  const context = setup();
  context.CRMDashboard.state.period = "30d";
  context.CRMDashboard.state.segment = "inactive30";
  context.CRMDashboard.invalidate();
  const centralIds = ids(context.CRMDashboard.snapshot());
  assert.deepEqual(centralIds, ["b", "c"]);
  assert.match(fs.readFileSync("js/crm-mobile.js", "utf8"), /CRMDashboard\.snapshot\(\)/);
  assert.match(source, /CustomerMetricsService\.isInactive\(metric,30\)/);
});

test("segmento remoto busca somente ultimaCompra anterior ao limite", () => {
  const sync = fs.readFileSync("js/firebase/sync.js", "utf8");
  assert.match(sync, /queryClientsByInactivity/);
  assert.match(sync, /field: "ultimaCompra", operator: "<=", value: cutoff/);
  assert.match(sync, /includeInactive: true/);
  assert.doesNotMatch(sync.match(/async function queryClientsByInactivity[\s\S]*?\n\}/)?.[0] || "", /queryAllClientsForAction/);
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
  const central = context.CustomerMetricsService.build(context.DB.carregar()).byClient;
  for (const id of ["a", "b", "c"]) {
    assert.equal(rows.get(id).metric.totalSpent, central.get(id).totalSpent);
    assert.equal(rows.get(id).metric.purchaseCount, central.get(id).purchaseCount);
    assert.equal(rows.get(id).metric.lastPurchaseAt, central.get(id).lastPurchaseAt);
  }
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

test("CRM mantém o resultado completo separado dos 20 cards visíveis", () => {
  assert.match(source, /currentCRMResult=\{clientIds:\[\],count:0/);
  assert.match(source, /clientIds:list\.map\(row=>row\.client\.id\)/);
  assert.match(source, /queryAllClientsForAction/);
  assert.match(source, /complete:true/);
});

test("ações mobile reutilizam os três CSVs e criam campanha com o segmento", () => {
  const mobileSource = fs.readFileSync("js/crm-mobile.js", "utf8");
  const fixture = fs.readFileSync("tests/crm-segment-actions.fixture.html", "utf8");
  assert.match(mobileSource, /data-crm-actions/);
  assert.match(mobileSource, /CRMDashboard\.openActions/);
  for (const kind of ["complete", "contacts", "marketing"])
    assert.match(source, new RegExp(`data-segment-export=\\"${kind}\\"`));
  assert.match(source, /adiFestaCampaignAudience/);
  assert.match(fixture, /Ações do segmento/);
});

test("wizard consome público CRM somente dentro da mesma empresa", () => {
  const desktopCampaigns = fs.readFileSync("js/campanhas-ui.js", "utf8");
  const mobileCampaigns = fs.readFileSync("js/campanhas-mobile.js", "utf8");
  assert.match(desktopCampaigns, /payload\.businessId&&payload\.businessId!==businessId/);
  assert.match(desktopCampaigns, /takePendingAudience/);
  assert.match(mobileCampaigns, /uma única interface e um único contrato para mobile e desktop/);
  assert.match(desktopCampaigns, /type:'clients',clientIds/);
});

test("cache PWA publica a revisão da busca e das ações", () => {
  const worker = fs.readFileSync("service-worker.js", "utf8");
  assert.match(worker, /adi-festa-v86-campaigns-v2-final/);
  assert.match(worker, /customer-metrics\.js/);
  assert.match(worker, /client-cloud-pagination\.js/);
  assert.match(worker, /crm-mobile\.js/);
});
