const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function concurrency() {
  const context = { console, Number, Math, Date, Map, Object, String };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../js/financial-concurrency.js"),
      "utf8",
    ),
    context,
  );
  return context.FinancialConcurrency;
}

test("Gustavo: versão divergente com o mesmo saldo aplica R$ 4 sem falso conflito", () => {
  const result = concurrency().evaluatePaymentConcurrency({
    expectedBalance: -413.5,
    currentBalance: -413.5,
    requestedAmount: 4,
    paymentMode: "partial",
    expectedFinancialVersion: 21,
    currentFinancialVersion: 22,
  });
  assert.equal(result.decision, "apply");
  assert.equal(result.reason, "SAME_BALANCE_NEW_VERSION");
  assert.equal(result.effectiveAmount, 4);
  assert.equal(result.resultingBalance, -409.5);
  assert.equal(result.creditCreated, 0);
});

test("pagamento parcial aplica sobre o saldo atual quando continua seguro", () => {
  const finance = concurrency();
  for (const scenario of [
    { currentBalance: -420, expected: -416 },
    { currentBalance: -400, expected: -396 },
    { currentBalance: -150, requestedAmount: 100, expected: -50 },
    { currentBalance: -20, requestedAmount: 10, expected: -10 },
  ]) {
    const result = finance.evaluatePaymentConcurrency({
      expectedBalance: -413.5,
      currentBalance: scenario.currentBalance,
      requestedAmount: scenario.requestedAmount ?? 4,
      paymentMode: "partial",
      expectedFinancialVersion: 10,
      currentFinancialVersion: 11,
    });
    assert.equal(result.decision, "apply");
    assert.equal(result.reason, "BALANCE_CHANGED_SAFE");
    assert.equal(result.resultingBalance, scenario.expected);
  }
});

test("pagamento parcial que ultrapassa a dívida atual continua bloqueado", () => {
  const result = concurrency().evaluatePaymentConcurrency({
    expectedBalance: -100,
    currentBalance: -40,
    requestedAmount: 100,
    paymentMode: "partial",
    expectedFinancialVersion: 20,
    currentFinancialVersion: 21,
  });
  assert.equal(result.decision, "conflict");
  assert.equal(result.reason, "PAYMENT_EXCEEDS_CURRENT_DEBT");
  assert.equal(result.resultingBalance, 60);
  assert.equal(result.creditCreated, 60);
});

test("pagamento total usa a dívida atual e não perde centavos", () => {
  const result = concurrency().evaluatePaymentConcurrency({
    expectedBalance: -100,
    currentBalance: -40,
    requestedAmount: 100,
    paymentMode: "total",
    expectedFinancialVersion: 20,
    currentFinancialVersion: 21,
  });
  assert.equal(result.decision, "apply_adjusted");
  assert.equal(result.reason, "TOTAL_UPDATED_TO_CURRENT_DEBT");
  assert.equal(result.effectiveAmount, 40);
  assert.equal(result.resultingBalance, 0);
});

test("Kaike: pagamento antigo contra saldo quitado continua bloqueado", () => {
  const result = concurrency().evaluatePaymentConcurrency({
    expectedBalance: -82.5,
    currentBalance: 0,
    requestedAmount: 82.5,
    paymentMode: "partial",
    expectedFinancialVersion: 10,
    currentFinancialVersion: 11,
  });
  assert.equal(result.decision, "conflict");
  assert.equal(result.reason, "BALANCE_ALREADY_SETTLED");
  assert.equal(result.creditCreated, 82.5);
});

test("cliente que agora tem crédito nunca recebe pagamento antigo automaticamente", () => {
  const result = concurrency().evaluatePaymentConcurrency({
    expectedBalance: -82.5,
    currentBalance: 10,
    requestedAmount: 82.5,
    paymentMode: "partial",
    expectedFinancialVersion: 10,
    currentFinancialVersion: 12,
  });
  assert.equal(result.decision, "conflict");
  assert.equal(result.reason, "CLIENT_HAS_CREDIT");
});

test("mudança apenas de nome ou telefone é revalidada sem bloquear dinheiro", () => {
  const result = concurrency().evaluatePaymentConcurrency({
    expectedBalance: -100,
    currentBalance: -100,
    requestedAmount: 10,
    paymentMode: "partial",
    expectedFinancialVersion: 10,
    currentFinancialVersion: 11,
  });
  assert.equal(result.decision, "apply");
  assert.equal(result.reason, "SAME_BALANCE_NEW_VERSION");
  assert.equal(result.resultingBalance, -90);
});

test("dinheiro é comparado em centavos, sem conflito por ruído de float", () => {
  const result = concurrency().evaluatePaymentConcurrency({
    expectedBalance: -413.5,
    currentBalance: -413.50000000001,
    requestedAmount: 0.1 + 0.2,
    paymentMode: "partial",
    expectedFinancialVersion: 1,
    currentFinancialVersion: 2,
  });
  assert.equal(result.balanceChanged, false);
  assert.equal(result.requestedAmountCents, 30);
  assert.equal(result.resultingBalanceCents, -41320);
  assert.equal(result.decision, "apply");
});

