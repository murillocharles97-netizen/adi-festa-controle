'use strict';
// GENERATED from the existing read-only audit. Server supplies canonical sources only.
const roundedMoney=n=>Math.round(Number(n)*100)/100,financialKey=x=>x.operationId||x.idempotencyKey||x.id;
const balanceEffectId=(type,id)=>type+':'+id,now=()=>new Date().toISOString(),checksumValue=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');
function financialLedgerEntry(name, item = {}) {
  if (item.deletedAt || item.active === false) return null;
  const customerId = String(item.clienteId || item.customerId || ""),
    sourceDocumentId = String(item.id || ""),
    operationId = financialKey(item) || sourceDocumentId;
  if (!customerId || !sourceDocumentId || !operationId) return null;
  let type = "",
    amount = 0,
    before = Number.NaN,
    after = Number.NaN;
  if (name === "sales" && (String(item.status || "") === "fiado" ||
    String(item.formaPagamento || "") === "fiado")) {
    type = "credit_sale";
    amount = Math.abs(
      roundedMoney(item.valorFinal ?? item.valorTotal ?? item.amount),
    );
    before = roundedMoney(item.saldoAnterior);
    after = Number.isFinite(Number(item.saldoAtual))
      ? roundedMoney(item.saldoAtual)
      : roundedMoney(before - amount);
  } else if (name === "payments") {
    type = "payment_received";
    amount = Math.abs(roundedMoney(item.valor ?? item.amount));
    before = roundedMoney(item.saldoAnterior);
    after = Number.isFinite(Number(item.saldoNovo))
      ? roundedMoney(item.saldoNovo)
      : roundedMoney(before + amount);
  } else if (name === "balanceAdjustments") {
    type = item.subtipo==='pagamento_duplicado_revertido'&&item.duplicatePaymentId
      ? "payment_reversal" : "balance_adjustment";
    before = roundedMoney(item.saldoAnterior);
    after = roundedMoney(item.saldoNovo);
    amount = Math.abs(roundedMoney(after - before));
  }
  if (
    !type ||
    !amount ||
    !Number.isFinite(before) ||
    !Number.isFinite(after)
  )
    return null;
  return {
    customerId,
    sourceCollection: type==='payment_reversal'?"payments":name,
    sourceDocumentId: type==='payment_reversal'?String(item.duplicatePaymentId):sourceDocumentId,
    operationId,
    effectId: balanceEffectId(type, type==='payment_reversal'?String(item.duplicatePaymentId):sourceDocumentId),
    type,
    amount,
    balanceDelta: roundedMoney(after - before),
    before,
    after,
    date: item.data || item.createdAt || item.criadoEm || "",
    sourceChecksum: checksumValue(item),
  };
}
const sameMoney = (left, right) =>
  Math.abs(roundedMoney(left) - roundedMoney(right)) < 0.005;
function buildFinancialBalanceAudit(raw, effectItems = []) {
  const clients = new Map(
      (raw.clients?.remoteItems || []).map((item) => [String(item.id), item]),
    ),
    effects = new Set(effectItems.map((item) => String(item.id || ""))),
    eventsByClient = new Map();
  for (const name of ["sales", "payments", "balanceAdjustments"])
    for (const item of raw[name]?.remoteItems || []) {
      const event = financialLedgerEntry(name, item);
      if (!event) continue;
      if (!eventsByClient.has(event.customerId))
        eventsByClient.set(event.customerId, []);
      eventsByClient.get(event.customerId).push(event);
    }
  const divergent = [],
    safeRepairs = [],
    effectBackfills = [],
    unsafe = [];
  let actualOpenDebt = 0,
    expectedOpenDebt = 0,
    ledgerEvents = 0;
  for (const [clientId, client] of clients) {
    const events = (eventsByClient.get(clientId) || []).sort((left, right) =>
        `${left.date}|${left.sourceDocumentId}`.localeCompare(
          `${right.date}|${right.sourceDocumentId}`,
        ),
      ),
      actual = roundedMoney(client.saldo || 0),
      expected = events.length ? events.at(-1).after : actual;
    ledgerEvents += events.length;
    actualOpenDebt += Math.abs(Math.min(0, actual));
    expectedOpenDebt += Math.abs(Math.min(0, expected));
    if (sameMoney(actual, expected)) {
      const latest = events.at(-1);
      if (latest && !effects.has(latest.effectId))
        effectBackfills.push({
          clientId,
          actualBalance: actual,
          expectedBalance: actual,
          difference: 0,
          latestOperationId: latest.operationId,
          latestOperationAt: latest.date,
          clientChecksum: checksumValue(client),
          status: "safe_effect_backfill",
          balanceAlreadyApplied: true,
          missingEffects: [{ ...latest }],
        });
      continue;
    }
    let start = -1;
    for (let index = events.length - 1; index >= 0; index--) {
      if (!sameMoney(events[index].before, actual)) continue;
      const chain = events.slice(index),
        continuous = chain.every(
          (event, position) =>
            position === 0 || sameMoney(event.before, chain[position - 1].after),
        ),
        effectsMissing = chain.every((event) => !effects.has(event.effectId));
      if (continuous && effectsMissing) {
        start = index;
        break;
      }
    }
    const row = {
      clientId,
      actualBalance: actual,
      expectedBalance: expected,
      difference: roundedMoney(expected - actual),
      latestOperationId: events.at(-1)?.operationId || "",
      latestOperationAt: events.at(-1)?.date || "",
      clientChecksum: checksumValue(client),
      status: start >= 0 ? "safe_missing_effects" : "manual_review",
      missingEffects:
        start >= 0
          ? events.slice(start).map((event) => ({ ...event }))
          : [],
    };
    divergent.push(row);
    (start >= 0 ? safeRepairs : unsafe).push(row);
  }
  return {
    generatedAt: now(),
    clientsChecked: clients.size,
    ledgerEvents,
    effectsConfirmed: effects.size,
    divergentCount: divergent.length,
    safeCount: safeRepairs.length + effectBackfills.length,
    safeBalanceCount: safeRepairs.length,
    effectBackfillCount: effectBackfills.length,
    unsafeCount: unsafe.length,
    actualOpenDebt: roundedMoney(actualOpenDebt),
    expectedOpenDebt: roundedMoney(expectedOpenDebt),
    openDebtDifference: roundedMoney(expectedOpenDebt - actualOpenDebt),
    divergent,
    safeRepairs,
    effectBackfills,
    unsafe,
  };
}

module.exports={buildFinancialBalanceAudit};
