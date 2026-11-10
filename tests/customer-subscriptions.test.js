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
  vm.runInContext(fs.readFileSync('js/sale-money.js','utf8'),context);
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

test("meses e anos respeitam o último dia válido no calendário de São Paulo", () => {
  const { context, data } = runtime();
  const backend = require("../functions/src/shared/engagement-domain")(data).subscriptions;
  const samples = [
    ["2026-01-31T15:00:00.000Z", "months", "2026-02-28T15:00:00.000Z"],
    ["2028-01-31T15:00:00.000Z", "months", "2028-02-29T15:00:00.000Z"],
    ["2026-01-30T15:00:00.000Z", "months", "2026-02-28T15:00:00.000Z"],
    ["2026-01-15T15:00:00.000Z", "months", "2026-02-15T15:00:00.000Z"],
    ["2028-02-29T15:00:00.000Z", "years", "2029-02-28T15:00:00.000Z"],
    ["2026-02-01T01:30:00.000Z", "months", "2026-03-01T01:30:00.000Z"],
    ["2026-01-31", "months", "2026-02-28T03:00:00.000Z"],
  ];
  for (const [start, unit, expected] of samples) {
    assert.equal(context.CustomerSubscriptions.addDuration(start, 1, unit), expected);
    assert.equal(backend.addDuration(start, 1, unit), expected);
  }
});

test("renovações sucessivas recuperam o dia original, e contrato vencido inicia nova referência", () => {
  const { context, data } = runtime(), domain = context.CustomerSubscriptions;
  const activation = { renewalPolicyVersion: domain.renewalPolicyVersion, durationValue: 1, durationUnit: "months" };
  const create = (id, at, config = {}) => {
    const current = sale(id, at, { ...activation, ...config });
    current.spaceId = "space-a";
    domain.applySaleInData(data, current);
    return current;
  };
  create("first", "2026-01-31T15:00:00.000Z");
  const sub = data.customerSubscriptions[0];
  const renew = (id, at) => create(id, at, { subscriptionId: sub.id, expectedSubscription: domain.renewalSnapshot(sub) });
  assert.equal(sub.expiresAt, "2026-02-28T15:00:00.000Z");
  const march = renew("early", "2026-02-15T15:00:00.000Z");
  assert.equal(sub.expiresAt, "2026-03-31T15:00:00.000Z");
  domain.applySaleInData(data, march);
  assert.equal(sub.renewalCount, 1);
  assert.equal(data.customerSubscriptionEvents.length, 2);
  renew("late", "2026-04-12T15:00:00.000Z");
  assert.equal(sub.expiresAt, "2026-05-12T15:00:00.000Z");
  assert.equal(sub.renewalCalendarAnchor.day, 12);
  assert.equal(data.customerSubscriptionEvents[0].next.expiresAt, "2026-02-28T15:00:00.000Z");
  assert.equal(sub.spaceId, "space-a");
});

test("pacote legado mantém o cálculo original e renovação nova recusa outro espaço, ausência e versão antiga da vigência", () => {
  const { context, data } = runtime(), domain = context.CustomerSubscriptions;
  const initial = sale("old", "2026-01-31T15:00:00.000Z", { durationValue: 1, durationUnit: "months" });
  initial.spaceId = "space-a";
  domain.applySaleInData(data, initial);
  const sub = data.customerSubscriptions[0];
  assert.equal(sub.expiresAt, "2026-03-03T15:00:00.000Z");
  const renewal = sale("new", "2026-02-01T15:00:00.000Z", {
    subscriptionId: sub.id, renewalPolicyVersion: domain.renewalPolicyVersion, expectedSubscription: domain.renewalSnapshot(sub),
  });
  renewal.spaceId = "space-b";
  assert.throws(() => domain.applySaleInData(data, renewal), /espaço original/);
  renewal.spaceId = "space-a";
  renewal.itens[0].recurringActivation.subscriptionId = "absent";
  assert.throws(() => domain.applySaleInData(data, renewal), /disponível/);
  renewal.itens[0].recurringActivation.subscriptionId = sub.id;
  sub.contractedPrice = 29.9;
  assert.throws(() => domain.applySaleInData(data, renewal), /vigência mudou/);
  assert.equal(data.customerSubscriptions.length, 1);
  assert.equal(data.customerSubscriptionEvents.length, 1);
});

for (const method of ["pix", "dinheiro", "cartao", "fiado"]) {
  test("renovação reaproveita a venda canônica sem duplicar por " + method, () => {
    const { context, data } = salesRuntime(), domain = context.CustomerSubscriptions;
    const status = method === "fiado" ? "fiado" : "pago";
    const register = (operationId, recurringActivation) => context.Vendas.registrar({
      operationId, businessId: "business-a", spaceId: "space-a", clienteId: "client-a", status, formaPagamento: method,
      itens: [{ produtoId: "iptv", quantidade: 1, precoFinalUnitario: 25.9, recurringActivation }],
    });
    const policy = { renewalPolicyVersion: domain.renewalPolicyVersion, durationValue: 1, durationUnit: "months" };
    register("initial", policy);
    const sub = data.customerSubscriptions[0];
    const renewal = { ...policy, subscriptionId: sub.id, expectedSubscription: domain.renewalSnapshot(sub) };
    const confirmed = register("renewal", renewal);
    assert.equal(register("renewal", renewal).id, confirmed.id);
    assert.equal(confirmed.formaPagamento, method);
    assert.equal(data.vendas.length, 2);
    assert.equal(data.customerSubscriptionEvents.length, 2);
    assert.equal(data.customerSubscriptions[0].renewalCount, 1);
    assert.equal(data.clientes[0].saldo, method === "fiado" ? -51.8 : 0);
  });
}

