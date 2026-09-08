const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadEngine() {
  const context = { window: null, console, Date, Intl, Math, Number, String, Set, Map, Object, Array, structuredClone };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/financial-engine.js", "utf8"), context);
  return context.FinancialEngine;
}

const engine = loadEngine();
const purchaseEntry = (overrides = {}) => engine.normalizeEntry({
  id: "purchase", operationId: "purchase", description: "Mercado", amountCents: 23800,
  direction: "out", status: "paid", occurredAt: "2026-09-08T12:00:00-03:00",
  dueAt: "2026-09-20T12:00:00-03:00", categoryId: "food", categoryName: "Alimentação",
  paymentMethod: "credit_card", cashFlowEffect: false, expenseRecognized: true,
  sourceType: "credit_card_purchase", sourceId: "purchase", ...overrides,
});

test("compra antes e no dia do fechamento entra na fatura atual", () => {
  const before = engine.resolveCreditCardInvoiceForPurchase({ purchaseDate: "2026-09-08T12:00:00-03:00", closingDay: 12, dueDay: 20 });
  const closing = engine.resolveCreditCardInvoiceForPurchase({ purchaseDate: "2026-09-12T12:00:00-03:00", closingDay: 12, dueDay: 20 });
  assert.equal(before.referenceKey, "2026-09");
  assert.equal(closing.referenceKey, "2026-09");
  assert.equal(engine.localIsoDate(before.closingDate), "2026-09-12");
  assert.equal(engine.localIsoDate(before.dueDate), "2026-09-20");
});

test("compra depois do fechamento entra na próxima fatura", () => {
  const invoice = engine.resolveCreditCardInvoiceForPurchase({ purchaseDate: "2026-09-13T12:00:00-03:00", closingDay: 12, dueDay: 20 });
  assert.equal(invoice.referenceKey, "2026-10");
  assert.equal(engine.localIsoDate(invoice.closingDate), "2026-10-12");
  assert.equal(engine.localIsoDate(invoice.dueDate), "2026-10-20");
});

test("fechamento 31 e vencimento 5 usam datas válidas em fevereiro", () => {
  const invoice = engine.resolveCreditCardInvoiceForPurchase({ purchaseDate: "2028-02-20T12:00:00-03:00", closingDay: 31, dueDay: 5 });
  assert.equal(invoice.referenceKey, "2028-02");
  assert.equal(engine.localIsoDate(invoice.closingDate), "2028-02-29");
  assert.equal(engine.localIsoDate(invoice.dueDate), "2028-03-05");
});

test("fechamento 31 e vencimento 30 mantêm vencimento no mês seguinte", () => {
  const invoice = engine.resolveCreditCardInvoiceForPurchase({ purchaseDate: "2028-02-20T12:00:00-03:00", closingDay: 31, dueDay: 30 });
  assert.equal(invoice.referenceKey, "2028-02");
  assert.equal(engine.localIsoDate(invoice.closingDate), "2028-02-29");
  assert.equal(engine.localIsoDate(invoice.dueDate), "2028-03-30");
});

