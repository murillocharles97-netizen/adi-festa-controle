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

test("dois dispositivos partindo da mesma dívida aplicam apenas o primeiro pagamento", () => {
  const finance = concurrency(),
    viewed = { saldo: -82.5, financialVersion: 10 },
    expectedA = finance.context(viewed),
    expectedB = finance.context(viewed),
    afterA = { saldo: 0, financialVersion: finance.nextVersion(viewed) };

  assert.equal(finance.compare(expectedA, viewed).ok, true);
  assert.deepEqual(structuredClone(finance.compare(expectedB, afterA)), {
    ok: false,
    balanceChanged: true,
    versionChanged: true,
    expectedBalance: -82.5,
    actualBalance: 0,
    expectedFinancialVersion: 10,
    actualFinancialVersion: 11,
  });
});

test("pagamentos parciais concorrentes preservam o saldo confirmado pelo servidor", () => {
  const finance = concurrency(),
    expectedB = finance.context({ saldo: -100, financialVersion: 20 }),
    afterPartialA = { saldo: -40, financialVersion: 21 },
    conflict = finance.compare(expectedB, afterPartialA);

  assert.equal(conflict.ok, false);
  assert.equal(conflict.actualBalance, -40);
  assert.equal(conflict.actualFinancialVersion, 21);
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
  const finance = concurrency(),
    offlineProjection = finance.context({ saldo: -30, financialVersion: 4 }),
    serverAtReconnect = { saldo: 0, financialVersion: 5 };
  assert.equal(finance.compare(offlineProjection, serverAtReconnect).ok, false);
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

test("sync valida saldo e versão antes de campanhas e preserva resolução auditável", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../js/firebase/sync.js"),
    "utf8",
  );
  const staleCheck = source.indexOf("if (staleBalance || staleVersion)");
  const campaignWrite = source.indexOf('if (eventKind === "campaign_redemption"');
  assert.ok(staleCheck > 0 && staleCheck < campaignWrite);
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
});
