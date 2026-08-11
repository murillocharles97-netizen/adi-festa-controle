const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-08-10T12:00:00.000Z"])); }
  static now() { return new Date("2026-08-10T12:00:00.000Z").getTime(); }
}

function loadEngine() {
  const context = {
    console, structuredClone, Intl, Date: FixedDate, Math, Number, String, Set, Map, Object,
    encodeURIComponent,
    crypto: { randomUUID: () => "uuid-functional" },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/campaign-engine-v2.js"), "utf8"), context);
  return context.CampaignEngineV2;
}

const client = { id: "client-1", nome: "Cliente", ativo: true };
const item = (productId, quantity, price = 10, extra = {}) => ({
  produtoId: productId,
  productId,
  quantidade: quantity,
  quantity,
  precoOriginal: price,
  precoFinalUnitario: price,
  subtotalFinal: quantity * price,
  ...extra,
});
const sale = (id, status, items, extra = {}) => ({
  id,
  operationId: id,
  businessId: "business-a",
  clienteId: client.id,
  clientId: client.id,
  status,
  data: extra.data || "2026-08-10T12:00:00.000Z",
  itens: items,
  valorFinal: items.reduce((sum, entry) => sum + Number(entry.subtotalFinal || 0), 0),
  ...extra,
});
function db(campaigns = []) {
  return {
    clientes: [structuredClone(client)],
    produtos: [
      { id: "monster", categoria: "Bebidas", estoqueAtual: 30 },
      { id: "brownie", categoria: "Doces", estoqueAtual: 20 },
      { id: "water", categoria: "Bebidas", estoqueAtual: 50 },
    ],
    variacoesProdutos: [], vendas: [], pagamentos: [], campanhas: campaigns.map((campaign) => ({ ...campaign, startsAt: "2026-01-01T00:00:00.000Z" })),
    progressosCampanha: [], eventosCampanha: [], resgatesCampanha: [],
    alocacoesPagamento: [], movimentacoesEstoque: [], segmentosClientes: [],
  };
}

test("E2E pontos: pago, fiado, pagamentos, resgate e cancelamento protegido", () => {
  const e = loadEngine();
  const campaign = e.normalizeCampaign({
    id: "points-e2e", name: "Pontos", type: "points",
    rule: { pointsAmount: 1, pointsAward: 1 },
    rewards: [{ id: "monster-gift", type: "product", productId: "monster", quantity: 1, pointsCost: 100, name: "Monster" }],
  });
  const data = db([campaign]);
  const paid = sale("sale-paid", "pago", [item("monster", 1, 60)]);
  const credit = sale("sale-credit", "fiado", [item("brownie", 1, 70)], {
    data: "2026-08-11T12:00:00.000Z",
    creditOriginalAmount: 70, creditPaidAmount: 0, creditRemainingAmount: 70, creditSettled: false,
  });
  data.vendas.push(paid, credit);
  assert.equal(e.applySale(data, paid).events.length, 1);
  assert.equal(e.applySale(data, paid).events.length, 0);
  e.applySale(data, credit);
  let progress = data.progressosCampanha[0];
  assert.equal(progress.availablePoints, 60);
  assert.equal(progress.pendingPoints, 70);

  const payment1 = { id: "pay-1", operationId: "pay-1", businessId: "business-a", data: "2026-08-12T12:00:00.000Z" };
  const allocations1 = e.allocatePayment(data, client.id, 50, payment1.id, payment1.data, { businessId: "business-a" });
  assert.equal(e.confirmSettledSales(data, payment1, allocations1).length, 0);
  progress = data.progressosCampanha[0];
  assert.equal(progress.availablePoints, 60);
  assert.equal(progress.pendingPoints, 70);

  const payment2 = { id: "pay-2", operationId: "pay-2", businessId: "business-a", data: "2026-08-13T12:00:00.000Z" };
  const allocations2 = e.allocatePayment(data, client.id, 20, payment2.id, payment2.data, { businessId: "business-a" });
  const confirmations = e.confirmSettledSales(data, payment2, allocations2);
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].saleId, credit.id);
  progress = data.progressosCampanha[0];
  assert.equal(progress.availablePoints, 130);
  assert.equal(progress.pendingPoints, 0);

  const stockBefore = data.produtos[0].estoqueAtual;
  const redemption = e.redeem(data, campaign.id, client.id, "monster-gift", { operationId: "redeem-e2e", businessId: "business-a" });
  assert.equal(data.progressosCampanha[0].availablePoints, 30);
  assert.equal(data.produtos[0].estoqueAtual, stockBefore - 1);
  assert.equal(data.resgatesCampanha.length, 1);
  assert.equal(e.redeem(data, campaign.id, client.id, "monster-gift", { operationId: "redeem-e2e", businessId: "business-a" }).id, redemption.id);
  assert.equal(data.resgatesCampanha.length, 1);

  assert.throws(() => e.reverseSale(data, paid), (error) => error.code === "campaign-redemption-conflict");
  assert.equal(data.progressosCampanha[0].availablePoints, 30);
  assert.equal(data.eventosCampanha.filter((event) => event.transition === "reversed").length, 0);
});