test("confirmação explícita usa o estado atual e pode gerar crédito real", () => {
  const finance = concurrency(),
    current = { saldo: 0, financialVersion: 11 },
    confirmedContext = finance.context(current);

  assert.equal(finance.compare(confirmedContext, current).ok, true);
  assert.equal(finance.roundedMoney(current.saldo + 82.5), 82.5);
});

test("cancelar conflito não tem efeito financeiro e venda permanece aditiva", () => {
  const finance = concurrency();
  assert.equal(finance.classification("payment_received"), "state_dependent");
  assert.equal(finance.classification("sale"), "independent_additive");
  assert.equal(finance.applyDelta(-40, 0, -10), -50);
  assert.equal(finance.applyDelta(-40, 0, 0), -40);
});

test("operação offline obsoleta também conflita quando reconecta", () => {
  const finance = concurrency();
  assert.equal(finance.evaluatePaymentConcurrency({
    expectedBalance: -30,
    currentBalance: 0,
    requestedAmount: 30,
    paymentMode: "partial",
    expectedFinancialVersion: 4,
    currentFinancialVersion: 5,
  }).decision, "conflict");
  assert.equal(finance.evaluatePaymentConcurrency({
    expectedBalance: -30,
    currentBalance: -50,
    requestedAmount: 10,
    paymentMode: "partial",
    expectedFinancialVersion: 4,
    currentFinancialVersion: 5,
  }).decision, "apply");
});

test("prévia de reversão é determinística e detector respeita empresa", () => {
  const finance = concurrency();
  assert.deepEqual(structuredClone(finance.reversalPreview(72.5, 82.5)), {
    balanceBefore: 72.5,
    amount: 82.5,
    balanceAfter: -10,
  });
  const at = "2026-08-17T10:00:00.000Z",
    payments = [
      { id: "a", businessId: "one", clientId: "same", valor: 82.5, saldoAnterior: -82.5, saldoNovo: 0, data: at },
      { id: "b", businessId: "two", clientId: "same", valor: 82.5, saldoAnterior: -82.5, saldoNovo: 0, data: "2026-08-17T11:00:00.000Z" },
    ];
  assert.equal(finance.suspiciousPayments(payments, [], []).length, 0);
});

test("detector classifica o padrão Kaike como suspeita alta", () => {
  const finance = concurrency(),
    payments = [
      { id: "legitimate", businessId: "adi-festa", clientId: "kaike", clienteNome: "Kaike Kings", valor: 82.5, saldoAnterior: -82.5, saldoNovo: 0, data: "2026-08-17T10:00:00.000Z" },
      { id: "duplicate", businessId: "adi-festa", clientId: "kaike", clienteNome: "Kaike Kings", valor: 82.5, saldoAnterior: -82.5, saldoNovo: 0, data: "2026-08-17T10:05:00.000Z" },
    ],
    effects = [
      { type: "payment_received", sourceDocumentId: "legitimate", sourceDeviceId: "device-a", status: "applied" },
      { type: "payment_received", sourceDocumentId: "duplicate", sourceDeviceId: "device-b", status: "applied" },
    ],
    suspects = finance.suspiciousPayments(payments, effects, [{ id: "kaike", nome: "Kaike Kings", saldo: 72.5 }]);

  assert.equal(suspects.length, 1);
  assert.equal(suspects[0].degree, "high");
  assert.equal(suspects[0].score, 100);
});

test("sync revalida o efeito antes de campanhas e preserva resolução auditável", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../js/firebase/sync.js"),
    "utf8",
  );
  const evaluator = source.indexOf("evaluatePaymentConcurrency({");
  const campaignWrite = source.indexOf('if (eventKind === "campaign_redemption"');
  assert.ok(evaluator > 0 && evaluator < campaignWrite);
  assert.doesNotMatch(source, /if \(staleBalance \|\| staleVersion\)/);
  assert.match(source, /\[PAYMENT_CONCURRENCY_CHECK\]/);
  assert.match(source, /financial_payment_adjustment_required/);
  assert.match(source, /financial-payment-adjusted/);
  assert.match(source, /applicationStatus:\s*"not_applied"/);
  assert.match(source, /allocations:\s*\[\]/);
  assert.match(source, /duplicate-payment-reversal:/);
  assert.match(source, /status:\s*"reversed"/);
  assert.match(source, /payment_reversal/);
  assert.match(source, /processedOperations/);
});

test("modal explica o conflito e oferece somente cancelar ou confirmar", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../js/fiados.js"),
    "utf8",
  );
  assert.match(source, /O saldo mudou em outro dispositivo/);
  assert.match(source, /Saldo que você visualizou/);
  assert.match(source, /Saldo atual/);
  assert.match(source, /Crédito que seria criado/);
  assert.match(source, /Cancelar operação/);
  assert.match(source, /Registrar mesmo assim/);
  assert.match(source, /Confirme o novo valor da quitação/);
  assert.match(source, /Confirmar \$\{money\(effectiveAmount\)\}/);
  assert.match(source, /financial-payment-adjustment-required/);
});
