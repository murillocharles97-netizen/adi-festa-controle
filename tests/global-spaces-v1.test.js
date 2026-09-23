const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = (path) => fs.readFileSync(path, "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadSpaces() {
  const cache = new Map(), listeners = new Map();
  let businessId = "business-a", uid = "owner-a";
  const db = {
    config: { dashboard: { dailySalesGoal: 1000, dailySalesGoalsBySpaceId: { adi: 300, iptv: 200 } } },
    produtos: [], vendas: [], clientes: [], pagamentos: [], catalogOrders: [], customerSubscriptions: [],
  };
  const window = {
    FirebaseSession: { businessId, user: { uid }, profile: { uid, role: "owner" } },
    BusinessContext: { get: () => ({ businessId, userProfile: { uid }, business: { name: businessId } }) },
    DB: {
      getBusinessId: () => businessId,
      carregar: () => db,
      alterar: (mutate) => mutate(db),
    },
    Utils: { toast() {} },
    Router: { atual: () => "inicio" },
    AppPageRuntime: { mount() {} },
    lucide: { createIcons() {} },
  };
  const context = {
    window,
    document: { querySelector: () => null },
    localStorage: {
      getItem: (key) => cache.get(key) ?? null,
      setItem: (key, value) => cache.set(key, String(value)),
    },
    structuredClone,
    CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    addEventListener: (type, listener) => {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    removeEventListener() {},
    dispatchEvent: (event) => (listeners.get(event.type) || []).forEach((listener) => listener(event)),
    console,
  };
  window.window = window;
  Object.assign(window, {
    localStorage: context.localStorage,
    document: context.document,
    addEventListener: context.addEventListener,
    dispatchEvent: context.dispatchEvent,
    CustomEvent: context.CustomEvent,
    structuredClone,
  });
  vm.createContext(context);
  vm.runInContext(read("js/spaces.js"), context, { filename: "spaces.js" });
  return {
    window,
    db,
    cache,
    setBusiness(nextBusinessId, nextUid = uid) {
      businessId = nextBusinessId;
      uid = nextUid;
      window.FirebaseSession.businessId = businessId;
      window.FirebaseSession.user.uid = uid;
      window.FirebaseSession.profile.uid = uid;
    },
  };
}

const fixtures = () => [
  { id: "adi", name: "Adi Festa", type: "business", linkedBusinessId: "business-a", businessId: "business-a", operationalType: "unit", active: true, status: "active", ownerUid: "owner-a", capabilities: { finance: true, sales: true, products: true, inventory: true, goals: true }, isDefault: true },
  { id: "iptv", name: "IPTV", type: "business", linkedBusinessId: "business-a", businessId: "business-a", operationalType: "operation", active: true, status: "active", ownerUid: "owner-a", capabilities: { finance: true, sales: true, products: true, inventory: false, goals: true } },
  { id: "casa", name: "Casa", type: "personal", linkedBusinessId: null, businessId: null, operationalType: "personal", active: true, status: "active", ownerUid: "owner-a", capabilities: { finance: true, sales: false, products: false, inventory: false, goals: false } },
];

test("promove espaços financeiros sem trocar ID nem tipo financeiro persistido", () => {
  const { window } = loadSpaces(), raw = { id: "legacy-id", type: "personal", linkedBusinessId: null, ownerUid: "owner-a", name: "Casa" };
  const normalized = window.SpaceEngine.normalizeSpace(raw);
  assert.equal(normalized.id, raw.id);
  assert.equal(normalized.legacyFinancialType, "personal");
  assert.equal(normalized.type, "personal");
  assert.deepEqual(plain(window.SpaceEngine.globalFields(raw).capabilities), { finance: true, sales: false, products: false, inventory: false, goals: false });
  assert.equal(raw.operationalType, undefined);
});

test("Vender lista apenas espaços ativos com sales=true e nunca aceita IDs agregados", () => {
  const { window } = loadSpaces();
  window.SpaceContext.setSpaces(fixtures());
  assert.deepEqual(Array.from(window.SpaceContext.salesSpaces(), (space) => space.id), ["adi", "iptv"]);
  assert.throws(() => window.SpaceContext.selectSales("casa"), /venda ativo/);
  assert.throws(() => window.SpaceContext.requireSalesSpace("all_spaces"), /Selecione/);
  assert.throws(() => window.SpaceContext.requireSalesSpace("all"), /Selecione/);
  assert.equal(window.SpaceContext.selectSales("iptv").id, "iptv");
  assert.equal(window.SpaceContext.requireSalesSpace(), "iptv");
});

test("Home Todos agrega e as visões Adi Festa/IPTV isolam vendas, clientes e produtos", () => {
  const { window, db } = loadSpaces();
  window.SpaceContext.setSpaces(fixtures());
  Object.assign(db, {
    vendas: [
      { id: "adi-new", spaceId: "adi", clienteId: "c-adi", valorFinal: 20 },
      { id: "adi-legacy-ref", financialSpaceId: "adi", clienteId: "c-adi", valorFinal: 5 },
      { id: "iptv-new", spaceId: "iptv", clienteId: "c-iptv", valorFinal: 30 },
      { id: "legacy-unassigned", clienteId: "c-old", valorFinal: 10 },
      { id: "unknown-space", spaceId: "foreign-or-removed", valorFinal: 100 },
    ],
    clientes: [{ id: "c-adi" }, { id: "c-iptv" }, { id: "c-old" }],
    produtos: [
      { id: "coca", spaceAccessMode: "single_space", allowedSpaceIds: ["adi"], defaultSpaceId: "adi" },
      { id: "plano", itemKind: "service", spaceAccessMode: "single_space", allowedSpaceIds: ["iptv"], defaultSpaceId: "iptv" },
      { id: "shared-legacy" },
    ],
  });
  const all = window.SpaceContext.contextualData(db);
  assert.equal(all.vendas.length, 5);
  assert.equal(all.unassignedLegacySales, 2);
  window.SpaceContext.selectHome("adi");
  const adi = window.SpaceContext.contextualData(db);
  assert.deepEqual(Array.from(adi.vendas, (sale) => sale.id), ["adi-new", "adi-legacy-ref"]);
  assert.deepEqual(Array.from(adi.produtos, (product) => product.id), ["coca", "shared-legacy"]);
  assert.deepEqual(Array.from(adi.clientes, (client) => client.id), ["c-adi"]);
  window.SpaceContext.selectHome("iptv");
  const iptv = window.SpaceContext.contextualData(db);
  assert.deepEqual(Array.from(iptv.vendas, (sale) => sale.id), ["iptv-new"]);
  assert.deepEqual(Array.from(iptv.produtos, (product) => product.id), ["plano", "shared-legacy"]);
});

test("produtos legados permanecem all_spaces e os três modos são canônicos", () => {
  const { window } = loadSpaces(), engine = window.SpaceEngine;
  assert.deepEqual(plain(engine.normalizeProductAccess({})), { spaceAccessMode: "all_spaces", allowedSpaceIds: [], defaultSpaceId: null, spaceScopeVersion: 1 });
  assert.deepEqual(plain(engine.normalizeProductAccess({ spaceAccessMode: "selected_spaces", allowedSpaceIds: ["adi", "iptv"], defaultSpaceId: "outro" })), { spaceAccessMode: "selected_spaces", allowedSpaceIds: ["adi", "iptv"], defaultSpaceId: "adi", spaceScopeVersion: 1 });
  assert.deepEqual(plain(engine.normalizeProductAccess({ spaceAccessMode: "single_space", allowedSpaceIds: ["iptv", "adi"], defaultSpaceId: "iptv" })), { spaceAccessMode: "single_space", allowedSpaceIds: ["iptv"], defaultSpaceId: "iptv", spaceScopeVersion: 1 });
  assert.equal(engine.productAllowsSpace({}, "adi"), true);
  assert.equal(engine.productAllowsSpace({ spaceAccessMode: "single_space", allowedSpaceIds: ["adi"], defaultSpaceId: "adi" }, "iptv"), false);
});

test("meta geral é independente das metas por espaço", () => {
  const { window, db } = loadSpaces();
  window.SpaceContext.setSpaces(fixtures());
  assert.equal(window.SpaceContext.goalFor(db.config, "all_spaces"), 1000);
  assert.equal(window.SpaceContext.goalFor(db.config, "adi"), 300);
  window.SpaceContext.saveGoal(450, "adi");
  assert.equal(window.SpaceContext.goalFor(db.config, "adi"), 450);
  assert.equal(window.SpaceContext.goalFor(db.config, "all_spaces"), 1000);
  assert.equal(db.config.dashboard.goalAggregationMode, "independent_general_goal");
});

test("RBAC de espaços e metas falha fechado para perfis sem gestão", () => {
  const { window } = loadSpaces();
  window.SpaceContext.setSpaces(fixtures());
  window.FirebaseSession.profile.role = "cashier";
  assert.equal(window.SpaceContext.canManage(), false);
  assert.match(window.SpaceContext.renderBar("home"), /data-space-picker="home"/);
  assert.doesNotMatch(window.SpaceContext.renderBar("home"), /<select[^>]+data-space-select="home"/);
  assert.throws(() => window.SpaceContext.saveGoal(500, "adi"), /não pode alterar metas/);
  window.FirebaseSession.profile.role = "manager";
  assert.equal(window.SpaceContext.canManage(), true);
  assert.match(window.SpaceContext.renderBar("home"), /aria-haspopup="dialog"/);
});

test("venda legada só usa financialSpaceId explícito; valor agregado nunca vira ID real", () => {
  const { window } = loadSpaces(), ids = new Set(["adi", "iptv"]);
  assert.equal(window.SpaceEngine.resolveSaleSpaceId({ financialSpaceId: "adi" }, ids), "adi");
  assert.equal(window.SpaceEngine.resolveSaleSpaceId({}, ids), "");
  assert.equal(window.SpaceEngine.resolveSaleSpaceId({ spaceId: "all_spaces" }, ids), "");
  assert.equal(window.SpaceEngine.resolveSaleSpaceId({ spaceId: "all" }, ids), "");
  assert.equal(window.SpaceEngine.resolveSaleSpaceId({ spaceId: "foreign" }, ids), "");
});

test("indicadores de venda ignoram canceladas antes de calcular recentes e mais vendidos", () => {
  const { window } = loadSpaces(), engine = window.SpaceEngine;
  for (const status of ["cancelada", "cancelado", "cancelled", "estornada", "refunded"])
    assert.equal(engine.isValidSale({ status }), false);
  assert.equal(engine.isValidSale({ status: "pago" }), true);
  assert.equal(engine.saleBelongsTo({ spaceId: "adi" }, "adi", new Set(["adi"])), true);
  assert.equal(engine.saleBelongsTo({ spaceId: "iptv" }, "adi", new Set(["adi", "iptv"])), false);
});

test("cache e seleção são isolados por businessId + uid e a promoção é idempotente", () => {
  const harness = loadSpaces(), { window } = harness;
  window.SpaceContext.setSpaces(fixtures());
  window.SpaceContext.selectHome("iptv");
  window.SpaceContext.setSpaces(fixtures());
  assert.equal(window.SpaceContext.list().length, 3);
  harness.setBusiness("business-b");
  assert.equal(window.SpaceContext.homeId(), "all_spaces");
  assert.equal(window.SpaceContext.snapshot().loaded, false);
  assert.equal(window.SpaceContext.salesSpaces().length, 0);
  assert.throws(() => window.SpaceContext.requireSalesSpace(), /Selecione/);
  harness.setBusiness("business-a");
  assert.equal(window.SpaceContext.homeId(), "iptv");
  assert.equal(window.SpaceContext.list().length, 3);
});

test("contratos estruturais preservam Financeiro, isolamento e exigem spaceId novo", () => {
  const rules = read("firestore.rules"), financial = read("functions/src/services/financial-income-service.js"), index = read("index.html"), worker = read("service-worker.js");
  assert.match(rules, /match \/sales\/\{saleId\}/);
  assert.match(rules, /validSaleSpace\(request\.resource\.data, businessId\)/);
  assert.match(rules, /!\(spaceId in \['all', 'all_spaces'\]\)/);
  assert.match(rules, /match \/products\/\{productId\}/);
  assert.match(rules, /validProductSpaceScope/);
  assert.match(financial, /business_\$\{businessId\}/);
  assert.match(index, /spaces\.js\?v=150/);
  assert.match(index, /firebase\/space-service\.js\?v=150/);
  assert.match(worker, /veconi-v150-team-access/);
});