test("E2E compre e ganhe mantém múltiplos ciclos, excedente e baixa recompensa", () => {
  const e = loadEngine();
  const campaign = e.normalizeCampaign({
    id: "buy-e2e", type: "buy_get", qualification: { productIds: ["monster"] },
    rule: { requiredQuantity: 5, multipleCycles: true },
    rewards: [{ id: "brownie-gift", type: "product", productId: "brownie", quantity: 1, name: "Brownie" }],
  });
  const data = db([campaign]);
  const currentSale = sale("buy-sale", "pago", [item("monster", 12, 8)]);
  data.vendas.push(currentSale);
  e.applySale(data, currentSale);
  assert.equal(data.progressosCampanha[0].availableRewards, 2);
  assert.equal(data.progressosCampanha[0].cycleRemainder, 2);
  const stockBefore = data.produtos.find((entry) => entry.id === "brownie").estoqueAtual;
  e.redeem(data, campaign.id, client.id, "brownie-gift", { operationId: "buy-redeem", businessId: "business-a" });
  assert.equal(data.progressosCampanha[0].availableRewards, 1);
  assert.equal(data.produtos.find((entry) => entry.id === "brownie").estoqueAtual, stockBefore - 1);
});

test("compre e ganhe qualifica por categoria e suporta prêmio igual, outro produto e externo", () => {
  const e = loadEngine();
  const rewards = [
    { id: "same", type: "product", productId: "brownie", quantity: 1, name: "Mesmo produto" },
    { id: "other", type: "product", productId: "monster", quantity: 1, name: "Outro produto" },
    { id: "external", type: "external", name: "Vale externo" },
  ];
  for (const reward of rewards) {
    const campaign = e.normalizeCampaign({ id: `category-${reward.id}`, type: "buy_get", qualification: { categoryIds: ["Doces"] }, rule: { requiredQuantity: 2 }, rewards: [reward] });
    const data = db([campaign]);
    const currentSale = sale(`sale-${reward.id}`, "pago", [item("brownie", 2, 10)]);
    e.applySale(data, currentSale);
    assert.equal(data.progressosCampanha[0].availableRewards, 1);
    const monsterBefore = data.produtos.find((entry) => entry.id === "monster").estoqueAtual;
    const brownieBefore = data.produtos.find((entry) => entry.id === "brownie").estoqueAtual;
    e.redeem(data, campaign.id, client.id, reward.id, { operationId: `redeem-${reward.id}` });
    assert.equal(data.progressosCampanha[0].availableRewards, 0);
    assert.equal(data.produtos.find((entry) => entry.id === "monster").estoqueAtual, monsterBefore - (reward.productId === "monster" ? 1 : 0));
    assert.equal(data.produtos.find((entry) => entry.id === "brownie").estoqueAtual, brownieBefore - (reward.productId === "brownie" ? 1 : 0));
  }
});

