const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  initializeTestEnvironment,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  runTransaction,
  setDoc,
} = require("firebase/firestore");

let env;
const projectId = "adi-festa-variations-test";
const businessId = "financial-concurrency";
const ownerId = "financial-owner";
const financeContext = { console, Number, Math, Date, Map, Object, String };
financeContext.window = financeContext;
vm.createContext(financeContext);
vm.runInContext(
  fs.readFileSync(
    path.join(__dirname, "../../js/financial-concurrency.js"),
    "utf8",
  ),
  financeContext,
);
const finance = financeContext.FinancialConcurrency;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "businesses", businessId), {
      id: businessId,
      ownerId,
      active: true,
      subscription: { planId: "internal", status: "active" },
    });
    await setDoc(doc(db, "users", ownerId), {
      uid: ownerId,
      businessId,
      role: "owner",
      active: true,
    });
  });
});

test.after(async () => env?.cleanup());

async function seedClient(id, saldo, financialVersion) {
  await env.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), "businesses", businessId, "clients", id), {
      id,
      businessId,
      ownerId,
      nome: id,
      saldo,
      financialVersion,
      version: 1,
      updatedAt: "2026-08-18T12:00:00.000Z",
    }),
  );
}

async function applyPayment(db, input) {
  const clientRef = doc(db, "businesses", businessId, "clients", input.clientId);
  const paymentRef = doc(db, "businesses", businessId, "payments", input.id);
  const markerRef = doc(db, "businesses", businessId, "processedOperations", input.id);
  return runTransaction(db, async (transaction) => {
    const marker = await transaction.get(markerRef);
    if (marker.exists()) return { status: "idempotent" };
    const clientSnapshot = await transaction.get(clientRef);
    const client = clientSnapshot.data();
    const evaluation = finance.evaluatePaymentConcurrency({
      expectedBalance: input.expectedBalance,
      currentBalance: client.saldo,
      requestedAmount: input.amount,
      paymentMode: input.paymentMode || "partial",
      expectedFinancialVersion: input.expectedVersion,
      currentFinancialVersion: client.financialVersion,
    });
    if (evaluation.decision === "conflict" && !input.confirmed) {
      transaction.set(paymentRef, {
        id: input.id,
        operationId: input.id,
        businessId,
        ownerId,
        clientId: input.clientId,
        clienteId: input.clientId,
        valor: input.amount,
        expectedBalance: input.expectedBalance,
        expectedFinancialVersion: input.expectedVersion,
        conflictActualBalance: client.saldo,
        conflictActualFinancialVersion: client.financialVersion,
        conflictReason: evaluation.reason,
        conflictResultingBalance: evaluation.resultingBalance,
        conflictCreditCreated: evaluation.creditCreated,
        status: "conflict",
        applicationStatus: "not_applied",
        allocations: [],
        campaignConfirmations: [],
        schemaVersion: 3,
      });
      return { status: "conflict", balance: client.saldo };
    }
    const effectiveAmount = input.confirmed
      ? input.amount
      : evaluation.effectiveAmount;
    const nextBalance = Number(
      (Number(client.saldo) + effectiveAmount).toFixed(2),
    );
    transaction.set(clientRef, {
      saldo: nextBalance,
      financialVersion: Number(client.financialVersion || 0) + 1,
      businessId,
      updatedAt: "2026-08-18T12:01:00.000Z",
    }, { merge: true });
    transaction.set(paymentRef, {
      id: input.id,
      operationId: input.id,
      businessId,
      ownerId,
      clientId: input.clientId,
      clienteId: input.clientId,
      valor: effectiveAmount,
      requestedAmount: input.amount,
      effectiveAmount,
      paymentMode: input.paymentMode || "partial",
      concurrencyDecision: input.confirmed
        ? "confirmed_override"
        : evaluation.decision,
      concurrencyReason: input.confirmed
        ? "MERCHANT_CONFIRMED_SECOND_REAL_PAYMENT"
        : evaluation.reason,
      expectedBalance: input.expectedBalance,
      expectedFinancialVersion: input.expectedVersion,
      status: "applied",
      applicationStatus: "applied",
      schemaVersion: 3,
    });
    transaction.set(markerRef, {
      id: input.id,
      idempotencyKey: input.id,
      businessId,
      ownerId,
      status: "processed",
      eventKind: "payment",
      processedAt: "2026-08-18T12:01:00.000Z",
      createdAtLocal: "2026-08-18T12:00:00.000Z",
      schemaVersion: 3,
    });
    return {
      status:
        evaluation.decision === "apply_adjusted"
          ? "applied_adjusted"
          : "applied",
      balance: nextBalance,
      effectiveAmount,
      reason: evaluation.reason,
    };
  });
}

