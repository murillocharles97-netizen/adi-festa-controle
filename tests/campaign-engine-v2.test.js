const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-08-10T12:00:00.000Z"])); }
  static now() { return new Date("2026-08-10T12:00:00.000Z").getTime(); }
}

function engine() {
  const context = {
    console,
    structuredClone,
    Intl,
    Date: FixedDate,
    Math,
    Number,
    String,
    Set,
    Map,
    Object,
    encodeURIComponent,
    crypto: { randomUUID: () => "uuid-test" },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/campaign-engine-v2.js"), "utf8"),
    context,
  );
  return context.CampaignEngineV2;
}

const client = { id: "c1", nome: "Ana", ativo: true };
const product = { id: "p1", categoria: "Bebidas", estoqueAtual: 20 };
const sale = (overrides = {}) => ({
  id: "s1",
  operationId: "s1",
  businessId: "business-a",
  clienteId: "c1",
  status: "pago",
  data: "2026-08-10T12:00:00.000Z",
  itens: [{ produtoId: "p1", quantidade: 1, precoOriginal: 10, precoFinalUnitario: 10, subtotalFinal: 10 }],
  ...overrides,
});
const db = (campaigns = []) => ({
  clientes: [structuredClone(client)],
  produtos: [structuredClone(product)],
  variacoesProdutos: [],
  vendas: [],
  campanhas: campaigns.map((campaign) => ({ ...campaign, startsAt: "2026-01-01T00:00:00.000Z" })),
  progressosCampanha: [],
  eventosCampanha: [],
  resgatesCampanha: [],
  alocacoesPagamento: [],
  movimentacoesEstoque: [],
  segmentosClientes: [],
});

test("somente os cinco tipos oficiais são normalizados", () => {
  const e = engine();
  assert.deepEqual(Object.keys(e.TYPES), ["buy_get", "points", "quantity_discount", "nth_product", "combo"]);
  assert.equal(e.normalizeCampaign({ type: "custom" }).type, "buy_get");
});

test("buy_get pago confirma, preserva excedente e é idempotente", () => {
  const e = engine();
  const data = db([e.normalizeCampaign({
    id: "buy",
    type: "buy_get",
    qualification: { productIds: ["p1"] },
    rule: { requiredQuantity: 5, multipleCycles: true },
    rewards: [{ id: "r1", type: "external", name: "Brinde", quantity: 1 }],
  })]);
  const currentSale = sale({ itens: [{ produtoId: "p1", quantidade: 12, precoOriginal: 10, precoFinalUnitario: 10, subtotalFinal: 120 }] });
  const first = e.applySale(data, currentSale);
  const second = e.applySale(data, currentSale);
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 0);
  assert.equal(data.progressosCampanha[0].confirmedProgress, 12);
  assert.equal(data.progressosCampanha[0].cycleRemainder, 2);
  assert.equal(data.progressosCampanha[0].availableRewards, 2);
});