function renewalCheckout() {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<div id="modal"></div><select id="sale-client"><option value="client-a">Ana</option></select><select id="sale-status"><option value="pago">Pago</option><option value="fiado">Fiado</option></select><select id="sale-payment-method"><option value="pix">Pix</option></select>', { runScripts: "outside-only" });
  const w = dom.window, client = { id: "client-a", nome: "Ana" }, toasts = [], reads = [], added = [];
  let space = "space-a";
  const product = { id: "iptv", nome: "Serviço IPTV", productType: "recurring", durationValue: 1, durationUnit: "months", preco: 32 },
    variant = { id: "premium", parentProductId: product.id, displayName: "Premium", price: 42 },
    base = { businessId: "business-a", clientId: client.id, productId: product.id, spaceId: space, durationValue: 1, durationUnit: "months", contractedPrice: 42, status: "active" },
    rows = [
      { ...base, id: "first", label: "Primeira", expiresAt: "2096-01-10T15:00:00.000Z" },
      { ...base, id: "selected", label: "Selecionada", variantId: variant.id, expiresAt: "2096-01-31T15:00:00.000Z" },
      { ...base, id: "other", label: "Outro espaço", spaceId: "space-b", expiresAt: "2096-01-12T15:00:00.000Z" },
    ];
  const data = { produtos: [product], customerSubscriptions: rows };
  Object.assign(w, {
    structuredClone,
    Utils: { escapar: String, dinheiro: String, somenteNumeros: String, uuid: () => "draft-id", toast: message => toasts.push(message) },
    DB: { carregar: () => data, getBusinessId: () => "business-a" },
    Router: { atual: () => "vender" },
    SpaceContext: { salesId: () => space, viewScope: () => space, selectedSales: () => ({ name: "Espaço A" }), showsRenewal: item => item.spaceId === space },
    Repositories: { productRepository: () => ({ getById: () => product }), clientRepository: () => ({ getById: () => client }) },
    ProductVariations: {
      get: id => id === variant.id ? variant : null, displayName: item => item.displayName,
      saleItem: (item, choice, quantidade) => ({ produtoId: item.id, variantId: choice?.id, nome: item.nome, quantidade }),
    },
    SyncFirebase: { queryCustomerSubscriptions: async query => { reads.push(query); return rows.filter(item => item.id === query.subscriptionId); } },
  });
  for (const file of ["js/customer-subscriptions.js", "js/checkout.js"]) w.eval(fs.readFileSync(file, "utf8"));
  w.addEventListener("sale-item-added", event => added.push(event.detail.item));
  return { w, dom, toasts, reads, rows, added, changeSpace: value => { space = value; } };
}

test("atalho do perfil fixa a segunda vigência e impede repetir a confirmação do modal", async () => {
  const h = renewalCheckout();
  try {
    assert.equal(h.w.Checkout.prepareRenewal("selected"), true);
    await new Promise(setImmediate);
    assert.equal(h.reads[0].subscriptionId, "selected");
    const modal = h.w.document.querySelector("#modal");
    for (const text of ["Ana", "Serviço IPTV", "Premium", "Espaço A", "31/01/2096", "29/02/2096"])
      assert.ok(modal.textContent.includes(text), text);
    assert.equal(modal.querySelector('[name="contractedPrice"]').value, "42.00");
    assert.equal(modal.querySelectorAll('[name="subscriptionChoice"]').length, 0);
    const button = modal.querySelector("[data-confirm-recurring]");
    button.onclick();
    button.onclick();
    assert.equal(h.w.Checkout.cartCount(), 1);
    assert.equal(h.added[0].recurringActivation.subscriptionId, "selected");
    assert.equal(h.added[0].variantId, "premium");
  } finally { h.dom.window.close(); }
});

test("atalho recusa vigência de outro espaço, removida ou alterada durante a confirmação", async () => {
  const h = renewalCheckout();
  try {
    assert.equal(h.w.Checkout.prepareRenewal("other"), false);
    assert.match(h.toasts.at(-1), /vigência selecionada não está mais disponível/);
    h.w.SyncFirebase.queryCustomerSubscriptions = async () => [];
    h.w.Checkout.prepareRenewal("selected");
    await new Promise(setImmediate);
    assert.match(h.toasts.at(-1), /vigência selecionada não está mais disponível/);
    h.w.SyncFirebase.queryCustomerSubscriptions = async () => [h.rows[1]];
    h.w.Checkout.prepareRenewal("selected");
    await new Promise(setImmediate);
    h.rows[1].expiresAt = "2096-02-10T15:00:00.000Z";
    const button = h.w.document.querySelector("[data-confirm-recurring]");
    button.onclick();
    assert.match(h.toasts.at(-1), /vigência mudou/);
    h.changeSpace("space-b");
    button.onclick();
    assert.match(h.toasts.at(-1), /cliente ou o espaço mudou/);
    assert.equal(h.w.Checkout.cartCount(), 0);
  } finally { h.dom.window.close(); }
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
  assert.match(worker, /js\/customer-subscriptions\.js/);
  assert.match(worker, /js\/firebase\/sync\.js/);
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