test("E2E volte e ganhe fiado só confirma após quitação", () => {
  const e = loadEngine();
  const campaign = e.normalizeCampaign({
    id: "return-e2e", type: "nth_product",
    qualification: { productIds: ["brownie"], countMode: "purchase", dailyLimit: 1 },
    rule: { requiredPurchases: 5, multipleCycles: true },
    rewards: [{ id: "gift", type: "external", name: "Brinde" }],
  });
  const data = db([campaign]);
  const credit = sale("return-credit", "fiado", [item("brownie", 1, 20)], {
    creditOriginalAmount: 20, creditPaidAmount: 0, creditRemainingAmount: 20, creditSettled: false,
  });
  data.vendas.push(credit);
  e.applySale(data, credit);
  assert.equal(data.progressosCampanha[0].pendingProgress, 1);
  assert.equal(data.progressosCampanha[0].confirmedProgress, 0);
  const partialPayment = { id: "return-pay-1", operationId: "return-pay-1", data: "2026-08-11T12:00:00.000Z" };
  const partial = e.allocatePayment(data, client.id, 10, partialPayment.id, partialPayment.data);
  assert.equal(e.confirmSettledSales(data, partialPayment, partial).length, 0);
  const finalPayment = { id: "return-pay-2", operationId: "return-pay-2", data: "2026-08-12T12:00:00.000Z" };
  const final = e.allocatePayment(data, client.id, 10, finalPayment.id, finalPayment.data);
  assert.equal(e.confirmSettledSales(data, finalPayment, final).length, 1);
  assert.equal(data.progressosCampanha[0].pendingProgress, 0);
  assert.equal(data.progressosCampanha[0].confirmedProgress, 1);
});

test("pontos cobrem loja, produto, categoria, unidade e expiração", () => {
  const e = loadEngine();
  const campaigns = [
    e.normalizeCampaign({ id: "all-value", type: "points", rule: { pointsAmount: 10, pointsAward: 1 }, stacking: { allowed: true, conflictGroup: "points" } }),
    e.normalizeCampaign({ id: "product-unit", type: "points", qualification: { productIds: ["monster"], pointsMode: "unit" }, rule: { pointsAward: 7 }, stacking: { allowed: true, conflictGroup: "points" } }),
    e.normalizeCampaign({ id: "category-value", type: "points", qualification: { categoryIds: ["Bebidas"] }, rule: { pointsAmount: 1, pointsAward: 2 }, stacking: { allowed: true, conflictGroup: "points" } }),
    e.normalizeCampaign({ id: "expires", type: "points", rule: { pointsAmount: 1, pointsAward: 1, pointsExpirationDays: 1 }, stacking: { allowed: true, conflictGroup: "points" } }),
  ];
  const data = db(campaigns);
  const currentSale = sale("points-modes", "pago", [item("monster", 2, 10), item("brownie", 1, 5)]);
  const result = e.applySale(data, currentSale);
  const pointsByCampaign = Object.fromEntries(result.events.map((event) => [event.campaignId, event.delta.points]));
  assert.equal(JSON.stringify(pointsByCampaign), JSON.stringify({ "all-value": 2, "product-unit": 14, "category-value": 40, expires: 25 }));
  e.expirePoints(data, "2026-08-12T13:00:00.000Z");
  assert.equal(data.progressosCampanha.find((entry) => entry.campaignId === "expires").availablePoints, 0);
});

test("desconto progressivo sempre retorna a melhor faixa e perde elegibilidade ao remover", () => {
  const e = loadEngine();
  const campaign = e.normalizeCampaign({
    id: "tiers", type: "quantity_discount", qualification: { productIds: ["brownie"] },
    rule: { thresholds: [{ quantity: 3, discountPercent: 5 }, { quantity: 5, discountPercent: 10 }, { quantity: 10, discountPercent: 15 }] },
  });
  const evaluate = (quantity) => e.evaluateOne(campaign, sale(`tiers-${quantity}`, "pago", [item("brownie", quantity)]), { client, products: db().produtos, events: [] });
  assert.equal(evaluate(2).opportunity.available, false);
  assert.equal(evaluate(3).opportunity.discountPercent, 5);
  assert.equal(evaluate(5).opportunity.discountPercent, 10);
  assert.equal(evaluate(10).opportunity.discountPercent, 15);
  assert.equal(e.resolveConflicts([evaluate(5)], []).appliedBenefits.length, 0);
  assert.equal(evaluate(2).opportunity.available, false);
});