test("venda fiado fica pendente e somente quitação integral confirma", () => {
  const e = engine();
  const data = db([e.normalizeCampaign({
    id: "points",
    type: "points",
    rule: { pointsAmount: 1, pointsAward: 1 },
    rewards: [{ id: "brownie", type: "external", name: "Brownie", pointsCost: 100 }],
  })]);
  const creditSale = sale({ id: "credit", status: "fiado", valorFinal: 100, creditOriginalAmount: 100, creditPaidAmount: 0, creditRemainingAmount: 100, creditSettled: false, itens: [{ produtoId: "p1", quantidade: 1, precoOriginal: 100, precoFinalUnitario: 100, subtotalFinal: 100 }] });
  data.vendas.push(creditSale);
  e.applySale(data, creditSale);
  const immutablePendingEvent = structuredClone(data.eventosCampanha[0]);
  assert.equal(data.progressosCampanha[0].pendingPoints, 100);
  assert.equal(data.progressosCampanha[0].availablePoints, 0);

  const payment1 = { id: "pay1", operationId: "pay1", data: "2026-08-11T12:00:00.000Z" };
  const partial = e.allocatePayment(data, "c1", 80, payment1.id, payment1.data);
  assert.equal(partial[0].settledSale, false);
  assert.equal(e.confirmSettledSales(data, payment1, partial).length, 0);
  assert.equal(data.progressosCampanha[0].pendingPoints, 100);

  const payment2 = { id: "pay2", operationId: "pay2", data: "2026-08-12T12:00:00.000Z" };
  const final = e.allocatePayment(data, "c1", 20, payment2.id, payment2.data);
  assert.equal(final[0].settledSale, true);
  assert.equal(e.confirmSettledSales(data, payment2, final).length, 1);
  assert.equal(data.progressosCampanha[0].pendingPoints, 0);
  assert.equal(data.progressosCampanha[0].availablePoints, 100);
  assert.equal(JSON.stringify(data.eventosCampanha[0]), JSON.stringify(immutablePendingEvent));
  assert.equal(data.eventosCampanha.some((event) => event.transition === "confirmed" && event.confirmsEventId === immutablePendingEvent.id), true);
});

test("FIFO quita a venda mais antiga antes da próxima", () => {
  const e = engine();
  const data = db();
  data.vendas.push(
    sale({ id: "a", status: "fiado", data: "2026-08-01T12:00:00.000Z", valorFinal: 50, creditOriginalAmount: 50 }),
    sale({ id: "b", status: "fiado", data: "2026-08-02T12:00:00.000Z", valorFinal: 80, creditOriginalAmount: 80 }),
  );
  const allocations = e.allocatePayment(data, "c1", 70, "pay", "2026-08-10T12:00:00.000Z");
  assert.equal(JSON.stringify(allocations.map((item) => [item.saleId, item.amount, item.settledSale])), JSON.stringify([
    ["a", 50, true],
    ["b", 20, false],
  ]));
  assert.equal(e.allocatePayment(data, "c1", 70, "pay").length, 2);
  assert.equal(data.alocacoesPagamento.length, 2);
});

test("pontos por categoria e por unidade usam a mesma camada", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({
    id: "cat",
    type: "points",
    qualification: { categoryIds: ["Bebidas"], pointsMode: "unit" },
    rule: { pointsAward: 10 },
  });
  const evaluated = e.evaluateOne(campaign, sale({ itens: [
    { produtoId: "p1", quantidade: 3, subtotalFinal: 30 },
    { produtoId: "p2", quantidade: 10, categoria: "Doces", subtotalFinal: 50 },
  ] }), { client, products: [product, { id: "p2", categoria: "Doces" }], events: [] });
  assert.equal(evaluated.points, 30);
});

test("desconto progressivo informa próxima faixa e só aplica quando selecionado", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({
    id: "discount",
    type: "quantity_discount",
    qualification: { productIds: ["p1"] },
    rule: { thresholds: [
      { quantity: 3, discountPercent: 5 },
      { quantity: 5, discountPercent: 10 },
      { quantity: 10, discountPercent: 15 },
    ] },
  });
  const evaluated = e.evaluateOne(campaign, sale({ itens: [{ produtoId: "p1", quantidade: 4, subtotalFinal: 40 }] }), { client, products: [product], events: [] });
  assert.equal(evaluated.opportunity.discountPercent, 5);
  assert.equal(evaluated.opportunity.missingQuantity, 1);
  assert.equal(e.resolveConflicts([evaluated], []).appliedBenefits.length, 0);
  assert.equal(e.resolveConflicts([evaluated], ["discount"]).appliedBenefits.length, 1);
});

test("combo suporta quantidades e múltiplos ciclos", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({
    id: "combo",
    type: "combo",
    rule: { requiredItems: [
      { productId: "p1", quantity: 2 },
      { productId: "p2", quantity: 1 },
    ], comboPrice: 20, multipleCycles: true },
  });
  const evaluated = e.evaluateOne(campaign, sale({ itens: [
    { produtoId: "p1", quantidade: 4 },
    { produtoId: "p2", quantidade: 2 },
  ] }), { client, products: [], events: [] });
  assert.equal(evaluated.opportunity.cycles, 2);
});

