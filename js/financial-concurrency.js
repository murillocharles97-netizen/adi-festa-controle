(function (root) {
  "use strict";

  const roundedMoney = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
  };
  const sameMoney = (left, right) =>
    Math.abs(roundedMoney(left) - roundedMoney(right)) < 0.005;
  const nearMoney = (left, right, tolerance = 0.05) =>
    Math.abs(roundedMoney(left) - roundedMoney(right)) <= Number(tolerance);
  const financialVersion = (client) =>
    Math.max(0, Number(client?.financialVersion || 0));
  const context = (client) => ({
    expectedBalance: roundedMoney(client?.saldo || 0),
    expectedFinancialVersion: financialVersion(client),
  });
  const nextVersion = (client) => financialVersion(client) + 1;
  const applyDelta = (remoteBalance, localBefore, localAfter) =>
    roundedMoney(
      Number(remoteBalance || 0) +
        (Number(localAfter || 0) - Number(localBefore || 0)),
    );
  const compare = (expected = {}, actual = {}) => {
    const expectedBalance = roundedMoney(expected.expectedBalance),
      actualBalance = roundedMoney(actual.saldo),
      expectedVersion = Math.max(
        0,
        Number(expected.expectedFinancialVersion || 0),
      ),
      actualVersion = financialVersion(actual),
      balanceChanged = !sameMoney(expectedBalance, actualBalance),
      versionChanged = expectedVersion !== actualVersion;
    return {
      ok: !balanceChanged && !versionChanged,
      balanceChanged,
      versionChanged,
      expectedBalance,
      actualBalance,
      expectedFinancialVersion: expectedVersion,
      actualFinancialVersion: actualVersion,
    };
  };
  const classification = (type) =>
    ["payment", "payment_received", "settle_balance", "receive_open_balance"].includes(
      String(type || ""),
    )
      ? "state_dependent"
      : "independent_additive";
  const reversalPreview = (balance, amount) => ({
    balanceBefore: roundedMoney(balance),
    amount: roundedMoney(amount),
    balanceAfter: roundedMoney(Number(balance || 0) - Number(amount || 0)),
  });
  const paymentDate = (payment) =>
    new Date(
      payment?.data || payment?.createdAt || payment?.criadoEm || 0,
    ).getTime();
  const effectByPayment = (effects = []) =>
    new Map(
      effects
        .filter((effect) => effect?.type === "payment_received")
        .map((effect) => [String(effect.sourceDocumentId || ""), effect]),
    );
  function suspiciousPayments(payments = [], effects = [], clients = [], options = {}) {
    const hours = Math.max(1, Number(options.hours || 48)),
      windowMs = hours * 3600000,
      effectsById = effectByPayment(effects),
      clientsById = new Map(
        clients.map((client) => [String(client.id || ""), client]),
      ),
      ordered = payments
        .filter((payment) => payment?.id && paymentDate(payment))
        .sort((left, right) => paymentDate(left) - paymentDate(right)),
      pairs = [];
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex++) {
      const left = ordered[leftIndex],
        leftClientId = String(left.clienteId || left.clientId || ""),
        leftEffect = effectsById.get(String(left.id)) || {};
      if (!leftClientId) continue;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < ordered.length;
        rightIndex++
      ) {
        const right = ordered[rightIndex],
          intervalMs = paymentDate(right) - paymentDate(left);
        if (intervalMs > windowMs) break;
        const rightClientId = String(right.clienteId || right.clientId || "");
        if (leftClientId !== rightClientId) continue;
        if (
          left.businessId &&
          right.businessId &&
          String(left.businessId) !== String(right.businessId)
        )
          continue;
        if (!nearMoney(left.valor ?? left.amount, right.valor ?? right.amount))
          continue;
        const rightEffect = effectsById.get(String(right.id)) || {},
          sameBefore = sameMoney(left.saldoAnterior, right.saldoAnterior),
          sameAfter = sameMoney(left.saldoNovo, right.saldoNovo),
          negativeProjection =
            roundedMoney(left.expectedBalance ?? left.saldoAnterior) < 0 &&
            roundedMoney(right.expectedBalance ?? right.saldoAnterior) < 0,
          leftDevice = String(
            leftEffect.sourceDeviceId ||
              left.sourceDeviceId ||
              left.deviceId ||
              "",
          ),
          rightDevice = String(
            rightEffect.sourceDeviceId ||
              right.sourceDeviceId ||
              right.deviceId ||
              "",
          ),
          differentDevices = Boolean(
            leftDevice && rightDevice && leftDevice !== rightDevice,
          ),
          bothApplied = [leftEffect, rightEffect].every(
            (effect) => effect.status === "applied",
          ),
          resolved =
            [left, right].some((payment) =>
              ["reversed", "cancelled"].includes(String(payment.status || "")),
            ) ||
            [leftEffect, rightEffect].some(
              (effect) => effect.status === "reversed",
            ),
          score =
            35 +
            (sameBefore ? 20 : 0) +
            (sameAfter ? 10 : 0) +
            (differentDevices ? 15 : 0) +
            (bothApplied ? 10 : 0) +
            (negativeProjection ? 10 : 0),
          client = clientsById.get(leftClientId) || {};
        if (!negativeProjection || score < 65) continue;
        pairs.push({
          client: client.nome || left.clienteNome || right.clienteNome || "",
          clientId: leftClientId,
          paymentA: String(left.id),
          paymentB: String(right.id),
          operationA: String(left.operationId || "") || null,
          operationB: String(right.operationId || "") || null,
          idempotencyKeyA: String(left.idempotencyKey || "") || null,
          idempotencyKeyB: String(right.idempotencyKey || "") || null,
          amount: roundedMoney(left.valor ?? left.amount),
          paymentAAt: new Date(paymentDate(left)).toISOString(),
          paymentBAt: new Date(paymentDate(right)).toISOString(),
          intervalHours: Number((intervalMs / 3600000).toFixed(2)),
          deviceA: leftDevice || null,
          deviceB: rightDevice || null,
          expectedBalance: roundedMoney(
            right.expectedBalance ?? right.saldoAnterior,
          ),
          currentBalance: roundedMoney(client.saldo || 0),
          samePreviousBalance: sameBefore,
          sameResultBalance: sameAfter,
          bothEffectsApplied: bothApplied,
          resolved,
          degree: score >= 90 ? "high" : score >= 75 ? "medium" : "low",
          score,
          reason: [
            `mesmo cliente e valor em até ${hours} horas`,
            negativeProjection ? "ambos partiram de saldo negativo" : null,
            sameBefore ? "mesmo saldo anterior" : null,
            sameAfter ? "mesmo saldo resultante" : null,
            differentDevices ? "dispositivos diferentes" : null,
            bothApplied ? "ambos os efeitos foram aplicados" : null,
          ]
            .filter(Boolean)
            .join("; "),
        });
      }
    }
    return pairs.sort((left, right) => right.score - left.score);
  }

  root.FinancialConcurrency = Object.freeze({
    roundedMoney,
    sameMoney,
    nearMoney,
    financialVersion,
    context,
    nextVersion,
    applyDelta,
    compare,
    classification,
    reversalPreview,
    suspiciousPayments,
  });
})(typeof window !== "undefined" ? window : globalThis);
