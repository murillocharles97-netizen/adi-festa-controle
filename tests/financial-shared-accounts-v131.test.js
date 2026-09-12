const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(file, "utf8");

function engine() {
  const context = { window: null, console, Date, Intl, Math, Number, String, Set, Map, Object, Array, structuredClone };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read("js/financial-engine.js"), context);
  return context.FinancialEngine;
}

test("Inter e Banco Inter compartilham a mesma chave institucional sem bloquear contas legítimas", () => {
  const value = engine();
  assert.equal(value.normalizeInstitutionKey("Inter"), "banco_inter");
  assert.equal(value.normalizeInstitutionKey("BANCO INTER S.A."), "banco_inter");
  assert.equal(value.normalizeInstitutionKey("Banco inter"), "banco_inter");
  assert.notEqual(value.financialAccountKey({ id: "inter-pessoal", financialSpaceId: "casa" }), value.financialAccountKey({ id: "inter-pj", financialSpaceId: "empresa" }));
});

test("conta canônica pode atender todos, alguns ou um único espaço", () => {
  const value = engine(), base = { id: "inter", financialSpaceId: "iptv", accountHomeSpaceId: "iptv", active: true };
  const all = value.normalizeFinancialAccountAccess({ ...base, accessMode: "all_spaces", allowedFinancialSpaceIds: ["carro"] });
  assert.deepEqual(Array.from(all.allowedFinancialSpaceIds), []);
  assert.equal(value.financialAccountAllowsSpace(all, "carro"), true);
  const selected = value.normalizeFinancialAccountAccess({ ...base, accessMode: "selected_spaces", allowedFinancialSpaceIds: ["carro", "iptv"] });
  assert.equal(value.financialAccountAllowsSpace(selected, "carro"), true);
  assert.equal(value.financialAccountAllowsSpace(selected, "casa"), false);
  const single = value.normalizeFinancialAccountAccess(base);
  assert.equal(single.accessMode, "single_space");
  assert.equal(value.financialAccountAllowsSpace(single, "iptv"), true);
  assert.equal(value.financialAccountAllowsSpace(single, "carro"), false);
});

test("Home consolidada soma uma conta compartilhada apenas uma vez", () => {
  const value = engine(), canonical = {
    id: "inter", financialSpaceId: "iptv", accountHomeSpaceId: "iptv", currentBalanceCents: 9590,
    includeInAvailableBalance: true, active: true, accessMode: "all_spaces", allowedFinancialSpaceIds: [], defaultFinancialSpaceId: "iptv",
  };
  assert.equal(value.availableBalance([
    { ...canonical, usageFinancialSpaceId: "carro" },
    { ...canonical, usageFinancialSpaceId: "iptv" },
    { ...canonical, usageFinancialSpaceId: "casa" },
  ]), 9590);
});

test("serviço exige criação explícita, reutiliza conta existente e preserva o espaço do lançamento", () => {
  const service = read("js/firebase/financial-space-service.js"), ui = read("js/financial-ui.js");
  assert.match(service, /financial-account-possible-duplicate/);
  assert.match(service, /async function useExistingFinancialAccount/);
  assert.match(service, /financialAccountHomeSpaceId/);
  assert.match(service, /uniqueBy\([\s\S]*Engine\.financialAccountKey/);
  assert.doesNotMatch(service, /getOrCreateAccount|createAccountWhenReceiving|createBankAccountFromPaymentMethod/);
  assert.match(ui, /Onde você recebeu\?/);
  assert.match(ui, /De onde saiu o dinheiro\?/);
  assert.match(ui, /Cadastrar nova conta/);
  assert.match(ui, /Usar conta existente/);
  assert.match(ui, /Criar outra conta/);
  assert.doesNotMatch(ui, /Mesclar contas/);
});

test("migração do Inter é idempotente, preserva o espaço e não gera resultado financeiro", () => {
  const migration = read("scripts/migrate-financial-inter-account-dedup-v131.cjs");
  assert.match(migration, /financial_account_dedup_inter_v131_2026_09/);
  assert.match(migration, /currentDocument: \{ updateTime: duplicate\.updateTime \}/);
  assert.match(migration, /financialSpaceId: row\.value\.financialSpaceId \|\| null/);
  assert.match(migration, /noFinancialResultCreated: true/);
  assert.match(migration, /physicalBalanceCents: 0/);
  assert.match(migration, /accessMode: 'all_spaces'/);
});

test("Rules validam a conta no home space e bloqueiam compartilhamento pessoal para funcionário", () => {
  const rules = read("firestore.rules"), functions = read("functions/src/index.js");
  assert.match(rules, /function validCrossSpaceFinancialAccountUse/);
  assert.match(rules, /request\.auth\.uid == account\.ownerUid/);
  assert.match(rules, /validFinancialEntryAccount/);
  assert.match(functions, /deleteUnusedFinancialAccount/);
  assert.match(functions, /references>0/);
  assert.match(functions, /accountBalance!==0/);
});