test("nth_product pode limitar uma contagem por dia", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({
    id: "return",
    type: "nth_product",
    qualification: { productIds: ["p1"], countMode: "purchase", dailyLimit: 1 },
    rule: { requiredPurchases: 5 },
  });
  const events = [{ id: "return:c1:sale:s1:earned", campaignId: "return", clientId: "c1", sourceType: "sale", transition: "earned", status: "confirmed", dayKey: "2026-08-10" }];
  assert.equal(e.evaluateOne(campaign, sale(), { client, products: [product], events }), null);
});

test("resgate de produto baixa estoque uma vez e pontos são consumidos", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({
    id: "points",
    type: "points",
    rewards: [{ id: "gift", type: "product", productId: "p1", quantity: 2, pointsCost: 100, name: "Produto" }],
  });
  const data = db([campaign]);
  data.progressosCampanha.push({ id: e.progressId("points", "c1"), campaignId: "points", clientId: "c1", availablePoints: 120, availableRewards: 0, redeemedRewards: 0, version: 0 });
  const first = e.redeem(data, "points", "c1", "gift", { operationId: "redeem-1" });
  const retry = e.redeem(data, "points", "c1", "gift", { operationId: "redeem-1" });
  assert.equal(first.id, retry.id);
  assert.equal(data.produtos[0].estoqueAtual, 18);
  assert.equal(data.progressosCampanha[0].availablePoints, 20);
  assert.equal(data.movimentacoesEstoque.length, 1);
});

test("cancelamento reverte evento sem duplicar", () => {
  const e = engine();
  const data = db([e.normalizeCampaign({ id: "buy", type: "buy_get", qualification: { productIds: ["p1"] }, rule: { requiredQuantity: 5 } })]);
  const currentSale = sale({ itens: [{ produtoId: "p1", quantidade: 5, subtotalFinal: 50 }] });
  e.applySale(data, currentSale);
  assert.equal(data.progressosCampanha[0].availableRewards, 1);
  assert.equal(e.reverseSale(data, currentSale).length, 1);
  assert.equal(e.reverseSale(data, currentSale).length, 0);
  assert.equal(data.progressosCampanha[0].confirmedProgress, 0);
  assert.equal(data.progressosCampanha[0].availableRewards, 0);
});

test("dados de empresas diferentes não compartilham projeção", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({ id: "buy", type: "buy_get", rule: { requiredQuantity: 1 } });
  const a = db([campaign]);
  const b = db([campaign]);
  e.applySale(a, sale({ businessId: "a" }));
  assert.equal(a.progressosCampanha.length, 1);
  assert.equal(b.progressosCampanha.length, 0);
});

test("campanhas exclusivas geram conflito e exigem escolha explícita", () => {
  const e = engine();
  const campaigns = ["a", "b"].map((id) => e.normalizeCampaign({ id, type: "buy_get", rule: { requiredQuantity: 1 }, stacking: { allowed: false, conflictGroup: "loyalty" } }));
  const evaluations = campaigns.map((campaign) => e.evaluateOne(campaign, sale(), { client, products: [product], events: [] }));
  const unresolved = e.resolveConflicts(evaluations, []);
  assert.equal(unresolved.conflicts.length, 1);
  assert.equal(unresolved.progress.length, 0);
  const chosen = e.resolveConflicts(evaluations, ["b"]);
  assert.deepEqual(Array.from(chosen.progress, (item) => item.campaign.id), ["b"]);
});

