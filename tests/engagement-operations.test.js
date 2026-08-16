const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-08-15T15:00:00.000Z"])); }
  static now() { return new Date("2026-08-15T15:00:00.000Z").getTime(); }
}

function loadSegments(data) {
  const context = {
    console,
    Date: FixedDate,
    Intl,
    Math,
    Number,
    String,
    Object,
    Set,
    Map,
    crypto: { randomUUID: () => "segment-operation" },
    Utils: { uuid: () => "segment-operation" },
    DB: {
      getBusinessId: () => "business-a",
      carregar: () => data,
      alterar: (mutator) => mutator(data),
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/engagement-segments.js"), "utf8"), context);
  return context.EngagementSegments;
}

const baseData = () => ({
  campanhas: [{ id: "campaign-a", type: "buy_get", rule: { requiredQuantity: 10 }, rewards: [] }],
  progressosCampanha: [{ campaignId: "campaign-a", clientId: "client-a", confirmedProgress: 8, availableRewards: 0, lastQualifiedAt: "2026-08-10T12:00:00.000Z" }],
  customerSubscriptions: [{ id: "renewal-a", clientId: "client-a", status: "active", expiresAt: "2026-08-20T12:00:00.000Z" }],
  vendas: [{ id: "sale-a", clienteId: "client-a", status: "pago", itens: [{ produtoId: "product-a", categoria: "Bebidas" }] }],
  segmentosClientes: [],
});

const row = {
  client: { id: "client-a", nome: "Ana", saldo: 0, criadoEm: "2026-08-01T12:00:00.000Z" },
  metric: { totalSpent: 720, purchaseCount: 8, daysSinceLastPurchase: 35, lastPurchaseAt: "2026-07-11T12:00:00.000Z", openBalance: 120 },
  classifications: ["VIP"],
};

test("segmentos prontos compartilham renovação, recompensa, dívida e inatividade", () => {
  const data = baseData(), service = loadSegments(data);
  assert.equal(service.matchesPreset("inactive30", row, data), true);
  assert.equal(service.matchesPreset("renewal7", row, data), true);
  assert.equal(service.matchesPreset("vip", row, data), true);
  assert.equal(service.matchesPreset("nearReward", row, data), true);
  assert.equal(service.matchesPreset("debt", row, data), true);
  assert.equal(service.progressRatio(data.campanhas[0], data.progressosCampanha[0]), 0.8);
});

test("filtro personalizado aceita AND, OR, entre e relações", () => {
  const data = baseData(), service = loadSegments(data);
  const conditions = [
    { field: "totalSpent", operator: "between", value: 500, valueTo: 800 },
    { field: "product", operator: "has", value: "product-a" },
    { field: "category", operator: "has", value: "bebidas" },
    { field: "nearReward", operator: "eq", value: true },
  ];
  assert.equal(service.matchesConditions(row, conditions, "all", data), true);
  assert.equal(service.matchesConditions(row, [{ field: "totalSpent", operator: "gt", value: 1000 }, { field: "balance", operator: "gt", value: 100 }], "any", data), true);
  assert.equal(service.matchesConditions(row, [{ field: "totalSpent", operator: "gt", value: 1000 }], "all", data), false);
});

test("segmento salvo fica vinculado à empresa e exclusão é lógica", () => {
  const data = baseData(), service = loadSegments(data);
  const saved = service.save({ name: "Premium sumidos", matchMode: "all", conditions: [{ field: "lastPurchaseDays", operator: "gte", value: 30 }] });
  assert.equal(saved.businessId, "business-a");
  assert.equal(data.segmentosClientes.length, 1);
  assert.equal(service.duplicate(saved.id).name, "Premium sumidos (cópia)");
  service.remove(saved.id);
  assert.ok(data.segmentosClientes[0].deletedAt);
  assert.equal(data.segmentosClientes[0].active, false);
});

test("camada visual expõe ações, filtros completos, pedidos e editor do catálogo", () => {
  const crmMobile = fs.readFileSync(path.join(__dirname, "../js/crm-mobile.js"), "utf8");
  const crmDesktop = fs.readFileSync(path.join(__dirname, "../js/crm-dashboard.js"), "utf8");
  const campaign = fs.readFileSync(path.join(__dirname, "../js/campanhas-ui.js"), "utf8");
  const catalog = fs.readFileSync(path.join(__dirname, "../js/catalogo-admin.js"), "utf8");
  const orders = fs.readFileSync(path.join(__dirname, "../js/visitas.js"), "utf8");
  assert.match(crmMobile, /Quem você quer alcançar/);
  assert.match(crmMobile, /data-condition-value-to/);
  assert.match(crmMobile, /Meus segmentos/);
  assert.match(crmDesktop, /data-segment-campaign/);
  assert.match(campaign, /Progresso pendente \(fiado\)/);
  assert.match(campaign, /Clientes parados/);
  assert.match(catalog, /Banner do catálogo/);
  assert.match(catalog, /Usar imagem exclusiva do catálogo/);
  assert.match(orders, /Confirmar pedido/);
  assert.match(orders, /Marcar como pronto/);
  assert.match(orders, /Marcar como entregue/);
  assert.match(orders, /statusOperationId/);
});

test("apresentação do catálogo guarda overrides separados do cadastro operacional", () => {
  const data = { config: { catalogSettings: {} }, produtos: [{ id: "product-a", nome: "Nome interno", categoria: "Bebidas", preco: 10, ativo: true, imageUrl: "product.webp" }] };
  const context = {
    console,
    Date: FixedDate,
    Number,
    String,
    Object,
    Set,
    crypto: { randomUUID: () => "catalog-operation" },
    Utils: { uuid: () => "catalog-operation" },
    DB: { carregar: () => data, alterar: (mutator) => mutator(data) },
    CatalogoUniversal: { publish: () => {} },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/catalog-presentation.js"), "utf8"), context);
  context.CatalogPresentation.saveCategory("Bebidas", { publicName: "Bebidas geladas", imageUrl: "category.webp" });
  context.CatalogPresentation.saveProduct("product-a", { publicName: "Nome público", price: 9, imageMode: "catalog", imageUrl: "catalog.webp", imageThumbUrl: "catalog-thumb.webp" });
  const decorated = context.CatalogPresentation.decorate(data.produtos[0], { productName: "Nome interno", category: "Bebidas", salePrice: 10, productImage: "product.webp", active: true });
  assert.equal(data.produtos[0].nome, "Nome interno");
  assert.equal(decorated.productName, "Nome público");
  assert.equal(decorated.category, "Bebidas geladas");
  assert.equal(decorated.productImage, "catalog-thumb.webp");
  assert.equal(decorated.salePrice, 9);
});
