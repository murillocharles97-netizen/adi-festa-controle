const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-08-14T12:00:00.000Z"])); }
  static now() { return new Date("2026-08-14T12:00:00.000Z").getTime(); }
}

function runtime() {
  let sequence = 0;
  const data = {
    produtos: [{ id: "iptv", nome: "IPTV", productType: "recurring", durationValue: 30, durationUnit: "days", preco: 25.9, renewalReminders: [7, 1, 0] }],
    variacoesProdutos: [], customerSubscriptions: [], customerSubscriptionEvents: [],
  };
  const context = {
    console, structuredClone, Date: FixedDate, Math, Number, String, Set, Array, Object,
    Utils: { uuid: () => `sub-${++sequence}` },
    DB: { carregar: () => data, alterar(mutator) { mutator(data); return data; }, getBusinessId: () => "business-a" },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/customer-subscriptions.js", "utf8"), context);
  return { context, data };
}

function salesRuntime() {
  let sequence = 0, campaignStatus = null;
  const data = {
    produtos: [{ id: "iptv", nome: "IPTV", productType: "recurring", durationValue: 30, durationUnit: "days", preco: 25.9, custo: 0, semControleEstoque: true, controlaEstoque: false }],
    variacoesProdutos: [], clientes: [{ id: "client-a", nome: "Ana", saldo: 0, totalComprado: 0, quantidadeVendas: 0 }],
    vendas: [], pagamentos: [], movimentacoes: [], movimentacoesEstoque: [], customerSubscriptions: [], customerSubscriptionEvents: [],
  };
  const context = {
    console, structuredClone, Date: FixedDate, Math, Number, String, Set, Map, Array, Object, Error,
    Utils: { uuid: () => `id-${++sequence}` },
    DB: { carregar: () => data, alterar(mutator) { mutator(data); return data; }, getBusinessId: () => "business-a" },
    Produtos: { obter: id => data.produtos.find(item => item.id === id) },
    ProductVariations: { get: () => null, recomputeInData() {} },
    Campanhas: { aplicarBeneficios: items => items, aplicarVendaNoBanco(_db, currentSale) { campaignStatus = currentSale.status; return [{ status: currentSale.status === "fiado" ? "pending" : "confirmed" }]; }, validarReversaoVendaNoBanco() {}, reverterVendaNoBanco() {} },
    PlanLimitService: null, dispatchEvent() {}, CustomEvent: function CustomEvent() {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/customer-subscriptions.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("js/vendas.js", "utf8"), context);
  return { context, data, campaignStatus: () => campaignStatus };
}

const sale = (id, date, activation = {}) => ({
  id, clienteId: "client-a", data: date, itens: [{ produtoId: "iptv", nome: "IPTV", productType: "recurring", quantidade: 1, precoFinalUnitario: 25.9, recurringActivation: { durationValue: 30, durationUnit: "days", contractedPrice: 25.9, ...activation } }],
});

test("primeira venda cria vigência multiempresa e repetir a operação é idempotente", () => {
  const { context, data } = runtime(), current = sale("sale-1", "2026-08-14T12:00:00.000Z");
  context.CustomerSubscriptions.applySaleInData(data, current);
  context.CustomerSubscriptions.applySaleInData(data, current);
  assert.equal(data.customerSubscriptions.length, 1);
  assert.equal(data.customerSubscriptionEvents.length, 1);
  assert.equal(data.customerSubscriptions[0].businessId, "business-a");
  assert.equal(current.itens[0].subscriptionAction, "activation");
  assert.equal(current.itens[0].subscriptionExpiresAt, "2026-09-13T12:00:00.000Z");
});

test("renovação antecipada soma ao vencimento atual e preserva preço contratado editável", () => {
  const { context, data } = runtime(), first = sale("sale-1", "2026-08-14T12:00:00.000Z");
  context.CustomerSubscriptions.applySaleInData(data, first);
  const renewal = sale("sale-2", "2026-09-01T12:00:00.000Z", { subscriptionId: first.itens[0].subscriptionId, contractedPrice: 29.9 });
  context.CustomerSubscriptions.applySaleInData(data, renewal);
  assert.equal(data.customerSubscriptions[0].expiresAt, "2026-10-13T12:00:00.000Z");
  assert.equal(data.customerSubscriptions[0].contractedPrice, 29.9);
  assert.equal(data.customerSubscriptions[0].renewalCount, 1);
  assert.equal(renewal.itens[0].subscriptionAction, "renewal");
});

test("renovação vencida começa na data da nova venda", () => {
  const { context, data } = runtime(), first = sale("sale-1", "2026-08-14T12:00:00.000Z");
  context.CustomerSubscriptions.applySaleInData(data, first);
  const renewal = sale("sale-2", "2026-09-20T12:00:00.000Z", { subscriptionId: first.itens[0].subscriptionId });
  context.CustomerSubscriptions.applySaleInData(data, renewal);
  assert.equal(data.customerSubscriptions[0].expiresAt, "2026-10-20T12:00:00.000Z");
});

test("mesmo cliente pode possuir duas vigências do mesmo produto", () => {
  const { context, data } = runtime(), home = sale("sale-home", "2026-08-14T12:00:00.000Z", { label: "Casa" }), office = sale("sale-office", "2026-08-14T13:00:00.000Z", { label: "Escritório" });
  context.CustomerSubscriptions.applySaleInData(data, home);
  context.CustomerSubscriptions.applySaleInData(data, office);
  assert.equal(data.customerSubscriptions.length, 2);
  assert.deepEqual(data.customerSubscriptions.map(item => item.label), ["Casa", "Escritório"]);
});

test("renovação pode trocar variação e registra mudanças de plano e preço", () => {
  const { context, data } = runtime();
  data.variacoesProdutos.push(
    { id: "basic", parentProductId: "iptv", displayName: "1 tela", price: 25.9 },
    { id: "premium", parentProductId: "iptv", displayName: "Premium", price: 39.9 },
  );
  const first = sale("sale-basic", "2026-08-14T12:00:00.000Z");
  first.itens[0].variantId = "basic";
  context.CustomerSubscriptions.applySaleInData(data, first);
  const renewal = sale("sale-premium", "2026-09-01T12:00:00.000Z", {
    subscriptionId: first.itens[0].subscriptionId,
    contractedPrice: 39.9,
  });
  renewal.itens[0].variantId = "premium";
  context.CustomerSubscriptions.applySaleInData(data, renewal);
  assert.equal(data.customerSubscriptions[0].variantId, "premium");
  assert.equal(data.customerSubscriptions[0].contractedPrice, 39.9);
  assert.ok(data.customerSubscriptionEvents.some(item => item.transition === "plan_changed"));
  assert.ok(data.customerSubscriptionEvents.some(item => item.transition === "price_changed"));
});

test("pausar, reativar e cancelar preserva histórico; desfazer restaura vigência", () => {
  const { context, data } = runtime(), first = sale("sale-1", "2026-08-14T12:00:00.000Z");
  context.CustomerSubscriptions.applySaleInData(data, first);
  const id = first.itens[0].subscriptionId;
  assert.equal(context.CustomerSubscriptions.changeStatus(id, "paused").status, "paused");
  assert.equal(context.CustomerSubscriptions.changeStatus(id, "active").status, "active");
  assert.equal(context.CustomerSubscriptions.changeStatus(id, "cancelled").status, "cancelled");
  assert.ok(data.customerSubscriptionEvents.some(item => item.transition === "paused"));
  context.CustomerSubscriptions.reverseSaleInData(data, first);
  assert.equal(data.customerSubscriptions.length, 0);
  assert.ok(data.customerSubscriptionEvents.some(item => item.transition === "sale_reversed"));
});

test("métricas locais excluem pausadas/canceladas e usam preço contratado", () => {
  const { context, data } = runtime(), current = sale("sale-1", "2026-08-14T12:00:00.000Z", { durationValue: 3, contractedPrice: 40 });
  context.CustomerSubscriptions.applySaleInData(data, current);
  const metrics = context.CustomerSubscriptions.metrics("2026-08-14T12:00:00.000Z");
  assert.equal(metrics.due7, 1);
  assert.equal(metrics.forecastValue, 40);
  context.CustomerSubscriptions.changeStatus(current.itens[0].subscriptionId, "paused");
  assert.equal(context.CustomerSubscriptions.metrics("2026-08-14T12:00:00.000Z").forecastValue, 0);
});

test("helpers segmentam vencimentos, pausadas, vencidas e renovações recentes sem varredura global", async () => {
  const { context, data } = runtime();
  const due = sale("sale-due", "2026-08-14T12:00:00.000Z", { durationValue: 3, contractedPrice: 40 });
  const old = sale("sale-old", "2026-06-01T12:00:00.000Z", { durationValue: 30, label: "Vencida" });
  context.CustomerSubscriptions.applySaleInData(data, due);
  context.CustomerSubscriptions.applySaleInData(data, old);
  const paused = sale("sale-paused", "2026-08-14T13:00:00.000Z", { durationValue: 30, label: "Pausada" });
  context.CustomerSubscriptions.applySaleInData(data, paused);
  context.CustomerSubscriptions.changeStatus(paused.itens[0].subscriptionId, "paused");
  assert.equal((await context.CustomerSubscriptions.loadExpiring(7, "2026-08-14T12:00:00.000Z")).length, 1);
  assert.equal((await context.CustomerSubscriptions.loadExpired("2026-08-14T12:00:00.000Z")).length, 1);
  assert.equal((await context.CustomerSubscriptions.loadByStatus("paused")).length, 1);
  const dashboard = await context.CustomerSubscriptions.loadDashboardMetrics("2026-08-14T12:00:00.000Z");
  assert.equal(dashboard.dueToday, 0);
  assert.equal(dashboard.due7, 1);
  assert.equal(dashboard.expired, 1);
  assert.equal(dashboard.forecastValue, 40);
});

test("integração usa consulta limitada por cliente/vencimento e recibo não exibe custo", () => {
  const sync = fs.readFileSync("js/firebase/sync.js", "utf8"), receipt = fs.readFileSync("js/recibos.js", "utf8"), worker = fs.readFileSync("service-worker.js", "utf8");
  assert.match(sync, /queryCustomerSubscriptions/);
  assert.match(sync, /expiresAt/);
  assert.match(sync, /Math\.min\(50/);
  assert.match(receipt, /subscriptionExpiresAt/);
  assert.match(receipt, /Vigência da renovação/);
  assert.doesNotMatch(receipt, /custoUnitario|Custo total|Lucro/);
  assert.match(worker, /adi-festa-v114-recurring-entitlement-reconcile/);
});

test("venda recorrente exige cliente; fiado ativa na hora, aumenta dívida e mantém campanha pendente", () => {
  const { context, data, campaignStatus } = salesRuntime(), item = { produtoId: "iptv", nome: "IPTV", productType: "recurring", quantidade: 1, precoOriginal: 25.9, precoFinalUnitario: 25.9, custoUnitario: 0, recurringActivation: { durationValue: 30, durationUnit: "days", contractedPrice: 25.9 } };
  assert.throws(() => context.Vendas.registrar({ operationId: "anonymous", status: "pago", itens: [item] }), /exige um cliente/);
  assert.equal(data.vendas.length, 0);
  const currentSale = context.Vendas.registrar({ operationId: "credit-renewal", clienteId: "client-a", status: "fiado", itens: [item] });
  assert.equal(data.customerSubscriptions.length, 1);
  assert.equal(data.customerSubscriptions[0].status, "active");
  assert.equal(data.clientes[0].saldo, -25.9);
  assert.equal(campaignStatus(), "fiado");
  assert.equal(currentSale.campaignUpdates[0].status, "pending");
  assert.equal(data.movimentacoesEstoque.length, 0);
});

test("desfazer venda recorrente restaura saldo e remove a primeira vigência", () => {
  const { context, data } = salesRuntime(), item = { produtoId: "iptv", nome: "IPTV", productType: "recurring", quantidade: 1, precoOriginal: 25.9, precoFinalUnitario: 25.9, custoUnitario: 0, recurringActivation: { durationValue: 30, durationUnit: "days", contractedPrice: 25.9 } };
  context.Vendas.registrar({ operationId: "credit-renewal", clienteId: "client-a", status: "fiado", itens: [item] });
  context.Vendas.desfazerUltima();
  assert.equal(data.customerSubscriptions.length, 0);
  assert.equal(data.clientes[0].saldo, 0);
  assert.ok(data.customerSubscriptionEvents.some(event => event.transition === "sale_reversed"));
});