test("parcelamento conserva centavos e coloca uma parcela por fatura", () => {
  const installments = engine.buildCreditCardInstallments({
    operationId: "purchase-100", amountCents: 10000, installmentCount: 3,
    purchaseDate: "2026-09-08T12:00:00-03:00", closingDay: 12, dueDay: 20,
  });
  assert.deepEqual(Array.from(installments, (item) => item.amountCents), [3334, 3333, 3333]);
  assert.deepEqual(Array.from(installments, (item) => item.invoice.referenceKey), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(Array.from(installments, (item) => item.id), ["purchase-100_01", "purchase-100_02", "purchase-100_03"]);
});

test("compra 10x gera dez parcelas e dez faturas consecutivas", () => {
  const installments = engine.buildCreditCardInstallments({
    operationId: "tv-10x", amountCents: 300000, installmentCount: 10,
    purchaseDate: "2026-09-13T12:00:00-03:00", closingDay: 12, dueDay: 20,
  });
  assert.equal(installments.length, 10);
  assert.equal(installments.reduce((sum, item) => sum + item.amountCents, 0), 300000);
  assert.equal(installments[0].invoice.referenceKey, "2026-10");
  assert.equal(installments[9].invoice.referenceKey, "2027-07");
});

test("compra no crédito aumenta gastos sem criar saída de caixa", () => {
  const summary = engine.summarize([purchaseEntry()]);
  assert.equal(summary.expensesTotalCents, 23800);
  assert.equal(summary.totalOutCents, 0);
  assert.equal(summary.categories[0].amountCents, 23800);
});

test("pagamento da fatura cria caixa, mas não duplica gasto", () => {
  const payment = purchaseEntry({
    id: "payment", operationId: "payment", description: "Pagamento fatura", sourceType: "credit_card_invoice_payment",
    amountCents: 23800, paymentMethod: "pix", cashFlowEffect: true, expenseRecognized: false,
  });
  const summary = engine.summarize([purchaseEntry(), payment]);
  assert.equal(summary.expensesTotalCents, 23800);
  assert.equal(summary.totalOutCents, 23800);
  assert.equal(summary.resultCents, -23800);
});

test("pagamento parcial preserva saldo e pagamento total quita", () => {
  const partial = engine.invoiceTotals({ purchasesTotalCents: 100000, adjustmentsTotalCents: 0, paidTotalCents: 60000 });
  assert.equal(partial.remainingCents, 40000);
  assert.notEqual(engine.deriveCreditCardInvoiceStatus({ ...partial, closingDate: "2026-09-12T12:00:00-03:00", dueDate: "2026-09-20T12:00:00-03:00" }, "2026-09-15T12:00:00-03:00"), "paid");
  const paid = engine.invoiceTotals({ purchasesTotalCents: 100000, adjustmentsTotalCents: 0, paidTotalCents: 100000 });
  assert.equal(paid.remainingCents, 0);
  assert.equal(engine.deriveCreditCardInvoiceStatus({ ...paid, closingDate: "2026-09-12T12:00:00-03:00", dueDate: "2026-09-20T12:00:00-03:00" }), "paid");
});

test("fatura não paga após vencimento fica vencida", () => {
  const invoice = { purchasesTotalCents: 5000, adjustmentsTotalCents: 0, paidTotalCents: 0, closingDate: "2026-09-12T12:00:00-03:00", dueDate: "2026-09-20T12:00:00-03:00" };
  assert.equal(engine.deriveCreditCardInvoiceStatus(invoice, "2026-09-10T12:00:00-03:00"), "open");
  assert.equal(engine.deriveCreditCardInvoiceStatus(invoice, "2026-09-21T12:00:00-03:00"), "overdue");
});

test("limite comprometido considera somente saldo ainda devido", () => {
  const invoices = [
    { purchasesTotalCents: 50000, adjustmentsTotalCents: 0, paidTotalCents: 10000, closingDate: "2026-09-01", dueDate: "2027-09-20" },
    { purchasesTotalCents: 30000, adjustmentsTotalCents: -5000, paidTotalCents: 0, closingDate: "2026-10-01", dueDate: "2027-10-20" },
  ];
  assert.equal(engine.creditCardCommitment(invoices), 65000);
  assert.equal(engine.creditCardAvailableLimit(100000, invoices), 35000);
});

test("estorno reduz gasto por categoria sem criar entrada de caixa", () => {
  const refund = purchaseEntry({
    id: "refund", operationId: "refund", direction: "in", amountCents: 3800,
    cashFlowEffect: false, expenseRecognized: false, expenseAdjustmentCents: -3800,
    sourceType: "credit_card_refund",
  });
  const summary = engine.summarize([purchaseEntry(), refund]);
  assert.equal(summary.expensesTotalCents, 20000);
  assert.equal(summary.totalInCents, 0);
  assert.equal(summary.totalOutCents, 0);
  assert.equal(summary.categories[0].amountCents, 20000);
});

test("frontend, persistência e rules publicam o domínio V2 sem listener global", () => {
  const service = fs.readFileSync("js/firebase/financial-space-service.js", "utf8"),
    ui = fs.readFileSync("js/financial-ui.js", "utf8"), rules = fs.readFileSync("firestore.rules", "utf8");
  for (const token of ["financialAccounts", "creditCards", "creditCardInvoices", "creditCardPurchases", "creditCardInvoicePayments", "creditCardAdjustments"])
    assert.match(service, new RegExp(token));
  assert.match(service, /cashFlowEffect:\s*false/);
  assert.match(service, /expenseRecognized:\s*false/);
  assert.match(ui, /Como você .*pagou ou vai pagar/);
  assert.match(ui, /data-financial-new-card/);
  assert.match(ui, /operationId:\s*draft\.operationId/);
  assert.match(ui, /Somente leitura/);
  assert.match(ui, /option value="transfer"/);
  assert.match(service, /credit_refund_\$\{String\(purchaseId\)/);
  assert.match(rules, /match \/creditCards\/\{cardId\}/);
  assert.doesNotMatch(service, /onSnapshot\s*\(/);
});
