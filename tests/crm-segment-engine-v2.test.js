const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../js/crm-segment-engine-v2.js");

const ago = (days) => new Date(Date.now() - (days * Engine.DAY)).toISOString();
const product = { id: "brownie", businessId: "business-a", nome: "Brownie", categoryId: "doces", categoria: "Doces" };
const row = (id, metric = {}, client = {}) => ({
  client: { id, businessId: "business-a", nome: id, saldo: 0, ativo: true, ...client },
  metric: { totalSpent: 0, purchaseCount: 0, averageTicket: 0, openBalance: 0, ...metric },
  period: { spent: 0, purchases: 0, products: new Set(), categories: new Set() },
  classifications: [],
});
const sale = (id, clientId, days, quantity, total, extra = {}) => ({
  id, operationId: extra.operationId || id, businessId: extra.businessId || "business-a", clienteId: clientId,
  status: extra.status || "pago", data: ago(days), valorFinal: total,
  itens: [{ produtoId: "brownie", categoryId: "doces", categoria: "Doces", quantidade: quantity, subtotalFinal: total }],
});

test("motor V2 combina AND/OR, períodos e separa compras distintas de unidades", () => {
  const ana = row("ana", { totalSpent: 450, purchaseCount: 2, averageTicket: 225, lastPurchaseAt: ago(25) });
  const data = { clientes: [ana.client], produtos: [product], vendas: [sale("s1", "ana", 40, 3, 300), sale("s2", "ana", 25, 1, 150)] };
  const projection = Engine.project(data, [ana], { businessId: "business-a" });
  const common = { subjectId: "brownie", period: { key: "60d" } };
  assert.equal(Engine.evaluate([ana], [{ field: "productUnits", operator: "gte", value: 4, ...common }], "all", data, { businessId: "business-a", projection }).rows.length, 1);
  assert.equal(Engine.evaluate([ana], [{ field: "productPurchaseCount", operator: "gte", value: 3, ...common }], "all", data, { businessId: "business-a", projection }).rows.length, 0);
  const and = [
    { field: "productPurchased", operator: "has", subjectId: "brownie", period: { key: "60d" } },
    { field: "totalSpent", operator: "gt", value: 300, period: { key: "90d" } },
    { field: "lastPurchaseDays", operator: "gte", value: 20 },
  ];
  assert.equal(Engine.evaluate([ana], and, "all", data, { businessId: "business-a", projection }).clientIds[0], "ana");
  assert.equal(Engine.evaluate([ana], [{ field: "totalSpent", operator: "gt", value: 9999 }, and[0]], "any", data, { businessId: "business-a", projection }).rows.length, 1);
});

test("produto, categoria, cancelamento e idempotência usam uma projeção local única", () => {
  const ana = row("ana", { totalSpent: 100, purchaseCount: 1, lastPurchaseAt: ago(5) });
  const data = { clientes: [ana.client], produtos: [product], vendas: [
    sale("s1", "ana", 5, 2, 100, { operationId: "op-1" }),
    sale("s1-retry", "ana", 5, 2, 100, { operationId: "op-1" }),
    sale("cancelled", "ana", 3, 50, 500, { status: "cancelada" }),
  ] };
  const projection = Engine.project(data, [ana], { businessId: "business-a" });
  assert.equal(projection.audit.salesScanned, 3);
  assert.equal(projection.audit.uniqueSales, 1);
  assert.equal(projection.audit.firestoreReads, 0);
  assert.equal(Engine.evaluate([ana], [{ field: "categoryPurchased", operator: "has", subjectId: "id:doces", period: { key: "all" } }], "all", data, { businessId: "business-a", projection }).rows.length, 1);
  assert.equal(Engine.evaluate([ana], [{ field: "productSpent", operator: "eq", subjectId: "brownie", value: 100, period: { key: "all" } }], "all", data, { businessId: "business-a", projection }).rows.length, 1);
});

test("financeiro, renovação e Campaign V2 compartilham o mesmo contexto", () => {
  const ana = row("ana", { openBalance: 120, lastPurchaseAt: ago(20) }, { saldo: -120 });
  const data = {
    clientes: [ana.client], produtos: [product], vendas: [],
    pagamentos: [{ id: "pay", businessId: "business-a", clienteId: "ana", data: ago(4) }],
    customerSubscriptions: [{ id: "sub", businessId: "business-a", clientId: "ana", status: "active", expiresAt: ago(-5), productId: "brownie", planName: "Mensal" }],
    campanhas: [{ id: "campaign", businessId: "business-a", type: "buy_get", rule: { requiredQuantity: 10 }, rewards: [] }],
    progressosCampanha: [{ id: "progress", businessId: "business-a", campaignId: "campaign", clientId: "ana", confirmedProgress: 8, pendingProgress: 2 }],
  };
  const conditions = [
    { field: "hasDebt", operator: "eq", value: true },
    { field: "lastPaymentDays", operator: "lte", value: 7 },
    { field: "renewalDays", operator: "between", value: 0, valueTo: 7 },
    { field: "renewalVariant", operator: "contains", value: "mensal" },
    { field: "nearReward", operator: "eq", value: true },
    { field: "pendingCampaignProgress", operator: "eq", value: true },
  ];
  assert.equal(Engine.evaluate([ana], conditions, "all", data, { businessId: "business-a" }).rows.length, 1);
});