test("benefício selecionado gera evento e snapshot para o recibo", () => {
  const e = engine();
  const data = db([e.normalizeCampaign({ id: "discount", name: "Leve mais", type: "quantity_discount", qualification: { productIds: ["p1"] }, rule: { thresholds: [{ quantity: 3, discountPercent: 10 }] } })]);
  const currentSale = sale({ appliedCampaignIds: ["discount"], itens: [{ produtoId: "p1", quantidade: 3, precoOriginal: 10, precoFinalUnitario: 9, subtotalFinal: 27 }] });
  const result = e.applySale(data, currentSale);
  assert.equal(result.events[0].benefit.discountPercent, 10);
  assert.equal(result.snapshots[0].benefitApplied.kind, "quantity_discount");
  assert.equal(e.receiptSummary(result.snapshots)[0].text, "10% de desconto aplicado");
  assert.equal(data.progressosCampanha.length, 0);
});

test("pontos expirados viram novo evento sem alterar o evento original", () => {
  const e = engine();
  const data = db([e.normalizeCampaign({ id: "points-expiry", type: "points", startsAt: "2025-01-01", rule: { pointsAmount: 1, pointsAward: 1, pointsExpirationDays: 10 }, rewards: [{ id: "gift", type: "external", name: "Brinde", pointsCost: 100 }] })]);
  const oldSale = sale({ id: "old", operationId: "old", data: "2026-01-01T12:00:00.000Z", valorFinal: 50, itens: [{ produtoId: "p1", quantidade: 1, precoOriginal: 50, precoFinalUnitario: 50, subtotalFinal: 50 }] });
  e.applySale(data, oldSale);
  const original = structuredClone(data.eventosCampanha[0]);
  const expired = e.expirePoints(data, "2026-02-01T12:00:00.000Z");
  assert.equal(expired.length, 1);
  assert.equal(data.progressosCampanha[0].availablePoints, 0);
  assert.equal(JSON.stringify(data.eventosCampanha[0]), JSON.stringify(original));
  assert.equal(expired[0].transition, "expired");
  assert.equal(e.expirePoints(data, "2026-02-02T12:00:00.000Z").length, 0);
});

test("identidade canônica encontra projeção legada exibida e permite resgate", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({
    id: "points",
    type: "points",
    rewards: [
      { id: "monster", type: "product", productId: "p1", name: "Monster", quantity: 1, pointsCost: 100 },
      { id: "voucher", type: "external", name: "Vale R$ 20", quantity: 1, pointsCost: 200 },
    ],
  });
  const data = db([campaign]);
  data.progressosCampanha.push({
    id: "c1__points",
    businessId: "business-a",
    campaignId: "points",
    clientId: "c1",
    availablePoints: 200,
    availableRewards: 0,
    redeemedRewards: 0,
    version: 0,
  });

  assert.equal(e.progressIdentity({ businessId: "business-a", campaignId: "points", clientId: "c1" }).id, "points__c1");
  assert.equal(e.findProgressIndex(data, "points", "c1", "business-a"), 0);
  e.redeem(data, "points", "c1", "monster", { operationId: "legacy-progress", businessId: "business-a" });
  assert.equal(data.progressosCampanha[0].availablePoints, 100);
  assert.equal(data.produtos[0].estoqueAtual, 19);
});

test("recompensas de pontos são opções explícitas e consomem somente o custo escolhido", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({
    id: "points-options",
    type: "points",
    rewards: [
      { id: "gift-100", type: "external", name: "Brinde", pointsCost: 100 },
      { id: "gift-200", type: "external", name: "Vale", pointsCost: 200 },
      { id: "gift-300", type: "external", name: "Premium", pointsCost: 300 },
    ],
  });
  const first = db([campaign]);
  first.progressosCampanha.push({ id: e.progressId(campaign.id, "c1"), campaignId: campaign.id, clientId: "c1", availablePoints: 300 });
  e.redeem(first, campaign.id, "c1", "gift-100", { operationId: "choose-100" });
  assert.equal(first.progressosCampanha[0].availablePoints, 200);

  const second = db([campaign]);
  second.progressosCampanha.push({ id: e.progressId(campaign.id, "c1"), campaignId: campaign.id, clientId: "c1", availablePoints: 200 });
  e.redeem(second, campaign.id, "c1", "gift-200", { operationId: "choose-200" });
  assert.equal(second.progressosCampanha[0].availablePoints, 0);
});

