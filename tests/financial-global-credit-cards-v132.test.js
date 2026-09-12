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

test("cartão global atende espaços atuais e futuros sem snapshot de IDs", () => {
  const engine = loadEngine(), card = engine.normalizeCreditCardAccess({
    id: "nubank", cardHomeSpaceId: "technical-anchor", active: true, accessMode: "all_spaces",
    allowedFinancialSpaceIds: ["casa"], defaultFinancialSpaceId: "technical-anchor",
  });
  assert.deepEqual(Array.from(card.allowedFinancialSpaceIds), []);
  for (const spaceId of ["casa", "carro", "iptv", "apartamento-2"]) assert.equal(engine.creditCardAllowsSpace(card, spaceId), true);
});

test("alguns espaços e somente um são restrições de uso", () => {
  const engine = loadEngine(), selected = engine.normalizeCreditCardAccess({
    id: "prime", cardHomeSpaceId: "anchor", active: true, accessMode: "selected_spaces",
    allowedFinancialSpaceIds: ["primeline"], defaultFinancialSpaceId: "primeline",
  }), single = engine.normalizeCreditCardAccess({ ...selected, accessMode: "single_space", allowedFinancialSpaceIds: ["carro"], defaultFinancialSpaceId: "carro" });
  assert.equal(engine.creditCardAllowsSpace(selected, "primeline"), true);
  assert.equal(engine.creditCardAllowsSpace(selected, "casa"), false);
  assert.equal(engine.creditCardAllowsSpace(single, "carro"), true);
  assert.equal(engine.creditCardAllowsSpace(single, "anchor"), false);
  assert.equal(single.id, selected.id);
});

test("uma fatura única agrega compras do mesmo cartão por espaço", () => {
  const engine = loadEngine(), cardId = "c6", invoiceId = "c6_2026-10", purchases = [
    { creditCardId: cardId, creditCardInvoiceId: invoiceId, financialSpaceId: "carro", categoryId: "combustivel", amountCents: 10000 },
    { creditCardId: cardId, creditCardInvoiceId: invoiceId, financialSpaceId: "casa", categoryId: "mercado", amountCents: 20000 },
  ], spaceBreakdown = engine.breakdownBy(purchases, "financialSpaceId");
  assert.equal(new Set(purchases.map((item) => item.creditCardId)).size, 1);
  assert.equal(new Set(purchases.map((item) => item.creditCardInvoiceId)).size, 1);
  assert.equal(purchases.reduce((sum, item) => sum + item.amountCents, 0), 30000);
  assert.deepEqual(Object.fromEntries(Array.from(spaceBreakdown, (item) => [item.id, item.amountCents])), { casa: 20000, carro: 10000 });
});

test("wizard abre direto, usa todos os espaços por padrão e aceita cartão sem final", () => {
  const ui = read("js/financial-ui.js"), service = read("js/firebase/financial-space-service.js");
  assert.doesNotMatch(ui, /Em qual espaço o cartão será criado\?/);
  assert.match(ui, /accessMode: existing \? normalized\.accessMode : canShare \? "all_spaces" : "single_space"/);
  assert.match(ui, /Em quais espaços este cartão pode ser usado\?/);
  assert.match(ui, /Também valerá para novos espaços criados por você/);
  assert.match(ui, /Últimos dígitos <small>\(opcional\)<\/small>/);
  assert.match(service, /last4: last4 \|\| null/);
  assert.match(service, /notes: String\(input\.notes/);
});

test("catálogo faz uma consulta por owner, usa cache e deduplica por cardId", () => {
  const service = read("js/firebase/financial-space-service.js"), rules = read("firestore.rules"), indexes = read("firestore.indexes.json");
  assert.match(service, /collectionGroup\(db, "creditCards"\)/);
  assert.match(service, /where\("ownerUid", "==", currentUid\)/);
  assert.match(service, /creditCardCatalogLoadedAt/);
  assert.match(service, /unique\.set\(card\.id, card\)/);
  assert.doesNotMatch(service.slice(service.indexOf("async function listCreditCards"), service.indexOf("function creditCardAccessValue")), /ownedSpaces\(\).*map/);
  assert.match(rules, /match \/\{path=\*\*\}\/creditCards\/\{cardId\}/);
  assert.match(rules, /resource\.data\.ownerUid == request\.auth\.uid/);
  assert.match(indexes, /"collectionGroup": "creditCards"/);
  assert.match(indexes, /"queryScope": "COLLECTION_GROUP"/);
});

test("duplicidade oferece reutilizar ou criar outro sem mesclar cartões legítimos", () => {
  const service = read("js/firebase/financial-space-service.js"), ui = read("js/financial-ui.js");
  assert.match(service, /credit-card-possible-duplicate/);
  assert.match(service, /same_institution_and_last4/);
  assert.match(service, /similar_name_without_last4/);
  assert.match(service, /allowSimilarCard/);
  assert.match(service, /async function useExistingCreditCard/);
  assert.match(ui, /Usar cartão existente/);
  assert.match(ui, /Cadastrar outro/);
});

test("remoção e Rules preservam histórico, privacidade e escopo do owner", () => {
  const service = read("js/firebase/financial-space-service.js"), functions = read("functions/src/index.js"), rules = read("firestore.rules");
  assert.match(service, /async function archiveCreditCard/);
  assert.match(functions, /deleteUnusedCreditCard/);
  assert.match(functions, /references>0\|\|committedCents!==0/);
  assert.match(functions, /FINANCIAL_CREDIT_CARD_ARCHIVED/);
  assert.match(rules, /request\.auth\.uid == card\.ownerUid/);
  assert.match(rules, /'defaultFinancialSpaceId', 'active'/);
  assert.match(rules, /request\.resource\.data\.last4 == null/);
});

test("migração v132 audita e normaliza metadados sem tocar faturas ou compras", () => {
  const migration = read("scripts/migrate-global-credit-cards-v132.cjs");
  assert.match(migration, /global_credit_cards_v132_2026_09/);
  assert.match(migration, /financialSpaceIdLegado/);
  assert.match(migration, /invoicesPreserved/);
  assert.match(migration, /transactionsPreserved/);
  assert.match(migration, /noFinancialResultCreated:true/);
  assert.doesNotMatch(migration, /delete:/);
});