test("volte e ganhe diferencia unidades, vendas e limite diário", () => {
  const e = loadEngine();
  const byUnit = e.normalizeCampaign({ id: "return-unit", type: "nth_product", qualification: { productIds: ["brownie"], countMode: "quantity" }, rule: { requiredPurchases: 5 } });
  assert.equal(e.evaluateOne(byUnit, sale("u", "pago", [item("brownie", 3)]), { client, products: db().produtos, events: [] }).progress, 3);
  const byPurchase = e.normalizeCampaign({ id: "return-day", type: "nth_product", qualification: { productIds: ["brownie"], countMode: "purchase", dailyLimit: 1 }, rule: { requiredPurchases: 5 } });
  const first = e.evaluateOne(byPurchase, sale("d1", "pago", [item("brownie", 4)]), { client, products: db().produtos, events: [] });
  assert.equal(first.progress, 1);
  const events = [{ id: "earned-day", campaignId: byPurchase.id, clientId: client.id, sourceType: "sale", transition: "earned", status: "confirmed", dayKey: "2026-08-10" }];
  assert.equal(e.evaluateOne(byPurchase, sale("d2", "pago", [item("brownie", 1)]), { client, products: db().produtos, events }), null);
  assert.equal(e.evaluateOne(byPurchase, sale("d3", "pago", [item("brownie", 1)], { data: "2026-08-11T12:00:00.000Z" }), { client, products: db().produtos, events }).progress, 1);
});

test("combo detecta ciclos, deixa aplicação opcional e perde elegibilidade após remoção", () => {
  const e = loadEngine();
  const campaign = e.normalizeCampaign({
    id: "combo-e2e", type: "combo",
    rule: { requiredItems: [{ productId: "monster", quantity: 2 }, { productId: "brownie", quantity: 1 }], comboPrice: 20, multipleCycles: true },
  });
  const evaluation = e.evaluateOne(campaign, sale("combo", "pago", [item("monster", 4), item("brownie", 2)]), { client, products: db().produtos, events: [] });
  assert.equal(evaluation.opportunity.cycles, 2);
  assert.equal(e.resolveConflicts([evaluation], []).appliedBenefits.length, 0);
  assert.equal(e.resolveConflicts([evaluation], [campaign.id]).appliedBenefits.length, 1);
  const removed = e.evaluateOne(campaign, sale("combo-removed", "pago", [item("monster", 4)]), { client, products: db().produtos, events: [] });
  assert.equal(removed, null);
});

test("stacking acumulativo coexiste e conflito exclusivo exige escolha determinística", () => {
  const e = loadEngine();
  const stacked = ["stack-a", "stack-b"].map((id) => e.normalizeCampaign({ id, type: "buy_get", qualification: { productIds: ["monster"] }, rule: { requiredQuantity: 1 }, stacking: { allowed: true, conflictGroup: "loyalty" } }));
  const stackedEvaluations = stacked.map((campaign) => e.evaluateOne(campaign, sale("stack", "pago", [item("monster", 1)]), { client, products: db().produtos, events: [] }));
  assert.equal(JSON.stringify(e.resolveConflicts(stackedEvaluations, []).progress.map((entry) => entry.campaign.id)), JSON.stringify(["stack-a", "stack-b"]));
  const exclusive = stacked.map((campaign) => e.normalizeCampaign({ ...campaign, stacking: { allowed: false, conflictGroup: "loyalty" } }));
  const exclusiveEvaluations = exclusive.map((campaign) => e.evaluateOne(campaign, sale("exclusive", "pago", [item("monster", 1)]), { client, products: db().produtos, events: [] }));
  assert.equal(e.resolveConflicts(exclusiveEvaluations, []).conflicts.length, 1);
  assert.equal(JSON.stringify(e.resolveConflicts(exclusiveEvaluations, ["stack-b"]).progress.map((entry) => entry.campaign.id)), JSON.stringify(["stack-b"]));
});

