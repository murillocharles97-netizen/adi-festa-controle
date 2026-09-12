const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(file, "utf8");
const loadEngine = () => {
  const context = { window: null, console, Date, Intl, Math, Number, String, Set, Map, Object, Array, structuredClone };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read("js/financial-engine.js"), context);
  return context.FinancialEngine;
};

test("contas, carteiras, investimentos e cartões usam a mesma política de disponibilidade", () => {
  const engine = loadEngine(), resources = [
    engine.normalizeFinancialAccountAccess({ id: "bank", type: "bank_account", accountHomeSpaceId: "anchor", accessMode: "all_spaces", active: true }),
    engine.normalizeFinancialAccountAccess({ id: "cash", type: "cash_wallet", accountHomeSpaceId: "anchor", accessMode: "all_spaces", active: true }),
    engine.normalizeFinancialAccountAccess({ id: "investment", type: "investment_account", accountHomeSpaceId: "anchor", accessMode: "all_spaces", active: true }),
    engine.normalizeCreditCardAccess({ id: "card", cardHomeSpaceId: "anchor", accessMode: "all_spaces", active: true }),
  ];
  assert.deepEqual(Array.from(engine.FINANCIAL_RESOURCE_ACCESS_MODES), ["all_spaces", "selected_spaces", "single_space"]);
  for (const resource of resources) {
    assert.equal(resource.accessMode, "all_spaces");
    assert.equal(engine.isResourceAvailableInSpace(resource, "new-space"), true);
  }
});

test("selected_spaces e single_space restringem uso sem mudar a identidade do recurso", () => {
  const engine = loadEngine(), selected = engine.normalizeFinancialAccountAccess({
    id: "inter", accountHomeSpaceId: "anchor", active: true, accessMode: "selected_spaces",
    allowedFinancialSpaceIds: ["casa", "carro"], defaultFinancialSpaceId: "casa",
  }), single = engine.normalizeFinancialAccountAccess({ ...selected, accessMode: "single_space", allowedFinancialSpaceIds: ["primeline"], defaultFinancialSpaceId: "primeline" });
  assert.equal(engine.financialAccountAllowsSpace(selected, "carro"), true);
  assert.equal(engine.financialAccountAllowsSpace(selected, "iptv"), false);
  assert.equal(engine.financialAccountAllowsSpace(single, "primeline"), true);
  assert.equal(engine.financialAccountAllowsSpace(single, "casa"), false);
  assert.equal(single.id, selected.id);
});

test("todos os fluxos de criação abrem direto e usam all_spaces por padrão", () => {
  const ui = read("js/financial-ui.js"), service = read("js/firebase/financial-space-service.js");
  assert.doesNotMatch(ui, /Em qual espaço criar|data-creation-space/);
  for (const kind of ["bank_account", "account_card", "digital_wallet", "investment_account"]) {
    assert.match(ui, new RegExp(`\"${kind}\"`));
  }
  assert.match(ui, /initialAccessMode[\s\S]*canShare \? "all_spaces" : "single_space"/);
  assert.match(ui, /Onde este item pode ser usado\?/);
  assert.match(ui, /Todos os espaços/);
  assert.match(ui, /Alguns espaços/);
  assert.match(ui, /Somente um espaço/);
  assert.match(service, /input\.accessMode \|\| current\.accessMode \|\| "all_spaces"/);
});

test("lançamento mantém financialSpaceId e referencia uma única conta por home + id", () => {
  const service = read("js/firebase/financial-space-service.js"), engine = loadEngine(), canonical = {
    id: "nubank", financialSpaceId: "anchor", accountHomeSpaceId: "anchor", ownerUid: "owner", currentBalanceCents: 15000,
    includeInAvailableBalance: true, active: true, accessMode: "all_spaces", allowedFinancialSpaceIds: [], defaultFinancialSpaceId: "anchor",
  };
  assert.match(service, /financialAccountHomeSpaceId: resolved\.homeSpaceId/);
  assert.match(service, /financialSpaceId: space\.id/);
  assert.equal(engine.availableBalance([
    { ...canonical, usageFinancialSpaceId: "carro" },
    { ...canonical, usageFinancialSpaceId: "iptv" },
  ]), 15000);
});

test("catálogo de contas faz query por owner e Rules preservam privacidade", () => {
  const service = read("js/firebase/financial-space-service.js"), rules = read("firestore.rules"), indexes = read("firestore.indexes.json");
  assert.match(service, /collectionGroup\(db, "financialAccounts"\)/);
  assert.match(service, /where\("ownerUid", "==", currentUid\)/);
  assert.match(service, /unique\.set\(Engine\.financialAccountKey\(account\), account\)/);
  assert.match(rules, /match \/\{path=\*\*\}\/financialAccounts\/\{accountId\}/);
  assert.match(rules, /resource\.data\.ownerUid == request\.auth\.uid/);
  assert.match(rules, /request\.auth\.uid == account\.ownerUid/);
  assert.match(indexes, /"collectionGroup": "financialAccounts"/);
});

test("duplicidade é avisada, mas segunda conta legítima continua permitida", () => {
  const service = read("js/firebase/financial-space-service.js"), ui = read("js/financial-ui.js");
  assert.match(service, /financial-account-possible-duplicate/);
  assert.match(service, /allowSimilarAccount/);
  assert.match(ui, /Usar conta existente/);
  assert.match(ui, /Criar outra conta/);
  assert.doesNotMatch(ui, /Mesclar contas/);
});

test("migração V134 promove apenas legados sem escopo e preserva restrições explícitas", () => {
  const migration = read("scripts/migrate-global-financial-resources-v134.cjs");
  assert.match(migration, /global_financial_resources_v134_2026_09/);
  assert.match(migration, /explicitMode \? account\.value\.accessMode : 'all_spaces'/);
  assert.match(migration, /explicitScopePreserved/);
  assert.match(migration, /noBalancesChanged: true/);
  assert.match(migration, /noTransactionsCreated: true/);
  assert.match(migration, /noResourcesMerged: true/);
  assert.doesNotMatch(migration, /delete:/);
});
