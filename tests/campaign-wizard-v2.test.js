const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

function ui() {
  const data = {
    clientes: [
      { id: "c1", nome: "Ana", telefone: "17999999999", ativo: true },
      { id: "c2", nome: "Bruno", telefone: "17888888888", ativo: true },
    ],
    produtos: [
      { id: "simple", nome: "Brownie", estoqueAtual: 8, ativo: true },
      { id: "variable", nome: "Monster", totalStock: 14, ativo: true },
    ],
    variacoesProdutos: [
      { id: "traditional", parentProductId: "variable", displayName: "Tradicional", stock: 8, active: true },
      { id: "zero", parentProductId: "variable", displayName: "Zero", stock: 6, active: true },
    ],
    segmentosClientes: [{ id: "vip", nome: "VIP", clientIds: ["c1"] }],
    progressosCampanha: [], resgatesCampanha: [], eventosCampanha: [], campanhas: [],
  };
  const context = {
    console, structuredClone, Intl, Date, Math, Number, String, Set, Map, Object,
    encodeURIComponent, crypto: webcrypto,
    document: { querySelector: () => null, querySelectorAll: () => [] },
    sessionStorage: { getItem: () => null, removeItem() {} },
    Utils: { escapar: (value) => String(value ?? ""), uuid: () => "uuid" },
    DB: { carregar: () => data, getBusinessId: () => "business-a" },
    Produtos: { listar: () => data.produtos },
    Modais: {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/campaign-engine-v2.js", "utf8"), context);
  context.Campanhas = {
    TYPES: context.CampaignEngineV2.TYPES,
    normalize: context.CampaignEngineV2.normalizeCampaign,
    status: () => "ativa",
    listar: () => [], metricas: () => ({ active: 0, eligible: 0, participants: 0, redemptions: 0 }),
  };
  vm.runInContext(fs.readFileSync("js/campanhas-ui.js", "utf8"), context);
  return { hooks: context.CampanhasUI.__test, data, engine: context.CampaignEngineV2 };
}

test("wizard começa com uma recompensa e permite adicionar/remover adicionais", () => {
  const { hooks } = ui();
  const one = hooks.stepReward({ type: "points", rewards: [{ id: "r1", type: "external", name: "Vale", quantity: 1, pointsCost: 100 }] });
  assert.equal((one.match(/data-reward-row/g) || []).length, 1);
  assert.match(one, /Adicionar outra recompensa/);
  assert.doesNotMatch(one, /data-remove-reward="0"/);
  const two = hooks.stepReward({ type: "points", rewards: [{ id: "r1", type: "external", name: "Vale", pointsCost: 100 }, { id: "r2", type: "external", name: "Premium", pointsCost: 200 }] });
  assert.equal((two.match(/data-reward-row/g) || []).length, 2);
  assert.match(two, /data-remove-reward="1"/);
});

test("produto interno e externo exibem somente campos relevantes", () => {
  const { hooks } = ui();
  const internal = hooks.rewardRow({ type: "product", productId: "simple", name: "Brownie", quantity: 1, pointsCost: 100 }, 0, true);
  assert.match(internal, /rewardProductId/);
  assert.doesNotMatch(internal, /rewardVariantId/);
  assert.doesNotMatch(internal, /rewardDescription/);
  assert.match(internal, /Estoque atual: 8/);
  const external = hooks.rewardRow({ type: "external", name: "Vale R\$ 20", description: "No caixa", pointsCost: 200 }, 0, true);
  assert.match(external, /rewardName/);
  assert.match(external, /rewardDescription/);
  assert.doesNotMatch(external, /rewardProductId/);
});

test("produto variável mostra variações e o estoque da variação escolhida", () => {
  const { hooks } = ui();
  const html = hooks.rewardRow({ type: "product", productId: "variable", variantId: "traditional", name: "Monster", quantity: 1, pointsCost: 100 }, 0, true);
  assert.match(html, /rewardVariantId/);
  assert.match(html, /Tradicional/);
  assert.match(html, /Estoque atual: 8/);
});

test("público condicional não mistura todos, segmento e clientes específicos", () => {
  const { hooks } = ui();
  const all = hooks.stepAudience({ eligibility: { audienceType: "all" }, stacking: {}, publicity: {} });
  assert.match(all, /atuais e novos poderão participar/);
  assert.doesNotMatch(all, /name="segmentId"/);
  assert.doesNotMatch(all, /campaign-specific-picker/);
  const segment = hooks.stepAudience({ eligibility: { audienceType: "segment", segmentId: "vip" }, stacking: {}, publicity: {} });
  assert.match(segment, /name="segmentId"/);
  assert.match(segment, /1 clientes correspondem/);
  assert.doesNotMatch(segment, /campaign-specific-picker/);
  const clients = hooks.stepAudience({ eligibility: { audienceType: "clients", clientIds: ["c1"] }, stacking: {}, publicity: {} });
  assert.match(clients, /campaign-specific-picker/);
  assert.match(clients, /1 cliente\(s\) selecionado/);
  assert.doesNotMatch(clients, /name="segmentId"/);
});

test("revisão preserva regra, recompensas, público, período e links de edição", () => {
  const { hooks, engine } = ui();
  const campaign = engine.normalizeCampaign({
    id: "review", name: "Teste de pontos", description: "Troque pontos", type: "points",
    startsAt: "2026-08-10", endsAt: null,
    rule: { pointsAmount: 1, pointsAward: 1 },
    rewards: [{ id: "r1", type: "external", name: "Vale", quantity: 1, pointsCost: 100 }],
    eligibility: { audienceType: "all" }, stacking: { allowed: true },
    publicity: { catalog: true, receipt: true, whatsapp: true },
  });
  const html = hooks.stepReview(campaign);
  assert.match(html, /Teste de pontos/);
  assert.match(html, /100 pontos/);
  assert.match(html, /Todos os clientes/);
  assert.match(html, /Acumulação: Permitida/);
  assert.match(html, /data-edit-step="2"/);
  assert.match(html, /data-edit-step="3"/);
  assert.match(html, /data-edit-step="4"/);
});

test("participantes usam paginação curta sem perder busca e progresso", () => {
  const { hooks, data, engine } = ui();
  data.progressosCampanha = [
    { id: "p1", campaignId: "points", clientId: "c1", availablePoints: 120, pendingPoints: 0 },
    { id: "p2", campaignId: "points", clientId: "c2", availablePoints: 60, pendingPoints: 10 },
  ];
  const campaign = engine.normalizeCampaign({
    id: "points", name: "Pontos", type: "points", rule: { pointsAmount: 1, pointsAward: 1 },
    rewards: [{ id: "r1", type: "external", name: "Vale", pointsCost: 100, quantity: 1 }],
  });
  hooks.setParticipantState({ participantPageSize: 1, participantPage: 2, participantQuery: "", participantFilter: "all" });
  const html = hooks.progressRows(campaign);
  assert.match(html, /Bruno/);
  assert.doesNotMatch(html, />Ana</);
  assert.match(html, /Mostrando 2 a 2 de 2/);
  assert.match(html, /data-participant-page="1"/);
});

test("UX V2 inclui abas de detalhes e estado final explícito de resgate", () => {
  const source = fs.readFileSync("js/campanhas-ui.js", "utf8");
  assert.match(source, /data-detail-tab/);
  assert.match(source, /Participantes/);
  assert.match(source, /Recompensas/);
  assert.match(source, /Desempenho/);
  assert.match(source, /Resgate realizado!/);
  assert.match(source, /Estoque atualizado/);
});
