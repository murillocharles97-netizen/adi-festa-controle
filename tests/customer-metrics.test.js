const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Metrics = require("../js/customer-metrics.js");

test("motor central usa somente o cache sincronizado e não cria leituras Firestore", () => {
  const source = fs.readFileSync("js/customer-metrics.js", "utf8");
  assert.doesNotMatch(source, /getDocs|onSnapshot|collection\(|query\(/);
});

const NOW = new Date("2026-08-08T15:00:00.000Z");
const ago = (days, hour = 15) => {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};
const sale = (id, clientField, clientId, value, daysAgo, options = {}) => ({
  id,
  operationId: options.operationId || id,
  businessId: options.businessId || "empresa-a",
  [clientField]: clientId,
  valorFinal: value,
  status: options.status || "pago",
  data: ago(daysAgo),
  deletedAt: options.deletedAt,
  itens: options.itens || [
    {
      productId: options.productId || "produto-cone",
      productNameSnapshot: options.productName || "Cone",
      categoryId: options.categoryId || "doces",
      categoryNameSnapshot: options.categoryName || "Doces",
      quantity: options.quantity || 1,
      subtotalFinal: value,
    },
  ],
});

function fixture() {
  const clientes = [
      { id: "ana", nome: "Ana", saldo: -100 },
      { id: "bruno", nome: "Bruno", saldo: 0 },
      { id: "carla", nome: "Carla", saldo: 0 },
      { id: "daniel", nome: "Daniel", saldo: 0 },
    ],
    vendas = [];
  for (let index = 0; index < 10; index++)
    vendas.push(sale(`ana-${index}`, "clienteId", "ana", 120, 50 - index * 5));
  for (let index = 0; index < 4; index++)
    vendas.push(sale(`bruno-${index}`, "clientId", "bruno", 175, 75 - index * 10));
  vendas.push(sale("carla-0", "customerId", "carla", 100, 0));
  for (let index = 0; index < 8; index++)
    vendas.push(sale(`daniel-${index}`, "clienteId", "daniel", index === 7 ? 117 : 119, 160 - index * 10));
  return {
    clientes,
    produtos: [{ id: "produto-cone", nome: "Cone", categoria: "Doces", categoryId: "doces" }],
    vendas,
    pagamentos: [],
    contatosCliente: [],
    messageHistory: [],
    progressosCampanha: [],
    metricasClientes: [],
  };
}

test("motor central calcula exatamente Ana, Bruno, Carla e Daniel", () => {
  const engine = Metrics.build(fixture(), { businessId: "empresa-a", now: NOW });
  const ana = engine.byClient.get("ana"),
    bruno = engine.byClient.get("bruno"),
    carla = engine.byClient.get("carla"),
    daniel = engine.byClient.get("daniel");
  assert.deepEqual(
    [ana.totalSpent, daniel.totalSpent, bruno.totalSpent, carla.totalSpent],
    [1200, 950, 700, 100],
  );
  assert.deepEqual(
    [ana.purchaseCount, daniel.purchaseCount, bruno.purchaseCount, carla.purchaseCount],
    [10, 8, 4, 1],
  );
  assert.equal(ana.averageTicket, 120);
  assert.equal(carla.averagePurchaseIntervalDays, null);
  assert.equal(ana.averagePurchaseIntervalDays, 5);
  assert.equal(ana.openBalance, 100);
  assert.equal(ana.favoriteProductName, "Cone");
  assert.equal(ana.favoriteCategoryName, "Doces");
});

test("segmentos controlados usam primeira e última compra reais", () => {
  const engine = Metrics.build(fixture(), { businessId: "empresa-a", now: NOW }),
    ranked = [...engine.byClient.values()]
      .filter((metric) => metric.purchaseCount)
      .sort((left, right) => right.totalSpent - left.totalSpent)
      .map((metric) => metric.id);
  assert.deepEqual(ranked, ["ana", "daniel", "bruno", "carla"]);
  assert.deepEqual(
    [...engine.byClient.values()]
      .filter((metric) => metric.lastPurchaseAt && metric.daysSinceLastPurchase >= 30)
      .map((metric) => metric.id),
    ["bruno", "daniel"],
  );
  assert.deepEqual(
    [...engine.byClient.values()]
      .filter((metric) => metric.lastPurchaseAt && metric.daysSinceLastPurchase >= 60)
      .map((metric) => metric.id),
    ["daniel"],
  );
  const today = engine.period(new Date("2026-08-08T00:00:00-03:00"), new Date("2026-08-08T23:59:59-03:00"));
  assert.equal(today.get("carla").firstPurchase, true);
  assert.equal(today.get("carla").spent, 100);
  assert.deepEqual(
    [...today].filter(([, row]) => row.purchases > 0).map(([id]) => id),
    ["carla"],
    "um único comprador já deve formar o segmento Melhores clientes",
  );
});

test("cancelamento, exclusão e repetição idempotente não entram nas métricas", () => {
  const data = fixture();
  data.vendas.push(sale("cancelada", "clienteId", "ana", 500, 1, { status: "cancelada" }));
  data.vendas.push(sale("apagada", "clienteId", "ana", 500, 1, { deletedAt: ago(0) }));
  data.vendas.push(sale("retry-a", "clienteId", "ana", 100, 1, { operationId: "same-operation" }));
  data.vendas.push(sale("retry-b", "customerId", "ana", 100, 1, { operationId: "same-operation" }));
  const metric = Metrics.build(data, { businessId: "empresa-a", now: NOW }).byClient.get("ana");
  assert.equal(metric.totalSpent, 1300);
  assert.equal(metric.purchaseCount, 11);
});

test("pagamentos alteram saldo, mas nunca faturamento ou contagem", () => {
  const data = fixture();
  data.pagamentos.push({ id: "payment", clienteId: "ana", valor: 100, data: ago(0) });
  data.clientes.find((client) => client.id === "ana").saldo = 0;
  const metric = Metrics.build(data, { businessId: "empresa-a", now: NOW }).byClient.get("ana");
  assert.equal(metric.totalSpent, 1200);
  assert.equal(metric.purchaseCount, 10);
  assert.equal(metric.openBalance, 0);
});

test("multiempresa ignora explicitamente vendas de outro tenant", () => {
  const data = fixture();
  data.vendas.push(sale("foreign", "clienteId", "ana", 9999, 0, { businessId: "empresa-b" }));
  const metric = Metrics.build(data, { businessId: "empresa-a", now: NOW }).byClient.get("ana");
  assert.equal(metric.totalSpent, 1200);
  assert.equal(metric.purchaseCount, 10);
});

test("empate de produto e categoria usa identificador estável", () => {
  const data = {
    clientes: [{ id: "cliente", nome: "Cliente" }],
    produtos: [],
    vendas: [
      sale("tie", "clienteId", "cliente", 20, 0, {
        itens: [
          { productId: "produto-b", productNameSnapshot: "B", categoryId: "cat-b", categoryNameSnapshot: "B", quantity: 1, subtotalFinal: 10 },
          { productId: "produto-a", productNameSnapshot: "A", categoryId: "cat-a", categoryNameSnapshot: "A", quantity: 1, subtotalFinal: 10 },
        ],
      }),
    ],
  };
  const metric = Metrics.build(data, { businessId: "empresa-a", now: NOW }).byClient.get("cliente");
  assert.equal(metric.favoriteProductId, "produto-a");
  assert.equal(metric.favoriteCategoryId, "cat-a");
});

test("histórico importado do Kyte permanece preservado sem inventar frequência", () => {
  const data = fixture();
  data.clientes.push({
    id: "kyte-legacy",
    nome: "Histórico Kyte",
    totalComprado: 820,
    quantidadeVendas: 48,
    ultimaCompra: ago(120),
    saldo: -42.5,
  });
  const metric = Metrics.build(data, { businessId: "empresa-a", now: NOW }).byClient.get("kyte-legacy");
  assert.equal(metric.totalSpent, 820);
  assert.equal(metric.purchaseCount, 48);
  assert.equal(metric.averagePurchaseIntervalDays, null);
  assert.equal(metric.openBalance, 42.5);
});