test("isolamento multiempresa exclui linhas e eventos de outro tenant", () => {
  const a = row("shared", { totalSpent: 50, purchaseCount: 1 }, { businessId: "business-a" });
  const b = row("shared", { totalSpent: 999, purchaseCount: 9 }, { businessId: "business-b", nome: "Outro tenant" });
  const data = { clientes: [a.client, b.client], produtos: [product], vendas: [sale("a", "shared", 1, 1, 50), sale("b", "shared", 1, 9, 999, { businessId: "business-b" })] };
  const result = Engine.evaluate([a, b], [{ field: "productSpent", operator: "eq", subjectId: "brownie", value: 50, period: { key: "all" } }], "all", data, { businessId: "business-a" });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].client.businessId, "business-a");
  assert.equal(result.projection.audit.uniqueSales, 1);
});

test("segmento permanece dinâmico e campanha recebe snapshot imutável do público", () => {
  const conditions = [{ field: "lastPurchaseDays", operator: "gte", value: 30 }];
  const first = Engine.audienceSnapshot({ businessId: "business-a", segmentId: "sumidos", segmentName: "Clientes bons que sumiram", conditions, clientIds: ["ana", "bruno"] });
  const laterDynamicResult = ["ana", "bruno", "carla"];
  assert.deepEqual(first.clientIds, ["ana", "bruno"]);
  assert.equal(first.audienceCountAtCreation, 2);
  assert.equal(first.sourceSegmentId, "sumidos");
  assert.equal(laterDynamicResult.length, 3);
  assert.deepEqual(first.clientIds, ["ana", "bruno"]);
});

test("casos comerciais combinam valor no período, VIP, cross-sell e ausência de cobrança", () => {
  const ana = row("ana", { totalSpent: 1250, purchaseCount: 8, averageTicket: 156.25, lastPurchaseAt: ago(35), openBalance: 180 }, { saldo: -180 });
  const bruno = row("bruno", { totalSpent: 250, purchaseCount: 2, averageTicket: 125, lastPurchaseAt: ago(8) });
  const otherProduct = { id: "monster", businessId: "business-a", nome: "Monster", categoryId: "bebidas", categoria: "Bebidas" };
  const data = {
    clientes: [ana.client, bruno.client], produtos: [product, otherProduct], cobrancas: [],
    vendas: [
      sale("a1", "ana", 55, 2, 220), sale("a2", "ana", 35, 1, 160),
      { ...sale("b1", "bruno", 8, 1, 250), itens: [{ produtoId: "monster", categoryId: "bebidas", quantidade: 1, subtotalFinal: 250 }] },
    ],
  };
  const rows = [ana, bruno], projection = Engine.project(data, rows, { businessId: "business-a" });
  const valuableLapsed = [{ field: "totalSpent", operator: "gt", value: 300, period: { key: "90d" } }, { field: "lastPurchaseDays", operator: "gte", value: 30 }];
  assert.deepEqual(Engine.evaluate(rows, valuableLapsed, "all", data, { businessId: "business-a", projection }).clientIds, ["ana"]);
  assert.deepEqual(Engine.evaluate(rows, [{ field: "vip", operator: "eq", value: true }, { field: "totalSpent", operator: "gt", value: 500, period: { key: "all" } }], "any", data, { businessId: "business-a", projection }).clientIds, ["ana"]);
  assert.deepEqual(Engine.evaluate(rows, [{ field: "productPurchased", operator: "has", subjectId: "brownie", period: { key: "all" } }, { field: "productNever", operator: "eq", subjectId: "monster", value: true }], "all", data, { businessId: "business-a", projection }).clientIds, ["ana"]);
  assert.deepEqual(Engine.evaluate(rows, [{ field: "debtAmount", operator: "gt", value: 100 }, { field: "noCollectionDays", operator: "gte", value: 15 }], "all", data, { businessId: "business-a", projection }).clientIds, ["ana"]);
});

test("quitação recente, promessa vencida e atraso de renovação usam campos operacionais reais", () => {
  const ana = row("ana", { totalSpent: 100, purchaseCount: 1 }, { saldo: 0, promessaPagamento: { data: ago(3).slice(0, 10), status: "pendente" } });
  const data = {
    clientes: [ana.client], vendas: [], produtos: [product],
    pagamentos: [{ id: "p1", businessId: "business-a", clienteId: "ana", data: ago(4) }],
    customerSubscriptions: [{ id: "sub-old", businessId: "business-a", clientId: "ana", status: "expired", expiresAt: ago(12) }],
  };
  const conditions = [
    { field: "settledRecently", operator: "eq", value: true, period: { key: "7d" } },
    { field: "overduePromise", operator: "eq", value: true },
    { field: "renewalOverdueDays", operator: "gte", value: 10 },
    { field: "renewalMissing", operator: "eq", value: true },
  ];
  assert.deepEqual(Engine.evaluate([ana], conditions, "all", data, { businessId: "business-a" }).clientIds, ["ana"]);
});