test("FIFO distribui um pagamento entre várias vendas e replay não duplica", () => {
  const e = loadEngine();
  const data = db();
  data.vendas.push(
    sale("fifo-a", "fiado", [item("monster", 1, 50)], { data: "2026-08-01T12:00:00.000Z", creditOriginalAmount: 50 }),
    sale("fifo-b", "fiado", [item("monster", 1, 100)], { data: "2026-08-02T12:00:00.000Z", creditOriginalAmount: 100 }),
  );
  const first = e.allocatePayment(data, client.id, 80, "fifo-pay", "2026-08-10T12:00:00.000Z");
  assert.equal(JSON.stringify(first.map((entry) => [entry.saleId, entry.amount, entry.settledSale])), JSON.stringify([["fifo-a", 50, true], ["fifo-b", 30, false]]));
  assert.equal(JSON.stringify(e.allocatePayment(data, client.id, 80, "fifo-pay")), JSON.stringify(first));
  assert.equal(data.alocacoesPagamento.length, 2);
});

test("múltiplos resgates consomem saldo e retry não cria um terceiro", () => {
  const e = loadEngine();
  const campaign = e.normalizeCampaign({ id: "multi-redeem", type: "points", rewards: [{ id: "reward", type: "external", name: "Vale", pointsCost: 200 }] });
  const data = db([campaign]);
  data.progressosCampanha.push({ id: e.progressId(campaign.id, client.id), campaignId: campaign.id, clientId: client.id, businessId: "business-a", availablePoints: 450 });
  e.redeem(data, campaign.id, client.id, "reward", { operationId: "redeem-1", businessId: "business-a" });
  e.redeem(data, campaign.id, client.id, "reward", { operationId: "redeem-2", businessId: "business-a" });
  e.redeem(data, campaign.id, client.id, "reward", { operationId: "redeem-2", businessId: "business-a" });
  assert.equal(data.progressosCampanha[0].availablePoints, 50);
  assert.equal(data.resgatesCampanha.length, 2);
});

test("cancelamento reverte venda paga, fiado pendente e fiado já quitado", () => {
  const e = loadEngine();
  const campaign = e.normalizeCampaign({ id: "reverse-all", type: "points", rule: { pointsAmount: 1, pointsAward: 1 } });

  const paidDb = db([campaign]);
  const paid = sale("reverse-paid", "pago", [item("monster", 1, 30)]);
  paidDb.vendas.push(paid); e.applySale(paidDb, paid); e.reverseSale(paidDb, paid);
  assert.equal(paidDb.progressosCampanha[0].availablePoints, 0);
  assert.equal(e.reverseSale(paidDb, paid).length, 0);

  const pendingDb = db([campaign]);
  const pending = sale("reverse-pending", "fiado", [item("monster", 1, 30)], { creditOriginalAmount: 30, creditRemainingAmount: 30 });
  pendingDb.vendas.push(pending); e.applySale(pendingDb, pending); e.reverseSale(pendingDb, pending);
  assert.equal(pendingDb.progressosCampanha[0].pendingPoints, 0);

  const settledDb = db([campaign]);
  const settled = sale("reverse-settled", "fiado", [item("monster", 1, 30)], { creditOriginalAmount: 30, creditRemainingAmount: 30 });
  settledDb.vendas.push(settled); e.applySale(settledDb, settled);
  const payment = { id: "settle-pay", operationId: "settle-pay", data: "2026-08-11T12:00:00.000Z" };
  const allocations = e.allocatePayment(settledDb, client.id, 30, payment.id, payment.data);
  e.confirmSettledSales(settledDb, payment, allocations);
  e.reverseSale(settledDb, settled);
  assert.equal(settledDb.progressosCampanha[0].availablePoints, 0);
  assert.equal(settledDb.eventosCampanha.filter((event) => event.transition === "reversed").length, 1);
});

