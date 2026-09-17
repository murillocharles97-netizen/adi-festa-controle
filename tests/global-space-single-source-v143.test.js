const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = (path) => fs.readFileSync(path, "utf8");

function spaceHarness() {
  const cache = new Map(), listeners = new Map(), db = {
    config: { dashboard: { dailySalesGoalsBySpaceId: { car: 350 } } },
    vendas: [], produtos: [], clientes: [], pagamentos: [], catalogOrders: [], customerSubscriptions: [],
  }, window = {
    FirebaseSession: { businessId: "business-a", user: { uid: "owner-a" }, profile: { uid: "owner-a", role: "owner" } },
    BusinessContext: { get: () => ({ businessId: "business-a", userProfile: { uid: "owner-a" }, business: { name: "Empresa A" } }) },
    DB: { getBusinessId: () => "business-a", carregar: () => db, alterar: (mutate) => mutate(db) },
    Utils: { toast() {} }, Router: { atual: () => "inicio" }, AppPageRuntime: { mount() {} },
  }, context = {
    window, document: { querySelector: () => null }, structuredClone, console,
    localStorage: { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, String(value)) },
    CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
  };
  Object.assign(window, context);
  vm.createContext(context);
  vm.runInContext(read("js/spaces.js"), context, { filename: "spaces.js" });
  return { window, db };
}

const space = (name) => ({
  id: "car", name, type: "business", operationalType: "operation", businessId: "business-a",
  linkedBusinessId: "business-a", ownerUid: "owner-a", active: true, status: "active",
  capabilities: { finance: true, sales: true, products: true, inventory: false, goals: true },
});

test("renomear Carro para Táxi, Táxi teste e de volta preserva um único ID em todos os módulos", () => {
  const { window, db } = spaceHarness();
  window.SpaceContext.setSpaces([space("Carro")]);
  window.SpaceContext.selectHome("car");
  window.SpaceContext.selectSales("car");
  const product = { id: "fuel", spaceAccessMode: "single_space", allowedSpaceIds: ["car"], defaultSpaceId: "car" };

  window.SpaceContext.setSpaces([space("Táxi")]);
  assert.equal(window.SpaceContext.list()[0].id, "car");
  assert.equal(window.SpaceContext.selectionLabel("home"), "Táxi");

  window.SpaceContext.setSpaces([space("Táxi teste")]);

  assert.equal(window.SpaceContext.list().length, 1);
  assert.equal(window.SpaceContext.list()[0].id, "car");
  assert.equal(window.SpaceContext.selectionLabel("home"), "Táxi teste");
  assert.equal(window.SpaceContext.selectionLabel("sales"), "Táxi teste");
  assert.equal(window.SpaceContext.productAllowsSpace(product, "car"), true);
  assert.equal(window.SpaceContext.goalFor(db.config, "car"), 350);
  assert.match(window.SpaceContext.availabilityFields(product), /Táxi teste/);

  window.SpaceContext.setSpaces([space("Táxi")]);
  assert.equal(window.SpaceContext.list().length, 1);
  assert.equal(window.SpaceContext.list()[0].id, "car");
  assert.equal(window.SpaceContext.selectionLabel("home"), "Táxi");
  assert.equal(window.SpaceContext.selectionLabel("sales"), "Táxi");
  assert.match(window.SpaceContext.availabilityFields(product), /Táxi/);
});

test("Financeiro deriva metadados do SpaceContext e filtra capability finance sem consulta duplicada", () => {
  const source = read("js/firebase/financial-space-service.js"),
    listBody = source.slice(source.indexOf("async function listSpaces"), source.indexOf("function selectedSpaceId"));
  assert.match(source, /window\.SpaceContext\?\.list\?\.\(\)/);
  assert.match(source, /space\.capabilities\?\.finance === true/);
  assert.match(listBody, /window\.SpaceService\.load/);
  assert.match(listBody, /canonicalFinancialSpaces\(\)/);
  assert.doesNotMatch(listBody, /getDocs|collection\(db, "financialSpaces"\)/);
  assert.match(source, /localStorage\.removeItem\(cacheKey\(\)\)/);
  assert.match(source, /addEventListener\("veconi-spaces-ready"/);
});

test("nome histórico financeiro é somente fallback e criação usa o serviço global", () => {
  const ui = read("js/financial-ui.js"), service = read("js/firebase/financial-space-service.js");
  assert.match(ui, /spaceName\(entry\.financialSpaceId, entry\.financialSpaceName\)/);
  assert.match(ui, /spaceName\(purchase\.financialSpaceId, purchase\.financialSpaceName\)/);
  assert.doesNotMatch(ui, /financialSpaceName \|\| spaceName/);
  assert.match(service, /window\.SpaceService/);
  assert.match(service, /service\.create\(/);
  assert.match(service, /service\.update\(existing\.id/);
  assert.match(service, /window\.SpaceService\.archive/);
});

test("Home usa trigger próprio e bottom sheet; Todos não vira ID persistido", () => {
  const source = read("js/spaces.js"), css = read("css/spaces.css");
  assert.match(source, /data-space-picker="home"/);
  assert.match(source, /class="modal-box space-picker-modal"/);
  assert.match(source, /data-space-choice="\$\{esc\(id\)\}"/);
  assert.match(source, /Gerenciar espaços/);
  assert.doesNotMatch(source.slice(source.indexOf("if (isHome)"), source.indexOf("if (!isHome")), /<select/);
  assert.match(css, /\.space-picker-option\.is-selected/);
  assert.match(css, /max-height: calc\(100dvh - 16px\)/);
});