test("recompensa externa não altera estoque e estoque zero não consome pontos", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({
    id: "stock-validation",
    type: "points",
    rewards: [
      { id: "internal", type: "product", productId: "p1", name: "Produto", quantity: 1, pointsCost: 100 },
      { id: "external", type: "external", name: "Vale", pointsCost: 100 },
    ],
  });
  const external = db([campaign]);
  external.progressosCampanha.push({ id: e.progressId(campaign.id, "c1"), campaignId: campaign.id, clientId: "c1", availablePoints: 100 });
  e.redeem(external, campaign.id, "c1", "external", { operationId: "external" });
  assert.equal(external.produtos[0].estoqueAtual, 20);
  assert.equal(external.movimentacoesEstoque.length, 0);

  const unavailable = db([campaign]);
  unavailable.produtos[0].estoqueAtual = 0;
  unavailable.progressosCampanha.push({ id: e.progressId(campaign.id, "c1"), campaignId: campaign.id, clientId: "c1", availablePoints: 100 });
  assert.throws(() => e.redeem(unavailable, campaign.id, "c1", "internal", { operationId: "no-stock" }), /Estoque insuficiente/);
  assert.equal(unavailable.progressosCampanha[0].availablePoints, 100);
  assert.equal(unavailable.resgatesCampanha.length, 0);
});

test("resgate por variação reduz somente o estoque escolhido", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({ id: "variant-reward", type: "points", rewards: [{ id: "variant", type: "product", productId: "p1", variantId: "v1", name: "Tradicional", quantity: 2, pointsCost: 100 }] });
  const data = db([campaign]);
  data.variacoesProdutos.push({ id: "v1", parentProductId: "p1", displayName: "Tradicional", stock: 8, active: true });
  data.progressosCampanha.push({ id: e.progressId(campaign.id, "c1"), campaignId: campaign.id, clientId: "c1", availablePoints: 100 });
  e.redeem(data, campaign.id, "c1", "variant", { operationId: "variant" });
  assert.equal(data.variacoesProdutos[0].stock, 6);
  assert.equal(data.produtos[0].estoqueAtual, 20);
});

test("mesma operação em dois dispositivos produz o mesmo redemptionId", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({ id: "two-devices", type: "points", rewards: [{ id: "gift", type: "external", name: "Brinde", pointsCost: 100 }] });
  const deviceA = db([campaign]), deviceB = db([campaign]);
  for (const data of [deviceA, deviceB]) data.progressosCampanha.push({ id: e.progressId(campaign.id, "c1"), businessId: "business-a", campaignId: campaign.id, clientId: "c1", availablePoints: 100 });
  const a = e.redeem(deviceA, campaign.id, "c1", "gift", { operationId: "same-operation", businessId: "business-a" });
  const b = e.redeem(deviceB, campaign.id, "c1", "gift", { operationId: "same-operation", businessId: "business-a" });
  assert.equal(a.id, b.id);
  assert.equal(a.operationId, b.operationId);
});

test("resgate respeita isolamento multiempresa", () => {
  const e = engine();
  const campaign = e.normalizeCampaign({ id: "tenant", type: "points", rewards: [{ id: "gift", type: "external", name: "Brinde", pointsCost: 100 }] });
  const data = db([campaign]);
  data.progressosCampanha.push({ id: e.progressId(campaign.id, "c1"), businessId: "business-b", campaignId: campaign.id, clientId: "c1", availablePoints: 100 });
  assert.throws(() => e.redeem(data, campaign.id, "c1", "gift", { operationId: "wrong-tenant", businessId: "business-a" }), /Progresso não encontrado/);
  assert.equal(data.progressosCampanha[0].availablePoints, 100);
});
