const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-08-10T12:00:00.000Z"])); }
  static now() { return new Date("2026-08-10T12:00:00.000Z").getTime(); }
}

function environment(data) {
  let sequence = 0;
  const context = {
    console, structuredClone, Intl, Date: FixedDate, Math, Number, String, Set, Map, Object,
    encodeURIComponent,
    crypto: { randomUUID: () => `uuid-${++sequence}` },
    Utils: { uuid: () => `operation-${++sequence}` },
    DB: {
      carregar: () => data,
      alterar: (mutator) => { mutator(data); return data; },
      getBusinessId: () => "business-a",
    },
    ProductVariations: { recomputeInData: () => {} },
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ["campaign-engine-v2.js", "campanhas.js", "fiados.js", "vendas.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/${file}`), "utf8"), context);
  }
  return context;
}

const baseData = () => ({
  clientes: [{ id: "client", nome: "Cliente", ativo: true, saldo: 0 }],
  produtos: [{ id: "monster", nome: "Monster", categoria: "Bebidas", preco: 10, estoqueAtual: 20 }],
  variacoesProdutos: [], vendas: [], pagamentos: [], movimentacoes: [], movimentacoesEstoque: [],
  campanhas: [], progressosCampanha: [], eventosCampanha: [], resgatesCampanha: [],
  alocacoesPagamento: [], recompensas: [], segmentosClientes: [],
});

function activeCampaign(engine, input) {
  return engine.normalizeCampaign({ startsAt: "2026-01-01T00:00:00.000Z", ...input });
}

function creditSale(id, amount, date = "2026-08-10T12:00:00.000Z") {
  return {
    id, operationId: id, businessId: "business-a", clienteId: "client", clientId: "client",
    clienteNome: "Cliente", status: "fiado", data: date, valorFinal: amount,
    creditOriginalAmount: amount, creditPaidAmount: 0, creditRemainingAmount: amount, creditSettled: false,
    itens: [{ produtoId: "monster", quantidade: 1, precoOriginal: amount, precoFinalUnitario: amount, subtotalFinal: amount }],
  };
}

test("Fiados separa saldo legado de vendas rastreadas e não cria campanha retroativa", () => {
  const data = baseData();
  data.clientes[0].saldo = -100;
  const env = environment(data);
  const payment = env.Fiados.receber("client", 40, "Saldo antigo");
  assert.equal(payment.legacyAmount, 40);
  assert.equal(payment.allocatedAmount, 0);
  assert.equal(payment.campaignConfirmations.length, 0);
  assert.equal(data.alocacoesPagamento.length, 0);
  assert.equal(data.eventosCampanha.length, 0);
  assert.equal(data.vendas.length, 0);
});

test("Fiados calcula legado residual, aplica FIFO e salva snapshot da confirmação", () => {
  const data = baseData();
  const env = environment(data);
  const campaign = activeCampaign(env.CampaignEngineV2, { id: "points", type: "points", rule: { pointsAmount: 1, pointsAward: 1 } });
  data.campanhas.push(campaign);
  const sale = creditSale("credit", 70);
  data.vendas.push(sale);
  env.CampaignEngineV2.applySale(data, sale);
  data.clientes[0].saldo = -100;

  const first = env.Fiados.receber("client", 50, "Parcial");
  assert.equal(first.legacyAmount, 30);
  assert.equal(first.allocatedAmount, 20);
  assert.equal(first.campaignConfirmations.length, 0);
  assert.equal(data.progressosCampanha[0].pendingPoints, 70);

  const second = env.Fiados.receber("client", 50, "Quitação");
  assert.equal(second.legacyAmount, 0);
  assert.equal(second.allocatedAmount, 50);
  assert.equal(second.campaignConfirmations.length, 1);
  assert.equal(second.campaignConfirmations[0].campaignId, campaign.id);
  assert.equal(second.campaignConfirmations[0].saleId, sale.id);
  assert.equal(second.campaignConfirmations[0].pointsConfirmed, 70);
  assert.equal(data.progressosCampanha[0].availablePoints, 70);
  assert.equal(data.progressosCampanha[0].pendingPoints, 0);
});

test("Campanhas aplica desconto e combo somente após seleção explícita", () => {
  const data = baseData();
  data.produtos.push({ id: "brownie", nome: "Brownie", categoria: "Doces", preco: 10, estoqueAtual: 20 });
  const env = environment(data);
  const discount = activeCampaign(env.CampaignEngineV2, {
    id: "discount", type: "quantity_discount", qualification: { productIds: ["monster"] },
    rule: { thresholds: [{ quantity: 3, discountPercent: 10 }] }, stacking: { allowed: true, conflictGroup: "benefits" },
  });
  const combo = activeCampaign(env.CampaignEngineV2, {
    id: "combo", type: "combo", rule: { requiredItems: [{ productId: "monster", quantity: 2 }, { productId: "brownie", quantity: 1 }], comboPrice: 20 },
    stacking: { allowed: true, conflictGroup: "benefits" },
  });
  data.campanhas.push(discount, combo);
  const items = [
    { produtoId: "monster", quantidade: 3, precoOriginal: 10, precoFinalUnitario: 10 },
    { produtoId: "brownie", quantidade: 1, precoOriginal: 10, precoFinalUnitario: 10 },
  ];
  assert.equal(env.Campanhas.aplicarBeneficios(items, "client", { selectedCampaignIds: [] })[0].precoFinalUnitario, 10);
  const discounted = env.Campanhas.aplicarBeneficios(items, "client", { selectedCampaignIds: ["discount"] });
  assert.equal(discounted[0].precoFinalUnitario, 9);
  const comboApplied = env.Campanhas.aplicarBeneficios(items, "client", { selectedCampaignIds: ["combo"] });
  assert.equal(comboApplied.some((entry) => entry.campaignDiscounts.some((benefit) => benefit.type === "combo")), true);
  const withoutBrownie = env.Campanhas.aplicarBeneficios(items.slice(0, 1), "client", { selectedCampaignIds: ["combo"] });
  assert.equal(withoutBrownie[0].campaignDiscounts.length, 0);
});

test("resgate via serviço usa rascunho e preserva o banco quando etapa interna falha", () => {
  const data = baseData();
  data.variacoesProdutos.push({ id: "variant", parentProductId: "monster", displayName: "Tradicional", stock: 3, active: true });
  const env = environment(data);
  const campaign = activeCampaign(env.CampaignEngineV2, { id: "reward", type: "points", rewards: [{ id: "gift", type: "product", productId: "monster", variantId: "variant", quantity: 1, pointsCost: 100 }] });
  data.campanhas.push(campaign);
  data.progressosCampanha.push({ id: env.CampaignEngineV2.progressId(campaign.id, "client"), businessId: "business-a", campaignId: campaign.id, clientId: "client", availablePoints: 100 });
  env.ProductVariations.recomputeInData = () => { throw new Error("aggregate failed"); };
  assert.throws(() => env.Campanhas.resgatar(campaign.id, "client", "gift", { operationId: "rollback", businessId: "business-a" }), /aggregate failed/);
  assert.equal(data.variacoesProdutos[0].stock, 3);
  assert.equal(data.progressosCampanha[0].availablePoints, 100);
  assert.equal(data.resgatesCampanha.length, 0);
  assert.equal(data.movimentacoesEstoque.length, 0);
});

test("venda com combo baixa cada produto individualmente e registra snapshot", () => {
  const data = baseData();
  data.produtos.push({ id: "brownie", nome: "Brownie", categoria: "Doces", preco: 10, custo: 3, estoqueAtual: 20 });
  data.produtos[0].custo = 4;
  const env = environment(data);
  data.campanhas.push(activeCampaign(env.CampaignEngineV2, {
    id: "combo-stock", name: "Combo", type: "combo",
    rule: { requiredItems: [{ productId: "monster", quantity: 2 }, { productId: "brownie", quantity: 1 }], comboPrice: 20 },
    stacking: { allowed: true, conflictGroup: "benefits" },
  }));
  const created = env.Vendas.registrar({
    clienteId: "client", status: "pago", appliedCampaignIds: ["combo-stock"],
    itens: [
      { produtoId: "monster", quantidade: 2, precoOriginal: 10, precoFinalUnitario: 10 },
      { produtoId: "brownie", quantidade: 1, precoOriginal: 10, precoFinalUnitario: 10 },
    ],
  });
  assert.equal(data.produtos.find((entry) => entry.id === "monster").estoqueAtual, 18);
  assert.equal(data.produtos.find((entry) => entry.id === "brownie").estoqueAtual, 19);
  assert.equal(Number(created.valorFinal.toFixed(2)), 20);
  assert.equal(created.campaignReceiptSummary[0].type, "combo");
  assert.equal(created.campaignReceiptSummary[0].benefitApplied.kind, "combo");
});

test("desfazer venda valida campanha antes de remover venda ou restaurar estoque", () => {
  const data = baseData();
  const env = environment(data);
  const campaign = activeCampaign(env.CampaignEngineV2, { id: "undo-protected", type: "points", rule: { pointsAmount: 1, pointsAward: 1 }, rewards: [{ id: "gift", type: "external", name: "Gift", pointsCost: 10 }] });
  data.campanhas.push(campaign);
  const currentSale = {
    id: "undo-sale", operationId: "undo-sale", businessId: "business-a", clienteId: "client", clientId: "client",
    clienteNome: "Cliente", status: "pago", data: new Date().toISOString(), valorFinal: 10, valorTotal: 10,
    itens: [{ produtoId: "monster", quantidade: 1, precoOriginal: 10, precoFinalUnitario: 10, subtotalFinal: 10 }],
  };
  data.vendas.push(currentSale);
  env.CampaignEngineV2.applySale(data, currentSale);
  env.CampaignEngineV2.redeem(data, campaign.id, "client", "gift", { operationId: "undo-redemption", businessId: "business-a" });
  const stockBefore = data.produtos[0].estoqueAtual;
  assert.throws(() => env.Vendas.desfazerUltima(), (error) => error.code === "campaign-redemption-conflict");
  assert.equal(data.vendas.length, 1);
  assert.equal(data.produtos[0].estoqueAtual, stockBefore);
  assert.equal(data.eventosCampanha.filter((event) => event.transition === "reversed").length, 0);
});

test("resolução administrativa cancela venda consumida e registra dívida auditável", () => {
  const data = baseData();
  const env = environment(data);
  const campaign = activeCampaign(env.CampaignEngineV2, { id: "undo-admin", type: "points", rule: { pointsAmount: 1, pointsAward: 1 }, rewards: [{ id: "gift", type: "external", name: "Gift", pointsCost: 100 }] });
  data.campanhas.push(campaign);
  const currentSale = {
    id: "undo-admin-sale", operationId: "undo-admin-sale", businessId: "business-a", clienteId: "client", clientId: "client",
    clienteNome: "Cliente", status: "pago", data: new Date().toISOString(), valorFinal: 100, valorTotal: 100,
    itens: [{ produtoId: "monster", quantidade: 10, precoOriginal: 10, precoFinalUnitario: 10, subtotalFinal: 100 }],
  };
  data.vendas.push(currentSale);
  env.CampaignEngineV2.applySale(data, currentSale);
  env.CampaignEngineV2.redeem(data, campaign.id, "client", "gift", { operationId: "undo-admin-redemption", businessId: "business-a" });
  const removed = env.Vendas.desfazerUltima({ administrativeResolution: { mode: "record_benefit_debt", reason: "Devolução integral do pedido", actorId: "owner-a" } });
  assert.equal(removed.id, currentSale.id);
  assert.equal(data.vendas.length, 0);
  assert.equal(data.progressosCampanha[0].availablePoints, 0);
  assert.equal(data.progressosCampanha[0].pointsDebt, 100);
  const reversal = data.eventosCampanha.find((event) => event.transition === "reversed");
  assert.equal(reversal.administrativeResolution.mode, "record_benefit_debt");
  assert.equal(reversal.administrativeResolution.reason, "Devolução integral do pedido");
  assert.equal(reversal.administrativeResolution.actorId, "owner-a");
  assert.equal(data.movimentacoes.some((event) => event.tipo === "ajuste_administrativo_campanha"), true);
  assert.throws(() => env.Vendas.desfazerUltima(), /Nenhuma venda/);
});

test("sync possui validação transacional para pontos e estoque em resgate concorrente", () => {
  const source = fs.readFileSync(path.join(__dirname, "../js/firebase/sync.js"), "utf8");
  assert.match(source, /eventKind === "campaign_redemption" && !alreadyApplied/);
  assert.match(source, /campaign-redemption-conflict/);
  assert.match(source, /campaign-stock-conflict/);
  assert.match(source, /runTransaction\(db/);
});