test("snapshot do recibo é completo e confirmação de pagamento é rastreável", () => {
  const e = loadEngine();
  const campaign = e.normalizeCampaign({ id: "snapshot", name: "Snapshot", type: "points", rule: { pointsAmount: 1, pointsAward: 1 } });
  const data = db([campaign]);
  const currentSale = sale("snapshot-sale", "pago", [item("monster", 1, 25)]);
  const result = e.applySale(data, currentSale);
  const snapshot = e.receiptSummary(result.snapshots)[0];
  for (const field of ["campaignId", "campaignName", "type", "status", "progressGenerated", "pointsGenerated", "pending", "confirmed", "progressBefore", "progressAfter", "pointsBefore", "pointsAfter", "rewardUnlocked", "rewardsAvailable", "messageHint"]) {
    assert.equal(Object.hasOwn(snapshot, field), true, field);
  }
  assert.equal(snapshot.pointsGenerated, 25);
  assert.equal(snapshot.pointsAfter, 25);
});

test("métricas básicas são derivadas de fatos e respeitam empresa", () => {
  const e = loadEngine();
  const campaign = e.normalizeCampaign({ id: "metrics", type: "buy_get", rule: { requiredQuantity: 1 } });
  const data = db([campaign]);
  const currentSale = sale("metrics-sale", "pago", [item("monster", 1)]);
  e.applySale(data, currentSale);
  const metrics = e.campaignMetrics(data, campaign, { businessId: "business-a" });
  assert.equal(JSON.stringify(metrics), JSON.stringify({ eligible: 1, withProgress: 1, pending: 0, rewardsAvailable: 1, redemptions: 0, uniqueParticipants: 1, nearReward: 0, redeemable: 1 }));
  assert.equal(e.campaignMetrics(data, campaign, { businessId: "business-b" }).withProgress, 0);
});

test("zero campanhas mantém a venda sem efeitos colaterais", () => {
  const e = loadEngine();
  const data = db();
  const result = e.applySale(data, sale("no-campaign", "pago", [item("monster", 1)]));
  assert.equal(JSON.stringify(result), JSON.stringify({ events: [], snapshots: [], conflicts: [] }));
  assert.equal(data.progressosCampanha.length, 0);
  assert.equal(data.eventosCampanha.length, 0);
});

test("event ledger cobre earned, confirmed, redeemed e reversed sem mutar eventos antigos", () => {
  const e = loadEngine();
  const campaign = e.normalizeCampaign({ id: "ledger", type: "points", rule: { pointsAmount: 1, pointsAward: 1 }, rewards: [{ id: "gift", type: "external", name: "Gift", pointsCost: 10 }] });
  const data = db([campaign]);
  const credit = sale("ledger-sale", "fiado", [item("monster", 1, 20)], { creditOriginalAmount: 20, creditRemainingAmount: 20 });
  const paid = sale("ledger-buffer", "pago", [item("monster", 1, 20)], { data: "2026-08-10T09:00:00.000Z" });
  data.vendas.push(paid, credit); e.applySale(data, paid); e.applySale(data, credit);
  const original = structuredClone(data.eventosCampanha.find((event) => event.sourceId === credit.id));
  const payment = { id: "ledger-pay", operationId: "ledger-pay", data: "2026-08-11T12:00:00.000Z" };
  e.confirmSettledSales(data, payment, e.allocatePayment(data, client.id, 20, payment.id, payment.data));
  e.redeem(data, campaign.id, client.id, "gift", { operationId: "ledger-redeem" });
  e.reverseSale(data, credit);
  assert.equal(JSON.stringify(data.eventosCampanha.find((event) => event.id === original.id)), JSON.stringify(original));
  assert.equal(JSON.stringify([...new Set(data.eventosCampanha.map((event) => event.transition))].sort()), JSON.stringify(["confirmed", "earned", "redeemed", "reversed"]));
});