test("Gustavo aplica pagamento seguro mesmo com financialVersion divergente", async () => {
  const clientId = "gustavo-same-balance-new-version";
  await seedClient(clientId, -413.5, 22);
  const db = env.authenticatedContext(ownerId).firestore();
  const result = await assertSucceeds(applyPayment(db, {
    id: "gustavo-payment-4",
    clientId,
    amount: 4,
    expectedBalance: -413.5,
    expectedVersion: 21,
    paymentMode: "partial",
  }));
  assert.equal(result.status, "applied");
  assert.equal(result.balance, -409.5);
  assert.equal(result.reason, "SAME_BALANCE_NEW_VERSION");
});

test("mudanças financeiras concorrentes seguras são aplicadas no saldo atual", async () => {
  const db = env.authenticatedContext(ownerId).firestore();
  for (const scenario of [
    { id: "new-sale", current: -130, amount: 20, result: -110 },
    { id: "safe-other-payment", current: -20, amount: 10, result: -10 },
  ]) {
    await seedClient(scenario.id, scenario.current, 11);
    const outcome = await assertSucceeds(applyPayment(db, {
      id: `payment-${scenario.id}`,
      clientId: scenario.id,
      amount: scenario.amount,
      expectedBalance: -100,
      expectedVersion: 10,
      paymentMode: "partial",
    }));
    assert.equal(outcome.status, "applied");
    assert.equal(outcome.balance, scenario.result);
    assert.equal(outcome.reason, "BALANCE_CHANGED_SAFE");
  }
});

test("pagamento parcial inseguro conflita e quitação usa a dívida atual", async () => {
  const db = env.authenticatedContext(ownerId).firestore();
  await seedClient("unsafe-partial", -40, 21);
  const conflict = await assertSucceeds(applyPayment(db, {
    id: "unsafe-partial-payment",
    clientId: "unsafe-partial",
    amount: 100,
    expectedBalance: -100,
    expectedVersion: 20,
    paymentMode: "partial",
  }));
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.balance, -40);

  await seedClient("adjusted-total", -40, 21);
  const adjusted = await assertSucceeds(applyPayment(db, {
    id: "adjusted-total-payment",
    clientId: "adjusted-total",
    amount: 100,
    expectedBalance: -100,
    expectedVersion: 20,
    paymentMode: "total",
  }));
  assert.equal(adjusted.status, "applied_adjusted");
  assert.equal(adjusted.effectiveAmount, 40);
  assert.equal(adjusted.balance, 0);
});

test("segundo pagamento com projeção velha vira conflito e não confirma campanha", async () => {
  const clientId = "same-debt-two-devices";
  await seedClient(clientId, -82.5, 10);
  const db = env.authenticatedContext(ownerId).firestore();
  const first = await assertSucceeds(applyPayment(db, {
    id: "payment-device-a",
    clientId,
    amount: 82.5,
    expectedBalance: -82.5,
    expectedVersion: 10,
  }));
  const second = await assertSucceeds(applyPayment(db, {
    id: "payment-device-b",
    clientId,
    amount: 82.5,
    expectedBalance: -82.5,
    expectedVersion: 10,
  }));

  assert.equal(first.status, "applied");
  assert.equal(second.status, "conflict");
  const client = (await getDoc(doc(db, "businesses", businessId, "clients", clientId))).data();
  const conflict = (await getDoc(doc(db, "businesses", businessId, "payments", "payment-device-b"))).data();
  assert.equal(client.saldo, 0);
  assert.equal(client.financialVersion, 11);
  assert.equal(conflict.applicationStatus, "not_applied");
  assert.deepEqual(conflict.allocations, []);
  assert.deepEqual(conflict.campaignConfirmations, []);
});

