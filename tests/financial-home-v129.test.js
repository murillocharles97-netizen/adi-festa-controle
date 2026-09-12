const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(file, "utf8");
const ui = read("js/financial-ui.js"), service = read("js/firebase/financial-space-service.js"), backend = read("functions/src/services/financial-income-service.js"), rules = read("firestore.rules"), html = read("index.html"), sw = read("service-worker.js");

function engine() {
  const context = { window: null, console, Date, Intl, Math, Number, String, Set, Map, Object, Array, structuredClone };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read("js/financial-engine.js"), context);
  return context.FinancialEngine;
}

test("Home inicia sempre consolidada e oferece quatro conceitos financeiros distintos", () => {
  assert.match(ui, /\? "all_spaces"/);
  assert.match(ui, /state\.view = "dashboard"/);
  for (const label of ["Saldo disponível", "Faturas do mês", "Contas a pagar", "Resultado do mês"]) assert.match(ui, new RegExp(label));
  assert.match(ui, /Sem repetir faturas/);
  assert.match(ui, /if \(state\.activeViewId === "all_spaces"\) return consolidatedHomeMarkup/);
  assert.doesNotMatch(ui.match(/function consolidatedHomeMarkup[\s\S]*?\n  }/)?.[0] || "", /financial-quick-actions/);
});

test("contas têm tipos formais, saldo projetado e investimentos podem ficar fora do disponível", () => {
  const e = engine();
  assert.deepEqual(Array.from(e.FINANCIAL_ACCOUNT_TYPES), ["bank_account", "digital_wallet", "cash_wallet", "investment_account", "other_account"]);
  assert.equal(e.normalizeFinancialAccountType("checking"), "bank_account");
  assert.equal(e.financialAccountBalance({ initialBalanceCents: 1000, currentBalanceCents: 1250 }), 1250);
  assert.equal(e.balanceInputToCents("- 25,90"), -2590);
  assert.equal(e.availableBalance([{ type: "bank_account", currentBalanceCents: 2000 }, { type: "investment_account", currentBalanceCents: 3000 }]), 2000);
  assert.equal(e.availableBalance([{ type: "investment_account", currentBalanceCents: 3000, includeInAvailableBalance: true }]), 3000);
});

test("movimentações atualizam a conta sem transformar ajuste ou transferência em resultado", () => {
  assert.match(service, /accountBalancePatch/);
  assert.match(service, /cashAccountDelta/);
  assert.match(service, /async function adjustFinancialAccountBalance/);
  assert.match(service, /entryType: "balance_adjustment"/);
  assert.match(service, /cashFlowEffect: false/);
  assert.match(service, /expenseRecognized: false/);
  assert.match(service, /transaction\.update\(accountRef, clean\(accountBalancePatch/);
  assert.match(service, /fromFinancialAccountId/);
  assert.match(service, /toFinancialAccountId/);
  assert.match(ui, /accountFlowLabel = isExpense \? "Conta\/carteira de origem" : "Conta\/carteira de destino"/);
  assert.match(ui, /\$\{accountFlowLabel\} \*/);
  assert.match(ui, /Conta\/carteira de origem \*/);
});

test("receitas automáticas usam conta padrão opcional sem perder idempotência", () => {
  assert.match(service, /defaultIncomeFinancialAccountId/);
  assert.match(backend, /defaultIncomeFinancialAccountId/);
  assert.match(backend, /if\(existing\.exists\)return\{created:false/);
  assert.match(backend, /transaction\.update\(accountRef,\{currentBalanceCents/);
  assert.match(ui, /Conta padrão para recebimentos/);
  assert.match(ui, /reconciliationSpaceIds = state\.activeSpaceIds\.filter/);
  assert.match(ui, /result\?\.cached \? 0 : result\?\.created/);
  assert.match(service, /cached: true/);
});

test("carrossel agrupa conta e cartão por instituição e preserva teaser mobile", () => {
  assert.match(ui, /institutionGroups =/);
  assert.match(ui, /institutionKind/);
  assert.match(ui, /financial-institution-carousel/);
  assert.match(ui, /data-financial-institution/);
  assert.match(read("css/financial-home-v2.css"), /scroll-snap-type:x mandatory/);
  assert.match(read("css/financial-home-v2.css"), /flex-basis:calc\(82vw - 12px\)/);
  assert.match(ui, /Instituições consolidadas sem duplicar saldos ou faturas/);
});

test("próximas obrigações incluem faturas, não compras de cartão", () => {
  assert.match(ui, /entityType === "credit_card_invoice"/);
  assert.match(ui, /Fatura de cartão/);
  assert.match(service, /pendingAccounts = payables\.filter\(\(entry\) => entry\.entityType !== "credit_card_invoice"\)/);
  assert.match(service, /invoiceTotalCents/);
  assert.match(service, /pendingAccountsCents/);
});

test("privacidade continua por owner e membership financeira sem consulta global", () => {
  assert.match(service, /where\("ownerUid", "==", currentUid\)/);
  assert.match(service, /where\("linkedBusinessId", "==", currentBusinessId\)/);
  assert.doesNotMatch(service, /onSnapshot/);
  assert.match(rules, /match \/financialAccounts\/\{accountId\}/);
  assert.match(rules, /canReadFinancialSpace\(spaceId\)/);
  assert.match(rules, /investment_account/);
  assert.match(rules, /currentBalanceCents/);
});

test("release inclui o CSS da Home no HTML e no cache offline", () => {
  assert.match(html, /financial-home-v2\.css\?v=129/);
  assert.match(sw, /css\/financial-home-v2\.css/);
});
