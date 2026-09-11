const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(file, "utf8");
const ui = read("js/financial-ui.js"), service = read("js/firebase/financial-space-service.js"), rules = read("firestore.rules"), css = read("css/financial-refinement.css"), html = read("index.html");

function loadEngine() {
  const context = { window: null, console, Date, Intl, Math, Number, String, Set, Map, Object, Array, structuredClone };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read("js/financial-engine.js"), context);
  return context.FinancialEngine;
}

test("ciclo da fatura é identificado pela referência e não pelo mês do vencimento", () => {
  const cycle = loadEngine().creditCardInvoiceCycle({ referenceKey: "2026-09", closingDay: 7, dueDay: 13 });
  assert.equal(cycle.referenceKey, "2026-09");
  assert.match(cycle.closingDate, /^2026-09-07T/);
  assert.match(cycle.dueDate, /^2026-09-13T/);
  const followingDue = loadEngine().creditCardInvoiceCycle({ referenceKey: "2026-09", closingDay: 20, dueDay: 13 });
  assert.match(followingDue.dueDate, /^2026-10-13T/);
});

test("visões salvas são filtros pessoais com padrão, última visão e favoritos", () => {
  assert.match(service, /financialViewProfiles/);
  assert.match(service, /customViews/);
  assert.match(service, /favoriteViewIds/);
  assert.match(service, /defaultViewId/);
  assert.match(service, /lastViewId/);
  assert.match(service, /filter\(\(id\) => allowed\.has\(id\)\)/);
  assert.match(ui, /state\.viewProfile\.defaultViewId \|\| state\.viewProfile\.lastViewId/);
  assert.match(service, /Todos os espaços/);
  assert.match(service, /Pessoal/);
  assert.match(service, /Empresas/);
  assert.match(rules, /match \/financialViewProfiles\/\{profileUid\}/);
  assert.match(rules, /request\.auth\.uid == profileUid/);
});

test("ações ambíguas saem do topo e ficam vinculadas ao cartão", () => {
  const cardsMarkup = ui.slice(ui.indexOf("const creditCardMarkup"), ui.indexOf("function dashboardMarkup"));
  assert.doesNotMatch(cardsMarkup, /data-financial-adjust-any-invoice/);
  assert.doesNotMatch(cardsMarkup, /data-financial-pay-any-invoice/);
  assert.match(cardsMarkup, /data-financial-card-action="invoice"/);
  assert.match(cardsMarkup, /data-financial-card-action="adjust"/);
  assert.match(cardsMarkup, /data-financial-card-action="limit"/);
  assert.match(cardsMarkup, /data-financial-edit-card/);
  assert.match(service, /invoiceId = `\$\{card\.id\}_\$\{cycle\.referenceKey\}`/);
});

test("card exibe o total real da fatura e o valor do espaço apenas como contexto", () => {
  assert.match(ui, /invoiceTotal = invoice\?\.amountDueCents/);
  assert.match(ui, /neste espaço:/);
  assert.match(ui, /currentSpaceAmount/);
});

test("fatura oferece ciclo, categorias, espaços, compra, ajuste e pagamento", () => {
  for (const expression of [/financial-invoice-cycle/, /Gastos por categoria/, /Gastos por espaço/, /Detalhe da compra/, /Ajustar esta fatura/, /Registrar pagamento/, /data-financial-adjust-invoice/, /data-financial-pay-invoice/, /Pagamento parcial registrado/, /Parcelamento em andamento/]) assert.match(ui, expression);
  assert.match(ui, /interactionSpaceId/);
  assert.match(service, /categoryBreakdown/);
  assert.match(service, /spaceBreakdown/);
});

test("contas preservam os filtros operacionais, recorrências e faturas", () => {
  for (const expression of [/data-financial-account-filter="pending"/, /data-financial-account-filter="recurring"/, /data-financial-account-filter="invoices"/, /data-financial-account-filter="overdue"/, /data-financial-account-filter="paid"/]) assert.match(ui, expression);
  assert.match(ui, /entry\.entityType === "credit_card_invoice"/);
  assert.match(ui, /Boolean\(entry\.recurrenceId\)/);
});

test("camada visual final corrige definitivamente card navy sobre navy", () => {
  assert.ok(html.indexOf("veconi-theme.css") < html.indexOf("financial-refinement.css"));
  assert.match(css, /\.financial-page \.financial-credit-card\{[^}]*background:#fff!important/);
  assert.match(css, /\.financial-card-context-actions/);
  assert.match(css, /\.financial-invoice-sheet/);
  assert.match(css, /@media\(max-width:360px\)/);
  assert.match(css, /financial-modal-open\{overflow:hidden\}/);
  assert.match(css, /financial-invoice-tabs\[hidden\]\{display:none!important\}/);
});

test("carregamento de cartões separa referência da fatura e vencimento de contas", () => {
  assert.match(service, /selectedInvoices = invoices\.filter\(\(invoice\) => invoice\.referenceKey === selectedPeriod\)/);
  assert.match(service, /duePeriodInvoices = invoices\.filter\(\(invoice\) => Engine\.periodKey\(invoice\.dueDate\) === selectedPeriod\)/);
  assert.match(service, /invoicePayables = duePeriodInvoices\.filter/);
});