test("lojista pode confirmar um segundo pagamento real contra o estado atual", async () => {
  const clientId = "confirmed-second-payment";
  await seedClient(clientId, 0, 11);
  const db = env.authenticatedContext(ownerId).firestore();
  const result = await assertSucceeds(applyPayment(db, {
    id: "confirmed-payment",
    clientId,
    amount: 82.5,
    expectedBalance: 0,
    expectedVersion: 11,
    confirmed: true,
  }));
  assert.equal(result.balance, 82.5);
});

test("reversão auditável é aplicada uma vez e o retry é idempotente", async () => {
  const clientId = "kaike-fixture",
    duplicateId = "kaike-duplicate",
    operationId = `duplicate-payment-reversal:${duplicateId}`;
  await seedClient(clientId, 72.5, 30);
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "businesses", businessId, "payments", duplicateId), {
      id: duplicateId,
      operationId: duplicateId,
      businessId,
      ownerId,
      clientId,
      clienteId: clientId,
      valor: 82.5,
      status: "applied",
      applicationStatus: "applied",
      schemaVersion: 3,
    });
  });
  const db = env.authenticatedContext(ownerId).firestore();
  const reverse = () => runTransaction(db, async (transaction) => {
    const markerRef = doc(db, "businesses", businessId, "processedOperations", operationId);
    const marker = await transaction.get(markerRef);
    if (marker.exists()) return "idempotent";
    const clientRef = doc(db, "businesses", businessId, "clients", clientId);
    const paymentRef = doc(db, "businesses", businessId, "payments", duplicateId);
    const clientSnapshot = await transaction.get(clientRef);
    const paymentSnapshot = await transaction.get(paymentRef);
    assert.equal(clientSnapshot.data().saldo, 72.5);
    assert.equal(paymentSnapshot.data().status, "applied");
    transaction.set(clientRef, {
      businessId,
      saldo: -10,
      financialVersion: 31,
      updatedAt: "2026-08-18T12:02:00.000Z",
    }, { merge: true });
    transaction.set(paymentRef, {
      businessId,
      status: "reversed",
      applicationStatus: "reversed",
      duplicateOf: "kaike-legitimate",
      reversedByOperationId: operationId,
    }, { merge: true });
    transaction.set(doc(db, "businesses", businessId, "balanceAdjustments", operationId), {
      id: operationId,
      operationId,
      businessId,
      ownerId,
      clientId,
      clienteId: clientId,
      tipo: "ajuste_saldo",
      subtipo: "pagamento_duplicado_revertido",
      valor: -82.5,
      saldoAnterior: 72.5,
      saldoNovo: -10,
      schemaVersion: 3,
    });
    transaction.set(markerRef, {
      id: operationId,
      idempotencyKey: operationId,
      businessId,
      ownerId,
      status: "processed",
      eventKind: "duplicate_payment_reversal",
      processedAt: "2026-08-18T12:02:00.000Z",
      createdAtLocal: "2026-08-18T12:02:00.000Z",
      schemaVersion: 3,
    });
    return "applied";
  });

  assert.equal(await assertSucceeds(reverse()), "applied");
  assert.equal(await assertSucceeds(reverse()), "idempotent");
  const client = (await getDoc(doc(db, "businesses", businessId, "clients", clientId))).data();
  assert.equal(client.saldo, -10);
  assert.equal(client.financialVersion, 31);
});
